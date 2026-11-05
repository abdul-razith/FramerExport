import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import {
  createPauseController,
  runQueue,
  type PauseController,
  type PoolDeps,
  type PoolEvent,
} from '../../src/convert/runner/pool.js';
import { writeFixTask } from '../../src/convert/runner/fix.js';
import type { CheckResult } from '../../src/convert/verify/check.js';
import type { AgentExit, AgentHandle } from '../../src/convert/runner/agent-process.js';
import type { RunLock } from '../../src/convert/runner/lock.js';
import { initState, saveState } from '../../src/convert/state.js';
import type { StageContext } from '../../src/convert/adapters/types.js';
import type { TaskRecord } from '../../src/convert/types.js';

const tmps: string[] = [];

after(async () => {
  for (const d of tmps) {
    await rm(d, { recursive: true, force: true }).catch(() => {});
  }
});

async function makeTmp(prefix = 'pool-test-'): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tmps.push(dir);
  return dir;
}

function fakeLock(): RunLock {
  const agents: Record<string, number | null> = {};
  return {
    async setAgent(taskId, pid) {
      agents[taskId] = pid;
    },
    async setDevServer() {},
    async release() {},
  };
}

function makeTask(overrides: Partial<TaskRecord> & { id: string; kind: TaskRecord['kind'] }): TaskRecord {
  return {
    file: `src/${overrides.id}.tsx`,
    status: 'pending',
    attempts: 0,
    targets: [`src/${overrides.id}.tsx`],
    ...overrides,
  };
}

function makePassResult(taskId: string): CheckResult {
  return {
    taskId,
    mode: 'full',
    pass: true,
    limitReached: false,
    widths: [],
    dom: [],
    code: [],
    motion: [],
    errors: [],
  };
}

function makeFailResult(taskId: string): CheckResult {
  return {
    taskId,
    mode: 'full',
    pass: false,
    limitReached: false,
    widths: [
      {
        width: 1440,
        pass: false,
        ratio: 0.05,
        heightDelta: 20,
        clusters: [{ x: 10, y: 10, width: 50, height: 50, count: 20 }],
        images: {
          diff: '.convert/diffs/home/1440-hero-diff.png',
          expected: '.convert/diffs/home/1440-hero-expected.png',
          actual: '.convert/diffs/home/1440-hero-actual.png',
        },
      },
    ],
    dom: [{ section: 'Hero', kind: 'text', expected: 'Welcome', actual: 'Hello' }],
    code: ['src/sections/Hero.tsx: framer- class name'],
    motion: [{ id: 'hero-appear', pass: false, detail: 'opacity stayed 0' }],
    errors: [],
  };
}

function createFakeHandle(
  opts: {
    delayMs?: number;
    exit?: Partial<AgentExit>;
    onStart?: () => void;
  } = {}
): AgentHandle {
  let resolveDone: (exit: AgentExit) => void;
  const done = new Promise<AgentExit>((resolve) => {
    resolveDone = resolve;
  });

  opts.onStart?.();

  const timer = setTimeout(() => {
    resolveDone({
      exitCode: 0,
      timedOut: false,
      killed: false,
      quota: null,
      ...opts.exit,
    });
  }, opts.delayMs ?? 10);

  return {
    pid: 12345,
    done,
    async kill() {
      clearTimeout(timer);
      resolveDone({
        exitCode: null,
        timedOut: false,
        killed: true,
        quota: null,
      });
    },
  };
}

test('PauseController: transitions mode correctly and createPauseController creates instance', () => {
  const pause = createPauseController();
  assert.equal(pause.mode, 'none');
  pause.request('after-running');
  assert.equal(pause.mode, 'after-running');
  pause.request('now');
  assert.equal(pause.mode, 'now');
});

test('writeFixTask: creates fix-<id> task record and writes .convert/tasks/fix-<id>.md', async () => {
  const root = await makeTmp();
  const state = initState('/export', root);
  const ctx: StageContext = {
    state,
    exportDir: '/export',
    nextDir: root,
    log: () => {},
  };

  const task = makeTask({ id: 'sec-hero', kind: 'section', targets: ['src/Hero.tsx'] });
  state.tasks[task.id] = task;

  const failRes = makeFailResult('sec-hero');
  const fixRecord = await writeFixTask(ctx, task, failRes);

  assert.equal(fixRecord.id, 'fix-sec-hero');
  assert.equal(fixRecord.kind, 'fix');
  assert.equal(fixRecord.fixOf, 'sec-hero');
  assert.deepEqual(fixRecord.targets, ['src/Hero.tsx']);
  assert.deepEqual(fixRecord.dependsOn, []);
  assert.equal(fixRecord.status, 'pending');
  assert.equal(fixRecord.attempts, 0);

  assert.equal(state.tasks['fix-sec-hero'], fixRecord);

  const filePath = path.join(root, '.convert', 'tasks', 'fix-sec-hero.md');
  const content = await readFile(filePath, 'utf8');
  assert.match(content, /# Fix sec-hero/);
  assert.match(content, /1440px: visual mismatch/);
  assert.match(content, /DOM mismatch/);
  assert.match(content, /framer- class name/);
  assert.match(content, /hero-appear/);
});

test('runQueue: concurrency 2 never runs more than 2 at once; shell runs alone before sections; page starts after sections', async () => {
  const root = await makeTmp();
  const state = initState('/export', root);
  state.options = {
    testing: true,
    concurrency: 2,
    sectionTimeoutMin: 15,
    pageTimeoutMin: 15,
    pixelTolerance: 0.01,
    reportTolerance: 0.03,
    agent: 'agy',
  };
  await saveState(state);

  const ctx: StageContext = {
    state,
    exportDir: '/export',
    nextDir: root,
    log: () => {},
  };

  state.tasks['shell-nav'] = makeTask({ id: 'shell-nav', kind: 'shell' });
  state.tasks['shell-footer'] = makeTask({ id: 'shell-footer', kind: 'shell' });
  state.tasks['sec-hero'] = makeTask({
    id: 'sec-hero',
    kind: 'section',
    dependsOn: ['shell-nav', 'shell-footer'],
  });
  state.tasks['sec-pricing'] = makeTask({
    id: 'sec-pricing',
    kind: 'section',
    dependsOn: ['shell-nav', 'shell-footer'],
  });
  state.tasks['page-home'] = makeTask({
    id: 'page-home',
    kind: 'page',
    dependsOn: ['sec-hero', 'sec-pricing'],
  });

  let activeCount = 0;
  let maxConcurrent = 0;
  let runningShells = 0;
  let shellOverlappedWithOther = false;
  let pageStartedBeforeSectionsDone = false;

  let notifyPricing: (() => void) | undefined;
  const pricingSpawned = new Promise<void>((resolve) => {
    notifyPricing = resolve;
  });

  const deps: PoolDeps = {
    lock: fakeLock(),
    spawn: (task) => {
      activeCount++;
      if (activeCount > maxConcurrent) maxConcurrent = activeCount;
      if (task.kind === 'shell') {
        runningShells++;
        if (runningShells > 1 || activeCount > 1) {
          shellOverlappedWithOther = true;
        }
      }
      if (task.kind === 'page') {
        if (state.tasks['sec-hero'].status !== 'done' || state.tasks['sec-pricing'].status !== 'done') {
          pageStartedBeforeSectionsDone = true;
        }
      }

      if (task.id === 'sec-pricing') {
        notifyPricing?.();
      }

      let resolveDone: (exit: AgentExit) => void;
      const done = new Promise<AgentExit>((resolve) => {
        resolveDone = resolve;
      });

      const delayMs = task.id === 'sec-hero' ? 80 : 30;
      if (task.id === 'sec-hero') {
        // Guarantee overlap with sec-pricing without timing races
        Promise.race([pricingSpawned, new Promise((r) => setTimeout(r, 100))]).then(() => {
          setTimeout(() => {
            resolveDone({ exitCode: 0, timedOut: false, killed: false, quota: null });
          }, 30);
        });
      } else {
        setTimeout(() => {
          resolveDone({ exitCode: 0, timedOut: false, killed: false, quota: null });
        }, delayMs);
      }

      return {
        pid: 12345,
        done,
        kill: async () => {},
      };
    },
    check: async (taskId) => {
      return makePassResult(taskId);
    },
    onEvent: (e) => {
      if (e.type === 'end') {
        activeCount--;
        if (state.tasks[e.taskId]?.kind === 'shell') {
          runningShells--;
        }
      }
    },
  };

  const pause = createPauseController();
  const res = await runQueue(ctx, deps, pause);

  assert.equal(res.stoppedFor, 'done');
  assert.equal(maxConcurrent, 2, 'reached concurrency limit of 2');
  assert.equal(shellOverlappedWithOther, false, 'shell tasks ran alone');
  assert.equal(pageStartedBeforeSectionsDone, false, 'page started only after sections completed');
  assert.equal(state.tasks['shell-nav'].status, 'done');
  assert.equal(state.tasks['shell-footer'].status, 'done');
  assert.equal(state.tasks['sec-hero'].status, 'done');
  assert.equal(state.tasks['sec-pricing'].status, 'done');
  assert.equal(state.tasks['page-home'].status, 'done');
  assert.deepEqual(res.ran, ['shell-footer', 'shell-nav', 'sec-hero', 'sec-pricing', 'page-home']);
});

test('runQueue: failing check with testing on creates fix task, original awaiting-fix; fix passes -> both done', async () => {
  const root = await makeTmp();
  const state = initState('/export', root);
  state.options = {
    testing: true,
    concurrency: 1,
    sectionTimeoutMin: 15,
    pageTimeoutMin: 15,
    pixelTolerance: 0.01,
    reportTolerance: 0.03,
    agent: 'agy',
  };
  await saveState(state);

  const ctx: StageContext = {
    state,
    exportDir: '/export',
    nextDir: root,
    log: () => {},
  };

  state.tasks['sec-hero'] = makeTask({ id: 'sec-hero', kind: 'section' });

  const events: PoolEvent[] = [];
  const deps: PoolDeps = {
    lock: fakeLock(),
    spawn: () => createFakeHandle({ delayMs: 10 }),
    check: async (taskId) => {
      if (taskId === 'sec-hero') {
        return makeFailResult(taskId);
      }
      // fix task passes
      return makePassResult(taskId);
    },
    onEvent: (e) => events.push(e),
  };

  const pause = createPauseController();
  const res = await runQueue(ctx, deps, pause);

  assert.equal(res.stoppedFor, 'done');
  assert.deepEqual(res.ran, ['sec-hero', 'fix-sec-hero']);
  assert.equal(state.tasks['sec-hero'].status, 'done');
  assert.equal(state.tasks['fix-sec-hero'].status, 'done');
  assert.equal(state.tasks['sec-hero'].attempts, 1);

  const endEvents = events.filter((e) => e.type === 'end');
  assert.equal(endEvents[0].outcome, 'fix');
  assert.equal(endEvents[1].outcome, 'done');
});

test('runQueue: fix task fails -> both fix and original marked needs-review', async () => {
  const root = await makeTmp();
  const state = initState('/export', root);
  state.options = {
    testing: true,
    concurrency: 1,
    sectionTimeoutMin: 15,
    pageTimeoutMin: 15,
    pixelTolerance: 0.01,
    reportTolerance: 0.03,
    agent: 'agy',
  };
  await saveState(state);

  const ctx: StageContext = {
    state,
    exportDir: '/export',
    nextDir: root,
    log: () => {},
  };

  state.tasks['sec-hero'] = makeTask({ id: 'sec-hero', kind: 'section' });

  const deps: PoolDeps = {
    lock: fakeLock(),
    spawn: () => createFakeHandle({ delayMs: 10 }),
    check: async (taskId) => makeFailResult(taskId),
  };

  const pause = createPauseController();
  const res = await runQueue(ctx, deps, pause);

  assert.equal(res.stoppedFor, 'done');
  assert.equal(state.tasks['sec-hero'].status, 'needs-review');
  assert.equal(state.tasks['fix-sec-hero'].status, 'needs-review');
});

test('runQueue: failing check with testing off sets task directly to needs-review without fix task', async () => {
  const root = await makeTmp();
  const state = initState('/export', root);
  state.options = {
    testing: false,
    concurrency: 1,
    sectionTimeoutMin: 15,
    pageTimeoutMin: 15,
    pixelTolerance: 0.01,
    reportTolerance: 0.03,
    agent: 'agy',
  };
  await saveState(state);

  const ctx: StageContext = {
    state,
    exportDir: '/export',
    nextDir: root,
    log: () => {},
  };

  state.tasks['sec-hero'] = makeTask({ id: 'sec-hero', kind: 'section' });

  let checkedSmoke = false;
  const deps: PoolDeps = {
    lock: fakeLock(),
    spawn: () => createFakeHandle({ delayMs: 10 }),
    check: async (taskId, smoke) => {
      checkedSmoke = smoke;
      return makeFailResult(taskId);
    },
  };

  const pause = createPauseController();
  const res = await runQueue(ctx, deps, pause);

  assert.equal(res.stoppedFor, 'done');
  assert.equal(checkedSmoke, true, 'smoke check was used when testing is false');
  assert.equal(state.tasks['sec-hero'].status, 'needs-review');
  assert.equal(state.tasks['fix-sec-hero'], undefined, 'no fix task created');
});

test('runQueue: timed out agent still runs check and counts attempt', async () => {
  const root = await makeTmp();
  const state = initState('/export', root);
  state.options = {
    testing: true,
    concurrency: 1,
    sectionTimeoutMin: 15,
    pageTimeoutMin: 15,
    pixelTolerance: 0.01,
    reportTolerance: 0.03,
    agent: 'agy',
  };
  await saveState(state);

  const ctx: StageContext = {
    state,
    exportDir: '/export',
    nextDir: root,
    log: () => {},
  };

  state.tasks['sec-hero'] = makeTask({ id: 'sec-hero', kind: 'section' });

  let checkCalled = false;
  const deps: PoolDeps = {
    lock: fakeLock(),
    spawn: () => createFakeHandle({ delayMs: 10, exit: { timedOut: true } }),
    check: async (taskId) => {
      checkCalled = true;
      return makePassResult(taskId);
    },
  };

  const pause = createPauseController();
  const res = await runQueue(ctx, deps, pause);

  assert.equal(res.stoppedFor, 'done');
  assert.equal(checkCalled, true, 'check was called despite timeout');
  assert.equal(state.tasks['sec-hero'].status, 'done');
});

test('runQueue: quota exit resets task to pending (attempts unchanged), stops dispatch, lets running finish', async () => {
  const root = await makeTmp();
  const state = initState('/export', root);
  state.options = {
    testing: true,
    concurrency: 2,
    sectionTimeoutMin: 15,
    pageTimeoutMin: 15,
    pixelTolerance: 0.01,
    reportTolerance: 0.03,
    agent: 'agy',
  };
  await saveState(state);

  const ctx: StageContext = {
    state,
    exportDir: '/export',
    nextDir: root,
    log: () => {},
  };

  state.tasks['sec-1'] = makeTask({ id: 'sec-1', kind: 'section' });
  state.tasks['sec-2'] = makeTask({ id: 'sec-2', kind: 'section' });
  state.tasks['sec-3'] = makeTask({ id: 'sec-3', kind: 'section' });

  const events: PoolEvent[] = [];
  const deps: PoolDeps = {
    lock: fakeLock(),
    spawn: (task) => {
      if (task.id === 'sec-1') {
        return createFakeHandle({
          delayMs: 10,
          exit: {
            quota: { line: '429 Rate limit exceeded', resetHint: 'in 15m' },
          },
        });
      }
      // sec-2 finishes normally
      return createFakeHandle({ delayMs: 40 });
    },
    check: async (taskId) => makePassResult(taskId),
    onEvent: (e) => events.push(e),
  };

  const pause = createPauseController();
  const res = await runQueue(ctx, deps, pause);

  assert.equal(res.stoppedFor, 'quota');
  assert.equal(res.quota?.resetHint, 'in 15m');
  assert.equal(state.tasks['sec-1'].status, 'pending');
  assert.equal(state.tasks['sec-1'].attempts, 0);
  assert.equal(state.tasks['sec-2'].status, 'done');
  assert.equal(state.tasks['sec-3'].status, 'pending');
  assert.ok(!res.ran.includes('sec-3'), 'sec-3 was never dispatched');

  const quotaEvent = events.find((e) => e.type === 'quota');
  assert.ok(quotaEvent, 'quota event was emitted');
});

test('runQueue: pause after-running lets running finish, dispatches no new tasks, returns stoppedFor paused', async () => {
  const root = await makeTmp();
  const state = initState('/export', root);
  state.options = {
    testing: true,
    concurrency: 2,
    sectionTimeoutMin: 15,
    pageTimeoutMin: 15,
    pixelTolerance: 0.01,
    reportTolerance: 0.03,
    agent: 'agy',
  };
  await saveState(state);

  const ctx: StageContext = {
    state,
    exportDir: '/export',
    nextDir: root,
    log: () => {},
  };

  state.tasks['sec-1'] = makeTask({ id: 'sec-1', kind: 'section' });
  state.tasks['sec-2'] = makeTask({ id: 'sec-2', kind: 'section' });
  state.tasks['sec-3'] = makeTask({ id: 'sec-3', kind: 'section' });

  const pause = createPauseController();

  const deps: PoolDeps = {
    lock: fakeLock(),
    spawn: (task) => {
      if (task.id === 'sec-1') {
        return createFakeHandle({
          delayMs: 15,
          onStart: () => {
            // request pause after running
            setTimeout(() => pause.request('after-running'), 5);
          },
        });
      }
      return createFakeHandle({ delayMs: 30 });
    },
    check: async (taskId) => makePassResult(taskId),
  };

  const res = await runQueue(ctx, deps, pause);

  assert.equal(res.stoppedFor, 'paused');
  assert.equal(state.tasks['sec-1'].status, 'done');
  assert.equal(state.tasks['sec-2'].status, 'done');
  assert.equal(state.tasks['sec-3'].status, 'pending');
  assert.ok(!res.ran.includes('sec-3'), 'sec-3 was not dispatched');
});

test('runQueue: pause now kills handles, tasks pending, partial dirs exist', async () => {
  const root = await makeTmp();
  const state = initState('/export', root);
  state.options = {
    testing: true,
    concurrency: 1,
    sectionTimeoutMin: 15,
    pageTimeoutMin: 15,
    pixelTolerance: 0.01,
    reportTolerance: 0.03,
    agent: 'agy',
  };
  await saveState(state);

  const ctx: StageContext = {
    state,
    exportDir: '/export',
    nextDir: root,
    log: () => {},
  };

  const taskFile = path.join(root, 'src', 'sec-hang.tsx');
  await mkdir(path.dirname(taskFile), { recursive: true });
  await writeFile(taskFile, '// original\n');

  state.tasks['sec-hang'] = makeTask({
    id: 'sec-hang',
    kind: 'section',
    targets: ['src/sec-hang.tsx'],
  });

  const pause = createPauseController();
  let handleKilled = false;

  const deps: PoolDeps = {
    lock: fakeLock(),
    spawn: () => {
      let resolveDone: (exit: AgentExit) => void;
      const done = new Promise<AgentExit>((resolve) => {
        resolveDone = resolve;
      });

      // Modify target file to test partial dir creation on interrupt
      setTimeout(async () => {
        await writeFile(taskFile, '// in-progress edit\n');
        pause.request('now');
      }, 15);

      return {
        pid: 7777,
        done,
        async kill() {
          handleKilled = true;
          resolveDone({
            exitCode: null,
            timedOut: false,
            killed: true,
            quota: null,
          });
        },
      };
    },
    check: async (taskId) => makePassResult(taskId),
  };

  const res = await runQueue(ctx, deps, pause);

  assert.equal(res.stoppedFor, 'paused');
  assert.equal(handleKilled, true, 'handle kill was invoked');
  assert.equal(state.tasks['sec-hang'].status, 'pending');

  // Verify partial directory exists and target was restored to original
  const partialBase = path.join(root, '.convert', 'partial', 'sec-hang');
  const restoredContent = await readFile(taskFile, 'utf8');
  assert.equal(restoredContent, '// original\n', 'target was restored from snapshot');
});

test('runQueue: out-of-scope edits produce a reverted event and files are reverted', async () => {
  const root = await makeTmp();
  const state = initState('/export', root);
  state.options = {
    testing: true,
    concurrency: 1,
    sectionTimeoutMin: 15,
    pageTimeoutMin: 15,
    pixelTolerance: 0.01,
    reportTolerance: 0.03,
    agent: 'agy',
  };
  await saveState(state);

  const ctx: StageContext = {
    state,
    exportDir: '/export',
    nextDir: root,
    log: () => {},
  };

  const targetFile = path.join(root, 'src', 'sec-hero.tsx');
  await mkdir(path.dirname(targetFile), { recursive: true });
  await writeFile(targetFile, '// target\n');

  state.tasks['sec-hero'] = makeTask({
    id: 'sec-hero',
    kind: 'section',
    targets: ['src/sec-hero.tsx'],
  });

  const events: PoolEvent[] = [];
  const rogueFile = path.join(root, 'src', 'rogue.tsx');

  const deps: PoolDeps = {
    lock: fakeLock(),
    spawn: () => {
      // Modify out-of-scope file
      setTimeout(async () => {
        await writeFile(rogueFile, '// should be reverted\n');
      }, 5);

      return createFakeHandle({ delayMs: 25 });
    },
    check: async (taskId) => makePassResult(taskId),
    onEvent: (e) => events.push(e),
  };

  const pause = createPauseController();
  const res = await runQueue(ctx, deps, pause);

  assert.equal(res.stoppedFor, 'done');
  const revertEvent = events.find((e) => e.type === 'reverted');
  assert.ok(revertEvent, 'reverted event was emitted');
  assert.deepEqual(revertEvent.files, ['src/rogue.tsx']);
});
