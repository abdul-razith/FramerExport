# Framer → Next.js Converter Guide

`fexport convert` turns a Framer export (made with `framer-export`) into a clean, production-style **Next.js** project:

- **Next.js 16** App Router, **TypeScript** (strict), **Tailwind CSS v4**
- **framer-motion**, **GSAP** (+ `@gsap/react`), **Lenis** smooth scroll
- Typed CMS content (`src/content/*.ts`) extracted from Framer's `.framercms` data
- No Framer runtime code is copied — the UI is rebuilt as real React components

The conversion is a **pipeline**: the tool does the mechanical work (analysis, CMS extraction, scaffolding) and then writes small, numbered **AI task files** that you run one by one in **Claude Code** or **Antigravity**. A built-in **verify** step screenshots the original export and your Next.js app side by side and only accepts a task when they match.

There are two ways to build the pages and components:

- **Automatic (fast, no AI):** `fexport convert generate` copies the original page markup and CSS into real React files in about a minute and a half. Components usually pass verify straight away; pages come out close but need a polish pass (see section 5).
- **AI tasks:** the numbered task files, run one by one by an agent. Use this for whatever `generate` leaves failing, and for animations.

> Status: **beta**, Framer exports only.

---

## 1. Requirements

- Node.js **20+** (22 recommended)
- This repo installed: `npm install` then `npm run build` inside `FramerExport/`
- A Framer export folder created by `framer-export` (it contains `index.html`, `subpages/`, `assets/`, `data/`, `serve.js`, `export-report.json`)
- An AI coding agent: Claude Code or Antigravity (any agent that reads `AGENTS.md`/`CLAUDE.md` works)

---

## 2. Quick start

```bash
# inside FramerExport/
npm install
npm run build

# 1) export a Framer site (skip if you already have one)
node bin/fexport.js https://your-site.framer.website --subpages

# 2) convert the export into a Next.js project
node bin/fexport.js convert out/framer-your-site ../your-site-next --yes

# 3) install the generated project's dependencies
cd ../your-site-next
npm install
npm run build        # the placeholder scaffold must build before you start
```

If `framer-export` is installed globally you can write `fexport convert ...` instead of `node bin/fexport.js convert ...`.

**Which code runs.** When you run from this checkout (after `npm run build`), the generated task files and `AGENTS.md` use `node "<this checkout>\bin\fexport.js" convert ...`, so the local version always runs, not the published npm package (which may have no `convert` command). From an installed copy they use `npx -p framer-export fexport convert ...`. Set `FEXPORT_CLI_INVOCATION` to override.

### Interactive way (recommended)

```bash
npm run cli:v2        # export a Framer site, answer "Yes" to "Convert to a Next.js project now?"
# or, for an existing export / converted project:
node bin/fexport.js convert ui
```

You get the staged conversion (Stage 1/5 to 4/5) and then the **Conversion Dashboard**, which stays open so you never have to switch commands:

| Dashboard action | What it does |
|---|---|
| Install dependencies | `npm install` in the converted project (preselected until `node_modules` exists) |
| Generate pages & components automatically | the no-AI generator (preselected after install) |
| Inspect next task | shows the next task and its goal |
| Run AI agent | runs `agy` or `claude` on the next task, or on all tasks until done or stuck |
| Run verification | Stage 5/5, build and pixel comparison |
| View status & task backlog | stages, tasks, warnings |
| Mark motion task done | after you checked an animation by eye |

The dashboard needs an interactive terminal. In scripts, or with `--yes`, the plain commands below are used instead and print the same text as before.

**Running an AI agent.** The dashboard starts `agy -p "<prompt>" --dangerously-skip-permissions` or `claude -p "<prompt>" --dangerously-skip-permissions` inside the project folder and waits for it. You choose the agent and the mode at run time and confirm a warning once. `--dangerously-skip-permissions` lets the agent run any command in that folder without asking, and there is no sandbox. The agent prints nothing until it finishes, so one task can look frozen for several minutes. In "all tasks" mode the loop stops at motion tasks, at a task that failed 3 times, on an agent or verify error, or when the same task comes back unchanged twice.

---

## 3. Commands

| Command | Where to run | What it does |
|---|---|---|
| `fexport convert <exportDir> [nextDir] [--yes]` | anywhere | Runs analyze → CMS extract → scaffold → task generation. `nextDir` defaults to `<exportDir>-next`. Safe to re-run: finished stages are skipped and files you edited are kept (it asks before overwriting; `--yes` auto-confirms). |
| `fexport convert status` | inside the generated project | Shows stage status, task counts, warnings and the animation checklist. |
| `fexport convert` (no arguments) / `fexport convert ui` | anywhere, interactive terminal | Opens the Conversion Dashboard (see section 2). Finds the converted project in the current folder, or lets you pick one or convert an export folder. |
| `fexport convert generate` | inside the generated project | Builds all pages and components automatically, without AI (see section 5). Tasks that are already done are left alone. Run `verify` afterwards. |
| `fexport convert next` | inside the generated project | Shows the next task to give your AI agent (fix tasks first, then components, pages, motion). |
| `fexport convert verify [target]` | inside the generated project | Builds the Next.js app, screenshots both sites at 1440 / 1000 / 390 px and compares them section by section. `target` is a task id (e.g. `101-page-home`) or a route (e.g. `/about`); no target = everything. |
| `fexport convert done <taskId>` | inside the generated project | Marks a **motion** task done after you have checked its animation checklist by eye. |

Windows + Git Bash tip: when the target is `/`, run `MSYS_NO_PATHCONV=1 fexport convert verify /` (otherwise Git Bash rewrites `/` into a Windows path). PowerShell and cmd are not affected.

---

## 4. The working loop

Fastest path: run `fexport convert generate`, then `fexport convert verify`, then give only the failing `fix-*` tasks and the motion tasks to your agent. The loop below works for any task.

```
fexport convert next          → shows .convert/tasks/<id>.md
   ↓ open that file in Claude Code / Antigravity and ask the agent to do it
fexport convert verify <id>   → passes? task done. fails? a fix-<id>-<n>.md task is written
   ↓
repeat until `fexport convert next` says "No pending tasks"
```

Prompt to give your agent for each task:

> Read `AGENTS.md`, then do the task in `.convert/tasks/<id>.md` exactly. Only edit the files it lists. When finished, run the command in its "Done when" section.

Task order and what "done" means:

1. **Component tasks** (`001-component-*`) — build `src/components/<Name>.tsx` from the HTML/CSS slice and reference screenshots. Done when the file exists and the project builds. Their visual accuracy is judged through the pages that use them.
2. **Page tasks** (`101-page-*`) — compose each route from the components. Every page section needs its `data-section="<name>"` attribute (listed in the task). Done when every section matches the original at all three widths (≤ 0.5 % pixel difference, ≤ 2 px height difference) and text, links and images match.
3. **Motion tasks** (`201-motion-*`) — recreate the animations listed in the checklist with framer-motion (appear, hover) and GSAP ScrollTrigger (scroll). Check them by eye, then run `fexport convert done <id>`.
4. **Fix tasks** (`fix-*`) — written by `verify` when something does not match. They list the failing sections and point to expected / actual / diff images. After 3 failed attempts a task becomes `needs-human`: fix it yourself, then run `verify <id>` again.

---

## 5. Automatic generation (`convert generate`)

`generate` opens each exported page in a headless browser, restores the finished look of fade-in effects, marks every section with its `data-section`, and writes:

- `src/views/<page>.tsx` (and `src/views/<page>/<slug>.tsx` for each blog or case-study item), plus the page file's `View` import
- `src/styles/framer/<hash>.css`, the original Framer CSS, shared between pages
- `src/components/<Name>.tsx` for each component
- `public/misc`, `public/videos` when the export has them

Links to exported pages become routes, and `assets/...` URLs become `/images/...`. Re-running is safe: it replaces its own output and skips tasks marked done.

What to expect (measured on one real export):

- Components pass verify, and page heights match the original at all three widths.
- Pages do **not** yet pass the strict gate (≤ 0.5 % pixel difference, no text, link or image mismatch). The original draws some parts with JavaScript after load (live clock, ruler, loader, overlays), and those are not in the page's HTML.
- The generated code keeps Framer's class names and CSS rather than clean Tailwind. It matches closely but is not tidy to edit by hand.

After `generate`, run `verify`. Each failing page gets a `fix-*` task for your agent; motion tasks still need an agent and your eyes.

---

## 6. What gets generated

```
your-site-next/
├─ AGENTS.md, CLAUDE.md          rules + workflow for the AI agent
├─ src/app/                      one page.tsx per route; [slug] routes for CMS collections
│  ├─ globals.css                Tailwind v4 @theme: colors, fonts, type scale, breakpoints
│  └─ fonts.css                  @font-face rules (keeps unicode-range subsets)
├─ src/components/               filled in by component tasks or `convert generate`
├─ src/views/, src/styles/       generated page views and Framer CSS (`convert generate`)
├─ src/content/                  typed CMS data (e.g. blog.ts, caseStudy.ts)
├─ src/lib/motion.ts, gsap.ts    shared animation setup
├─ public/fonts, public/images   only the assets the site actually uses
└─ .convert/                     pipeline workspace (not part of the app)
   ├─ state.json                 stages, tasks, attempts, warnings
   ├─ analysis/                  pages, tokens, components, animations, HTML/CSS slices
   ├─ tasks/                     the AI task files (kept in git)
   ├─ reference/                 screenshots of the original export
   └─ diffs/                     latest verify report and diff images
```

Breakpoints follow Framer: phone `< 810px`, tablet `810–1199px` (`md:`), desktop `≥ 1200px` (`lg:`).

---

## 7. Options and environment variables

| Setting | Effect |
|---|---|
| `--yes` / `-y` | Auto-confirm prompts (e.g. overwriting edited files on re-run). |
| `FEXPORT_CONVERT_NO_ANIMATIONS=1` | Skip animation recording during analysis (faster; motion tasks will be empty). |
| `FEXPORT_E2E=1` | Enables the slow end-to-end test in this repo (`npm install` + `next build` of a generated project). |

The v2 wizard (`npm run cli:v2`) offers **"Convert to a Next.js project now?"** after a successful Framer export and continues straight into the dashboard.

---

## 8. Troubleshooting

| Message / symptom | Fix |
|---|---|
| `Only Framer exports are supported in this version` | The folder's `export-report.json` is not a Framer export. |
| `Export folder not found` | Check the path you passed to `convert`. |
| `No .convert/state.json found` | Run `status` / `next` / `verify` from inside the generated project folder. |
| `Pipeline incomplete` | Re-run `fexport convert <exportDir> <nextDir>`; it resumes where it stopped. |
| `Dependencies not installed` | Run `npm install` in the generated project. |
| A `fix-build-*.md` task appears | `next build` failed; the task contains the build log tail. After 3 consecutive build failures verify stops and asks for a human. |
| Verify warns about timeouts / infra errors | Network or browser problems do not use up task attempts — just run verify again. |
| Re-exported the site | Just run `verify` again: reference screenshots are re-captured automatically when the export changes. |

---

## 9. Known limitations (beta)

- **Framer only.** Other platforms are planned behind the adapter interface.
- **Animations are checked by eye.** Recorded timings are estimates; some hero entrance animations are not detected.
- **Sections without visible size** in the original (e.g. hidden loaders) are not pixel-compared.
- **Component reference screenshots** can be missing at tablet/phone widths for components inside Framer's per-breakpoint wrappers; the HTML/CSS slice is still provided.
- **Not exported:** forms, accounts, payments, search or any backend behaviour.
- Generated project uses TypeScript 7 for `tsc` and TypeScript 6 for ESLint / Next's type check (typescript-eslint does not support TS 7 yet).
- Make sure you have the rights to convert the site (Framer marketplace templates often restrict use outside Framer).
