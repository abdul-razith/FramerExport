import { execFile } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import path from 'node:path';
import { killPidTree, spawnManaged } from '../verify/proc.js';
import { detectQuota, type QuotaHit } from './quota.js';

export type AgentId = 'agy' | 'claude';
export type { QuotaHit } from './quota.js';
export { detectQuota } from './quota.js';

export interface AgentExit {
  exitCode: number | null;
  timedOut: boolean;
  killed: boolean;
  quota: QuotaHit | null;
}

export interface AgentHandle {
  pid: number | undefined;
  done: Promise<AgentExit>;
  kill(): Promise<void>;
}

export interface SpawnAgentOptions {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  logFile: string;
  onLine?: (line: string) => void;
}

/**
 * Builds the command invocation for an agent.
 * When `FEXPORT_AGENT_CMD` is set, uses Node to execute that test fixture instead of the real binary.
 */
export function agentCommand(agent: AgentId, prompt: string): { command: string; args: string[] } {
  if (process.env.FEXPORT_AGENT_CMD) {
    return {
      command: process.execPath,
      args: [process.env.FEXPORT_AGENT_CMD, agent, '-p', prompt],
    };
  }
  return {
    command: agent,
    args: ['-p', prompt, '--dangerously-skip-permissions'],
  };
}

const runExec = (file: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) =>
    execFile(file, args, (error, stdout) => (error ? reject(error) : resolve(String(stdout))))
  );

/**
 * Picks the launchable path from `where`/`which` output. On Windows `where` also lists the extensionless shell
 * shim of an npm-installed CLI first; only .exe/.cmd/.bat can be spawned.
 */
export function pickBinaryLine(output: string, platform: NodeJS.Platform): string | null {
  const lines = output.split(/\r?\n/).filter((l) => l.trim());
  if (platform === 'win32') return lines.find((l) => /\.(exe|cmd|bat)$/i.test(l.trim()))?.trim() ?? null;
  return lines[0]?.trim() ?? null;
}

/** Absolute path of the launchable match for `agent` on PATH, or null. */
export async function resolveAgentBinary(agent: AgentId): Promise<string | null> {
  try {
    const out = await runExec(process.platform === 'win32' ? 'where' : 'which', [agent]);
    return pickBinaryLine(out, process.platform);
  } catch {
    return null;
  }
}

/** Detects which supported agents (agy, claude) are available on PATH. */
export async function detectAgents(): Promise<AgentId[]> {
  const found: AgentId[] = [];
  for (const agent of ['agy', 'claude'] as const) {
    if (await resolveAgentBinary(agent)) {
      found.push(agent);
    }
  }
  return found;
}

/**
 * Launches an agent process via `spawnManaged`. Pipes and logs stdout and stderr to `logFile`,
 * scans every line with `detectQuota`, sets `quota` if detected, and kills the entire process tree
 * if `timeoutMs` expires.
 */
export function spawnAgent(opts: SpawnAgentOptions): AgentHandle {
  mkdirSync(path.dirname(opts.logFile), { recursive: true });
  const logStream = createWriteStream(opts.logFile, { flags: 'w' });

  const managed = spawnManaged(opts.command, opts.args, { cwd: opts.cwd });
  const { child } = managed;

  let timedOut = false;
  let killed = false;
  let quotaHit: QuotaHit | null = null;
  let timeoutTimer: NodeJS.Timeout | undefined;

  const createLineAccumulator = () => {
    let pending = '';
    return {
      push(chunk: Buffer): void {
        logStream.write(chunk);
        pending += chunk.toString();
        const parts = pending.split(/\r?\n/);
        pending = parts.pop() ?? '';
        for (const line of parts) {
          if (line.trim()) {
            opts.onLine?.(line);
            const q = detectQuota(line);
            if (q && !quotaHit) quotaHit = q;
          }
        }
      },
      flush(): void {
        if (pending.trim()) {
          opts.onLine?.(pending);
          const q = detectQuota(pending);
          if (q && !quotaHit) quotaHit = q;
        }
        pending = '';
      },
    };
  };

  const stdoutAcc = createLineAccumulator();
  const stderrAcc = createLineAccumulator();

  child.stdout?.on('data', (chunk: Buffer) => stdoutAcc.push(chunk));
  child.stderr?.on('data', (chunk: Buffer) => stderrAcc.push(chunk));

  if (opts.timeoutMs > 0 && Number.isFinite(opts.timeoutMs)) {
    timeoutTimer = setTimeout(async () => {
      timedOut = true;
      if (child.pid) {
        await killPidTree(child.pid);
      }
      await managed.stop();
    }, opts.timeoutMs);
  }

  const kill = async (): Promise<void> => {
    killed = true;
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (child.pid) {
      await killPidTree(child.pid);
    }
    await managed.stop();
  };

  const done = new Promise<AgentExit>((resolve) => {
    let settled = false;
    const finish = async (): Promise<void> => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);

      stdoutAcc.flush();
      stderrAcc.flush();

      await new Promise<void>((cb) => logStream.end(() => cb()));

      resolve({
        exitCode: child.exitCode,
        timedOut,
        killed,
        quota: quotaHit,
      });
    };

    child.once('close', () => { void finish(); });
    child.once('exit', () => { void finish(); });
    child.once('error', () => { void finish(); });
  });

  return {
    pid: child.pid,
    done,
    kill,
  };
}
