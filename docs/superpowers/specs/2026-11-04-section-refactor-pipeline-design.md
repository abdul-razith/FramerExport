# Section-Refactor Conversion Pipeline — Design

Date: 2026-11-04
Status: Draft for review
Supersedes: the AI-task and verify parts of `2026-11-02-framer-to-nextjs-converter-design.md`
(analyze, extract-cms and scaffold stay as they are, with the changes listed in section 12).

## 1. Problem

Converting a single exported page to Next.js took 3 h 51 m and still failed
(`portfolio` → `portfolio-next`, 2026-11-04). Timing from `.convert/state.json`:

| Step | Time |
|---|---|
| Setup (analyze, CMS, scaffold) | 2 m |
| `001-shell` agent | 11 m |
| `101-page-home` agent | 9.5 m |
| `next build` + verify | ~1 m |
| `fix-101-page-home-1` agent | **3 h 27 m**, ended only by `RESOURCE_EXHAUSTED (429)` agent quota |

Root causes, each confirmed in code or artifacts:

1. **Verify demanded things no agent can deliver.**
   - Live clock text compared literally (`4:09:56 AM` vs `12:06:02 PM`); no fixed clock in `verify/settle.ts`.
   - Script-drawn content (ruler `0 100 … 2800`, loader text "Welcome!") is not in the HTML, and the rules
     forbid copying the export's scripts.
   - `verify/dom-check.ts` counts links and images inside CSS-hidden breakpoint variants on the Next side,
     while Framer's runtime removes inactive variants from the export DOM, so mismatches like
     `expected "" / actual "./case-study/meridian-health"` are permanent.
   - Next-side links are not normalized (`/` vs `./`).
   - The page task is judged on animation end states (CTA at 33–51 % pixel diff) that only the later
     motion task produces.
   - Gate: ≤ 0.5 % pixel diff for every section at 3 widths, plus zero DOM mismatches.
2. **The fix agent could only edit the wrong file.** The markup lives in `src/views/home.tsx` (426 KB,
   written by `generate`); the fix task allowed only `src/app/page.tsx`, so the agent injected CSS overrides
   and DOM-pruning scripts there.
3. **No time limit, contradictory instructions.** `runAgentOnTask` has no timeout. The prompt says "do not
   run verify"; the task's "Done when" and `AGENTS.md` say "run verify". The agent compromised by running its
   own builds, `next dev` and a homemade diff script. `next dev` also injected the Next.js agent-rules block
   into `AGENTS.md` ("read `node_modules/next/dist/docs/` before writing any code").
4. **Task too large.** One fix task listed 18 pixel failures and ~40 DOM mismatches, mostly unfixable.

## 2. Goal and success criteria

Turn a Framer export into a Next.js project whose pages are **clean, editable Tailwind React components**
(so pages and sections can be restyled after conversion), that **looks and moves like the original**, in
**about 15–30 minutes of active time per page**, without ever looping for hours.

Success means, for a converted export:

- Every page renders and builds with `next build`.
- Section code uses Tailwind utilities, no `framer-*` class names, and one responsive component instead of
  per-breakpoint copies.
- Animations and script-drawn widgets (clock, ruler, loader) are rebuilt.
- With testing on: every section is within 3 % of the original in the final report or is listed as
  `needs-review`; animations appear in the report's filmstrips.
- No agent process runs past its time limit; no out-of-scope file change is left behind.
- Testing on, concurrency 1, `claude`: ≤ ~30 min active time per page (excluding CMS detail items, which
  share their template's tasks).

## 3. Decisions made during brainstorming

| Topic | Decision |
|---|---|
| Output style | Clean Tailwind rewrite (option B), not Framer classes + Framer CSS |
| Fidelity | Looks and behaves like the original; verification lenient and fast, not pixel-perfect |
| Approach | Generate a near-exact copy, then AI refactors it **section by section** (approach B) |
| Testing | Optional, chosen by the user per conversion: "with testing" / "without testing" |
| Concurrency | 1–3 parallel agents, asked at run time |
| Agents | Both `agy` and `claude` |
| Animations | Must be rebuilt; implemented inside each section's task |
| Time budget | 15–30 min per page; hard limits per agent run |
| Existing `out/` projects | Delete; re-export `portfolio` with `--subpages`; re-convert from scratch |
| Test corpus now | Re-exported multi-page `portfolio` + `tests/fixtures/framer-nudge-mini` |

### Out of scope

- Non-Framer platforms; localized / multi-language sites.
- Rebuilding Framer code components with backend behaviour (forms, embeds, maps): they become placeholder
  stubs listed in the report.
- Automated judgement of animation timing or easing (filmstrips are reviewed by eye).
- Migrating projects converted by the old pipeline (they are re-converted; section 12).
- A deterministic CSS→Tailwind compiler (possible later pre-pass; not needed now).

## 4. Pipeline overview

```
analyze → extract-cms → scaffold → install → generate → tasks → [baseline] → agent loop → finalize
```

- **Stages run automatically** up to and including `tasks` (and `baseline` when testing is on). After them
  the generated site already works and looks like the original; it just is not clean Tailwind yet.
- `install` (`npm install`) and `generate` become pipeline stages instead of dashboard actions.
- The **agent loop** runs section tasks (in parallel), then page tasks, with fix attempts when testing is on.
- **Finalize** removes Framer CSS once no `framer-` class is left, runs `next build`, and (testing on)
  writes the report.

### Run options

Asked once at conversion start ("Start conversion?" is followed by "Use default options?" → Yes, or set
each). Stored in `state.options`; shown and changeable from the dashboard's "Run AI agent" action.

| Option | Values | Default |
|---|---|---|
| `testing` | `on` / `off` | `on` |
| `agent` | `agy` / `claude` (only those found on PATH) | first found |
| `concurrency` | 1 / 2 / 3 | 1 |
| `sectionTimeoutMin` | number | 15 |
| `pageTimeoutMin` | number (also used by shell tasks) | 15 |
| `pixelTolerance` | per-section ratio for checks | 0.01 |
| `reportTolerance` | per-section ratio for the final report | 0.03 |

### What testing changes

| Step | Testing on | Testing off |
|---|---|---|
| Baseline capture after `generate` | yes (~1 min) | no |
| After each task | section check (pixels + visible DOM + motion presence); one fix attempt on failure | smoke check (compiles, section renders at non-zero size) |
| Agent may run | `fexport convert check <taskId>` | `fexport convert check <taskId> --smoke` |
| Finalize | `next build` + report vs original export | `next build` only |

Switching testing on later works for sections not yet done; sections already done are judged only in the
final report (their baseline was never captured).

## 5. Generate: one file per section

`generate` keeps its current mechanism (static snapshot of `#main` with JavaScript disabled, appear states
restored from a live load, DOM→JSX via `DOM_TO_JSX_SRC`) and adds the steps below.

### 5.1 Section files

- Sections come from `adapters/framer/sections.ts` (already generic; falls back to one `page` section).
  On `portfolio` they are top-level siblings, so cutting them out is deterministic.
- Each section with content is written to `src/sections/<page>/<Section>.tsx` (PascalCase name from the
  section name, deduplicated), default-exporting a component whose root keeps `data-section="<name>"`.
- `src/views/<page>.tsx` keeps only Framer's outer wrappers and renders the section components in order.
- **Empty sections** (< 1 KB of JSX, no visible text, `img`, `svg` or `a`) stay inline in the view and get
  no task (on `portfolio`: `section-6`, `section-7`, `button`, `section-11`).
- Oversized sections (> 120 KB after slimming) are split by their named child layers into part files
  `src/sections/<page>/<Section>/<Part>.tsx`, each with its own task; the section file composes the parts.

### 5.2 Slimming (provably no-op)

Runs in the headless browser before JSX is written, on the snapshot DOM with the export's CSS loaded:

- For each element with an inline style, remove each property and compare `getComputedStyle` of the element
  before and after; keep the removal only if no computed value changed. (On `portfolio`, 1,803 inline style
  objects / 250 KB, dominated by `transform: none` ×1,120, `display: contents` ×1,019, `opacity: 1` ×968.)
- Rewrite `var(--token-<uuid>, <fallback>)` to the readable theme variable from `analysis/tokens.json`
  `tokenMap` (already defined in `src/app/globals.css`).

Both are exact transformations; the generated site must look identical before and after (unit-tested on
fixtures; see section 11).

### 5.3 Annotations for the agent

Written into the JSX as attributes or comments, all deterministic:

- `data-variant="desktop|tablet|phone"` on wrappers carrying Framer `hidden-xxxx` classes, mapped through the
  media queries in the export CSS.
- `data-motion="m<n>"` on every element matched by an `animations.json` selector (stable anchors that
  survive the refactor).
- `{/* cms: <field> */}` before text or `img` whose value equals a CMS field of the current item
  (dynamic routes only).
- `{/* script-drawn: <id> */}` at the position of script-drawn content (5.4).

### 5.4 Script-drawn content detection

`generate` already loads each page live (for appear states) and statically. It additionally:

1. Compares visible text and element boxes of the live, settled page with the static snapshot; anything
   visible only in the live page is **script-drawn**, recorded with section, box and a text sample.
2. Captures the live page again 2 s later; script-drawn entries whose text or pixels changed are flagged
   **ticking** (e.g. a clock).

Results go to `.convert/analysis/script-drawn.json` and into the section task.

### 5.5 CMS templates

For a dynamic route, `generate` snapshots only the **first item** as the template, writes its sections under
`src/sections/<route-slug>/`, and the route renders them with the item from `src/content/<collection>.ts`
looked up by slug. All items share that template's tasks. (Today every item becomes its own view.)

### 5.6 Shared sections (shell)

A section name present on ≥ 2 pages becomes a **shell section** when its instances' markup is identical, or
differs only in text and link values (e.g. the active nav item). It is written once to
`src/components/shell/<Name>.tsx` and every page's view imports it; the shell task lists the per-page
differences so the agent can add props. Instances that differ structurally stay per-page sections.

## 6. Tasks

### 6.1 Kinds and order

| Kind | Id | Targets | When |
|---|---|---|---|
| `shell` | `shell-<name>` | `src/components/shell/<Name>.tsx` (+ `<Name>/` dir) | first, run alone |
| `section` | `sec-<page>-<section>` | `src/sections/<page>/<Section>.tsx` (+ `<Section>/` dir) | in parallel |
| `page` | `page-<page>` | `src/views/<page>.tsx`, `src/components/page/<page>/` | after the page's sections are done |
| `fix` | `fix-<taskId>` | the original task's targets | testing on, after a failed check; max 1 per task |

The old `component` and `motion` kinds are removed (section 12). Motion moves into section tasks: the agent
already has the section in context, and a second session per page would repeat the costly part (start-up and
reading). The `page` task refactors the view's outer wrappers to Tailwind and implements page-level effects
not inside any section (Lenis smooth scroll, page loader, custom cursor).

### 6.2 Section task contents

- Goal: refactor this section to clean Tailwind, same look at 1440 / 1000 / 390 px, plus its animations and
  script-drawn parts.
- The target file **is** the input: generated Framer JSX, slimmed and annotated.
- Breakpoints: "elements under `data-variant` are the same content per breakpoint; merge them into one
  responsive component with `md:` (≥ 810 px) and `lg:` (≥ 1200 px)".
- Repeated items: instances of the same Framer component (from `components.json`, e.g. `Project 1–4`) are
  named; render them from a data array with one component.
- Animations for `data-motion` elements in this section, with decomposed values, e.g.
  `m12 "Comment" (scroll, 1.3 s): opacity 0→1, scale 0.8→1, y 20px→0`. Matrices are decomposed into
  translate / rotate / scale / skew when the task is written.
- Script-drawn items in this section, e.g. `ruler with labels 0…2800 every 100 px` and
  `clock showing current time, ticking every second`.
- CMS fields (dynamic routes): render from the `item` prop.

### 6.3 Shared rules (task files, prompt and `AGENTS.md` say the same)

- Edit only the listed targets (a target ending in `/` allows new files inside that directory).
- Tailwind utilities (arbitrary values allowed); no `framer-` class names; no inline `style` except motion
  values and CSS custom properties.
- Keep the root `data-section` attribute and every `data-motion` attribute.
- Keep `img` elements' `src`, `srcSet`, `sizes` and `alt` (plain `img`, not `next/image`).
- Use `src/lib/motion.ts` / `src/lib/gsap.ts`; framer-motion for appear and hover, GSAP ScrollTrigger for
  scroll-linked motion. Under `?__verify=1` everything renders in its finished state.
- **Never run `npm run build`, `next dev`, `next start` or `npm install`.**
- Testing on: check with `fexport convert check <taskId>`; testing off: `fexport convert check <taskId>
  --smoke`. Stop when it passes or when it says the limit is reached.

## 7. Agent runner

1. **One fixed prompt**: `Read AGENTS.md and <taskFile>, then complete that task. Edit only the files listed
   under Edit only. <check instruction for the mode>.` No contradiction with the task file.
2. **Time limits**: wall-clock timer per agent process (`sectionTimeoutMin` / `pageTimeoutMin`). On expiry
   the process tree is killed (`taskkill /T /F` on Windows, process-group `SIGTERM` then `SIGKILL`
   elsewhere). The agent's edits are kept and checked normally; a timeout counts as an attempt.
3. **Worker pool** of `concurrency` workers. Shell tasks run first with one worker; section tasks of all pages
   in parallel; a page task becomes ready when all its sections are `done` or `needs-review`.
4. **Scope enforcement with revert**: before a task, snapshot contents of `src/`, `public/`, root config files
   (`package.json`, `next.config.ts`, `tsconfig.json`, `postcss.config.mjs`, `eslint.config.mjs`),
   `AGENTS.md`, `CLAUDE.md` and the list of root files. Afterwards, revert any change outside the task's
   targets and outside the targets of tasks still running, delete new files created outside them, and report
   what was reverted. Ignored: `next-env.d.ts`, `.next/`, `node_modules/`, `.convert/` (except
   `.convert/tasks/`, which is protected).
5. **Quota detection**: agent output matching `429`, `RESOURCE_EXHAUSTED`, `quota`, `usage limit` or
   `rate limit` stops new task dispatch, lets running workers finish, and prompts
   `"<agent> quota reached (<reset hint if present>). Switch to <other agent> and continue?"`.
6. **Never blocks**: a task failing its check after its fix attempt (or timing out twice) becomes
   `needs-review`; the queue continues.
7. **Resume**: state saved after every status change; `in-progress` tasks become `pending` on the next start.
8. **Live display**: one line per worker, e.g.
   `W1 · / · Hero + About · claude · 4m 12s · editing HeroAbout.tsx`, above the overall progress line.
9. **Logs**: `.convert/logs/<taskId>.log` as today.

## 8. Dev server and checks

### 8.1 Dev server

The agent loop starts one `next dev` server (free port, `NEXT_TELEMETRY_DISABLED=1`) and records
`{ pid, port, startedAt }` in `.convert/dev-server.json`; it is stopped when the loop ends. A `check`
invoked while no server answers starts one and leaves it for the loop to reuse. The scaffold writes
`agentRules: false` into `next.config.ts`, so `next dev` never edits `AGENTS.md` (verified in Next 16.4.4,
`server/lib/start-server.js`).

### 8.2 Deterministic capture environment (`verify/env.ts`)

Used by baseline, checks and report:

- Fixed clock: `Date` / `Date.now` / `performance.timeOrigin`-based clocks overridden before page scripts
  (`evaluateOnNewDocument`) to a constant timestamp.
- `prefers-reduced-motion: reduce` emulated; the existing freeze CSS, `?__verify=1`, scroll-through,
  GSAP-to-end and fonts/network-idle settle steps.
- Viewport widths: 1440 / 1000 / 390 (constant for now; reading custom Framer breakpoints is out of scope).

### 8.3 Baseline (testing on)

Right after `tasks`, with the dev server up and before any agent runs: for every task's section, an element
screenshot at each width plus a DOM summary (visible text, normalized links, image file names) is saved to
`.convert/baseline/<page>/<section>/<width>.{png,json}`. Recaptured only when `generate` runs again.

### 8.4 `fexport convert check <taskId> [--smoke]`

- Loads the task's page on the dev server (dynamic routes: the first item) and captures **only that
  section's element** at each width (shell: on its first page; page task: every section of the page).
- **Smoke**: HTTP 200, the section element exists with non-zero size, no Next error overlay.
- **Full** (default):
  - Pixels: pixelmatch threshold 0.1 with anti-aliasing ignored; pass if diff ratio ≤ `pixelTolerance` and
    height delta ≤ 4 px.
  - DOM: visible elements only (`checkVisibility()`); text whitespace-collapsed; links normalized on both
    sides; image file names.
  - Code: no `framer-` class in the targets; every `data-motion` id of the section still present.
  - Motion presence: for each `data-motion` element, load without freezing, sample computed
    `opacity / transform / filter / clip-path` before and after the trigger (load, scroll into view, hover,
    or 2 s apart for loops); pass if it changes in roughly the recorded direction.
- Output: pass/fail per width with score, expected / actual / diff PNG paths, and up to 3 bounding boxes of
  the largest diff clusters (`diff concentrated at x 120–340, y 40–90`). Exit code 0 pass, 1 fail.
- **Call limit**: calls are counted per task in `state.json`; from the 4th call it prints
  `Limit reached: stop and finish; the pipeline will review this section.` and exits 2.

### 8.5 Pipeline check after each task

Runs the same `check` (full or smoke per mode). On failure with testing on: write `fix-<taskId>` containing
only that task's failures (pixel scores, boxes, image paths, DOM and motion items), run it once, check
again, then `done` or `needs-review`.

## 9. Finalize and report

1. When all shell / section / page tasks are `done` or `needs-review`: if no `framer-` class remains under
   `src/`, remove the `@/styles/framer/*.css` imports and the `src/styles/framer/` folder; otherwise keep
   them and warn.
2. Testing on: re-run the check for every section after the removal (fast, dev server); new failures become
   `needs-review`.
3. `next build` (both modes). A build failure writes a `fix-build` task (max 2 attempts) as today.
4. **Report** (testing on): `next start` on the production build and the export server side by side;
   full-page captures at 3 widths; per-section scores against the **original export** with
   `reportTolerance`.
   - Dynamic regions are masked automatically: the export is captured twice 2 s apart and changed pixels are
     masked in both images (no site-specific rules).
   - Filmstrips: ~6 frames on load and while scrolling, original vs Next.
   - Output `.convert/report/index.html` (+ images): per page and section original | Next | diff, scores,
     filmstrips, `needs-review` list, placeholder stubs, total time.
   - Informational, not a gate. The dashboard offers "Open report".

## 10. Dashboard and CLI

Dashboard actions: Run AI agent (shows options, can change them), Run checks / report, View status,
Open report, Mark section reviewed (accepts a `needs-review` task as done), Change run options, Exit.
Removed: Install dependencies and Generate (now stages), Mark motion task done (no motion kind).

Progress line: `▓▓▓░░ Pages 2/7 · Sections 14/31 · Review 1 · Overall 42m`.

CLI: `fexport convert <exportDir> [nextDir] [--yes] [--testing on|off] [--agent agy|claude]
[--concurrency 1-3]`, `status`, `next`, `check <taskId> [--smoke]`, `run` (headless agent loop),
`report`, `review <taskId>`, `ui`. `verify` remains as an alias of `report`.

## 11. Testing the change

- **Unit** (`node --test`): section splitting and empty-section rules; slimming equivalence on fixture DOMs;
  token rewriting; matrix decomposition; variant / motion / CMS annotations; script-drawn detection diffing;
  shell detection; quota-pattern detection; runner timeout and process-tree kill; scope snapshot and revert
  with concurrent tasks; `check` call limit; state v1→v2 migration and moved-folder resolution;
  visible-only DOM comparison; link normalization; dependency ordering of the worker pool.
- **Fake agent**: a small Node script standing in for `agy` / `claude` that, per scenario, edits its target,
  edits an out-of-scope file, hangs, or prints a quota error. All runner tests use it; no real agent in tests.
- **Integration** (puppeteer, `test:browser`): `framer-nudge-mini` (multi-page, CMS, shell) and the
  re-exported `portfolio`: generate → baseline → fake-agent loop → finalize, both testing modes.
- **Manual acceptance** with real agents on the re-exported `portfolio`: the success criteria in section 2.
- Every commit keeps `npm test` and `npm run typecheck` green; obsolete tests of removed behaviour are
  deleted with it.

## 12. Portability and migration

- `state.json` **version 2**: `exportDir` stored relative to the project; `nextDir` not stored (derived from
  the project location); new fields `options`, per-task `checkCalls`, `needs-review` status.
- Loading **version 1**: paths are migrated; if the stored absolute `exportDir` does not exist, try
  `<project>/../<basename>`, else ask. Projects whose tasks use the old kinds (`component`, `motion`, or the
  old page-task model) cannot run the new agent loop: the dashboard offers "Re-convert with the new
  pipeline", which renames the folder to `<name>.old` and converts again.
- `AGENTS.md`, `CLAUDE.md` and task files are **regenerated at every run start** from state and the current
  `CLI_INVOCATION`, so moved projects never reference another machine's paths.

## 13. Code map

New:
- `src/convert/generate/split.ts` (section files, parts, empty sections, view composition)
- `src/convert/generate/slim.ts` (computed-style no-op removal, token rewrite)
- `src/convert/generate/annotate.ts` (variants, motion anchors, CMS hints)
- `src/convert/generate/script-drawn.ts`
- `src/convert/generate/shell.ts`
- `src/convert/tasks/motion-values.ts` (matrix decomposition)
- `src/convert/runner/` (`pool.ts`, `agent-process.ts`, `scope.ts`, `quota.ts`)
- `src/convert/verify/env.ts`, `baseline.ts`, `check.ts`, `report.ts`, `dev-server.ts`
- `src/convert/state-migrate.ts`
- `tests/fixtures/fake-agent.mjs` and unit / integration tests listed in section 11

Changed:
- `src/convert/pipeline.ts` (stages, options), `src/convert/types.ts`, `src/convert/state.ts`
- `src/convert/stages/tasks.ts` and `src/convert/tasks/templates/index.ts` (new kinds, rules, prompt)
- `src/convert/stages/scaffold/files.ts` (`agentRules: false`)
- `src/convert/generate/index.ts` (orchestrates the new generate steps)
- `src/convert/verify/dom-check.ts` (visible-only, two-sided link normalization)
- `src/convert/index.ts` (CLI), `src/convert/progress.ts`
- `src/cli-v2/screens/convert-dashboard.ts`, `convert-agent.ts`, `convert-run.ts`, `convert-helpers.ts`
- `CONVERT_GUIDE.md`, `CHANGELOG.md`

Removed:
- `src/convert/stages/verify.ts` (replaced by `verify/check.ts` + `verify/report.ts`) and the old
  component / motion task paths.

## 14. Risks and open points

- **Slimming cost**: per-property computed-style comparison over ~2,000 elements per page; if it exceeds
  ~30 s per page, compare per element with all candidate properties removed at once and fall back per
  property only on change.
- **Dev vs production rendering** can differ slightly; checks use dev, the final report uses production.
- **Section detection on other sites** may give few, very large sections; part splitting (5.1) covers size,
  and the wider corpus test (later) will show more.
- **Agent quality differs** between `agy` and `claude`; the time limits and `needs-review` keep a weak run
  bounded rather than long.
- **Motion presence check** may be noisy for low-confidence animations; those are reported, not failed.
- **Time estimates** (~25–30 min per page sequential, ~12–18 min with 3 workers) are projections from the
  failed run's numbers and must be confirmed in manual acceptance.
