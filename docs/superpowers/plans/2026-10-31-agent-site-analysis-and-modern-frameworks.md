# Agent Site Analysis & Modern Framework Upgrades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade framework starters to modern versions (Next.js 15, React 19, Vite 6, Svelte 5, Astro 5) and structure the agent's workflow so Task 1 dynamically analyzes the exported website's vendor scripts and DOM structure, installs detected dependencies, and ensures 1:1 fidelity.

**Architecture:** 
1. Upgrade `getFrameworkPackageJson` in `scaffold.ts` to output current ecosystem versions for Next.js 15 (React 19), React+Vite (React 19, Vite 6), Vue 3.5, Svelte 5, and Astro 5.
2. In `superpowers-template.ts`, restructure `AGENTS.md`, `CLAUDE.md`, and `CONVERSION_SPEC.md` to mandate a dedicated **Task 1: Pre-Conversion Source & Dependency Analysis** before any component or code conversion begins.
3. In `CONVERSION_SPEC.md`, provide an explicit analysis checklist directing the agent to inspect `scripts/vendor/` and `index.html`, detect libraries (`lenis`, `gsap`, `framer-motion`, `lucide-react`, etc.), install them dynamically with `npm install`, and map the complete DOM tree.

**Tech Stack:** TypeScript, Node.js, Next.js 15, React 19, Vite 6, Framer Motion, Superpowers.

**Spec:** User requirements from session conversation 2026-10-31.

## Global Constraints
- Target workspace: `src/cli-v2/`
- Zero changes to existing v1 CLI (`src/cli/`) or UI (`src/ui/`)
- All unit tests must pass via `npm test`
- Build and TypeScript typecheck must pass with zero errors

## Review Focus
1. Next.js 15 and React 19 version compatibility in scaffolded `package.json`.
2. Clear and actionable instructions for the coding agent to analyze `scripts/vendor/` and run dynamic `npm install`.
3. Strict autonomous execution directives preserved without regression.

---

### Task 1: Update Framework Scaffolding to Modern Ecosystem Versions

**Files:**
- Modify: `src/cli-v2/utils/scaffold.ts`
- Modify: `tests/unit/cli-v2-scaffold.test.ts`

- [ ] **Step 1: Update test in `cli-v2-scaffold.test.ts` to assert modern versions**
  Assert Next.js 15 (`^15.0.0`), React 19 (`^19.0.0`), and Vite 6 (`^6.0.0`).
- [ ] **Step 2: Run test to verify RED failure**
  Run: `node --import tsx --test tests/unit/cli-v2-scaffold.test.ts`
- [ ] **Step 3: Update `getFrameworkPackageJson` in `src/cli-v2/utils/scaffold.ts`**
  Set Next.js to `^15.0.3`, React to `^19.0.0`, Vite to `^6.0.0`, Svelte to `^5.0.0`, Astro to `^5.0.0`.
- [ ] **Step 4: Run test to verify GREEN pass**
  Run: `node --import tsx --test tests/unit/cli-v2-scaffold.test.ts`
- [ ] **Step 5: Commit changes**
  Commit: `feat(cli-v2): upgrade framework starter templates to modern versions (Next 15, React 19, Vite 6)`

---

### Task 2: Implement Pre-Conversion Site Analysis Directives & Spec Templates

**Files:**
- Modify: `src/cli-v2/utils/superpowers-template.ts`
- Modify: `tests/unit/cli-v2-superpowers-template.test.ts`

- [ ] **Step 1: Update `cli-v2-superpowers-template.test.ts` to assert Task 1 Analysis directives**
  Assert that `CLAUDE.md`, `AGENTS.md`, and `CONVERSION_SPEC.md` include explicit instructions for analyzing `scripts/vendor/`, dynamic package installation, and DOM mapping as Task 1.
- [ ] **Step 2: Run test to verify RED failure**
  Run: `node --import tsx --test tests/unit/cli-v2-superpowers-template.test.ts`
- [ ] **Step 3: Update `buildSuperpowersInstructions` and `buildConversionSpec` in `src/cli-v2/utils/superpowers-template.ts`**
  Format Task 1 as: "Task 1: Source & Dependency Analysis – Inspect scripts/vendor/ and index.html, detect libraries (lenis, gsap, framer-motion, lucide-react), install them via npm install, and audit DOM components."
- [ ] **Step 4: Run test to verify GREEN pass**
  Run: `node --import tsx --test tests/unit/cli-v2-superpowers-template.test.ts`
- [ ] **Step 5: Commit changes**
  Commit: `feat(cli-v2): add mandatory pre-conversion site analysis and dynamic dependency installation directives`

---

### Task 3: Full Verification and Build

- [ ] **Step 1: Run complete repository test suite**
  Run: `npm test`
- [ ] **Step 2: Run production bundle build & typecheck**
  Run: `npm run build && npm run typecheck`
- [ ] **Step 3: Local merge to master**
  Merge feature branch to `master` and clean up.
