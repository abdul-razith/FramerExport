# Changelog

## Unreleased

### Section-Refactor Conversion Pipeline (fexport convert)

The Framer-to-Next.js converter has been redesigned around a granular, bounded section-refactor architecture that turns a Framer export into clean, editable Tailwind CSS v4 React components:

- **Section-by-section generation:** Deterministic generator splits pages into isolated section components under `src/sections/<page>/<Section>.tsx` with provably no-op inline style slimming (redundant computed styles removed, color/font variables mapped to `@theme` tokens), extracts shared shell sections into `src/components/shell/<Name>.tsx`, stubs dynamic route CMS templates, and detects script-drawn widgets (e.g., ticking clocks and rulers).
- **Automated pipeline stages:** Runs `analyze` → `extract-cms` → `scaffold` → `install` (`npm install`) → `generate` → `tasks` → `[baseline]` → `agent loop` → `finalize`. Scaffolded projects build and run immediately on `next dev` even before AI refactoring starts.
- **Automated AI agent runner:** `fexport convert run` provides a headless multi-worker pool supporting 1–3 concurrent agents with Claude Code (`claude`) or Antigravity (`agy`). Enforces hard wall-clock timeouts per task (`sectionTimeoutMin`, `pageTimeoutMin`), automatic process tree termination, and scope enforcement that snapshots project files and reverts out-of-scope edits.
- **Pause, resume, and crash recovery:** Gracefully pause after current tasks finish or immediately with `P` or Ctrl+C. Target files of interrupted tasks are preserved in `.convert/partial/` and cleanly restored to pending state without losing completed work. Safe runner locks (`.convert/run.lock`) clean up stale orphan processes on restart.
- **Quota resilience:** Automatically detects API rate limits and quota errors (`429`, `RESOURCE_EXHAUSTED`), halts task dispatch safely, and allows instant agent switching (`agy` ↔ `claude`) to resume the conversion.
- **Interactive dashboard (`fexport convert ui`):** Live per-worker task progress lines, active working time tracking, backlog inspection, runner option configuration, report viewer, and manual task reviews.
- **Lenient, fast verification:** `fexport convert check <taskId> [--smoke]` validates compiled sections against baseline captures with visible DOM checks, link normalization, anti-aliased pixel matching, and motion presence detection, guarded by strict call limits.
- **Side-by-side visual comparison report:** `fexport convert report [route]` (alias: `verify`) serves the production build alongside the original export, automatically masks dynamic and ticking regions via 2-second capture diffing, records animation filmstrips on load and scroll, and generates an interactive HTML report at `.convert/report/index.html`.
- **Non-blocking human review:** Complex tasks failing their single fix attempt or timing out transition to `needs-review`, allowing the queue to proceed. Tasks can be inspected and marked done via `fexport convert review <taskId>` or the dashboard.
- **State v2 & migration:** Schema v2 stores relative paths for full portability across machines and folders. Automatically detects legacy v1 projects and offers clean re-conversion to `<project>.old`.

## 5.0.1

The stable release uses 5.0.1 because npm permanently reserves 5.0.0 from an earlier publication that is no longer available. This changes the release version without changing the validated application behavior.

The stable release uses npm's `latest` channel. Application headers show version 5.0.1 without the prerelease badge. `npm run release -- --bypass-tests` publishes the existing build directly, without tests or a build, like `npm publish --ignore-scripts`. Ordinary publication still runs all checks and builds first. `--dry-run` previews publication without uploading a package.

The terminal and web interfaces share provider identities, offline brand icons and a four-step export assistant. Cards/list views, search, pagination, mouse scrolling, a draggable terminal scrollbar, keyboard shortcuts and clickable completed steps preserve entered data while navigating. Settings, Help and Open UI use dialogs with hover states and contextual hints. The lowercase wordmark fits an 80×24 terminal and adapts to smaller windows.

Graphite surfaces and peach accents accompany a PixelBlast background adapted to terminal character cells. Motion is enabled by default; reduced-motion settings keep the terminal background still and reduce web animations. Native image modes keep the terminal background still to avoid image flicker. Provider logos use Kitty or iTerm image protocols, or Sixel when capability and cell-size probing succeed. Other terminals retain provider names and colored monograms; terminal fonts and graphics capabilities still determine physical rendering.

Wizard exports use a dedicated log viewer with line numbers, timestamps, level filters, search, pause/follow, horizontal panning and clipboard copying. The full session is retained while exporting. Esc or Ctrl+C returns to console output without falsely marking the operation as cancelled; completed and failed exports remain inspectable until closed. The web interface exposes logs in an editor-style dialog.

Both log viewers follow new entries automatically, pause when you scroll up and offer a Latest logs control to resume. More spacious rows retain their severity colors, with a gentle shine on active progress that respects reduced motion. Terminal rendering updates changed cells and keeps native icons in place; idle screens and mouse movement within the same control no longer trigger redraws. Header badges and versions sit to the right of the wordmark, provider controls have more space, and compact card layouts keep pagination visible.

First-run onboarding, preferences and resumable export drafts live in `~/.fexport`. Settings cover the default provider, view, export options, reduced motion, a companion browser UI and stable/beta update behavior. Confirmed reset clears preferences, the saved draft and the update cache while preserving exported folders and unrelated files. Automatic updates are opt-in, use semantic version ordering and preserve supported npm installation scope. `config`, `settings`, `doctor`, `--fresh` and `--no-update` provide direct access to these controls. Source code comments are removed; standalone licensing/provenance files remain.

Exports preserve dynamic CSS rules, constructed stylesheets, nested CSS imports, responsive resource variants and stylesheet redirects. Asset filenames no longer overwrite unrelated files with the same basename, and missing resources are listed in `export-report.json` instead of being rewritten to nonexistent files.

The capture respects explicit platform choices and final navigation URLs. Subpages receive the same hydration, scrolling and resource preparation as the entry page. Webflow keeps the opening HTML element and runtime attributes that earlier stripping rules removed. Dynamically requested captured stylesheets stay local.

The bundled browser is upgraded from Chrome 127 to Chrome 148 through Puppeteer 24.43.1. A current public Notion page rejected the old browser and loaded successfully with the updated one. Bubble and Notion snapshots also retain measured viewport-dependent inline styles, conditionally removed controls and JavaScript-selected image renditions.

Captured iframe HTML now retains local CSS, scripts and nested resources using each document's own URL base. Runtime image/script assignments and explicit worker resource declarations are localized when the exact resource was saved.

Framer CMS files remain binary even when their server labels them as JavaScript. Raw bytes are preserved, and exact captured public CMS GET requests load their local files, including captured range queries.

The UI rejects unsupported URL schemes, returns to the gallery after a rejected export request, and copies a preview command that points to the actual export directory. Failed captures preserve existing files and write diagnostics.

The new browser suite compares source and exported pages at desktop and mobile sizes, shuts down the source before replay, and tests navigation, form validation, CSSOM, stylesheet loaders and the full UI flow. Live checks still leave Wix mobile image variants, some Podia widgets and Framer animation states incompletely validated.

Bubble, Notion and Podia retain the beta label. Server-side accounts, payments, search and platform workflows are not recreated by a static export. Publication runs type checking, unit tests, browser tests and the production build by default; the explicit release bypass uploads the existing build directly. The default publication tag is `latest`.
