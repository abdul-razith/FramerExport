# Plan: Remove Tech-Stack Conversion from CLI v2

> **Goal:** Remove all code and tests added by abdul-razith for AI tech-stack conversion (Screen 5, framework scaffolding, Superpowers template generation, agent detection, and terminal spawning), while preserving CLI v2 as an interactive 4-screen website exporter.

## Proposed Changes

### 1. `src/cli-v2/index.ts`
- Remove import of `runScreenConvert` from `./screens/convert.js`.
- Update `showCliV2Help()` description from `fexport-v2 - Modern Interactive Website Exporter & Tech-Stack Rebuilder` to `fexport-v2 - Modern Interactive Website Exporter`.
- Update workflow list in help text to remove step 5.
- In `runCliV2Workflow()`, complete the workflow after Step 4 (`runScreenExport`) with `uiOutro` indicating export completion and output location.

### 2. Delete Screen 5 & Utility Files
- Delete `src/cli-v2/screens/convert.ts`
- Delete `src/cli-v2/utils/scaffold.ts`
- Delete `src/cli-v2/utils/superpowers-template.ts`
- Delete `src/cli-v2/utils/terminal-spawn.ts`
- Delete `src/cli-v2/utils/tool-check.ts`
- Remove empty directory `src/cli-v2/utils/`

### 3. Delete Associated Test Files
- Delete `tests/unit/cli-v2-convert.test.ts`
- Delete `tests/unit/cli-v2-scaffold.test.ts`
- Delete `tests/unit/cli-v2-superpowers-template.test.ts`
- Delete `tests/unit/cli-v2-terminal-spawn.test.ts`
- Delete `tests/unit/cli-v2-tool-check.test.ts`

### 4. Verification
- Run `node --import tsx --test tests/unit/cli-v2-*.test.ts` (screens, prompts, e2e)
- Run `npm test`
- Run `npm run typecheck`
- Run `npm run build`

---

## Tasks

- [ ] **Task 1: Update CLI v2 entrypoint & help text**
- [ ] **Task 2: Delete Screen 5 and utility files**
- [ ] **Task 3: Delete tech-stack conversion test files**
- [ ] **Task 4: Run full verification suite and build**
