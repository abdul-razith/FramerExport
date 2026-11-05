import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  acquireRunLock,
  commandLineOf,
  isAlive,
  RunActiveError,
} from '../../src/convert/runner/lock.js';
import { killPidTree, stopAllManaged } from '../../src/convert/verify/proc.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fakeAgentFixture = path.resolve(__dirname, '../fixtures/fake-agent.mjs');

const tmps: string[] = [];
const processesToClean: number[] = [];

after(async () => {
  await stopAllManaged();
  for (const pid of processesToClean) {
    if (isAlive(pid)) {
      await killPidTree(pid).catch(() => {});
    }
  }
  for (const d of tmps) {
    await rm(d, { recursive: true, force: true }).catch(() => {});
  }
});

async function makeTmp(prefix = 'convert lock test '): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tmps.push(dir);
  return dir;
}

/** Spawns a background process that sleeps/hangs until killed */
function spawnHangingProcess(args: string[] = ['-e', 'setInterval(() => {}, 60000)']): number {
  const child = spawn(process.execPath, args, {
    stdio: 'ignore',
    windowsHide: true,
  });
  if (!child.pid) throw new Error('Failed to spawn test process');
  processesToClean.push(child.pid);
  child.unref();
  return child.pid;
}

test('commandLineOf: retrieves command line for a process', async () => {
  const cmd = await commandLineOf(process.pid);
  assert.ok(typeof cmd === 'string' && cmd.length > 0, `Expected non-empty command line, got ${cmd}`);
  assert.ok(cmd.toLowerCase().includes('node'), `Expected command line to contain node, got ${cmd}`);

  const deadCmd = await commandLineOf(9999999);
  assert.equal(deadCmd, null, 'Dead or invalid pid should return null');
});

test('acquireRunLock: creates lock, modifies agents & devServer, and releases lock', async () => {
  const root = await makeTmp('acquire test ');
  const { lock, stale } = await acquireRunLock(root);

  assert.equal(stale, null, 'No stale lock should be found on fresh directory');
  assert.ok(lock);

  const lockPath = path.join(root, '.convert', 'run.lock');
  const lockData = JSON.parse(await readFile(lockPath, 'utf8'));
  assert.equal(lockData.runnerPid, process.pid);
  assert.deepEqual(lockData.agents, {});

  // Update agent
  await lock.setAgent('task-1', 12345);
  const dataWithAgent = JSON.parse(await readFile(lockPath, 'utf8'));
  assert.equal(dataWithAgent.agents['task-1'], 12345);

  // Update devServer
  await lock.setDevServer(4000);
  const dataWithServer = JSON.parse(await readFile(lockPath, 'utf8'));
  assert.equal(dataWithServer.devServerPid, 4000);

  // Clear agent and devServer
  await lock.setAgent('task-1', null);
  await lock.setDevServer(null);
  const dataCleared = JSON.parse(await readFile(lockPath, 'utf8'));
  assert.equal(dataCleared.agents['task-1'], undefined);
  assert.equal(dataCleared.devServerPid, undefined);

  // Release lock
  await lock.release();
  let exists = true;
  try {
    await readFile(lockPath);
  } catch (err: any) {
    if (err.code === 'ENOENT') exists = false;
  }
  assert.equal(exists, false, 'run.lock should be deleted on release');
});

test('acquireRunLock: throws RunActiveError if recorded runnerPid is alive and is not this process', async () => {
  const root = await makeTmp('active runner ');
  const foreignPid = spawnHangingProcess();
  assert.ok(isAlive(foreignPid));

  const lockPath = path.join(root, '.convert', 'run.lock');
  await mkdir(path.dirname(lockPath), { recursive: true });
  await writeFile(
    lockPath,
    JSON.stringify({
      runnerPid: foreignPid,
      startedAt: new Date().toISOString(),
      agents: {},
    })
  );

  await assert.rejects(
    async () => {
      await acquireRunLock(root);
    },
    (err: any) => {
      assert.ok(err instanceof RunActiveError, `Expected RunActiveError, got ${err?.constructor?.name}`);
      return true;
    }
  );
});

test('acquireRunLock: stale lock kills fake-agent.mjs hang and returns stale lock', async () => {
  const root = await makeTmp('stale test ');

  // 1. Spawn a fake-agent in hang mode
  const fakeAgentChild = spawn(process.execPath, [fakeAgentFixture], {
    env: { ...process.env, FAKE_AGENT_MODE: 'hang' },
    stdio: 'ignore',
    windowsHide: true,
  });
  assert.ok(fakeAgentChild.pid);
  const agentPid = fakeAgentChild.pid;
  processesToClean.push(agentPid);
  fakeAgentChild.unref();

  // Wait a moment for process to start
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(isAlive(agentPid), true, 'fake-agent must be alive before acquire');

  // Verify command line of fake agent matches regex
  const cmd = await commandLineOf(agentPid);
  assert.ok(cmd && /fake-agent/.test(cmd), `Expected command line to include fake-agent, got: ${cmd}`);

  // 2. Create a dead PID by spawning and letting it exit
  const deadChild = spawn(process.execPath, ['-e', 'process.exit(0)'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  await new Promise<void>((resolve) => deadChild.on('close', () => resolve()));
  const deadPid = deadChild.pid!;
  assert.equal(isAlive(deadPid), false, 'deadPid must be dead');

  // 3. Write stale lockfile with dead runnerPid and hung agent
  const lockPath = path.join(root, '.convert', 'run.lock');
  await mkdir(path.dirname(lockPath), { recursive: true });
  const staleData = {
    runnerPid: deadPid,
    startedAt: new Date(Date.now() - 3600_000).toISOString(),
    agents: {
      'task-hung': agentPid,
    },
  };
  await writeFile(lockPath, JSON.stringify(staleData, null, 2));

  // 4. Acquire run lock: should detect stale lock, kill fake-agent, and return stale
  const { lock, stale } = await acquireRunLock(root);
  assert.ok(stale, 'Expected stale lock to be returned');
  assert.equal(stale.runnerPid, deadPid);
  assert.equal(stale.agents['task-hung'], agentPid);

  // fake-agent should be killed
  let alive = isAlive(agentPid);
  // Wait up to 3s for kill to finish
  const start = Date.now();
  while (alive && Date.now() - start < 3000) {
    await new Promise((r) => setTimeout(r, 100));
    alive = isAlive(agentPid);
  }
  assert.equal(alive, false, 'Stale fake-agent process should have been killed');

  // Verify new lock is held by this process
  const currentLockData = JSON.parse(await readFile(lockPath, 'utf8'));
  assert.equal(currentLockData.runnerPid, process.pid);

  await lock.release();
});

test('acquireRunLock: stale lock does not kill process if command line does not match regex', async () => {
  const root = await makeTmp('stale safe ');

  // Spawn an unrelated process (node sleeping)
  const unrelatedPid = spawnHangingProcess(['-e', 'setInterval(() => {}, 60000)']);
  assert.ok(isAlive(unrelatedPid));

  // Write stale lock referencing unrelatedPid
  const lockPath = path.join(root, '.convert', 'run.lock');
  await mkdir(path.dirname(lockPath), { recursive: true });
  await writeFile(
    lockPath,
    JSON.stringify({
      runnerPid: 9999999, // dead PID
      startedAt: new Date().toISOString(),
      agents: {
        'task-unrelated': unrelatedPid,
      },
    })
  );

  const { lock, stale } = await acquireRunLock(root);
  assert.ok(stale);

  // The unrelated process should NOT have been killed because its command line didn't match /agy|claude|next|fake-agent/
  assert.equal(isAlive(unrelatedPid), true, 'Unrelated process must not be killed');

  await lock.release();
});
