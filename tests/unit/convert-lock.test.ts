import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { acquireRunLock, RunActiveError, type LockDeps } from '../../src/convert/runner/lock.js';

const tmps: string[] = [];
after(async () => {
  for (const d of tmps) await rm(d, { recursive: true, force: true }).catch(() => {});
});

async function lockedRoot(lock: object): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lock unit '));
  tmps.push(root);
  await mkdir(path.join(root, '.convert'), { recursive: true });
  await writeFile(path.join(root, '.convert', 'run.lock'), JSON.stringify(lock));
  return root;
}

const NOW = Date.now();
const lockOf = (extra: object = {}) => ({
  runnerPid: 4242,
  startedAt: new Date(NOW - 60_000).toISOString(),
  agents: {},
  ...extra,
});
const alive = (pids: number[]) => (pid: number) => pids.includes(pid);

test('I9: a live pid running node that started before the lock is an active runner', async () => {
  const root = await lockedRoot(lockOf());
  const deps: LockDeps = {
    isAlive: alive([4242]),
    commandLineOf: async () => 'node /x/fexport convert run',
    startTimeOf: async () => new Date(NOW - 120_000),
  };
  await assert.rejects(acquireRunLock(root, deps), RunActiveError);
});

test('I9: a reused pid running something unrelated is a stale lock, not a permanent refusal', async () => {
  const root = await lockedRoot(lockOf());
  const deps: LockDeps = {
    isAlive: alive([4242]),
    commandLineOf: async () => 'svchost.exe -k netsvcs',
    startTimeOf: async () => new Date(NOW - 120_000),
  };
  const { lock, stale } = await acquireRunLock(root, deps);
  assert.ok(stale);
  await lock.release();
});

test('I9: a node process that started after the lock was written is a reused pid (stale)', async () => {
  const root = await lockedRoot(lockOf());
  const deps: LockDeps = {
    isAlive: alive([4242]),
    commandLineOf: async () => 'node some-other-script.js',
    startTimeOf: async () => new Date(NOW + 60_000),
  };
  const { stale, lock } = await acquireRunLock(root, deps);
  assert.ok(stale);
  await lock.release();
});

test('I9: recorded agent and dev-server pids are killed only when the command line matches', async () => {
  const killed: number[] = [];
  const run = async (devCmd: string, agentCmd: string): Promise<number[]> => {
    killed.length = 0;
    const root = await lockedRoot(lockOf({ runnerPid: 1, devServerPid: 777, agents: { t: 888 } }));
    const cmds: Record<number, string> = { 777: devCmd, 888: agentCmd };
    const { lock } = await acquireRunLock(root, {
      isAlive: alive([777, 888]),
      commandLineOf: async (pid) => cmds[pid] ?? null,
      startTimeOf: async () => null,
      kill: async (pid) => void killed.push(pid),
    });
    await lock.release();
    return [...killed];
  };
  // Unrelated processes whose command line merely contains "next" / "claude" as part of a longer word.
  assert.deepEqual(await run('node C:/other-project-next/server.js', 'node C:/unclaimed/tool.js'), []);
  // A dev server that names another project is left alone even though it runs next.
  assert.deepEqual(await run('node C:/elsewhere/node_modules/next/dist/bin/next dev', 'node C:/x/claude-code/cli.js'), [888]);
});

test('I9: a dev server running next inside this project is killed', async () => {
  const killed: number[] = [];
  const root = await lockedRoot(lockOf({ runnerPid: 1, devServerPid: 777 }));
  const rootFwd = root.split(String.fromCharCode(92)).join('/');
  const { lock } = await acquireRunLock(root, {
    isAlive: alive([777]),
    commandLineOf: async () => 'node ' + rootFwd + '/node_modules/next/dist/bin/next dev',
    startTimeOf: async () => null,
    kill: async (pid) => void killed.push(pid),
  });
  await lock.release();
  assert.deepEqual(killed, [777]);
});
