# AI guide parity report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run parity -- <route>` (run in `nextjs-app/`) writes `ai-guide/parity/<page>.md`: every layout, motion and interaction difference between the original Framer site and the rebuild at 1440, 1024 and 390, each pointing into the export.

**Architecture:** The converter writes three things next to `compare.mjs`: `scripts/parity-lib.mjs` (pure diff and report functions), `scripts/parity.mjs` (drives a headless browser over both sites and calls the lib) and `parity/sources.json` (per section: export pointers). `sections.json` gains the original page URL and each section's export root class, so original elements map to sections; the rebuild maps by `data-section`. The plan and AGENTS.md add a per-page "Parity" step that is done when the report is empty.

**Tech Stack:** TypeScript (converter), plain ES-module JavaScript templates (run in `nextjs-app/` with its puppeteer), Node test runner with tsx.

**Spec:** `docs/superpowers/specs/2026-11-13-ai-guide-parity-design.md`

## Global Constraints

- Generic for every Framer site; nothing specific to nudge-folio in code or tests.
- Script templates are `String.raw` strings without `${` or backticks (like `COMPARE_MJS`), so the written file is exactly the source; they import only Node built-ins, packages resolved from `nextjs-app/` (puppeteer, pngjs) and `./parity-lib.mjs`.
- Widths: 1440, 1024, 390 (viewport height 900), the same as `compare.mjs`.
- Layout tolerance 4px; motion start tolerance 100ms; at most 8 interaction targets per section; one page should finish in about 2 minutes.
- Exit code 0 always; problems are written into the report.
- Every reported item carries a pointer into the export (section folder, markup line, `styles.css`, `file @ offset`, override or `:hover` rule) when the guide has one.
- Random and clock-driven elements are never flagged; they are listed under "Cannot match".

## Review Focus

- The original site is unreachable or slow: the report says so for that width and the run still writes the rebuild's side; never a crash (Task 4 test).
- A section exists on one site only (not built yet, or hidden at a width): reported as "missing on the rebuild" / "only on the rebuild", not a crash or a cascade of layout deltas (Task 3 test).
- Text that differs only in case or spacing (CSS `uppercase`, split-letter spans, `&nbsp;`): matched as the same text (Task 3 test).
- Generated text (clocks, counters, `data-live`): never reported as a motion difference, listed under "Cannot match" (Task 3 test).
- Elements with zero size (the loader after it fades, `display:none` copies for other widths): ignored by layout and interaction checks (Task 3 test).

---

### Task 1: Original URL and section classes in `sections.json`

**Files:**
- Modify: `src/ai-guide/sections-json.ts`
- Modify: `src/ai-guide/index.ts` (the `sectionsJson(...)` call)
- Test: `tests/unit/ai-guide-sections-json.test.ts`

**Interfaces:**
- Produces: `SectionsJson[route] = { slug, url: string, sections: { id, name, className?: string, boxes, live, motion }[] }`; `sectionsJson(pages, liveBoxes, urlOf: (route: string) => string)`.

- [ ] **Step 1: Write the failing test** `sections.json gives the original page URL and each section's export class`: a page `/about` with a section `{ className: 'framer-abc' }` and `urlOf = (r) => 'https://site.framer.website' + r`; assert `json['/about'].url === 'https://site.framer.website/about'` and `json['/about'].sections[0].className === 'framer-abc'`; a section without a class has no `className` key.
- [ ] **Step 2: Run it:** `node --import tsx --test tests/unit/ai-guide-sections-json.test.ts` → FAIL (`url` undefined).
- [ ] **Step 3: Implement** the two fields; in `index.ts` pass `(route) => capturedBy.get(route)!.url`.
- [ ] **Step 4: Run it** → PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** `feat(ai-guide): original URL and section classes in sections.json`.

### Task 2: Export pointers per section (`parity/sources.json`)

**Files:**
- Create: `src/ai-guide/parity-sources.ts`
- Modify: `src/ai-guide/index.ts` (collect one entry per written section, write `ai-guide/parity/sources.json` after the page loop)
- Test: `tests/unit/ai-guide-parity-sources.test.ts`

**Interfaces:**
- Consumes: `SectionRefInput`-like data already in the page loop: `section`, `page`, section folder, `markup: MarkupCopy[] | Error`, `animations: ExportAnimation[] | Error`, `states: InteractionState[]`, `hoverClasses: string[]`.
- Produces: `interface SectionSources { folder: string; markup?: string; styles: string; animations: { label: string; kind: string; at: string }[]; hovers: { element: string; at: string }[] }`, `parityEntry(input: { folder: string; exportFile: string; markup: MarkupCopy[] | Error; animations: ExportAnimation[] | Error; states: InteractionState[]; hoverClasses: string[] }): SectionSources`, and the file shape `{ [route]: { [sectionId]: SectionSources } }`.

- [ ] **Step 1: Write the failing tests:**
  - `a section's pointers name its folder, markup line and styles`: `folder: 'ai-guide/pages/index/sections/02-about'`, markup at line 120 of `index.html` → `markup === 'index.html:120'`, `styles === 'ai-guide/pages/index/sections/02-about/styles.css'`.
  - `animations point at their setting or override source`: an `enter` animation on layer `Text` at `scripts/vendor/p.mjs` offset 977 → `{ label: 'Text', kind: 'enter', at: 'scripts/vendor/p.mjs @ 977' }`; an override `RotateLoop` → `kind: 'override RotateLoop'`; a text effect → `kind: 'text'`.
  - `hover classes point at the section's styles`: `hoverClasses: ['framer-x1']` → `hovers: [{ element: 'framer-x1', at: '<folder>/styles.css (:hover)' }]`; a recorded state adds `{ element, at: '<folder>/states/<before file>' }`.
  - `an extractor error gives no pointers instead of failing`: `markup: new Error()`, `animations: new Error()` → `markup` undefined, `animations: []`.
- [ ] **Step 2: Run them:** `node --import tsx --test tests/unit/ai-guide-parity-sources.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement `parityEntry`** and the write in `index.ts` (shell parts keyed under their owner route, like `sections.json`).
- [ ] **Step 4: Run them** → PASS; `npm test` still 1 known unrelated failure only (`bundled provider originals match their recorded source hashes`).
- [ ] **Step 5: Commit** `feat(ai-guide): export pointers per section for the parity report`.

### Task 3: Pure diff and report functions (`parity-lib.mjs`)

**Files:**
- Create: `src/ai-guide/templates/parity-lib.ts` (exports `PARITY_LIB_MJS`, a `String.raw` ES module)
- Test: `tests/unit/ai-guide-parity-lib.test.ts` (writes `PARITY_LIB_MJS` to a temp `.mjs` file and `import()`s it)

**Interfaces:**
- Produces (exports of `parity-lib.mjs`):
  - `normText(s: string): string` — lower case, whitespace and `&nbsp;` collapsed, invisible marks (`‎`) removed, first 60 chars.
  - `layoutDiffs(original: Box[], rebuild: Box[], tol = 4): LayoutDiff[]` with `Box = { id, top, height }` (zero-height boxes ignored) and `LayoutDiff = { id, kind: 'top'|'height'|'missing'|'extra', original?, rebuild?, delta?, inherited: boolean }`.
  - `groupLetters(raw: Moved[]): Moved[]` with `Moved = { section, name, text, parentText?, startMs, kinds: string[], live?: boolean }` — single-character movers of one parent become one item whose `text` is the parent text.
  - `motionDiffs(original: Moved[], rebuild: Moved[], tolMs = 100): { diffs: MotionDiff[]; cannotMatch: Moved[] }` with `MotionDiff = { section, kind: 'missing'|'extra'|'timing', label, originalMs?, rebuildMs? }`; matching by section, then `normText(text)`, then `name`; `live` items go to `cannotMatch`.
  - `interactionDiffs(original: Probe[], rebuild: Probe[]): InteractionDiff[]` with `Probe = { section, target, action: 'hover'|'press', changed: string[], image?: string }`; a target matches by section + `normText(target)`; flagged when the original changed something and the rebuild changed nothing or a different set.
  - `renderReport(page: string, result: { widths: { [w: string]: { layout: LayoutDiff[]; motion: MotionDiff[]; interaction: InteractionDiff[]; error?: string } }; cannotMatch: Moved[] }, sources: { [id: string]: SectionSources }): string`.

- [ ] **Step 1: Write the failing tests:**
  - `the first section whose top moved is the cause, the ones below inherit it`: original tops `[0, 900, 1800]`, rebuild `[0, 942, 1842]` → first diff `{ id: '02', kind: 'top', delta: 42, inherited: false }`, then `{ id: '03', delta: 42, inherited: true }`.
  - `differences within 4px are not reported`: deltas of 3 → `[]`.
  - `a section on one site only is missing or extra, not a cascade`: rebuild without `'02'` → one `{ id: '02', kind: 'missing' }`, no `top` diff for `'03'` caused by it.
  - `zero-height sections are ignored`.
  - `split letters become their text`: three movers `F`,`E`,`A` with `parentText: 'FEATURED'` → one item with `text: 'FEATURED'`.
  - `text that differs only in case and spacing matches`: original `'FEATURED  WORKS'` vs rebuild `'Featured works'` → no diff.
  - `an animation only on the original is missing; on the rebuild only, extra`.
  - `a start more than 100ms apart is a timing difference`: 1200ms vs 1350ms → `kind: 'timing'`; 1200 vs 1290 → none.
  - `generated text is never a difference`: `live: true` mover only on the original → no diff, listed in `cannotMatch`.
  - `a hover that changes something on the original but nothing on the rebuild is reported`: `changed: ['transform']` vs `[]` → one diff; equal sets → none.
  - `the report points each item into the export`: with `sources['02'] = { folder, markup: 'index.html:120', styles, animations: [{ label: 'Text', kind: 'enter', at: 'scripts/vendor/p.mjs @ 977' }], hovers: [] }`, a `missing` motion item labeled `Text` renders a line containing `scripts/vendor/p.mjs @ 977`; a layout item renders `styles` and `index.html:120`; a width with `error` renders `original not reachable`; the report ends with `## Cannot match`.
  - `the lib is self-contained valid JavaScript`: no `from './` or `from '../'`; `node --check` passes.
- [ ] **Step 2: Run them:** `node --import tsx --test tests/unit/ai-guide-parity-lib.test.ts` → FAIL.
- [ ] **Step 3: Implement** the functions in the template string.
- [ ] **Step 4: Run them** → PASS.
- [ ] **Step 5: Commit** `feat(ai-guide): parity diff and report functions`.

### Task 4: The parity script (`parity.mjs`) and its files in the guide

**Files:**
- Create: `src/ai-guide/templates/parity.ts` (exports `PARITY_MJS`)
- Modify: `src/ai-guide/index.ts` (write `scripts/parity.mjs`, `scripts/parity-lib.mjs`)
- Test: `tests/integration-nextjs/ai-guide-parity.test.ts`; `tests/unit/ai-guide-crops.test.ts` pattern for "valid JavaScript / route parsing"

**Interfaces:**
- Consumes: Task 1 `sections.json` (`url`, `className`), Task 2 `parity/sources.json`, Task 3 lib exports.
- Produces: CLI `node ../ai-guide/scripts/parity.mjs <route> [--base http://localhost:3000] [--original <url>]` (defaults: `--base` like compare, `--original` from `sections.json`); writes `ai-guide/parity/<slug>.md` and `ai-guide/parity/<slug>/<sectionId>-<n>.png` (original | rebuild); prints one count line per section.

Behaviour per width, on each site: a motion watcher installed before page scripts (same detection as `compare.mjs`: CSS animation/transition on transform or opacity, `element.animate`, inline transform/opacity changes; plus first-move time in ms and `parentText`), 6s load wait, scroll to the bottom in 150px steps every 120ms, 2s rest; then layout boxes (original: element with the section's `className`; rebuild: `[data-section]`), movers mapped to sections the same way (`data-live` → `live`), and up to 8 interaction probes per section (links, buttons, and the elements named in `sources.json` hovers): scroll into view, read computed `transform`, `background-color`, `color`, `box-shadow`, `opacity`, width and height of the target and its children, hover (and press for buttons), wait 400ms, read again; `changed` = the properties that differ. Probe images only for flagged items.

- [ ] **Step 1: Write the failing integration test** `parity lists exactly the gap, the missing animation and the missing hover, with pointers`: serve two fixture pages (`/orig` and `/` as the rebuild) with three sections each; the rebuild's section 02 has 40px more top margin, its section 03 card has no in-view fade, and its button has no hover color. Write a guide with `sections.json` (`url` = `<server>/orig`, classes on the original's sections) and a `parity/sources.json` with a pointer for each. Run `parity.mjs /`. Assert the report contains `02` top `+40` with the section's `styles.css`, `03` missing motion with its `@` pointer, the button hover difference, and nothing else under sections 01.
- [ ] **Step 2: Write the failing test** `an unreachable original is reported, not a crash`: `--original http://127.0.0.1:9/` → exit 0, report contains `original not reachable`.
- [ ] **Step 3: Run them:** `node --import tsx --test --test-concurrency=1 tests/integration-nextjs/ai-guide-parity.test.ts` → FAIL.
- [ ] **Step 4: Implement `PARITY_MJS`** and write both scripts in `index.ts`; add the unit checks "self-contained (imports only `./parity-lib.mjs`)" and "valid JavaScript" to `tests/unit/ai-guide-crops.test.ts`.
- [ ] **Step 5: Run them** → PASS; also `tests/integration-nextjs/ai-guide.test.ts` (the guide now contains `scripts/parity.mjs` and `parity/sources.json` — add both to its file assertions).
- [ ] **Step 6: Commit** `feat(ai-guide): parity script compares the original and the rebuild`.

### Task 5: The plan and rules use it

**Files:**
- Modify: `src/ai-guide/plan.ts`, `src/ai-guide/templates/agents.ts`, `src/ai-guide/templates/checklist.ts`, `src/ai-guide/templates/readme.ts`
- Test: `tests/unit/ai-guide-plan.test.ts`

**Interfaces:**
- Consumes: the CLI from Task 4.

- [ ] **Step 1: Write the failing tests:**
  - `setup adds the parity script`: plan contains `"parity": "node ../ai-guide/scripts/parity.mjs"`.
  - `each page task ends with a parity step before Verify`: in the Home task, a `**Step N: Parity**` line containing `` `npm run parity -- /` ``, `ai-guide/parity/index.md` and `empty`, and its number is one less than Verify's; collections run it for the list route and the first item.
  - `AGENTS.md and the checklist require an empty parity report`: both contain `npm run parity`.
- [ ] **Step 2: Run them:** `node --import tsx --test tests/unit/ai-guide-plan.test.ts` → FAIL.
- [ ] **Step 3: Implement** the steps and rule lines (README: one line on `ai-guide/parity/`).
- [ ] **Step 4: Run them** → PASS; `npm test` → only the known unrelated failure; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** `feat(ai-guide): pages are done when the parity report is empty`.

### Task 6: Real run on nudge-folio

**Files:**
- No code changes expected; any fix found goes back to the owning task's file with a test first.

- [ ] **Step 1: Regenerate the guide** (needs free memory; ask before starting): `npx tsx src/cli/index.ts ai-guide ../nudge-folio`. Expected: `plan.md` ticks kept, `scripts/parity.mjs`, `scripts/parity-lib.mjs`, `parity/sources.json` present. If the 1024 home screenshot shows the loader, restore it from `../nudge-folio-ai-guide.bak/pages/index/tablet.png`.
- [ ] **Step 2: Add the script** to `nudge-folio/nextjs-app/package.json` (`"parity": "node ../ai-guide/scripts/parity.mjs"`) on its `animations` branch.
- [ ] **Step 3: Run it** on all 9 routes against the running dev server. Expected: the reports list the known gaps from the motion audit (about note decorations, "it's me", "You", the home loader typing, the case-study CTA clover and comment, the services "I do" stars) with export pointers, plus any section top differences.
- [ ] **Step 4: Report** the counts per page to the user; fixing the site is a separate step they start.
- [ ] **Step 5: Commit** the converter (if anything changed) and push only when asked.
