import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { framerAdapter } from './adapters/framer/index.js';
import type { StageContext } from './adapters/types.js';
import { formatStatus, pickNextTask, runPipeline, type ConvertIo } from './pipeline.js';
import { findProjectRoot, loadState, saveState } from './state.js';
import { CLI_INVOCATION } from './tasks/templates/index.js';
import { runVerify } from './stages/verify.js';
import type { AnimationEntry } from './types.js';

export { formatStatus, runPipeline } from './pipeline.js';
export type { ConvertIo } from './pipeline.js';

export interface ConvertArgs {
  command: 'run' | 'status' | 'next' | 'verify' | 'done';
  exportDir?: string;
  nextDir?: string;
  target?: string;
  yes: boolean;
}

export const CONVERT_USAGE = `Usage:
  fexport convert <exportDir> [nextDir] [--yes]   convert a Framer export to a Next.js project
  fexport convert status                          show stages, tasks, warnings and the motion checklist
  fexport convert next                            show the next task to give to your AI coding agent
  fexport convert verify [target]                 build and compare against the export, write fix tasks
  fexport convert done <taskId>                   mark a motion task done after ticking its checklist

nextDir defaults to <exportDir>-next. status/next/verify run from inside the converted project.`;

/** Accepts argv with or without the leading "convert". */
export function parseConvertArgs(argv: string[]): ConvertArgs {
  const rest = argv[0] === 'convert' ? argv.slice(1) : argv;
  const yes = rest.includes('--yes') || rest.includes('-y');
  const [first, second] = rest.filter((a) => a !== '--yes' && a !== '-y');
  if (first === 'status' || first === 'next') {
    return { command: first, exportDir: undefined, nextDir: undefined, target: undefined, yes };
  }
  if (first === 'done') {
    return { command: 'done', exportDir: undefined, nextDir: undefined, target: second, yes };
  }
  if (first === 'verify') {
    return { command: 'verify', exportDir: undefined, nextDir: undefined, target: second, yes };
  }
  return { command: 'run', exportDir: first, nextDir: second, target: undefined, yes };
}

async function readAnimations(root: string): Promise<AnimationEntry[]> {
  try {
    return JSON.parse(
      await readFile(path.join(root, '.convert', 'analysis', 'animations.json'), 'utf8')
    ) as AnimationEntry[];
  } catch {
    return [];
  }
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
  if (args.command === 'run') {
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
    let confirm: ConvertIo['confirm'] = async () => true;
    if (!args.yes) {
      const { uiConfirm } = await import('../cli-v2/ui/prompts.js');
      confirm = (msg) => uiConfirm(msg, false);
    }
    try {
      await runPipeline(args.exportDir, nextDir, { confirm, log: (m) => console.log(m) });
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
    try {
      const text = await readFile(file, 'utf8');
      const m = /^#+[ \t]*Goal[ \t]*\r?\n([\s\S]*?)(?=^#+[ \t]|$(?![\s\S]))/im.exec(text);
      if (m) console.log('Goal\n' + m[1].trimEnd());
    } catch {
      console.log('(task file not readable)');
    }
    return 0;
  }
  if (args.command === 'done') {
    const task = args.target ? state.tasks[args.target] : undefined;
    if (!task) {
      console.error(args.target ? `Unknown task: ${args.target}` : 'Usage: fexport convert done <taskId>');
      return 1;
    }
    const original = task.kind === 'fix' ? state.tasks[task.id.replace(/^fix-/, '').replace(/-\d+$/, '')] : task;
    if (original?.kind !== 'motion') {
      console.error(
        `${task.id} is a ${task.kind} task; "done" is only for motion tasks. Run "${CLI_INVOCATION} verify ${task.id}" instead.`
      );
      return 1;
    }
    task.status = 'done';
    await saveState(state);
    console.log(`Marked ${task.id} done.`);
    return 0;
  }
  const ctx: StageContext = { state, exportDir: state.exportDir, nextDir: root, log: (m) => console.log(m) };
  let result: Awaited<ReturnType<typeof runVerify>>;
  try {
    result = await runVerify(ctx, framerAdapter, args.target);
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
  console.log(`Passed: ${result.passed.length}`);
  console.log(`Failed: ${result.failed.length}`);
  console.log(`Report: ${path.join(root, '.convert', 'diffs', 'report.json')}`);
  return result.failed.length === 0 ? 0 : 1;
}
