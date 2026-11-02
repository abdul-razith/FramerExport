# Plan: Add Original AI Prompt Conversion Assistant to CLI v2

> **Goal:** Integrate the original author's AI prompt assistant (`runAiPromptAssistant` from `src/ai/prompt-assistant.ts`) into CLI v2 (`src/cli-v2/`) so that users running `fexport-v2` get the exact same AI techstack conversion option after export completion as direct CLI exports.

## Tasks

- [ ] **Task 1: Update `src/cli-v2/screens/export.ts`**
  - Add `exporter: FramerExporter` field to `ExportSummary` interface.
  - Return `exporter` in the result of `runScreenExport`.

- [ ] **Task 2: Update `src/cli-v2/index.ts`**
  - Import `runAiPromptAssistant` from `../ai/prompt-assistant.js`.
  - In `runCliV2Workflow`, call `await runAiPromptAssistant(exportSummary.exporter);` immediately after `runScreenExport`.
  - In `showCliV2Help()`, mention the AI conversion prompt option in the workflow summary.

- [ ] **Task 3: Update and add tests**
  - In `tests/unit/cli-v2-screens.test.ts` or `tests/unit/cli-v2-e2e.test.ts`, verify the updated help text and `ExportSummary` interface contract.

- [ ] **Task 4: Run full verification suite**
  - `npm test`
  - `npm run typecheck`
  - `npm run build`
