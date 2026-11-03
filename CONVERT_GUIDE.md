# Framer → Next.js Converter Guide

`fexport convert` turns a Framer export (made with `framer-export`) into a clean, production-style **Next.js** project:

- **Next.js 16** App Router, **TypeScript** (strict), **Tailwind CSS v4**
- **framer-motion**, **GSAP** (+ `@gsap/react`), **Lenis** smooth scroll
- Typed CMS content (`src/content/*.ts`) extracted from Framer's `.framercms` data
- No Framer runtime code is copied — the UI is rebuilt as real React components

The conversion is a **pipeline**: the tool does the mechanical work (analysis, CMS extraction, scaffolding) and then writes small, numbered **AI task files** that you run one by one in **Claude Code** or **Antigravity**. A built-in **verify** step screenshots the original export and your Next.js app side by side and only accepts a task when they match.

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

If `framer-export` is installed globally you can write `fexport convert ...` instead of `node bin/fexport.js convert ...`. Inside generated task files the command is written as `npx -p framer-export fexport convert ...`.

---

## 3. Commands

| Command | Where to run | What it does |
|---|---|---|
| `fexport convert <exportDir> [nextDir] [--yes]` | anywhere | Runs analyze → CMS extract → scaffold → task generation. `nextDir` defaults to `<exportDir>-next`. Safe to re-run: finished stages are skipped and files you edited are kept (it asks before overwriting; `--yes` auto-confirms). |
| `fexport convert status` | inside the generated project | Shows stage status, task counts, warnings and the animation checklist. |
| `fexport convert next` | inside the generated project | Shows the next task to give your AI agent (fix tasks first, then components, pages, motion). |
| `fexport convert verify [target]` | inside the generated project | Builds the Next.js app, screenshots both sites at 1440 / 1000 / 390 px and compares them section by section. `target` is a task id (e.g. `101-page-home`) or a route (e.g. `/about`); no target = everything. |
| `fexport convert done <taskId>` | inside the generated project | Marks a **motion** task done after you have checked its animation checklist by eye. |

Windows + Git Bash tip: when the target is `/`, run `MSYS_NO_PATHCONV=1 fexport convert verify /` (otherwise Git Bash rewrites `/` into a Windows path). PowerShell and cmd are not affected.

---

## 4. The working loop

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

## 5. What gets generated

```
your-site-next/
├─ AGENTS.md, CLAUDE.md          rules + workflow for the AI agent
├─ src/app/                      one page.tsx per route; [slug] routes for CMS collections
│  ├─ globals.css                Tailwind v4 @theme: colors, fonts, type scale, breakpoints
│  └─ fonts.css                  @font-face rules (keeps unicode-range subsets)
├─ src/components/               filled in by component tasks
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

## 6. Options and environment variables

| Setting | Effect |
|---|---|
| `--yes` / `-y` | Auto-confirm prompts (e.g. overwriting edited files on re-run). |
| `FEXPORT_CONVERT_NO_ANIMATIONS=1` | Skip animation recording during analysis (faster; motion tasks will be empty). |
| `FEXPORT_E2E=1` | Enables the slow end-to-end test in this repo (`npm install` + `next build` of a generated project). |

The v2 wizard (`npm run cli:v2`) also offers **"Convert to a Next.js project now?"** after a successful Framer export.

---

## 7. Troubleshooting

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

## 8. Known limitations (beta)

- **Framer only.** Other platforms are planned behind the adapter interface.
- **Animations are checked by eye.** Recorded timings are estimates; some hero entrance animations are not detected.
- **Sections without visible size** in the original (e.g. hidden loaders) are not pixel-compared.
- **Component reference screenshots** can be missing at tablet/phone widths for components inside Framer's per-breakpoint wrappers; the HTML/CSS slice is still provided.
- **Not exported:** forms, accounts, payments, search or any backend behaviour.
- Generated project uses TypeScript 7 for `tsc` and TypeScript 6 for ESLint / Next's type check (typescript-eslint does not support TS 7 yet).
- Make sure you have the rights to convert the site (Framer marketplace templates often restrict use outside Framer).
