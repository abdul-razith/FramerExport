import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { poolCheckOptions, runAgents, type RunDeps, type RunIo, type RunOutcome } from '../../src/convert/run.js';
import { createPauseController } from '../../src/convert/runner/pool.js';
import { setInterruptHandler } from '../../src/convert/verify/proc.js';
import { RunActiveError } from '../../src/convert/runner/lock.js';
import { DEFAULT_OPTIONS, initState, loadState, saveState } from '../../src/convert/state.js';
import type { AgentHandle } from '../../src/convert/runner/agent-process.js';
import type { GeneratedManifest } from '../../src/convert/generate/manifest.js';

const tmps: string[] = [];

after(async () => {
  for (const d of tmps) {
    await rm(d, { recursive: true, force: true }).catch(() => {});
  }
});

async function makeTmp(prefix = 'convert-run-'): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tmps.push(dir);
  return dir;
}

async function setupProject(initialAgent: 'agy' | 'claude' = 'agy'): Promise<string> {
  const root = await makeTmp();
  const state = initState(path.join(root, 'export'), root);
  state.options = { ...DEFAULT_OPTIONS, agent: initialAgent };
  state.tasks['sec-home-hero'] = {
    id: 'sec-home-hero',
    kind: 'section',
    file: '.convert/tasks/sec-home-hero.md',
    status: 'pending',
    attempts: 0,
    targets: ['src/sections/home/Hero.tsx'],
  };
  await saveState(state);

  const manifest: GeneratedManifest = {
    version: 1,
    pages: [
      {
        route: '/',
        slug: 'home',
        view: 'src/views/home.tsx',
        sections: [
          {
            name: 'Hero',
            component: 'Hero',
            file: 'src/sections/home/Hero.tsx',
            parts: [],
            motion: [],
            scriptDrawn: [],
          },
        ],
        inline: [],
        shell: [],
      },
    ],
    shell: [],
    motion: [],
    scriptDrawn: [],
    stubs: [],
    warnings: [],
  };

  await mkdir(path.join(root, '.convert'), { recursive: true });
  await writeFile(path.join(root, '.convert', 'manifest.json'), JSON.stringify(manifest, null, 2));
  await mkdir(path.join(root, '.convert', 'tasks'), { recursive: true });
  await writeFile(
    path.join(root, '.convert', 'tasks', 'sec-home-hero.md'),
    '# Task sec-home-hero\n## Edit only\n- `src/sections/home/Hero.tsx`\n'
  );
  await mkdir(path.join(root, 'src', 'sections', 'home'), { recursive: true });
  await writeFile(
    path.join(root, 'src', 'sections', 'home', 'Hero.tsx'),
    'export default function Hero() { return <section>Hero</section>; }\n'
  );

  return root;
}

test('quota + switch -> second queue run uses the other agent', async () => {
  const root = await setupProject('agy');
  const agentsUsed: string[] = [];

  const pause = createPauseController();
  const io: RunIo = {
    onEvent() {},
    pause,
    onQuota: async (_hit, other) => {
      assert.equal(other, 'claude');
      return 'switch';
    },
  };

  const deps: RunDeps = {
    devServer: async () => ({
      url: 'http://127.0.0.1:1',
      pid: process.pid,
      stop: async () => {},
    }),
    check: async () => ({
      taskId: 'sec-home-hero',
      mode: 'full',
      pass: true,
      limitReached: false,
      widths: [],
      dom: [],
      code: [],
      motion: [],
      errors: [],
    }),
    finalize: async () => ({ buildOk: true }),
    detectAgents: async () => ['agy', 'claude'],
    spawn: (_task, _prompt, _timeoutMs, _logFile, _onLine) => {
      const handle: AgentHandle = {
        pid: process.pid,
        done: (async () => {
          const state = await loadState(root);
          const currentAgent = state?.options?.agent ?? 'agy';
          agentsUsed.push(currentAgent);
          if (agentsUsed.length === 1) {
            return {
              exitCode: 3,
              timedOut: false,
              killed: false,
              quota: {
                line: 'error: Individual quota reached. Resets in 43h24m17s.',
                resetHint: '43h24m17s',
              },
            };
          }
          return { exitCode: 0, timedOut: false, killed: false, quota: null };
        })(),
        kill: async () => {},
      };
      return handle;
    },
  };

  const outcome = await runAgents(root, io, deps);
  assert.equal(outcome.status, 'done');
  assert.deepEqual(agentsUsed, ['agy', 'claude']);
  const stateAfter = await loadState(root);
  assert.equal(stateAfter?.options?.agent, 'claude');
  assert.equal(stateAfter?.run.status, 'done');
});

test('quota + stay -> state.run { status: "paused", reason: "quota", quotaResetHint: "43h24m17s" }', async () => {
  const root = await setupProject('agy');

  const pause = createPauseController();
  const io: RunIo = {
    onEvent() {},
    pause,
    onQuota: async (_hit, _other) => 'stay',
  };

  const deps: RunDeps = {
    devServer: async () => ({
      url: 'http://127.0.0.1:1',
      pid: process.pid,
      stop: async () => {},
    }),
    check: async () => ({
      taskId: 'sec-home-hero',
      mode: 'full',
      pass: true,
      limitReached: false,
      widths: [],
      dom: [],
      code: [],
      motion: [],
      errors: [],
    }),
    finalize: async () => ({ buildOk: true }),
    detectAgents: async () => ['agy', 'claude'],
    spawn: () => ({
      pid: process.pid,
      done: Promise.resolve({
        exitCode: 3,
        timedOut: false,
        killed: false,
        quota: {
          line: 'error: Individual quota reached. Resets in 43h24m17s.',
          resetHint: '43h24m17s',
        },
      }),
      kill: async () => {},
    }),
  };

  const outcome = await runAgents(root, io, deps);
  assert.deepEqual(outcome, {
    status: 'paused',
    reason: 'quota',
    quotaResetHint: '43h24m17s',
  });

  const stateAfter = await loadState(root);
  assert.equal(stateAfter?.run.status, 'paused');
  assert.equal(stateAfter?.run.reason, 'quota');
  assert.equal(stateAfter?.run.quotaResetHint, '43h24m17s');
  assert.ok(stateAfter?.run.pausedAt);
});

test('second runAgents while the first holds the lock rejects with RunActiveError', async () => {
  const root = await setupProject('agy');

  let releaseFirst: () => void = () => {};
  const firstBlock = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const pause = createPauseController();
  const io: RunIo = {
    onEvent() {},
    pause,
    onQuota: async () => 'stay',
  };

  let firstRunning = false;
  const depsFirst: RunDeps = {
    devServer: async () => ({
      url: 'http://127.0.0.1:1',
      pid: process.pid,
      stop: async () => {},
    }),
    check: async () => ({
      taskId: 'sec-home-hero',
      mode: 'full',
      pass: true,
      limitReached: false,
      widths: [],
      dom: [],
      code: [],
      motion: [],
      errors: [],
    }),
    finalize: async () => ({ buildOk: true }),
    spawn: () => ({
      pid: process.pid,
      done: (async () => {
        firstRunning = true;
        await firstBlock;
        return { exitCode: 0, timedOut: false, killed: false, quota: null };
      })(),
      kill: async () => {},
    }),
  };

  const firstPromise = runAgents(root, io, depsFirst);

  // Poll until first is running and lock is held
  while (!firstRunning) {
    await new Promise((r) => setTimeout(r, 10));
  }

  // Second invocation while lock is held
  await assert.rejects(runAgents(root, io, depsFirst), (err: unknown) => {
    assert.ok(err instanceof RunActiveError, `Expected RunActiveError, got ${String(err)}`);
    return true;
  });

  releaseFirst();
  const outcomeFirst = await firstPromise;
  assert.equal(outcomeFirst.status, 'done');
});

test('lock released after an exception', async () => {
  const root = await setupProject('agy');

  const pause = createPauseController();
  const io: RunIo = {
    onEvent() {},
    pause,
    onQuota: async () => 'stay',
  };

  const deps: RunDeps = {
    devServer: async () => {
      throw new Error('dev server failure exploded');
    },
  };

  await assert.rejects(runAgents(root, io, deps), /dev server failure exploded/);

  // Now verify lock was released: another runAgents should be able to acquire lock
  let secondReachedDevServer = false;
  await assert.rejects(
    runAgents(root, io, {
      devServer: async () => {
        secondReachedDevServer = true;
        throw new Error('second failure');
      },
    }),
    /second failure/
  );
  assert.equal(secondReachedDevServer, true);
});

test('B-I4: the pool default check does not count check calls (counted from the CLI)', () => {
  assert.deepEqual(poolCheckOptions(true, 'http://localhost:3000'), {
    smoke: true,
    countCall: false,
    devUrl: 'http://localhost:3000',
  });
});

function i2Deps(over: Partial<RunDeps>): RunDeps {
  return {
    devServer: async () => ({ url: 'http://127.0.0.1:1', pid: process.pid, stop: async () => {} }),
    check: async () => ({
      taskId: 'sec-home-hero',
      mode: 'full',
      pass: false,
      limitReached: false,
      widths: [],
      dom: [],
      code: [],
      motion: [],
      errors: [],
    }),
    finalize: async () => ({ buildOk: true }),
    detectAgents: async () => ['claude'],
    ...over,
  };
}

test('I2: a spawn error stops the run with a message naming the agent and leaves the task pending', async () => {
  const root = await setupProject('claude');
  const io: RunIo = { onEvent() {}, pause: createPauseController(), onQuota: async () => 'stay' };
  const deps = i2Deps({
    spawn: () => ({
      pid: undefined,
      done: Promise.resolve({
        exitCode: null,
        timedOut: false,
        killed: false,
        quota: null,
        spawnError: 'ENOENT: spawn claude ENOENT',
      }),
      kill: async () => {},
    }),
  });
  await assert.rejects(runAgents(root, io, deps), /Could not start agent "claude".*ENOENT/);
  const state = await loadState(root);
  assert.equal(state?.tasks['sec-home-hero']?.status, 'pending');
  assert.equal(state?.tasks['sec-home-hero']?.attempts, 0);
  assert.equal(Object.keys(state?.tasks ?? {}).some((id) => id.startsWith('fix-')), false);
});

test('I2: a missing agent binary refuses to start and names the agent', async () => {
  const root = await setupProject('claude');
  const io: RunIo = { onEvent() {}, pause: createPauseController(), onQuota: async () => 'stay' };
  const deps = i2Deps({ resolveAgentBinary: async () => null });
  await assert.rejects(runAgents(root, io, deps), /Agent "claude" was not found on PATH/);
  const state = await loadState(root);
  assert.equal(state?.tasks['sec-home-hero']?.status, 'pending');
});

test('I3a: a task that throws inside the pool stops the run without finalizing or recording done', async () => {
  const root = await setupProject('claude');
  const events: string[] = [];
  const io: RunIo = {
    onEvent: (e) => events.push(e.type),
    pause: createPauseController(),
    onQuota: async () => 'stay',
  };
  let finalized = false;
  const deps = i2Deps({
    check: async () => {
      throw new Error('check blew up');
    },
    finalize: async () => {
      finalized = true;
      return { buildOk: true };
    },
    spawn: () => ({
      pid: undefined,
      done: Promise.resolve({ exitCode: 0, timedOut: false, killed: false, quota: null }),
      kill: async () => {},
    }),
  });
  await assert.rejects(runAgents(root, io, deps), /sec-home-hero.*check blew up/);
  assert.equal(finalized, false);
  assert.ok(events.includes('task-error'));
  const state = await loadState(root);
  assert.notEqual(state?.run.status, 'done');
  assert.equal(state?.tasks['sec-home-hero']?.status, 'pending');
});

test('I3b: a failed production build runs the pending fix-build task through the pool, then finalizes again', async () => {
  const root = await setupProject('claude');
  const io: RunIo = { onEvent() {}, pause: createPauseController(), onQuota: async () => 'stay' };
  const spawned: string[] = [];
  const checked: string[] = [];
  let finalizeCalls = 0;
  const deps = i2Deps({
    check: async (taskId) => {
      checked.push(taskId);
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
    },
    spawn: (task) => {
      spawned.push(task.id);
      return {
        pid: undefined,
        done: Promise.resolve({ exitCode: 0, timedOut: false, killed: false, quota: null }),
        kill: async () => {},
      };
    },
    finalize: async (ctx) => {
      finalizeCalls++;
      if (finalizeCalls === 1) {
        ctx.state.tasks['fix-build'] = {
          id: 'fix-build',
          kind: 'fix',
          targets: ['src/'],
          file: '.convert/tasks/fix-build.md',
          status: 'pending',
          attempts: 1,
        };
        return { buildOk: false, fixTask: 'fix-build' };
      }
      return { buildOk: true };
    },
  });
  const outcome = await runAgents(root, io, deps);
  assert.equal(outcome.status, 'done');
  assert.deepEqual(spawned, ['sec-home-hero', 'fix-build']);
  assert.equal(finalizeCalls, 2);
  const state = await loadState(root);
  assert.equal(state?.tasks['fix-build']?.status, 'done');
});

test('I1: runAgents does not overwrite an interrupt handler the caller installed', async () => {
  const root = await setupProject('claude');
  const pause = createPauseController();
  const io: RunIo = { onEvent() {}, pause, onQuota: async () => 'stay' };
  let callerCalls = 0;
  setInterruptHandler(() => {
    callerCalls++;
  });
  try {
    const deps = i2Deps({
      spawn: () => ({
        pid: undefined,
        done: new Promise((resolve) =>
          setTimeout(() => {
            process.emit('SIGINT');
            resolve({ exitCode: 0, timedOut: false, killed: false, quota: null });
          }, 10)
        ),
        kill: async () => {},
      }),
      check: async (taskId) => ({
        taskId,
        mode: 'full',
        pass: true,
        limitReached: false,
        widths: [],
        dom: [],
        code: [],
        motion: [],
        errors: [],
      }),
    });
    await runAgents(root, io, deps);
    assert.equal(callerCalls, 1);
    assert.equal(pause.mode, 'none');
    process.emit('SIGINT');
    assert.equal(callerCalls, 2, 'the caller handler is still installed after the run');
  } finally {
    setInterruptHandler(null);
  }
});

test('I1: with no caller handler, the default is finish-running-then-pause first, pause-now second', async () => {
  const root = await setupProject('claude');
  const pause = createPauseController();
  const io: RunIo = { onEvent() {}, pause, onQuota: async () => 'stay' };
  const modes: string[] = [];
  const deps = i2Deps({
    spawn: () => ({
      pid: undefined,
      done: new Promise((resolve) =>
        setTimeout(() => {
          process.emit('SIGINT');
          modes.push(pause.mode);
          process.emit('SIGINT');
          modes.push(pause.mode);
          resolve({ exitCode: 0, timedOut: false, killed: false, quota: null });
        }, 10)
      ),
      kill: async () => {},
    }),
  });
  const outcome = await runAgents(root, io, deps);
  assert.deepEqual(modes, ['after-running', 'now']);
  assert.equal(outcome.status, 'paused');
});

test('I7: runAgents refuses a legacy project', async () => {
  const root = await setupProject('claude');
  const state = await loadState(root);
  state!.legacyTasks = true;
  await saveState(state!);
  const io: RunIo = { onEvent() {}, pause: createPauseController(), onQuota: async () => 'stay' };
  await assert.rejects(runAgents(root, io, i2Deps({})), /old task model/);
});
