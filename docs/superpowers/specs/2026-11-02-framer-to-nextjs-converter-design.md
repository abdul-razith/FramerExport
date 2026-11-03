# Framer Export → Next.js Converter (MVP) — Design

Date: 2026-11-02
Status: Draft for review

## 1. Goal

Turn a FramerExport output folder (e.g. `out/framer-nudge`) into a clean, production-standard
Next.js project — App Router, TypeScript (strict), Tailwind CSS, framer-motion, GSAP — that is
visually identical to the export, through a staged, resumable pipeline that mixes deterministic code
stages with AI-assisted stages run in Claude Code or Antigravity.

"Identical" is defined operationally by the `verify` stage (section 7): per-section pixel diff
≤ 0.5% at three viewport widths plus exact DOM checks. Animations are verified by a manual
checklist because pixel tests cannot measure motion.

### Decisions made during brainstorming

| Topic | Decision |
|---|---|
| Fidelity strategy | Clean hand-built rebuild, iterated against screenshots until it matches (option C) |
| AI integration | Task files + manual hand-off; the user runs each task in Claude Code / Antigravity (no headless automation in MVP) |
| Platform scope | Framer only, with an adapter boundary for future platforms |
| Location | Inside FramerExport as `fexport convert`, reusing the v2 CLI stack |
| Acceptance | Per-section pixel diff ≤ 0.5% + DOM checks at 1440 / 1000 / 390 px; animation checklist |

### Out of scope (MVP)

- Non-Framer platforms.
- `--auto` mode that launches `claude -p` headlessly.
- Forms, accounts, payments, search, or any backend logic.
- Automated verification of animation timing/easing.
- Copying any Framer runtime (`scripts/vendor/*`) into the generated project.

## 2. Reference facts (from `out/framer-nudge`)

- 1 home page + 18 subpages; 8 blog detail pages and 4 case-study detail pages are CMS-driven.
- Breakpoints: desktop `≥1200px`, tablet `810–1199.98px`, phone `<810px`.
- 20 Framer component classes (`framer-Ub91r`, …) and 81 distinct `data-framer-name` labels.
- 41 `--token-<uuid>` CSS variables; 93 `@font-face` rules; 90 woff2 files; 148 images.
- CMS data: `data/*.framercms` — a length-prefixed binary record format
  (key length, key, type tag, value). Field keys are Framer ids (e.g. `KVCXsWDZS`); collection
  modules are `D8jD2HbSE.*.mjs` and `hu3yniggG.*.mjs`.
- No `data-framer-appear-id` attributes: animations are driven by the JS modules at runtime.
- `out/` is gitignored, so tests need a trimmed fixture copied into `tests/fixtures/`.

## 3. Architecture

### 3.1 Commands

```
fexport convert <exportDir> [nextDir]   wizard; resumes from the first unfinished stage
fexport convert status [nextDir]        stage/task progress table
fexport convert next [nextDir]          print the path + summary of the next AI task
fexport convert verify [route|taskId]   screenshot + DOM diff; accept or emit fix task
```

`nextDir` defaults to `<exportDir>-next`. Commands other than the wizard find the project by
walking up from the current directory to a `.convert/state.json`.

Wired into `src/cli/index.ts` (subcommand `convert`) and offered at the end of the v2 wizard
(`src/cli-v2/index.ts`) as "Convert to Next.js?" when the platform is Framer.

### 3.2 Code layout

```
src/convert/
  index.ts                 command parsing + v2-style screens (@clack/prompts)
  state.ts                 load/save .convert/state.json (atomic write), transitions
  pipeline.ts              ordered stage list, resume logic
  stages/
    analyze.ts
    extract-cms.ts
    scaffold.ts
    tasks.ts               renders AI task files from analysis
    verify.ts
  adapters/
    types.ts               PlatformAdapter interface
    framer/
      index.ts
      dom.ts               Framer DOM conventions (#main, data-framer-name, component classes)
      framercms.ts         .framercms decoder
      tokens.ts            --token-* resolution + naming
      breakpoints.ts
      animations.ts        runtime observation of motion
  tasks/templates/         Markdown templates: component, page, motion, fix, AGENTS.md
  verify/
    serve.ts               start/stop export server and `next start`
    settle.ts              freeze animations to end state on both sides
    capture.ts             Puppeteer screenshots per route × width
    diff.ts                section splitting + pixelmatch
    dom-check.ts           text / link / image comparisons
```

Each unit has one job and communicates through the JSON files in `.convert/analysis/` so stages
can be tested and re-run independently.

### 3.3 Adapter boundary

```ts
interface PlatformAdapter {
  id: 'framer';
  canHandle(exportDir: string): Promise<boolean>;      // reads export-report.json
  analyze(ctx): Promise<Analysis>;                       // pages, tokens, components, animations
  extractContent(ctx): Promise<ContentCollections>;     // CMS → typed data
  sectionRoots(page): string;                            // selector for top-level sections
  settle(page): Promise<void>;                           // freeze runtime for screenshots
}
```

Only `adapters/framer/` knows Framer specifics. Stages consume the adapter interface.

### 3.4 Pipeline state

Lives inside the generated project so work can stop and resume at any time:

```
<nextDir>/.convert/
  state.json        { version, exportDir, stages: {name: status}, tasks: {id: {status, attempts, files}} , fileHashes }
  analysis/         pages.json, tokens.json, components.json, animations.json, slices/*.html
  reference/        export screenshots: <route>/<width>.png and per-section crops
  tasks/            001-component-*.md, 1xx-page-*.md, 2xx-motion-*.md, fix-*.md
  diffs/            latest verify output (expected/actual/diff PNGs, report.json)
```

Stage status: `pending | done | needs-ai | failed`.
Task status: `pending | in-progress | done | needs-human`.
`.convert/` is added to the generated project's `.gitignore` except `tasks/` (useful history).

## 4. Stage 1 — `analyze` (code)

Inputs: export folder. Outputs: `.convert/analysis/*`.

- **pages.json** — routes derived from `index.html` + `subpages/*.html` and the original URLs in
  `export.log`/links (e.g. `blog_the-power-of-focus.html` → `/blog/the-power-of-focus`). Detail
  pages whose DOM structure matches a CMS template are grouped into one dynamic route
  (`/blog/[slug]`, `/case-study/[slug]`). Includes title and meta.
- **tokens.json** — every `--token-*` resolved to its value; named by usage (dominant property
  and context, e.g. `ink`, `surface`, `muted`, `accent`); collisions get numeric suffixes. Also
  font families, type scale (distinct font-size/line-height/letter-spacing combos) and breakpoints.
- **components.json** — candidates from Framer component classes and repeated
  `data-framer-name` subtrees across pages; for each: name, pages used, variants
  (Desktop/Tablet/Mobile, Variant N), and an extracted slice `slices/<Name>.html` containing the
  outer HTML plus only the CSS rules that match it.
- **animations.json** — runtime observation with Puppeteer: per page, snapshot computed
  `opacity`/`transform`/`filter`/`clip-path` of elements at load, after scroll-into-view, and
  on hover; sample over time to estimate duration/delay; detect marquee/loop (continuous
  transform change) and Lenis (smooth-scroll wrapper). Each entry records selector,
  `data-framer-name`, trigger, from/to values, estimated timing, and a confidence flag.

## 5. Stage 2 — `extract-cms` (code)

- `framercms.ts` decodes records into `{ id, createdAt, updatedAt, fields: Record<frameId, value> }`.
  Unknown type tags raise a typed error caught by the stage.
- Field naming: decoded values are matched against the rendered detail pages (h1 → `title`,
  date-formatted text → `date`, `<img>` src → `cover`, longest rich block → `body`, slug from
  URL). Unmatched fields keep their id and are listed as warnings in `state.json`.
- Fallback: if decoding a field fails, the value is scraped from the rendered subpage instead.
- Output in the Next.js project: `src/content/<collection>.ts` exporting a TypeScript interface
  and a typed array; rich text as HTML strings rendered by a single `RichText` component; image
  paths pointing at `public/images/...`.

## 6. Stages 3–6 — scaffold and AI tasks

### 6.1 Stage 3 — `scaffold` (code)

- Next.js App Router project, TypeScript strict, Tailwind, ESLint, `src/` dir.
  Dependencies: `framer-motion`, `gsap`, `@gsap/react`, `lenis`.
- `tailwind.config.ts` from tokens: screens `md: 810px`, `lg: 1200px` (mobile-first); colors,
  font families, type scale.
- Fonts: only woff2 files actually referenced by used `@font-face` rules → `public/fonts/`,
  loaded via `next/font/local`.
- Images → `public/images/` with readable names where derivable; manifest mapping old → new.
- `app/layout.tsx` (fonts, metadata, Lenis provider), `lib/motion.ts`, `lib/gsap.ts`.
- One placeholder `page.tsx` per route so `next build` passes immediately.
- `AGENTS.md` and `CLAUDE.md` at project root: conventions + how the pipeline works.
- Records hashes of every generated file in `state.json`; re-running scaffold never overwrites a
  file whose hash changed without confirmation.

### 6.2 Stages 4–6 — AI task files

Generated in dependency order:

1. `0xx-component-<Name>.md` — shared components first (atoms → composites). Contains: goal,
   target file `src/components/<Name>.tsx`, slice path, cropped reference screenshots at three
   widths, props derived from variants.
2. `1xx-page-<route>.md` — one per route. Components to compose, content source (static or
   `src/content/*` with `generateStaticParams`), ordered list of sections each with reference
   crop and required `data-section="<name>"` attribute.
3. `2xx-motion-<route>.md` — that page's `animations.json` entries; framer-motion for appear and
   hover, GSAP ScrollTrigger for scroll-linked effects, Lenis already wired. Acceptance is a
   checklist the user ticks.

Rules repeated in every task: edit only the listed files; Tailwind classes only (arbitrary
values allowed); no inline style objects except motion values; server components by default,
`"use client"` only where needed; finish with `fexport convert verify <route>`.

## 7. Stage 7 — `verify`

1. Start the export with its own `serve.js` and the Next.js app with `next build && next start`,
   each on a free port.
2. Settle both pages: disable CSS animations/transitions, `MotionGlobalConfig.skipAnimations`,
   complete GSAP timelines and ScrollTrigger by scrolling through, scroll-through + wait on the
   Framer side, await fonts and network idle.
3. Capture at 1440, 1000, 390 px. Export captures are cached in `.convert/reference/`.
4. Split into sections: export side = top-level children of `#main` (adapter `sectionRoots`);
   Next side = `[data-section]` elements; matched by order and name. Each section crop is
   compared with `pixelmatch` (threshold 0.1); pass if mismatched pixels ≤ 0.5% of area. Size
   mismatches beyond 2 px in height count as failure.
5. DOM checks: normalized visible text per section, link targets (mapped through route table),
   image sources (mapped through the image manifest) must match exactly.
6. Pass → task `done`. Fail → `fix-<taskId>-<n>.md` listing failing sections/widths with
   expected/actual/diff PNGs and DOM mismatches. After 3 failed attempts → `needs-human`.

New dependencies for FramerExport: `pixelmatch`, `pngjs`.

## 8. Error handling

- Every stage idempotent and re-runnable; atomic writes for state.
- Clear stops for: missing export dir, non-Framer `export-report.json`, corrupt CMS file,
  `next build` failure (output saved to `.convert/diffs/build.log` and surfaced as a fix task).
- Free-port discovery and guaranteed shutdown of both servers (including on Ctrl+C).

## 9. Testing

- Unit (`node --test`, existing pattern): framercms decoder on real nudge files, token naming,
  route grouping, component slice extraction, task rendering, state transitions, section
  splitter, diff threshold logic.
- Fixture: trimmed copy of `framer-nudge` in `tests/fixtures/framer-nudge-mini/` (home + 1 blog
  page + its CMS files + needed assets).
- Integration: analyze → extract-cms → scaffold on the fixture, assert `next build` succeeds;
  run verify against an intentionally broken page and assert a fix task is emitted.
- Acceptance (manual, outside CI): full pipeline on `out/framer-nudge` with Claude Code or
  Antigravity until every route passes verify and every motion checklist is ticked.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Unknown `.framercms` field types | Scrape fallback from rendered subpages |
| Animation timing inferred imperfectly | Confidence flags + manual checklist |
| Settling Framer's runtime differs from settling the Next app | Both sides settle to end state; per-section diff isolates drift |
| Font rendering noise | pixelmatch threshold 0.1 + 0.5% tolerance |
| Template license | User confirms rights to the source site before conversion |
