# Framer Export → Next.js Converter (MVP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `fexport convert`, a resumable pipeline that turns a Framer export folder into a clean Next.js (App Router, TS, Tailwind, framer-motion, GSAP) project via code stages plus AI task files, gated by screenshot/DOM verification.

**Architecture:** `src/convert/` holds a stage pipeline (analyze → extract-cms → scaffold → tasks → verify) whose state lives in `<nextDir>/.convert/`. Everything Framer-specific sits behind a `PlatformAdapter` in `src/convert/adapters/framer/`. Stages talk only through JSON files in `.convert/analysis/` and the typed interfaces in `src/convert/types.ts`.

**Tech Stack:** TypeScript (ESM, Node ≥20), node:test via tsx, Puppeteer (already a dependency), @clack/prompts (already a dependency), new: `pixelmatch`, `pngjs`.

**Spec:** `docs/superpowers/specs/2026-11-02-framer-to-nextjs-converter-design.md`

## Global Constraints

- Framer-only MVP; `canHandle` rejects exports whose `export-report.json` `platform` ≠ `"framer"`.
- Verify widths: `[1440, 1000, 390]`. Breakpoints: `md = 810px`, `lg = 1200px` (mobile-first).
- Section pass rule: pixelmatch `threshold: 0.1`; mismatched pixels ≤ `0.5%` of section area; height difference > `2px` fails.
- Max verify attempts per task before `needs-human`: `3`.
- Never copy anything from `scripts/vendor/` or `scripts/modules/` into the generated project.
- All state writes are atomic (write `*.tmp` then rename), matching `src/cli/preferences.ts`.
- Tests: unit in `tests/unit/convert-*.test.ts` (run by `npm test`); browser/process tests in `tests/integration/convert-*.test.ts` (run by `npm run test:browser`).
- Paths with spaces must work (the user's repo lives under `D:\Codes\NEW\My Tool\...`). Child processes are spawned with argument arrays, never concatenated command strings; on Windows use `npm.cmd`/`npx.cmd`.
- **Spec amendment (Tailwind v4):** the generated project uses Tailwind v4, whose config is CSS-first. Tokens and breakpoints are emitted as an `@theme` block in `src/app/globals.css` instead of `tailwind.config.ts`; values are identical to the spec.
- Generated-project dependency versions live in one constant `STACK_VERSIONS` (Task 9); the implementer sets each to the current stable version from `npm view <pkg> version` at implementation time and pins exactly (no `^`).

## Review Focus

1. **Export or project path containing spaces** (`My Tool`) → servers and `next build` still start; pinned in Task 11.
2. **Re-running `scaffold` after an AI task edited a generated file** → file is left untouched and reported, never overwritten; pinned in Task 9.
3. **Verify interrupted or crashing mid-run** → both child servers are killed and their ports freed; pinned in Task 11.
4. **CMS item whose detail page was not crawled** → extract still emits the item, unmatched fields keep Framer ids and are recorded as warnings, no crash; pinned in Task 8.
5. **Next page missing a `data-section` the export has** → verify fails that section with an explicit "missing section <name>" message in the fix task rather than crashing or silently passing; pinned in Task 12.

---

## File Structure

```
src/convert/
  types.ts                       shared types (Task 1)
  state.ts                       state.json load/save/transitions (Task 1)
  adapters/types.ts              PlatformAdapter interface (Task 7)
  adapters/framer/framercms.ts   binary decoder (Task 2)
  adapters/framer/routes.ts      pages.json derivation (Task 3)
  adapters/framer/tokens.ts      tokens + breakpoints (Task 4)
  adapters/framer/components.ts  components + slices (Task 5)
  adapters/framer/animations.ts  runtime motion observer (Task 6)
  adapters/framer/index.ts       framerAdapter (Task 7)
  stages/analyze.ts              (Task 7)
  stages/extract-cms.ts          (Task 8)
  stages/scaffold/index.ts       (Task 9)
  stages/scaffold/versions.ts    STACK_VERSIONS (Task 9)
  stages/scaffold/files.ts       generated file contents (Task 9)
  stages/tasks.ts                AI task file rendering (Task 10)
  tasks/templates/*.md           component, page, motion, fix, agents (Task 10)
  verify/proc.ts                 child process + port helpers (Task 11)
  verify/serve.ts                start export + next servers (Task 11)
  verify/settle.ts               freeze animations (Task 11)
  verify/capture.ts              screenshots + section boxes (Task 11)
  verify/diff.ts                 section compare (Task 12)
  verify/dom-check.ts            text/link/image compare (Task 12)
  stages/verify.ts               orchestration + fix tasks (Task 13)
  pipeline.ts                    ordered stages + resume (Task 14)
  index.ts                       CLI commands + screens (Task 14)
tests/fixtures/framer-nudge-mini/  trimmed export (Task 2)
scripts/make-convert-fixture.ts    builds the fixture from out/framer-nudge (Task 2)
```

---

### Task 1: Shared types and pipeline state

**Files:**
- Create: `src/convert/types.ts`, `src/convert/state.ts`
- Test: `tests/unit/convert-state.test.ts`

**Interfaces:**
- Produces (types.ts):
  - `type StageName = 'analyze' | 'extract-cms' | 'scaffold' | 'tasks' | 'verify'`
  - `type StageStatus = 'pending' | 'done' | 'needs-ai' | 'failed'`
  - `type TaskStatus = 'pending' | 'in-progress' | 'done' | 'needs-human'`
  - `interface TaskRecord { id: string; kind: 'component' | 'page' | 'motion' | 'fix'; route?: string; file: string; status: TaskStatus; attempts: number; targets: string[] }`
  - `interface ConvertState { version: 1; exportDir: string; nextDir: string; stages: Record<StageName, StageStatus>; tasks: Record<string, TaskRecord>; fileHashes: Record<string, string>; warnings: string[] }`
  - `interface PageInfo { route: string; sourceFile: string; title: string; meta: Record<string, string>; dynamic?: { param: 'slug'; collection: string; slugs: string[] } }`
  - `interface Tokens { colors: Record<string, string>; tokenMap: Record<string, string>; fonts: Array<{ family: string; files: string[]; weight: string; style: string }>; typeScale: Array<{ name: string; size: string; lineHeight: string; letterSpacing: string }>; breakpoints: { md: 810; lg: 1200 } }`
  - `interface ComponentInfo { name: string; selector: string; pages: string[]; variants: string[]; slice: string }`
  - `interface AnimationEntry { route: string; selector: string; framerName?: string; trigger: 'appear' | 'scroll' | 'hover' | 'loop'; from: Record<string, string>; to: Record<string, string>; durationMs?: number; delayMs?: number; confidence: 'high' | 'low' }`
  - `interface Analysis { pages: PageInfo[]; tokens: Tokens; components: ComponentInfo[]; animations: AnimationEntry[] }`
- Produces (state.ts):
  - `STAGES: StageName[]` in pipeline order
  - `initState(exportDir: string, nextDir: string): ConvertState` — all stages `pending`
  - `loadState(nextDir: string): Promise<ConvertState | null>`
  - `saveState(state: ConvertState): Promise<void>` — atomic, writes `<nextDir>/.convert/state.json`
  - `findProjectRoot(fromDir: string): Promise<string | null>` — walks up to a dir containing `.convert/state.json`
  - `nextStage(state): StageName | null` — first stage not `done`
  - `recordAttempt(state, taskId: string, passed: boolean): TaskStatus` — pass → `done`; fail increments `attempts`, at 3 → `needs-human`, else `in-progress`

- [ ] **Step 1: Write failing tests** in `tests/unit/convert-state.test.ts`:
  - `initState` → every `STAGES` entry `'pending'`, `version === 1`.
  - `saveState` then `loadState` round-trips into a `fs.mkdtemp` dir whose name contains a space; no `.tmp` file remains.
  - `loadState` on a dir without state → `null`.
  - `findProjectRoot` from `<root>/src/app` returns `<root>`; from an unrelated temp dir returns `null`.
  - `nextStage` returns `'extract-cms'` after analyze is `done`; `null` when all done.
  - `recordAttempt` with three failures → statuses `in-progress`, `in-progress`, `needs-human`; a pass → `done`.
- [ ] **Step 2:** Run `node --import tsx --test tests/unit/convert-state.test.ts` → FAIL (module not found).
- [ ] **Step 3:** Implement `types.ts` and `state.ts` as specified.
- [ ] **Step 4:** Re-run → PASS. Run `npm run typecheck` → no errors.
- [ ] **Step 5:** Commit `feat(convert): add pipeline types and state store`.

---

### Task 2: Test fixture and `.framercms` decoder

**Files:**
- Create: `scripts/make-convert-fixture.ts`, `tests/fixtures/framer-nudge-mini/**`, `src/convert/adapters/framer/framercms.ts`
- Test: `tests/unit/convert-framercms.test.ts`

**Interfaces:**
- Produces:
  - `type CmsValue = { type: 'string'; value: string } | { type: 'date'; value: number } | { type: 'json'; value: unknown } | { type: 'richtext'; value: unknown } | { type: 'boolean'; value: boolean } | { type: 'number'; value: number }`
  - `interface CmsItem { id: string; fields: Record<string, CmsValue> }`
  - `class UnknownCmsTagError extends Error { tag: number; offset: number; key: string }`
  - `decodeChunk(buf: Buffer): { items: CmsItem[]; errors: UnknownCmsTagError[] }` — on an unknown tag, records the error and skips the rest of that item (cannot know its length) by stopping that chunk; returns items decoded so far.
  - `collectionIdFromFile(fileName: string): string` — `'hu3yniggG-chunk-default-0.framercms'` → `'hu3yniggG'`.

**Format (verified against nudge):** item = `u16BE fieldCount`, then per field `u32BE keyLen`, `key (utf8)`, `u8 tag`, value:
`0x0c` string = `u32BE len` + utf8; `0x04` date = `u64BE` ms; `0x0a` json = `u32BE len` + JSON text; `0x0b` richtext = `u8 flag` + `u32BE len` + JSON text. Items follow one another to end of buffer. `id` field is the item id. Any other tag → `UnknownCmsTagError` (Task 8 falls back to scraping).

- [ ] **Step 1:** Write `scripts/make-convert-fixture.ts` (run with `npx tsx scripts/make-convert-fixture.ts <exportDir>`): copies `index.html`, `export-report.json`, `serve.js`, `package.json`, `subpages/about.html`, `subpages/blog_the-power-of-focus.html`, `subpages/case-study_meridian-health.html`, `subpages/case-study.html`, every `data/*.framercms`, and every file under `assets/` referenced by those HTML files, into `tests/fixtures/framer-nudge-mini/`. Run it against `out/framer-nudge`; confirm the fixture is under 15 MB and commit it.
- [ ] **Step 2: Write failing tests** against `tests/fixtures/framer-nudge-mini/data/hu3yniggG-chunk-default-0.framercms`:
  - first item `id === 'leVeLIZbF'`
  - `fields.KVCXsWDZS` → `{ type: 'string', value: 'meridian-health' }`
  - `fields.rAITKxrzh` → `{ type: 'string', value: 'Meridian Health' }`
  - `fields.N9PVOHoUg` → `{ type: 'date', value: 1773878400000 }`
  - `fields.v80eqeLsH.type === 'json'` and `(value as any).src` starts with `https://framerusercontent.com`
  - `fields.fM51CJnkf.type === 'richtext'` and `JSON.stringify(value)` contains `"The Real Problem"`
  - item count ≥ 4 (case studies) and `errors.length === 0`; slugs include `meridian-health`
  - a hand-built buffer with tag `0x7f` yields `errors[0]` with `tag === 0x7f` and the correct `key`
  - `collectionIdFromFile` example above
- [ ] **Step 3:** Run `node --import tsx --test tests/unit/convert-framercms.test.ts` → FAIL.
- [ ] **Step 4:** Implement the decoder. If real files contain tags beyond the four above, add them only after confirming their layout from the bytes, with a test per tag.
- [ ] **Step 5:** Re-run → PASS. Commit `feat(convert): decode Framer CMS chunks; add nudge-mini fixture`.

---

### Task 3: Routes (`pages.json`)

**Files:**
- Create: `src/convert/adapters/framer/routes.ts`
- Test: `tests/unit/convert-routes.test.ts`

**Interfaces:**
- Consumes: `PageInfo` (Task 1).
- Produces:
  - `routeFromSubpageFile(file: string): string` — `'index.html'` → `'/'`; `'about.html'` → `'/about'`; `'blog_the-power-of-focus.html'` → `'/blog/the-power-of-focus'`.
  - `structureSignature(html: string): string` — hash of the tag/`data-framer-name` skeleton of `#main` with all text and attribute values except `data-framer-name` removed.
  - `derivePages(exportDir: string): Promise<PageInfo[]>` — reads `index.html` + `subpages/*.html`; groups pages sharing a parent path segment AND an identical `structureSignature` (≥2 members, or 1 member whose parent also has a listing page) into one dynamic page `'/<parent>/[slug]'` with `dynamic.slugs`. `dynamic.collection` is left `''` (filled by Task 8). Title from `<title>`, meta from `<meta name|property>`.

- [ ] **Step 1: Write failing tests:** the three `routeFromSubpageFile` examples; on the fixture, `derivePages` returns routes including `'/'`, `'/about'`, `'/case-study'`, and either `'/blog/[slug]'` with slugs `['the-power-of-focus']` and `'/case-study/[slug]'` with `['meridian-health']`; every `PageInfo.title` non-empty.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (regex/DOM via Puppeteer is unnecessary; use the existing `src/assets/html-tags.ts` tokenizer). **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(convert): derive Next routes from Framer export pages`.

---

### Task 4: Design tokens

**Files:**
- Create: `src/convert/adapters/framer/tokens.ts`
- Test: `tests/unit/convert-tokens.test.ts`

**Interfaces:**
- Produces:
  - `extractTokens(html: string, exportDir: string): Tokens`
  - `nameColor(value: string, usage: { prop: 'color' | 'background' | 'border'; count: number }[]): string` — returns a base name by dominant usage: `color` → `ink`, `background` → `surface`, `border` → `line`; ties broken by count; caller appends `-2`, `-3` on collision.
- Rules: `tokenMap` maps each `--token-<uuid>` to its generated name; `colors` maps name → value. `fonts` built from `@font-face` blocks whose `src` file exists under `assets/fonts/` **and** whose family appears in a `font-family` declaration outside `@font-face`. `typeScale` = distinct (size, line-height, letter-spacing) triples on text elements, named `text-1`… by descending size. `breakpoints` fixed `{ md: 810, lg: 1200 }` after asserting `@media (min-width: 1200px)` and `(max-width: 809.98px)` exist (throw a descriptive error otherwise).

- [ ] **Step 1: Write failing tests:** on fixture `index.html`: `Object.keys(tokenMap).length === 41`; all `colors` values parse as CSS colors (`/^(#|rgb|hsl)/`); no duplicate color names; every `fonts[].files` path exists; `fonts.length` < 93 (unused faces dropped); `breakpoints` equals `{ md: 810, lg: 1200 }`. Unit: `nameColor('#000', [{prop:'color',count:5},{prop:'background',count:1}]) === 'ink'`. HTML with no breakpoint media → throws `/breakpoint/`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(convert): extract Framer design tokens and font usage`.

---

### Task 5: Components and slices

**Files:**
- Create: `src/convert/adapters/framer/components.ts`
- Test: `tests/unit/convert-components.test.ts`

**Interfaces:**
- Consumes: `derivePages` output, `ComponentInfo`.
- Produces:
  - `findComponents(pages: Array<{ route: string; html: string }>): ComponentInfo[]` — candidates = elements whose class list contains a Framer component class `framer-[A-Za-z0-9]{5}` that also appears in a `<style data-framer-components>` list, plus `data-framer-name` subtrees whose `structureSignature` repeats ≥2 times across or within pages. Name = PascalCase of `data-framer-name` (fallback `Component<N>`), deduped. `variants` = distinct values of `data-framer-name` among `Desktop|Tablet|Mobile|Variant \d+` descendants/ancestors. Excludes `#main` itself and elements with >60% of the page's nodes.
  - `buildSlice(html: string, selector: string): string` — outerHTML of the first match plus a `<style>` containing only CSS rules whose selectors match an element inside it (selector match via class-name intersection is acceptable).

- [ ] **Step 1: Write failing tests:** on fixture pages — result contains a component whose name matches `/Button/`; each `ComponentInfo.pages.length ≥ 1`; names unique; `buildSlice` output contains the element's text and at least one CSS rule and is under 50% of the size of the page's total CSS.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(convert): detect reusable Framer components and slices`.

---

### Task 6: Runtime animation observer

**Files:**
- Create: `src/convert/adapters/framer/animations.ts`
- Test: `tests/integration/convert-animations.test.ts`

**Interfaces:**
- Produces: `observeAnimations(page: import('puppeteer').Page, route: string): Promise<AnimationEntry[]>`
- Algorithm: after `goto` + 300 ms, record for every element with a `data-framer-name` or Framer class its computed `opacity`, `transform`, `filter`, `clip-path` (snapshot A). Scroll in 250 px steps, after each step wait 50 ms and record elements newly in viewport; at 1500 ms after entering, record snapshot B. Changed A→B in viewport-at-load → `appear`; changed only after scrolling into view → `scroll`. Hover: for up to 40 `a`, `button`, `[data-framer-name*="Button"]`, dispatch `page.hover`, wait 400 ms, diff → `hover`. Loop: sample `transform` of all elements 4× at 250 ms intervals with no interaction; continuously changing → `loop`. Duration estimate = time between first and last differing sample (sample every 50 ms for `appear`); `confidence: 'high'` only when ≥3 samples bracket the change.

- [ ] **Step 1: Write failing test** using a local HTML string served with `page.setContent`: one element fading `opacity 0→1` over 600 ms on load (CSS transition triggered by JS), one element scaling on `:hover`, one element with an infinite `@keyframes` translate, one element below the fold that fades in via IntersectionObserver. Expect exactly one entry per trigger type with the right selector, `to.opacity === '1'` for appear, and appear `durationMs` within 450–800.
- [ ] **Step 2:** Run `node --import tsx --test tests/integration/convert-animations.test.ts` → FAIL. **Step 3:** Implement. **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(convert): observe runtime animations for motion tasks`.

---

### Task 7: Adapter interface and `analyze` stage

**Files:**
- Create: `src/convert/adapters/types.ts`, `src/convert/adapters/framer/index.ts`, `src/convert/stages/analyze.ts`
- Test: `tests/unit/convert-analyze.test.ts`

**Interfaces:**
- Produces (adapters/types.ts):
  ```ts
  interface StageContext { state: ConvertState; exportDir: string; nextDir: string; log(msg: string): void }
  interface PlatformAdapter {
    id: 'framer';
    canHandle(exportDir: string): Promise<boolean>;
    analyze(ctx: StageContext, opts?: { animations?: boolean }): Promise<Analysis>;
    sectionRootsSelector: string;            // '#main > *'
    settle(page: import('puppeteer').Page): Promise<void>; // implemented in Task 11
  }
  ```
- Produces: `framerAdapter: PlatformAdapter`; `runAnalyze(ctx: StageContext, adapter: PlatformAdapter, opts?: { animations?: boolean }): Promise<void>` — writes `.convert/analysis/{pages,tokens,components,animations}.json` and `slices/<Name>.html`, sets stage `analyze` → `done`. In this task `opts.animations` must be `false` (passing `true` throws `Error('animation observation is wired in Task 11')`); Task 11 replaces that throw with the real implementation and flips the default to `true`.
- `canHandle` → `false` when `export-report.json` is missing or `platform !== 'framer'`.

- [ ] **Step 1: Write failing tests:** `canHandle` true for fixture, false for a temp dir with `{"platform":"webflow"}`, false for a missing report. `runAnalyze(..., { animations: false })` on the fixture writes all four JSON files (animations `[]`), at least one slice file, and state stage `analyze === 'done'`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(convert): add platform adapter and analyze stage`.

---

### Task 8: `extract-cms` stage

**Files:**
- Create: `src/convert/stages/extract-cms.ts`
- Test: `tests/unit/convert-extract-cms.test.ts`

**Interfaces:**
- Consumes: `decodeChunk`, `collectionIdFromFile` (Task 2); `pages.json` (Task 3).
- Produces:
  - `nameFields(items: CmsItem[], renderedBySlug: Map<string, string>): { names: Record<string, string>; unmatched: string[] }` — the slug field is the string field whose values equal dynamic-route slugs → `slug`. For items with a rendered page: string equal to `<h1>` text → `title`; date field rendered anywhere on the page (any `toLocaleDateString('en-US', {month:'short'|'long', day, year})` form) → `date`; json field with `src` → `cover` (first) / `image2`…; richtext whose plain text appears in the page → `body`; other strings found verbatim in page text → camelCase of the nearest ancestor `data-framer-name` (e.g. `Tag` → `tag`), deduped. Fields never matched stay as their Framer id and appear in `unmatched`.
  - `richTextToHtml(node: unknown): string` — Framer node arrays: `[4, tag, attrs, ...children]` element, `[5, text]` text, root `[1, ...children]`; text HTML-escaped.
  - `runExtractCms(ctx: StageContext): Promise<void>` — for each collection id, merges items across all its chunk files (dedupe by `id`), names fields, links collection to the dynamic route whose slugs match (sets `PageInfo.dynamic.collection`, rewrites `pages.json`), writes `<nextDir>/src/content/<collection>.ts` with `export interface <Type>` and `export const <collection>: <Type>[]`, where collection name = dynamic route parent in camelCase (`blog`, `caseStudy`; fallback = collection id). Image `src` URLs map to `/images/<file>` using the export's asset file names. Unknown-tag errors → scrape the field from rendered pages; warnings appended to `state.warnings`.

- [ ] **Step 1: Write failing tests:**
  - `richTextToHtml([1,[4,'h4',{dir:'auto'},[5,'The Real Problem']],[4,'p',{},[5,'a < b']]])` → `'<h4 dir="auto">The Real Problem</h4><p>a &lt; b</p>'`.
  - On the fixture: `src/content/caseStudy.ts` exists, contains `slug: "meridian-health"` and `title: "Meridian Health"`; `pages.json` `/case-study/[slug]` has `dynamic.collection === 'caseStudy'`.
  - Review Focus #4: items whose slug has no rendered page (all but `meridian-health` in the fixture) are still present in the output file, and `state.warnings` lists unmatched field ids — no throw.
  - Generated file type-checks: run `tsc --noEmit --strict` on it in the test (spawn `npx tsc` with argument array) → exit 0.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(convert): extract Framer CMS collections into typed content`.

---

### Task 9: `scaffold` stage

**Files:**
- Create: `src/convert/stages/scaffold/{index,versions,files}.ts`
- Test: `tests/unit/convert-scaffold.test.ts`

**Interfaces:**
- Produces:
  - `STACK_VERSIONS: Record<'next'|'react'|'react-dom'|'typescript'|'tailwindcss'|'@tailwindcss/postcss'|'framer-motion'|'gsap'|'@gsap/react'|'lenis'|'eslint'|'eslint-config-next'|'@types/react'|'@types/react-dom'|'@types/node', string>` — exact versions (see Global Constraints).
  - `generateFiles(analysis: Analysis, imageManifest: Record<string, string>): Map<string, string>` — relative path → content.
  - `runScaffold(ctx: StageContext, opts?: { confirmOverwrite?: (file: string) => Promise<boolean> }): Promise<{ written: string[]; skipped: string[] }>`
- Generated files: `package.json` (scripts `dev`, `build`, `start`, `lint`), `tsconfig.json` (strict, `@/*` → `src/*`), `next.config.ts` (`images.unoptimized: false`, no remote patterns), `postcss.config.mjs`, `eslint.config.mjs`, `.gitignore` (includes `.convert/*` and `!.convert/tasks/`), `src/app/globals.css` (`@import "tailwindcss";` + `@theme` with `--breakpoint-md: 810px; --breakpoint-lg: 1200px;`, `--color-<name>`, `--font-<family>`, `--text-<n>` entries), `src/app/fonts.ts` (`next/font/local` per family), `src/app/layout.tsx` (fonts, metadata from `/` page, `<LenisProvider>`), `src/components/providers/LenisProvider.tsx` (`"use client"`), `src/lib/motion.ts` (`fadeUp`, `fadeIn` variants), `src/lib/gsap.ts` (registers `ScrollTrigger`, `useGSAP`), `src/components/RichText.tsx`, and one `page.tsx` per route (dynamic routes include `generateStaticParams` from `src/content/<collection>.ts`) rendering `<main data-page="<route>" />`.
- Assets: copies used font files to `public/fonts/`, images referenced by any page or CMS item to `public/images/` keeping file names; writes manifest to `.convert/analysis/images.json` (export path → `/images/<file>`).
- Overwrite rule: after writing, store sha256 per file in `state.fileHashes`. On re-run, if the on-disk hash differs from the stored hash the file is in `skipped` unless `confirmOverwrite(file)` resolves `true`.

- [ ] **Step 1: Write failing tests:**
  - On a temp nextDir prepared by `runAnalyze`(animations false)+`runExtractCms` on the fixture: `runScaffold` writes `src/app/globals.css` containing `--breakpoint-md: 810px` and `--breakpoint-lg: 1200px`; `src/app/case-study/[slug]/page.tsx` contains `generateStaticParams`; no file under the nextDir contains `scripts/vendor` or `framerusercontent.com`; `public/fonts` file count equals the sum of `tokens.fonts[].files` lengths.
  - Every value in `STACK_VERSIONS` matches `/^\d+\.\d+\.\d+$/`.
  - Review Focus #2: modify `src/app/layout.tsx`, re-run `runScaffold` without `confirmOverwrite` → file unchanged, path in `skipped`; with `confirmOverwrite: async () => true` → overwritten.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(convert): scaffold Next.js project from analysis`.

---

### Task 10: AI task files

**Files:**
- Create: `src/convert/stages/tasks.ts`, `src/convert/tasks/templates/{component,page,motion,fix,agents}.md`
- Test: `tests/unit/convert-tasks.test.ts`

**Interfaces:**
- Produces:
  - `renderTemplate(name: 'component'|'page'|'motion'|'fix'|'agents', vars: Record<string, string>): string` — `{{var}}` substitution; throws on any unreplaced `{{…}}`.
  - `runTasks(ctx: StageContext): Promise<TaskRecord[]>` — writes `.convert/tasks/NNN-<kind>-<slug>.md`, `AGENTS.md` and `CLAUDE.md` (identical content) at nextDir root, registers `TaskRecord`s, sets stage `tasks` → `needs-ai`.
- Ordering/numbering: components `001…` ordered by fewest descendant components first (atoms before composites); pages `101…` ordered by route alphabetical with `/` first; motion `201…` one per route with ≥1 animation entry.
- Every task file contains these headed sections in order: `## Goal`, `## Edit only`, `## Inputs` (slice path, reference screenshot paths `.convert/reference/<route-slug>/<width>.png`), `## Requirements`, `## Rules`, `## Done when` (the exact command `npx fexport convert verify <taskId>`). Page tasks list each section with its required `data-section="<name>"`. The shared Rules list (identical text in every task and in AGENTS.md): edit only listed files; Tailwind classes only, arbitrary values allowed; no inline `style` except motion values; server components by default, `"use client"` only for motion/interaction; never import from or copy the original export's scripts.
- `AGENTS.md` additionally explains the pipeline commands (`status`, `next`, `verify`) and the stack.

- [ ] **Step 1: Write failing tests:** on a fixture-scaffolded temp project: task ids are unique and sorted; first page task targets `src/app/page.tsx`; each task file contains all six headings in order and the exact `Done when` command with its id; `AGENTS.md` === `CLAUDE.md`; `renderTemplate('fix', {})` throws `/unreplaced/`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement + write the five templates. **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(convert): generate AI task files and agent guide`.

---

### Task 11: Verify — processes, servers, settle, capture

**Files:**
- Create: `src/convert/verify/{proc,serve,settle,capture}.ts`; add `settle` to `framerAdapter` (Task 7 file)
- Test: `tests/integration/convert-serve-capture.test.ts`

**Interfaces:**
- Produces:
  - `freePort(): Promise<number>`
  - `spawnManaged(cmd: string, args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv }): ManagedProcess` where `ManagedProcess = { child; stop(): Promise<void> }`; all managed processes are registered and stopped on `SIGINT`, `SIGTERM` and `process.on('exit')`; on Windows `stop` uses `taskkill /pid <pid> /T /F`.
  - `startExportServer(exportDir: string): Promise<{ url: string; stop(): Promise<void> }>` — `node serve.js` with `PORT`; resolves when `GET /` returns 200 (timeout 15 s).
  - `startNextServer(nextDir: string): Promise<{ url: string; stop(): Promise<void>; buildLog: string }>` — `npm run build` then `npm run start -- -p <port>`; on build failure rejects with `BuildFailedError` carrying the log.
  - `settleNext(page)`: navigates with `?__verify=1` (Task 9's generated `src/lib/motion.ts` sets `MotionGlobalConfig.skipAnimations = true` and `src/lib/gsap.ts` exposes `window.gsap` when that query flag is present — extend Task 9's files and add one assertion to its test for each), injects `*{animation-duration:0s!important;transition-duration:0s!important}`, scrolls to bottom in 250 px steps then to top, calls `window.gsap?.globalTimeline.progress(1)`, awaits `document.fonts.ready` and network idle.
  - `framerAdapter.settle(page)`: same CSS injection, scroll through, wait 1500 ms, fonts + network idle.
  - `interface CaptureResult { png: Buffer; sections: Array<{ name: string; box: { x: number; y: number; width: number; height: number } }> }`
  - `capturePage(page, url, width, mode: 'export' | 'next'): Promise<CaptureResult>` — viewport `width × 900`, full-page screenshot; sections from `framerAdapter.sectionRootsSelector` (export) or `[data-section]` (next); export section name = `data-framer-name` or `section-<index>`; next name = `data-section`.
  - Wire animations into analyze: `runAnalyze` with `animations: true` starts `startExportServer`, launches Puppeteer and calls `observeAnimations` per static route and one slug per dynamic route; add a test in this task's file asserting `animations.json` is an array after `runAnalyze(..., { animations: true })` on the fixture.

- [ ] **Step 1: Write failing tests:**
  - Review Focus #1 + #3: copy the fixture to a temp dir whose path contains a space; `startExportServer` resolves and serves `/` with 200; `stop()` frees the port (a new `net.createServer().listen(port)` succeeds afterwards).
  - Spawn a managed `node -e "setInterval(()=>{},1000)"`, emit the registered SIGINT cleanup handler, assert the child pid is no longer alive.
  - `capturePage` on the fixture export at 1440 returns a PNG with width 1440 and ≥3 sections.
  - `startNextServer` on a dir whose `npm run build` script is `node -e "process.exit(1)"` rejects with `BuildFailedError`.
- [ ] **Step 2:** Run `node --import tsx --test tests/integration/convert-serve-capture.test.ts` → FAIL. **Step 3:** Implement. **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(convert): add verify servers, settling and capture`.

---

### Task 12: Verify — section diff and DOM checks

**Files:**
- Modify: `package.json` (add `pixelmatch`, `pngjs`, `@types/pngjs`)
- Create: `src/convert/verify/{diff,dom-check}.ts`
- Test: `tests/unit/convert-diff.test.ts`

**Interfaces:**
- Produces:
  - `interface SectionResult { name: string; width: number; ratio: number; heightDelta: number; pass: boolean; reason?: string; diffPng?: Buffer; expectedPng?: Buffer; actualPng?: Buffer }`
  - `compareSections(expected: CaptureResult, actual: CaptureResult, width: number): SectionResult[]` — pair sections by name, then by order for unnamed; crop both, pad the shorter to equal height, `pixelmatch(..., { threshold: 0.1 })`; `pass = ratio <= 0.005 && Math.abs(heightDelta) <= 2`. Expected section without counterpart → `pass: false, reason: 'missing section <name>'`.
  - `interface DomMismatch { section: string; kind: 'text'|'link'|'image'; expected: string; actual: string }`
  - `extractSectionDom(page, selector): Promise<Array<{ name; text: string; links: string[]; images: string[] }>>` and `compareDom(expected, actual, maps: { routes: Record<string,string>; images: Record<string,string> }): DomMismatch[]` — text normalised (collapse whitespace, trim); export links mapped through `routes` (export-relative path → Next route), image srcs through `images` manifest (compare basenames after mapping).

- [ ] **Step 1: Write failing tests** with synthetic PNGs built via `pngjs`:
  - identical 100×100 sections → `ratio 0`, pass.
  - 100×100 with 60 changed pixels (0.6%) → fail; with 40 (0.4%) → pass.
  - heights 100 vs 103 → fail with `heightDelta 3`; 100 vs 102 → pass.
  - Review Focus #5: expected has `Hero`, actual lacks it → `{ pass: false, reason: 'missing section Hero' }`.
  - `compareDom`: `"  Hello\n world "` vs `"Hello world"` → no mismatch; link `subpages/about.html` vs `/about` with routes map → no mismatch; differing image basename → one `image` mismatch.
- [ ] **Step 2:** `npm install pixelmatch pngjs @types/pngjs`; run tests → FAIL. **Step 3:** Implement. **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(convert): section pixel diff and DOM comparison`.

---

### Task 13: `verify` stage orchestration and fix tasks

**Files:**
- Create: `src/convert/stages/verify.ts`
- Test: `tests/integration/convert-verify.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 10, 11, 12.
- Produces: `runVerify(ctx: StageContext, target?: string): Promise<{ passed: string[]; failed: string[] }>` — `target` is a route (`/about`) or task id; default = every task with status ≠ `done` plus all routes. Flow: start both servers once; for each route × width: reference capture from cache `.convert/reference/<slug>/<width>.png` (+ `sections.json`) or capture and cache; capture Next with `?__verify=1`; `compareSections` + `compareDom`; write `.convert/diffs/<slug>/<width>-<section>-{expected,actual,diff}.png` and `.convert/diffs/report.json`. A page task passes when all its route's sections pass at all three widths and DOM has no mismatches; component tasks pass when every route using the component passes for sections containing it (else stay `pending`, not failed); motion tasks are never auto-passed — they are listed for the manual checklist. On failure call `recordAttempt`; if result is not `needs-human`, write `fix-<taskId>-<attempt>.md` via `renderTemplate('fix', …)` listing each failing section/width with its three PNG paths, ratio, height delta, reason and DOM mismatches. `BuildFailedError` → one `fix-build-<n>.md` with the build log tail (last 80 lines), no page verification. Servers always stopped in `finally`.

- [ ] **Step 1: Write failing tests** (fixture export + a minimal hand-written Next stand-in: a temp dir whose `package.json` `build` is a no-op and `start` runs a tiny node static server serving a copy of the export's `index.html` with `data-section` attributes added to `#main > *` children):
  - matching stand-in → task for `/` `done`, `report.json` lists all widths passing.
  - stand-in with one section's text changed → task status `in-progress`, `fix-<id>-1.md` exists and names the section and contains a `text` mismatch; after two more failing runs → `needs-human` and no `fix-<id>-3.md`.
  - stand-in with failing build → `fix-build-1.md` exists containing the build output.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(convert): verify stage with fix-task loop`.

---

### Task 14: CLI, pipeline and wiring

**Files:**
- Create: `src/convert/pipeline.ts`, `src/convert/index.ts`
- Modify: `src/cli/index.ts` (add `convert` before the `ui` branch at ~line 179), `src/cli/help.ts` (document commands), `src/cli-v2/index.ts` (offer conversion after export when platform is framer), `README.md` (new "Convert to Next.js" section)
- Test: `tests/unit/convert-cli.test.ts`

**Interfaces:**
- Produces:
  - `parseConvertArgs(argv: string[]): { command: 'run'|'status'|'next'|'verify'; exportDir?: string; nextDir?: string; target?: string; yes: boolean }` — `convert <exportDir> [nextDir]` → `run`; `convert status|next|verify [target]`; `--yes` skips confirms.
  - `runPipeline(exportDir: string, nextDir: string, io: { confirm(msg: string): Promise<boolean>; log(msg: string): void }): Promise<ConvertState>` — creates/loads state, refuses non-Framer exports with message `Only Framer exports are supported in this version (found: <platform>)`, runs code stages from `nextStage`, stops at `tasks` → `needs-ai`, prints the next task path.
  - `formatStatus(state: ConvertState): string` — table of stages and tasks with counts by status and the motion checklist (route, trigger, selector).
  - `runConvertCommand(argv: string[]): Promise<number>` — exit code.
- Defaults: `nextDir` = `<exportDir>-next`. `status|next|verify` locate the project via `findProjectRoot(process.cwd())`; error `No .convert/state.json found; run "fexport convert <exportDir>" first` when absent.
- cli-v2: after the export step, when platform is `framer`, `uiConfirm('Convert to a Next.js project now?')` → `runPipeline`.

- [ ] **Step 1: Write failing tests:** arg parsing for each form; `runPipeline` with a webflow report → rejects with the exact message; on the fixture (animations disabled via env `FEXPORT_CONVERT_NO_ANIMATIONS=1`) → state stages `analyze`, `extract-cms`, `scaffold` `done` and `tasks` `needs-ai`; a second call is a no-op that returns the same state; `formatStatus` contains `needs-ai` and each task id; `runConvertCommand(['status'])` from a non-project dir returns `1`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement and wire. **Step 4:** → PASS; `npm run typecheck`; `npm run build` succeeds; `node bin/fexport.js convert --help` prints the commands.
- [ ] **Step 5:** Commit `feat(convert): add fexport convert command and wizard hand-off`.

---

### Task 15: End-to-end check on the fixture and on nudge

**Files:**
- Create: `tests/integration/convert-e2e.test.ts`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Write the test:** run `runConvertCommand(['<fixture>', '<tmp dir with space>/nudge next', '--yes'])` (animations enabled); assert exit 0, `.convert/analysis/animations.json` is valid JSON array, then in the generated project run `npm install` and `npm run build` (spawn with arg arrays, timeout 10 min) → exit 0. Mark the test skipped unless `FEXPORT_E2E=1`.
- [ ] **Step 2:** Run `FEXPORT_E2E=1 node --import tsx --test tests/integration/convert-e2e.test.ts` → PASS.
- [ ] **Step 3:** Manual smoke: `npx tsx src/cli/index.ts convert out/framer-nudge` → stops at `needs-ai`; `fexport convert status` lists 9 page tasks (7 static routes: `/`, `/about`, `/blog`, `/case-study`, `/contact`, `/play-ground`, `/services`; 2 dynamic: `/blog/[slug]`, `/case-study/[slug]`), plus component and motion tasks; `fexport convert verify /` on the untouched scaffold fails and writes `fix-*.md`. Record observed counts in the PR description.
- [ ] **Step 4:** Add CHANGELOG entry. Run `npm run check` → all green.
- [ ] **Step 5:** Commit `test(convert): end-to-end conversion on nudge fixture`.
