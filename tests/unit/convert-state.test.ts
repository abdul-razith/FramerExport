import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  STAGES,
  findProjectRoot,
  initState,
  loadState,
  nextStage,
  recordAttempt,
  saveState,
} from '../../src/convert/state.js';

async function tmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'convert state '));
}

function withTask(id = 't1') {
  const state = initState('/export', '/next');
  state.tasks[id] = {
    id,
    kind: 'component',
    file: 'a.tsx',
    status: 'pending',
    attempts: 0,
    targets: [],
  };
  return state;
}

test('initState sets all stages pending', () => {
  const state = initState('/export', '/next');
  assert.equal(state.version, 1);
  for (const stage of STAGES) assert.equal(state.stages[stage], 'pending');
});

test('saveState/loadState round-trip atomically in a dir with a space', async () => {
  const dir = await tmp();
  const state = initState('/export', dir);
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

test('recordAttempt escalates to needs-human after 3 failures', () => {
  const state = withTask();
  assert.equal(recordAttempt(state, 't1', false), 'in-progress');
  assert.equal(recordAttempt(state, 't1', false), 'in-progress');
  assert.equal(recordAttempt(state, 't1', false), 'needs-human');
  assert.equal(state.tasks.t1.attempts, 3);
  const other = withTask();
  assert.equal(recordAttempt(other, 't1', true), 'done');
  assert.equal(other.tasks.t1.status, 'done');
});
