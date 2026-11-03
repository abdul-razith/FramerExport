import path from 'node:path';
import chalk from 'chalk';
import { pickNextTask } from '../../convert/pipeline.js';
import type { ConvertState, PageInfo, StageName, TaskRecord } from '../../convert/types.js';

export const STAGE_LABELS: Record<StageName, string> = {
  analyze: 'Stage 1/5: Analyze export',
  'extract-cms': 'Stage 2/5: Extract CMS',
  scaffold: 'Stage 3/5: Scaffold Next.js project',
  tasks: 'Stage 4/5: Write AI task files',
  verify: 'Stage 5/5: Verify against export',
};

export type DashboardAction = 'status' | 'next' | 'install' | 'generate' | 'verify' | 'agent' | 'done' | 'refresh' | 'exit';

export interface Choice<T> {
  label: string;
  value: T;
  hint?: string;
}

/** Maps the pipeline's "Running <stage>..." log line to its stage. */
export function stageFromLog(msg: string): StageName | null {
  const m = /^Running (analyze|extract-cms|scaffold|tasks|verify)\.\.\.$/.exec(msg.trim());
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

/** A fix task resolves to the task it fixes (`fix-<id>-<n>`); other tasks resolve to themselves. */
function originalOf(state: ConvertState, t: TaskRecord): TaskRecord | undefined {
  if (t.kind !== 'fix') return t;
  return state.tasks[t.id.replace(/^fix-/, '').replace(/-\d+$/, '')];
}

export function getMotionChoices(state: ConvertState): Choice<string>[] {
  return Object.values(state.tasks)
    .filter((t) => t.status !== 'done' && originalOf(state, t)?.kind === 'motion')
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((t) => ({ label: t.id, value: t.id, hint: t.route }));
}

export function getDashboardChoices(state: ConvertState, hasNodeModules: boolean): Choice<DashboardAction>[] {
  const choices: Choice<DashboardAction>[] = [];
  if (!hasNodeModules) choices.push({ label: 'Install dependencies', value: 'install', hint: 'required before verify' });
  choices.push(
    { label: 'Generate pages & components automatically', value: 'generate', hint: 'fast, no AI' },
    { label: 'Inspect next task', value: 'next' },
    { label: 'Run AI agent', value: 'agent', hint: 'agy or claude, optional' },
    { label: 'Run verification', value: 'verify', hint: 'Stage 5/5' },
    { label: 'View status & task backlog', value: 'status' }
  );
  if (getMotionChoices(state).length > 0) choices.push({ label: 'Mark motion task done', value: 'done' });
  choices.push({ label: 'Refresh', value: 'refresh' }, { label: 'Exit', value: 'exit' });
  return choices;
}

export function getVerifyTargetChoices(state: ConvertState, pages: PageInfo[]): Choice<string | undefined>[] {
  const choices: Choice<string | undefined>[] = [];
  const next = pickNextTask(state);
  if (next) choices.push({ label: `Next pending task (${next.id})`, value: next.id });
  choices.push({ label: 'All outstanding tasks', value: undefined });
  for (const t of Object.values(state.tasks)
    .filter((x) => x.id !== 'build' && (x.status === 'pending' || x.status === 'in-progress'))
    .sort((a, b) => a.id.localeCompare(b.id))) {
    choices.push({ label: t.id, value: t.id, hint: t.kind });
  }
  for (const p of pages) choices.push({ label: p.route, value: p.route, hint: 'page route' });
  return choices;
}

export function formatVerifyResult(r: { passed: string[]; failed: string[] }, root: string): string {
  const lines = [
    `${chalk.green('✔')} Passed: ${r.passed.length}`,
    `${chalk.red('✖')} Failed: ${r.failed.length}`,
    ...r.failed.map((id) => `    ${id}`),
    `Report: ${path.join(root, '.convert', 'diffs', 'report.json')}`,
  ];
  return lines.join('\n');
}

export function formatVerifyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.startsWith('Dependencies not installed') ? `${msg}\nChoose "Install dependencies" from the menu.` : msg;
}
