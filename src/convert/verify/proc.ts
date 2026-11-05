import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import net from 'node:net';

export interface ManagedProcess {
  child: ChildProcess;
  stop(): Promise<void>;
}

const isWindows = process.platform === 'win32';
const managed = new Map<ChildProcess, () => Promise<void>>();
let handlersInstalled = false;
let interruptHandler: (() => void) | null = null;

/** While set, SIGINT calls this handler instead of default process exit. */
export function setInterruptHandler(handler: (() => void) | null): void {
  interruptHandler = handler;
  installHandlers();
}

/** True while a caller has installed an interrupt handler. */
export function hasInterruptHandler(): boolean {
  return interruptHandler !== null;
}

/** A TCP port that was free on 127.0.0.1 a moment ago. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error('could not allocate a free port'))));
    });
  });
}

function exited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function killTreeSync(child: ChildProcess): void {
  if (exited(child) || !child.pid) return;
  try {
    if (isWindows) {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }
  } catch {
    // best effort during process exit
  }
}

/** Stop every managed child that is still running. Used by the SIGINT/SIGTERM/exit handlers. */
export async function stopAllManaged(): Promise<void> {
  await Promise.all([...managed.values()].map((stop) => stop()));
}

/**
 * Synchronously kill every managed child's process tree. Registered as the `process.on('exit')` handler,
 * where only synchronous work runs. (On Windows libuv's job object also kills direct children on exit;
 * this handler additionally covers detached POSIX process groups and grandchildren.)
 */
export function killAllManagedSync(): void {
  for (const child of managed.keys()) killTreeSync(child);
}

function installHandlers(): void {
  if (handlersInstalled) return;
  handlersInstalled = true;
  let shuttingDown = false;
  // `on`, not `once`: a second Ctrl-C during cleanup must not fall back to Node's default and skip it.
  const onSignal = (code: number) => () => {
    if (code === 130 && interruptHandler) {
      try {
        interruptHandler();
      } catch {
        // best effort
      }
      return;
    }
    if (shuttingDown) return;
    shuttingDown = true;
    void stopAllManaged().finally(() => process.exit(code));
  };
  process.on('SIGINT', onSignal(130));
  process.on('SIGTERM', onSignal(143));
  process.on('exit', killAllManagedSync);
}

export function quoteIfSpaced(arg: string): string {
  return /\s/.test(arg) && !/^".*"$/.test(arg) ? `"${arg}"` : arg;
}

/** Test if a process is still alive. */
export function isPidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill a process and all its children/descendants.
 * Uses taskkill /pid <pid> /T /F on Windows, process-group signals elsewhere.
 */
export async function killPidTree(pid: number): Promise<void> {
  if (!pid || pid <= 0) return;
  if (isWindows) {
    await new Promise<void>((resolve) => {
      const tk = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      tk.once('exit', () => resolve());
      tk.once('error', () => resolve());
    });
  } else {
    try {
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        process.kill(pid, 'SIGTERM');
      }
    } catch {
      return;
    }
    const start = Date.now();
    while (Date.now() - start < 3000) {
      if (!isPidAlive(pid)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    try {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        process.kill(pid, 'SIGKILL');
      }
    } catch {
      // already dead
    }
  }
}

/**
 * Spawn a child that is tracked and torn down on shutdown. On Windows `.cmd`/`.bat` commands run via the
 * shell (required by Node for batch files) with space-containing arguments quoted; everything else runs
 * without a shell. stdout/stderr are piped; callers must consume or `resume()` them.
 */
export function spawnManaged(
  cmd: string,
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv }
): ManagedProcess {
  installHandlers();
  const batch = isWindows && /\.(cmd|bat)$/i.test(cmd);
  const child = batch
    ? spawn(quoteIfSpaced(cmd), args.map(quoteIfSpaced), {
        cwd: opts.cwd,
        env: opts.env ?? process.env,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })
    : spawn(cmd, args, {
        cwd: opts.cwd,
        env: opts.env ?? process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        detached: !isWindows
      });

  const exitPromise = new Promise<void>((resolve) => {
    if (exited(child)) return resolve();
    child.once('exit', () => resolve());
    child.once('error', () => resolve());
  });
  void exitPromise.then(() => managed.delete(child));

  let stopping: Promise<void> | null = null;
  const stop = (): Promise<void> => {
    if (exited(child) || !child.pid) {
      managed.delete(child);
      return Promise.resolve();
    }
    if (stopping) return stopping;
    stopping = (async () => {
      await killPidTree(child.pid!);
      // Never hang forever on a child that refuses to report its exit.
      let guard: NodeJS.Timeout | undefined;
      await Promise.race([exitPromise, new Promise<void>((r) => (guard = setTimeout(r, 10_000)))]);
      clearTimeout(guard);
      managed.delete(child);
    })();
    return stopping;
  };

  managed.set(child, stop);
  return { child, stop };
}

/** The npm executable for this platform. */
export const npmCommand = isWindows ? 'npm.cmd' : 'npm';
