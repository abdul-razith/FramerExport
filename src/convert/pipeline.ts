import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { framerAdapter } from './adapters/framer/index.js';
import type { StageContext } from './adapters/types.js';
import { runAnalyze } from './stages/analyze.js';
import { runExtractCms } from './stages/extract-cms.js';
import { runScaffold } from './stages/scaffold/index.js';
import { runInstall } from './stages/install.js';
import { runGenerate } from './generate/index.js';
import { runTasks } from './stages/tasks.js';
import { runBaseline } from './verify/baseline.js';
import { ensureDevServer, type DevServer } from './verify/dev-server.js';
import { addTime, formatTimeSummary } from './progress.js';
import { DEFAULT_OPTIONS, initState, loadState, nextStage, saveState } from './state.js';
import { CLI_INVOCATION } from './tasks/templates/index.js';
import type { AnimationEntry, ConvertState, RunOptions, TaskRecord } from './types.js';

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

const KIND_ORDER: Record<TaskRecord['kind'], number> = { fix: 0, shell: 1, section: 2, page: 3 };

/**
 * First actionable task: fix tasks, then components, pages and motion, by id within a kind. The `build`
 * record only counts build failures (its fix-build-<n> tasks are the actionable ones).
 */
export function pickNextTask(state: ConvertState): TaskRecord | undefined {
  return Object.values(state.tasks)
    .filter((t) => t.id !== 'build' && (t.status === 'pending' || t.status === 'in-progress'))
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.id.localeCompare(b.id))[0];
}

export async function runPipeline(
  exportDir: string,
  nextDir: string,
  io: ConvertIo,
  options?: RunOptions,
  deps?: {
    install?: typeof runInstall;
    devServer?: (root: string) => Promise<DevServer>;
  }
): Promise<ConvertState> {
  exportDir = path.resolve(exportDir);
  nextDir = path.resolve(nextDir);
  const platform = await readPlatform(exportDir);
  if (platform !== 'framer') {
    throw new Error(`Only Framer exports are supported in this version (found: ${platform})`);
  }
  await mkdir(nextDir, { recursive: true });
  const state = (await loadState(nextDir)) ?? initState(exportDir, nextDir);

  const isLegacyCall = options === undefined;
  const defaultOpts: RunOptions = { ...DEFAULT_OPTIONS, agent: 'agy' };
  const resolvedOptions: RunOptions = options
    ? { ...defaultOpts, ...options }
    : (state.options ?? defaultOpts);
  state.options = resolvedOptions;
  await saveState(state);

  const ctx: StageContext = { state, exportDir: state.exportDir, nextDir, log: io.log };

  for (let stage = nextStage(state); stage && stage !== 'finalize'; stage = nextStage(state)) {
    io.log(`Running ${stage}...`);
    const stageStart = Date.now();
    if (stage === 'analyze') {
      await runAnalyze(ctx, framerAdapter);
    } else if (stage === 'extract-cms') {
      await runExtractCms(ctx);
    } else if (stage === 'scaffold') {
      await runScaffold(ctx, { confirmOverwrite: (file) => io.confirm('Overwrite edited file ' + file + '?') });
    } else if (stage === 'install') {
      if (isLegacyCall) {
        state.stages.install = 'skipped';
      } else {
        const installFn = deps?.install ?? runInstall;
        await installFn(ctx);
        if (state.stages.install === 'failed') {
          addTime(state, 'setup', Date.now() - stageStart);
          await saveState(state);
          break;
        }
      }
    } else if (stage === 'generate') {
      if (isLegacyCall) {
        state.stages.generate = 'skipped';
      } else {
        await runGenerate(ctx);
      }
    } else if (stage === 'tasks') {
      await runTasks(ctx);
    } else if (stage === 'baseline') {
      if (!isLegacyCall && resolvedOptions.testing) {
        const devServerFn = deps?.devServer ?? ensureDevServer;
        const devServer = await devServerFn(nextDir);
        try {
          await runBaseline(ctx, devServer.url);
        } finally {
          await devServer.stop().catch(() => {});
        }
      } else {
        state.stages.baseline = 'skipped';
      }
    }
    addTime(state, 'setup', Date.now() - stageStart);
    await saveState(state);
  }
  const first = pickNextTask(state);
  if (first) {
    io.log(
      [
        '',
        'Next steps:',
        `  1. Install dependencies: cd "${nextDir}" && npm install`,
        `  2. Give your AI coding agent the first task: ${path.join(nextDir, first.file)}`,
        `  3. Then verify it: ${CLI_INVOCATION} verify ${first.id}`,
      ].join('\n')
    );
  }
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
  if (state.timing || tasks.some((t) => t.kind === 'page' && t.sections?.length)) {
    lines.push('', 'Progress', ...formatTimeSummary(state).split('\n').map((l) => (l ? '  ' + l : l)));
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
