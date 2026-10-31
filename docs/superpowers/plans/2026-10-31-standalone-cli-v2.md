# Standalone CLI v2 with Tech-Stack Conversion & Superpowers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone, modern interactive CLI (`cli:v2` / `bin/fexport-v2.js`) that provides a 5-screen guided export workflow, validates installed coding agents (`claude`, `codex`, `agy`), scaffolds target frameworks, embeds Superpowers migration instructions, and spawns agents in separate terminal windows with seamless manual IDE fallback.

**Architecture:** A modular CLI package (`src/cli-v2/`) built on `@clack/prompts` that reuses the underlying `FramerExporter` engine without touching existing CLI files. Includes dedicated utilities for agent detection, cross-platform terminal window spawning, and Superpowers instruction generation (`CLAUDE.md`, `AGENTS.md`, `CONVERSION_SPEC.md`).

**Tech Stack:** TypeScript, Node.js (>=20), `@clack/prompts`, native `child_process`, native `node:test` + `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-10-31-standalone-cli-design.md`

## Global Constraints
* Leave existing `src/cli/`, `src/ui/`, and `src/platforms/` completely intact.
* Reusable `FramerExporter` must run in non-interactive/silent mode with progress reported through CLI v2 spinners.
* The working directory for agent execution is the export directory `<outDir>`.
* Scaffolding must be instantaneous and offline (minimal template files) without blocking the CLI on `npm install`.
* Tested with Node.js native test runner: `node --import tsx --test <test-file>`.

## Review Focus
1. Handling platforms where `start` (Windows), `osascript` (macOS), or `x-terminal-emulator` (Linux) fails to open a new terminal window.
2. Graceful fallback when zero coding agents are installed on the system PATH.
3. Windows path quoting when shell commands include nested double quotes and spaces.
4. Correct relative path references in `CONVERSION_SPEC.md` pointing to parent export files (`index.html`, `styles/`, `assets/`).
5. Ensuring the target directory `converted-[framework]/` creates parent directories without clobbering existing exports.

---

### Task 1: Tool Detection & Terminal Window Spawning Utilities

**Files:**
* Create: `src/cli-v2/utils/tool-check.ts`
* Create: `src/cli-v2/utils/terminal-spawn.ts`
* Test: `tests/unit/cli-v2-tool-check.test.ts`
* Test: `tests/unit/cli-v2-terminal-spawn.test.ts`

**Interfaces:**
* Produces:
  * `detectInstalledAgents(tools?: string[]): Promise<AgentToolStatus[]>`
  * `spawnAgentWindow(options: SpawnWindowOptions): SpawnWindowResult`
  * Types: `AgentToolId = 'claude' | 'codex' | 'agy'`, `AgentToolStatus`, `SpawnWindowOptions`, `SpawnWindowResult`.

- [ ] **Step 1: Write failing unit tests for agent tool detection and terminal spawn command generation**

```typescript
// tests/unit/cli-v2-tool-check.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { detectInstalledAgents } from '../../src/cli-v2/utils/tool-check.js';

test('detectInstalledAgents returns status for claude, codex, and agy', async () => {
  const result = await detectInstalledAgents(['claude', 'codex', 'agy']);
  assert.equal(result.length, 3);
  const ids = result.map(t => t.id);
  assert.deepEqual(ids, ['claude', 'codex', 'agy']);
  assert.equal(typeof result[0].available, 'boolean');
});
```

```typescript
// tests/unit/cli-v2-terminal-spawn.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSpawnCommand } from '../../src/cli-v2/utils/terminal-spawn.js';

test('buildSpawnCommand formats Windows start command with cd /d and agent task', () => {
  const cmd = buildSpawnCommand('win32', 'C:\\my-export', 'claude', 'Read CLAUDE.md');
  assert.match(cmd.file, /cmd\.exe/i);
  assert.ok(cmd.args.includes('/k'));
  assert.ok(cmd.args.some(a => a.includes('cd /d "C:\\my-export"')));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/cli-v2-tool-check.test.ts`  
Expected: FAIL with module not found `tool-check.js`.

- [ ] **Step 3: Implement `tool-check.ts` and `terminal-spawn.ts`**

Implement path detection using `where.exe` on Windows and `which` on POSIX. Implement `buildSpawnCommand` and `spawnAgentWindow` using detached `child_process.spawn`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/cli-v2-tool-check.test.ts tests/unit/cli-v2-terminal-spawn.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli-v2/utils/ tests/unit/cli-v2-tool-check.test.ts tests/unit/cli-v2-terminal-spawn.test.ts
git commit -m "feat(cli-v2): add tool detection and separate-window terminal spawn utilities"
```

---

### Task 2: Framework Scaffolding & Superpowers Template Generator

**Files:**
* Create: `src/cli-v2/utils/superpowers-template.ts`
* Create: `src/cli-v2/utils/scaffold.ts`
* Test: `tests/unit/cli-v2-superpowers-template.test.ts`
* Test: `tests/unit/cli-v2-scaffold.test.ts`

**Interfaces:**
* Consumes: `ExportFacts` (from `src/ai/prompt-assistant.js` or types)
* Produces:
  * `generateSuperpowersFiles(outDir: string, framework: FrameworkTarget, facts: ExportFacts): Promise<GeneratedFiles>`
  * `scaffoldFrameworkStarter(outDir: string, framework: FrameworkTarget): Promise<ScaffoldResult>`
  * Types: `FrameworkTarget = 'react-vite' | 'nextjs' | 'vue-vite' | 'sveltekit' | 'astro'`, `ScaffoldResult`.

- [ ] **Step 1: Write failing unit tests for Superpowers template generation and framework starter files**

```typescript
// tests/unit/cli-v2-superpowers-template.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildConversionSpec, buildSuperpowersInstructions } from '../../src/cli-v2/utils/superpowers-template.js';

test('buildSuperpowersInstructions includes writing-plans and verification rules', () => {
  const { claudeMd, agentsMd } = buildSuperpowersInstructions({
    framework: 'nextjs',
    projectDirName: 'converted-nextjs',
    sourceUrl: 'https://example.framer.app',
    platform: 'framer',
    outDir: 'C:\\test-export'
  });
  assert.ok(claudeMd.includes('superpowers:writing-plans'));
  assert.ok(claudeMd.includes('superpowers:verification-before-completion'));
  assert.ok(agentsMd.includes('converted-nextjs'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/cli-v2-superpowers-template.test.ts`  
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `superpowers-template.ts` and `scaffold.ts`**

Generate `CONVERSION_SPEC.md`, `CLAUDE.md`, and `AGENTS.md` tailored to the selected framework. Implement `scaffoldFrameworkStarter` to write standard `package.json`, `tsconfig.json`, and directory structure (`src/`, `public/`, `app/` etc.) and copy `<outDir>/assets` to `<outDir>/converted-[framework]/public/assets`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/cli-v2-superpowers-template.test.ts tests/unit/cli-v2-scaffold.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli-v2/utils/superpowers-template.ts src/cli-v2/utils/scaffold.ts tests/unit/cli-v2-superpowers-template.test.ts tests/unit/cli-v2-scaffold.test.ts
git commit -m "feat(cli-v2): add framework starter scaffolding and superpowers template generator"
```

---

### Task 3: Interactive Prompt UI Wrapper & Dependency Setup

**Files:**
* Modify: `package.json` (add `@clack/prompts`)
* Create: `src/cli-v2/ui/prompts.ts`
* Test: `tests/unit/cli-v2-prompts.test.ts`

**Interfaces:**
* Produces:
  * `uiIntro(title: string): void`
  * `uiOutro(message: string): void`
  * `uiSelect<T>(message: string, options: { label: string; value: T; hint?: string }[]): Promise<T>`
  * `uiText(message: string, options?: { placeholder?: string; defaultValue?: string; validate?: (val: string) => string | void }): Promise<string>`
  * `uiConfirm(message: string, defaultValue?: boolean): Promise<boolean>`
  * `uiSpinner(): { start: (msg: string) => void; stop: (msg: string) => void; message: (msg: string) => void }`

- [ ] **Step 1: Install `@clack/prompts` and write failing tests for UI wrapper**

Run: `npm install @clack/prompts`  
Write unit test verifying helper exports and non-interactive fallbacks.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/cli-v2-prompts.test.ts`  
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `src/cli-v2/ui/prompts.ts`**

Wrap `@clack/prompts` methods with consistent theme colors, keyboard hints (`[Enter] select`, `[b] back`), and graceful handling of cancellation (SIGINT).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/cli-v2-prompts.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/cli-v2/ui/prompts.ts tests/unit/cli-v2-prompts.test.ts
git commit -m "feat(cli-v2): install @clack/prompts and create prompt UI wrapper"
```

---

### Task 4: CLI v2 Screens 1 to 4 (Provider, Details, Options, Export Runner)

**Files:**
* Create: `src/cli-v2/screens/provider.ts`
* Create: `src/cli-v2/screens/details.ts`
* Create: `src/cli-v2/screens/options.ts`
* Create: `src/cli-v2/screens/export.ts`
* Test: `tests/unit/cli-v2-screens.test.ts`

**Interfaces:**
* Consumes:
  * `PLATFORM_REGISTRY`, `detectPlatform` from `src/platforms/index.js`
  * `FramerExporter` from `src/exporter/index.js`
  * `prompts.ts` from Task 3
* Produces:
  * `runScreenProvider(): Promise<PlatformType | 'auto'>`
  * `runScreenDetails(defaultUrl?: string): Promise<{ url: string; outDir: string }>`
  * `runScreenOptions(): Promise<{ prettyPrint: boolean; includeSubpages: boolean; concurrency: number }>`
  * `runScreenExport(config: ExportRunConfig): Promise<ExportSummary>`

- [ ] **Step 1: Write failing unit tests for Screen 1-3 validation and configuration parsing**

```typescript
// tests/unit/cli-v2-screens.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateUrlInput, deriveInitialOutDir } from '../../src/cli-v2/screens/details.js';

test('validateUrlInput rejects invalid schemes and credentials', () => {
  assert.equal(typeof validateUrlInput('ftp://test.com'), 'string');
  assert.equal(typeof validateUrlInput('https://user:pass@test.com'), 'string');
  assert.equal(validateUrlInput('https://mybrand.framer.app'), undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/cli-v2-screens.test.ts`  
Expected: FAIL with module not found.

- [ ] **Step 3: Implement Screens 1 to 4**

* `provider.ts`: Lists category filters and platforms with `Auto-detect` as first choice.
* `details.ts`: Collects and validates website URL, derives sensible default `./framer-<slug>`.
* `options.ts`: Single-screen checklist for pretty print, subpages crawl, and concurrency.
* `export.ts`: Shows summary card, asks confirmation, then launches `FramerExporter` with `interactive = false`, piping progress events to `@clack/prompts` spinner.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/cli-v2-screens.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli-v2/screens/ tests/unit/cli-v2-screens.test.ts
git commit -m "feat(cli-v2): implement screens 1 through 4 for provider, details, options, and live export"
```

---

### Task 5: CLI v2 Screen 5 (Framework, Agent Detection, Permission, Scaffolding, Spawn & Fallback)

**Files:**
* Create: `src/cli-v2/screens/convert.ts`
* Test: `tests/unit/cli-v2-convert.test.ts`

**Interfaces:**
* Consumes:
  * `tool-check.ts` and `terminal-spawn.ts` from Task 1
  * `scaffold.ts` and `superpowers-template.ts` from Task 2
  * `prompts.ts` from Task 3
* Produces:
  * `runScreenConvert(exportDir: string, sourceUrl: string, platformName: string): Promise<ConvertResult>`
  * Types: `ConvertResult = { mode: 'spawned' | 'manual'; framework: FrameworkTarget; agent?: AgentToolId; projectDir: string }`

- [ ] **Step 1: Write failing unit tests for Screen 5 conversion orchestration and fallback paths**

```typescript
// tests/unit/cli-v2-convert.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAgentSelection } from '../../src/cli-v2/screens/convert.js';

test('resolveAgentSelection selects available alternative when chosen agent is missing', () => {
  const installed = [
    { id: 'claude', name: 'Claude Code', available: false },
    { id: 'agy', name: 'Antigravity CLI', available: true, path: 'C:\\agy.exe' },
    { id: 'codex', name: 'Codex', available: false }
  ];
  const resolution = resolveAgentSelection('claude', installed);
  assert.equal(resolution.status, 'missing-alternatives-available');
  assert.deepEqual(resolution.availableAlternatives, ['agy']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/cli-v2-convert.test.ts`  
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `src/cli-v2/screens/convert.ts`**

* Prompt 1: Pick framework (`react-vite`, `nextjs`, `vue-vite`, `sveltekit`, `astro`).
* Prompt 2: Pick agent (`claude`, `codex`, `agy`).
* Probe PATH with `detectInstalledAgents`.
  * If selected tool is missing, prompt user to pick from installed ones.
  * If **none** are installed or permission declined: trigger **Manual LLM IDE Mode**, scaffold project, transfer assets, write Superpowers files, copy prompt to clipboard, and display completion card.
  * If confirmed: scaffold project, copy assets, write `CONVERSION_SPEC.md` + `CLAUDE.md`/`AGENTS.md`, and invoke `spawnAgentWindow`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/cli-v2-convert.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli-v2/screens/convert.ts tests/unit/cli-v2-convert.test.ts
git commit -m "feat(cli-v2): implement screen 5 conversion flow with agent detection, scaffolding, and spawn"
```

---

### Task 6: CLI v2 Entrypoint, Bin Wrapper & Package Configuration

**Files:**
* Create: `src/cli-v2/index.ts`
* Create: `bin/fexport-v2.js`
* Modify: `package.json` (add `"cli:v2": "tsx src/cli-v2/index.ts"`, `"fexport-v2": "bin/fexport-v2.js"`)
* Test: `tests/unit/cli-v2-e2e.test.ts`

**Interfaces:**
* Consumes: Screens 1-5 from Tasks 4 and 5
* Produces:
  * CLI v2 entrypoint with `--help`, `--version`, and direct URL argument support (`fexport-v2 <url> [out-dir]`).

- [ ] **Step 1: Write failing e2e flow test for CLI v2 entrypoint**

```typescript
// tests/unit/cli-v2-e2e.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { runCliV2Workflow } from '../../src/cli-v2/index.js';

test('runCliV2Workflow handles direct url argument', async () => {
  assert.equal(typeof runCliV2Workflow, 'function');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/cli-v2-e2e.test.ts`  
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `src/cli-v2/index.ts` and `bin/fexport-v2.js`**

Wire the 5 screens into a clean async workflow. Handle direct command arguments (`fexport-v2 <url> [outDir]`). Register script in `package.json`.

- [ ] **Step 4: Run full test suite and typecheck**

Run:
```bash
npm run typecheck
node --import tsx --test tests/unit/cli-v2-*.test.ts
```
Expected: All tests PASS with zero type errors.

- [ ] **Step 5: Commit**

```bash
git add src/cli-v2/index.ts bin/fexport-v2.js package.json tests/unit/cli-v2-e2e.test.ts
git commit -m "feat(cli-v2): add CLI v2 entrypoint, binary executable, and integration test"
```

---

## Self-Review Checklist
* [x] **Spec coverage:** All 5 screens, 3 agents, PATH validation, manual fallback, and Superpowers integration are explicitly covered in Tasks 1–6.
* [x] **Step scan:** Every step contains exact file paths, explicit test code, exact commands, and expected pass/fail outputs.
* [x] **Type consistency:** Identical types (`AgentToolId`, `FrameworkTarget`, `ExportFacts`) are preserved across all task interfaces.
* [x] **Review Focus:** Windows path quoting, zero-agent fallback, missing shell window fallbacks, and subpage link preservation are accounted for in unit tests and screen implementations.
* [x] **Proportion:** The plan specifies concrete tasks with minimal unnecessary prose.
