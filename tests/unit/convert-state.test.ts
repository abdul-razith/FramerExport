import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DEFAULT_OPTIONS,
  STAGES,
  findProjectRoot,
  initState,
  loadState,
  nextStage,
  saveState,
} from '../../src/convert/state.js';

async function tmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'convert state '));
}

function withTask(id = 't1') {
  const state = initState('/export', '/next');
  state.tasks[id] = {
    id,
    kind: 'section',
    file: 'a.tsx',
    status: 'pending',
    attempts: 0,
    targets: [],
  };
  return state;
}

test('DEFAULT_OPTIONS', () => {
  assert.deepEqual(DEFAULT_OPTIONS, {
    testing: true,
    concurrency: 1,
    pageMode: 'pause',
    sectionTimeoutMin: 15,
    pageTimeoutMin: 15,
    pixelTolerance: 0.01,
    reportTolerance: 0.03,
  });
});

test('initState sets all stages pending', () => {
  const state = initState('/export', '/next');
  assert.equal(state.version, 2);
  for (const stage of STAGES) assert.equal(state.stages[stage], 'pending');
  assert.equal(state.options, null);
  assert.deepEqual(state.run, { status: 'idle' });
});

test('saveState stores exportDir relative to the project and no nextDir', async () => {
  const root = await tmp();
  const next = path.join(root, 'site next');
  const exp = path.join(root, 'site');
  await fs.mkdir(exp, { recursive: true });
  await saveState(initState(exp, next));
  const raw = JSON.parse(await fs.readFile(path.join(next, '.convert', 'state.json'), 'utf8'));
  assert.equal(raw.version, 2);
  assert.equal(raw.exportDir, '../site');
  assert.equal('nextDir' in raw, false);
  const back = await loadState(next);
  assert.equal(back!.exportDir, exp);
  assert.equal(back!.nextDir, next);
  assert.deepEqual(back!.run, { status: 'idle' });
  assert.equal(back!.options, null);
});

test('saveState/loadState round-trip atomically in a dir with a space', async () => {
  const dir = await tmp();
  const exportDir = path.join(dir, 'export');
  await fs.mkdir(exportDir, { recursive: true });
  const state = initState(exportDir, dir);
  state.warnings.push('w');
  await saveState(state);
  assert.deepEqual(await loadState(dir), state);
  const files = await fs.readdir(path.join(dir, '.convert'));
  assert.deepEqual(files, ['state.json']);
});

test('loadState returns null without state', async () => {
  assert.equal(await loadState(await tmp()), null);
});

test('findProjectRoot walks up', async () => {
  const root = await tmp();
  await saveState(initState('/export', root));
  const deep = path.join(root, 'src', 'app');
  await fs.mkdir(deep, { recursive: true });
  assert.equal(await findProjectRoot(deep), root);
  assert.equal(await findProjectRoot(await tmp()), null);
});

test('nextStage', () => {
  const state = initState('/e', '/n');
  assert.equal(nextStage(state), 'analyze');
  state.stages.analyze = 'done';
  assert.equal(nextStage(state), 'extract-cms');
  for (const s of STAGES) state.stages[s] = 'done';
  assert.equal(nextStage(state), null);
});

test('nextStage treats skipped as finished', () => {
  const state = initState('/e', '/n');
  for (const s of STAGES) state.stages[s] = 'done';
  state.stages.baseline = 'skipped';
  state.stages.finalize = 'pending';
  assert.equal(nextStage(state), 'finalize');
});

