import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { commandLineOf } from '../runner/lock.js';
import { writeFileAtomic } from '../state.js';
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

/** Default probe timeout: a busy `next dev` can take seconds to answer while it compiles. */
export const PROBE_TIMEOUT_MS = 10_000;
const PROBE_ATTEMPTS = 3;

export type ProbeResult = 'ok' | 'refused' | 'timeout';

/** Probe GET url once; any HTTP response is 'ok', a timeout is 'timeout', anything else is 'refused'. */
async function probeOnce(url: string, timeoutMs: number): Promise<ProbeResult> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    try {
      await res.body?.cancel();
    } catch {
      // ignore
    }
    return 'ok';
  } catch (err: any) {
    const name = err?.name ?? err?.cause?.name;
    return name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'refused';
  }
}

/** Probe with retries on timeout (server busy compiling); a refused connection is final. */
export async function probeServer(
  url: string,
  timeoutMs = PROBE_TIMEOUT_MS,
  attempts = PROBE_ATTEMPTS
): Promise<ProbeResult> {
  let last: ProbeResult = 'refused';
  for (let i = 0; i < attempts; i++) {
    last = await probeOnce(url, timeoutMs);
    if (last !== 'timeout') return last;
  }
  return last;
}

/**
 * Next allows one dev server per project. A second one exits with "Another next dev server is already running"
 * and prints the first one's port and pid; returns them so the caller can use that server instead of failing.
 */
export function parseExistingDevServer(output: string): { port: number; pid: number } | null {
  if (!/Another next dev server is already running/i.test(output)) return null;
  const port = /-\s*Local:\s*https?:\/\/[^\s:]+:(\d+)/i.exec(output)?.[1];
  const pid = /-\s*PID:\s*(\d+)/i.exec(output)?.[1];
  return port && pid ? { port: Number(port), pid: Number(pid) } : null;
}

const WORD = '(^|[^a-z0-9_-])';
const END = '([^a-z0-9_-]|$)';

/** Only a process whose command line is a Next dev server (or the npm wrapper running it) may be killed. */
function looksLikeDevServer(cmd: string | null): boolean {
  if (!cmd) return false;
  const lower = cmd.toLowerCase();
  if (new RegExp(WORD + 'next' + END).test(lower) && new RegExp(WORD + 'dev' + END).test(lower)) return true;
  // The recorded pid is the npm wrapper, whose command line is `npm run dev -- -p <port>`.
  return new RegExp(WORD + 'npm(\\.cmd)?' + END + '.*' + WORD + 'run\\s+dev' + END).test(lower);
}

/**
 * Resolve the URL checks should use. When `devUrl` refuses connections (the dev server was restarted on a
 * new port) the recorded `.convert/dev-server.json` is re-read; otherwise `devUrl` is returned unchanged.
 */
export async function resolveDevUrl(
  nextDir: string,
  devUrl: string,
  opts?: { probeTimeoutMs?: number }
): Promise<string> {
  const timeoutMs = opts?.probeTimeoutMs ?? PROBE_TIMEOUT_MS;
  const first = await probeServer(devUrl, timeoutMs);
  if (first !== 'refused') return devUrl;
  const info = await readDevServerInfo(devServerJsonPath(nextDir));
  if (!info || !isPidAlive(info.pid)) return devUrl;
  const recorded = `http://127.0.0.1:${info.port}`;
  if (recorded === devUrl.replace(/\/$/, '')) return devUrl;
  return (await probeServer(recorded, timeoutMs)) === 'refused' ? devUrl : recorded;
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
export interface EnsureDevServerOptions {
  keepAlive?: boolean;
  readyTimeoutMs?: number /* default 120_000 */;
  probeTimeoutMs?: number /* default 10_000 */;
}

const ensureLocks = new Map<string, Promise<unknown>>();

/** Serialize concurrent callers per project so two first calls never start two servers. */
export async function ensureDevServer(nextDir: string, opts?: EnsureDevServerOptions): Promise<DevServer> {
  const key = path.resolve(nextDir);
  const prev = ensureLocks.get(key) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(() => ensureDevServerLocked(nextDir, opts));
  ensureLocks.set(key, run);
  try {
    return await run;
  } finally {
    if (ensureLocks.get(key) === run) ensureLocks.delete(key);
  }
}

async function ensureDevServerLocked(nextDir: string, opts?: EnsureDevServerOptions): Promise<DevServer> {
  const infoPath = devServerJsonPath(nextDir);
  const existing = await readDevServerInfo(infoPath);

  if (existing) {
    const alive = isPidAlive(existing.pid);
    if (alive) {
      const answers = await probeServer(`http://127.0.0.1:${existing.port}/`, opts?.probeTimeoutMs);
      if (answers === 'ok') {
        return {
          url: `http://127.0.0.1:${existing.port}`,
          pid: existing.pid,
          stop: () => stopDevServer(nextDir)
        };
      }
      // Pids are reused quickly on Windows: only kill a process that is verifiably a dev server.
      if (looksLikeDevServer(await commandLineOf(existing.pid))) {
        await killPidTree(existing.pid).catch(() => {});
      }
    }
    // Dev server died, did not answer, or its port was taken
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
      // Another process (a parallel check, a leftover server) already owns this project's dev server: use it.
      const existingServer = parseExistingDevServer(log);
      if (existingServer && (await probeServer(`http://127.0.0.1:${existingServer.port}/`, opts?.probeTimeoutMs)) === 'ok') {
        await mkdir(path.dirname(infoPath), { recursive: true });
        await writeFileAtomic(
          infoPath,
          JSON.stringify({ pid: existingServer.pid, port: existingServer.port, startedAt: new Date().toISOString() }, null, 2)
        );
        return {
          url: `http://127.0.0.1:${existingServer.port}`,
          pid: existingServer.pid,
          stop: () => stopDevServer(nextDir)
        };
      }
      const details = log ? `.\n${log.slice(-4000)}` : '.';
      throw new Error(`dev server exited before becoming ready (code ${child.exitCode})${details}`);
    }
    ready = (await probeOnce(url + '/', 500)) === 'ok';
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
  await writeFileAtomic(infoPath, JSON.stringify(devServerInfo, null, 2));

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
