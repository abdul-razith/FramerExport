# Design Document: Standalone Interactive CLI with Tech-Stack Conversion & Superpowers Integration

**Date:** 2026-10-31  
**Status:** Draft for Builder Review  
**Target File:** `docs/superpowers/specs/2026-10-31-standalone-cli-design.md`  

---

## 1. Intent & Purpose

The existing FramerExport CLI uses a custom ANSI cell rendering and log-viewer mechanism that forcibly disables interactive prompts during downloads and can feel cumbersome on Windows terminals (PowerShell/CMD). Furthermore, while FramerExport captures static website mirrors (HTML/CSS/JS/assets), users need an automated, error-free path to convert those static files into modern frameworks (React, Next.js, Vue, SvelteKit, Astro).

This project introduces a **brand-new, separate standalone CLI** (`fexport-v2` / `npm run cli:v2`) that:
1. Leaves the existing CLI and Web UI completely intact.
2. Implements a clean, 5-screen interactive workflow using lightweight, modern terminal prompts with intuitive keyboard shortcuts.
3. Seamlessly bridges static site export with automated tech-stack conversion by scaffolding the target framework, generating detailed Superpowers-native migration specs, and launching the user's preferred AI coding agent in a separate terminal window.

---

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
* **Zero Disruption:** Create a separate entrypoint (`src/cli-v2/`) without modifying existing core logic or old CLI files.
* **5-Screen Guided Flow:**
  * **Screen 1 (Provider):** Auto-detection by default, or quick single-key category/provider selection.
  * **Screen 2 (Details):** Input for public website URL and suggested output directory.
  * **Screen 3 (Options):** Toggles for JavaScript formatting (`prettyPrint`), sub-page crawling (`includeSubpages`), and parallel download concurrency.
  * **Screen 4 (Review & Live Export):** Review card before launch, followed by smooth progress spinners and live asset counters during capture.
  * **Screen 5 (Tech Stack & Agent Conversion):**
    * Selection of target framework (React + Vite, Next.js App Router, Vue + Vite, SvelteKit, Astro).
    * Selection of coding agent (Claude Code, Codex, or AGY / Antigravity).
    * Automated PATH validation for the selected tool. If not installed, gracefully display which of the supported tools *are* installed on the machine.
    * Permission confirmation before execution.
    * Pre-scaffold target framework directory, transfer exported assets (`/assets` $\to$ `/public/assets`), and generate `CONVERSION_SPEC.md` + `CLAUDE.md`/`AGENTS.md`.
    * Launch the agent in a **new separate terminal window** to perform a verified rebuild.
* **Superpowers-Native Quality:** Embed `superpowers:writing-plans` instructions into the scaffolded project so the agent builds task-by-task with verification (`npm run build`) instead of risky one-shot code generation.

### Non-Goals
* No modifications to existing `src/cli/`, `src/ui/`, or platform handlers.
* Not building an internal LLM compiler; code transformation is delegated to the user's installed coding agent.
* No lengthy installation tutorials in the terminal if an agent is missing—just list the installed alternatives.

### Anti-Goals
* **No Fragile ANSI Buffers:** Avoid custom cell manipulation protocols that glitch on standard Windows consoles.
* **No Terminal Hijacking:** The conversion agent must run in its own window so the exporter CLI session remains clean and usable.
* **No Unverified 1-Shot Prompts:** Avoid dumping unguided 500KB HTML prompts that cause hallucinations or truncation.

---

## 3. Architecture & 5-Screen Workflow

```
[Screen 1: Provider] ──► [Screen 2: Details] ──► [Screen 3: Options] ──► [Screen 4: Export]
                                                                               │
                                                                               ▼
                                                                     [Screen 5: Conversion]
                                                                               │
                                                 ┌─────────────────────────────┴────────────────────────────┐
                                                 ▼                                                          ▼
                                     [Tool PATH Validation]                                     [Scaffold & Assets Setup]
                                                 │                                                          │
                                                 └─────────────────────────────┬────────────────────────────┘
                                                                               ▼
                                                                [Write Superpowers Instructions]
                                                                               │
                                                                               ▼
                                                            [Spawn Agent in New Terminal Window]
```

### Screen Breakdown

#### Screen 1: Select Provider
* **Default:** `Auto-detect from URL` (recommended).
* **Keyboard Navigation:** Arrow keys or number selection. Option to filter by platform category (Builders, CMS, E-commerce, Landing Pages).
* **Shortcuts:** `[Enter]` to confirm, `[q]` to quit.

#### Screen 2: Site Details
* **Website URL:** Validated URL input (http/https).
* **Output Directory:** Auto-derived default based on domain name (e.g. `./framer-mybrand`), with inline editing.
* **Shortcuts:** `[Enter]` to proceed, `[b]` to go back.

#### Screen 3: Options
* **Format JavaScript:** Checkbox / toggle (Default: `Yes`).
* **Include Sub-pages:** Checkbox / toggle (Default: `No`).
* **Concurrency:** Select between `6 (low bandwidth)`, `12 (balanced)`, `20 (fast)`.
* **Shortcuts:** `[Enter]` to proceed, `[b]` to go back.

#### Screen 4: Review & Live Export
* **Summary Card:** Displays provider, URL, output path, concurrency, and subpage crawl status.
* **Confirmation:** Press `[Enter]` to start export.
* **Live Progress:** Runs `FramerExporter` with clean spinners/progress updates (phases: detecting, browser launch, downloading assets, processing HTML).
* **Completion:** Displays summary of saved assets, subpages, and elapsed time.

#### Screen 5: Tech Stack & Superpowers Conversion
* **Framework Selection:**
  1. `React + Vite + TypeScript`
  2. `Next.js App Router (TypeScript)`
  3. `Vue + Vite + TypeScript`
  4. `SvelteKit (TypeScript)`
  5. `Astro (TypeScript)`
* **Agent Selection:**
  1. `Claude Code` (`claude`)
  2. `Codex` (`codex`)
  3. `AGY / Antigravity CLI` (`agy`)
* **PATH Validation & Fallback to Manual LLM IDE:**
  * Probes system PATH for `claude`, `codex`, `agy`.
  * If the selected tool is missing, but other supported tools exist: displays the installed options and allows the user to switch.
  * If **none** of the three tools are installed on PATH (or if the user declines permission to launch a separate terminal window):
    * The CLI smoothly transitions to **Manual LLM IDE Mode**.
    * It still completes scaffolding of `<outDir>/converted-[framework]/`, transfers static assets, and writes `<outDir>/CONVERSION_SPEC.md` and `CLAUDE.md`/`AGENTS.md`.
    * Copies the complete Superpowers conversion brief to the clipboard automatically.
    * Prints a clean completion card with the project paths and instructions to open the folder in their preferred IDE (Cursor, VS Code, Windsurf) and paste the prompt.
* **Permission Confirmation:**
  * Prompts: `Scaffold Next.js project and launch 'agy' in a new window? [Y/n]`
* **Scaffolding & Superpowers Setup:**
  * Creates `<outDir>/converted-[framework]/` directory.
  * Copies static assets into the framework's public directory (`<outDir>/assets` $\to$ `<outDir>/converted-[framework]/public/assets`).
  * Writes `<outDir>/CONVERSION_SPEC.md` detailing the exported page structure, subpages, styles, and component targets.
  * Writes `<outDir>/CLAUDE.md` and `<outDir>/AGENTS.md` containing strict Superpowers instructions:
    * Require `superpowers:writing-plans` to outline component conversion from the parent export files.
    * Require `superpowers:executing-plans` / `subagent-driven-development` to build section by section into `converted-[framework]/`.
    * Require `superpowers:verification-before-completion` with `npm run build` validation inside `converted-[framework]/`.
  * **Builder Call on Dependency Install:** Initial scaffolding sets up the project structure and `package.json` without blocking the CLI on long `npm install` downloads. The generated Superpowers plan instructs the agent to run `npm install` as its first verified action.
* **Execution & Workspace Scope:**
  * **Builder Call on Execution Scope:** The agent is launched with the export folder `<outDir>` as the working directory. This ensures the agent has unrestricted read access to `index.html`, `styles/`, and `subpages/` while writing into `converted-[framework]/`, avoiding agent sandbox boundary restrictions.
  * **Builder Call on Command Invocation:** Launches the agent with a direct kickoff task pointing to the spec while simultaneously copying the prompt to the system clipboard:
    * Claude Code: `claude "Read CLAUDE.md and CONVERSION_SPEC.md to begin the conversion using Superpowers"`
    * AGY: `agy "Read AGENTS.md and CONVERSION_SPEC.md to begin the conversion using Superpowers"`
    * Codex: `codex "Read AGENTS.md and CONVERSION_SPEC.md to begin the conversion using Superpowers"`
  * Spawns a new terminal window:
    * **Windows:** `start cmd /k "cd /d \"<outDir>\" && <agent-command>"`
    * **macOS:** `osascript -e 'tell application "Terminal" to do script "cd \"<outDir>\" && <agent-command>"'`
    * **Linux:** `x-terminal-emulator -e "bash -c 'cd \"<outDir>\" && <agent-command>; exec bash'"`

---

## 4. Technical Implementation & Directory Layout

### New Files
* `src/cli-v2/index.ts` — Main CLI v2 entrypoint and argument parser.
* `src/cli-v2/screens/provider.ts` — Screen 1: Provider selection.
* `src/cli-v2/screens/details.ts` — Screen 2: URL & directory prompt.
* `src/cli-v2/screens/options.ts` — Screen 3: Options toggles.
* `src/cli-v2/screens/export.ts` — Screen 4: Live export runner with spinner.
* `src/cli-v2/screens/convert.ts` — Screen 5: Framework, agent validation, scaffolding, and spawn.
* `src/cli-v2/utils/tool-check.ts` — Utility to probe PATH for `claude`, `codex`, `agy`.
* `src/cli-v2/utils/terminal-spawn.ts` — Cross-platform spawn utility for opening separate terminal windows.
* `src/cli-v2/utils/superpowers-template.ts` — Generates `CLAUDE.md`, `AGENTS.md`, and `CONVERSION_SPEC.md`.
* `bin/fexport-v2.js` — Executable wrapper.

### Dependencies
* Use `@clack/prompts` or clean `inquirer` for polished, arrow/shortcut-friendly terminal screens.
* Uses native `node:child_process` for tool validation and separate-window spawning.

---

## 5. What is Left to the Builder
* Specific terminal UI library selection (`@clack/prompts` is recommended for modern visual style).
* Exact wording of the `CLAUDE.md` / `AGENTS.md` conversion instructions.
* Cross-platform fallback flags when `start cmd` or `x-terminal-emulator` fails.
