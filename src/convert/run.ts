import path from 'node:path';
import type { StageContext } from './adapters/types.js';
import { readManifest, type GeneratedManifest } from './generate/manifest.js';
import {
  agentCommand,
  detectAgents,
  spawnAgent,
  type AgentHandle,
  type AgentId,
  type QuotaHit,
} from './runner/agent-process.js';
import { recoverInterrupted } from './runner/interrupt.js';
import { acquireRunLock, RunActiveError, type RunLock } from './runner/lock.js';
import {
  runQueue,
  type PauseController,
  type PoolDeps,
  type PoolEvent,
} from './runner/pool.js';
import { runFinalize, type FinalizeDeps } from './stages/finalize.js';
import { manifestFallback, renderTaskFiles } from './stages/tasks.js';
import { DEFAULT_OPTIONS, loadState, saveState } from './state.js';
import type { TaskRecord } from './types.js';
import { ensureDevServer, type DevServer } from './verify/dev-server.js';
import { runCheck, type CheckResult } from './verify/check.js';
import { npmCommand, setInterruptHandler, spawnManaged } from './verify/proc.js';
import { runReport } from './verify/report.js';

export type { AgentId, QuotaHit };

export interface RunIo {
  onEvent(e: PoolEvent): void;
  pause: PauseController;
  onQuota(hit: QuotaHit, other: AgentId | null): Promise<'switch' | 'stay'>;
}

export type RunOutcome =
  | { status: 'done'; report?: string }
  | { status: 'paused'; reason: 'user' | 'quota'; quotaResetHint?: string };

export type RunDeps = Partial<PoolDeps> & {
  devServer?: (root: string) => Promise<DevServer>;
  finalize?: (ctx: StageContext) => Promise<{ buildOk: boolean; report?: string }>;
  manifest?: (root: string) => Promise<GeneratedManifest | null>;
  detectAgents?: () => Promise<AgentId[]>;
};

function defaultBuild(cwd: string): Promise<{ ok: boolean; log: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const proc = spawnManaged(npmCommand, ['run', 'build'], { cwd });
    let out = '';
    const add = (d: Buffer) => {
      out += d.toString('utf8');
      if (out.length > 256 * 1024) out = out.slice(-256 * 1024);
    };
    proc.child.stdout?.on('data', add);
    proc.child.stderr?.on('data', add);
    proc.child.on('error', (e) => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, log: e.message });
    });
    proc.child.on('close', (code) => {
      if (settled) return;
      settled = true;
      resolve({ ok: code === 0, log: out });
    });
  });
}

function defaultCheck(
  root: string,
  devUrl: string,
  taskId: string,
  smoke: boolean
): Promise<CheckResult> {
  if (taskId === 'fix-build') {
    return defaultBuild(root).then((res) => ({
      taskId: 'fix-build',
      mode: smoke ? 'smoke' : 'full',
      pass: res.ok,
      limitReached: false,
      widths: [],
      dom: [],
      code: [],
      motion: [],
      errors: res.ok ? [] : [res.log],
    }));
  }
  return runCheck(root, taskId, poolCheckOptions(smoke, devUrl));
}

/** The pool does not count check calls; the CLI check command does. */
export function poolCheckOptions(smoke: boolean, devUrl: string): { smoke: boolean; countCall: false; devUrl: string } {
  return { smoke, countCall: false, devUrl };
}

function defaultFinalizeDeps(root: string, devUrl: string, ctx: StageContext): FinalizeDeps {
  return {
    check: (id: string) => runCheck(root, id, { countCall: false, devUrl }),
    build: () => defaultBuild(root),
    report: () => runReport(ctx, { tolerance: ctx.state.options?.reportTolerance ?? DEFAULT_OPTIONS.reportTolerance }),
  };
}

function defaultSpawn(
  root: string,
  agent: AgentId,
  prompt: string,
  timeoutMs: number,
  logFile: string,
  onLine: (line: string) => void
): AgentHandle {
  const { command, args } = agentCommand(agent, prompt);
  return spawnAgent({
    command,
    args,
    cwd: root,
    timeoutMs,
    logFile,
    onLine,
  });
}

const activeRoots = new Set<string>();

export async function runAgents(root: string, io: RunIo, deps?: RunDeps): Promise<RunOutcome> {
  const resolvedRoot = path.resolve(root);
  if (activeRoots.has(resolvedRoot)) {
    throw new RunActiveError(`Another convert runner is active for ${resolvedRoot}`);
  }
  activeRoots.add(resolvedRoot);
  let acquiredLock: RunLock | undefined;

  let devServer: DevServer | undefined;

  try {
    const { lock, stale } = await acquireRunLock(resolvedRoot);
    acquiredLock = lock;
    const state = await loadState(resolvedRoot);
    if (!state) {
      throw new Error(`No convert state found at ${resolvedRoot}`);
    }

    if (stale) {
      state.run.reason = 'crash';
      await saveState(state);
    }

    await recoverInterrupted(resolvedRoot, state);
    await saveState(state);

    const ctx: StageContext = {
      state,
      exportDir: state.exportDir,
      nextDir: resolvedRoot,
      log: () => {},
    };

    const manifestReader = deps?.manifest ?? readManifest;
    let manifest = await manifestReader(resolvedRoot).catch(() => null);
    if (!manifest) {
      manifest = await manifestFallback(ctx).catch(() => null);
    }
    if (manifest) {
      await renderTaskFiles(ctx, manifest);
    }

    const devServerFn = deps?.devServer ?? ensureDevServer;
    devServer = await devServerFn(resolvedRoot);
    await lock.setDevServer(devServer.pid);

    setInterruptHandler(() => {
      io.pause.request('now');
    });

    while (true) {
      const currentAgent: AgentId = state.options?.agent ?? 'agy';
      const poolDeps: PoolDeps = {
        lock,
        onEvent: (e) => io.onEvent(e),
        check: deps?.check ?? ((taskId, smoke) => defaultCheck(resolvedRoot, devServer!.url, taskId, smoke)),
        spawn:
          deps?.spawn ??
          ((task, prompt, timeoutMs, logFile, onLine) =>
            defaultSpawn(resolvedRoot, state.options?.agent ?? currentAgent, prompt, timeoutMs, logFile, onLine)),
        ...(deps?.now ? { now: deps.now } : {}),
      };

      const result = await runQueue(ctx, poolDeps, io.pause);

      if (result.stoppedFor === 'quota') {
        const hit = result.quota ?? { line: 'Quota exceeded' };
        const otherAgent: AgentId = currentAgent === 'agy' ? 'claude' : 'agy';
        const detect = deps?.detectAgents ?? detectAgents;
        const available: AgentId[] = await detect().catch(() => []);
        const other: AgentId | null =
          available.length === 0 ? otherAgent : available.includes(otherAgent) ? otherAgent : null;

        const decision = await io.onQuota(hit, other);
        if (decision === 'switch') {
          const targetAgent = other ?? otherAgent;
          state.options = {
            ...(state.options ?? DEFAULT_OPTIONS),
            agent: targetAgent,
          };
          await saveState(state);
          continue;
        }

        // stay
        state.run = {
          status: 'paused',
          reason: 'quota',
          ...(hit.resetHint ? { quotaResetHint: hit.resetHint } : {}),
          pausedAt: new Date().toISOString(),
        };
        await saveState(state);
        return {
          status: 'paused',
          reason: 'quota',
          ...(hit.resetHint ? { quotaResetHint: hit.resetHint } : {}),
        };
      }

      if (result.stoppedFor === 'paused') {
        state.run = {
          status: 'paused',
          reason: 'user',
          pausedAt: new Date().toISOString(),
        };
        await saveState(state);
        return {
          status: 'paused',
          reason: 'user',
        };
      }

      // stoppedFor === 'done'
      const finalizeFn =
        deps?.finalize ??
        ((stageCtx) => runFinalize(stageCtx, defaultFinalizeDeps(resolvedRoot, devServer!.url, stageCtx)));
      const finResult = await finalizeFn(ctx);
      state.run = {
        status: 'done',
      };
      await saveState(state);
      return {
        status: 'done',
        ...(finResult.report ? { report: finResult.report } : {}),
      };
    }
  } finally {
    setInterruptHandler(null);
    if (devServer) {
      await acquiredLock?.setDevServer(null).catch(() => {});
      await devServer.stop().catch(() => {});
    }
    await acquiredLock?.release().catch(() => {});
    activeRoots.delete(resolvedRoot);
  }
}
