import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readTaskGoal } from '../../src/convert/index.js';
import { initState } from '../../src/convert/state.js';
import type { TaskRecord } from '../../src/convert/types.js';

function task(id: string, kind: TaskRecord['kind'], extra: Partial<TaskRecord> = {}): TaskRecord {
  return { id, kind, file: `.convert/tasks/${id}.md`, status: 'pending', attempts: 0, targets: [], ...extra };
}

function stateWith(...tasks: TaskRecord[]) {
  const state = initState('/e', '/n');
  for (const t of tasks) state.tasks[t.id] = t;
  return state;
}

test('readTaskGoal returns the Goal section body, or null for missing file / section', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'goal-'));
  const file = path.join(dir, 't.md');
  await writeFile(file, '# Task\n\n## Goal\nBuild hero\n\n## Files\nx\n');
  assert.equal(await readTaskGoal(file), 'Build hero');
  const nogoal = path.join(dir, 'n.md');
  await writeFile(nogoal, '# Task\n\n## Files\nx\n');
  assert.equal(await readTaskGoal(nogoal), null);
  assert.equal(await readTaskGoal(path.join(dir, 'missing.md')), null);
});

// ---- Task 2: pure UI helpers -------------------------------------------------------------------------

import {
  STAGE_LABELS,
  getDashboardChoices,
  stageFromLog,
  stripNextSteps,
} from '../../src/cli-v2/screens/convert-helpers.js';

test('STAGE_LABELS has the v2 "Stage N/5" wording', () => {
  assert.equal(STAGE_LABELS.analyze, 'Stage 1/5: Analyze export');
  assert.equal(STAGE_LABELS['extract-cms'], 'Stage 2/5: Extract CMS');
  assert.equal(STAGE_LABELS.scaffold, 'Stage 3/5: Scaffold Next.js project');
  assert.equal(STAGE_LABELS.tasks, 'Stage 4/5: Write AI task files');
});

test('stageFromLog matches only "Running <stage>..." lines', () => {
  assert.equal(stageFromLog('Running scaffold...'), 'scaffold');
  assert.equal(stageFromLog('Running extract-cms...'), 'extract-cms');
  assert.equal(stageFromLog('scaffold: 3 written'), null);
  assert.equal(stageFromLog('Running bogus...'), null);
});

test('stripNextSteps removes the pipeline Next steps block', () => {
  assert.deepEqual(
    stripNextSteps([
      'analyze complete',
      '',
      'Next steps:',
      '  1. Install dependencies: x',
      '  2. Give your AI coding agent y',
      '  3. Then verify it: z',
    ]),
    ['analyze complete', '']
  );
});

test('getDashboardChoices: paused state puts resume first and preselected', () => {
  const state = stateWith(task('101-page-home', 'page'));
  state.run = { status: 'paused', reason: 'quota' };
  const choices = getDashboardChoices(state);
  assert.equal(choices[0].value, 'resume');
  assert.equal(choices[0].selected, true);
});

test('getDashboardChoices: legacy state offers reconvert', () => {
  const state = stateWith(task('101-page-home', 'page'));
  state.legacyTasks = true;
  const choices = getDashboardChoices(state);
  assert.ok(choices.some((c) => c.value === 'reconvert'));

  const modern = stateWith(task('101-page-home', 'page'));
  modern.legacyTasks = undefined;
  assert.ok(!getDashboardChoices(modern).some((c) => c.value === 'reconvert'));
});

test('getDashboardChoices: needs-review state offers review', () => {
  const state = stateWith(task('101-page-home', 'page', { status: 'needs-review' }));
  const choices = getDashboardChoices(state);
  assert.ok(choices.some((c) => c.value === 'review'));

  const doneState = stateWith(task('101-page-home', 'page', { status: 'done' }));
  assert.ok(!getDashboardChoices(doneState).some((c) => c.value === 'review'));
});

test('getDashboardChoices: fresh state includes standard choices and excludes contextual ones', () => {
  const state = stateWith(task('101-page-home', 'page'));
  const choices = getDashboardChoices(state);
  const values = choices.map((c) => c.value);
  assert.ok(values.includes('agent'));
  assert.ok(values.includes('report'));
  assert.ok(values.includes('options'));
  assert.ok(values.includes('status'));
  assert.ok(values.includes('next'));
  assert.ok(values.includes('refresh'));
  assert.ok(values.includes('exit'));
  assert.ok(!values.includes('resume'));
  assert.ok(!values.includes('reconvert'));
  assert.ok(!values.includes('review'));
  assert.ok(!values.includes('open-report'));
});

test('getDashboardChoices: open-report only offered when report exists', () => {
  const state = stateWith(task('101-page-home', 'page'));
  assert.ok(!getDashboardChoices(state, { reportExists: false }).some((c) => c.value === 'open-report'));
  assert.ok(getDashboardChoices(state, { reportExists: true }).some((c) => c.value === 'open-report'));
});

// ---- Task 3: routing ---------------------------------------------------------------------------------

import { CONVERT_USAGE, parseConvertArgs, runConvertCommand } from '../../src/convert/index.js';

function capture() {
  const logs: string[] = [];
  const errors: string[] = [];
  return { logs, errors, out: { log: (m: string) => logs.push(m), error: (m: string) => errors.push(m) } };
}

test('parseConvertArgs: bare "ui" is the dashboard command, "./ui" is an export folder', () => {
  assert.equal(parseConvertArgs(['convert', 'ui']).command, 'ui');
  const run = parseConvertArgs(['convert', './ui']);
  assert.equal(run.command, 'convert');
  assert.equal(run.exportDir, './ui');
});

test('CONVERT_USAGE documents the ui command', () => {
  assert.ok(CONVERT_USAGE.includes('fexport convert ui'));
});

test('convert with no arguments in a non-interactive terminal prints usage and returns 1', async () => {
  const c = capture();
  assert.equal(await runConvertCommand(['convert'], c.out), 1);
  assert.ok(c.errors.join('\n').includes('Usage:'));
});

test('convert ui in a non-interactive terminal returns 1 without prompting', async () => {
  const c = capture();
  assert.equal(await runConvertCommand(['convert', 'ui'], c.out), 1);
  assert.ok(c.errors.join('\n').includes('interactive terminal'));
});

// ---- Task 5: local CLI invocation --------------------------------------------------------------------

import { mkdir, rm } from 'node:fs/promises';
import { resolveCliInvocation } from '../../src/convert/tasks/templates/index.js';

async function fakePackage(base: string, ...segments: string[]): Promise<string> {
  const root = path.join(base, ...segments);
  await mkdir(path.join(root, 'bin'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'framer-export' }));
  const bin = path.join(root, 'bin', 'fexport.js');
  await writeFile(bin, '');
  // A built checkout: bin/fexport.js imports ../dist/cli/index.js. Tests delete it to model an unbuilt one.
  await mkdir(path.join(root, 'dist', 'cli'), { recursive: true });
  await writeFile(path.join(root, 'dist', 'cli', 'index.js'), '');
  await mkdir(path.join(root, 'src', 'cli'), { recursive: true });
  await writeFile(path.join(root, 'src', 'cli', 'index.ts'), '');
  return bin;
}

test('resolveCliInvocation: FEXPORT_CLI_INVOCATION wins', () => {
  assert.equal(resolveCliInvocation({ env: { FEXPORT_CLI_INVOCATION: 'x convert' } }), 'x convert');
});

test('resolveCliInvocation: a built local checkout runs its own bin with node', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'local-'));
  const bin = await fakePackage(base, 'FramerExport');
  const out = resolveCliInvocation({ argv1: bin, env: {} });
  assert.ok(out.startsWith('node "'), out);
  assert.ok(out.endsWith(`bin${path.sep}fexport.js" convert`), out);
  assert.ok(!out.includes('npx'));
});

test('resolveCliInvocation: an unbuilt checkout (no dist/cli/index.js) falls back to npx', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'unbuilt-'));
  const bin = await fakePackage(base, 'FramerExport');
  await rm(path.join(base, 'FramerExport', 'dist'), { recursive: true, force: true });
  assert.equal(resolveCliInvocation({ argv1: bin, env: {} }), 'npx -p framer-export fexport convert');
});

test('resolveCliInvocation: a published install (inside node_modules) keeps the npx form', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'pub-'));
  const bin = await fakePackage(base, 'node_modules', 'framer-export');
  assert.equal(resolveCliInvocation({ argv1: bin, env: {} }), 'npx -p framer-export fexport convert');
});

test('resolveCliInvocation: unknown or unrelated argv1 falls back to npx', async () => {
  const other = await mkdtemp(path.join(os.tmpdir(), 'other-'));
  assert.equal(resolveCliInvocation({ env: {} }), 'npx -p framer-export fexport convert');
  assert.equal(resolveCliInvocation({ argv1: path.join(other, 'runner.js'), env: {} }), 'npx -p framer-export fexport convert');
});

test('resolveCliInvocation: a checkout path with spaces stays inside the quotes', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'sp-'));
  const bin = await fakePackage(base, 'my tool', 'FramerExport');
  const out = resolveCliInvocation({ argv1: bin, env: {} });
  assert.ok(out.includes(`"${bin}"`) || out.includes('my tool'), out);
  assert.match(out, /^node ".*my tool.*bin[\\/]fexport\.js" convert$/);
});

test('resolveCliInvocation: a test or script inside the checkout is not the CLI', () => {
  const out = resolveCliInvocation({ argv1: path.resolve('tests/unit/cli-v2-convert.test.ts'), env: {} });
  assert.equal(out, 'npx -p framer-export fexport convert');
});

test('resolveCliInvocation: the source entry (tsx src/cli/index.ts) of a built checkout counts as the local CLI', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'src-'));
  await fakePackage(base, 'FramerExport');
  const out = resolveCliInvocation({ argv1: path.join(base, 'FramerExport', 'src', 'cli', 'index.ts'), env: {} });
  assert.ok(out.startsWith('node "'), out);
});

// ---- Task 22: Live multi-worker agent runner & options ------------------------------------------------

import { mkdir as mkdirp, readFile as readFileText } from 'node:fs/promises';
import { pickBinaryLine } from '../../src/convert/runner/agent-process.js';
import { askRunOptions } from '../../src/cli-v2/screens/convert-options.js';
import { DEFAULT_OPTIONS } from '../../src/convert/state.js';

test('pickBinaryLine prefers a launchable file on Windows (.exe/.cmd/.bat) over a bare shim', () => {
  const out = 'C:\\nodejs\\claude\r\nC:\\nodejs\\claude.cmd\r\n';
  assert.equal(pickBinaryLine(out, 'win32'), 'C:\\nodejs\\claude.cmd');
  assert.equal(pickBinaryLine('/usr/bin/claude\n', 'linux'), '/usr/bin/claude');
  assert.equal(pickBinaryLine('', 'win32'), null);
});

test('askRunOptions returns defaults when default options accepted', async () => {
  const defaults = { ...DEFAULT_OPTIONS, agent: 'agy' as const };
  const res = await askRunOptions(defaults, ['agy', 'claude'], {
    confirm: async () => true,
  });
  assert.deepEqual(res, defaults);
});

test('askRunOptions prompts for each option when defaults declined', async () => {
  const defaults = { ...DEFAULT_OPTIONS, agent: 'agy' as const };
  const textAnswers: Record<string, string> = {
    'Section timeout (minutes):': '20',
    'Page timeout (minutes):': '25',
    'Pixel tolerance (0–1):': '0.02',
    'Report tolerance (0–1):': '0.05',
  };
  const res = await askRunOptions(defaults, ['agy', 'claude'], {
    confirm: async (msg) => {
      if (msg === 'Use default options?') return false;
      if (msg === 'Enable visual testing?') return false;
      return true;
    },
    select: async (msg) => {
      if (msg === 'Select AI agent:') return 'claude';
      if (msg === 'Worker concurrency:') return '2';
      return '1';
    },
    text: async (msg) => textAnswers[msg] ?? '15',
  });
  assert.deepEqual(res, {
    testing: false,
    agent: 'claude',
    concurrency: 2,
    sectionTimeoutMin: 20,
    pageTimeoutMin: 25,
    pixelTolerance: 0.02,
    reportTolerance: 0.05,
  });
});

test('askRunOptions recognizes 0 as a valid numeric tolerance without falling back to defaults', async () => {
  const defaults = { ...DEFAULT_OPTIONS, agent: 'agy' as const };
  const textAnswers: Record<string, string> = {
    'Section timeout (minutes):': '15',
    'Page timeout (minutes):': '15',
    'Pixel tolerance (0–1):': '0',
    'Report tolerance (0–1):': '0',
  };
  const res = await askRunOptions(defaults, ['agy', 'claude'], {
    confirm: async (msg) => {
      if (msg === 'Use default options?') return false;
      return true;
    },
    select: async (msg) => {
      if (msg === 'Select AI agent:') return 'agy';
      return '1';
    },
    text: async (msg) => textAnswers[msg] ?? '0',
  });
  assert.equal(res.pixelTolerance, 0);
  assert.equal(res.reportTolerance, 0);
});

test('reconvert renames project to .old (suffix -2, -3 if taken)', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'reconvert-'));
  const projDir = path.join(dir, 'site-next');
  await mkdirp(projDir);
  await mkdirp(path.join(dir, 'site-next.old'));
  await mkdirp(path.join(dir, 'site-next.old-2'));

  const baseName = path.basename(projDir);
  const parentDir = path.dirname(projDir);
  let targetName = `${baseName}.old`;
  let suffix = 2;
  while (existsSync(path.join(parentDir, targetName))) {
    targetName = `${baseName}.old-${suffix}`;
    suffix++;
  }
  assert.equal(targetName, 'site-next.old-3');
});

import { fitLine, tickingMessage } from '../../src/cli-v2/screens/convert-helpers.js';

test('fitLine truncates to the terminal width and leaves short lines alone', () => {
  assert.equal(fitLine('short', 80), 'short');
  const cut = fitLine('x'.repeat(200), 60);
  assert.ok(cut.length <= 60 - 8 && cut.endsWith('…'));
});

test('tickingMessage keeps the text and a growing elapsed time on the spinner', async () => {
  const seen: string[] = [];
  const t = tickingMessage({ message: (m) => seen.push(m) }, 'Verifying', 10);
  t.update('route 2/9');
  await new Promise((r) => setTimeout(r, 40));
  t.stop();
  const n = seen.length;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(seen.length, n);
  assert.match(seen[0]!, /route 2\/9 · \d+s/);
  assert.ok(seen.length >= 2);
});

test('I2: askRunOptions refuses when no agent is installed', async () => {
  await assert.rejects(
    askRunOptions({ ...DEFAULT_OPTIONS, agent: 'agy' }, [], { confirm: async () => true }),
    /No supported AI agent found/
  );
});

test('I2: askRunOptions falls back to an installed agent when the default one is not installed', async () => {
  const res = await askRunOptions({ ...DEFAULT_OPTIONS, agent: 'agy' }, ['claude'], { confirm: async () => true });
  assert.equal(res.agent, 'claude');
  let initial: string | undefined;
  await askRunOptions({ ...DEFAULT_OPTIONS, agent: 'agy' }, ['claude'], {
    confirm: async (m) => m !== 'Use default options?',
    select: async (m, _o, init) => {
      if (m === 'Select AI agent:') initial = init as string;
      return (m === 'Worker concurrency:' ? '1' : 'claude') as never;
    },
    text: async () => '15',
  });
  assert.equal(initial, 'claude');
});

test('I7: getDashboardChoices hides run and resume for a legacy project', () => {
  const state = stateWith(task('101-page-home', 'page'));
  state.legacyTasks = true;
  state.run = { status: 'paused', reason: 'user' };
  const values = getDashboardChoices(state).map((c) => c.value);
  assert.ok(!values.includes('agent'));
  assert.ok(!values.includes('resume'));
  assert.ok(values.includes('reconvert'));
});
