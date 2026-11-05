import assert from 'node:assert/strict';
import test from 'node:test';
import { readyTasks } from '../../src/convert/runner/ready.js';
import { initState } from '../../src/convert/state.js';
import type { TaskRecord } from '../../src/convert/types.js';

function makeTask(overrides: Partial<TaskRecord> & { id: string; kind: TaskRecord['kind'] }): TaskRecord {
  return {
    file: `src/${overrides.id}.tsx`,
    status: 'pending',
    attempts: 0,
    targets: [`src/${overrides.id}.tsx`],
    ...overrides,
  };
}

test('readyTasks: returns empty array when tasks are empty', () => {
  const state = initState('/exp', '/next');
  assert.deepEqual(readyTasks(state, new Set()), []);
});

test('readyTasks: returns only pending tasks', () => {
  const state = initState('/exp', '/next');
  state.tasks['t-pending'] = makeTask({ id: 't-pending', kind: 'section', status: 'pending' });
  state.tasks['t-in-progress'] = makeTask({ id: 't-in-progress', kind: 'section', status: 'in-progress' });
  state.tasks['t-awaiting-fix'] = makeTask({ id: 't-awaiting-fix', kind: 'section', status: 'awaiting-fix' });
  state.tasks['t-done'] = makeTask({ id: 't-done', kind: 'section', status: 'done' });
  state.tasks['t-needs-review'] = makeTask({ id: 't-needs-review', kind: 'section', status: 'needs-review' });
  state.tasks['t-needs-human'] = makeTask({ id: 't-needs-human', kind: 'section', status: 'needs-human' });

  const ready = readyTasks(state, new Set());
  assert.deepEqual(ready.map((t) => t.id), ['t-pending']);
});

test('readyTasks: excludes tasks currently in running set', () => {
  const state = initState('/exp', '/next');
  state.tasks['t-1'] = makeTask({ id: 't-1', kind: 'section', status: 'pending' });
  state.tasks['t-2'] = makeTask({ id: 't-2', kind: 'section', status: 'pending' });

  const ready = readyTasks(state, new Set(['t-1']));
  assert.deepEqual(ready.map((t) => t.id), ['t-2']);
});

test('readyTasks: checks dependsOn satisfaction (done or needs-review only)', () => {
  const state = initState('/exp', '/next');
  state.tasks['dep-done'] = makeTask({ id: 'dep-done', kind: 'shell', status: 'done' });
  state.tasks['dep-review'] = makeTask({ id: 'dep-review', kind: 'shell', status: 'needs-review' });
  state.tasks['dep-pending'] = makeTask({ id: 'dep-pending', kind: 'shell', status: 'pending' });
  state.tasks['dep-progress'] = makeTask({ id: 'dep-progress', kind: 'shell', status: 'in-progress' });

  state.tasks['sec-ready'] = makeTask({
    id: 'sec-ready',
    kind: 'section',
    status: 'pending',
    dependsOn: ['dep-done', 'dep-review'],
  });
  state.tasks['sec-blocked-pending'] = makeTask({
    id: 'sec-blocked-pending',
    kind: 'section',
    status: 'pending',
    dependsOn: ['dep-done', 'dep-pending'],
  });
  state.tasks['sec-blocked-progress'] = makeTask({
    id: 'sec-blocked-progress',
    kind: 'section',
    status: 'pending',
    dependsOn: ['dep-progress'],
  });
  state.tasks['sec-blocked-missing'] = makeTask({
    id: 'sec-blocked-missing',
    kind: 'section',
    status: 'pending',
    dependsOn: ['non-existent'],
  });

  const ready = readyTasks(state, new Set());
  assert.deepEqual(ready.map((t) => t.id), ['dep-pending', 'sec-ready']);
});

test('readyTasks: ordering: fix tasks first, then shell, then section, then page, then id', () => {
  const state = initState('/exp', '/next');
  state.tasks['page-z'] = makeTask({ id: 'page-z', kind: 'page' });
  state.tasks['page-a'] = makeTask({ id: 'page-a', kind: 'page' });
  state.tasks['sec-b'] = makeTask({ id: 'sec-b', kind: 'section' });
  state.tasks['sec-a'] = makeTask({ id: 'sec-a', kind: 'section' });
  state.tasks['shell-footer'] = makeTask({ id: 'shell-footer', kind: 'shell' });
  state.tasks['shell-nav'] = makeTask({ id: 'shell-nav', kind: 'shell' });
  state.tasks['fix-sec-1'] = makeTask({ id: 'fix-sec-1', kind: 'fix' });

  const ready = readyTasks(state, new Set());
  assert.deepEqual(
    ready.map((t) => t.id),
    ['fix-sec-1', 'shell-footer', 'shell-nav', 'sec-a', 'sec-b', 'page-a', 'page-z']
  );
});

test('readyTasks: while any shell task is in running, no other shell task is ready', () => {
  const state = initState('/exp', '/next');
  state.tasks['shell-nav'] = makeTask({ id: 'shell-nav', kind: 'shell' });
  state.tasks['shell-footer'] = makeTask({ id: 'shell-footer', kind: 'shell' });
  state.tasks['sec-independent'] = makeTask({ id: 'sec-independent', kind: 'section' });

  // When shell-nav is running, shell-footer is NOT ready, but non-shell tasks can be ready
  const runningShell = new Set(['shell-nav']);
  const ready = readyTasks(state, runningShell);
  assert.deepEqual(ready.map((t) => t.id), ['sec-independent']);
});

test('readyTasks: while a non-shell task is in running, shell tasks can be ready', () => {
  const state = initState('/exp', '/next');
  state.tasks['shell-nav'] = makeTask({ id: 'shell-nav', kind: 'shell' });
  state.tasks['sec-running'] = makeTask({ id: 'sec-running', kind: 'section', status: 'in-progress' });

  const runningSec = new Set(['sec-running']);
  const ready = readyTasks(state, runningSec);
  assert.deepEqual(ready.map((t) => t.id), ['shell-nav']);
});
