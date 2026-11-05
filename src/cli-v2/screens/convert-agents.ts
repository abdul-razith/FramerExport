import type { PoolEvent } from '../../convert/runner/pool.js';
import type { AgentId } from '../../convert/runner/agent-process.js';
import { createPauseController } from '../../convert/runner/pool.js';
import { runAgents, type RunDeps, type RunIo, type RunOutcome } from '../../convert/run.js';
import { loadState } from '../../convert/state.js';
import { formatWorkerLine } from '../../convert/progress.js';
import { setInterruptHandler } from '../../convert/verify/proc.js';
import { uiIntro, uiNote, uiSelect } from '../ui/prompts.js';

interface WorkerState {
  worker: number;
  route: string;
  section: string;
  agent: AgentId;
  startTime: number;
  lastLine: string;
}

export async function runScreenConvertAgents(
  root: string,
  deps?: RunDeps
): Promise<RunOutcome> {
  const state = await loadState(root);
  if (!state) {
    throw new Error(`No convert state found at ${root}`);
  }

  uiIntro('FramerExport v2 · Multi-Worker AI Agents');
  const agentId: AgentId = state.options?.agent ?? 'agy';
  const concurrency = state.options?.concurrency ?? 1;

  uiNote(
    [
      `Project:      ${root}`,
      `Agent:        ${agentId}`,
      `Concurrency:  ${concurrency} worker(s)`,
      'Controls:     Press [P] or Ctrl+C to pause',
    ].join('\n'),
    'Live Agent Execution'
  );

  const pause = createPauseController();
  const workers = new Map<number, WorkerState>();
  let prompting = false;

  const promptPause = async () => {
    if (prompting) return;
    prompting = true;
    try {
      const choice = await uiSelect<'after-running' | 'now'>('Pause conversion:', [
        { label: 'Finish running tasks, then pause', value: 'after-running' },
        { label: 'Pause now', value: 'now' },
      ]);
      pause.request(choice);
    } finally {
      prompting = false;
    }
  };

  const isTTY = Boolean(process.stdin.isTTY);
  const onKey = (data: Buffer) => {
    const key = data.toString('utf8');
    if (key === 'p' || key === 'P') {
      void promptPause();
    }
  };

  if (isTTY) {
    try {
      process.stdin.setRawMode?.(true);
      process.stdin.resume();
      process.stdin.on('data', onKey);
    } catch {}
  }

  setInterruptHandler(() => {
    void promptPause();
  });

  const io: RunIo = {
    pause,
    onEvent(e: PoolEvent) {
      if (e.type === 'start') {
        const wState: WorkerState = {
          worker: e.worker,
          route: e.task.route || '/',
          section: e.task.section || e.task.id,
          agent: state.options?.agent ?? agentId,
          startTime: Date.now(),
          lastLine: '',
        };
        workers.set(e.worker, wState);
        console.log(
          formatWorkerLine({
            worker: wState.worker,
            route: wState.route,
            section: wState.section,
            agent: wState.agent,
            ms: 0,
            lastLine: 'started',
          })
        );
      } else if (e.type === 'line') {
        const wState = workers.get(e.worker);
        if (wState) {
          wState.lastLine = e.line;
          console.log(
            formatWorkerLine({
              worker: wState.worker,
              route: wState.route,
              section: wState.section,
              agent: wState.agent,
              ms: Date.now() - wState.startTime,
              lastLine: e.line,
            })
          );
        }
      } else if (e.type === 'end') {
        workers.delete(e.worker);
        console.log(`[W${e.worker}] ${e.taskId}: ${e.outcome}`);
      } else if (e.type === 'reverted') {
        console.log(`[W] Reverted ${e.taskId} (${e.files.length} file(s))`);
      } else if (e.type === 'quota') {
        console.log(`[quota] ${e.hit.line}`);
      }
    },
    async onQuota(hit, other) {
      const options: Array<{ label: string; value: 'switch' | 'stay' }> = [];
      if (other) {
        options.push({
          label: `Switch to ${other} and continue`,
          value: 'switch',
        });
      }
      options.push({
        label: 'Stay paused',
        value: 'stay',
      });

      return uiSelect<'switch' | 'stay'>(
        `Agent quota reached: ${hit.line}`,
        options
      );
    },
  };

  try {
    return await runAgents(root, io, deps);
  } finally {
    setInterruptHandler(null);
    if (isTTY) {
      try {
        process.stdin.off('data', onKey);
        process.stdin.setRawMode?.(false);
        process.stdin.pause();
      } catch {}
    }
  }
}
