import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { markTaskDone, readTaskGoal } from '../../src/convert/index.js';
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

// ---- Task 1: shared helpers --------------------------------------------------------------------------

test('markTaskDone: missing id returns the usage error', () => {
  assert.deepEqual(markTaskDone(stateWith(), undefined), {
    ok: false,
    error: 'Usage: fexport convert done <taskId>',
  });
});

test('markTaskDone: unknown id returns Unknown task', () => {
  assert.deepEqual(markTaskDone(stateWith(), 'nope'), { ok: false, error: 'Unknown task: nope' });
});

test('markTaskDone: refuses a page task', () => {
  const r = markTaskDone(stateWith(task('101-page-home', 'page')), '101-page-home');
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.error.includes('"done" is only for motion tasks'));
});

test('markTaskDone: marks a motion task done', () => {
  const state = stateWith(task('201-motion-home', 'motion'));
  const r = markTaskDone(state, '201-motion-home');
  assert.equal(r.ok, true);
  assert.equal(state.tasks['201-motion-home'].status, 'done');
});

test('markTaskDone: accepts a fix task whose original is motion', () => {
  const state = stateWith(task('201-motion-home', 'motion'), task('fix-201-motion-home-1', 'fix'));
  const r = markTaskDone(state, 'fix-201-motion-home-1');
  assert.equal(r.ok, true);
  assert.equal(state.tasks['fix-201-motion-home-1'].status, 'done');
});

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
  formatVerifyError,
  formatVerifyResult,
  getDashboardChoices,
  getMotionChoices,
  getVerifyTargetChoices,
  stageFromLog,
  stripNextSteps,
} from '../../src/cli-v2/screens/convert-helpers.js';
import type { PageInfo } from '../../src/convert/types.js';

test('STAGE_LABELS has the v2 "Stage N/5" wording', () => {
  assert.equal(STAGE_LABELS.analyze, 'Stage 1/5: Analyze export');
  assert.equal(STAGE_LABELS['extract-cms'], 'Stage 2/5: Extract CMS');
  assert.equal(STAGE_LABELS.scaffold, 'Stage 3/5: Scaffold Next.js project');
  assert.equal(STAGE_LABELS.tasks, 'Stage 4/5: Write AI task files');
  assert.equal(STAGE_LABELS.verify, 'Stage 5/5: Verify against export');
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

test('getDashboardChoices: install first when node_modules is missing, hidden otherwise', () => {
  const state = stateWith(task('001-component-A', 'component'));
  assert.equal(getDashboardChoices(state, false)[0].value, 'install');
  assert.ok(!getDashboardChoices(state, true).some((c) => c.value === 'install'));
});

test('getDashboardChoices: generate is offered before next', () => {
  const values = getDashboardChoices(stateWith(task('001-component-A', 'component')), true).map((c) => c.value);
  assert.ok(values.indexOf('generate') >= 0 && values.indexOf('generate') < values.indexOf('next'));
});

test('getDashboardChoices: agent sits between next and verify', () => {
  const values = getDashboardChoices(stateWith(task('001-component-A', 'component')), true).map((c) => c.value);
  assert.ok(values.indexOf('next') < values.indexOf('agent'));
  assert.ok(values.indexOf('agent') < values.indexOf('verify'));
});

test('getDashboardChoices: "done" only appears when a motion task is incomplete', () => {
  const none = stateWith(task('101-page-home', 'page'));
  assert.ok(!getDashboardChoices(none, true).some((c) => c.value === 'done'));
  const some = stateWith(task('201-motion-home', 'motion', { route: '/' }));
  assert.ok(getDashboardChoices(some, true).some((c) => c.value === 'done'));
  const finished = stateWith(task('201-motion-home', 'motion', { status: 'done' }));
  assert.ok(!getDashboardChoices(finished, true).some((c) => c.value === 'done'));
});

test('getMotionChoices lists incomplete motion tasks and their fix tasks only', () => {
  const state = stateWith(
    task('201-motion-home', 'motion', { route: '/' }),
    task('202-motion-about', 'motion', { status: 'done' }),
    task('fix-201-motion-home-1', 'fix', { route: '/' }),
    task('101-page-home', 'page')
  );
  assert.deepEqual(getMotionChoices(state).map((c) => c.value).sort(), ['201-motion-home', 'fix-201-motion-home-1']);
});

test('getVerifyTargetChoices: pending task first, then all, tasks and page routes', () => {
  const pages = [{ route: '/about' }, { route: '/' }] as PageInfo[];
  const state = stateWith(task('001-component-A', 'component'));
  const choices = getVerifyTargetChoices(state, pages);
  assert.equal(choices[0].value, '001-component-A');
  assert.ok(choices[0].label.startsWith('Next pending task'));
  assert.ok(choices.some((c) => c.value === undefined && c.label === 'All outstanding tasks'));
  assert.ok(choices.some((c) => c.value === '/about' && c.hint === 'page route'));
  const empty = getVerifyTargetChoices(stateWith(), pages);
  assert.equal(empty[0].label, 'All outstanding tasks');
});

test('formatVerifyResult shows counts, failed ids and the report path', () => {
  const text = formatVerifyResult({ passed: ['a'], failed: ['b'] }, '/n');
  assert.ok(text.includes('Passed: 1'));
  assert.ok(text.includes('Failed: 1'));
  assert.ok(text.includes('b'));
  assert.ok(text.includes(path.join('/n', '.convert', 'diffs', 'report.json')));
});

test('formatVerifyError points a missing-dependencies error at the install action', () => {
  const msg = formatVerifyError(new Error('Dependencies not installed: run "npm install" in /n'));
  assert.ok(msg.includes('Dependencies not installed'));
  assert.ok(msg.includes('Install dependencies'));
  assert.equal(formatVerifyError('boom'), 'boom');
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
  assert.equal(run.command, 'run');
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

// ---- Task 6: AI agent runner -------------------------------------------------------------------------

import { mkdir as mkdirp, readFile as readFileText } from 'node:fs/promises';
import {
  buildAgentCommand,
  buildAgentPrompt,
  pickBinaryLine,
  runAgentLoop,
  runAgentOnTask,
} from '../../src/cli-v2/screens/convert-agent.js';
import { recordAttempt, saveState } from '../../src/convert/state.js';

test('buildAgentPrompt: fixed text with the task file, only shell-safe characters', () => {
  const p = buildAgentPrompt('.convert/tasks/001-component-Arrow.md');
  assert.equal(
    p,
    'Read AGENTS.md and .convert/tasks/001-component-Arrow.md then complete that task. Edit only the files listed under Edit only. Do not run verify, the dashboard runs it afterwards.'
  );
  assert.match(p, /^[A-Za-z0-9 ./_,-]+$/);
});

test('buildAgentPrompt rejects characters that are unsafe to quote', () => {
  assert.throws(() => buildAgentPrompt('a"b.md'));
  assert.throws(() => buildAgentPrompt('x & y.md'));
});

test('buildAgentCommand: same shape for agy and claude, no sandbox flag', () => {
  for (const agent of ['agy', 'claude'] as const) {
    const cmd = buildAgentCommand(agent, 'hello');
    assert.deepEqual(cmd, { command: agent, args: ['-p', 'hello', '--dangerously-skip-permissions'] });
    assert.ok(!cmd.args.includes('--sandbox'));
  }
});

test('runAgentOnTask runs in the project, reports files changed outside the task targets', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-'));
  await mkdirp(path.join(root, 'src'), { recursive: true });
  await mkdirp(path.join(root, 'node_modules', 'x'), { recursive: true });
  await writeFile(path.join(root, 'src', 'allowed.ts'), 'a');
  await writeFile(path.join(root, 'src', 'other.ts'), 'o');
  const stub = path.join(root, 'stub-agent.mjs');
  await writeFile(
    stub,
    [
      "import fs from 'node:fs';",
      "fs.writeFileSync('src/allowed.ts', 'changed by agent, longer');",
      "fs.writeFileSync('src/other.ts', 'changed by agent too, longer');",
      "fs.writeFileSync('node_modules/x/ignored.js', 'ignored');",
      "fs.writeFileSync('cwd.txt', process.cwd());",
    ].join('\n')
  );
  const result = await runAgentOnTask(root, 'claude', '.convert/tasks/001.md', ['src/allowed.ts'], {
    buildCommand: () => ({ command: process.execPath, args: [stub] }),
  });
  assert.equal(result.exitCode, 0);
  assert.ok(result.outside.includes('src/other.ts'), result.outside.join(','));
  assert.ok(!result.outside.includes('src/allowed.ts'));
  assert.ok(!result.outside.some((f) => f.startsWith('node_modules')));
  assert.equal((await readFileText(path.join(root, 'cwd.txt'), 'utf8')).toLowerCase(), root.toLowerCase());
});

async function loopProject(...tasks: TaskRecord[]) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'loop-'));
  const state = initState('/e', root);
  for (const t of tasks) state.tasks[t.id] = t;
  await saveState(state);
  return root;
}

const okAgent = async () => ({ exitCode: 0, outside: [] as string[] });

test('runAgentLoop mode one runs exactly one task', async () => {
  const root = await loopProject(task('001-component-A', 'component'), task('002-component-B', 'component'));
  const ran: string[] = [];
  const result = await runAgentLoop(root, 'agy', 'one', {
    runAgent: async (_r, _a, t) => (ran.push(t.id), { exitCode: 0, outside: [] }),
    verify: async (r, state, id) => {
      state.tasks[id].status = 'done';
      await saveState(state);
      return { passed: [id], failed: [] };
    },
  });
  assert.deepEqual(ran, ['001-component-A']);
  assert.equal(result.stoppedFor, 'single');
});

test('runAgentLoop mode all stops at needs-human after three failed verifications', async () => {
  const root = await loopProject(task('101-page-home', 'page', { route: '/' }));
  const result = await runAgentLoop(root, 'claude', 'all', {
    runAgent: okAgent,
    verify: async (r, state, id) => {
      recordAttempt(state, id, false);
      await saveState(state);
      return { passed: [], failed: [id] };
    },
  });
  assert.equal(result.stoppedFor, 'needs-human');
  assert.equal(result.ran.length, 3);
});

test('runAgentLoop mode all stops at motion tasks and finishes with done otherwise', async () => {
  const root = await loopProject(task('101-page-home', 'page'), task('201-motion-home', 'motion', { route: '/' }));
  const result = await runAgentLoop(root, 'agy', 'all', {
    runAgent: okAgent,
    verify: async (r, state, id) => {
      state.tasks[id].status = 'done';
      await saveState(state);
      return { passed: [id], failed: [] };
    },
  });
  assert.equal(result.stoppedFor, 'motion');
  assert.deepEqual(result.ran, ['101-page-home']);

  const root2 = await loopProject(task('101-page-home', 'page'));
  const done = await runAgentLoop(root2, 'agy', 'all', {
    runAgent: okAgent,
    verify: async (r, state, id) => {
      state.tasks[id].status = 'done';
      await saveState(state);
      return { passed: [id], failed: [] };
    },
  });
  assert.equal(done.stoppedFor, 'done');
});

test('runAgentLoop stops with failed-agent when the agent exits non-zero, and reports verify errors', async () => {
  const root = await loopProject(task('001-component-A', 'component'));
  const failed = await runAgentLoop(root, 'agy', 'all', {
    runAgent: async () => ({ exitCode: 2, outside: [] }),
    verify: async () => ({ passed: [], failed: [] }),
  });
  assert.equal(failed.stoppedFor, 'failed-agent');
  const verr = await runAgentLoop(root, 'agy', 'all', {
    runAgent: okAgent,
    verify: async () => {
      throw new Error('Dependencies not installed');
    },
  });
  assert.equal(verr.stoppedFor, 'verify-error');
});

test('runAgentLoop stops at the task limit', async () => {
  const root = await loopProject(
    task('001-component-A', 'component'),
    task('002-component-B', 'component'),
    task('003-component-C', 'component')
  );
  const result = await runAgentLoop(root, 'agy', 'all', {
    runAgent: okAgent,
    verify: async (r, state, id) => {
      state.tasks[id].status = 'done';
      await saveState(state);
      return { passed: [id], failed: [] };
    },
    maxTasks: 2,
  });
  assert.equal(result.stoppedFor, 'limit');
  assert.equal(result.ran.length, 2);
});

test('runAgentLoop stops at needs-human when the failing task is a fix task (real verify leaves the fix pending)', async () => {
  const root = await loopProject(task('101-page-home', 'page', { route: '/' }));
  const result = await runAgentLoop(root, 'claude', 'all', {
    runAgent: okAgent,
    // Mirrors stages/verify.ts: attempts are recorded on the original task and fix files stay pending.
    verify: async (r, state, id) => {
      const original = id.replace(/^fix-/, '').replace(/-\d+$/, '');
      const status = recordAttempt(state, original, false);
      if (status !== 'needs-human') {
        const n = state.tasks[original].attempts;
        state.tasks[`fix-${original}-${n}`] = task(`fix-${original}-${n}`, 'fix', { route: '/' });
      }
      await saveState(state);
      return { passed: [], failed: [original] };
    },
  });
  assert.equal(result.stoppedFor, 'needs-human');
  assert.equal(result.ran.length, 3);
});

test('runAgentLoop stops as stalled when verification leaves the same task unchanged', async () => {
  const root = await loopProject(task('001-component-A', 'component'));
  const result = await runAgentLoop(root, 'agy', 'all', {
    runAgent: okAgent,
    verify: async () => ({ passed: [], failed: [] }),
  });
  assert.equal(result.stoppedFor, 'stalled');
  assert.equal(result.ran.length, 2);
});

test('pickBinaryLine prefers a launchable file on Windows (.exe/.cmd/.bat) over a bare shim', () => {
  const out = 'C:\\nodejs\\claude\r\nC:\\nodejs\\claude.cmd\r\n';
  assert.equal(pickBinaryLine(out, 'win32'), 'C:\\nodejs\\claude.cmd');
  assert.equal(pickBinaryLine('/usr/bin/claude\n', 'linux'), '/usr/bin/claude');
  assert.equal(pickBinaryLine('', 'win32'), null);
});

test('runAgentLoop books the agent time on the task and reports start and end of each task', async () => {
  const root = await loopProject(task('101-page-home', 'page', { route: '/' }));
  const events: string[] = [];
  let clock = 1_000;
  await runAgentLoop(root, 'agy', 'one', {
    now: () => clock,
    runAgent: async () => {
      clock += 90_000;
      return { exitCode: 0, outside: [] };
    },
    verify: async (_r, state, id) => {
      state.tasks[id].status = 'done';
      await saveState(state);
      return { passed: [id], failed: [] };
    },
    onTaskStart: ({ task: t, state }) => events.push(`start ${t.id} ${state.timing?.byTask[t.id] ?? 0}`),
    onTaskEnd: ({ task: t, ms }) => events.push(`end ${t.id} ${ms}`),
  });
  assert.deepEqual(events, ['start 101-page-home 0', 'end 101-page-home 90000']);
  const { loadState } = await import('../../src/convert/state.js');
  assert.equal((await loadState(root))!.timing!.byTask['101-page-home'], 90_000);
});

test('runAgentLoop books the time of a fix task on the task it fixes', async () => {
  const root = await loopProject(
    task('101-page-home', 'page', { route: '/', status: 'in-progress' }),
    task('fix-101-page-home-1', 'fix', { route: '/' })
  );
  let clock = 0;
  await runAgentLoop(root, 'agy', 'one', {
    now: () => clock,
    runAgent: async () => {
      clock += 30_000;
      return { exitCode: 0, outside: [] };
    },
    verify: async (_r, state) => ({ passed: [], failed: [] }),
  });
  const { loadState } = await import('../../src/convert/state.js');
  assert.equal((await loadState(root))!.timing!.byTask['101-page-home'], 30_000);
});

test('runAgentOnTask with a log file keeps the agent output off the terminal and reports the last line', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-log-'));
  const stub = path.join(root, 'talker.mjs');
  await writeFile(stub, "console.log('first line'); console.log('second line');");
  const lines: string[] = [];
  const logFile = path.join(root, '.convert', 'logs', 'task.log');
  const result = await runAgentOnTask(root, 'claude', '.convert/tasks/001.md', [], {
    buildCommand: () => ({ command: process.execPath, args: [stub] }),
    logFile,
    onOutput: (l) => lines.push(l),
  });
  assert.equal(result.exitCode, 0);
  assert.match(await readFileText(logFile, 'utf8'), /first line\r?\nsecond line/);
  assert.equal(lines.at(-1), 'second line');
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
