# Framer → Next.js Converter Guide

`fexport convert` turns a Framer export (made with `framer-export`) into a clean, production-style **Next.js** project:

- **Next.js 16** App Router, **TypeScript** (strict), **Tailwind CSS v4**
- **framer-motion**, **GSAP** (+ `@gsap/react`), **Lenis** smooth scroll
- Typed CMS content (`src/content/*.ts`) extracted from Framer's `.framercms` data
- Clean, editable Tailwind React components — no Framer runtime code or `framer-*` class names remain

The conversion uses a **section-refactor pipeline**:
1. Automatic code stages analyze the export, extract CMS data, scaffold the project, install dependencies (`npm install`), split pages into section components (`src/sections/<page>/<Section>.tsx`) with slimmed JSX and mapped tokens, and write granular tasks.
2. An automated AI agent runner (`claude` or `agy`) refactors sections concurrently into clean responsive Tailwind components, implementing animations and script-drawn widgets.
3. Verification checks (full visual, DOM, and motion checks, or fast smoke checks) validate each section against baseline captures.
4. Finalize cleans unused Framer styles, validates `next build`, and produces an interactive visual comparison report (`.convert/report/index.html`).

> Status: **beta**, Framer exports only.

---

## 1. Requirements

- Node.js **20+** (22 recommended)
- This repo installed: `npm install` then `npm run build` inside `FramerExport/`
- A Framer export folder created by `framer-export` (it contains `index.html`, `subpages/`, `assets/`, `data/`, `serve.js`, `export-report.json`)
- An AI coding agent: Claude Code (`claude`) or Antigravity (`agy`) installed and accessible on PATH (any agent that reads `AGENTS.md`/`CLAUDE.md` works)

---

## 2. Quick start

```bash
# inside FramerExport/
npm install
npm run build

# 1) export a Framer site (skip if you already have one)
node bin/fexport.js https://your-site.framer.website --subpages

# 2) convert the export into a Next.js project
node bin/fexport.js convert out/framer-your-site ../your-site-next
```

If `framer-export` is installed globally you can write `fexport convert ...` instead of `node bin/fexport.js convert ...`.

Non-interactive runs can pass options directly on the command line:
```bash
node bin/fexport.js convert out/framer-your-site ../your-site-next --yes --testing on --agent claude --concurrency 1
```

**What runs automatically.** The initial conversion command runs stages up through `tasks` (and `baseline` when testing is on):
`analyze` → `extract-cms` → `scaffold` → `install` → `generate` → `tasks` → `baseline`.
At this stage:
- Dependencies are installed (`npm install` has run).
- Pages are divided into section files (`src/sections/<page>/<Section>.tsx`) with slimmed JSX and theme token mappings.
- Shared shell sections are extracted into `src/components/shell/<Name>.tsx`.
- The Next.js dev server starts and captures baseline screenshots and DOM summaries in `.convert/baseline/`.
- The site already compiles and looks identical to the original export.

### 3) Launch the AI agents

Refactor the generated sections into clean, responsive Tailwind code using either the headless runner or the interactive dashboard:

- **Headless agent runner:**
  ```bash
  cd ../your-site-next
  fexport convert run
  ```
  Runs tasks concurrently in a multi-worker pool. Press Ctrl+C to pause (see the pause behaviour in section 6).

- **Interactive Conversion Dashboard (recommended):**
  ```bash
  fexport convert ui
  ```
  Opens the terminal dashboard. Select **Run AI agents** to start the worker pool, or **Resume conversion** if paused.

### 4) Review the visual comparison report

```bash
fexport convert report
```
Generates an interactive visual comparison report in `.convert/report/index.html` comparing the production build against the original export.

### Progress and time

The agent runner displays live progress per worker:

```
W1 · / · Hero + About · claude · 4m 12s · editing HeroAbout.tsx
▓▓▓░░ Pages 2/7 · Sections 14/31 · Review 1 · Overall 42m
```

Time is **active working time**: setup, agent runs, checks, and builds. Time you spend away while the conversion is paused is not counted. It is saved in `.convert/state.json` and printed by `fexport convert status` and upon runner completion.

---

## 3. Commands

| Command | Where to run | What it does |
|---|---|---|
| `fexport convert <exportDir> [nextDir] [--yes] [--testing on\|off] [--agent agy\|claude] [--concurrency 1\|2\|3]` | anywhere | Runs automated setup stages (`analyze` through `tasks` / `baseline`). `nextDir` defaults to `<exportDir>-next`. |
| `fexport convert status` | inside converted project | Shows pipeline stage status, task backlog, warnings, time summary, and overall progress. |
| `fexport convert next` | inside converted project | Shows the next pending task for an AI coding agent (fix tasks first, then shell, section, page). |
| `fexport convert check <taskId> [--smoke]` | inside converted project | Runs validation checks on a completed task against baseline (exit 0: pass, 1: fail, 2: call limit reached). |
| `fexport convert run` | inside converted project | Headless AI agent runner pool. Runs tasks concurrently. Ctrl+C pauses (section 6). |
| `fexport convert report [route]` | inside converted project | Generates visual comparison report against the original export (`verify` is an alias). Optional route filters by page. |
| `fexport convert review <taskId>` | inside converted project | Marks a `needs-review` task as done after human inspection. |
| `fexport convert ui` | anywhere or inside project | Opens the interactive terminal Conversion Dashboard. |

Windows + Git Bash tip: when specifying the root route `/` for report, run `MSYS_NO_PATHCONV=1 fexport convert report /`.

---

## 4. Pipeline stages & the working loop

### Pipeline stages

```
analyze → extract-cms → scaffold → install → generate → tasks → [baseline] → agent loop → finalize
```

1. **`analyze`:** Scans export HTML/CSS, detects page routes, design tokens, HTML/CSS slices, and animations.
2. **`extract-cms`:** Parses Framer CMS collections into typed content files under `src/content/*.ts`.
3. **`scaffold`:** Scaffolds Next.js 16 App Router structure, Tailwind CSS v4 `@theme`, `@font-face` rules, shared animation setups (`src/lib/motion.ts`, `src/lib/gsap.ts`), and config files.
4. **`install`:** Automatically runs `npm install` inside the converted project.
5. **`generate`:** Splits pages into section components (`src/sections/<page>/<Section>.tsx`). Slims redundant inline styles (provably no-op computed-style checks); rewrites color/font variables to Tailwind theme tokens; marks variants (`data-variant`), motion anchors (`data-motion`), CMS field hints, and script-drawn widgets; extracts shared shell sections (`src/components/shell/<Name>.tsx`); and handles dynamic CMS routes.
6. **`tasks`:** Generates structured markdown task files under `.convert/tasks/`.
7. **`baseline`:** (Testing on) Boots dev server and captures screenshots (1440, 1000, 390 px) and DOM snapshots of all sections before AI agents touch them.
8. **`agent loop`:** Concurrently refactors tasks using the worker pool:
   - `shell` tasks run first with 1 worker to build shared navigation, footer, and shell components.
   - `section` tasks run in parallel across pages: refactor section JSX to clean Tailwind, make responsive (`md:`, `lg:`), and implement animations and script-drawn items.
   - `page` tasks run once all sections of the page are completed: refactor outer view wrappers and page-level effects (Lenis smooth scroll, page loader, custom cursor).
   - If a check fails (testing on), one `fix-<taskId>` attempt is generated and run. If it fails again, it becomes `needs-review`.
9. **`finalize`:** Checks if any `framer-` classes remain; if none remain, removes `@/styles/framer/*.css` and `src/styles/framer/`; runs `next build`; and (testing on) creates the visual report.

### Task kinds and order

| Kind | Task ID format | Target files | Description |
|---|---|---|---|
| `shell` | `shell-<name>` | `src/components/shell/<Name>.tsx` (+ `<Name>/`) | Shared navigation, footer, and shell components. Run first, alone. |
| `section` | `sec-<page>-<section>` | `src/sections/<page>/<Section>.tsx` (+ `<Section>/`) | Section components refactored to Tailwind, responsive breakpoints, animations, and widgets. Run in parallel. |
| `page` | `page-<page>` | `src/views/<page>.tsx`, `src/components/page/<page>/` | Outer view wrappers, smooth scroll (Lenis), loaders, custom cursors. Run after a page's sections are done. |
| `fix` | `fix-<taskId>` | Same as target task | Generated when a task check fails (testing on, max 1 fix attempt per task). |

### The working loop

You can run the conversion automatically or step-by-step:

- **Automated loop (recommended):** Run `fexport convert run` or select "Run AI agents" in `fexport convert ui`. The worker pool handles concurrency, timeouts, and checks automatically.
- **Manual / Assisted loop:**
  1. Run `fexport convert next` to view the next task file.
  2. Hand the task to Claude Code or Antigravity with this prompt:
     > Read `AGENTS.md` and `.convert/tasks/<taskId>.md`, then complete that task. Edit only the files listed under Edit only. Run `fexport convert check <taskId>` to verify your work.
  3. The agent refactors the target files and runs `fexport convert check <taskId> [--smoke]`.
  4. Repeat until all tasks are complete.

---

## 5. Run options & testing modes

### Run options

Options can be set at conversion start, changed via the Conversion Dashboard ("Run options"), or passed via CLI flags:

| Option | CLI flag | Values | Default | Purpose |
|---|---|---|---|---|
| `testing` | `--testing on\|off` | `on` / `off` | `on` | Strict verification mode: baseline capture, visual/DOM/motion checks, fix attempts, and report. |
| `agent` | `--agent agy\|claude` | `agy` / `claude` | first of agy, claude found on PATH | Which agent CLI executable to spawn. If it cannot be started, the run stops with a message naming the agent. |
| `concurrency` | `--concurrency 1\|2\|3` | 1, 2, 3 | 1 | Maximum concurrent agent worker processes. |
| `sectionTimeoutMin` | (options menu) | number | 15 | Hard wall-clock limit in minutes per section task attempt. |
| `pageTimeoutMin` | (options menu) | number | 15 | Hard wall-clock limit in minutes per page or shell task attempt. |
| `pixelTolerance` | (options menu) | number | 0.01 (1%) | Maximum pixel difference ratio for task checks. |
| `reportTolerance` | (options menu) | number | 0.03 (3%) | Maximum pixel difference ratio for the final report. |

Example command with custom options:
```bash
fexport convert out/portfolio out/portfolio-next --testing on --agent claude --concurrency 2
```

### What testing changes

| Pipeline step | Testing On (`--testing on`) | Testing Off (`--testing off`) |
|---|---|---|
| Baseline capture | Element screenshots and DOM snapshots captured after `generate` (~1 min) | Skipped |
| Task check | Full check: pixel diff ≤ 1%, visible DOM equality, motion presence; 1 fix attempt on failure | Smoke check: HTTP 200, compiles, section renders at non-zero size |
| Agent check command | `fexport convert check <taskId>` | `fexport convert check <taskId> --smoke` |
| Finalize | `next build` + visual comparison report against export | `next build` only |

---

## 6. Automated agent runner & interactive dashboard

### Headless runner (`fexport convert run`)

The headless runner coordinates an autonomous worker pool:

- **Worker pool:** Shell tasks run first with 1 worker; section tasks across all pages run in parallel up to `concurrency` (1–3); page tasks become ready once all sections of that page are completed.
- **Scope enforcement with automatic revert:** Before starting a task, the runner snapshots project files. After the task completes, any edits outside the task's allowed targets are reverted and reported, preventing agent stray modifications.
- **Wall-clock timeouts:** Tasks that exceed `sectionTimeoutMin` or `pageTimeoutMin` are halted and their process trees cleanly terminated (`taskkill /T /F` on Windows, process groups on POSIX).
- **Graceful and immediate pause:**
  - In a terminal, the first Ctrl+C asks: **Finish running tasks, then pause** or **Pause now**. A second Ctrl+C while the question is open (or cancelling it) pauses immediately.
  - Without a terminal (output piped, CI): the first Ctrl+C finishes running tasks, then pauses; a second Ctrl+C pauses immediately.
  - The headless runner has no `P` key; the `P` key works in the dashboard's run screen and asks the same question.
  - Target files of interrupted tasks are backed up to `.convert/partial/<taskId>/<timestamp>/`, restored to clean snapshot state, and reset to `pending`. Completed work is never lost!
- **Quota resilience & agent switching:** When an agent encounters API rate limits or quota errors (`429`, `RESOURCE_EXHAUSTED`), task dispatch stops and running tasks finish. The dashboard asks whether to switch to the other agent (`agy` ↔ `claude`) or stay paused. The headless runner switches automatically when the other agent is installed, otherwise it stays paused.
- **Safe resume:** `.convert/run.lock` stores runner and worker PIDs. Restarting cleanly terminates any stale orphan processes and restarts pending tasks.

### Interactive Conversion Dashboard (`fexport convert ui`)

The dashboard provides a visual control center:

| Dashboard action | Description |
|---|---|
| Resume conversion | Shown when a conversion is paused (preselected). Continues the agent queue. |
| Run AI agents | Start the agent worker pool (or reconfigure options first). |
| Generate visual report | Runs full-page captures and diffs against the original export. |
| Open visual report | Opens `.convert/report/index.html` in the default web browser. |
| Review tasks | Lists all `needs-review` tasks and allows marking them done. |
| Run options | Adjust agent, concurrency, testing mode, timeouts, and tolerances. |
| View status & task backlog | Displays pipeline stages, tasks backlog by status, warnings, and animation checklist. |
| Inspect next task | Previews the next task ID, status, and goal. |
| Re-convert legacy project | Offered when legacy v1 tasks are detected; upgrades cleanly. |
| Refresh | Re-reads state from `.convert/state.json`. |
| Exit | Exits the dashboard and prints the time summary. |

---

## 7. Visual comparison report & human review

### Visual comparison report

The visual comparison report can be run anytime using `fexport convert report [route]` (alias: `verify`):

- **Side-by-side comparison:** Boots the production Next.js build (`next start`) alongside the original export static server, capturing full-page screenshots at 1440, 1000, and 390 px viewports.
- **Dynamic region auto-masking:** The export is captured twice 2 seconds apart; fluctuating pixels (live clocks, loaders, tickers) are automatically masked out in both images.
- **Animation filmstrips:** Captures ~6 frames on page load and during scroll to visually verify motions and transitions.
- **Report viewer:** Generates `.convert/report/index.html` with side-by-side diff sliders, per-section visual scores, DOM comparisons, filmstrips, and placeholder stubs.
- **Non-blocking:** The report is purely informational and does not block builds or deployment.

### Human review & `needs-review` tasks

When a section contains complex custom scripts or edge-case layouts that fail verification after a fix attempt (or times out twice), it transitions to `needs-review`:

- The worker pool does not halt; remaining tasks continue running.
- Reviewing:
  1. Inspect the task file and diff images in `.convert/diffs/` or `.convert/report/index.html`.
  2. Make any manual tweaks if necessary.
  3. Mark the task done with:
     ```bash
     fexport convert review <taskId>
     ```
     Or select **Review tasks** from the Conversion Dashboard.

---

## 8. Migration, re-converting & troubleshooting

### Migration & portability

- **State schema v2:** Stores `exportDir` relative to the project directory; `nextDir` is derived from the project root. Projects can be relocated to another directory or machine without breaking paths.
- **Regenerated agent files:** `AGENTS.md`, `CLAUDE.md`, and task files are regenerated at every run start with the active CLI invocation path.
- **Re-converting legacy projects:**
  - Projects converted under the legacy v1 pipeline (with `component`, `motion`, or whole-page tasks) cannot run the section-refactor agent loop.
  - The CLI and dashboard detect legacy state and offer "Re-convert legacy project", which renames the old folder to `<name>.old` (or `.old-2`, `.old-3`) and performs a clean conversion with the section-refactor pipeline.

### Troubleshooting

| Message / symptom | Fix |
|---|---|
| `Only Framer exports are supported in this version` | The export folder's `export-report.json` is missing or is not a Framer export. |
| `Export folder not found: <path>` | Check the path passed to `convert`. |
| `No .convert/state.json found` | Run `status`, `next`, `run`, `report`, or `review` from inside the converted project folder. |
| `Dependencies not installed` | Run `npm install` in the converted project folder. |
| `Another run is active` / Stale `.convert/run.lock` | A previous runner process crashed or was terminated. Re-running `fexport convert run` automatically detects stale locks, cleans up orphan processes, and resumes. |
| Dev server port conflict mid-run | The check system automatically detects port conflicts, finds an available free port, and updates `.convert/dev-server.json`. |
| Quota limit (`429` / `RESOURCE_EXHAUSTED`) | The runner stops dispatching and pauses. Headless `run` switches to the other installed agent on its own; in the dashboard you choose to switch or stay paused. Otherwise change agent in `fexport convert ui` and resume. |
| Task marked `needs-review` | Section had complex custom scripts or diffs. Inspect the report at `.convert/report/index.html` and accept with `fexport convert review <taskId>`. |
| A `fix-build-*.md` task appears | `next build` failed during finalize; inspect `.convert/tasks/fix-build-*.md` for the build error tail. |
| Interrupted mid-task | On next run, interrupted tasks are automatically recovered from clean snapshots without losing already completed tasks. |

---

## 9. Known limitations (beta)

- **Framer only.** Other website platforms are planned behind the adapter interface.
- **Backend features not converted.** Forms, customer accounts, authentication, checkout/payments, dynamic search, or custom server endpoints must be rebuilt with your preferred backend.
- **Third-party embed stubs.** Complex Framer embeds (e.g. custom iframe widgets, interactive maps) are converted into placeholder stubs listed in `.convert/report/index.html`.
- **Animation timing nuances.** Motion presence and triggers (hover, scroll, appear) are checked automatically; subtle easing curve nuances are reviewed visually via report filmstrips.
- **TypeScript versioning.** Generated projects use TypeScript 7 for `tsc` and TypeScript 6 for ESLint / Next's type check.
