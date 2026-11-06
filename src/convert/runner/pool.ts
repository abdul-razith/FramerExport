import path from 'node:path';
import type { StageContext } from '../adapters/types.js';
import { saveState } from '../state.js';
import { addTime } from '../progress.js';
import type { TaskRecord } from '../types.js';
import type { AgentHandle, QuotaHit } from './agent-process.js';
import { buildAgentPrompt } from './prompt.js';
import { snapshotTree, revertOutOfScope } from './scope.js';
import { saveTaskSnapshot, recoverTask } from './interrupt.js';
import { resetCheckCalls, type CheckResult } from '../verify/check.js';
import type { RunLock } from './lock.js';
import { readyTasks } from './ready.js';
import { writeFixTask } from './fix.js';

export interface PauseController {
  readonly mode: 'none' | 'after-running' | 'now';
  request(mode: 'after-running' | 'now'): void;
}

class PauseControllerImpl implements PauseController {
  private _mode: 'none' | 'after-running' | 'now' = 'none';
  private _listeners: Array<(mode: 'after-running' | 'now') => void> = [];

  get mode(): 'none' | 'after-running' | 'now' {
    return this._mode;
  }

  request(mode: 'after-running' | 'now'): void {
    this._mode = mode;
    for (const fn of this._listeners) {
      try {
        fn(mode);
      } catch {}
    }
  }

  _subscribe(fn: (mode: 'after-running' | 'now') => void): () => void {
    this._listeners.push(fn);
    return () => {
      this._listeners = this._listeners.filter((l) => l !== fn);
    };
  }
}

export function createPauseController(): PauseController {
  return new PauseControllerImpl();
}

export type PoolEvent =
  | { type: 'start'; worker: number; task: TaskRecord }
  | { type: 'line'; worker: number; taskId: string; line: string }
  | {
      type: 'end';
      worker: number;
      taskId: string;
      outcome: 'done' | 'fix' | 'needs-review' | 'interrupted';
      ms: number;
    }
  | { type: 'reverted'; taskId: string; files: string[] }
  | { type: 'page-complete'; route: string; taskId: string; status: 'done' | 'needs-review' }
  | { type: 'quota'; hit: QuotaHit }
  | { type: 'agent-error'; taskId: string; message: string }
  | { type: 'task-error'; taskId: string; message: string };

export interface PoolDeps {
  spawn(
    task: TaskRecord,
    prompt: string,
    timeoutMs: number,
    logFile: string,
    onLine: (l: string) => void
  ): AgentHandle;
  check(taskId: string, smoke: boolean): Promise<CheckResult>;
  lock: RunLock;
  onEvent?: (e: PoolEvent) => void;
  now?: () => number;
}

/**
 * Runs the ready tasks using a pool of workers up to `state.options.concurrency`.
 */
export async function runQueue(
  ctx: StageContext,
  deps: PoolDeps,
  pause: PauseController
): Promise<{
  stoppedFor: 'done' | 'paused' | 'quota' | 'agent-error' | 'task-error' | 'page-review';
  quota?: QuotaHit;
  /** Set with `page-review`: the page that was just finished. */
  page?: { route: string; taskId: string };
  error?: string;
  ran: string[];
}> {
  const concurrency = ctx.state.options?.concurrency ?? 1;
  const running = new Set<string>();
  const runningTasks = new Map<string, TaskRecord>();
  const runningHandles = new Map<string, AgentHandle>();
  const availableWorkers: number[] = Array.from({ length: concurrency }, (_, i) => i);
  const activePromises = new Set<Promise<void>>();
  const ran: string[] = [];
  // Every task that has started in this run, in start order. A finishing task keeps the
  // targets of all tasks that overlapped its lifetime (running at its start or started later).
  const startLog: Array<{ id: string; seq: number; targets: string[] }> = [];
  let nextSeq = 0;

  let quotaHit: QuotaHit | undefined;
  // Set when a page finishes while pageMode is `pause`: nothing new is dispatched after that.
  let pageReview: { route: string; taskId: string } | undefined;
  let spawnFailure: string | undefined;
  let internalError: string | undefined;
  // Tasks whose execution threw: not re-dispatched in this run (they would fail the same way).
  const failedIds = new Set<string>();
  let wakeUp: (() => void) | null = null;

  let stateSaveQueue = Promise.resolve();
  function safeSaveState(): Promise<void> {
    stateSaveQueue = stateSaveQueue
      .then(() => saveState(ctx.state))
      .catch((err) => {
        internalError ??= `could not save state: ${err instanceof Error ? err.message : String(err)}`;
      });
    return stateSaveQueue;
  }

  function trigger() {
    if (wakeUp) {
      const fn = wakeUp;
      wakeUp = null;
      fn();
    }
  }

  const unsubscribe = (pause as any)._subscribe?.((mode: 'after-running' | 'now') => {
    if (mode === 'now') {
      for (const handle of runningHandles.values()) {
        handle.kill().catch(() => {});
      }
    }
    trigger();
  });

  const getTime = deps.now ?? (() => Date.now());

  async function executeTask(
    worker: number,
    task: TaskRecord,
    mySeq: number,
    runningAtStart: Set<string>
  ): Promise<void> {
    const startMs = getTime();
    deps.onEvent?.({ type: 'start', worker, task });

    // 1. in-progress & saveState
    task.status = 'in-progress';
    await safeSaveState();

    // 2. saveTaskSnapshot
    await saveTaskSnapshot(ctx.nextDir, task);

    // 3. resetCheckCalls
    await resetCheckCalls(ctx.nextDir, task.id);

    // 4. snapshotTree
    const before = await snapshotTree(ctx.nextDir);

    // 5. buildAgentPrompt
    const prompt = buildAgentPrompt(task);

    // Resolve timeout:
    // Section tasks use sectionTimeoutMin * 60_000
    // Shell and page tasks use pageTimeoutMin * 60_000
    // Fix tasks use the limit of their fixOf task
    let timeoutMin = 15;
    if (task.kind === 'section') {
      timeoutMin = ctx.state.options?.sectionTimeoutMin ?? 15;
    } else if (task.kind === 'shell' || task.kind === 'page') {
      timeoutMin = ctx.state.options?.pageTimeoutMin ?? 15;
    } else if (task.kind === 'fix' && task.fixOf) {
      const parent = ctx.state.tasks[task.fixOf];
      if (parent?.kind === 'section') {
        timeoutMin = ctx.state.options?.sectionTimeoutMin ?? 15;
      } else {
        timeoutMin = ctx.state.options?.pageTimeoutMin ?? 15;
      }
    } else {
      timeoutMin = ctx.state.options?.pageTimeoutMin ?? 15;
    }
    const timeoutMs = timeoutMin * 60_000;

    const logFile = path.join(ctx.nextDir, '.convert', 'logs', `${task.id}.log`);

    // 6. Spawn handle, register pid
    const handle = deps.spawn(task, prompt, timeoutMs, logFile, (line) => {
      deps.onEvent?.({ type: 'line', worker, taskId: task.id, line });
    });
    runningHandles.set(task.id, handle);

    if (handle.pid) {
      await deps.lock.setAgent(task.id, handle.pid);
    }

    if (pause.mode === 'now') {
      await handle.kill().catch(() => {});
    }

    // 7. Await handle.done
    let exit;
    try {
      exit = await handle.done;
    } finally {
      runningHandles.delete(task.id);
    }

    const endMs = getTime();
    const elapsedMs = Math.max(0, endMs - startMs);

    // Case A: pause.mode === 'now'
    if (pause.mode === 'now') {
      await recoverTask(ctx.nextDir, task);
      deps.onEvent?.({
        type: 'end',
        worker,
        taskId: task.id,
        outcome: 'interrupted',
        ms: elapsedMs,
      });
      await deps.lock.setAgent(task.id, null);
      await safeSaveState();
      return;
    }

    // Case S: the agent could not be started at all. Not a task failure: put the task back and stop the run.
    if (exit.spawnError) {
      spawnFailure = exit.spawnError;
      await recoverTask(ctx.nextDir, task);
      deps.onEvent?.({ type: 'agent-error', taskId: task.id, message: exit.spawnError });
      await deps.lock.setAgent(task.id, null);
      await safeSaveState();
      return;
    }

    // Case B: exit has quota. A clean exit (code 0) that merely printed a matching line is finished work.
    if (exit.quota && exit.exitCode !== 0) {
      quotaHit = exit.quota;
      await recoverTask(ctx.nextDir, task);
      deps.onEvent?.({ type: 'quota', hit: exit.quota });
      await deps.lock.setAgent(task.id, null);
      await safeSaveState();
      return;
    }

    // Case C: Normal / Timeout exit
    const allowedSet = new Set<string>(task.targets || []);
    for (const entry of startLog) {
      if (entry.id === task.id) continue;
      if (entry.seq > mySeq || runningAtStart.has(entry.id)) {
        for (const t of entry.targets) allowedSet.add(t);
      }
    }
    // Task and fix-task files are pool bookkeeping and are never reverted or deleted.
    allowedSet.add('.convert/tasks/');
    const allowed = Array.from(allowedSet);
    const reverted = await revertOutOfScope(ctx.nextDir, before, allowed);
    if (reverted.length > 0) {
      deps.onEvent?.({ type: 'reverted', taskId: task.id, files: reverted });
    }

    // Run check
    const smoke = ctx.state.options?.testing === false;
    const res = await deps.check(task.id, smoke);

    let outcome: 'done' | 'fix' | 'needs-review';

    if (res.pass) {
      task.status = 'done';
      if (task.kind === 'fix' && task.fixOf) {
        const original = ctx.state.tasks[task.fixOf];
        if (original) original.status = 'done';
      }
      outcome = 'done';
    } else {
      // Check failed
      const testingOn = ctx.state.options?.testing !== false;
      if (testingOn && task.kind !== 'fix') {
        task.attempts = (task.attempts || 0) + 1;
        task.status = 'awaiting-fix';
        await writeFixTask(ctx, task, res);
        outcome = 'fix';
      } else {
        task.status = 'needs-review';
        if (task.kind === 'fix' && task.fixOf) {
          const original = ctx.state.tasks[task.fixOf];
          if (original) original.status = 'needs-review';
        }
        outcome = 'needs-review';
      }
    }

    addTime(ctx.state, task.id, elapsedMs);
    await deps.lock.setAgent(task.id, null);
    await safeSaveState();

    deps.onEvent?.({ type: 'end', worker, taskId: task.id, outcome, ms: elapsedMs });

    // A page is finished when its page task (or the fix task for it) ends done or needs-review.
    const pageTask = task.kind === 'page' ? task : task.fixOf ? ctx.state.tasks[task.fixOf] : undefined;
    if (pageTask?.kind === 'page' && (pageTask.status === 'done' || pageTask.status === 'needs-review')) {
      const route = pageTask.route ?? '/';
      deps.onEvent?.({ type: 'page-complete', route, taskId: pageTask.id, status: pageTask.status });
      // No pause after the last page: finalize and the report come next.
      const morePages = Object.values(ctx.state.tasks).some(
        (t) => t.kind === 'page' && t.id !== pageTask.id && t.status !== 'done' && t.status !== 'needs-review'
      );
      if (ctx.state.options?.pageMode === 'pause' && morePages) pageReview ??= { route, taskId: pageTask.id };
    }
  }

  try {
    while (true) {
      // 1. If pause now: stop immediately
      if (pause.mode === 'now') {
        break;
      }

      // 2. If quota hit or the agent cannot start: stop dispatching
      if (quotaHit || spawnFailure || internalError) {
        break;
      }

      // 2b. A page finished and pageMode is pause: stop dispatching so the page can be reviewed
      if (pageReview) {
        break;
      }

      // 3. If pause after-running: stop dispatching
      if (pause.mode === 'after-running') {
        break;
      }

      // 4. Try dispatching tasks to available workers
      if (availableWorkers.length > 0) {
        const ready = readyTasks(ctx.state, running);
        const nextTask = ready.find((t) => !running.has(t.id) && !failedIds.has(t.id));
        if (nextTask) {
          const worker = availableWorkers.shift()!;
          const runningAtStart = new Set(running);
          const mySeq = nextSeq++;
          startLog.push({ id: nextTask.id, seq: mySeq, targets: nextTask.targets || [] });
          running.add(nextTask.id);
          runningTasks.set(nextTask.id, nextTask);
          ran.push(nextTask.id);

          const taskPromise = executeTask(worker, nextTask, mySeq, runningAtStart)
            .catch(async (err) => {
              // An unexpected failure must not look like a finished task: put it back to pending
              // (progress is recovered on the next start), surface it, and stop the run.
              const message = err instanceof Error ? err.message : String(err);
              ctx.log(`Task ${nextTask.id} error: ${message}`);
              failedIds.add(nextTask.id);
              internalError ??= `task ${nextTask.id} failed: ${message}`;
              nextTask.status = 'pending';
              deps.onEvent?.({ type: 'task-error', taskId: nextTask.id, message });
              await deps.lock.setAgent(nextTask.id, null).catch(() => {});
              await safeSaveState();
            })
            .finally(() => {
              running.delete(nextTask.id);
              runningTasks.delete(nextTask.id);
              availableWorkers.push(worker);
              availableWorkers.sort((a, b) => a - b);
              trigger();
            });

          activePromises.add(taskPromise);
          taskPromise.finally(() => {
            activePromises.delete(taskPromise);
          });

          // Continue in same tick to assign other available workers
          continue;
        }
      }

      // If no tasks are running and no more ready tasks: done!
      if (running.size === 0) {
        break;
      }

      // Wait for a running task to complete or pause/quota to fire
      await new Promise<void>((resolve) => {
        wakeUp = resolve;
      });
    }

    // Wait for all remaining active promises to complete
    if (activePromises.size > 0) {
      await Promise.all(Array.from(activePromises));
    }
    await stateSaveQueue;
  } finally {
    unsubscribe?.();
  }

  if (internalError && !spawnFailure) {
    return { stoppedFor: 'task-error', error: internalError, ran };
  }
  if (spawnFailure) {
    return { stoppedFor: 'agent-error', error: spawnFailure, ran };
  }
  if (quotaHit) {
    return { stoppedFor: 'quota', quota: quotaHit, ran };
  }
  if (pageReview) {
    return { stoppedFor: 'page-review', page: pageReview, ran };
  }
  if (pause.mode !== 'none') {
    return { stoppedFor: 'paused', ran };
  }
  return { stoppedFor: 'done', ran };
}
