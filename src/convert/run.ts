import path from 'node:path';
import type { StageContext } from './adapters/types.js';
import { readManifest, type GeneratedManifest } from './generate/manifest.js';
import {
  agentCommand,
  defaultAgent,
  detectAgents,
  resolveAgentBinary,
  spawnAgent,
  type AgentHandle,
  type AgentId,
  type QuotaHit,
} from './runner/agent-process.js';
import { createPauseInput } from './runner/pause-input.js';
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
import { hasInterruptHandler, npmCommand, setInterruptHandler, spawnManaged } from './verify/proc.js';
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
  resolveAgentBinary?: (agent: AgentId) => Promise<string | null>;
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
  binary: string | null,
  prompt: string,
  timeoutMs: number,
  logFile: string,
  onLine: (line: string) => void
): AgentHandle {
  const { command, args } = agentCommand(agent, prompt, binary);
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
  let installedInterruptHandler = false;

  try {
    const { lock, stale } = await acquireRunLock(resolvedRoot);
    acquiredLock = lock;
    const state = await loadState(resolvedRoot);
    if (!state) {
      throw new Error(`No convert state found at ${resolvedRoot}`);
    }

    if (state.legacyTasks) {
      throw new Error(
        'This project uses the old task model and cannot run the section refactor loop. ' +
          'Re-convert it: open "fexport convert ui" and choose "Re-convert legacy project".'
      );
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

    // The caller owns Ctrl+C when it installed a handler; otherwise use the no-prompt default
    // (first Ctrl+C finishes running tasks then pauses, second pauses now).
    if (!hasInterruptHandler()) {
      const input = createPauseInput(io.pause, { log: (m) => console.log(m) });
      setInterruptHandler(() => input.interrupt());
      installedInterruptHandler = true;
    }

    // Visible to `status` / the UI while agents work; every exit below sets paused or done.
    state.run = { status: 'running' };
    await saveState(state);

    let finalizeRounds = 0;
    while (true) {
      const detect = deps?.detectAgents ?? detectAgents;
      const currentAgent: AgentId = state.options?.agent ?? (await defaultAgent(detect));
      // Launch the resolved binary path (an npm .cmd shim is not found by bare name), and refuse to start
      // when the agent is not installed instead of burning every task on a spawn error.
      let agentBinary: string | null = null;
      if (!deps?.spawn && !process.env.FEXPORT_AGENT_CMD) {
        agentBinary = await (deps?.resolveAgentBinary ?? resolveAgentBinary)(currentAgent);
        if (!agentBinary) {
          throw new Error(
            `Agent "${currentAgent}" was not found on PATH. Install it or pick another agent (--agent agy|claude).`
          );
        }
      }
      const poolDeps: PoolDeps = {
        lock,
        onEvent: (e) => io.onEvent(e),
        check: deps?.check ?? ((taskId, smoke) => defaultCheck(resolvedRoot, devServer!.url, taskId, smoke)),
        spawn:
          deps?.spawn ??
          ((task, prompt, timeoutMs, logFile, onLine) =>
            defaultSpawn(resolvedRoot, currentAgent, agentBinary, prompt, timeoutMs, logFile, onLine)),
        ...(deps?.now ? { now: deps.now } : {}),
      };

      const result = await runQueue(ctx, poolDeps, io.pause);

      if (result.stoppedFor === 'agent-error') {
        state.run = { status: 'paused', reason: 'user', pausedAt: new Date().toISOString() };
        await saveState(state);
        throw new Error(
          `Could not start agent "${currentAgent}": ${result.error ?? 'unknown error'}. ` +
            'Check that it is installed and on PATH, or pick another agent (--agent agy|claude).'
        );
      }

      if (result.stoppedFor === 'task-error') {
        state.run = { status: 'paused', reason: 'crash', pausedAt: new Date().toISOString() };
        await saveState(state);
        throw new Error(`The run stopped on an internal error: ${result.error ?? 'unknown'}. Run it again to continue.`);
      }

      if (result.stoppedFor === 'quota') {
        const hit = result.quota ?? { line: 'Quota exceeded' };
        const otherAgent: AgentId = currentAgent === 'agy' ? 'claude' : 'agy';
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

      // stoppedFor === 'done': never finalize with unfinished work.
      const unfinished = Object.values(state.tasks).filter(
        (t) => t.status === 'pending' || t.status === 'in-progress' || t.status === 'awaiting-fix'
      );
      if (unfinished.length > 0) {
        state.run = { status: 'paused', reason: 'crash', pausedAt: new Date().toISOString() };
        await saveState(state);
        throw new Error(
          `The run ended with unfinished tasks: ${unfinished.map((t) => `${t.id} (${t.status})`).join(', ')}. ` +
            'Run it again to continue.'
        );
      }
      const finalizeFn =
        deps?.finalize ??
        ((stageCtx) => runFinalize(stageCtx, defaultFinalizeDeps(resolvedRoot, devServer!.url, stageCtx)));
      const finResult = await finalizeFn(ctx);
      // A failed production build leaves a pending fix-build task: run it through the pool and finalize
      // again (finalize itself gives up after two failures).
      if (!finResult.buildOk && state.tasks['fix-build']?.status === 'pending' && finalizeRounds < 2) {
        finalizeRounds++;
        continue;
      }
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
    if (installedInterruptHandler) setInterruptHandler(null);
    if (devServer) {
      await acquiredLock?.setDevServer(null).catch(() => {});
      await devServer.stop().catch(() => {});
    }
    await acquiredLock?.release().catch(() => {});
    activeRoots.delete(resolvedRoot);
  }
}
