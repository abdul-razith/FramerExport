import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { StageContext } from './adapters/types.js';
import { formatStatus, pickNextTask, runPipeline, type ConvertIo } from './pipeline.js';
import { findProjectRoot, loadState } from './state.js';
import { runVerify } from './stages/verify.js';
import type { AnimationEntry } from './types.js';

export { formatStatus, runPipeline } from './pipeline.js';
export type { ConvertIo } from './pipeline.js';

export interface ConvertArgs {
  command: 'run' | 'status' | 'next' | 'verify';
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

nextDir defaults to <exportDir>-next. status/next/verify run from inside the converted project.`;

/** Accepts argv with or without the leading "convert". */
export function parseConvertArgs(argv: string[]): ConvertArgs {
  const rest = argv[0] === 'convert' ? argv.slice(1) : argv;
  const yes = rest.includes('--yes') || rest.includes('-y');
  const [first, second] = rest.filter((a) => a !== '--yes' && a !== '-y');
  if (first === 'status' || first === 'next') {
    return { command: first, exportDir: undefined, nextDir: undefined, target: undefined, yes };
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

export async function runConvertCommand(argv: string[]): Promise<number> {
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
      console.log('No pending tasks.');
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
  const ctx: StageContext = { state, exportDir: state.exportDir, nextDir: root, log: (m) => console.log(m) };
  const result = await runVerify(ctx, args.target);
  console.log(`Passed: ${result.passed.length}`);
  console.log(`Failed: ${result.failed.length}`);
  console.log(`Report: ${path.join(root, '.convert', 'diffs', 'report.json')}`);
  return result.failed.length === 0 ? 0 : 1;
}
