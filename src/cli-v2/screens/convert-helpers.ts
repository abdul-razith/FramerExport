import { existsSync } from 'node:fs';
import path from 'node:path';
import { pickNextTask } from '../../convert/pipeline.js';
import { formatDuration, startTicker } from '../../convert/progress.js';
import type { ConvertState, StageName } from '../../convert/types.js';

export const STAGE_LABELS: Record<StageName, string> = {
  analyze: 'Stage 1/5: Analyze export',
  'extract-cms': 'Stage 2/5: Extract CMS',
  scaffold: 'Stage 3/5: Scaffold Next.js project',
  install: 'Install dependencies',
  generate: 'Generate components',
  tasks: 'Stage 4/5: Write AI task files',
  baseline: 'Capture baseline screenshots',
  finalize: 'Finalize conversion',
};

export type DashboardAction =
  | 'resume'
  | 'agent'
  | 'report'
  | 'open-report'
  | 'review'
  | 'options'
  | 'status'
  | 'next'
  | 'reconvert'
  | 'refresh'
  | 'exit';

export interface Choice<T> {
  label: string;
  value: T;
  hint?: string;
  selected?: boolean;
}

/** Maps the pipeline's "Running <stage>..." log line to its stage. */
export function stageFromLog(msg: string): StageName | null {
  const m = /^Running (analyze|extract-cms|scaffold|install|generate|tasks|baseline|finalize)\.\.\.$/.exec(msg.trim());
  return m ? (m[1] as StageName) : null;
}

/** Removes the pipeline's "Next steps" block: the dashboard does each of those steps itself. */
export function stripNextSteps(lines: string[]): string[] {
  const out: string[] = [];
  let skipping = false;
  for (const line of lines.flatMap((l) => l.split('\n'))) {
    if (/^Next steps:\s*$/.test(line)) {
      skipping = true;
      continue;
    }
    if (skipping && /^\s*\d+\.\s/.test(line)) continue;
    skipping = false;
    out.push(line);
  }
  return out;
}

export function getDashboardChoices(
  state: ConvertState,
  deps?: { reportExists?: boolean }
): Choice<DashboardAction>[] {
  const choices: Choice<DashboardAction>[] = [];

  const isPaused = state.run?.status === 'paused';
  if (isPaused) {
    choices.push({
      label: 'Resume conversion',
      value: 'resume',
      selected: true,
      hint: 'continue after pause',
    });
  }

  choices.push({
    label: isPaused ? 'Run AI agents (reconfigure)' : 'Run AI agents',
    value: 'agent',
    hint: 'start agent workers',
  });

  choices.push({
    label: 'Generate visual report',
    value: 'report',
    hint: 'capture & diff all pages',
  });

  const reportFile = state.nextDir
    ? path.join(state.nextDir, '.convert', 'report', 'index.html')
    : undefined;
  const reportExists =
    deps?.reportExists !== undefined
      ? deps.reportExists
      : Boolean(reportFile && existsSync(reportFile));

  if (reportExists) {
    choices.push({
      label: 'Open visual report',
      value: 'open-report',
      hint: 'open HTML report in browser',
    });
  }

  const hasNeedsReview = Object.values(state.tasks).some((t) => t.status === 'needs-review');
  if (hasNeedsReview) {
    choices.push({
      label: 'Review tasks',
      value: 'review',
      hint: 'mark needs-review tasks done',
    });
  }

  choices.push(
    { label: 'Run options', value: 'options', hint: 'agent, concurrency, testing' },
    { label: 'View status & task backlog', value: 'status' },
    { label: 'Inspect next task', value: 'next' }
  );

  if (state.legacyTasks) {
    choices.push({
      label: 'Re-convert legacy project',
      value: 'reconvert',
      hint: 'upgrade old project to section refactor pipeline',
    });
  }

  choices.push({ label: 'Refresh', value: 'refresh' }, { label: 'Exit', value: 'exit' });
  return choices;
}

/** Shortens a line to fit the terminal, so a spinner message never wraps. */
export function fitLine(text: string, columns: number = process.stdout.columns || 100): string {
  const max = Math.max(20, columns - 8);
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

/**
 * Keeps a spinner's message fresh while a long step runs: the current text plus a ticking elapsed time.
 * `update` changes the text; `stop` ends the ticker (call it before stopping the spinner).
 */
export function tickingMessage(
  spinner: { message(m: string): void },
  initial: string,
  everyMs = 1000
): { update(msg: string): void; stop(): void } {
  let text = initial;
  const start = Date.now();
  const render = (): void => spinner.message(fitLine(`${text} · ${formatDuration(Date.now() - start)}`));
  const stop = startTicker(render, everyMs);
  return {
    update(msg: string) {
      text = msg;
      render();
    },
    stop,
  };
}
