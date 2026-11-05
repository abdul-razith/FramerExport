import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  freePort,
  isPidAlive,
  killPidTree,
  npmCommand,
  quoteIfSpaced,
  spawnManaged,
  type ManagedProcess
} from './proc.js';

export interface DevServer {
  url: string;
  pid: number;
  stop(): Promise<void>;
}

export interface DevServerInfo {
  pid: number;
  port: number;
  startedAt: string;
}

const MAX_LOG = 256 * 1024;

function devServerJsonPath(nextDir: string): string {
  return path.join(nextDir, '.convert', 'dev-server.json');
}

/** Tail-capped output collector so pipes never fill up. */
function collectOutput(child: ChildProcess): () => string {
  let out = '';
  const add = (chunk: Buffer) => {
    out += chunk.toString('utf8');
    if (out.length > MAX_LOG) out = out.slice(-MAX_LOG);
  };
  child.stdout?.on('data', add);
  child.stderr?.on('data', add);
  return () => out;
}

function trackSpawnError(child: ChildProcess): () => Error | null {
  let error: Error | null = null;
  child.once('error', (err) => (error = err));
  return () => error;
}

/** Probe GET url; resolves true on any HTTP response, false on connection refusal/timeout. */
async function probeServer(url: string, timeoutMs = 500): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    try {
      await res.body?.cancel();
    } catch {
      // ignore
    }
    return true;
  } catch {
    return false;
  }
}

async function readDevServerInfo(filePath: string): Promise<DevServerInfo | null> {
  try {
    const content = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(content);
    if (typeof parsed?.pid === 'number' && typeof parsed?.port === 'number') {
      return parsed as DevServerInfo;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Ensure a Next.js dev server is running for `nextDir`.
 *
 * - Reuses the server in `.convert/dev-server.json` ({ pid, port, startedAt }) when `GET /` answers.
 * - Otherwise finds a free port, starts `npm run dev -- -p <freePort> -H 127.0.0.1` with `NEXT_TELEMETRY_DISABLED=1`
 *   (managed by `spawnManaged`, or detached and unref'd when `keepAlive`).
 * - Waits for any HTTP answer (poll `http://127.0.0.1:<port>/`), writes `.convert/dev-server.json`.
 */
export async function ensureDevServer(
  nextDir: string,
  opts?: { keepAlive?: boolean; readyTimeoutMs?: number /* default 120_000 */ }
): Promise<DevServer> {
  const infoPath = devServerJsonPath(nextDir);
  const existing = await readDevServerInfo(infoPath);

  if (existing) {
    const alive = isPidAlive(existing.pid);
    if (alive) {
      const answers = await probeServer(`http://127.0.0.1:${existing.port}/`, 500);
      if (answers) {
        return {
          url: `http://127.0.0.1:${existing.port}`,
          pid: existing.pid,
          stop: () => stopDevServer(nextDir)
        };
      }
    }
    // Dev server died, is unresponsive, or its port was taken
    await killPidTree(existing.pid).catch(() => {});
    await rm(infoPath, { force: true }).catch(() => {});
  }

  const port = await freePort();
  const readyTimeoutMs = opts?.readyTimeoutMs ?? 120_000;
  const keepAlive = Boolean(opts?.keepAlive);
  const devArgs = ['run', 'dev', '--', '-p', String(port), '-H', '127.0.0.1'];
  const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' };

  let managedProc: ManagedProcess | null = null;
  let child: ChildProcess;

  if (keepAlive) {
    const isWindows = process.platform === 'win32';
    const batch = isWindows && /\.(cmd|bat)$/i.test(npmCommand);
    child = batch
      ? spawn(quoteIfSpaced(npmCommand), devArgs.map(quoteIfSpaced), {
          cwd: nextDir,
          env,
          shell: true,
          stdio: 'ignore',
          windowsHide: true,
          detached: true
        })
      : spawn(npmCommand, devArgs, {
          cwd: nextDir,
          env,
          stdio: 'ignore',
          windowsHide: true,
          detached: true
        });
    child.unref();
  } else {
    managedProc = spawnManaged(npmCommand, devArgs, {
      cwd: nextDir,
      env
    });
    child = managedProc.child;
  }

  if (!child.pid) {
    throw new Error('failed to spawn dev server process');
  }
  const pid = child.pid;
  const output = collectOutput(child);
  const getSpawnError = trackSpawnError(child);
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + readyTimeoutMs;

  let ready = false;
  while (Date.now() < deadline) {
    const spawnErr = getSpawnError();
    if (spawnErr) {
      if (managedProc) await managedProc.stop().catch(() => {});
      else await killPidTree(pid).catch(() => {});
      throw new Error(`dev server failed to start: ${spawnErr.message}`);
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      if (managedProc) await managedProc.stop().catch(() => {});
      else await killPidTree(pid).catch(() => {});
      const log = output();
      const details = log ? `.\n${log.slice(-4000)}` : '.';
      throw new Error(`dev server exited before becoming ready (code ${child.exitCode})${details}`);
    }
    ready = await probeServer(url + '/', 500);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  if (!ready) {
    if (managedProc) await managedProc.stop().catch(() => {});
    else await killPidTree(pid).catch(() => {});
    const log = output();
    const details = log ? `.\n${log.slice(-4000)}` : '.';
    throw new Error(`dev server did not become ready at ${url} within ${readyTimeoutMs / 1000}s${details}`);
  }

  await mkdir(path.dirname(infoPath), { recursive: true });
  const devServerInfo: DevServerInfo = {
    pid,
    port,
    startedAt: new Date().toISOString()
  };
  await writeFile(infoPath, JSON.stringify(devServerInfo, null, 2), 'utf8');

  return {
    url,
    pid,
    stop: async () => {
      if (managedProc) {
        await managedProc.stop().catch(() => {});
      }
      await stopDevServer(nextDir);
    }
  };
}

/**
 * Stop the recorded dev server for `nextDir` and delete `.convert/dev-server.json`.
 */
export async function stopDevServer(nextDir: string): Promise<void> {
  const infoPath = devServerJsonPath(nextDir);
  const info = await readDevServerInfo(infoPath);
  if (info?.pid) {
    await killPidTree(info.pid);
  }
  await rm(infoPath, { force: true }).catch(() => {});
}
