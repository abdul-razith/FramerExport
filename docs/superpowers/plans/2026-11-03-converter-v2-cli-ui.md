# Framer-to-Next.js Converter v2 CLI UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `fexport convert` the same interactive `@clack/prompts` look as the v2 CLI (`fexport-v2`): a stage-by-stage conversion run (stages 1–4) and a Conversion Dashboard for stage 5 (`verify`) plus status, next task, dependency install and motion sign-off. Core converter logic stays untouched.

**Architecture:** Two new screens in `src/cli-v2/screens/`. `convert-run.ts` wraps `runPipeline` with an intro, a "Stage N/5" spinner fed by the pipeline's `io.log`, and a summary note. `convert-dashboard.ts` is a menu loop over `loadState` / `formatStatus` / `pickNextTask` / `runVerify`. Pure helpers (menu choices, labels, result formatting) live in `src/cli-v2/screens/convert-helpers.ts` so they are unit-testable without a TTY. `src/convert/index.ts` routes to the screens only when the terminal is interactive. Every headless path behaves exactly as today.

**Tech Stack:** TypeScript (ESM, Node ≥20), `@clack/prompts` ^1.8.1, `chalk` ^5, node:test via tsx.

**Spec:** `docs/superpowers/specs/2026-11-02-framer-to-nextjs-converter-design.md` (pipeline: analyze → extract-cms → scaffold → tasks → verify). The visual reference is the existing v2 CLI: `src/cli-v2/index.ts`, `src/cli-v2/screens/export.ts` and `src/cli-v2/ui/prompts.ts`.

## Global Constraints

- **No changes to core logic:** `src/convert/pipeline.ts`, `src/convert/state.ts`, `src/convert/stages/**`, `src/convert/adapters/**`, `src/convert/verify/**` and `src/convert/tasks/**` are read-only. Only `src/convert/index.ts` (the CLI layer) and `src/cli-v2/**` change.
- **Same look as v2:** use only the helpers in `src/cli-v2/ui/prompts.ts` (`uiIntro`, `uiOutro`, `uiSelect`, `uiText`, `uiConfirm`, `uiNote`, `uiSpinner`, `uiCancelAndExit`). The intro title is `FramerExport v2 · Next.js Converter`. Note titles use the v2 `Step N/5: …` pattern, here written as `Stage N/5: <label>` (see `STAGE_LABELS` in Task 2).
- **Interactive only when both** `process.stdin.isTTY` and `process.stdout.isTTY` are true (same check as `offerConversion` in `src/cli-v2/index.ts`). `--yes` always forces the headless path.
- **Headless output unchanged:** `fexport convert status|next|verify [target]|done <id>|<exportDir> --yes` and every non-TTY run print exactly what they print today. `tests/unit/convert-cli.test.ts` stays green without edits.
- **Cancel:** Ctrl+C or Esc on any prompt goes through `uiCancelAndExit()`, which the prompt helpers already do. Spinners are stopped before any error is printed.
- **Child processes** (`npm install`) are spawned with argument arrays, never a concatenated string. On Windows use `npm.cmd` with `shell: true` (Node ≥20 refuses to spawn `.cmd` without it). Paths with spaces must work.
- This folder is **not a git repository**, so there are no commit steps. If it becomes one, commit after each task.

## Review Focus

1. **Export folder literally named `ui`** → `fexport convert ui` opens the dashboard. Users who mean a folder named `ui` pass `./ui`. `parseConvertArgs` treats only the bare word `ui` as the command. Pinned in Task 3.
2. **Verify while `node_modules` is missing** → the dashboard shows "Install dependencies" first, and a verify attempt shows the `VerifyRefusedError` message in a note and returns to the menu instead of exiting. Pinned in Task 2 (choices) and Task 3 (manual check).
3. **Verify throws mid-run (build crash, unknown route)** → the spinner stops with `Verification failed`, the error appears in a note, and the menu loop continues. Pinned in Task 2 (`formatVerifyError`).
4. **No incomplete motion tasks** → the "Mark motion task done" entry is hidden, so the user never gets an empty select. Pinned in Task 2.
5. **v2 export → conversion hand-off** (the `temp.txt` run) → the user never sees `cd … && npm install` or `npx … verify`, and never lands back in the shell before choosing Exit. Pinned by the Task 2 helper test `stripNextSteps` and the Task 4 manual check.
6. **Generated commands point at the published npm package** (`temp.txt`: `npx -p framer-export fexport convert status` → `Invalid URL: convert`) → task files, `AGENTS.md` and fix files carry a command that runs the local checkout; pinned in Task 5.
7. **Agent run goes wrong** (agent missing, exits non-zero, edits files outside the task, loops on a failing task, Ctrl+C mid-run) → the loop stops with a named reason, outside edits are listed and never reverted, a task stops at `needs-human` after 3 failures, and the child is killed on Ctrl+C; pinned in Task 6.
8. **Piped or CI run with no arguments** (`fexport convert < /dev/null`) → prints `CONVERT_USAGE` and exits 1 without waiting on a prompt. Pinned in Task 3.

---

## File Structure

```
src/convert/index.ts                     + 'ui' command, markTaskDone(), readTaskGoal(), interactive routing (Task 1, 3)
src/cli-v2/screens/convert-helpers.ts    pure: labels, menu choices, result/err formatting (Task 2)
src/cli-v2/screens/convert-run.ts        runScreenConvertRun(): stages 1–4 with spinner (Task 3)
src/cli-v2/screens/convert-dashboard.ts  runScreenConvertDashboard(): stage 5 + task menu (Task 3)
src/cli-v2/screens/convert-agent.ts      agy/claude launcher + agent loop (Task 6)
src/convert/tasks/templates/index.ts      resolveCliInvocation(): local checkout vs npm (Task 5)
src/cli-v2/index.ts                      offerConversion → convert-run screen → dashboard; help text (Task 3)
tests/unit/cli-v2-convert.test.ts        helpers + markTaskDone + parse/route tests (Task 1, 2, 3)
```

---

### Task 1: Install dependencies and extract the shared CLI helpers

The dashboard needs the same "mark done" and "goal" logic that the `done` and `next` commands already run inline. Extract both so the two paths cannot drift.

**Files:**
- Modify: `src/convert/index.ts`
- Test: `tests/unit/cli-v2-convert.test.ts`

**Interfaces:**
- Produces (exported from `src/convert/index.ts`):
  - `markTaskDone(state: ConvertState, taskId: string | undefined): { ok: true; task: TaskRecord } | { ok: false; error: string }`. This moves the current `done` branch logic. The error strings stay byte-identical: `Usage: fexport convert done <taskId>`, `Unknown task: <id>`, and `<id> is a <kind> task; "done" is only for motion tasks. Run "${CLI_INVOCATION} verify <id>" instead.` On success it sets `task.status = 'done'`. It does **not** save, so the caller calls `saveState`.
  - `readTaskGoal(file: string): Promise<string | null>`. Returns the body of the `# Goal` section, using the existing regex in the `next` branch. Returns `null` when the file is unreadable or has no Goal section.
  - `readAnimations(root: string): Promise<AnimationEntry[]>`. The existing function, now exported.

- [ ] **Step 1:** In `FramerExport/`, run `npm install`, then `ls node_modules | grep -E "pixelmatch|pngjs"`. Expected: both present. They are in `package.json` but missing from `node_modules` today.
- [ ] **Step 2: Write failing tests** in `tests/unit/cli-v2-convert.test.ts`. Build state with `initState('/e', '/n')` and add tasks by hand:
  - `markTaskDone(state, undefined)` → `{ ok: false, error: 'Usage: fexport convert done <taskId>' }`
  - `markTaskDone(state, 'nope')` → error `Unknown task: nope`
  - a `page` task → `ok: false` and the error contains `"done" is only for motion tasks`
  - a `motion` task `motion-home` → `ok: true` and `state.tasks['motion-home'].status === 'done'`
  - a fix task `fix-motion-home-1` whose original is motion → `ok: true`
  - `readTaskGoal` on a temp file `# Task\n\n## Goal\nBuild hero\n\n## Files\n` → `'Build hero'`; on a missing file → `null`
- [ ] **Step 3:** Run `node --import tsx --test tests/unit/cli-v2-convert.test.ts`. Expected: FAIL, because the exports do not exist yet.
- [ ] **Step 4:** Implement the three exports and rewrite the `done` and `next` branches of `runConvertCommand` to call them, with the same output.
- [ ] **Step 5:** Run `node --import tsx --test tests/unit/cli-v2-convert.test.ts tests/unit/convert-cli.test.ts tests/unit/convert-done.test.ts`. Expected: all PASS. Then run `npm run typecheck`. Expected: clean.

---

### Task 2: Pure UI helpers (labels, menu choices, formatting)

**Files:**
- Create: `src/cli-v2/screens/convert-helpers.ts`
- Test: `tests/unit/cli-v2-convert.test.ts`

**Interfaces:**
- Consumes: `ConvertState`, `TaskRecord`, `StageName`, `PageInfo` from `src/convert/types.ts`, and `pickNextTask` from `src/convert/pipeline.ts`.
- Produces:
  - `STAGE_LABELS: Record<StageName, string>` with these exact values: `analyze` → `Stage 1/5: Analyze export`, `extract-cms` → `Stage 2/5: Extract CMS`, `scaffold` → `Stage 3/5: Scaffold Next.js project`, `tasks` → `Stage 4/5: Write AI task files`, `verify` → `Stage 5/5: Verify against export`.
  - `stageFromLog(msg: string): StageName | null` matches the pipeline's `Running <stage>...` lines. Anything else returns `null`.
  - `type DashboardAction = 'status' | 'next' | 'install' | 'verify' | 'agent' | 'done' | 'refresh' | 'exit'`
  - `getDashboardChoices(state: ConvertState, hasNodeModules: boolean): { label: string; value: DashboardAction; hint?: string }[]`
    - Order: `install` (only when `!hasNodeModules`, hint `required before verify`), `next`, `agent` (label `Run AI agent`, hint `agy or claude, optional`), `verify` (hint `Stage 5/5`), `status`, `done` (only when `getMotionChoices(state).length > 0`), `refresh`, `exit`.
  - `getMotionChoices(state: ConvertState): { label: string; value: string; hint?: string }[]` lists motion tasks, plus fix tasks whose original is a motion task, whose status is not `done`. The value is the task id and the hint is the route.
  - `getVerifyTargetChoices(state: ConvertState, pages: PageInfo[]): { label: string; value: string | undefined; hint?: string }[]`
    - First: `Next pending task (<id>)` with value = `pickNextTask(state)?.id`. Omitted when there are no pending tasks.
    - Then `All outstanding tasks` with value `undefined`.
    - Then one entry per pending or in-progress task (value = id, hint = kind).
    - Then one entry per `pages[].route` (value = route, hint `page route`).
  - `formatVerifyResult(r: { passed: string[]; failed: string[] }, root: string): string` returns lines `✔ Passed: N`, `✖ Failed: N`, each failed id indented, and `Report: <root>/.convert/diffs/report.json`, with the path built by `path.join`.
  - `stripNextSteps(lines: string[]): string[]` removes the pipeline's "Next steps" block (the `Next steps:` line and the numbered lines after it that start with a digit and a period) and returns the rest.
  - `formatVerifyError(err: unknown): string` returns the error message. When the message is `Dependencies not installed…` it appends `\nChoose "Install dependencies" from the menu.`

- [ ] **Step 1: Write failing tests** with these assertions:
  - `STAGE_LABELS.verify === 'Stage 5/5: Verify against export'`
  - `stageFromLog('Running scaffold...') === 'scaffold'`
  - `stageFromLog('scaffold: 3 written') === null`
  - `getDashboardChoices(state, false)[0].value === 'install'`
  - with `hasNodeModules = true`, no choice has the value `install`
  - with no motion tasks, no choice has the value `done`. With one pending motion task, `done` is present.
  - `getVerifyTargetChoices` on a state with no pending tasks has `All outstanding tasks` as the first entry, and includes `/about` when pages contain it.
  - `formatVerifyResult({passed:['a'],failed:['b']}, '/n')` contains `Passed: 1`, `Failed: 1` and `b`.
  - `stripNextSteps(['analyze complete', '', 'Next steps:', '  1. Install dependencies: x', '  2. Give your AI coding agent y', '  3. Then verify it: z'])` → `['analyze complete', '']`
  - `formatVerifyError(new Error('Dependencies not installed: run "npm install" in /n'))` contains `Install dependencies`.
- [ ] **Step 2:** Run `node --import tsx --test tests/unit/cli-v2-convert.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3:** Implement `src/cli-v2/screens/convert-helpers.ts`. Use `chalk` only for the ✔ and ✖ glyph colors, matching `formatShortcutHint`.
- [ ] **Step 4:** Run the tests again. Expected: PASS.

---

### Task 3: Screens and wiring

**Files:**
- Create: `src/cli-v2/screens/convert-run.ts`, `src/cli-v2/screens/convert-dashboard.ts`
- Modify: `src/convert/index.ts`, `src/cli-v2/index.ts`
- Test: `tests/unit/cli-v2-convert.test.ts`

**Interfaces:**
- Consumes: Task 1 exports, Task 2 helpers, `runPipeline`, `formatStatus`, `pickNextTask` (pipeline.ts), `findProjectRoot`, `loadState`, `saveState` (state.ts), `runVerify` and `VerifyRefusedError` (stages/verify.ts), and `framerAdapter`.
- Produces:
  - `runScreenConvertRun(exportDir: string, nextDir: string, opts?: { intro?: boolean }): Promise<string>` returns the resolved `nextDir`.
    1. Unless `opts.intro === false`, call `uiIntro('FramerExport v2 · Next.js Converter')`.
    2. `uiNote` a summary in the style of `runScreenExport`: `Export:`, `Project:`, `Resume from:` (`nextStage(state)` or `start`). Then `uiConfirm('Start conversion?')`. If the user says no, call `uiCancelAndExit('Conversion cancelled by user.')`.
    3. Start one spinner and call `runPipeline(exportDir, nextDir, io)`:
       - `io.log`: when `stageFromLog(msg)` matches, call `spinner.message(STAGE_LABELS[stage])`. Collect the other lines in an array.
       - `io.confirm`: stop the spinner, call `uiConfirm(msg, false)`, then restart the spinner. This is needed because the scaffold overwrite prompt cannot share the line with a running spinner.
    4. On success, call `spinner.stop('Stages 1–4 complete: project scaffolded, AI tasks written')` and `uiNote` a short `Project ready` summary (project path, task count by kind). **Do not print the pipeline's "Next steps" text** (`cd … && npm install`, `npx … verify`): those tell the user to leave the UI, and the dashboard does each of those steps. Drop collected log lines that belong to that block (`Next steps:` and the three numbered lines). On error, call `spinner.stop('Conversion failed')` and rethrow.
    5. It never asks "open the dashboard?". The caller goes straight into the dashboard (see below).
  - `runScreenConvertDashboard(projectDir?: string, opts?: { intro?: boolean }): Promise<void>`
    - Find the root with `findProjectRoot(projectDir ?? process.cwd())`. If there is none, show a `uiSelect` with three options: `Open an existing converted project` (a `uiText` path that is validated by `findProjectRoot` and must be non-null), `Convert an export folder` (a `uiText` path that must be a directory, then `runScreenConvertRun(path, path + '-next', { intro: false })`, then continue with that project), and `Exit`.
    - **Stay in one session:** the dashboard is the only place the user works after stage 4. Opening it right after a conversion preselects the first useful action: `install` when `node_modules` is missing, otherwise `next` (pass `initialValue` to `uiSelect`). Nothing in the flow tells the user to run another command in a different shell.
    - On `exit`, call `uiOutro('Dashboard closed.')` only when `opts.intro !== false` is false, i.e. when the dashboard was opened on its own. When it follows the v2 export (`intro: false`), skip it, because the caller prints the final outro.
    - Loop. On each pass, reload state with `loadState(root)` and check `node_modules` existence, then `uiSelect('What next?', getDashboardChoices(...), initialValue)`. Handle each action:
      - `status`: `uiNote(formatStatus(state, await readAnimations(root)), 'Conversion status')`
      - `next`: `uiNote` with the id, status, file path and `readTaskGoal` (or `No pending tasks`), titled `Next task`, plus the line `Give this file to your AI agent, then choose "Verify" here.` The dashboard stays open while the user works with the agent elsewhere.
      - `install`: spinner with `Installing dependencies…`, then spawn `npm` (`npm.cmd` with `shell: true` on win32) with args `['install']` and `cwd: root`. On exit 0, stop with `Dependencies installed`. Otherwise stop with `npm install failed (exit N)` and note the last 20 stderr lines.
      - `verify`: `uiSelect` over `getVerifyTargetChoices`. Run `runVerify({ state, exportDir: state.exportDir, nextDir: root, log: (m) => spinner.message(m) }, framerAdapter, target)` with the spinner started on `STAGE_LABELS.verify`. Then `uiNote(formatVerifyResult(...), 'Verification result')`. When it throws, stop the spinner with `Verification failed` and `uiNote(formatVerifyError(err), 'Verification error')`.
      - `done`: `uiSelect` over `getMotionChoices`, then `markTaskDone` and `saveState`. Note `Marked <id> done.`
      - `refresh`: run the loop again.
      - `exit`: `uiOutro('Dashboard closed.')` and return.
  - `src/convert/index.ts`:
    - `ConvertArgs.command` gains `'ui'`. `parseConvertArgs(['convert','ui'])` → `{ command: 'ui', … }`. `./ui` still means `run`.
    - `export function isInteractiveTerminal(): boolean` returns `!!process.stdin.isTTY && !!process.stdout.isTTY`.
    - Routing in `runConvertCommand`:
      - `ui` → if interactive, call `runScreenConvertDashboard()` and return 0. Otherwise, print `fexport convert ui needs an interactive terminal` to stderr and return 1.
      - `run` with no `exportDir` → if interactive, call `runScreenConvertDashboard()` and return 0. This covers both cases: inside a project it opens the dashboard, and outside one it shows the project chooser. Otherwise, print `CONVERT_USAGE` and return 1, as today.
      - `run` with a valid `exportDir` → if interactive and not `--yes`, call `runScreenConvertRun(exportDir, nextDir)` and then go straight into `runScreenConvertDashboard(nextDir, { intro: false })`, with no extra question. Otherwise use the existing plain path.
      - `status`, `next`, `verify` and `done` keep their current plain behavior.
      - Load the screens with dynamic `import()` so headless runs never load clack.
    - Add one line to `CONVERT_USAGE`: `  fexport convert ui                              open the interactive Conversion Dashboard`.
  - `src/cli-v2/index.ts`:
    - In `offerConversion`, keep the existing `Convert to a Next.js project now?` confirm. Replace the bare `runPipeline` call with `runScreenConvertRun(exportDir, exportDir + '-next', { intro: false })`, then go straight into `runScreenConvertDashboard(nextDir, { intro: false })`. The v2 flow therefore never exits to a plain shell between the export and the end of the conversion work. The final `uiOutro` stays in `runCliV2Workflow`.
    - In `showCliV2Help` WORKFLOW, add `6. Optional Next.js Conversion (Framer only): stages 1–5 with a Conversion Dashboard`.

- [ ] **Step 1: Write failing tests:**
  - `parseConvertArgs(['convert','ui']).command === 'ui'` and `parseConvertArgs(['convert','./ui']).command === 'run'`
  - `runConvertCommand(['convert'])` under `node --test` (non-TTY) → returns `1`, and the captured `error` output contains `Usage:`. This pins Review Focus 5.
  - `runConvertCommand(['convert','ui'])` (non-TTY) → returns `1` and the output contains `interactive terminal`
  - `CONVERT_USAGE` contains `fexport convert ui`
- [ ] **Step 2:** Run `node --import tsx --test tests/unit/cli-v2-convert.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the two screens, the routing in `src/convert/index.ts`, and the `src/cli-v2/index.ts` changes.
- [ ] **Step 4:** Run `npm test`. Expected: all PASS, including the unchanged `tests/unit/convert-cli.test.ts`. Then run `npm run typecheck && npm run build`. Expected: both clean.

---

### Task 4: Manual end-to-end check in a real terminal

- [ ] **Step 1:** Run `npm link` in `FramerExport/`.
- [ ] **Step 2:** Run `fexport convert out/framer/nudge` (or another Framer export). Expected:
  - The v2 intro banner shows.
  - A summary note appears, followed by a confirm.
  - The spinner walks through `Stage 1/5` to `Stage 4/5`.
  - A `Next steps` note appears.
  - The dashboard opens straight away with no extra prompt, with `Install dependencies` preselected, and the screen never prints `cd … && npm install` or an `npx … verify` command.
- [ ] **Step 3:** In the dashboard, check each action:
  - `install` is listed first while `node_modules` is missing. Running it ends with `Dependencies installed`, and `install` disappears from the menu.
  - `next` shows the goal.
  - `status` shows the table.
  - `verify` → `/` on the untouched scaffold ends in a `Verification result` note with `Failed:` ≥ 1, and the menu returns.
- [ ] **Step 4:** Run `fexport convert` with no arguments, inside `out/framer/nudge-next`. Expected: the dashboard opens directly. Run it again from `C:\`. Expected: the chooser appears with three options.
- [ ] **Step 5:** Press Esc at any prompt. Expected: `Operation cancelled.` appears and the process exits cleanly, with no stray spinner. Then run `fexport convert status | more` and `fexport convert`, piped. Expected: plain output, no prompts, exit codes 0 and 1.
- [ ] **Step 6:** Run `npm run cli:v2` against a Framer site through to the end (the flow in `temp.txt`). Expected: after `Convert to a Next.js project now?` → Yes, the staged spinner runs, the dashboard opens in the same session, install / next / verify all work from it, and the shell prompt returns only after Exit, with a single closing outro.

---

### Task 5: Run the converter from the local checkout, not from npm

**Why:** the log in `temp.txt` shows `npx -p framer-export fexport convert status` downloading the published `framer-export@5.0.2`, which has no `convert` command (`Invalid URL: convert`). The hardcoded `CLI_INVOCATION` (`src/convert/tasks/templates/index.ts:8`) is written into the "Next steps" text, every task file, `AGENTS.md` and the fix files, so the user and the AI agent are both sent to the published package instead of the local code. Inside the dashboard nothing spawns the CLI (it calls `runVerify` in-process), so only the *text* handed to the AI agent needs fixing.

**Files:**
- Modify: `src/convert/tasks/templates/index.ts`
- Test: `tests/unit/cli-v2-convert.test.ts`

**Interfaces:**
- Produces (exported from `src/convert/tasks/templates/index.ts`):
  - `resolveCliInvocation(opts: { argv1?: string; env?: NodeJS.ProcessEnv }): string`
    1. If `env.FEXPORT_CLI_INVOCATION` is a non-empty string, return it unchanged.
    2. Otherwise take `realpath(argv1)` and walk up to the nearest `package.json` whose `name` is `framer-export`. If that package root has no `node_modules` segment in its path, it is a local checkout: return `node "<root>/bin/fexport.js" convert`, with the path built by `path.join` and double-quoted so spaces work.
    3. In every other case (published install, `argv1` missing or unrelated, such as the test runner) return `npx -p framer-export fexport convert`.
  - `CLI_INVOCATION` stays exported as a `const`, now `resolveCliInvocation({ argv1: process.argv[1], env: process.env })`. All existing imports keep working.
- `bin/fexport.js` runs `../dist/cli/index.js`, so a local checkout needs `npm run build` first. The Task 4 manual check already builds. The `npm link`-ed `fexport` resolves to this same path through `realpath`.

- [ ] **Step 1: Write failing tests:**
  - `resolveCliInvocation({ env: { FEXPORT_CLI_INVOCATION: 'x convert' } }) === 'x convert'`
  - with `argv1` = this repo's `bin/fexport.js` (use `path.resolve('bin/fexport.js')`) → starts with `node "` and ends with `bin${path.sep}fexport.js" convert`, and contains no `npx`
  - with `argv1` = `<tmp>/node_modules/framer-export/bin/fexport.js` (create a temp `package.json` with `name: "framer-export"` there) → `npx -p framer-export fexport convert`
  - `argv1` undefined or a path outside any framer-export package → `npx -p framer-export fexport convert`
  - a repo path containing a space (temp dir `my tool`) → output keeps the space inside the double quotes
- [ ] **Step 2:** Run `node --import tsx --test tests/unit/cli-v2-convert.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `resolveCliInvocation` and derive `CLI_INVOCATION` from it. Use sync `fs.realpathSync` and `fs.readFileSync` in try/catch, because the value is computed at module load.
- [ ] **Step 4:** Run `npm test`. Expected: PASS. The existing assertions in `tests/unit/convert-tasks.test.ts` and `tests/unit/convert-cli.test.ts` still expect the `npx -p framer-export` text, which holds because the test runner is not a framer-export bin. If one fails, fix `resolveCliInvocation`, not the test.
- [ ] **Step 5:** Manual check: `npm run build`, then `npm run cli:v2` (or `tsx src/cli/index.ts convert out/framer/nudge`). Expected: generated `AGENTS.md` and `.convert/tasks/*.md` under `out/framer/nudge-next` contain `node "…\FramerExport\bin\fexport.js" convert verify <id>`, and running that exact command from inside `nudge-next` prints the status table, not `Invalid URL: convert`.

---

### Task 6: Run the AI agent (`agy` or `claude`) from the dashboard

**Why:** after stage 4 the user currently copies each task file into a separate AI session. The dashboard can start the user's own agent CLI on a task, run `verify` itself when the agent exits, and feed any `fix-*.md` back to the agent, all in the same session. The user chooses the agent and how much runs unattended. No sandbox support (decided by the user: too complex).

**Files:**
- Create: `src/cli-v2/screens/convert-agent.ts`
- Modify: `src/cli-v2/screens/convert-dashboard.ts` (handle the `agent` action)
- Test: `tests/unit/cli-v2-convert.test.ts`

**Interfaces:**
- Consumes: `pickNextTask`, `runVerify`, `loadState`, `saveState`, `markTaskDone` (Task 1), `getMotionChoices` (Task 2), `uiSelect`, `uiConfirm`, `uiNote`, `uiSpinner`.
- Produces (exported from `convert-agent.ts`):
  - `type AgentId = 'agy' | 'claude'`
  - `buildAgentPrompt(taskFile: string): string`. Fixed text: `Read AGENTS.md and <taskFile> then complete that task. Edit only the files listed under Edit only. Do not run verify, the dashboard runs it afterwards.` `taskFile` is the state-relative path with `/` separators. The result may contain only the characters `A-Za-z0-9 ./_,-`, so it can be double-quoted safely on Windows. `buildAgentPrompt` throws if `taskFile` has any other character.
  - `buildAgentCommand(agent: AgentId, prompt: string): { command: string; args: string[] }`. Both agents: `[agent, '-p', prompt, '--dangerously-skip-permissions']`. Same shape, so one code path. No `--sandbox`.
  - `detectAgents(): Promise<AgentId[]>` returns the agents found on PATH (`where` on win32, `which` elsewhere, spawned with an argument array). The order is `agy`, `claude`.
  - `runAgentOnTask(root: string, agent: AgentId, taskFile: string): Promise<{ exitCode: number; outside: string[] }>`
    - Spawn with `cwd: root`, `stdio: 'inherit'` (the agent's own output is the progress display, so no spinner runs during this step). When the resolved binary ends in `.cmd` or `.bat`, use `shell: true` with the prompt wrapped in double quotes.
    - Before and after, record `path -> mtime+size` for every file under `root` except `node_modules`, `.next`, `.convert` and `.git`. `outside` lists files that changed and are not in the task's `targets`. Report only, never revert.
    - On Ctrl+C the child is killed before the dashboard exits.
  - `runAgentLoop(root: string, agent: AgentId, mode: 'one' | 'all', io): Promise<{ stoppedFor: 'done' | 'needs-human' | 'motion' | 'failed-agent' | 'limit'; ran: string[] }>`
    - `pickNextTask(state)` chooses the task, so fix tasks come first. After each agent run, call `runVerify` for that task in a spinner (component/page/fix) and reload state.
    - `mode: 'one'` runs exactly one task and returns. `mode: 'all'` repeats until no pending tasks remain. It stops early, for the matching `stoppedFor` reason, when: a task reaches `needs-human`; the next task is a `motion` task (`motion` tasks always need the user's eyes: the dashboard then offers `done` through `getMotionChoices`); the agent exits non-zero; or 200 tasks have run (`limit`).
    - After a pass or fail, show `uiNote` with the verify result (`formatVerifyResult`) and any `outside` files.
- Dashboard flow for the `agent` action:
  1. `detectAgents()`. If none is found, `uiNote('Neither agy nor claude was found on PATH.', 'AI agent')` and return to the menu.
  2. `uiSelect` the agent when more than one was found, otherwise use the single one.
  3. `uiSelect` the mode: `Next task only, I review each one` (`one`) or `Run all tasks until done or stuck` (`all`).
  4. Once per dashboard session, show `uiNote` that the agent runs with `--dangerously-skip-permissions` inside the project folder and can run any command there, then `uiConfirm('Start the agent?', false)`.
  5. `runAgentLoop`, then a summary `uiNote` (tasks run, stop reason) and back to the menu.

- [ ] **Step 1: Write failing tests:**
  - `buildAgentPrompt('.convert/tasks/001-component-Arrow.md')` equals the fixed text with that path and matches `/^[A-Za-z0-9 ./_,-]+$/`
  - `buildAgentPrompt('a"b.md')` and `buildAgentPrompt('x & y.md')` throw
  - `buildAgentCommand('agy', p)` and `buildAgentCommand('claude', p)` equal `{ command: <agent>, args: ['-p', p, '--dangerously-skip-permissions'] }` and neither contains `--sandbox`
  - `runAgentOnTask` with a stub agent (a temp `.mjs` script run through `process.execPath`, injected through an optional `spawnFn` parameter) that edits one allowed target and one other file → `exitCode 0` and `outside` equals only the other file
  - `runAgentLoop` with injected `runAgent` and `verify` stubs: mode `one` runs one task; mode `all` stops with `needs-human` when a stub fails three times; mode `all` stops with `motion` when only motion tasks remain; a non-zero agent exit stops with `failed-agent`
  - `getDashboardChoices` includes `agent` between `next` and `verify`
- [ ] **Step 2:** Run `node --import tsx --test tests/unit/cli-v2-convert.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `convert-agent.ts` (accept optional injected `spawnFn` / `runAgent` / `verify` parameters so tests need no real agent) and the dashboard branch.
- [ ] **Step 4:** Run `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Real-agent smoke test.** I have not run the real agents, so confirm the argument shape first. In a scratch folder, run `agy -p "reply with the word ok" --dangerously-skip-permissions` and `claude -p "reply with the word ok" --dangerously-skip-permissions`. Expected: each prints a reply and exits 0. If `agy` needs a different argument shape (for example the prompt as a trailing argument), change only `buildAgentCommand` and its test.
- [ ] **Step 6: End-to-end.** In the dashboard on `nudge-next`: Run AI agent → pick an agent → "Next task only" → confirm. Expected: the agent works on `001-component-*`, the dashboard then runs verify and shows a result note, and the menu returns. Then repeat with "Run all tasks", and press Ctrl+C mid-run to confirm the agent process is killed.

