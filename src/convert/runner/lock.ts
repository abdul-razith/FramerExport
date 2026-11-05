import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeFileAtomic } from '../state.js';
import { isPidAlive, killPidTree } from '../verify/proc.js';

export interface LockFile {
  runnerPid: number;
  startedAt: string;
  agents: Record<string, number>;
  devServerPid?: number;
}

export class RunActiveError extends Error {
  constructor(message = 'Another convert runner is active') {
    super(message);
    this.name = 'RunActiveError';
  }
}

/** Test if a process is still alive. */
export function isAlive(pid: number): boolean {
  return isPidAlive(pid);
}

/**
 * Returns the command line invocation of a given PID, or null if dead/unavailable.
 * Windows: powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=<pid>').CommandLine"
 * POSIX: ps -o args= -p <pid>
 */
export async function commandLineOf(pid: number): Promise<string | null> {
  if (!pid || pid <= 0 || !Number.isInteger(pid)) return null;

  return new Promise<string | null>((resolve) => {
    const isWindows = process.platform === 'win32';
    const cmd = isWindows ? 'powershell' : 'ps';
    const args = isWindows
      ? ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`]
      : ['-o', 'args=', '-p', String(pid)];

    execFile(cmd, args, { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(null);
      const str = String(stdout).trim();
      resolve(str.length > 0 ? str : null);
    });
  });
}

/** Start time of a process, or null when unknown. */
export async function startTimeOf(pid: number): Promise<Date | null> {
  if (!pid || pid <= 0 || !Number.isInteger(pid)) return null;
  return new Promise<Date | null>((resolve) => {
    const isWindows = process.platform === 'win32';
    const cmd = isWindows ? 'powershell' : 'ps';
    const args = isWindows
      ? [
          '-NoProfile',
          '-Command',
          `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CreationDate.ToUniversalTime().ToString('o')`,
        ]
      : ['-o', 'lstart=', '-p', String(pid)];
    execFile(cmd, args, { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(null);
      const d = new Date(String(stdout).trim());
      resolve(Number.isNaN(d.getTime()) ? null : d);
    });
  });
}

export interface LockDeps {
  isAlive?: (pid: number) => boolean;
  commandLineOf?: (pid: number) => Promise<string | null>;
  startTimeOf?: (pid: number) => Promise<Date | null>;
  kill?: (pid: number) => Promise<void>;
}

/** Process start times have a coarse resolution; allow this much between process start and `startedAt`. */
const START_SLACK_MS = 2000;
const RUNNER_COMMAND = /node|fexport|framer-export|tsx/i;
const AGENT_COMMAND = /(?<![A-Za-z0-9_])(agy|claude|fake-agent)(?![A-Za-z0-9_])/i;
const DEV_SERVER_COMMAND = /(?<![A-Za-z0-9_-])next(?![A-Za-z0-9_-])/i;

function normalizePath(p: string): string {
  return p.split(String.fromCharCode(92)).join('/').toLowerCase();
}

/**
 * A recorded runner pid only blocks a new run when that pid still looks like the runner: a node/fexport
 * command line that started no later than the lock's `startedAt`. A reused pid (reboot, crash) is stale.
 */
async function isRunnerAlive(lock: LockFile, deps: Required<LockDeps>): Promise<boolean> {
  if (!deps.isAlive(lock.runnerPid)) return false;
  const cmd = await deps.commandLineOf(lock.runnerPid);
  if (cmd !== null && !RUNNER_COMMAND.test(cmd)) return false;
  const started = await deps.startTimeOf(lock.runnerPid);
  const lockTime = Date.parse(lock.startedAt);
  if (started && Number.isFinite(lockTime) && started.getTime() > lockTime + START_SLACK_MS) return false;
  return true;
}

export interface RunLock {
  setAgent(taskId: string, pid: number | null): Promise<void>;
  setDevServer(pid: number | null): Promise<void>;
  release(): Promise<void>;
}

/**
 * Acquires the run lock at `.convert/run.lock`.
 * Throws RunActiveError if recorded runnerPid is alive and is not process.pid.
 * If stale lock (runnerPid dead): kills recorded agent / devServer pids whose
 * command line matches /agy|claude|next|fake-agent/, cleans up lock file, returns { lock, stale: oldLock }.
 */
export async function acquireRunLock(
  root: string,
  lockDeps: LockDeps = {}
): Promise<{ lock: RunLock; stale: LockFile | null }> {
  const deps: Required<LockDeps> = {
    isAlive: lockDeps.isAlive ?? isAlive,
    commandLineOf: lockDeps.commandLineOf ?? commandLineOf,
    startTimeOf: lockDeps.startTimeOf ?? startTimeOf,
    kill: lockDeps.kill ?? killPidTree,
  };
  const lockPath = path.join(root, '.convert', 'run.lock');

  let existing: LockFile | null = null;
  try {
    const raw = await fs.readFile(lockPath, 'utf8');
    existing = JSON.parse(raw);
  } catch (err: any) {
    if (err?.code !== 'ENOENT') {
      // If corrupted JSON or unreadable, treat existing as null
      existing = null;
    }
  }

  let stale: LockFile | null = null;

  if (existing && typeof existing.runnerPid === 'number') {
    if (existing.runnerPid === process.pid || (await isRunnerAlive(existing, deps))) {
      if (existing.runnerPid !== process.pid) {
        throw new RunActiveError(`Another convert runner is active (pid: ${existing.runnerPid})`);
      }
    } else {
      // Runner process is dead -> stale lock
      stale = existing;
      const pidsToExamine = new Set<number>();
      if (existing.agents && typeof existing.agents === 'object') {
        for (const p of Object.values(existing.agents)) {
          if (typeof p === 'number' && p > 0) {
            pidsToExamine.add(p);
          }
        }
      }
      const agentPids = new Set(pidsToExamine);
      const devPid =
        typeof existing.devServerPid === 'number' && existing.devServerPid > 0 ? existing.devServerPid : null;
      const rootNorm = normalizePath(path.resolve(root));

      for (const pid of agentPids) {
        if (deps.isAlive(pid)) {
          const cmd = await deps.commandLineOf(pid);
          if (cmd && AGENT_COMMAND.test(cmd)) {
            await deps.kill(pid);
          }
        }
      }
      // A dev server is only ours when its command line names this project folder.
      if (devPid && !agentPids.has(devPid) && deps.isAlive(devPid)) {
        const cmd = await deps.commandLineOf(devPid);
        if (cmd && DEV_SERVER_COMMAND.test(cmd) && normalizePath(cmd).includes(rootNorm)) {
          await deps.kill(devPid);
        }
      }
    }
  }

  const currentLock: LockFile = {
    runnerPid: process.pid,
    startedAt: new Date().toISOString(),
    agents: {},
  };

  await writeFileAtomic(lockPath, JSON.stringify(currentLock, null, 2) + '\n');

  let released = false;
  let writeQueue = Promise.resolve();

  const persist = (): Promise<void> => {
    writeQueue = writeQueue
      .then(async () => {
        if (released) return;
        await writeFileAtomic(lockPath, JSON.stringify(currentLock, null, 2) + '\n');
      })
      .catch(() => {});
    return writeQueue;
  };

  const lock: RunLock = {
    async setAgent(taskId: string, pid: number | null): Promise<void> {
      if (released) return;
      if (pid === null) {
        delete currentLock.agents[taskId];
      } else {
        currentLock.agents[taskId] = pid;
      }
      await persist();
    },

    async setDevServer(pid: number | null): Promise<void> {
      if (released) return;
      if (pid === null) {
        delete currentLock.devServerPid;
      } else {
        currentLock.devServerPid = pid;
      }
      await persist();
    },

    async release(): Promise<void> {
      if (released) return;
      released = true;
      try {
        await fs.rm(lockPath, { force: true });
      } catch {
        // ignore
      }
    },
  };

  return { lock, stale };
}
