# Section-Refactor Conversion Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace whole-page AI tasks and the strict export-vs-Next verify gate with per-section refactor tasks, optional fast checks against a generated baseline, bounded and pausable agent runs, and an informational final report.

**Architecture:** `generate` becomes a pipeline stage that writes one slimmed, annotated file per section plus a manifest (`.convert/analysis/generated.json`). The tasks stage turns the manifest into shell / section / page tasks. A runner (worker pool, agent processes with hard timeouts, scope revert, quota detection, run lock, pause and crash recovery) executes them against one `next dev` server; `fexport convert check` compares a section with its baseline in seconds. Finalize drops Framer CSS, builds, and writes an HTML report.

**Tech Stack:** Node ≥ 20, TypeScript (strict, ESM, `.js` import suffixes), puppeteer, pixelmatch, pngjs, @clack/prompts (via `src/cli-v2/ui/prompts.ts`), `node:test` + `tsx`.

**Spec:** `docs/superpowers/specs/2026-11-04-section-refactor-pipeline-design.md` (read it first; section numbers below refer to it).

## Global Constraints

- No new runtime dependencies; use puppeteer, pixelmatch, pngjs, @clack/prompts already in `package.json`.
- Every commit leaves `npm test` and `npm run typecheck` green. Integration tests: `node --import tsx --test --test-concurrency=1 tests/integration/<file>.test.ts`.
- Unit test files: `tests/unit/convert-<module>.test.ts`, style as in `tests/unit/convert-state.test.ts` (`node:test`, `node:assert/strict`, temp dirs from `fs.mkdtemp(path.join(os.tmpdir(), '<name> '))` — note the space, paths with spaces must work).
- Every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Widths: `[1440, 1000, 390]`. Breakpoints: `md` 810 px, `lg` 1200 px.
- Defaults: `testing: true`, `concurrency: 1`, `sectionTimeoutMin: 15`, `pageTimeoutMin: 15`, `pixelTolerance: 0.01`, `reportTolerance: 0.03`.
- Check pass: pixelmatch `threshold: 0.1`, `includeAA: false`, ratio ≤ `pixelTolerance`, `|heightDelta| ≤ 4`.
- Empty section: JSX < 1,000 bytes and no visible text, `img`, `svg`, `a` or `video`. Oversized section: JSX > 120,000 bytes after slimming.
- `check` call limit: 3 per task run; the 4th call prints `Limit reached: stop and finish; the pipeline will review this section.` and exits 2.
- Fixed capture clock: `FIXED_TIME = Date.UTC(2026, 0, 1, 12, 0, 0)`.
- Agents must never run `npm run build`, `next dev`, `next start` or `npm install`.
- Windows and POSIX: kill process trees with `taskkill /pid <pid> /T /F` on Windows, process-group signals elsewhere (reuse `src/convert/verify/proc.ts`).

## Execution Notes (pre-flight rulings — read before Task 1)

These resolve conflicts between tasks found before execution. They bind every task.

1. **Task 1 must not break the old pipeline loop.** The new `STAGES` order puts `install` after `scaffold`; the current `runPipeline` loop (`pipeline.ts`) would spin forever on a stage it does not run. Until Task 21 rewrites it, `runPipeline` marks `install`, `generate` and `baseline` as `skipped` when it reaches them and still stops after `tasks`. Keep the legacy `verify` key in `initState().stages` and `'needs-ai'` in `StageStatus` until Task 23. Update `KIND_ORDER` in `pipeline.ts` (and any other `Record` keyed by task kind or status) for the new union members so typecheck stays green.
2. **Task 6** may skip the optional integration-test extension; Task 8's integration test covers script-drawn detection end to end.
3. **Task 8** changes `runGenerate`'s return type: update the dashboard's generate action in `src/cli-v2/screens/convert-dashboard.ts` to show manifest counts (pages, sections, stubs) so typecheck stays green until Task 22 removes that action.
4. **Task 15** moves `detectAgents`, `pickBinaryLine` and the binary lookup into `runner/agent-process.ts`; `cli-v2/screens/convert-agent.ts` imports them from there until Task 22 deletes it, and existing tests import the new path.
5. **`fix-build` task (Task 20)** has no `fixOf`: it uses `pageTimeoutMin`, and its check is a production build — Task 21's default `check` dependency runs `npm run build` for `fix-build` and passes on exit code 0.
6. **Tests never launch real `agy` or `claude`.** Runner tests use `tests/fixtures/fake-agent.mjs` (Task 15) via `FEXPORT_AGENT_CMD`.
7. **Task 25 is run by the user** (real agents, real quota, manual pause and terminal kill); executors stop after Task 24.
8. **One task per agent session.** Start each task by reading this plan's Global Constraints, Execution Notes and Review Focus, then only that task's section; finish with `npm test` and `npm run typecheck` green and one commit.

## Review Focus

1. **Animation selectors recorded on the hydrated page do not match the static (JS-off) DOM** → the anchor is reported as unmatched (warning + task lists it by Framer name), generate never crashes. Test in Task 5.
2. **Section names that are not identifiers** (`"Hero + About"`, `"Chicago "`, `"section-1"`, duplicates, names starting with a digit) → unique valid component names, file names and task ids. Test in Task 3.
3. **User edits a finished section by hand while the run is paused** → resume restores only tasks that were `in-progress`; done tasks are never touched. Test in Task 17.
4. **The agent's `check` process and the pool writing state at the same time** → no lost updates: check counters live in `.convert/checks/<taskId>.json`, never in `state.json`. Test in Task 13.
5. **Dev server dies mid-run or its port is taken** → the next `check` starts a fresh server on a free port and updates `.convert/dev-server.json`. Test in Task 11.

---

## Phase A — Foundation

### Task 1: State v2, run options, migration

**Files:**
- Modify: `src/convert/types.ts`, `src/convert/state.ts`
- Create: `src/convert/state-migrate.ts`
- Test: `tests/unit/convert-state.test.ts` (extend), `tests/unit/convert-state-migrate.test.ts`

**Interfaces:**
- Produces (types.ts):
  - `TaskKind = 'shell' | 'section' | 'page' | 'fix' | 'component' | 'motion'` (last two legacy, removed in Task 23)
  - `TaskStatus = 'pending' | 'in-progress' | 'awaiting-fix' | 'done' | 'needs-review' | 'needs-human'` (`needs-human` legacy)
  - `TaskRecord` adds `section?: string`, `dependsOn?: string[]`, `fixOf?: string`
  - `StageName = 'analyze' | 'extract-cms' | 'scaffold' | 'install' | 'generate' | 'tasks' | 'baseline' | 'finalize' | 'verify'` (`verify` legacy); `StageStatus` adds `'skipped'`
  - `Box { x: number; y: number; width: number; height: number }` (shared by generate, check and report)
  - `AgentId = 'agy' | 'claude'`; `RunOptions { testing: boolean; agent: AgentId; concurrency: 1 | 2 | 3; sectionTimeoutMin: number; pageTimeoutMin: number; pixelTolerance: number; reportTolerance: number }`
  - `RunState { status: 'idle' | 'running' | 'paused' | 'done'; reason?: 'user' | 'quota' | 'crash'; quotaResetHint?: string; pausedAt?: string }`
  - `ConvertState.version: 1 | 2`, adds `options: RunOptions | null`, `run: RunState`, in-memory only `legacyTasks?: boolean`, `exportMissing?: boolean`
- Produces (state.ts): `DEFAULT_OPTIONS: Omit<RunOptions, 'agent'>`; `STAGES` = new order `['analyze','extract-cms','scaffold','install','generate','tasks','baseline','finalize']`; `nextStage` skips `done` and `skipped`; `saveState` writes the persisted form; `loadState` migrates.
- Produces (state-migrate.ts): `resolveExportDir(stored: string, nextDir: string): { dir: string; missing: boolean }`, `fromPersisted(raw: unknown, nextDir: string): ConvertState`, `toPersisted(state: ConvertState): object`.

- [ ] **Step 1: Write failing tests**

```ts
test('saveState stores exportDir relative to the project and no nextDir', async () => {
  const root = await tmp(); const next = path.join(root, 'site next'); const exp = path.join(root, 'site');
  await fs.mkdir(exp, { recursive: true });
  await saveState(initState(exp, next));
  const raw = JSON.parse(await fs.readFile(path.join(next, '.convert', 'state.json'), 'utf8'));
  assert.equal(raw.version, 2); assert.equal(raw.exportDir, '../site'); assert.equal('nextDir' in raw, false);
  const back = await loadState(next);
  assert.equal(back!.exportDir, exp); assert.equal(back!.nextDir, next);
  assert.deepEqual(back!.run, { status: 'idle' }); assert.equal(back!.options, null);
});
test('v1 state with a moved export folder resolves the sibling by basename', () => {
  // stored D:\ABDUL\...\out\portfolio, project now at <root>/out/portfolio-next, export at <root>/out/portfolio
  const r = resolveExportDir('D:\\ABDUL\\x\\out\\portfolio', path.join(root, 'out', 'portfolio-next'));
  assert.deepEqual(r, { dir: path.join(root, 'out', 'portfolio'), missing: false });
});
test('v1 state with tasks is flagged legacy; with none it is not', ...);  // fromPersisted({version:1, tasks:{'001-shell':{...}}}) → legacyTasks true
test('missing export folder sets exportMissing', ...);
test('DEFAULT_OPTIONS', () => assert.deepEqual(DEFAULT_OPTIONS, { testing: true, concurrency: 1, sectionTimeoutMin: 15, pageTimeoutMin: 15, pixelTolerance: 0.01, reportTolerance: 0.03 }));
test('nextStage treats skipped as finished', ...);  // baseline 'skipped' → returns 'finalize'
```

- [ ] **Step 2: Run** `node --import tsx --test tests/unit/convert-state.test.ts tests/unit/convert-state-migrate.test.ts` — expect FAIL (missing exports).
- [ ] **Step 3: Implement** the types and functions above. v1 stage mapping: keep `analyze`, `extract-cms`, `scaffold` statuses; every other v2 stage `pending`. `resolveExportDir`: stored relative → `path.resolve(nextDir, stored)`; absolute and exists → itself; else `path.join(path.dirname(nextDir), path.basename(stored))` (split the stored path on both `/` and `\`); else `{ dir: stored, missing: true }`. Keep `recordAttempt` until Task 23.
- [ ] **Step 4: Run** the two test files plus `npm test` and `npm run typecheck` — expect PASS (fix any existing test that asserted `STAGES` or `version: 1`).
- [ ] **Step 5: Commit** `feat(convert): state v2 with run options, relative paths and v1 migration`

### Task 2: Scaffold `agentRules: false` and install stage

**Files:**
- Modify: `src/convert/stages/scaffold/files.ts:277-279`
- Create: `src/convert/stages/install.ts`
- Test: `tests/unit/convert-scaffold.test.ts` (extend), `tests/unit/convert-install.test.ts`

**Interfaces:**
- Produces: `runInstall(ctx: StageContext, deps?: { npm?: (cwd: string) => Promise<{ code: number; tail: string }> }): Promise<void>` — sets `stages.install` to `done`, or to `failed` with warning `install: npm install failed (exit <code>)` followed by the tail.

- [ ] **Step 1: Failing tests**: generated `next.config.ts` contains `agentRules: false`; `runInstall` with a fake `npm` returning `{code:0}` sets `done`, `{code:1, tail:'E404'}` sets `failed` and pushes a warning containing `E404`.
- [ ] **Step 2: Run** `node --import tsx --test tests/unit/convert-scaffold.test.ts tests/unit/convert-install.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Default `npm` runs `npmCommand install` through `spawnManaged` in `ctx.nextDir`, keeping the last 20 stderr lines (same logic as `npmInstall` in `src/cli-v2/screens/convert-dashboard.ts`, which Task 22 deletes).
- [ ] **Step 4: Run** tests — PASS.
- [ ] **Step 5: Commit** `feat(convert): install stage; scaffold disables Next agent rules`

---

## Phase B — Generate

### Task 3: Names, token rewrite and breakpoint class map

**Files:**
- Create: `src/convert/generate/names.ts`, `src/convert/generate/slim.ts` (Node half), `src/convert/generate/annotate.ts` (Node half)
- Test: `tests/unit/convert-generate-names.test.ts`, `tests/unit/convert-generate-slim.test.ts`, `tests/unit/convert-generate-annotate.test.ts`

**Interfaces:**
- Produces:
  - `componentName(section: string, taken: Set<string>): string` (adds to `taken`)
  - `kebabName(section: string): string`
  - `rewriteTokens(jsx: string, tokenMap: Record<string, string>): string` → `var(--color-<kebab(name)>)` using `kebab` from `stages/scaffold/files.ts`
  - `type Breakpoint = 'desktop' | 'tablet' | 'phone'`
  - `hiddenClassMap(css: string, bp?: { md: number; lg: number }): Record<string, Breakpoint[]>`
  - `variantLabel(classes: string[], map: Record<string, Breakpoint[]>): string | null` (space-joined visible breakpoints in order desktop, tablet, phone; null when no class is in the map)

- [ ] **Step 1: Failing tests**

```ts
test('componentName makes unique PascalCase identifiers', () => {
  const t = new Set<string>();
  assert.equal(componentName('Hero + About', t), 'HeroAbout');
  assert.equal(componentName('section-1', t), 'Section1');
  assert.equal(componentName('Chicago ', t), 'Chicago');
  assert.equal(componentName('404 block', t), 'Section404Block');
  assert.equal(componentName('Hero + About', t), 'HeroAbout2');
  assert.equal(componentName('***', t), 'Section');
});
test('kebabName', () => { assert.equal(kebabName('Hero + About'), 'hero-about'); assert.equal(kebabName('Chicago '), 'chicago'); });
test('rewriteTokens', () => assert.equal(
  rewriteTokens('{"color":"var(--token-4f4e-12, rgb(17, 18, 18))"}', { '--token-4f4e-12': 'Ink Dark' }),
  '{"color":"var(--color-ink-dark)"}'));
test('rewriteTokens leaves unknown tokens', ...);
test('hiddenClassMap reads Framer breakpoint media queries', () => {
  const css = '@media (min-width: 1200px) { .hidden-a { display: none !important; } }' +
    '@media (min-width: 810px) and (max-width: 1199.98px) { .hidden-b { display: none !important; } }' +
    '@media (max-width: 809.98px) { .hidden-c, .hidden-d { display: none !important; } }';
  assert.deepEqual(hiddenClassMap(css), { 'hidden-a': ['desktop'], 'hidden-b': ['tablet'], 'hidden-c': ['phone'], 'hidden-d': ['phone'] });
});
test('variantLabel', () => {
  const m = { 'hidden-b': ['tablet'], 'hidden-c': ['phone'] } as const;
  assert.equal(variantLabel(['x', 'hidden-b', 'hidden-c'], m), 'desktop');
  assert.equal(variantLabel(['hidden-c'], m), 'desktop tablet');
  assert.equal(variantLabel(['x'], m), null);
});
```

- [ ] **Step 2: Run** the three files — FAIL.
- [ ] **Step 3: Implement.** `hiddenClassMap`: match `@media` blocks, classify by `min-width ≥ lg` → desktop, `max-width < md` → phone, both bounds inside → tablet; collect `.hidden-[\w-]+` selectors whose body sets `display: none`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(convert): section names, token rewrite and breakpoint class map`

### Task 4: Motion value decomposition

**Files:**
- Create: `src/convert/tasks/motion-values.ts`
- Test: `tests/unit/convert-motion-values.test.ts`

**Interfaces:**
- Produces: `decomposeTransform(value: string): { x: number; y: number; rotate: number; scaleX: number; scaleY: number; skewX: number } | null` (`none` → identity; `matrix(a,b,c,d,e,f)`; degrees rounded to 0.1, px and scale to 0.01); `describeMotion(entry: AnimationEntry): string` (e.g. `scroll, 1.3 s: opacity 0→1, scale 0.8→1, y 20px→0`, only changed components listed, `low confidence` suffix when `confidence === 'low'`).

- [ ] **Step 1: Failing tests**

```ts
test('rotation matrix', () => assert.deepEqual(
  decomposeTransform('matrix(0.984808, -0.173648, 0.173648, 0.984808, 0, 0)'),
  { x: 0, y: 0, rotate: -10, scaleX: 1, scaleY: 1, skewX: 0 }));
test('none is identity', ...);
test('describeMotion lists only changed parts', () => assert.equal(describeMotion({
  route: '/', selector: 's', trigger: 'scroll', durationMs: 1287, confidence: 'high',
  from: { opacity: '0', transform: 'matrix(0.8, 0, 0, 0.8, 0, 20)' }, to: { opacity: '1', transform: 'none' } }),
  'scroll, 1.3 s: opacity 0→1, scale 0.8→1, y 20px→0'));
test('scale-to-zero matrix (0,0,0,0,0,0) decomposes to scale 0', ...);
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** (standard 2D matrix decomposition: `scaleX = hypot(a,b)`, `rotate = atan2(b,a)`, `skewX` from `a*c+b*d`, `scaleY = (a*d-b*c)/scaleX`; guard `scaleX === 0`). **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(convert): decompose recorded transforms into readable motion values`

### Task 5: In-browser snapshot: annotate, slim, split per section

**Files:**
- Create: `src/convert/generate/snapshot.ts` (moves and extends `snapshotScript` from `generate/index.ts:72-96`)
- Modify: `src/convert/generate/slim.ts`, `src/convert/generate/annotate.ts` (add browser source strings)
- Test: `tests/integration/convert-snapshot.test.ts`

**Interfaces:**
- Consumes: `DOM_TO_JSX_SRC` (`generate/dom-to-jsx.ts`), `Breakpoint` map (Task 3).
- Produces:
  - `SLIM_SRC: string` — page-side function `slim(root: Element): number` (count of removed properties). For each element with inline style, remove each property; keep the removal only if every computed property of that element is unchanged; otherwise restore it.
  - `ANNOTATE_SRC: string` — page-side function applying `data-variant`, `data-motion`, `data-cms`, `data-script-drawn`.
  - `interface SnapshotPlan { sections: Array<{ name: string; selector: string }>; appear: Array<{ selector: string; opacity: string; transform: string }>; hiddenMap: Record<string, Breakpoint[]>; motion: Array<{ id: string; selector: string }>; cms: Array<{ field: string; value: string }>; components: Array<{ name: string; selector: string }>; scriptDrawn: Array<{ id: string; section: string; x: number; y: number }>; emptyBytes: number; oversizedBytes: number }`
  - `interface SnapshotSection { name: string; jsx: string; empty: boolean; parts: Array<{ name: string; jsx: string }>; motion: string[]; repeated: string[]; cmsFields: string[]; hasVariants: boolean }`
  - `interface SnapshotOut { css: string[]; viewJsx: string; sections: SnapshotSection[]; unmatchedMotion: string[]; slimmed: number }`
  - `snapshotScript(plan: SnapshotPlan): string` — order: apply appear states → mark `data-section` → annotate → slim `#main` → convert each non-empty section separately and replace it in `#main` with `<fexport-section data-name="<name>">` → convert `#main` to `viewJsx`. Oversized sections: direct children with `data-framer-name` become parts (replaced by `<fexport-part data-name>` placeholders). `repeated`: component names with ≥ 2 matches inside the section.

- [ ] **Step 1: Failing integration tests** (puppeteer, `page.setContent` with an inline `<style>`, JavaScript disabled):
  - `transform:none` inline on an element whose class sets `transform: rotate(5deg)` is **kept**; `transform:none` on a plain element is **removed**; `opacity:1` removed; `slimmed` equals the removed count.
  - Two sections → `viewJsx` contains exactly two `<fexport-section data-name=` placeholders in order; a section with only an empty `div` is `empty: true` and stays inline in `viewJsx`.
  - Element with class `hidden-c` (map `{hidden-c:['phone']}`) gets `data-variant="desktop tablet"`; section `hasVariants` true.
  - Motion selector that matches gets `data-motion="m1"`; one that matches nothing appears in `unmatchedMotion` (Review Focus 1) and nothing throws.
  - Text equal to a CMS value gets `data-cms="title"`; `cmsFields` lists `title`.
  - A section JSX larger than `oversizedBytes` (set to 200 in the test) returns two `parts` named after its `data-framer-name` children.
- [ ] **Step 2: Run** `node --import tsx --test --test-concurrency=1 tests/integration/convert-snapshot.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Keep all page-side code ES2020 inside `String.raw` like `DOM_TO_JSX_SRC`.
- [ ] **Step 4: Run** — PASS; also `npm test`.
- [ ] **Step 5: Commit** `feat(convert): snapshot annotates, slims and splits sections in the browser`

### Task 6: Script-drawn content detection

**Files:**
- Create: `src/convert/generate/script-drawn.ts`
- Test: `tests/unit/convert-script-drawn.test.ts`, extend `tests/integration/convert-snapshot.test.ts`

**Interfaces:**
- Produces:
  - `VISIBLE_ITEMS_SRC: string` — page-side `(sections) => Array<VisibleItem>` for every element with its own non-empty visible text node: `{ section: string; key: string /* tag path from the section root */; text: string; box: { x; y; width; height } }`
  - `interface ScriptDrawn { id: string; route: string; section: string; box: Box; sample: string; count: number; ticking: boolean }`
  - `diffScriptDrawn(route: string, live: VisibleItem[], still: VisibleItem[], liveLater: VisibleItem[]): ScriptDrawn[]` — items whose text appears in `live` but not in `still` for the same section, grouped by the parent of `key` (`count` = items in group, `sample` = joined texts truncated to 80 chars, `box` = union); `ticking` when the group's texts differ in `liveLater`; ids `s1…` in document order.

- [ ] **Step 1: Failing unit tests**: ruler (`0`,`100`,`200` live only, same parent) → one entry `count 3`, `sample '0 100 200'`, `ticking false`; clock `4:09:56 AM` live, `4:09:58 AM` later → `ticking true`; text present in both → no entry.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(convert): detect script-drawn content by live vs static comparison`

### Task 7: Shell section detection

**Files:**
- Create: `src/convert/generate/shell.ts`
- Test: `tests/unit/convert-shell.test.ts`

**Interfaces:**
- Produces: `interface ShellCandidate { name: string; pages: string[]; differences: string[] }`; `findShellSections(pages: Array<{ route: string; sections: Array<{ name: string; jsx: string }> }>): ShellCandidate[]` — a name on ≥ 2 pages whose JSX is identical, or identical after replacing text nodes and `href` / `src` / `alt` values with placeholders; `differences` lists `"<route>: <changed text or attribute value>"` (max 10). Excludes `section-<n>` and `page` names.

- [ ] **Step 1: Failing tests**: identical `Navigation` on `/` and `/about` → candidate, `differences: []`; nav differing only in an `href` → candidate with one difference line; structurally different `Footer` → none; `section-2` on two pages → none.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat(convert): detect sections shared across pages`

### Task 8: Generate stage writes sections, views, shell and manifest

**Files:**
- Modify: `src/convert/generate/index.ts`
- Create: `src/convert/generate/manifest.ts`
- Test: `tests/unit/convert-generate.test.ts` (update `patchPage` cases), `tests/integration/convert-generate-stage.test.ts`

**Interfaces:**
- Consumes: Tasks 3–7.
- Produces (manifest.ts):
  - `GeneratedSection { name; component; file /* posix, project-relative */; parts: Array<{ name; component; file }>; motion: string[]; scriptDrawn: string[]; hasVariants: boolean; repeated: string[]; cmsFields: string[] }`
  - `GeneratedPage { route; slug; view: string; dynamic?: { collection: string; firstSlug: string }; sections: GeneratedSection[]; inline: string[]; shell: string[] }`
  - `GeneratedShell { name; component; file; pages: string[]; differences: string[] }`
  - `MotionAnchor { id: string; route: string; section: string | null; entry: AnimationEntry; matched: boolean }`
  - `GeneratedManifest { version: 1; pages: GeneratedPage[]; shell: GeneratedShell[]; motion: MotionAnchor[]; scriptDrawn: ScriptDrawn[]; stubs: string[]; warnings: string[] }` — `stubs`: `"<route> · <section> · <iframe|form|code component data-framer-name>"` for every `iframe`, `form`, and `[data-code-component-plugin-id]` element whose static snapshot has no visible content (markup is kept as is; the list feeds the report and the section task text "placeholder: needs a real implementation or removal").
  - `readManifest(nextDir: string): Promise<GeneratedManifest | null>`, `writeManifest(nextDir: string, m: GeneratedManifest): Promise<void>` (`.convert/analysis/generated.json`)
- Produces (index.ts): `runGenerate(ctx: StageContext): Promise<GeneratedManifest>`; sets `stages.generate = 'done'`.
- Layout written: `src/sections/<slug>/<Component>.tsx` (default export, root keeps `data-section`, accepts `{ item?: any }`), parts in `src/sections/<slug>/<Component>/<Part>.tsx`, shell in `src/components/shell/<Component>.tsx`, view `src/views/<slug>.tsx` rendering wrappers + `<Component item={item} />` per placeholder. Static page file: `return <View />`. Dynamic page file (scaffold already finds `item`): `return <View item={item} />`, and only the first CMS item is snapshotted. Every generated file starts with `FILE_HEADER`.

- [ ] **Step 1: Failing tests.** Unit: `patchPage` dynamic body becomes `return <View item={item} />;`. Integration on `tests/fixtures/framer-nudge-mini` (copy to a temp dir with a space; run analyze → extract-cms → scaffold → generate, no npm install):
  - every manifest section `file` exists and contains `data-section="<name>"`;
  - the view imports its section components in manifest order and contains no `fexport-section`;
  - a dynamic route (`/blog/[slug]`) has exactly one view and its page file contains `<View item={item} />`;
  - `inline` lists empty sections and no file exists for them;
  - manifest `motion` entries have ids `m1…` and `matched` booleans; unmatched ones produce a `generate: motion anchor not found` warning;
  - generated JSX contains no `var(--token-`;
  - a fixture page with an added empty `<iframe>` lists it in `stubs`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** Per page: live load (appear states, visible items, second visible items 2 s later) → static load (visible items) → `diffScriptDrawn` → `snapshotScript(plan)` → `rewriteTokens` + existing `rewriteAssets`/`rewriteLinks` → collect. After all pages: `findShellSections`, write shell components once (first instance) and make other pages' views import them, write sections, views, page patches, manifest. Remove the component-slice generation path (component-first mode).
- [ ] **Step 4: Run** integration + `npm test` — PASS.
- [ ] **Step 5: Commit** `feat(convert): generate writes per-section files, shell components and a manifest`

---

## Phase C — Tasks

### Task 9: Task kinds, templates, rules and prompt

**Files:**
- Modify: `src/convert/stages/tasks.ts` (rewrite `runTasks`), `src/convert/tasks/templates/index.ts`
- Create: `src/convert/runner/prompt.ts`
- Test: `tests/unit/convert-tasks.test.ts` (rewrite), `tests/unit/convert-prompt.test.ts`

**Interfaces:**
- Consumes: `GeneratedManifest` (Task 8), `describeMotion` (Task 4).
- Produces:
  - `runTasks(ctx: StageContext): Promise<TaskRecord[]>` — creates records, calls `renderTaskFiles`, sets `stages.tasks = 'done'`; keeps status/attempts of existing ids.
  - `renderTaskFiles(ctx: StageContext, manifest: GeneratedManifest): Promise<void>` — (re)writes every `.convert/tasks/<id>.md`, `AGENTS.md`, `CLAUDE.md` for the current `state.options.testing` (Task 21 calls it at every run start).
  - Ids: `shell-<kebab>`, `sec-<slug>-<kebab>` (parts: `sec-<slug>-<kebab>-<partKebab>`), `page-<slug>`, `fix-<id>`.
  - Targets: shell `[file, <file without .tsx>/]`; section `[file, <file without .tsx>/]` (part tasks: the part file and its dir); page `[view, src/components/page/<slug>/, …wrapper files of split sections]`.
  - `dependsOn`: section tasks → all shell ids; page task → all its section/part ids and the shell ids it uses.
  - `SHARED_RULES` (spec 6.3 verbatim bullets) and templates `shell`, `section`, `page`, `fix`, `agents`; removed: `component`, `motion`.
  - `checkCommand(taskId: string, testing: boolean): string` → `` `${CLI_INVOCATION} check ${taskId}` `` plus ` --smoke` when testing is off.
  - `buildAgentPrompt(task: TaskRecord): string` → `Read AGENTS.md and <file>, then complete that task. Edit only the files listed under Edit only. When finished, run the check command in its "Done when" section and stop when it passes or reports the limit.` (throws on unsafe path chars, as today).

- [ ] **Step 1: Failing tests** (build a manifest literal with one shell, two sections with motion and script-drawn ids, one empty inline section, one dynamic page):
  - ids/kinds/targets/dependsOn exactly as above; no task for the inline section;
  - section file contains `## Edit only`, the decomposed motion line `` `m2` "Comment" (scroll, 1.3 s): opacity 0→1 ``, the script-drawn line with `ticking every second` when `ticking`, the variants instruction with `md:` and `lg:` when `hasVariants`, repeated components, and `cms:` fields for dynamic pages;
  - every task file and `AGENTS.md` contain `Never run \`npm run build\``;
  - `Done when` contains `check <id>` and, after setting `options.testing = false` and re-rendering, `check <id> --smoke`;
  - unmatched motion anchors are listed by Framer name under `Unanchored animations`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** + `npm test` — PASS (delete tests of removed modes).
- [ ] **Step 5: Commit** `feat(convert): shell, section and page tasks with one consistent rule set`

---

## Phase D — Verification

### Task 10: Deterministic capture environment and fair DOM comparison

**Files:**
- Create: `src/convert/verify/env.ts`
- Modify: `src/convert/verify/dom-check.ts`, `src/convert/verify/settle.ts`
- Test: `tests/unit/convert-dom-check.test.ts`, `tests/integration/convert-env.test.ts`

**Interfaces:**
- Produces: `FIXED_TIME`; `prepareCapture(page: Page): Promise<void>` (fixed `Date`/`Date.now` via `evaluateOnNewDocument`, `emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])`); `normalizeLink(href: string): string` (drop origin, query, `./` prefixes, trailing `/` except root, `.html`; `''` → `/`); `extractSectionDom` counts only elements passing `checkVisibility()`; `compareDom` normalizes links on both sides.

- [ ] **Step 1: Failing tests**: `normalizeLink('./')` → `/`, `normalizeLink('./case-study/x')` → `/case-study/x`, `normalizeLink('http://127.0.0.1:5/about.html?a#b')` → `/about`; integration: a page printing `new Date().toISOString()` shows `2026-01-01T12:00:00.000Z` after `prepareCapture`; a `display:none` link is not in `extractSectionDom` links.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS + `npm test`).
- [ ] **Step 5: Commit** `feat(convert): fixed clock, reduced motion and visible-only DOM checks`

### Task 11: Dev server manager

**Files:**
- Create: `src/convert/verify/dev-server.ts`
- Test: `tests/integration/convert-dev-server.test.ts`

**Interfaces:**
- Produces: `interface DevServer { url: string; pid: number; stop(): Promise<void> }`; `ensureDevServer(nextDir: string, opts?: { keepAlive?: boolean; readyTimeoutMs?: number /* default 120_000 */ }): Promise<DevServer>` — reuses the server in `.convert/dev-server.json` (`{ pid, port, startedAt }`) when `GET /` answers; otherwise starts `npm run dev -- -p <freePort> -H 127.0.0.1` with `NEXT_TELEMETRY_DISABLED=1` (managed by `spawnManaged`, or detached and unref'd when `keepAlive`), waits for any HTTP answer, writes the info file. `stopDevServer(nextDir: string): Promise<void>` kills the recorded pid tree and deletes the file.

- [ ] **Step 1: Failing tests** (stand-in project whose `package.json` `dev` script runs a tiny Node HTTP server, like `START` in `tests/integration/convert-verify.test.ts`): second `ensureDevServer` reuses the same pid; after killing that pid, `ensureDevServer` starts a new one on a new port and rewrites the info file (Review Focus 5); `stopDevServer` leaves no live pid.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat(convert): shared next dev server for checks`

### Task 12: Section capture and baseline stage

**Files:**
- Create: `src/convert/verify/capture-sections.ts`, `src/convert/verify/baseline.ts`
- Test: `tests/integration/convert-baseline.test.ts`

**Interfaces:**
- Consumes: `prepareCapture`, `settleNext` (`?__verify=1`), `crop` (`verify/diff.ts`), `extractSectionDom`.
- Produces: `capturePageSections(page: Page, url: string, width: number, names: string[]): Promise<Map<string, { png: PNG; box: Box; dom: SectionDom }>>` (one full-page screenshot, cropped per `[data-section]`; missing or zero-size sections absent); `baselineDir(nextDir: string, task: TaskRecord): string` (`.convert/baseline/<slug>/<kebab>` or `.convert/baseline/shell/<kebab>`); `runBaseline(ctx: StageContext, devUrl: string): Promise<void>` captures every shell/section task's section at all widths into `<width>.png` + `<width>.json`, sets `stages.baseline = 'done'`.

- [ ] **Step 1: Failing test** with a stand-in server serving two `data-section` divs: files `1440.png`, `1000.png`, `390.png`, and `.json` exist per section; PNG height equals the section's box height at that width.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat(convert): capture per-section baselines from the generated site`

### Task 13: `check` command core

**Files:**
- Create: `src/convert/verify/check.ts`, `src/convert/verify/clusters.ts`
- Test: `tests/unit/convert-check.test.ts`, `tests/integration/convert-check.test.ts`

**Interfaces:**
- Produces:
  - `WidthResult { width: number; ratio: number; heightDelta: number; pass: boolean; clusters: Box[]; images?: { expected: string; actual: string; diff: string } }`
  - `MotionResult { id: string; pass: boolean; lowConfidence: boolean; detail: string }` (filled by Task 14)
  - `CheckResult { taskId: string; mode: 'smoke' | 'full'; pass: boolean; limitReached: boolean; widths: WidthResult[]; dom: DomMismatch[]; code: string[]; motion: MotionResult[]; errors: string[] }`
  - `runCheck(root: string, taskId: string, opts?: { smoke?: boolean; countCall?: boolean; devUrl?: string }): Promise<CheckResult>` — `countCall` (default true from the CLI, false from the pool) increments `.convert/checks/<taskId>.json` `{ calls }` and returns `limitReached` from the 4th call without capturing. Smoke: HTTP 200 and non-zero section box at 1440. Full: pixels vs baseline at 3 widths (Global Constraints), visible DOM vs baseline JSON, `codeViolations`, motion (Task 14; empty list until then). Images in `.convert/checks/<taskId>/<width>-{expected,actual,diff}.png`. Page tasks check every section of the page.
  - `resetCheckCalls(root: string, taskId: string): Promise<void>`
  - `diffClusters(diff: PNG, max?: number /* 3 */): Box[]` — red-pixel connected regions on a 16 px grid, largest first.
  - `codeViolations(sources: Array<{ file: string; text: string }>, requiredMotion: string[]): string[]` — `"<file>: framer- class name"`; `"missing data-motion=\"m4\""`.
  - `formatCheck(r: CheckResult): string` — first line `PASS <id>` / `FAIL <id>` / the limit message.

- [ ] **Step 1: Failing tests.** Unit: `diffClusters` on a synthetic PNG with two red blocks returns 2 boxes, larger first; `codeViolations` flags `className="framer-1x"` and a missing `m4`; call counter: 3 calls `limitReached: false`, 4th `true` and `formatCheck` equals the limit message; two concurrent counted calls end with `{ calls: 2 }` and leave `state.json` byte-identical (Review Focus 4). Integration (stand-in dev server, baseline from Task 12): identical page → PASS at all widths; page with a changed background → FAIL with clusters and three image paths; `smoke` on a 500 page → FAIL.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat(convert): fast section check against the baseline`

### Task 14: Motion presence check

**Files:**
- Create: `src/convert/verify/motion-check.ts`
- Modify: `src/convert/verify/check.ts` (call it in full mode)
- Test: `tests/unit/convert-motion-check.test.ts`, `tests/integration/convert-motion-check.test.ts`

**Interfaces:**
- Consumes: `MotionResult` (Task 13), `decomposeTransform` (Task 4), `MotionAnchor` (Task 8).
- Produces: `movedTowards(entry: Pick<AnimationEntry, 'from' | 'to'>, before: Record<string, string>, after: Record<string, string>): boolean` — true when, for the property with the largest recorded change (opacity, or a component from `decomposeTransform`), `after` is at least 25 % of `|to − from|` closer to `to` than `before`; `checkMotion(page: Page, url: string, anchors: MotionAnchor[]): Promise<MotionResult[]>` — no freeze, no `__verify`; triggers: `appear` sample at 0 ms and 1,500 ms after load; `scroll` before and after `scrollIntoView` + 1,500 ms; `hover` before and after `page.hover`; `loop` at t and t + 2,000 ms (pass on any change). Low-confidence failures are reported with `lowConfidence: true` and do not fail the check.

- [ ] **Step 1: Failing tests.** Unit: opacity 0→1 recorded, before 0 / after 0.9 → true; after 0.1 → false; rotation −10°→0° with before −10 / after −2 → true. Integration: a page whose element fades in via CSS transition on load passes; a static element fails.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat(convert): check that animations exist and move the right way`

---

## Phase E — Runner

### Task 15: Agent process, quota detection, fake agent

**Files:**
- Create: `src/convert/runner/agent-process.ts`, `src/convert/runner/quota.ts`, `tests/fixtures/fake-agent.mjs`
- Test: `tests/unit/convert-quota.test.ts`, `tests/integration/convert-agent-process.test.ts`

**Interfaces:**
- Produces:
  - `QuotaHit { line: string; resetHint?: string }`; `detectQuota(line: string): QuotaHit | null` — match `RESOURCE_EXHAUSTED` or `\b429\b`, or (`quota|usage limit|rate limit`) together with (`reached|exceeded|exhausted|hit`); `resetHint` from `/resets? in ([0-9hms ]+)/i` or `/try again in ([^.]+)/i`.
  - `agentCommand(agent: AgentId, prompt: string): { command: string; args: string[] }` — `[agent, ['-p', prompt, '--dangerously-skip-permissions']]`; when env `FEXPORT_AGENT_CMD` is set: `[process.execPath, [FEXPORT_AGENT_CMD, agent, '-p', prompt]]`.
  - `resolveAgentBinary(agent: AgentId): Promise<string | null>` and `detectAgents(): Promise<AgentId[]>` (moved from `cli-v2/screens/convert-agent.ts` with `pickBinaryLine`).
  - `AgentExit { exitCode: number | null; timedOut: boolean; killed: boolean; quota: QuotaHit | null }`; `AgentHandle { pid: number | undefined; done: Promise<AgentExit>; kill(): Promise<void> }`; `spawnAgent(opts: { command: string; args: string[]; cwd: string; timeoutMs: number; logFile: string; onLine?: (line: string) => void }): AgentHandle` — via `spawnManaged`, logs to file, calls `onLine` per line, kills the tree on timeout.
- Fake agent modes (env `FAKE_AGENT_MODE`): `edit` (append `// edited` to the first target named in env `FAKE_AGENT_TARGET`), `outside` (also writes `src/app/globals.css` and `scratch.png`), `hang` (sleeps forever), `quota` (prints `error: Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 43h24m17s.` and exits 3), `spawn-child` (starts a sleeping grandchild, prints its pid, then hangs).

- [ ] **Step 1: Failing tests.** Unit: the agy line above → hit with `resetHint '43h24m17s'`; `AGY_ERROR: {"short_error":"RESOURCE_EXHAUSTED (code 429)…"}` → hit; `Checking quota of tasks` → null; `rate limit` alone → null. Integration (cwd with a space): `hang` with `timeoutMs: 1500` → `timedOut: true` within 5 s; `spawn-child` + timeout → grandchild pid no longer alive; `quota` → `quota` set and `exitCode 3`; log file contains the output.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat(convert): agent processes with hard timeouts and quota detection`

### Task 16: Scope snapshot and revert

**Files:**
- Create: `src/convert/runner/scope.ts`
- Test: `tests/unit/convert-scope.test.ts`

**Interfaces:**
- Produces: `TreeSnapshot` (opaque: `Map<string, Buffer>` of watched files + root file list); `snapshotTree(root: string): Promise<TreeSnapshot>` — watched: `src/**`, `public/**` (skip files > 5 MB, record their size+mtime instead), `package.json`, `next.config.ts`, `tsconfig.json`, `postcss.config.mjs`, `eslint.config.mjs`, `AGENTS.md`, `CLAUDE.md`, `.convert/tasks/**`, and the names of all root files; ignored: `.next/`, `node_modules/`, `next-env.d.ts`, rest of `.convert/`. `isAllowed(file: string, targets: string[]): boolean` (a target ending in `/` allows that subtree). `revertOutOfScope(root: string, before: TreeSnapshot, allowed: string[]): Promise<string[]>` — restores changed/deleted watched files, deletes new files, returns sorted posix paths.

- [ ] **Step 1: Failing tests**: change to own target kept; change to `src/app/globals.css` reverted; new `scratch-export-shot.png` in root deleted; new file under an allowed `src/sections/home/Hero/` dir kept; change inside another running task's target (passed in `allowed`) kept; `next-env.d.ts` change ignored; return value lists exactly the reverted paths.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat(convert): revert agent changes outside the task's files`

### Task 17: Run lock, interrupt and recovery

**Files:**
- Create: `src/convert/runner/lock.ts`, `src/convert/runner/interrupt.ts`
- Modify: `src/convert/verify/proc.ts` (interrupt hook)
- Test: `tests/unit/convert-interrupt.test.ts`, `tests/integration/convert-lock.test.ts`

**Interfaces:**
- Produces (proc.ts): `setInterruptHandler(handler: (() => void) | null): void` — while set, SIGINT calls it instead of shutting down.
- Produces (lock.ts): `LockFile { runnerPid: number; startedAt: string; agents: Record<string, number>; devServerPid?: number }`; `class RunActiveError extends Error`; `isAlive(pid: number): boolean`; `commandLineOf(pid: number): Promise<string | null>` (Windows: `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=<pid>').CommandLine"`; POSIX: `ps -o args= -p <pid>`); `acquireRunLock(root: string): Promise<{ lock: RunLock; stale: LockFile | null }>` — throws `RunActiveError` when the recorded runner is alive and is not this process; for a stale lock kills recorded agent / dev-server pids whose command line matches `/agy|claude|next|fake-agent/`; `RunLock { setAgent(taskId: string, pid: number | null): Promise<void>; setDevServer(pid: number | null): Promise<void>; release(): Promise<void> }`.
- Produces (interrupt.ts): `saveTaskSnapshot(root: string, task: TaskRecord): Promise<void>` (copies targets to `.convert/snapshots/<id>/`, records absent files); `recoverTask(root: string, task: TaskRecord, now?: Date): Promise<string>` (copies current targets to `.convert/partial/<id>/<YYYYMMDD-HHmmss>/`, restores the snapshot, deletes files absent in it, sets `status = 'pending'`, leaves `attempts`; returns the partial dir); `recoverInterrupted(root: string, state: ConvertState): Promise<string[]>` (every `in-progress` task; returns their ids).

- [ ] **Step 1: Failing tests.** Unit: snapshot → edit target + add new file in target dir → `recoverTask` restores content, deletes the new file, partial copy contains the edit, `attempts` unchanged, status `pending`; a `done` task's hand-edited file is untouched by `recoverInterrupted` (Review Focus 3). Integration: lock with this process's pid held by another `acquireRunLock` → `RunActiveError`; stale lock whose `agents` holds a live `fake-agent.mjs hang` pid → pid killed, `stale` returned.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat(convert): run lock, task snapshots and interrupted-task recovery`

### Task 18: Ready-task ordering and worker pool

**Files:**
- Create: `src/convert/runner/ready.ts`, `src/convert/runner/pool.ts`, `src/convert/runner/fix.ts`
- Test: `tests/unit/convert-ready.test.ts`, `tests/unit/convert-pool.test.ts`

**Interfaces:**
- Consumes: Tasks 9, 13, 15–17.
- Produces:
  - `readyTasks(state: ConvertState, running: ReadonlySet<string>): TaskRecord[]` — `pending` tasks whose `dependsOn` are all `done`/`needs-review`; order fix, shell, section, page, then id; while a shell task is running, no other shell task is ready.
  - `writeFixTask(ctx: StageContext, task: TaskRecord, result: CheckResult): Promise<TaskRecord>` — `fix-<id>`, kind `fix`, `fixOf`, same targets, file listing only this result's failures (scores, clusters, image paths, DOM, code, motion) via the `fix` template.
  - `PauseController { readonly mode: 'none' | 'after-running' | 'now'; request(mode: 'after-running' | 'now'): void }`; `createPauseController(): PauseController`.
  - `PoolEvent` = `{ type: 'start'; worker: number; task: TaskRecord }` | `{ type: 'line'; worker: number; taskId: string; line: string }` | `{ type: 'end'; worker: number; taskId: string; outcome: 'done' | 'fix' | 'needs-review' | 'interrupted'; ms: number }` | `{ type: 'reverted'; taskId: string; files: string[] }` | `{ type: 'quota'; hit: QuotaHit }`.
  - `PoolDeps { spawn(task: TaskRecord, prompt: string, timeoutMs: number, logFile: string, onLine: (l: string) => void): AgentHandle; check(taskId: string, smoke: boolean): Promise<CheckResult>; lock: RunLock; onEvent?: (e: PoolEvent) => void; now?: () => number }`
  - `runQueue(ctx: StageContext, deps: PoolDeps, pause: PauseController): Promise<{ stoppedFor: 'done' | 'paused' | 'quota'; quota?: QuotaHit; ran: string[] }>`
- Per task: `in-progress` → `saveTaskSnapshot` → `resetCheckCalls` → `snapshotTree` → spawn (timeout: section `sectionTimeoutMin`; shell and page `pageTimeoutMin`; fix tasks use the limit of their `fixOf` task) → on `pause.mode === 'now'`: `kill`, `recoverTask` → on quota: `recoverTask`, stop dispatch, finish others, return `quota` → else `revertOutOfScope` (allowed = own targets ∪ running tasks' targets) → `check` (smoke when testing off) → pass: `done` (fix: also its `fixOf` task) → fail: original task with testing on and no fix yet: `attempts++`, `awaiting-fix`, `writeFixTask`; fix task or testing off: `needs-review` (fix: also its `fixOf`). State is held in memory, `saveState` after every change, `addTime` per task.

- [ ] **Step 1: Failing tests** with fake `spawn` (resolves after a tick, or never until killed) and fake `check`:
  - concurrency 2 never runs more than 2 at once; shell tasks run alone and before sections; the page task starts only after its sections finish;
  - failing check, testing on → `fix-<id>` created, original `awaiting-fix`; fix passes → both `done`; fix fails → both `needs-review`; testing off → `needs-review` directly, no fix;
  - timeout (`timedOut: true`) still runs the check and counts the attempt;
  - quota exit → task `pending` (attempts unchanged), no new dispatch, running task finishes, result `stoppedFor: 'quota'` with `resetHint`;
  - `pause.request('after-running')` → running tasks finish, nothing new starts, `stoppedFor: 'paused'`; `request('now')` → handles killed, tasks `pending`, partial dirs exist;
  - out-of-scope change produces a `reverted` event.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat(convert): parallel worker pool with fix attempts, pause and quota stop`

---

## Phase F — Orchestration, finalize, report

### Task 19: Report

**Files:**
- Create: `src/convert/verify/report.ts`, `src/convert/verify/report-html.ts`, `src/convert/verify/filmstrip.ts`
- Test: `tests/unit/convert-report.test.ts`, `tests/integration/convert-report.test.ts`

**Interfaces:**
- Produces: `dynamicMask(a: PNG, b: PNG): Uint8Array` (1 where pixels differ, sizes padded); `maskedRatio(expected: PNG, actual: PNG, mask: Uint8Array): number` (masked pixels excluded from numerator and denominator); `captureFilmstrip(page: Page, url: string, width: number, frames?: number /* 6 */): Promise<Buffer[]>` (frames at 0, 300, 600 ms after load, then 3 scroll positions); `ReportData { generatedAt; totalMs; pages: Array<{ route; sections: Array<{ name; widths: Array<{ width; ratio; pass; images: { original; next; diff } }> }>; filmstrip: { original: string[]; next: string[] } }>; needsReview: string[]; stubs: string[] /* manifest.stubs */ }`; `renderReportHtml(d: ReportData): string` (self-contained page, names HTML-escaped); `runReport(ctx: StageContext, opts: { tolerance: number }): Promise<{ file: string; over: number }>` — `startNextServer` (build + start) and `startExportServer`, export captured twice 2 s apart for the mask, per-section ratios at 3 widths, writes `.convert/report/index.html` and images.

- [ ] **Step 1: Failing tests.** Unit: `dynamicMask` of two PNGs differing in one 10×10 block masks exactly 100 pixels; `maskedRatio` ignores those pixels; `renderReportHtml` escapes `<b>` in a section name and lists `needsReview` ids. Integration: stand-in export + stand-in Next (as in `convert-verify.test.ts`) → `index.html` exists, references existing images, `over: 0` for identical pages.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat(convert): side-by-side report with automatic dynamic-region masking`

### Task 20: Finalize stage

**Files:**
- Create: `src/convert/stages/finalize.ts`
- Test: `tests/unit/convert-finalize.test.ts`

**Interfaces:**
- Produces: `framerClassFiles(nextDir: string): Promise<string[]>` (files under `src/` except `src/styles/framer/` containing `framer-` in a `className`); `dropFramerCss(nextDir: string): Promise<number>` (removes `import '@/styles/framer/…';` lines from `src/**/*.tsx`, deletes `src/styles/framer/`, returns files changed); `runFinalize(ctx: StageContext, deps: { check(id: string): Promise<CheckResult>; build(): Promise<{ ok: boolean; log: string }>; report(): Promise<{ file: string }> }): Promise<{ buildOk: boolean; fixTask?: string; report?: string }>` — drop CSS only when `framerClassFiles` is empty (else warning `finalize: Framer CSS kept; framer- classes remain in <n> files`); testing on: re-check every done shell/section task, failures → `needs-review`; build; on failure write `fix-build` (kind `fix`, targets `['src/']`, attempts counted, after 2 failures `needs-review` and `stages.finalize = 'failed'`); testing on: report; `stages.finalize = 'done'`.

- [ ] **Step 1: Failing tests** (temp project, fake deps): with no framer classes, imports removed and folder gone; with one file using `framer-x`, nothing removed and warning set; failing build creates `fix-build` once, second failure sets `failed`; testing off never calls `check` or `report`.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat(convert): finalize drops Framer CSS, builds and reports`

### Task 21: Pipeline and run orchestration

**Files:**
- Modify: `src/convert/pipeline.ts`
- Create: `src/convert/run.ts`
- Test: `tests/unit/convert-run.test.ts`, `tests/integration/convert-pipeline.test.ts`

**Interfaces:**
- Produces:
  - `runPipeline(exportDir: string, nextDir: string, io: ConvertIo, options: RunOptions, deps?: { install?: typeof runInstall }): Promise<ConvertState>` — runs `analyze` → `extract-cms` → `scaffold` → `install` → `generate` → `tasks`; `baseline` runs when `options.testing` (with `ensureDevServer`) else `skipped`; stores `options`.
  - `RunIo { onEvent(e: PoolEvent): void; pause: PauseController; onQuota(hit: QuotaHit, other: AgentId | null): Promise<'switch' | 'stay'> }`
  - `RunOutcome = { status: 'done'; report?: string } | { status: 'paused'; reason: 'user' | 'quota'; quotaResetHint?: string }`
  - `RunDeps = Partial<PoolDeps> & { devServer?: (root: string) => Promise<DevServer>; finalize?: (ctx: StageContext) => Promise<{ buildOk: boolean; report?: string }> }`
  - `runAgents(root: string, io: RunIo, deps?: RunDeps): Promise<RunOutcome>` — `acquireRunLock` → if stale lock: `run.reason = 'crash'` → `recoverInterrupted` → `renderTaskFiles` → `ensureDevServer` (record pid in lock) → `setInterruptHandler` → `runQueue`; on quota ask `onQuota`: `switch` changes `options.agent` and loops again, `stay` saves `run = { status: 'paused', reason: 'quota', quotaResetHint, pausedAt }`; on pause saves `paused`/`user`; on done runs `runFinalize`, saves `run.status = 'done'`; always stops the dev server, clears the handler, releases the lock.

- [ ] **Step 1: Failing tests.** Unit (fake pool/finalize deps): quota + `switch` → second queue run uses the other agent; quota + `stay` → `state.run` `{ status: 'paused', reason: 'quota', quotaResetHint: '43h24m17s' }`; second `runAgents` while the first holds the lock rejects with `RunActiveError`; lock released after an exception. Integration on `framer-nudge-mini` (temp dir with a space) with `FEXPORT_AGENT_CMD=tests/fixtures/fake-agent.mjs`, `FAKE_AGENT_MODE=edit`, `testing: false`, `deps.install` that only marks the stage `done`, and `RunDeps` with a fake `devServer` (returns `{ url: 'http://127.0.0.1:1', pid: process.pid, stop }`), a fake `check` that passes, and a fake `finalize`: pipeline reaches `tasks: done`, `baseline: skipped`; `runAgents` returns `{ status: 'done' }`; every task is `done`; real fake-agent processes ran (each section file ends with `// edited`).
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat(convert): orchestrate stages, agent runs, pause and finalize`

---

## Phase G — Interfaces, cleanup, docs, acceptance

### Task 22: CLI commands and dashboard

**Files:**
- Modify: `src/convert/index.ts`, `src/cli-v2/screens/convert-dashboard.ts`, `src/cli-v2/screens/convert-run.ts`, `src/cli-v2/screens/convert-helpers.ts`, `src/convert/progress.ts`
- Create: `src/cli-v2/screens/convert-agents.ts` (live run screen), `src/cli-v2/screens/convert-options.ts`
- Delete: `src/cli-v2/screens/convert-agent.ts`
- Test: `tests/unit/convert-cli.test.ts`, `tests/unit/cli-v2-convert.test.ts`, `tests/unit/convert-progress.test.ts`

**Interfaces:**
- CLI (`parseConvertArgs`): `convert <exportDir> [nextDir] [--yes] [--testing on|off] [--agent agy|claude] [--concurrency 1|2|3]`, `status`, `next`, `check <taskId> [--smoke]` (prints `formatCheck`, exit 0/1/2), `run` (headless `runAgents`; Ctrl+C pauses after running tasks, twice pauses now), `report`, `review <taskId>` (`needs-review` → `done`), `ui`; `verify` is an alias of `report`.
- Helpers: `DashboardAction = 'resume' | 'agent' | 'report' | 'open-report' | 'review' | 'options' | 'status' | 'next' | 'reconvert' | 'refresh' | 'exit'`; `getDashboardChoices(state: ConvertState): Choice<DashboardAction>[]` (`resume` first and preselected when `run.status === 'paused'`; `reconvert` only when `legacyTasks`; `review` only with `needs-review` tasks; `open-report` only when the report exists); `formatRunBanner(state: ConvertState): string | null` → `Paused at Sections 14/31 · reason: agy quota (resets in 43h24m17s)`; `formatWorkerLine(w: { worker: number; route: string; section: string; agent: AgentId; ms: number; lastLine: string }): string` → `W1 · / · Hero + About · claude · 4m 12s · editing HeroAbout.tsx`; `formatProgressLine` adds `Review <n>`.
- `askRunOptions(defaults: RunOptions, agents: AgentId[]): Promise<RunOptions>` ("Use default options?" → Yes, or one prompt per option); `convert-run.ts` asks it after "Start conversion?"; the live screen listens for `P` (raw stdin) and the interrupt handler, then shows `uiSelect` **Finish running tasks, then pause** / **Pause now**; `onQuota` shows **Switch to <other> and continue** / **Stay paused**. `reconvert` renames the project to `<name>.old` (suffix `-2`, `-3` if taken) and runs the conversion again.

- [ ] **Step 1: Failing tests**: argument parsing for every command and flag; `getDashboardChoices` for paused, legacy, needs-review and fresh states; `formatRunBanner` and `formatWorkerLine` exact strings above; `formatProgressLine` contains `Review 1`.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS + `npm test` + `npm run typecheck`).
- [ ] **Step 5: Commit** `feat(convert): dashboard and CLI for options, live workers, pause and resume`

### Task 23: Remove the old pipeline paths

**Files:**
- Delete: `src/convert/stages/verify.ts`, `tests/integration/convert-verify.test.ts`, `tests/unit/convert-verify-guards.test.ts`, `tests/unit/convert-done.test.ts`, reference-capture code only used by them
- Modify: `src/convert/types.ts` (drop `component`, `motion`, `needs-human`, `verify`), `src/convert/state.ts` (drop `recordAttempt`, `MAX_ATTEMPTS`), `src/convert/index.ts` (`markTaskDone` removed), any remaining imports
- Test: whole suite

- [ ] **Step 1:** Delete and narrow the types; run `npm run typecheck` and fix every reference (expect failures to list the files).
- [ ] **Step 2:** `npm test` and `npm run test:browser` — PASS.
- [ ] **Step 3: Commit** `refactor(convert): remove the whole-page task model and the old verify gate`

### Task 24: Documentation

**Files:**
- Modify: `CONVERT_GUIDE.md` (sections 2–8 rewritten for the new flow, run options, testing modes, pause/resume, report, re-converting old projects), `CHANGELOG.md` (new version entry), `README.md` (convert command lines only)

- [ ] **Step 1:** Rewrite the guide from the spec; every command in it must exist in `CONVERT_USAGE`.
- [ ] **Step 2:** Check: `grep -n "convert done\|Mark motion task\|Generate pages & components" CONVERT_GUIDE.md README.md` prints nothing.
- [ ] **Step 3: Commit** `docs: converter guide for the section-refactor pipeline`

### Task 25: Manual acceptance on the full portfolio export

Not automated; record results in `docs/superpowers/plans/2026-11-04-section-refactor-pipeline-acceptance.md`.

- [ ] **Step 1:** `npm run build` in `FramerExport` (the CLI invocation in task files runs `bin/fexport.js` → `dist/`; a stale `dist/` runs old code).
- [ ] **Step 2:** `node bin/fexport.js convert out/portfolio out/portfolio-next` → options: testing on, agent `claude`, concurrency 1. Expect stages through `baseline` done, tasks for 7 static pages + 2 CMS templates, and the site running in `npm run dev` before any agent work.
- [ ] **Step 3:** Run the agent loop; after 2 tasks press `P` → **Pause now**; check the partial copy and restored file; resume from the dashboard banner.
- [ ] **Step 4:** Kill the terminal mid-task; reopen the dashboard; confirm recovery (crash reason, task `pending`, no orphan `claude`/`next` processes in Task Manager).
- [ ] **Step 5:** Let it finish. Record per page: active time, tasks `done` / `needs-review`, reverted files, report scores. Pass criteria (spec section 2): every page builds; no `framer-` classes in `src/sections`; every section ≤ 3 % in the report or `needs-review`; no agent run over its limit; ≤ ~30 min active per page template.
- [ ] **Step 6:** Repeat Step 2 with `--testing off --concurrency 2 --agent agy` on a fresh copy and record the same numbers.
- [ ] **Step 7: Commit** the acceptance notes `docs: acceptance results for the section-refactor pipeline`
