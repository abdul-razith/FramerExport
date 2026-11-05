import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import {
  saveTaskSnapshot,
  recoverTask,
  recoverInterrupted,
} from '../../src/convert/runner/interrupt.js';
import { setInterruptHandler } from '../../src/convert/verify/proc.js';
import { initState } from '../../src/convert/state.js';
import type { TaskRecord } from '../../src/convert/types.js';

const tmps: string[] = [];

after(async () => {
  setInterruptHandler(null);
  for (const d of tmps) {
    await rm(d, { recursive: true, force: true }).catch(() => {});
  }
});

async function makeTmp(prefix = 'interrupt test '): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tmps.push(dir);
  return dir;
}

test('setInterruptHandler: intercepts SIGINT when set and restores on null', () => {
  let called = false;
  setInterruptHandler(() => {
    called = true;
  });

  process.emit('SIGINT');
  assert.equal(called, true, 'custom interrupt handler was called on SIGINT');

  // Clear handler
  setInterruptHandler(null);
});

test('saveTaskSnapshot: copies existing targets and records absent ones in manifest', async () => {
  const root = await makeTmp();
  const heroFile = path.join(root, 'src', 'sections', 'Hero.tsx');
  await mkdir(path.dirname(heroFile), { recursive: true });
  await writeFile(heroFile, 'export function Hero() { return <h1>Original</h1>; }\n');

  const task: TaskRecord = {
    id: 'section-hero',
    kind: 'section',
    file: 'src/sections/Hero.tsx',
    targets: ['src/sections/Hero.tsx', 'src/sections/Hero/', 'src/sections/Absent.tsx'],
    status: 'in-progress',
    attempts: 1,
  };

  await saveTaskSnapshot(root, task);

  const snapHero = path.join(root, '.convert', 'snapshots', task.id, 'files', 'src', 'sections', 'Hero.tsx');
  const snapHeroContent = await readFile(snapHero, 'utf8');
  assert.equal(snapHeroContent, 'export function Hero() { return <h1>Original</h1>; }\n');

  const manifestPath = path.join(root, '.convert', 'snapshots', task.id, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(manifest.taskId, task.id);
  assert.ok(manifest.present.includes('src/sections/Hero.tsx'));
  assert.ok(manifest.absent.includes('src/sections/Absent.tsx'));
});

test('recoverTask: restores content, deletes new file, saves partial copy, attempts unchanged, status pending', async () => {
  const root = await makeTmp();
  const heroFile = path.join(root, 'src', 'sections', 'Hero.tsx');
  await mkdir(path.dirname(heroFile), { recursive: true });
  await writeFile(heroFile, 'export function Hero() { return <h1>Original</h1>; }\n');

  const task: TaskRecord = {
    id: 'section-hero',
    kind: 'section',
    file: 'src/sections/Hero.tsx',
    targets: ['src/sections/Hero.tsx', 'src/sections/Hero/'],
    status: 'in-progress',
    attempts: 2,
  };

  // 1. Take snapshot before agent runs
  await saveTaskSnapshot(root, task);

  // 2. Agent edits existing target file and adds a new file inside target dir
  await writeFile(heroFile, 'export function Hero() { return <h1>Modified By Agent</h1>; }\n');
  const buttonFile = path.join(root, 'src', 'sections', 'Hero', 'Button.tsx');
  await mkdir(path.dirname(buttonFile), { recursive: true });
  await writeFile(buttonFile, 'export function Button() {}\n');

  // 3. Recover interrupted task with fixed date
  const testDate = new Date('2026-11-05T14:30:45.000Z');
  const partialDir = await recoverTask(root, task, testDate);

  // Partial directory path matches .convert/partial/<id>/<YYYYMMDD-HHmmss>
  const expectedStamp = '20261105-143045';
  assert.ok(partialDir.endsWith(path.join(task.id, expectedStamp)), `Expected partialDir to end with ${task.id}/${expectedStamp}, got: ${partialDir}`);

  // Partial directory contains the modified target and the new button file
  const partialHero = await readFile(path.join(partialDir, 'src', 'sections', 'Hero.tsx'), 'utf8');
  assert.equal(partialHero, 'export function Hero() { return <h1>Modified By Agent</h1>; }\n');
  const partialButton = await readFile(path.join(partialDir, 'src', 'sections', 'Hero', 'Button.tsx'), 'utf8');
  assert.equal(partialButton, 'export function Button() {}\n');

  // In workspace: target file restored to original, new file deleted
  const restoredHero = await readFile(heroFile, 'utf8');
  assert.equal(restoredHero, 'export function Hero() { return <h1>Original</h1>; }\n');

  let buttonExists = true;
  try {
    await readFile(buttonFile);
  } catch (err: any) {
    if (err.code === 'ENOENT') buttonExists = false;
  }
  assert.equal(buttonExists, false, 'New file in target dir must be deleted on recoverTask');

  // Task attempts must be unchanged and status must be pending
  assert.equal(task.attempts, 2, 'task.attempts should be untouched');
  assert.equal(task.status, 'pending', 'task.status should be reset to pending');
});

test('recoverTask: deletes file that was absent when snapshot was taken', async () => {
  const root = await makeTmp();
  const absentFile = path.join(root, 'src', 'sections', 'NewSection.tsx');

  const task: TaskRecord = {
    id: 'section-new',
    kind: 'section',
    file: 'src/sections/NewSection.tsx',
    targets: ['src/sections/NewSection.tsx'],
    status: 'in-progress',
    attempts: 0,
  };

  // Snapshot taken while NewSection.tsx does not exist
  await saveTaskSnapshot(root, task);

  // Agent creates NewSection.tsx during run
  await mkdir(path.dirname(absentFile), { recursive: true });
  await writeFile(absentFile, 'export function NewSection() {}\n');

  const partialDir = await recoverTask(root, task);

  // File is saved in partial
  const savedPartial = await readFile(path.join(partialDir, 'src', 'sections', 'NewSection.tsx'), 'utf8');
  assert.equal(savedPartial, 'export function NewSection() {}\n');

  // File is deleted in workspace because it was absent at snapshot time
  let exists = true;
  try {
    await readFile(absentFile);
  } catch (err: any) {
    if (err.code === 'ENOENT') exists = false;
  }
  assert.equal(exists, false, 'File absent at snapshot time must be deleted on recovery');
  assert.equal(task.status, 'pending');
  assert.equal(task.attempts, 0);
});

test('recoverInterrupted: restores in-progress tasks, leaves done tasks untouched even if hand-edited (Review Focus 3)', async () => {
  const root = await makeTmp();
  const heroFile = path.join(root, 'src', 'sections', 'Hero.tsx');
  const footerFile = path.join(root, 'src', 'sections', 'Footer.tsx');
  const aboutFile = path.join(root, 'src', 'sections', 'About.tsx');

  await mkdir(path.dirname(heroFile), { recursive: true });
  await writeFile(heroFile, 'export function Hero() { return <h1>Original Hero</h1>; }\n');
  await writeFile(footerFile, 'export function Footer() { return <footer>Original Footer</footer>; }\n');
  await writeFile(aboutFile, 'export function About() { return <div>Original About</div>; }\n');

  const state = initState(root, root);
  state.tasks = {
    'task-in-progress': {
      id: 'task-in-progress',
      kind: 'section',
      file: 'src/sections/Hero.tsx',
      targets: ['src/sections/Hero.tsx', 'src/sections/Hero/'],
      status: 'in-progress',
      attempts: 1,
    },
    'task-done': {
      id: 'task-done',
      kind: 'section',
      file: 'src/sections/Footer.tsx',
      targets: ['src/sections/Footer.tsx'],
      status: 'done',
      attempts: 1,
    },
    'task-pending': {
      id: 'task-pending',
      kind: 'section',
      file: 'src/sections/About.tsx',
      targets: ['src/sections/About.tsx'],
      status: 'pending',
      attempts: 0,
    },
  };

  // Snapshot the in-progress task before run
  await saveTaskSnapshot(root, state.tasks['task-in-progress']);

  // Simulate work done / hand edits while paused:
  // 1. in-progress task was edited
  await writeFile(heroFile, 'export function Hero() { return <h1>Modified In-Progress</h1>; }\n');
  // 2. User edits a finished ('done') task by hand while the run is paused
  const userHandEdit = 'export function Footer() { return <footer>Custom Hand Edited Footer</footer>; }\n';
  await writeFile(footerFile, userHandEdit);
  // 3. User edits a pending task
  await writeFile(aboutFile, 'export function About() { return <div>Pending Touch</div>; }\n');

  // Run recoverInterrupted
  const recoveredIds = await recoverInterrupted(root, state);

  // Only in-progress tasks should be returned and restored
  assert.deepEqual(recoveredIds, ['task-in-progress']);
  assert.equal(state.tasks['task-in-progress'].status, 'pending');
  assert.equal(state.tasks['task-in-progress'].attempts, 1);

  // in-progress task is restored to original
  const heroContent = await readFile(heroFile, 'utf8');
  assert.equal(heroContent, 'export function Hero() { return <h1>Original Hero</h1>; }\n');

  // done task hand edit MUST NOT be touched
  const footerContent = await readFile(footerFile, 'utf8');
  assert.equal(footerContent, userHandEdit, 'Finished section edited by hand must NEVER be touched by recoverInterrupted');
  assert.equal(state.tasks['task-done'].status, 'done', 'Done task status must remain done');

  // pending task must also not be touched by recovery
  const aboutContent = await readFile(aboutFile, 'utf8');
  assert.equal(aboutContent, 'export function About() { return <div>Pending Touch</div>; }\n');
  assert.equal(state.tasks['task-pending'].status, 'pending');
});
