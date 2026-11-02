import http from 'node:http';
import type { ChildProcess } from 'node:child_process';
import { freePort, npmCommand, spawnManaged, type ManagedProcess } from './proc.js';

export class BuildFailedError extends Error {
  constructor(public readonly log: string) {
    super('next build failed');
    this.name = 'BuildFailedError';
  }
}

const MAX_LOG = 256 * 1024;

/** Collect a child's stdout+stderr (tail-capped) so the pipes never fill up. */
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

function statusOf(url: string, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode ?? null);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Poll `url` until `ready(status)`; stops the process and rejects on timeout or early exit. */
async function waitForHttp(
  url: string,
  proc: ManagedProcess,
  ready: (status: number) => boolean,
  timeoutMs: number,
  output: () => string,
  what: string
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last: number | null = null;
  while (Date.now() < deadline) {
    if (proc.child.exitCode !== null || proc.child.signalCode !== null) {
      throw new Error(`${what} exited before becoming ready (code ${proc.child.exitCode}).\n${output().slice(-4000)}`);
    }
    last = await statusOf(url, 2000);
    if (last !== null && ready(last)) return;
    await sleep(200);
  }
  await proc.stop();
  throw new Error(
    `${what} did not become ready at ${url} within ${timeoutMs / 1000}s (last status: ${last ?? 'no response'}).\n${output().slice(-4000)}`
  );
}

/** Serve an export folder with its own `serve.js`; resolves when `GET /` returns 200. */
export async function startExportServer(exportDir: string): Promise<{ url: string; stop(): Promise<void> }> {
  const port = await freePort();
  const proc = spawnManaged(process.execPath, ['serve.js'], {
    cwd: exportDir,
    env: { ...process.env, PORT: String(port) }
  });
  const output = collectOutput(proc.child);
  const url = `http://127.0.0.1:${port}`;
  try {
    await waitForHttp(url + '/', proc, (s) => s === 200, 15_000, output, 'export server');
  } catch (err) {
    await proc.stop();
    throw err;
  }
  return { url, stop: () => proc.stop() };
}

/** `npm run build` then `npm run start -- -p <port>`; resolves when `GET /` answers below 500. */
export async function startNextServer(
  nextDir: string
): Promise<{ url: string; stop(): Promise<void>; buildLog: string }> {
  const build = spawnManaged(npmCommand, ['run', 'build'], { cwd: nextDir });
  const buildOutput = collectOutput(build.child);
  const code = await new Promise<number | null>((resolve) => {
    build.child.once('error', () => resolve(-1));
    build.child.once('close', (c) => resolve(c));
  });
  const buildLog = buildOutput();
  if (code !== 0) throw new BuildFailedError(buildLog);

  const port = await freePort();
  const proc = spawnManaged(npmCommand, ['run', 'start', '--', '-p', String(port)], { cwd: nextDir });
  const output = collectOutput(proc.child);
  const url = `http://127.0.0.1:${port}`;
  try {
    await waitForHttp(url + '/', proc, (s) => s < 500, 60_000, output, 'next server');
  } catch (err) {
    await proc.stop();
    throw err;
  }
  return { url, stop: () => proc.stop(), buildLog };
}
