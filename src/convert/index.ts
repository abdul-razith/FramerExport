import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { framerAdapter } from './adapters/framer/index.js';
import type { StageContext } from './adapters/types.js';
import { formatStatus, pickNextTask, runPipeline, type ConvertIo } from './pipeline.js';
import { DEFAULT_OPTIONS, findProjectRoot, loadState, saveState } from './state.js';
import { CLI_INVOCATION } from './tasks/templates/index.js';
import type { AnimationEntry, ConvertState, RunOptions } from './types.js';
import { defaultAgent, type AgentId } from './runner/agent-process.js';

export { formatStatus, runPipeline } from './pipeline.js';
export type { ConvertIo } from './pipeline.js';

export interface ConvertArgs {
  command:
    | 'convert'
    | 'status'
    | 'next'
    | 'check'
    | 'run'
    | 'report'
    | 'review'
    | 'ui'
    | 'generate';
  exportDir?: string;
  nextDir?: string;
  target?: string;
  taskId?: string;
  smoke?: boolean;
  yes: boolean;
  /** A flag had a missing or invalid value; the command must not run. */
  error?: string;
  testing?: boolean;
  agent?: AgentId;
  concurrency?: 1 | 2 | 3;
}

export const CONVERT_USAGE = `Usage:
  fexport convert <exportDir> [nextDir] [--yes] [--testing on|off] [--agent agy|claude] [--concurrency 1|2|3]
  fexport convert status                          show stages, tasks, warnings and progress
  fexport convert next                            show the next task to give to your AI coding agent
  fexport convert check <taskId> [--smoke]        run checks on a completed task (exit 0/1/2)
  fexport convert run                             headless AI agent runner (Ctrl+C pauses)
  fexport convert report [route]                  visual comparison report against export (alias: verify)
  fexport convert review <taskId>                 mark a needs-review task done
  fexport convert ui                              open the interactive Conversion Dashboard

nextDir defaults to <exportDir>-next. status/next/check/run/report/review run from inside the converted project.`;

/** Accepts argv with or without the leading "convert". */
function parseTesting(v: string): boolean | undefined {
  if (v === 'on' || v === 'true') return true;
  if (v === 'off' || v === 'false') return false;
  return undefined;
}

function badValue(flag: string, value: string | undefined, allowed: string): string {
  return value === undefined ? `${flag} needs a value (${allowed})` : `Invalid value for ${flag}: ${value} (use ${allowed})`;
}

export function parseConvertArgs(argv: string[]): ConvertArgs {
  const sink: { error?: string } = {};
  const parsed = parseConvertArgsInner(argv, sink);
  return sink.error ? { ...parsed, error: sink.error } : parsed;
}

function parseConvertArgsInner(argv: string[], sink: { error?: string }): ConvertArgs {
  const raw = argv[0] === 'convert' ? argv.slice(1) : argv;
  let yes = false;
  let smoke = false;
  let testing: boolean | undefined;
  let agent: AgentId | undefined;
  let concurrency: (1 | 2 | 3) | undefined;

  const positional: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i]!;
    if (a === '--yes' || a === '-y') {
      yes = true;
    } else if (a === '--smoke') {
      smoke = true;
    } else if (a === '--testing') {
      const next = raw[i + 1];
      if (next === undefined || next.startsWith('--')) {
        testing = true;
      } else {
        const v = parseTesting(next);
        if (v === undefined) sink.error ??= badValue('--testing', next, 'on|off');
        else testing = v;
        i++;
      }
    } else if (a.startsWith('--testing=')) {
      const val = a.slice('--testing='.length);
      const v = parseTesting(val);
      if (v === undefined) sink.error ??= badValue('--testing', val, 'on|off');
      else testing = v;
    } else if (a === '--agent' || a.startsWith('--agent=')) {
      const inline = a.startsWith('--agent=');
      const val = inline ? a.slice('--agent='.length) : raw[i + 1];
      if (!inline) i++;
      if (val === 'agy' || val === 'claude') agent = val;
      else sink.error ??= badValue('--agent', val, 'agy|claude');
    } else if (a === '--concurrency' || a.startsWith('--concurrency=')) {
      const inline = a.startsWith('--concurrency=');
      const val = inline ? a.slice('--concurrency='.length) : raw[i + 1];
      if (!inline) i++;
      if (val !== undefined && ['1', '2', '3'].includes(val)) concurrency = parseInt(val, 10) as 1 | 2 | 3;
      else sink.error ??= badValue('--concurrency', val, '1|2|3');
    } else {
      positional.push(a);
    }
  }

  const [first, second, third] = positional;
  if (first === 'ui') {
    return { command: 'ui', yes };
  }
  if (first === 'status' || first === 'next' || first === 'generate') {
    return { command: first, yes };
  }
  if (first === 'check') {
    return { command: 'check', taskId: second, smoke, yes };
  }
  if (first === 'run') {
    return { command: 'run', yes };
  }
  if (first === 'report' || first === 'verify') {
    return { command: 'report', target: second, yes };
  }
  if (first === 'review') {
    return { command: 'review', taskId: second, yes };
  }
  if (first === 'convert') {
    return {
      command: 'convert',
      exportDir: second,
      nextDir: third,
      yes,
      testing,
      agent,
      concurrency,
    };
  }
  return {
    command: 'convert',
    exportDir: first,
    nextDir: second,
    yes,
    testing,
    agent,
    concurrency,
  };
}

export async function readAnimations(root: string): Promise<AnimationEntry[]> {
  try {
    return JSON.parse(
      await readFile(path.join(root, '.convert', 'analysis', 'animations.json'), 'utf8')
    ) as AnimationEntry[];
  } catch {
    return [];
  }
}

/** Returns the body of the "Goal" section of a task file, or null when unreadable or absent. */
export async function readTaskGoal(file: string): Promise<string | null> {
  try {
    const text = await readFile(file, 'utf8');
    const m = /^#+[ \t]*Goal[ \t]*\r?\n([\s\S]*?)(?=^#+[ \t]|$(?![\s\S]))/im.exec(text);
    return m ? m[1].trimEnd() : null;
  } catch {
    return null;
  }
}

/** True when both stdin and stdout are TTYs: the only case where prompts may appear. */
export function isInteractiveTerminal(): boolean {
  return !!process.stdin.isTTY && !!process.stdout.isTTY;
}

export interface ConvertOutput {
  log(msg: string): void;
  error(msg: string): void;
}

export async function runConvertCommand(
  argv: string[],
  out: ConvertOutput = { log: (m) => console.log(m), error: (m) => console.error(m) }
): Promise<number> {
  const console = { log: out.log, error: out.error };
  const rest = argv[0] === 'convert' ? argv.slice(1) : argv;
  if (rest.includes('--help') || rest.includes('-h')) {
    console.log(CONVERT_USAGE);
    return 0;
  }
  const args = parseConvertArgs(rest);
  if (args.error) {
    console.error(args.error);
    console.error(CONVERT_USAGE);
    return 1;
  }
  // --yes always forces the headless path.
  const wantsDashboard =
    !args.yes && (args.command === 'ui' || (args.command === 'convert' && !args.exportDir));
  if (wantsDashboard && isInteractiveTerminal()) {
    try {
      const { runScreenConvertDashboard } = await import('../cli-v2/screens/convert-dashboard.js');
      await runScreenConvertDashboard();
      return 0;
    } catch (error) {
      console.error((error as Error).message);
      return 1;
    }
  }
  if (args.command === 'ui') {
    console.error('fexport convert ui needs an interactive terminal');
    return 1;
  }
  if (args.command === 'convert') {
    if (!args.exportDir || args.exportDir.startsWith('-')) {
      console.error(CONVERT_USAGE);
      return 1;
    }
    const isDir = await stat(args.exportDir).then((x) => x.isDirectory(), () => false);
    if (!isDir) {
      console.error(`Export folder not found: ${path.resolve(args.exportDir)}`);
      console.error(CONVERT_USAGE);
      return 1;
    }
    const nextDir = args.nextDir ?? path.resolve(args.exportDir) + '-next';
    const cliOptions: Partial<RunOptions> = {};
    if (args.testing !== undefined) cliOptions.testing = args.testing;
    if (args.agent) cliOptions.agent = args.agent;
    if (args.concurrency) cliOptions.concurrency = args.concurrency;

    if (isInteractiveTerminal() && !args.yes) {
      try {
        const { runScreenConvertRun } = await import('../cli-v2/screens/convert-run.js');
        const { runScreenConvertDashboard } = await import('../cli-v2/screens/convert-dashboard.js');
        const { uiOutro } = await import('../cli-v2/ui/prompts.js');
        const resolvedOpts: RunOptions | undefined =
          Object.keys(cliOptions).length > 0
            ? { ...DEFAULT_OPTIONS, agent: await defaultAgent(), ...cliOptions }
            : undefined;
        const root = await runScreenConvertRun(args.exportDir, nextDir, { options: resolvedOpts });
        await runScreenConvertDashboard(root, { intro: false });
        uiOutro('Conversion session closed.');
        return 0;
      } catch (error) {
        console.error((error as Error).message);
        return 1;
      }
    }
    let confirm: ConvertIo['confirm'] = async () => true;
    if (!args.yes) {
      const { uiConfirm } = await import('../cli-v2/ui/prompts.js');
      confirm = (msg) => uiConfirm(msg, false);
    }
    try {
      const resolvedOpts: RunOptions = { ...DEFAULT_OPTIONS, agent: await defaultAgent(), ...cliOptions };
      await runPipeline(args.exportDir, nextDir, { confirm, log: (m) => console.log(m) }, resolvedOpts);
      return 0;
    } catch (error) {
      console.error((error as Error).message);
      return 1;
    }
  }

  const root = await findProjectRoot(process.cwd());
  const state = root ? await loadState(root) : null;
  if (!root || !state) {
    console.error('No .convert/state.json found; run "fexport convert <exportDir>" first');
    return 1;
  }

  if (args.command === 'check') {
    if (!args.taskId) {
      console.error('Usage: fexport convert check <taskId> [--smoke]');
      return 1;
    }
    const { runCheck, formatCheck } = await import('./verify/check.js');
    try {
      const res = await runCheck(root, args.taskId, { smoke: args.smoke });
      console.log(formatCheck(res));
      return res.limitReached ? 2 : res.pass ? 0 : 1;
    } catch (error) {
      console.error((error as Error).message);
      return 1;
    }
  }

  if (args.command === 'run') {
    const { runAgents } = await import('./run.js');
    const { createPauseController } = await import('./runner/pool.js');
    const { createPauseInput } = await import('./runner/pause-input.js');
    const { formatWorkerLine } = await import('./progress.js');
    const { setInterruptHandler } = await import('./verify/proc.js');
    const defaultAgentName = await defaultAgent();
    const pause = createPauseController();
    // First Ctrl+C offers "finish running tasks, then pause" / "pause now" on a terminal; without a TTY the
    // first Ctrl+C finishes running tasks then pauses. A second Ctrl+C always pauses now.
    let askPause: (() => Promise<'after-running' | 'now' | null>) | undefined;
    if (isInteractiveTerminal()) {
      const { uiSelectOrCancel } = await import('../cli-v2/ui/prompts.js');
      askPause = () =>
        uiSelectOrCancel<'after-running' | 'now'>('Pause conversion:', [
          { label: 'Finish running tasks, then pause', value: 'after-running' },
          { label: 'Pause now', value: 'now' },
        ]);
    }
    const pauseInput = createPauseInput(pause, {
      log: (m) => console.log(m),
      ...(askPause ? { ask: askPause } : {}),
    });
    setInterruptHandler(() => pauseInput.interrupt());

    const workers = new Map<number, { worker: number; route: string; section: string; agent: AgentId; startTime: number; lastLine: string }>();
    try {
      const outcome = await runAgents(root, {
        pause,
        onEvent(e) {
          if (e.type === 'start') {
            const wState = {
              worker: e.worker,
              route: e.task.route || '/',
              section: e.task.section || e.task.id,
              agent: state.options?.agent ?? defaultAgentName,
              startTime: Date.now(),
              lastLine: '',
            };
            workers.set(e.worker, wState);
            console.log(formatWorkerLine({ ...wState, ms: 0, lastLine: 'started' }));
          } else if (e.type === 'line') {
            const wState = workers.get(e.worker);
            if (wState) {
              wState.lastLine = e.line;
              console.log(formatWorkerLine({ ...wState, ms: Date.now() - wState.startTime, lastLine: e.line }));
            }
          } else if (e.type === 'end') {
            workers.delete(e.worker);
            console.log(`[W${e.worker}] finished ${e.taskId}: ${e.outcome}`);
          } else if (e.type === 'reverted') {
            console.log(`[revert] ${e.taskId}: ${e.files.join(', ')}`);
          } else if (e.type === 'quota') {
            console.log(`[quota] ${e.hit.line}`);
          }
        },
        async onQuota(_hit, other) {
          if (other) {
            console.log(`Quota hit, switching to ${other}...`);
            return 'switch';
          }
          return 'stay';
        },
      });
      return outcome.status === 'done' ? 0 : 1;
    } catch (error) {
      console.error((error as Error).message);
      return 1;
    } finally {
      setInterruptHandler(null);
    }
  }

  if (args.command === 'report') {
    if (
      state.stages.scaffold !== 'done' ||
      state.stages.tasks !== 'done'
    ) {
      console.error('Pipeline incomplete: run "fexport convert <exportDir>" first');
      return 1;
    }
    if (!existsSync(path.join(root, 'node_modules'))) {
      console.error(`Dependencies not installed: run "npm install" in ${root}`);
      return 1;
    }
    const { runReport } = await import('./verify/report.js');
    const ctx: StageContext = { state, exportDir: state.exportDir, nextDir: root, log: (m) => console.log(m) };
    try {
      const res = await runReport(ctx, { tolerance: state.options?.reportTolerance ?? 0.03, route: args.target });
      console.log(`Report: ${res.file}`);
      return res.over === 0 ? 0 : 1;
    } catch (error) {
      console.error((error as Error).message);
      return 1;
    }
  }

  if (args.command === 'review') {
    if (!args.taskId) {
      console.error('Usage: fexport convert review <taskId>');
      return 1;
    }
    const task = state.tasks[args.taskId];
    if (!task) {
      console.error(`Unknown task: ${args.taskId}`);
      return 1;
    }
    if (task.status !== 'needs-review') {
      console.error(`Task ${args.taskId} is ${task.status}, not needs-review`);
      return 1;
    }
    task.status = 'done';
    await saveState(state);
    console.log(`Marked ${task.id} done.`);
    return 0;
  }

  if (args.command === 'generate') {
    const { runGenerate } = await import('./generate/index.js');
    try {
      const r = await runGenerate({ state, exportDir: state.exportDir, nextDir: root, log: (m) => console.log(m) });
      const totalSections = r.pages.reduce((acc, p) => acc + p.sections.length, 0);
      console.log(`Generated ${r.pages.length} page(s), ${totalSections} section(s), ${r.stubs.length} stub(s).`);
      console.log(`Next: run "${CLI_INVOCATION} report" to check them.`);
      return 0;
    } catch (error) {
      console.error((error as Error).message);
      return 1;
    }
  }
  if (args.command === 'status') {
    console.log(formatStatus(state, await readAnimations(root)));
    return 0;
  }
  if (args.command === 'next') {
    const task = pickNextTask(state);
    if (!task) {
      console.log('No pending tasks');
      return 0;
    }
    const file = path.join(root, task.file);
    console.log(`Next task: ${task.id} (${task.status})\nFile: ${file}\n`);
    const goal = await readTaskGoal(file);
    if (goal !== null) console.log('Goal\n' + goal);
    else if (!(await stat(file).then(() => true, () => false))) console.log('(task file not readable)');
    return 0;
  }

  console.error(CONVERT_USAGE);
  return 1;
}
