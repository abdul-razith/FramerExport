# Framer → Clean Next.js Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in `--nextjs` conversion (and `to-nextjs` subcommand) that turns a Framer export into a clean, editable Next.js 16 + Tailwind v4 + motion/GSAP project, with an optional multi-provider AI naming pass.

**Architecture:** A self-contained `src/nextjs/` pipeline.
1. A live Puppeteer capture at three widths produces raw DOM trees.
2. Pure stages merge breakpoints, then map styles to Tailwind and tokens, extract components, content and MDX collections, and attach animation specs.
3. An emitter writes the project into `nextjs.tmp/`, which is renamed to `nextjs/`.
4. `verify` builds the project and compares screenshots.
5. `refine` optionally renames things through an LLM provider, behind a build + screenshot gate.

Existing code receives only the CLI flags, help text and one guarded, lazily imported call.

**Tech Stack:** TypeScript (Node ≥20, ESM, tsx), Puppeteer (already a dependency), parse5, turndown, pixelmatch + pngjs, `node:test`. Generated project: Next.js 16, React 19, Tailwind CSS 4, motion 12, gsap 3, lenis 1, @next/mdx.

**Spec:** `docs/superpowers/specs/2026-11-09-framer-to-nextjs-design.md`

## Global Constraints

- Branch: `feature/framer-nextjs`. Commit after every task with the attribution line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- All new source lives in `src/nextjs/`. Only these existing files change: `src/cli/index.ts`, `src/cli/help.ts`, `src/exporter/index.ts`, `package.json`, `README.md`, `CHANGELOG.md`.
- `src/nextjs/` is loaded only via `await import(...)`. No static import of it anywhere in existing code.
- Conversion runs only when `--nextjs` is set **and** `platform.name === 'framer'`. Otherwise it warns and skips.
- A conversion failure never fails `framer-export <url>` (exit 0, error in `nextjs/CONVERSION-REPORT.md`). `to-nextjs` exits 1 on failure.
- Capture widths: base 1440, tablet 1024, mobile 390. Framer breakpoints: tablet `max-width: 1199px`, mobile `max-width: 809px`.
- Tailwind variants are desktop-first: `@custom-variant tablet (@media (max-width: 1199px));` and `@custom-variant mobile (@media (max-width: 809px));`
- Generated code must contain no `framer-` strings in `app/`, `components/` or `content/`, and no hex colours in `components/`.
- Animation defaults: duration 0.6 s, ease `easeOut`, letter stagger 0.03 s. All live in `components/motion/config.ts`.
- Cache directory: `<export-dir>/.nextjs-cache/`. Refine cache: `.nextjs-cache/refine/<section-hash>.json`. Agent-CLI sandbox: `.nextjs-cache/refine/sandbox-<n>/`.
- Visual acceptance threshold: similarity ≥ 0.97 for each page and width.
- Provider auto-selection order: `claude-code`, `agy`, `gemini`, `groq`, `openrouter`, `github`, `ollama` (`anthropic` only when explicitly chosen).
- Existing `npm run typecheck`, `npm test` and `npm run test:browser` must pass with no existing test modified.
- New unit tests: `tests/unit/nextjs-*.test.ts` (picked up by `npm test`). New browser/build tests: `tests/integration-nextjs/*.test.ts`, run by a new script `test:nextjs`, kept out of `test:browser` so existing suites are unchanged.

## Review Focus

1. **A page that fails to capture or convert** (timeout, HTTP error, unexpected DOM): the other pages still produce output, the failed route gets a placeholder page, and the report names it. Test in Task 15.
2. **Re-running `to-nextjs` when a previous `nextjs/` exists and the new run crashes midway**: the old `nextjs/` must be untouched. Test in Task 15.
3. **Text containing JSX-significant or unusual characters** (`{ } < > " ' \``, `&nbsp;`, emoji, RTL): escaped so the generated project still builds and shows identical text. Test in Task 12.
4. **Name collisions**: two sections both called "Content", two images that would both be called `hero.jpg`, a slug with unicode or spaces. The result must be unique, deterministic, valid identifiers and file names. Tests in Tasks 9 and 11.
5. **An export folder that is not a Framer export** (no `export-report.json`, or `platform` other than `framer`): `to-nextjs` stops with a clear message and exit code 1, and writes nothing. Test in Task 1.

---

## File Structure

```
src/nextjs/
  model.ts               shared types + nodeKey()
  options.ts             flag parsing → NextjsOptions
  index.ts               runNextConversion(), runToNextjs(): orchestration, tmp→final rename, report
  report.ts              ConversionReport type + renderReport() markdown
  capture.ts             Puppeteer capture at 3 widths, hover rules, scroll samples, screenshots
  framer/animations.ts   parse start states from export HTML
  framer/breakpoints.ts  merge 3 visible trees into one Node tree
  framer/names.ts        layer name → identifiers, fallbacks, uniqueness
  framer/collections.ts  collection detection + item → MDX
  framer/motion-map.ts   Node → motion wrappers (reveal, split-text, smooth-scroll, cursor, loader, scroll)
  tokens.ts              colour/font/radius/shadow tokens + colour naming
  fonts.ts               @font-face extraction and grouping
  tailwind.ts            computed style → Tailwind classes + leftover CSS
  components.ts          structural hashing, sections, shared layout, repeated UI components
  content.ts             props → typed content files
  emit/jsx.ts            Node → JSX string (escaping, next/image, next/link)
  emit/project.ts        write every project file
  emit/templates.ts      static file templates (configs, motion components, README)
  versions.ts            pinned dependency versions for the generated project
  verify.ts              install, build, serve, screenshot, pixel diff
  refine/types.ts        LlmProvider, ProviderId, EditList
  refine/openai-compatible.ts   gemini, groq, openrouter, github, ollama
  refine/anthropic.ts
  refine/agent-cli.ts    claude-code + agy (sandboxed spawn)
  refine/select.ts       availability detection + auto-selection
  refine/throttle.ts     per-provider rate limit + 429 backoff
  refine/cache.ts        resumable section cache
  refine/edits.ts        edit-list JSON schema, validation, apply/revert
  refine/index.ts        runRefine(): per-section loop with gate
scripts/update-nextjs-versions.ts
tests/unit/nextjs-*.test.ts
tests/integration-nextjs/*.test.ts
tests/fixtures/nextjs/   fixture "Framer-like" site + export folder + serve helper
```

---

### Task 1: Options, isolation hook and CLI wiring

**Files:**
- Create: `src/nextjs/model.ts`, `src/nextjs/options.ts`, `src/nextjs/report.ts`, `src/nextjs/index.ts` (stub orchestration)
- Modify: `src/cli/index.ts` (flag parsing before `const url = args[0]`, plus a new `to-nextjs` branch next to the `ui` branch), `src/cli/help.ts`, `src/exporter/index.ts`, `package.json`
- Test: `tests/unit/nextjs-options.test.ts`, `tests/unit/nextjs-isolation.test.ts`

**Interfaces:**
- Produces:
  - `model.ts`: `type Breakpoint = 'base'|'tablet'|'mobile'`; `CAPTURE_WIDTHS = { base: 1440, tablet: 1024, mobile: 390 } as const`; `type Style = Record<string,string>` (kebab-case CSS property → computed value); `interface AnimationSpec`, `interface RawNode`, `interface Node`, `interface PageModel`, `interface ConversionContext` (fields below); `nodeKey(ancestors: {tag:string; framerName?:string; index:number}[]): string`.
  - `options.ts`: `interface NextjsOptions { aiRefine: boolean; aiProvider?: ProviderId; aiModel?: string; verify: boolean; cliSkipPermissions: boolean }`; `parseNextjsFlags(args: string[]): { enabled: boolean; options: NextjsOptions }` (removes the flags it consumes from `args`, like `extractFlag`).
  - `report.ts`: `interface ConversionReport { pages: {route:string; status:'ok'|'failed'; error?:string}[]; fallbackNames: {name:string; route:string}[]; unconverted: {route:string; what:string; why:string}[]; keptDuplicates: {route:string; key:string}[]; textExceptions: {route:string; text:string}[]; similarity: {route:string; width:number; score:number}[]; build?: {ok:boolean; output?:string}; refine?: {provider:string; accepted:number; rejected:{section:string; reason:string}[]; requests:number; stoppedEarly?:string}; fatal?: string }`; `emptyReport(): ConversionReport`; `renderReport(r: ConversionReport): string`.
  - `index.ts`: `runNextConversion(exporter: {outDir:string; siteUrl:string; platform:{name:string}; subpages: Map<string,string>}, options: NextjsOptions): Promise<void>` (never throws); `runToNextjs(exportDir: string, options: NextjsOptions): Promise<number>` (returns the exit code).
- `model.ts` field definitions:
  - `RawNode { key; tag; attrs: Record<string,string>; framerName?; text?; box:{x;y;w;h}; styles: Style; visible: boolean; scrollSamples?: Style[]; children: RawNode[] }`
  - `Node { id; key; tag; framerName?; text?; attrs; styles: {base: Style; tablet?: Style; mobile?: Style}; hover?: Style; animation?: AnimationSpec; motion?: MotionSpec; asset?: {kind:'image'|'video'|'svg'; src:string; width:number; height:number}; visibility?: Breakpoint[]; children: Node[] }`
  - `AnimationSpec { kind:'reveal'|'split-text'; from: {opacity?:number; x?:number; y?:number; scale?:number; rotate?:number} }`
  - `MotionSpec { kind:'reveal'|'split-text'|'smooth-scroll'|'cursor'|'loader'|'scroll'; from?: AnimationSpec['from']; scroll?: {property:string; values:string[]}[] }`
  - `PageModel { route; sourceUrl; title; meta: Record<string,string>; root: Node; screenshots: Record<Breakpoint,string> }`
  - `ConversionContext { exportDir; sourceUrl; outDir; cacheDir; options: NextjsOptions; report: ConversionReport; log(msg:string):void }`
  - `nodeKey` format: ancestors joined by `/`, each segment `` `${tag}${framerName ? `[${framerName}]` : ''}:${index}` ``, where `index` is the element-sibling index. The same algorithm is re-implemented inside the browser in Task 3; the unit test pins the format.

- [ ] **Step 1: Add dependencies.** Run `npm install parse5 turndown pixelmatch pngjs` and `npm install -D @types/turndown @types/pngjs`. Add the script `"test:nextjs": "node --import tsx --test --test-concurrency=1 tests/integration-nextjs/*.test.ts"`.

- [ ] **Step 2: Write the failing tests**

```ts
// tests/unit/nextjs-options.test.ts
test('parseNextjsFlags consumes flags and leaves positional args', () => {
  const args = ['https://x.framer.website', 'out', '--nextjs', '--ai-refine', '--ai-provider', 'agy', '--ai-model', 'm1', '--no-verify'];
  const r = parseNextjsFlags(args);
  assert.deepEqual(args, ['https://x.framer.website', 'out']);
  assert.equal(r.enabled, true);
  assert.deepEqual(r.options, { aiRefine: true, aiProvider: 'agy', aiModel: 'm1', verify: false, cliSkipPermissions: true });
});
test('parseNextjsFlags defaults', () => {
  assert.deepEqual(parseNextjsFlags(['u']), { enabled: false, options: { aiRefine: false, verify: true, cliSkipPermissions: true } });
});
test('--ai-cli-skip-permissions false disables the skip flag', () => {
  assert.equal(parseNextjsFlags(['u', '--ai-cli-skip-permissions', 'false']).options.cliSkipPermissions, false);
});
test('unknown --ai-provider throws with the list of valid ids', () => {
  assert.throws(() => parseNextjsFlags(['u', '--ai-provider', 'nope']), /claude-code.*agy.*gemini/);
});
test('nodeKey format', () => {
  assert.equal(nodeKey([{ tag: 'div', framerName: 'Hero Section', index: 0 }, { tag: 'h1', index: 2 }]), 'div[Hero Section]:0/h1:2');
});
```

```ts
// tests/unit/nextjs-isolation.test.ts
test('no existing module statically imports src/nextjs', () => {
  // walk src/**/*.ts outside src/nextjs; assert no line matches /^import .*['"].*nextjs\//
});
test('runNextConversion skips non-framer platforms without throwing', async () => {
  // temp outDir; platform {name:'webflow'}; assert resolves and no outDir/nextjs created
});
test('runToNextjs returns 1 and writes nothing when export-report.json is missing', async () => {});
test('runToNextjs returns 1 when export-report.json platform is not framer', async () => {});
```

- [ ] **Step 3: Run the tests to verify they fail.** Run `node --import tsx --test tests/unit/nextjs-options.test.ts tests/unit/nextjs-isolation.test.ts`. Expected: FAIL (modules not found).

- [ ] **Step 4: Implement** `model.ts`, `options.ts` and `report.ts`, and a stub `index.ts`.
  - `runNextConversion` skips with `warn('Next.js conversion supports Framer sites only; skipped')` for other platforms. Otherwise, for now, it writes `nextjs/CONVERSION-REPORT.md` containing "pipeline not implemented".
  - `runToNextjs` validates `export-report.json` first.
  - Valid provider ids: `claude-code, agy, gemini, groq, openrouter, github, ollama, anthropic`.

- [ ] **Step 5: Wire the CLI and exporter.**
  - In `src/cli/index.ts`:
    - Add `if (args[0] === 'to-nextjs') { const { runToNextjs } = await import('../nextjs/index.js'); process.exit(await runToNextjs(path.resolve(args[1]), parseNextjsFlags(args.slice(2)).options)); }`. `parseNextjsFlags` comes from a lazy import of `../nextjs/options.js`.
    - Before `const url = args[0]`, call `parseNextjsFlags(args)` and pass the result to the exporter as `exporter.nextjs = enabled ? options : undefined`.
  - In `src/exporter/index.ts`:
    - Add `nextjs?: import('../nextjs/options.js').NextjsOptions;` to `FramerExporter`. It is a type-only import, erased at runtime.
    - After `await this.writeExportLog();` in the success path, add `if (this.nextjs) { const { runNextConversion } = await import('../nextjs/index.js'); await runNextConversion(this, this.nextjs); }`.
  - Add the new flags and the subcommand to `help.ts`.

- [ ] **Step 6: Run all checks.** Run `npm run typecheck && npm test && node --import tsx --test tests/unit/nextjs-*.test.ts`. Expected: all PASS. Existing tests are unchanged.

- [ ] **Step 7: Commit.** `git add -A && git commit -m "feat(nextjs): add opt-in flags, to-nextjs command and isolated conversion hook"`

---

### Task 2: Fixture site

**Files:**
- Create:
  - `tests/fixtures/nextjs/site/{index.html, about.html, blog.html, blog/post-a.html, blog/post-b.html}`
  - `tests/fixtures/nextjs/export/` (an export-like folder: `index.html`, `subpages/{about,blog,blog_post-a,blog_post-b}.html`, `export-report.json` with `"platform":"framer"`, `assets/fonts/Inter-Regular.latin.woff2` copied from `tests/fixtures/fonts/`, `assets/images/hero.png` as a tiny PNG)
  - `tests/fixtures/nextjs/serve.ts`
- Test: `tests/unit/nextjs-fixture.test.ts`

**Interfaces:**
- Produces: `serveFixture(root: string): Promise<{ url: string; close(): Promise<void> }>`, a static `node:http` server on port 0. The `export/` HTML files are copies of `site/` HTML, but with animation start states inline (export HTML is pre-hydration). Each subpage has `<link rel="canonical" href="<path>">`, which is the original URL path.
- Fixture content requirements (tests in later tasks rely on them):
  - Framer-style markup: `data-framer-name` on every element; a `<style>` block with `.hidden-abc{display:none!important}` inside `@media (max-width:809px)` and `.hidden-def` inside `@media (min-width:810px)`.
  - A "Hero Section" with an `<h1>` whose text includes `{curly} <tag> "quotes" & emoji 🚀`, and a desktop font-size of 72px that becomes 48px at mobile.
  - A "Logo + Menu" header and a "Footer" that are identical on all pages.
  - Three repeated "Card" items (same structure, different text and images).
  - Two sections both named "Content".
  - Colours `#133324`, `#a1dfc5` and `#ffffff1a` defined as `--token-*` custom properties.
  - `@font-face { font-family:"Inter Display"; src:url(../assets/fonts/Inter-Regular.latin.woff2); font-weight:400; unicode-range:U+0000-00FF }`.
  - In `export/`: one element with `style="opacity:0;transform:translateY(40px)"` and one per-letter `<span>` group with `style="display:inline-block;opacity:0.001;transform:translateX(40px) scale(0.9)"`.
  - A `data-framer-name="Smooth Scroll"` div and a `data-framer-cursor` attribute.
  - Blog posts share one template, with title, date, cover and a rich-text body (h2, p, ul, a, img).

- [ ] **Step 1:** Write a test asserting that `serveFixture` serves `index.html` with status 200, and that `export/export-report.json` parses with `platform === 'framer'`.
- [ ] **Step 2:** Run it to verify it fails. Run `node --import tsx --test tests/unit/nextjs-fixture.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Create the fixture files and `serve.ts`.
- [ ] **Step 4:** Run it to verify it passes. Expected: PASS.
- [ ] **Step 5:** Commit: `test(nextjs): add Framer-like fixture site and export`

---

### Task 3: Capture

**Files:**
- Create: `src/nextjs/capture.ts`
- Test: `tests/integration-nextjs/capture.test.ts`

**Interfaces:**
- Consumes: `RawNode`, `CAPTURE_WIDTHS`, `nodeKey` format (Task 1); `serveFixture` (Task 2).
- Produces:
  - `interface CapturedPage { route: string; url: string; title: string; meta: Record<string,string>; trees: Record<Breakpoint, RawNode>; hover: { key: string; style: Style }[]; screenshots: Record<Breakpoint,string> }`
  - `STYLE_PROPS: readonly string[]`
  - `listExportPages(exportDir: string, sourceUrl: string): {route:string; url:string; exportHtml:string}[]`. Index plus `subpages/*.html`. The URL comes from each subpage's `<link rel="canonical">`, falling back to the filename with `_`→`/`. Routes are URL paths (`/`, `/blog/post-a`).
  - `capturePages(pages, ctx: ConversionContext): Promise<{ captured: CapturedPage[]; failed: {route:string; error:string}[] }>`
- Behaviour:
  - Uses one browser for every page. For each page and width:
    1. Reuse `applyStealth` from `src/exporter/capture.ts`. Importing it from inside `src/nextjs` is allowed.
    2. `setViewport({width, height: 900})`, then `goto` with `waitUntil: 'networkidle2'` and a 30 s timeout.
    3. Wait for `#main` to have children (timeout 10 s).
    4. Scroll to the bottom in 600 px steps with 100 ms delay, then back to the top.
    5. Wait for `Promise.all(document.getAnimations().map(a => a.finished))`, capped at 5 s.
    6. Serialise.
  - Scroll samples: at base width only, record `transform` and `opacity` for each element at scrollY = 0, 50% and 100% of the scroll range.
  - `STYLE_PROPS` must include: `display, position, top, right, bottom, left, z-index, flex-direction, flex-wrap, justify-content, align-items, align-self, gap, row-gap, column-gap, grid-template-columns, grid-template-rows, width, height, min-width, max-width, min-height, max-height, padding-*, margin-*, font-family, font-size, font-weight, font-style, line-height, letter-spacing, text-align, text-transform, text-decoration-line, white-space, color, background-color, background-image, border-*-width, border-*-style, border-*-color, border-*-radius, box-shadow, opacity, transform, overflow-x, overflow-y, object-fit, object-position, aspect-ratio, filter, backdrop-filter, mix-blend-mode, clip-path, mask-image`.
  - Values equal to the element's default for that tag are dropped. Compute defaults once per tag in a hidden iframe.
  - `visible = display !== 'none' && visibility !== 'hidden' && box.w*box.h > 0`. Invisible subtrees are kept but not descended into.
  - Hover: walk `document.styleSheets` rules (including nested `@media` rules) whose `selectorText` contains `:hover`. Strip `:hover`, run `querySelectorAll` on the remainder, and record the declarations by node key.
  - Each page retries once on failure, then is added to `failed`.
  - Screenshots are full-page PNGs at `cacheDir/screens/<route-slug>-<bp>.png`.
  - The `captured` result is written to `cacheDir/capture.json`.

- [ ] **Step 1: Write failing tests** (serving `tests/fixtures/nextjs/site/`):
  - `capturePages returns three trees whose base tree has an h1 with font-size "72px" and mobile tree "48px"`
  - `nodes inside .hidden-abc are visible:false in the mobile tree and visible:true in base`
  - `keys are stable across widths for the same element (same nodeKey)`
  - `hover rules are attached by key`
  - `screenshots exist for 3 breakpoints`
  - `a page returning 404 is reported in failed and does not stop other pages`. Add a fake route that 404s.
- [ ] **Step 2: Run them to verify they fail.** Run `node --import tsx --test tests/integration-nextjs/capture.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `capture.ts` as specified.
- [ ] **Step 4: Run them to verify they pass.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(nextjs): capture rendered DOM and computed styles at three widths`

---

### Task 4: Animation start states

**Files:**
- Create: `src/nextjs/framer/animations.ts`
- Test: `tests/unit/nextjs-animations.test.ts`

**Interfaces:**
- Consumes: `nodeKey`, `AnimationSpec`.
- Produces:
  - `parseTransform(t: string): {x?:number; y?:number; scale?:number; rotate?:number}`. Handles `translate(…)`, `translateX/Y`, `scale`, `rotate` and `matrix(a,b,c,d,e,f)`. Identity components are omitted.
  - `extractStartStates(exportHtml: string): Map<string, AnimationSpec>`. Uses parse5 and computes keys with the same `nodeKey` rules as Task 1. An element has a start state when inline `opacity < 1` or `parseTransform` returns non-identity values.
  - Kind is `split-text` when three or more consecutive sibling `span`s have `display:inline-block` and start states. The spec goes on their parent, and the children are not returned individually. Otherwise the kind is `reveal`.
  - `opacity:0.001` is treated as `0`.

- [ ] **Step 1: Write failing tests:**
  - `parseTransform("translateX(40px) translateY(0px) scale(0.9) rotate(0deg)")` deep-equals `{x:40, scale:0.9}`
  - `parseTransform("translate(-50%, -50%)")` returns `{}`. Percent translate is layout positioning, not animation. Only px values count.
  - `extractStartStates` on fixture `export/index.html` gives a `reveal` with `{opacity:0, y:40}` for the fixture element, and one `split-text` entry on the span group's parent with `{opacity:0, x:40, scale:0.9}`.
- [ ] **Step 2: Run them to verify they fail.** Run `node --import tsx --test tests/unit/nextjs-animations.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them to verify they pass.**
- [ ] **Step 5: Commit:** `feat(nextjs): extract appear and split-text start states`

---

### Task 5: Breakpoint merge

**Files:**
- Create: `src/nextjs/framer/breakpoints.ts`
- Test: `tests/unit/nextjs-breakpoints.test.ts`

**Interfaces:**
- Consumes: `RawNode`, `Node`, `CapturedPage` (Task 3); `AnimationSpec` map (Task 4).
- Produces: `mergeBreakpoints(page: CapturedPage, starts: Map<string,AnimationSpec>, report: ConversionReport): Node`.
- Algorithm:
  1. Prune each tree to visible nodes.
  2. Merge recursively from the base tree. At each level, align the tablet and mobile child lists with the base children using an LCS, where two nodes match when `tag` and `framerName` are equal (or `tag` and same text when both lack a name).
  3. Matched nodes: `styles.base` = base styles, and `styles.tablet`/`styles.mobile` hold only the properties whose value differs from the previous breakpoint's effective value.
  4. Unmatched nodes are kept in document order. `visibility` lists the breakpoints where they appear, and each is recorded in `report.keptDuplicates`.
  5. Wrapper elements that exist only to carry `hidden-*` classes (single child, no own visual styles) are collapsed into their child.
  6. Attach `animation` from `starts` by `key`, and `hover` from `page.hover`.
  7. `asset` is set for `img` (src from `currentSrc`, captured `naturalWidth/Height` in attrs), `video` and inline `svg`.

- [ ] **Step 1: Write failing tests** using small hand-built `RawNode` trees:
  - `h1 present at all widths becomes one node with base font-size 72px and mobile font-size 48px, no tablet entry`
  - `a nav visible only at base and a burger visible only at mobile are both kept with visibility ['base'] and ['mobile'] and reported`
  - `hidden-* wrapper with one child is collapsed`
  - `start state attaches by key`
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them to verify they pass.**
- [ ] **Step 5: Commit:** `feat(nextjs): merge Framer breakpoint variants into one tree`

---

### Task 6: Theme tokens

**Files:**
- Create: `src/nextjs/tokens.ts`
- Test: `tests/unit/nextjs-tokens.test.ts`

**Interfaces:**
- Consumes: `Node`.
- Produces:
  - `interface ThemeTokens { colors: Record<string,string>; fonts: Record<string,string>; radii: Record<string,string>; shadows: Record<string,string>; colorByValue: Map<string,string>; fontByFamily: Map<string,string>; radiusByValue: Map<string,string>; shadowByValue: Map<string,string> }`
  - `normalizeColor(css: string): string`, returning lowercase `#rrggbb` or `#rrggbbaa`
  - `nameColor(hex: string): string`
  - `collectTokens(roots: Node[]): ThemeTokens`
- Colour naming:
  - Saturation < 10% → `neutral`. Otherwise the hue family is: `red` [345,360)∪[0,15), `orange` [15,40), `yellow` [40,65), `green` [65,170), `cyan` [170,200), `blue` [200,250), `purple` [250,290), `pink` [290,345).
  - Pure `#ffffff` → `white`, pure `#000000` → `black`.
  - Step = `clamp(round((1 - L) * 10) * 100, 50, 950)`, where L is HSL lightness 0–1 and 0 maps to 50.
  - Alpha < 1 appends `-a<round(alpha*100)>`.
  - Collisions append `-2`, `-3` in order of first appearance.
- Fonts: family → `display` | `mono` | `script` | `body`. Families containing "Mono" → mono; "Script", "Hand" or "Me Again" → script; the family used by the most `h1–h3` nodes → display; the most common remaining family → body. Others get kebab-case names.
- Radii and shadows used three or more times become `radius-<n>` and `shadow-<n>`, numbered by frequency.

- [ ] **Step 1: Write failing tests:**
  - `nameColor('#133324') === 'green-900'`
  - `nameColor('#a1dfc5') === 'green-300'`
  - `nameColor('#ffffff1a') === 'white-a10'`
  - `nameColor('#9a9da6') === 'neutral-400'`
  - `normalizeColor('rgb(19, 51, 36)') === '#133324'`
  - `collectTokens` on fixture-shaped nodes: three colours present; `fonts.display === '"Inter Display"'`; two distinct colours that both name to `green-900` give `green-900` and `green-900-2`
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them to verify they pass.**
- [ ] **Step 5: Commit:** `feat(nextjs): derive theme tokens with deterministic colour names`

---

### Task 7: Tailwind mapping

**Files:**
- Create: `src/nextjs/tailwind.ts`
- Test: `tests/unit/nextjs-tailwind.test.ts`

**Interfaces:**
- Consumes: `Node['styles']`, `ThemeTokens` (Task 6).
- Produces: `toTailwind(styles: Node['styles'], hover: Style | undefined, tokens: ThemeTokens): { classes: string[]; leftover: Partial<Record<Breakpoint | 'hover', Style>> }`.
- Rules:
  - Spacing: a px value v with `v % 4 === 0 && v/4 <= 96` uses the named scale (`gap-6`, `p-4`). Otherwise use an arbitrary value (`gap-[22px]`).
  - Font sizes use Tailwind defaults (xs 12, sm 14, base 16, lg 18, xl 20, 2xl 24, 3xl 30, 4xl 36, 5xl 48, 6xl 60, 7xl 72, 8xl 96, 9xl 128), else `text-[Npx]`.
  - Colours always map to tokens (`text-green-900`, `bg-white-a10`, `border-…`). Fonts map to `font-display`. Radii and shadows map to token classes when a token exists, else arbitrary values.
  - Prefixes: tablet overrides use `tablet:`, mobile overrides use `mobile:`, and hover uses `hover:`.
  - `visibility` arrays become `hidden` plus `tablet:block` / `mobile:block`, or the reverse.
  - Everything in the spec's "not converted" list (complex gradients, masks, `clip-path`, `filter`, `backdrop-filter`, `mix-blend-mode`, `transform` on non-animated nodes) goes to `leftover`.
- Output order is deterministic: layout, box, typography, colour, effects, then breakpoint prefixes in the order base, tablet, mobile, hover.

- [ ] **Step 1: Write failing tests:**
  - `{display:'flex','flex-direction':'column',gap:'24px'}` gives `['flex','flex-col','gap-6']`
  - `{width:'347px'}` gives `['w-[347px]']`
  - Colour `rgb(19, 51, 36)` with token `green-900` gives `text-green-900`
  - Base `font-size:72px` with mobile `48px` gives `['text-7xl','mobile:text-5xl']`
  - `clip-path` lands in `leftover.base`
  - Hover `background-color` gives a `hover:bg-…` class
  - The output never contains `#`
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them to verify they pass.**
- [ ] **Step 5: Commit:** `feat(nextjs): map computed styles to Tailwind classes with token colours`

---

### Task 8: Fonts

**Files:**
- Create: `src/nextjs/fonts.ts`
- Test: `tests/unit/nextjs-fonts.test.ts`

**Interfaces:**
- Produces:
  - `interface FontFace { family: string; weight: string; style: string; unicodeRange?: string; file: string }` (file is the basename in the export's `assets/fonts/`)
  - `extractFontFaces(exportHtmlFiles: string[]): FontFace[]`. Parses `@font-face` blocks in `<style>` tags, de-duplicates by (family, weight, style, unicodeRange, file), and ignores faces whose file is missing from `assets/fonts/`.
  - `renderFontsCss(faces: FontFace[]): string`. Rules are grouped by family with comments (`/* Inter Display */`), `src: url('/fonts/<file>') format('woff2')`, and `font-display: swap`.

- [ ] **Step 1: Write failing tests:**
  - Fixture export HTML gives one face `{family:'Inter Display', weight:'400', style:'normal', unicodeRange:'U+0000-00FF', file:'Inter-Regular.latin.woff2'}`
  - The same face in two files is returned once
  - `renderFontsCss` contains `url('/fonts/Inter-Regular.latin.woff2')`, `unicode-range: U+0000-00FF` and no `framerusercontent`
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them to verify they pass.**
- [ ] **Step 5: Commit:** `feat(nextjs): rebuild @font-face rules from exported fonts`

---

### Task 9: Names and component extraction

**Files:**
- Create: `src/nextjs/framer/names.ts`, `src/nextjs/components.ts`
- Test: `tests/unit/nextjs-names.test.ts`, `tests/unit/nextjs-components.test.ts`

**Interfaces:**
- Produces (`names.ts`):
  - `type Role = 'Image'|'Heading'|'Text'|'Button'|'List'|'Card'|'Group'`
  - `GENERIC_NAMES = ['Content','Frame','Text','Image','IMG','Container','Contain','Stack','Default','Variant 1','Wrapper','Desktop','Tablet','Mobile']`
  - `toPascal(s: string): string`. Strips non-alphanumerics, PascalCases, and prefixes `X` if it starts with a digit.
  - `toCamel(s: string): string`
  - `toSlug(s: string): string`. ASCII transliteration via `normalize('NFKD')`, lowercase, `-` separators, `item` when empty.
  - `roleOf(node: Node): Role`
  - `componentName(node: Node, sectionName: string): { name: string; fallback: boolean }`
  - `class NameRegistry { unique(name: string): string }` (adds `2`, `3`… suffixes)
- Produces (`components.ts`):
  - `structuralHash(node: Node): string`. Hashes tag, class list from `toTailwind` and child hashes. It ignores text, `asset.src` and link `href`.
  - `interface PropDef { name: string; kind: 'text'|'image'|'href' }`
  - `interface UiComponent { name: string; template: Node; props: PropDef[]; instances: { node: Node; values: Record<string, unknown> }[] }`
  - `interface Section { name: string; node: Node }`
  - `interface ComponentPlan { layout: { header?: Section; footer?: Section }; pages: { route: string; sections: Section[] }[]; ui: UiComponent[] }`
  - `planComponents(pages: PageModel[], tokens: ThemeTokens, report: ConversionReport): ComponentPlan`
- Rules:
  - Sections are the direct children of the page's main content root (`#main` → the first node with more than one child).
  - Header and footer: the first or last section whose `structuralHash` is equal on every page that has it, and present on at least 50% of pages, named `Header` / `Footer`.
  - UI components: a subtree with ≥ 2 nodes, appearing ≥ 2 times anywhere with the same hash, and not already a section. Props are the differing leaf text, image src and hrefs, named from the leaf's `framerName` via `toCamel`, else from the role (`title`, `image`, `href`), made unique per component.
  - Every fallback name is pushed to `report.fallbackNames`.

- [ ] **Step 1: Write failing tests:**
  - `toPascal('Hero Section') === 'HeroSection'`; `toPascal('Logo + Menu') === 'LogoMenu'`; `toPascal('20% Space') === 'X20Space'`
  - `toSlug('Ünïcode Post Title!') === 'unicode-post-title'`
  - `componentName` for "Hero Section" returns `{name:'Hero', fallback:false}`. The trailing words `Section` and `Container` are stripped.
  - `componentName` for a "Frame" image inside Hero returns `{name:'HeroImage', fallback:true}`
  - Two "Content" sections on one page get `Content` and `Content2` via `NameRegistry`, and both are reported as fallbacks
  - `planComponents` on fixture pages: header and footer detected; one UI component `Card` with 3 instances and props `['title','body','image']`, each instance holding its own text
  - `structuralHash` is equal for cards with different text and different for a card with an extra child
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them to verify they pass.**
- [ ] **Step 5: Commit:** `feat(nextjs): name sections and extract shared and repeated components`

---

### Task 10: Content extraction

**Files:**
- Create: `src/nextjs/content.ts`
- Test: `tests/unit/nextjs-content.test.ts`

**Interfaces:**
- Consumes: `ComponentPlan` (Task 9).
- Produces:
  - `interface ContentFile { module: string /* e.g. "home" */; typeName: string /* "HomeContent" */; data: Record<string, unknown> }`
  - `interface ContentBindings { textPath: Map<string /*node id*/, string /*e.g. "hero.title"*/> }`
  - `extractContent(plan: ComponentPlan, report: ConversionReport): { files: ContentFile[]; bindings: ContentBindings }`
- Rules:
  - One file per route (module from the route, `home` for `/`) plus `layout` for header and footer.
  - Keys follow `section.camelName.leafKey`. Leaf keys come from `framerName` via `toCamel`, else the role, made unique within the section.
  - UI component instances become arrays: `hero.cards = [{title, body, image}, …]`.
  - Images become `{ src: '/images/<file>', alt, width, height }`. Links become `{ label, href }`.
  - Text with no letters or digits (decorative glyphs) stays in JSX and is recorded in `report.textExceptions`.

- [ ] **Step 1: Write failing tests:**
  - Fixture plan gives `files.map(f => f.module)` = `['home','about','blog','layout']`. Blog items are excluded; they are handled in Task 11.
  - `home.data.hero.title` equals the fixture h1 text exactly, including `{curly} <tag> "quotes" & emoji 🚀`
  - `home.data.cards.length === 3`
  - Every node id in `bindings` resolves to a path that exists in its file
  - A `"→"`-only text node is reported as a text exception
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them to verify they pass.**
- [ ] **Step 5: Commit:** `feat(nextjs): extract page text, links and images into typed content`

---

### Task 11: Collections → MDX

**Files:**
- Create: `src/nextjs/framer/collections.ts`
- Test: `tests/unit/nextjs-collections.test.ts`

**Interfaces:**
- Consumes: `PageModel[]`, `structuralHash`, `toSlug`, `toCamel`.
- Produces:
  - `interface Collection { name: string /* "blog" */; dir: string /* "blog" or "case-studies" */; indexRoute: string; itemRoutes: string[]; templateRoot: Node; fields: { key: string; kind: 'text'|'date'|'image'|'tags' }[] }`
  - `detectCollections(pages: PageModel[]): Collection[]`
  - `itemToMdx(page: PageModel, c: Collection): { slug: string; metadata: Record<string, unknown>; body: string; file: string }`
  - `collectionRoutes(cs: Collection[]): Set<string>` (routes that the regular page pipeline must skip)
- Rules:
  - A collection exists when at least 2 routes share a first path segment, the segment's index route exists, and their top-level sections' structural hashes match in ≥ 80% of sections.
  - `dir` is the plural kebab-case of the segment (`case-study` → `case-studies`, `blog` → `blog`).
  - Fields are nodes in the template whose text or src differs across items, excluding the body.
  - The body node is the descendant containing the most `p`/`h2`/`h3`/`li` nodes. It is converted with turndown (ATX headings, `-` bullets) after its images are rewritten to `/images/<file>`.
  - Dates matching `/\b\d{1,2} \w+ \d{4}\b|\b\w+ \d{1,2}, \d{4}\b/` are stored as ISO strings.
  - Slugs come from the URL's last segment via `toSlug`, de-duplicated.
  - The file starts with `export const metadata = {…}` (JSON-serialised values), a blank line, then the body.
  - MDX-unsafe characters in body text (`{`, `}`, `<` that is not a tag) are escaped with `\`.

- [ ] **Step 1: Write failing tests:**
  - Fixture pages give one collection `blog` with `itemRoutes ['/blog/post-a','/blog/post-b']`
  - `itemToMdx` gives `metadata.title` equal to the post title, an ISO `date`, a `cover` of `/images/…`, and a body containing `## ` and `- ` lines and a link
  - A body containing `{x}` is escaped as `\{x\}`
  - Slugs `post-a` and `post-a` collide and become `post-a` and `post-a-2`
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them to verify they pass.**
- [ ] **Step 5: Commit:** `feat(nextjs): convert CMS collections to MDX`

---

### Task 12: JSX renderer and motion mapping

**Files:**
- Create: `src/nextjs/emit/jsx.ts`, `src/nextjs/framer/motion-map.ts`
- Test: `tests/unit/nextjs-jsx.test.ts`, `tests/unit/nextjs-motion-map.test.ts`

**Interfaces:**
- Consumes: `Node`, `toTailwind`, `ThemeTokens`, `ContentBindings`, `UiComponent`.
- Produces (`motion-map.ts`):
  - `attachMotion(root: Node): Node`. Sets `node.motion`:
    - `smooth-scroll` for `framerName === 'Smooth Scroll'` (the node itself is dropped from rendering)
    - `cursor` when `attrs['data-framer-cursor']` exists
    - `loader` for `framerName === 'Loader'`
    - `split-text` / `reveal` copied from `animation`
    - `scroll` when the node's `scrollSamples` show `transform` or `opacity` changing across samples, with the values listed
  - `motionUsage(root: Node): Set<MotionSpec['kind']>`
- Produces (`jsx.ts`):
  - `escapeJsxText(s: string): string`. Returns `{"…"}` string-literal form when the text contains any of `{}<>` or a backtick, else plain text with `&` left as is.
  - `renderNode(node: Node, ctx: JsxContext): string`
  - `interface JsxContext { tokens: ThemeTokens; bindings: ContentBindings; contentVar: string; components: Map<string /*node id*/, { name: string; propsExpr: string }>; cssModule?: { importName: string; classFor(node: Node): string | undefined }; imports: Set<string>; siteOrigin: string }`
- Rendering rules:
  - `class` → `className` (Tailwind classes plus an optional CSS-module class); `for` → `htmlFor`; SVG attributes camelCased.
  - `data-framer-*`, `framer-*` classes and inline `style` are never emitted.
  - Bound text renders as `{content.hero.title}`.
  - `img` → `<Image src={…} alt={…} width={…} height={…} />` and adds the import `next/image`.
  - `a` with a same-origin href → `<Link href="/about">` (adds `next/link`); others stay as `<a … target/rel kept>`.
  - `motion.reveal` wraps the element as `<Reveal from={{…}}>…</Reveal>`; `split-text` renders `<SplitText text={…} from={{…}} />`; `scroll` wraps in `<ScrollEffect values={…}>`. Each adds its import from `@/components/motion/…`.
  - Nodes with an entry in `components` render as `<Name {...propsExpr} />`.

- [ ] **Step 1: Write failing tests:**
  - `escapeJsxText('a {b} <c> "d" 🚀')` returns `'{"a {b} <c> \\"d\\" 🚀"}'`; `escapeJsxText('plain')` returns `'plain'`
  - Rendering a bound h1 gives `<h1 className="text-7xl mobile:text-5xl …">{content.hero.title}</h1>`
  - Rendering an img adds `next/image` to `imports` and outputs `<Image`
  - A same-origin link renders `<Link href="/about">`; an external one keeps `<a href="https://…">`
  - The output never contains `data-framer`, `framer-` or `style=`
  - `attachMotion` on fixture nodes gives a reveal node wrapped in `<Reveal from={{ opacity: 0, y: 40 }}>`, the split-text group as `<SplitText`, and `motionUsage` including `smooth-scroll` and `cursor`
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them to verify they pass.**
- [ ] **Step 5: Commit:** `feat(nextjs): render nodes to clean JSX with motion wrappers`

---

### Task 13: Project emitter, templates and versions

**Files:**
- Create: `src/nextjs/emit/project.ts`, `src/nextjs/emit/templates.ts`, `src/nextjs/versions.ts`, `scripts/update-nextjs-versions.ts`
- Test: `tests/unit/nextjs-project.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 6–12.
- Produces:
  - `NEXT_PROJECT_VERSIONS: { dependencies: Record<string,string>; devDependencies: Record<string,string> }`
    - dependencies: `next`, `react`, `react-dom`, `motion`, `gsap`, `lenis`, `@next/mdx`, `@mdx-js/loader`, `@mdx-js/react`
    - devDependencies: `typescript`, `@types/node`, `@types/react`, `@types/react-dom`, `tailwindcss`, `@tailwindcss/postcss`, `eslint`, `eslint-config-next`, `prettier`, `prettier-plugin-tailwindcss`, `@types/mdx`
    - Exact versions are filled in at implementation time from `npm view <pkg> version`. Expected majors: next 16, react 19, tailwindcss 4, motion 12, gsap 3, lenis 1.
  - `interface ProjectModel { tokens: ThemeTokens; fonts: FontFace[]; plan: ComponentPlan; content: ContentFile[]; bindings: ContentBindings; collections: { c: Collection; items: ReturnType<typeof itemToMdx>[] }[]; pages: PageModel[]; motion: Set<MotionSpec['kind']>; assets: { from: string; to: string }[]; leftovers: Map<string /*component*/, string /*css*/> }`
  - `writeProject(dir: string, project: ProjectModel): Promise<void>`
- Templates: `motion/config.ts`, `Reveal.tsx`, `SplitText.tsx`, `ScrollEffect.tsx`, `SmoothScroll.tsx` (Lenis + `gsap.ticker` sync with ScrollTrigger), `Cursor.tsx`, `Loader.tsx`, `useScrollAnimation.ts`.
  - Every motion component starts with `'use client'` and checks `useReducedMotion()` (motion) or `matchMedia('(prefers-reduced-motion: reduce)')` (GSAP and Lenis).
  - `config.ts` exports `{ duration: 0.6, ease: 'easeOut', letterStagger: 0.03 }`.
- Written files, matching spec section 10:
  - `globals.css`: `@import "tailwindcss"; @import "./fonts.css";`, the two `@custom-variant`s, then `@theme { --color-*; --font-*; --radius-*; --shadow-* }`.
  - `app/layout.tsx`: wraps children in `<SmoothScroll>` when used and renders `<Header/>`, `<Footer/>`, `<Cursor/>` and `<Loader/>` when used.
  - `app/<route>/page.tsx`: exports `metadata` from the captured title, description and OG tags.
  - Collection routes use `generateStaticParams` and `generateMetadata`; MDX is loaded with `await import(\`@/content/${dir}/${slug}.mdx\`)`.
  - `next.config.ts` uses `createMDX` with `pageExtensions` including `mdx`. Add `mdx-components.tsx`.
  - `README.md` explains where to edit content, colours, fonts and animation timing.
  - Only the motion templates that are actually used are written. Only used assets are copied (to `public/images` with readable names via `toSlug`(alt or component+role) plus extension, de-duplicated by `NameRegistry`). Fonts go to `public/fonts`.

- [ ] **Step 1: Write failing tests** (pure, writes to a temp dir from a hand-built minimal `ProjectModel`):
  - The written file list includes `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `app/fonts.css`, `content/home.ts`, `components/sections/Hero.tsx`, `package.json`, `README.md`
  - `package.json` dependencies equal `NEXT_PROJECT_VERSIONS.dependencies`
  - `globals.css` contains `@custom-variant mobile (@media (max-width: 809px));` and `--color-green-900: #133324;`
  - No file under `components/` matches `/#[0-9a-f]{3,8}\b/i`
  - No file under `app|components|content` contains `framer-`
  - `SmoothScroll.tsx` is absent when motion usage lacks `smooth-scroll`
  - Two images both named `hero` become `hero.png` and `hero-2.png`
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement**, including running `npm view` for each package to fill `versions.ts`. Write `scripts/update-nextjs-versions.ts` so it rewrites `versions.ts` from `npm view` and is runnable with `npx tsx scripts/update-nextjs-versions.ts`.
- [ ] **Step 4: Run them to verify they pass.**
- [ ] **Step 5: Commit:** `feat(nextjs): emit Next.js 16 + Tailwind v4 project with motion components`

---

### Task 14: Verification

**Files:**
- Create: `src/nextjs/verify.ts`, `tests/fixtures/nextjs/mini-next/` (a minimal Next 16 app with one static page whose HTML matches `tests/fixtures/nextjs/mini-next/static.html`)
- Test: `tests/unit/nextjs-verify.test.ts`, `tests/integration-nextjs/verify.test.ts`

**Interfaces:**
- Produces:
  - `compareScreenshots(a: string, b: string): number`. Uses pngjs and pixelmatch with threshold 0.1. When heights differ, the shorter image is padded with white and the score is `1 - diffPixels/totalPixels`.
  - `verifyProject(nextDir: string, exportDir: string, routes: string[], ctx: ConversionContext): Promise<void>`
- `verifyProject` steps:
  1. `npm install` and `npm run build`; on failure fill `report.build = {ok:false, output}` (last 200 lines) and return.
  2. `next start -p <free port>` and the export's `serve.js` with `PORT=<free port>`.
  3. Screenshot each route at the 3 widths, using the same scroll and animation-wait procedure as Task 3 (reuse a shared helper exported from `capture.ts`: `settlePage(page)`).
  4. Push the scores to `report.similarity`.
  5. Always kill both servers in `finally`.

- [ ] **Step 1: Write failing tests:**
  - Unit: two identical PNGs score `1`; a PNG with 10% of its pixels changed scores `≈0.9` (±0.01); a different-height pair does not throw
  - Integration: run on a tiny pre-written Next project fixture, `tests/fixtures/nextjs/mini-next/`, which is one static page and needs network for `npm install` (skip with `t.skip` when `process.env.CI_OFFLINE`). Assert `report.build.ok === true` and every similarity ≥ 0.97 against the same page served statically
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them to verify they pass.**
- [ ] **Step 5: Commit:** `feat(nextjs): build and screenshot-compare generated projects`

---

### Task 15: Orchestration (end-to-end, rule-based)

**Files:**
- Modify: `src/nextjs/index.ts` (replace the stub)
- Test: `tests/integration-nextjs/convert.test.ts`

**Interfaces:**
- Consumes: every module above.
- Produces: the final `runNextConversion` and `runToNextjs` (signatures from Task 1). Pipeline:
  1. `listExportPages`, then `capturePages`.
  2. For each captured page, inside its own try/catch: `extractStartStates`, `mergeBreakpoints`, `attachMotion` → `PageModel`. Failed pages get a placeholder `PageModel` that renders "This page could not be converted. See CONVERSION-REPORT.md" and is recorded in `report.pages`.
  3. `detectCollections` / `itemToMdx`, `collectTokens`, `extractFontFaces`, `planComponents`, `extractContent`.
  4. `writeProject` into `<export>/nextjs.tmp/`.
  5. `verifyProject` unless `--no-verify`.
  6. `runRefine` when `--ai-refine` (wired in Task 18; until then, log "not available").
  7. `renderReport` into `nextjs.tmp/CONVERSION-REPORT.md`.
  8. Remove the old `nextjs/` and rename `nextjs.tmp` → `nextjs`.

  On any thrown error before step 8: delete `nextjs.tmp`, keep the old `nextjs/` untouched, and write the report with `fatal` set to `<export>/nextjs-error-report.md`.

- [ ] **Step 1: Write failing tests** (`to-nextjs` on a temp copy of `tests/fixtures/nextjs/export/` with the source URL rewritten to the served fixture site):
  - Exit code 0, `nextjs/app/page.tsx`, `nextjs/app/about/page.tsx`, `nextjs/app/blog/[slug]/page.tsx`, `nextjs/content/blog/post-a.mdx` and `post-b.mdx` exist
  - `npm run build` succeeds inside `nextjs/` (done by verify; assert `report.build.ok`)
  - Similarity ≥ 0.97 for `/` and `/about` at all 3 widths
  - **Review Focus 1:** a fixture variant where one subpage URL returns 500 still exits 0; that route's page contains the placeholder text and the report lists it as failed
  - **Review Focus 2:** pre-create `nextjs/marker.txt`, force a crash by stubbing `writeProject` to throw via an env hook `FRAMER_NEXTJS_TEST_FAIL=emit`, then assert exit code 1, `nextjs/marker.txt` still exists, `nextjs.tmp` does not, and `nextjs-error-report.md` exists
  - The generated text for the fixture h1 renders the exact `{curly} <tag> "quotes" & emoji 🚀` string in the built HTML (Review Focus 3)
- [ ] **Step 2: Run them to verify they fail.** Run `npm run test:nextjs`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them to verify they pass.** Run `npm run test:nextjs`. Expected: PASS.
- [ ] **Step 5: Run the existing suites.** Run `npm run typecheck && npm test && npm run test:browser`. Expected: PASS.
- [ ] **Step 6: Commit:** `feat(nextjs): end-to-end rule-based conversion with safe output replacement`

---

### Task 16: LLM providers

**Files:**
- Create: `src/nextjs/refine/types.ts`, `refine/openai-compatible.ts`, `refine/anthropic.ts`, `refine/agent-cli.ts`, `refine/select.ts`
- Test: `tests/unit/nextjs-providers.test.ts`

**Interfaces:**
- Produces:
  - `type ProviderId = 'claude-code'|'agy'|'gemini'|'groq'|'openrouter'|'github'|'ollama'|'anthropic'`
  - `interface LlmRequest { system: string; user: string; images?: string[] /* file paths */; schema: object }`
  - `interface LlmProvider { id: ProviderId; model: string; supportsImages: boolean; rpm: number; complete(req: LlmRequest): Promise<string> }`
  - `class ProviderRateLimitError extends Error { retryAfterMs?: number }`, `class ProviderAuthError extends Error {}`
  - `createOpenAiCompatible(id, { baseUrl, apiKey?, model, supportsImages, rpm }, fetchImpl = fetch): LlmProvider`. POSTs to `${baseUrl}/chat/completions` with `response_format: { type: 'json_object' }` and images as base64 `image_url` parts when supported. 429 → `ProviderRateLimitError` (reads `retry-after`); 401/403 → `ProviderAuthError`.
  - `createAnthropic({ apiKey, model }, fetchImpl = fetch): LlmProvider` (Messages API, `x-api-key`, `anthropic-version: 2023-06-01`)
  - `createAgentCli(id: 'claude-code'|'agy', { model?, skipPermissions, sandboxRoot }, spawnImpl = spawn): LlmProvider`
    - For each call: create `sandboxRoot/sandbox-<n>/`, copy the images into it, write `prompt.md` (system + user + instruction to answer only with JSON matching the schema), spawn with `cwd` = the sandbox and the prompt on stdin, then parse JSON from stdout, then `rm -rf` the sandbox in `finally`.
    - `claude-code` argv: `['-p', '--output-format', 'json', ...(model ? ['--model', model] : [])]`. The result text is `JSON.parse(stdout).result`.
    - `agy` argv: `['-p', '--output-format', 'json', '--json-schema', <schema path in sandbox>, '--sandbox', '--print-timeout', '300s', ...(skipPermissions ? ['--dangerously-skip-permissions'] : []), ...(model ? ['--model', model] : [])]`. Confirm agy's JSON output field name while implementing (run `agy -p --output-format json "reply {\"ok\":true}"` once) and record it in a code comment.
  - `PROVIDER_DEFAULTS: Record<ProviderId, { baseUrl?: string; envKey?: string; model: string; supportsImages: boolean; rpm: number }>`. Fill in current free-tier models and RPM while implementing; check each provider's docs page and cite the URL in a comment.
  - `detectAvailable(env = process.env, probes = defaultProbes): Promise<ProviderId[]>`. claude-code/agy are available when `claude --version` / `agy --version` exit 0. API providers need their env key. ollama needs `GET http://localhost:11434/api/tags` to return 200.
  - `selectProvider(opts: NextjsOptions, available: ProviderId[]): ProviderId | null`. An explicit choice must be available, else throw with the reason. Otherwise take the first available in the auto order (anthropic is never auto-selected).

- [ ] **Step 1: Write failing tests** (no network; fake `fetchImpl` and `spawnImpl`):
  - `selectProvider` with available `['gemini','agy']` returns `agy`; with `['anthropic']` it returns `null`; explicit `groq` when unavailable throws `/GROQ_API_KEY/`
  - The OpenAI-compatible provider sends the `Authorization: Bearer` header, includes an image part only when `supportsImages`, maps a 429 with `retry-after: 3` to `ProviderRateLimitError` with `retryAfterMs === 3000`, and maps 401 to `ProviderAuthError`
  - The agy provider spawns with `cwd` inside `sandboxRoot`, has argv containing `--dangerously-skip-permissions` only when `skipPermissions`, and has argv containing `--sandbox` and `--json-schema`; the sandbox dir is removed after success **and** after a non-zero exit
  - The claude-code provider parses `{"result":"{\"edits\":[]}"}` into `'{"edits":[]}'`
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them to verify they pass.**
- [ ] **Step 5: Commit:** `feat(nextjs): add multi-provider LLM layer with sandboxed agent CLIs`

---

### Task 17: Edit lists, throttle and cache

**Files:**
- Create: `src/nextjs/refine/edits.ts`, `refine/throttle.ts`, `refine/cache.ts`
- Test: `tests/unit/nextjs-refine-core.test.ts`

**Interfaces:**
- Produces:
  - `type Edit = { op: 'renameComponent'; from: string; to: string } | { op: 'renameProp'; component: string; from: string; to: string } | { op: 'renameContentKey'; file: string; from: string; to: string } | { op: 'renameToken'; from: string; to: string } | { op: 'unwrap'; component: string; nodeId: string } | { op: 'extractComponent'; nodeIds: string[]; name: string }`
  - `EDIT_LIST_SCHEMA` (JSON Schema for `{ edits: Edit[] }`)
  - `parseEdits(raw: string): Edit[]`. Validates against the schema, rejects identifiers that fail `/^[A-Za-z][A-Za-z0-9]*$/` (tokens use `/^[a-z][a-z0-9-]*$/`), and throws `InvalidEditsError`.
  - `applyEdits(project: ProjectModel, edits: Edit[]): ProjectModel`. Returns a new model and never mutates the input.
    - `unwrap` is allowed only when the node has no classes from `toTailwind` and exactly one child.
    - `extractComponent` is allowed only when the nodes share a `structuralHash`.
    - Other edits that would change a class, text, asset or route throw `ForbiddenEditError`.
  - `class Throttle { constructor(rpm: number, now = Date.now, sleep = defaultSleep); run<T>(fn: () => Promise<T>): Promise<T> }`. Waits so calls are at least `60000/rpm` ms apart. On `ProviderRateLimitError` it retries up to 5 times with backoff `retryAfterMs ?? 2000 * 2^attempt`, then rethrows.
  - `class RefineCache { constructor(dir: string); key(sectionSource: string, provider: string, model: string): string /* sha256 */; get(key): Edit[] | undefined; set(key, edits: Edit[]): void }`

- [ ] **Step 1: Write failing tests:**
  - `parseEdits` accepts a valid rename, rejects `{"edits":[{"op":"setClass"}]}`, rejects the identifier `"9bad"`, and rejects non-JSON text
  - `applyEdits` with `renameComponent Hero→IntroHero` renames the plan section name and every reference, and leaves the input object deep-equal to its original
  - `renameToken green-900→ink` changes the tokens and every class `text-green-900` → `text-ink`
  - `unwrap` on a node with classes throws `ForbiddenEditError`
  - `Throttle` with rpm 60 and a fake clock spaces two calls by ≥ 1000 ms; three 429s then success resolves; six 429s rejects
  - `RefineCache` round-trips edits and has stable keys for identical inputs
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them to verify they pass.**
- [ ] **Step 5: Commit:** `feat(nextjs): add validated edit lists, rate limiting and resumable cache`

---

### Task 18: Refine pass and wiring

**Files:**
- Create: `src/nextjs/refine/index.ts`
- Modify: `src/nextjs/index.ts` (step 6 of the pipeline)
- Test: `tests/unit/nextjs-refine.test.ts`

**Interfaces:**
- Consumes: Tasks 13, 14, 16 and 17.
- Produces: `runRefine(project: ProjectModel, ctx: ConversionContext, deps = { provider?: LlmProvider; verify: (p: ProjectModel) => Promise<{ buildOk: boolean; minSimilarity: number }> }): Promise<ProjectModel>`
- Behaviour:
  1. Resolve the provider with `selectProvider`/`detectAvailable`, or use `deps.provider` (tests). If there is none, log and return the input unchanged.
  2. **Token naming:** the first request covers the token list and returns `renameToken` edits.
  3. **Shared components** (header, footer, UI components) go next, once each, then **page sections**.
  4. Each request contains: the section's rendered JSX, its content slice, a computed-style summary, the screenshot path (only when `supportsImages`), the allowed operations, and the instruction to return `{edits: []}` when nothing should change.
  5. Each response is cached by section key, then `applyEdits` runs on a candidate model, and `deps.verify(candidate)` runs (in production: re-emit into `nextjs.tmp`, then the build and screenshot comparison from Task 14 limited to affected routes). A candidate is accepted only when `buildOk && minSimilarity >= 0.97`; otherwise it is reverted and recorded in `report.refine.rejected`.
  6. `ProviderAuthError`, or a `ProviderRateLimitError` that exhausts retries, stops the loop. `report.refine.stoppedEarly` gets the reason and the run continues with what was accepted. A later `to-nextjs --ai-refine` resumes from the cache.
  7. Counts go to `report.refine.requests` and `report.refine.accepted`.

- [ ] **Step 1: Write failing tests** (fake provider + fake verify):
  - A fake provider returning a valid rename gives an accepted edit and a renamed component
  - When fake verify returns `minSimilarity: 0.9`, the edit is rejected and the model is unchanged
  - A fake provider throwing `ProviderAuthError` on the second call means the first edit is kept, `stoppedEarly` is set and no exception escapes
  - On a second run with the same inputs, cached sections make zero provider calls
  - Invalid JSON from the provider makes that section rejected with reason `invalid edits`, and the loop continues
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement**, then replace the "not available" log in `index.ts` with `project = await runRefine(project, ctx)` followed by a final re-emit and verify.
- [ ] **Step 4: Run them to verify they pass.** Run `node --import tsx --test tests/unit/nextjs-*.test.ts`.
- [ ] **Step 5: Commit:** `feat(nextjs): gated AI refine pass with resumable progress`

---

### Task 19: Documentation and acceptance on the real site

**Files:**
- Modify: `README.md` (new section "Convert a Framer site to Next.js", covering commands, providers and their env vars, what is approximated), `CHANGELOG.md` (Unreleased entry)
- Create: `docs/nextjs-acceptance.md`, recording the acceptance run results

- [ ] **Step 1: Run the full suites.** Run `npm run typecheck && npm test && npm run test:browser && npm run test:nextjs`. Expected: all PASS.
- [ ] **Step 2: Rule-based acceptance.** Run `npx tsx src/cli/index.ts https://nudge-folio.framer.website/ ./acceptance-nudge --subpages --nextjs`. Expected: exit 0. Then check the generated `CONVERSION-REPORT.md`:
  - the build passes
  - every one of the 19 routes is present (7 pages + 8 blog posts + 4 case studies)
  - `content/blog` has 8 `.mdx` files and `content/case-studies` has 4
  - similarity ≥ 0.97 at every width

  Run `grep -rE "framer-" acceptance-nudge/nextjs/{app,components,content}` and `grep -rEi "#[0-9a-f]{3,8}\b" acceptance-nudge/nextjs/components`. Both must print nothing.
- [ ] **Step 3: Refine acceptance.** Run `npx tsx src/cli/index.ts to-nextjs ./acceptance-nudge --ai-refine --ai-provider claude-code`, then the same with `--ai-provider agy`. Expected: exit 0, `report.refine.accepted > 0`, and the build and similarity still pass.
- [ ] **Step 4: Record results.** Copy the similarity tables, provider request counts and any pages below 0.97 into `docs/nextjs-acceptance.md`. Pages below the bar become follow-up issues; they are not silently accepted.
- [ ] **Step 5: Commit:** `docs(nextjs): document Framer to Next.js conversion and acceptance results`
