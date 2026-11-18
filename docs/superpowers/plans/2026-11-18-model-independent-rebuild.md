# Model-Independent Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any LLM that follows the generated guide produces a rebuild that passes the same scripted gate against the original Framer site.

**Architecture:** Move decisions from the model into FramerExport: parse exact transitions from the export, emit them as code, make the rule-based converter the starting point, and enforce rules with scripts the model cannot skip.

**Tech Stack:** TypeScript ESM, Node ≥ 20, tests with `node --import tsx --test` (`npm test`), parse5, Puppeteer.

**Spec:** `docs/superpowers/specs/2026-11-18-model-independent-rebuild-design.md`

## Global Constraints

- Node ≥ 20; no new runtime dependency without a one-line reason in the commit message.
- Existing `ai-guide/` files keep their names and sections; new data is added, nothing removed.
- Values in generated output are copied from the export, never rounded or re-typed (`ease [0.2,0.7,0.1,1]` stays four numbers).
- Every new module gets a unit test in `tests/unit/`; `npm run typecheck && npm test` pass after each task.
- Reference site for manual checks: the Clara & Theo export (`../framer-clara-theo-fresh-copy-1w5u-claude`).
- Work on a feature branch, never on `master`.

## Review Focus

- An export with no `__framer__appearAnimationsContent` block (older Framer, other platforms) still produces a guide, with no timing lines and no crash. → Task 1 test.
- Spring transitions (`type: spring`, `stiffness`, `damping`, no `duration`) are carried as-is, not converted to a guessed duration. → Task 1 test.
- Appear variants that differ per breakpoint (`a4be70` has `default`, `1subnv1`, `1ya7tf3`, `1v6v7vy`) map to desktop, laptop, tablet and mobile via `__framer__breakpoints`. → Task 1 test.
- The content check does not flag text that legitimately repeats in code: `alt`, `aria-label`, `metadata` in `page.tsx`. → Task 4 test.
- Scripts in the generated guide run on Windows: paths built with `path.join`, no shell globbing. → Task 4 and Task 5 tests use `path.join` fixtures.

---

### Task 1: Read exact appear transitions

**Files:**
- Create: `src/ai-guide/appear-transitions.ts`
- Modify: `src/ai-guide/index.ts` (around line 246, after `findAnimations`)
- Modify: `src/ai-guide/export-motion.ts` (`describeAnimation`, only if timing is not printed for `appear`)
- Test: `tests/unit/ai-guide-appear-transitions.test.ts`
- Fixture: `tests/fixtures/appear/clara-theo-appear.html` (the two `framer/appear` script blocks copied from the export)

**Interfaces:**
- Consumes: `ExportAnimation` from `src/ai-guide/export-motion.ts`.
- Produces:
  - `type Breakpoint = 'desktop' | 'laptop' | 'tablet' | 'mobile'`
  - `interface AppearState { initial: Record<string, number>; animate: Record<string, number>; transition: Record<string, unknown> }`
  - `interface AppearAnimation extends AppearState { id: string; byBreakpoint: Partial<Record<Breakpoint, AppearState>> }`
  - `parseAppearAnimations(html: string): Map<string, AppearAnimation>`
  - `mergeAppear(animations: ExportAnimation[], appear: Map<string, AppearAnimation>): ExportAnimation[]` — fills `transition` on every `kind: 'appear'` item whose class is `framer-<id>`.

- [ ] **Step 1: Write the failing tests**

```ts
const html = readFileSync('tests/fixtures/appear/clara-theo-appear.html', 'utf8');
const map = parseAppearAnimations(html);
assert.deepEqual(map.get('a4be70')!.transition, { delay: 0.1, duration: 2.6, ease: [0.2, 0.7, 0.1, 1], type: 'tween' });
assert.equal(map.get('4kv6xh')!.transition.delay, 0.15);
assert.equal(map.get('4kv6xh')!.transition.duration, 1.4);
assert.deepEqual(Object.keys(map.get('a4be70')!.byBreakpoint).sort(), ['desktop', 'laptop', 'mobile', 'tablet']);
assert.equal(parseAppearAnimations('<html></html>').size, 0);
assert.equal(parseAppearAnimations('<script type="framer/appear" id="__framer__appearAnimationsContent">{bad</script>').size, 0);
// spring fixture: transition keeps stiffness + damping, has no duration
```

`mergeAppear` test: an `ExportAnimation` `{ kind: 'appear', className: 'framer-4kv6xh', values: {...} }` gains `transition.duration === 1.4`; an item with no matching id is unchanged.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL, `parseAppearAnimations` not exported.

- [ ] **Step 3: Implement `parseAppearAnimations` and `mergeAppear` in `src/ai-guide/appear-transitions.ts`**

Read both `framer/appear` script blocks with a regex on their `id`. Breakpoint hashes come from `__framer__breakpoints` in order of `mediaQuery`: `min-width: 1440` → desktop, `1200–1439.98` → laptop, `810–1199.98` → tablet, `max-width: 809.98` → mobile. Malformed JSON → empty map, no throw.

- [ ] **Step 4: Wire into `src/ai-guide/index.ts`**

After `animations = findAnimations(modules, classes)`, call `mergeAppear(animations, parseAppearAnimations(exportHtml))`, so `section-ref.ts` prints timing through the existing `describeTransition`.

- [ ] **Step 5: Run tests and regenerate the reference guide**

Run: `npm test`. Expected: PASS.
Regenerate the Clara & Theo guide into a scratch copy; `pages/index/sections/01-hero/ref.md` must show `2.6s`, `0.1s` delay and the ease on the Photo line. Note in the commit message how many `enter` (in-view) items still have no `transition` (spec open question).

- [ ] **Step 6: Commit**

```bash
git add src/ai-guide/appear-transitions.ts src/ai-guide/index.ts tests/unit/ai-guide-appear-transitions.test.ts tests/fixtures/appear
git commit -m "feat(ai-guide): read exact appear transitions from the export"
```

### Task 2: Generated motion presets

**Files:**
- Create: `src/ai-guide/motion-presets.ts`
- Create: `src/ai-guide/templates/appear-component.ts`
- Modify: `src/ai-guide/section-ref.ts` (Animations part, around line 107)
- Modify: `src/ai-guide/plan.ts` (Task 0 copies presets + components)
- Modify: `src/ai-guide/templates/agents.ts` (animation rule)
- Modify: `src/nextjs/model.ts` (`AnimationSpec` gains `transition?: Record<string, unknown>`)
- Test: `tests/unit/ai-guide-motion-presets.test.ts`

**Interfaces:**
- Consumes: `ExportAnimation[]` with `transition` filled by Task 1's `mergeAppear`.
- Produces:
  - `interface MotionPreset { key: string; section: string; trigger: 'load' | 'in-view' | 'scroll' | 'loop'; from: Record<string, number>; to: Record<string, number>; transition: Record<string, unknown> }`
  - `buildMotionPresets(animations: ExportAnimation[], sectionOf: (className: string) => string): MotionPreset[]`
  - `renderPresetsModule(presets: MotionPreset[]): string` — the text of `ai-guide/motion/presets.ts`, exporting `presets` and `type PresetKey`.
  - Template components `Appear` / `Reveal` taking only `{ preset: PresetKey; className?: string; children }`.

- [ ] **Step 1: Write the failing tests**

Hero presets have keys `hero-photo`, `hero-eyebrow`, `hero-title` (section slug + layer name, else class); `hero-title.from` deep-equals `{ opacity: 0.001, y: 54 }` and `hero-title.transition` equals Task 1's value; duplicate keys get `-2`, `-3`; `renderPresetsModule` output compiles with `ts.transpileModule` with no diagnostics.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `buildMotionPresets`, `renderPresetsModule` and the component template**

- [ ] **Step 4: Point the guide at presets**

Each `## Animations` line in `ref.md` ends with `preset: <key>`. Plan Task 0 copies `presets.ts` and the components into `src/components/motion/`. AGENTS rule 7 says: "use `<Appear preset=…>` / `<Reveal preset=…>`; never type a duration, delay or ease".

- [ ] **Step 5: Run tests and regenerate**

Run: `npm test && npm run typecheck`. Expected: PASS. The regenerated hero `ref.md` names `hero-title`.

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(ai-guide): emit motion presets from exact transitions"
```

### Task 3: Rule-based converter as the starting point

**Files:**
- Modify: `src/cli/index.ts` (guide flow)
- Modify: `src/ai-guide/plan.ts`
- Modify: `src/ai-guide/templates/agents.ts`
- Modify: `src/nextjs/framer/motion-map.ts` (use `AnimationSpec.transition`)
- Test: `tests/unit/ai-guide-plan.test.ts`, new case in `tests/integration-nextjs/`

**Interfaces:**
- Consumes: `MotionPreset` / `AnimationSpec.transition` from Task 2; `results/<route>.json` shape from Task 5 if Task 5 is done first.
- Produces: `ai-guide/results/baseline.json` = `{ [sectionId]: { 1440: number; 1024: number; 390: number } }`; `planStepKind(sectionId: string, baseline: Baseline): 'refactor' | 'build'`.

- [ ] **Step 1: Measure the baseline**

Run `framer-export to-nextjs` on Clara & Theo and record per-section `compare` scores. Any section below 90% keeps today's "build from markup" step. Write the numbers into this plan under the step.

- [ ] **Step 2: Write the failing tests**

`planStepKind('01', { '01': { 1440: 99, 1024: 98, 390: 97 } }) === 'refactor'`; below 90 at any width → `'build'`. A refactor step's text contains "rename", "src/components/ui", "src/content" and "≥ 99% of the converter's score". Integration: the emitted hero passes `transition` from its preset to motion.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test && npm run test:nextjs`. Expected: FAIL.

- [ ] **Step 4: Implement**

Guide generation runs the converter first into `nextjs-app/`, writes `baseline.json`, and `plan.ts` picks the step kind per section with `planStepKind`.

- [ ] **Step 5: Run tests**

Run: `npm test && npm run test:nextjs`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git commit -am "feat: start rebuilds from the rule-based converter"
```

### Task 4: Rules as failing checks

**Files:**
- Create: `src/ai-guide/templates/check.ts` (writes `ai-guide/scripts/check.mjs`)
- Modify: `src/ai-guide/index.ts` (write the script)
- Modify: `src/ai-guide/plan.ts` (group repeated sections)
- Modify: `src/ai-guide/templates/agents.ts`
- Test: `tests/unit/ai-guide-check.test.ts`

**Interfaces:**
- Produces: `npm run check` in `nextjs-app/` → exit 1 and one line per violation: `<file>:<line> <rule> <message>`. Rule ids are fixed strings used by Task 5.

Rules (each with one failing and one passing fixture):

1. `no-framer-names` — a `className` contains `framer-` or matches `preset-[a-z0-9]{6,7}`.
2. `no-raw-img` — a JSX `<img`.
3. `content-in-content` — a text from `sections.json` (2+ words) appears as a literal in `src/components/**`, except inside `alt=`, `aria-label=` or an exported `metadata`.
4. `no-duplicate-components` — two component files whose normalised tokens are ≥ 90% the same.
5. `data-section` — every section id in `sections.json` appears as `data-section="<id>"` somewhere in `src/`.
6. `no-typed-timing` — `duration:` or `delay:` as a literal in `src/components/**` outside `src/components/motion/`.

- [ ] **Step 1: Write the failing tests** for all six rules, including `alt="Clara and Theo running…"` → no violation.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`. Expected: FAIL.

- [ ] **Step 3: Implement `check.mjs`** with Node built-ins only (regex over files, `path.join`, no Babel).

- [ ] **Step 4: Group repeats in the plan**

Siblings whose layer names differ only by a trailing number (`Gallery — Print 1…5`) become one step: build one `GalleryPrint` component, used 5 times, all five `data-section` ids on its instances.

- [ ] **Step 5: Run against the two real rebuilds**

Run `check.mjs` on `../wedding-web-3.8high-gemini/nextjs-app`: must report rules 1, 2, 3 and 4. Run it on the Claude rebuild: should pass or list only real issues. Record both outputs in the commit message.

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(ai-guide): enforce rebuild rules with a check script"
```

### Task 5: Scripts own the scores

**Files:**
- Modify: `src/ai-guide/templates/compare.ts`, `src/ai-guide/templates/parity.ts`
- Create: `src/ai-guide/templates/gate.ts` (writes `ai-guide/scripts/gate.mjs`)
- Modify: `src/ai-guide/plan.ts`, `src/ai-guide/templates/agents.ts` ("done" = `npm run gate` exits 0)
- Test: `tests/unit/ai-guide-gate.test.ts`

**Interfaces:**
- Consumes: `check.mjs` from Task 4.
- Produces: `ai-guide/results/<route>.json`:

```ts
{
  sections: { [id: string]: { scores: { 1440: number; 1024: number; 390: number }; motion: boolean; at: string; componentHash: string } };
  parity: { layout: number; motion: number; interaction: number };
}
```

  and `gate.mjs`: runs `check.mjs`, reads the results files, exits 1 if any section is < 90 at any width, has `motion: false` where its ref lists animations, or has a `componentHash` that no longer matches its file.

- [ ] **Step 1: Write the failing tests**: missing results → exit 1; stale hash → exit 1; all ≥ 90 with motion and `check` clean → exit 0.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`. Expected: FAIL.

- [ ] **Step 3: Implement** the JSON writes in compare/parity and `gate.mjs`; add `"gate": "node ../ai-guide/scripts/gate.mjs"` to the scripts the plan's Task 0 writes.

- [ ] **Step 4: Run tests and the gate on the Claude rebuild**

Run: `npm test`. Expected: PASS. Then regenerate the guide and run `npm run gate` in the Claude rebuild; record the result.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(ai-guide): script-owned scores and a single gate"
```

### Task 6: Instruction files for every agent

**Files:**
- Modify: `src/ai-guide/index.ts:710-711`
- Modify: `src/ai-guide/templates/readme.ts`
- Test: `tests/unit/ai-guide-cli.test.ts`

- [ ] **Step 1: Write the failing test**: the export root contains `GEMINI.md`, `.cursorrules` and `.github/copilot-instructions.md`, each byte-equal to `AGENTS.md`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`. Expected: FAIL.

- [ ] **Step 3: Implement** the three writes next to `AGENTS.md` / `CLAUDE.md`, and add them to the readme's "What is where" table.

- [ ] **Step 4: Run tests**

Run: `npm test`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(ai-guide): instruction files for Gemini, Cursor and Copilot"
```
