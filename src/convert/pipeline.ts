import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { framerAdapter } from './adapters/framer/index.js';
import type { StageContext } from './adapters/types.js';
import { runAnalyze } from './stages/analyze.js';
import { runExtractCms } from './stages/extract-cms.js';
import { runScaffold } from './stages/scaffold/index.js';
import { runTasks } from './stages/tasks.js';
import { initState, loadState, nextStage, saveState } from './state.js';
import type { AnimationEntry, ConvertState, TaskRecord } from './types.js';

export interface ConvertIo {
  confirm(msg: string): Promise<boolean>;
  log(msg: string): void;
}

async function readPlatform(exportDir: string): Promise<string> {
  try {
    const report = JSON.parse(await readFile(path.join(exportDir, 'export-report.json'), 'utf8')) as {
      platform?: unknown;
    };
    return typeof report.platform === 'string' ? report.platform : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** First actionable task by id, preferring fix-* tasks. */
export function pickNextTask(state: ConvertState): TaskRecord | undefined {
  const open = Object.values(state.tasks)
    .filter((t) => t.status === 'pending' || t.status === 'in-progress')
    .sort((a, b) => a.id.localeCompare(b.id));
  return open.find((t) => t.id.startsWith('fix-')) ?? open[0];
}

export async function runPipeline(exportDir: string, nextDir: string, io: ConvertIo): Promise<ConvertState> {
  exportDir = path.resolve(exportDir);
  nextDir = path.resolve(nextDir);
  const platform = await readPlatform(exportDir);
  if (platform !== 'framer') {
    throw new Error(`Only Framer exports are supported in this version (found: ${platform})`);
  }
  await mkdir(nextDir, { recursive: true });
  const state = (await loadState(nextDir)) ?? initState(exportDir, nextDir);
  await saveState(state);
  const ctx: StageContext = { state, exportDir: state.exportDir, nextDir, log: io.log };

  // tasks ends in 'needs-ai' (never 'done'), so stop once it has run; verify is never automatic.
  for (let stage = nextStage(state); stage && stage !== 'verify'; stage = nextStage(state)) {
    if (stage === 'tasks' && state.stages.tasks === 'needs-ai') break;
    io.log(`Running ${stage}...`);
    if (stage === 'analyze') await runAnalyze(ctx, framerAdapter);
    else if (stage === 'extract-cms') await runExtractCms(ctx);
    else if (stage === 'scaffold') {
      await runScaffold(ctx, { confirmOverwrite: (file) => io.confirm('Overwrite edited file ' + file + '?') });
    } else if (stage === 'tasks') await runTasks(ctx);
    await saveState(state);
  }
  const first = pickNextTask(state);
  if (first) io.log(`Next task: ${path.join(nextDir, first.file)}`);
  return state;
}

export function formatStatus(state: ConvertState, animations: AnimationEntry[] = []): string {
  const lines: string[] = ['Stages'];
  for (const [name, status] of Object.entries(state.stages)) lines.push(`  ${name.padEnd(12)} ${status}`);
  const tasks = Object.values(state.tasks);
  const counts: Record<string, number> = {};
  for (const t of tasks) counts[t.status] = (counts[t.status] ?? 0) + 1;
  lines.push(
    '',
    'Tasks: ' +
      (tasks.length
        ? Object.entries(counts)
            .map(([k, v]) => `${k} ${v}`)
            .join(', ')
        : 'none')
  );
  for (const t of tasks.filter((x) => x.status !== 'done').sort((a, b) => a.id.localeCompare(b.id))) {
    lines.push(`  ${t.id}  ${t.status}  attempts ${t.attempts}`);
  }
  if (state.warnings.length) {
    lines.push('', 'Warnings');
    for (const w of state.warnings.slice(-20)) lines.push(`  - ${w}`);
  }
  if (animations.length) {
    lines.push('', 'Motion checklist (check manually)');
    const byRoute = new Map<string, AnimationEntry[]>();
    for (const a of animations) byRoute.set(a.route, [...(byRoute.get(a.route) ?? []), a]);
    for (const [route, list] of byRoute) {
      lines.push(`  ${route}`);
      for (const a of list) lines.push(`    - ${a.trigger}  ${a.selector}`);
    }
  }
  return lines.join('\n');
}
