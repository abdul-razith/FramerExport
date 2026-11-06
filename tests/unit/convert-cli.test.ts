import assert from 'node:assert/strict';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { existsSync } from 'node:fs';
import { pickNextTask } from '../../src/convert/pipeline.js';
import { initState } from '../../src/convert/state.js';
import { formatStatus, parseConvertArgs, runConvertCommand, runPipeline } from '../../src/convert/index.js';

const fixture = path.resolve('tests/fixtures/framer-nudge-mini');
const tmps: string[] = [];
after(async () => {
  for (const d of tmps) await rm(d, { recursive: true, force: true });
});
const io = () => ({ confirm: async () => true, log: () => {} });

test('parseConvertArgs handles every command and flag', () => {
  // convert <exportDir> [nextDir] [--yes] [--testing on|off] [--agent agy|claude] [--concurrency 1|2|3]
  assert.deepEqual(parseConvertArgs(['convert', './exp']), {
    command: 'convert',
    exportDir: './exp',
    nextDir: undefined,
    yes: false,
    testing: undefined,
    agent: undefined,
    concurrency: undefined,
    pageMode: undefined,
  });

  assert.deepEqual(parseConvertArgs(['convert', './exp', './out', '--yes', '--testing', 'off', '--agent', 'claude', '--concurrency', '2']), {
    command: 'convert',
    exportDir: './exp',
    nextDir: './out',
    yes: true,
    testing: false,
    agent: 'claude',
    concurrency: 2,
    pageMode: undefined,
  });

  assert.deepEqual(parseConvertArgs(['convert', './exp', '--testing', 'on', '--concurrency', '3']), {
    command: 'convert',
    exportDir: './exp',
    nextDir: undefined,
    yes: false,
    testing: true,
    agent: undefined,
    concurrency: 3,
    pageMode: undefined,
  });

  // status, next, ui
  assert.equal(parseConvertArgs(['convert', 'status']).command, 'status');
  assert.equal(parseConvertArgs(['convert', 'next']).command, 'next');
  assert.equal(parseConvertArgs(['convert', 'ui']).command, 'ui');

  // check <taskId> [--smoke]
  assert.deepEqual(parseConvertArgs(['convert', 'check', '101-page-home']), {
    command: 'check',
    taskId: '101-page-home',
    smoke: false,
    yes: false,
  });
  assert.deepEqual(parseConvertArgs(['convert', 'check', '101-page-home', '--smoke']), {
    command: 'check',
    taskId: '101-page-home',
    smoke: true,
    yes: false,
  });

  // run
  assert.deepEqual(parseConvertArgs(['convert', 'run']), {
    command: 'run',
    yes: false,
  });

  // report & verify (alias)
  assert.deepEqual(parseConvertArgs(['convert', 'report']), {
    command: 'report',
    target: undefined,
    yes: false,
  });
  assert.deepEqual(parseConvertArgs(['convert', 'verify', '/about']), {
    command: 'report',
    target: '/about',
    yes: false,
  });

  // review <taskId>
  assert.deepEqual(parseConvertArgs(['convert', 'review', '101-page-home']), {
    command: 'review',
    taskId: '101-page-home',
    yes: false,
  });
});

test('runPipeline refuses non-framer exports', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fexport wf '));
  tmps.push(dir);
  await writeFile(path.join(dir, 'export-report.json'), JSON.stringify({ platform: 'webflow' }));
  await assert.rejects(
    runPipeline(dir, dir + '-next', io()),
    /Only Framer exports are supported in this version \(found: webflow\)/
  );
});

test('runPipeline converts the fixture, then is a no-op', async () => {
  process.env.FEXPORT_CONVERT_NO_ANIMATIONS = '1';
  const base = await mkdtemp(path.join(os.tmpdir(), 'fexport pipe '));
  tmps.push(base);
  const nextDir = path.join(base, 'out next');
  const logs: string[] = [];
  const state = await runPipeline(fixture, nextDir, { confirm: async () => true, log: (m) => logs.push(m) });
  // Next steps: install (never automatic), the first task file, then its verify command.
  const text0 = logs.join('\n');
  const install = text0.indexOf(`cd "${nextDir}" && npm install`);
  const first = pickNextTask(state)!;
  const taskAt = text0.indexOf(path.join(nextDir, first.file));
  const verifyAt = text0.indexOf(`npx -p framer-export fexport convert verify ${first.id}`);
  assert.ok(install >= 0 && taskAt > install && verifyAt > taskAt, text0);
  assert.equal(existsSync(path.join(nextDir, 'node_modules')), false);
  assert.equal(state.stages.analyze, 'done');
  assert.equal(state.stages['extract-cms'], 'done');
  assert.equal(state.stages.scaffold, 'done');
  assert.equal(state.stages.tasks, 'done');
  const again = await runPipeline(fixture, nextDir, io());
  assert.deepEqual(again, state);
  const text = formatStatus(state);
  assert.match(text, /tasks\s+done/);
  for (const id of Object.keys(state.tasks)) assert.ok(text.includes(id), id);
});

test('runConvertCommand status outside a project returns 1', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fexport none '));
  tmps.push(dir);
  const prev = process.cwd();
  process.chdir(dir);
  try {
    assert.equal(await runConvertCommand(['convert', 'status']), 1);
  } finally {
    process.chdir(prev);
  }
});

test('unknown convert target prints usage and returns 1 without creating dirs', async () => {
  const lines: string[] = [];
  const sink = { log: (m: string) => lines.push(m), error: (m: string) => lines.push(m) };
  const name = 'bogus-not-a-dir';
  assert.equal(await runConvertCommand([name], sink), 1);
  const text = lines.join(' ');
  assert.match(text, /Export folder not found/);
  assert.match(text, /Usage:/);
  assert.equal(existsSync(path.resolve(name + '-next')), false);
});

test('convert --help returns 0', async () => {
  const lines: string[] = [];
  assert.equal(await runConvertCommand(['--help'], { log: (m) => lines.push(m), error: (m) => lines.push(m) }), 0);
  assert.match(lines.join(' '), /Usage:/);
});

test('pickNextTask prefers fix tasks', () => {
  const state = initState('/e', '/n');
  const mk = (id: string, kind: 'fix' | 'section') => ({ id, kind, file: id + '.md', status: 'pending' as const, attempts: 0, targets: [] });
  state.tasks = { '001-a': mk('001-a', 'section'), 'fix-002': mk('fix-002', 'fix') };
  assert.equal(pickNextTask(state)?.id, 'fix-002');
});

test('runConvertCommand review transitions needs-review to done', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fexport review '));
  tmps.push(dir);
  const state = initState('/e', dir);
  state.tasks['101-page-home'] = {
    id: '101-page-home',
    kind: 'page',
    file: '.convert/tasks/101-page-home.md',
    status: 'needs-review',
    attempts: 1,
    targets: [],
  };
  state.tasks['102-page-about'] = {
    id: '102-page-about',
    kind: 'page',
    file: '.convert/tasks/102-page-about.md',
    status: 'in-progress',
    attempts: 0,
    targets: [],
  };
  const { saveState } = await import('../../src/convert/state.js');
  await saveState(state);

  const prev = process.cwd();
  process.chdir(dir);
  try {
    const logs: string[] = [];
    const errors: string[] = [];
    const sink = { log: (m: string) => logs.push(m), error: (m: string) => errors.push(m) };

    // Review non-needs-review task
    const code1 = await runConvertCommand(['convert', 'review', '102-page-about'], sink);
    assert.equal(code1, 1);
    assert.match(errors.join(' '), /is in-progress, not needs-review/);

    // Review unknown task
    const code2 = await runConvertCommand(['convert', 'review', 'non-existent'], sink);
    assert.equal(code2, 1);
    assert.match(errors.join(' '), /Unknown task/);

    // Review valid needs-review task
    const code0 = await runConvertCommand(['convert', 'review', '101-page-home'], sink);
    assert.equal(code0, 0);
    assert.match(logs.join(' '), /Marked 101-page-home done/);

    const { loadState } = await import('../../src/convert/state.js');
    const updated = await loadState(dir);
    assert.equal(updated!.tasks['101-page-home']!.status, 'done');
  } finally {
    process.chdir(prev);
  }
});
