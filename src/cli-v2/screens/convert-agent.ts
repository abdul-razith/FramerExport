import { execFile, spawn } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { framerAdapter } from '../../convert/adapters/framer/index.js';
import { pickNextTask } from '../../convert/pipeline.js';
import { loadState, saveState } from '../../convert/state.js';
import { runVerify } from '../../convert/stages/verify.js';
import type { ConvertState, TaskRecord } from '../../convert/types.js';
import { uiConfirm, uiNote, uiSelect, uiSpinner } from '../ui/prompts.js';
import { STAGE_LABELS, formatVerifyError, formatVerifyResult } from './convert-helpers.js';

export type AgentId = 'agy' | 'claude';
export type AgentMode = 'one' | 'all';
export type StopReason =
  | 'done'
  | 'single'
  | 'needs-human'
  | 'motion'
  | 'failed-agent'
  | 'verify-error'
  | 'stalled'
  | 'limit';

const SAFE_PROMPT_PATH = /^[A-Za-z0-9 ./_,-]+$/;
/** Not part of "what the agent changed": installs, build output, our own state, VCS. */
const SKIPPED_DIRS = new Set(['node_modules', '.next', '.convert', '.git']);
const DEFAULT_MAX_TASKS = 200;

/** Fixed prompt; the task file is the only variable and may hold only shell-safe characters. */
export function buildAgentPrompt(taskFile: string): string {
  if (!SAFE_PROMPT_PATH.test(taskFile)) throw new Error(`Unsafe task file path for the agent prompt: ${taskFile}`);
  return `Read AGENTS.md and ${taskFile} then complete that task. Edit only the files listed under Edit only. Do not run verify, the dashboard runs it afterwards.`;
}

export function buildAgentCommand(agent: AgentId, prompt: string): { command: string; args: string[] } {
  return { command: agent, args: ['-p', prompt, '--dangerously-skip-permissions'] };
}

const run = (file: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) =>
    execFile(file, args, (error, stdout) => (error ? reject(error) : resolve(String(stdout))))
  );

/**
 * Picks the launchable path from `where`/`which` output. On Windows `where` also lists the extensionless shell
 * shim of an npm-installed CLI first; only .exe/.cmd/.bat can be spawned.
 */
export function pickBinaryLine(output: string, platform: NodeJS.Platform): string | null {
  const lines = output.split(/\r?\n/).filter((l) => l.trim());
  if (platform === 'win32') return lines.find((l) => /\.(exe|cmd|bat)$/i.test(l.trim()))?.trim() ?? null;
  return lines[0]?.trim() ?? null;
}

/** Absolute path of the launchable match for `name` on PATH, or null. */
async function whichBinary(name: string): Promise<string | null> {
  try {
    const out = await run(process.platform === 'win32' ? 'where' : 'which', [name]);
    return pickBinaryLine(out, process.platform);
  } catch {
    return null;
  }
}

export async function detectAgents(): Promise<AgentId[]> {
  const found: AgentId[] = [];
  for (const agent of ['agy', 'claude'] as const) if (await whichBinary(agent)) found.push(agent);
  return found;
}

async function snapshot(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) await walk(full);
      } else if (entry.isFile()) {
        const s = await stat(full);
        files.set(path.relative(root, full).split(path.sep).join('/'), `${s.mtimeMs}:${s.size}`);
      }
    }
  };
  await walk(root);
  return files;
}

function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else process.kill(pid, 'SIGTERM');
}

export interface AgentRunDeps {
  buildCommand?: typeof buildAgentCommand;
}

/**
 * Starts the agent in the project folder and waits for it. The agent's own output is the progress display
 * (stdio is inherited), so no spinner may be running. Files changed outside `targets` are reported, never reverted.
 */
export async function runAgentOnTask(
  root: string,
  agent: AgentId,
  taskFile: string,
  targets: string[],
  deps: AgentRunDeps = {}
): Promise<{ exitCode: number; outside: string[] }> {
  const { command, args } = (deps.buildCommand ?? buildAgentCommand)(agent, buildAgentPrompt(taskFile));
  // Agents installed as .cmd shims on Windows need a shell; the prompt is quoted and has only safe characters.
  let file = command;
  let shell = false;
  if (command === agent && process.platform === 'win32') {
    const resolved = await whichBinary(agent);
    if (resolved) {
      file = resolved;
      shell = /\.(cmd|bat)$/i.test(resolved);
    }
  }
  const spawnArgs = shell ? args.map((a) => (/\s/.test(a) ? `"${a}"` : a)) : args;
  const before = await snapshot(root);
  const exitCode = await new Promise<number>((resolve) => {
    const child = spawn(shell ? `"${file}"` : file, spawnArgs, { cwd: root, stdio: 'inherit', shell });
    const onSigint = (): void => killTree(child.pid);
    process.once('SIGINT', onSigint);
    child.on('error', () => {
      process.removeListener('SIGINT', onSigint);
      resolve(1);
    });
    child.on('close', (code) => {
      process.removeListener('SIGINT', onSigint);
      resolve(code ?? 1);
    });
  });
  const after = await snapshot(root);
  const allowed = new Set(targets.map((t) => t.split(path.sep).join('/')));
  const changed = new Set<string>();
  for (const [f, sig] of after) if (before.get(f) !== sig) changed.add(f);
  for (const f of before.keys()) if (!after.has(f)) changed.add(f);
  return { exitCode, outside: [...changed].filter((f) => !allowed.has(f)).sort() };
}

export interface AgentLoopDeps {
  runAgent?: (root: string, agent: AgentId, task: TaskRecord) => Promise<{ exitCode: number; outside: string[] }>;
  verify?: (root: string, state: ConvertState, taskId: string) => Promise<{ passed: string[]; failed: string[] }>;
  maxTasks?: number;
  onResult?: (info: {
    task: TaskRecord;
    exitCode: number;
    outside: string[];
    verify?: { passed: string[]; failed: string[] };
    verifyError?: unknown;
  }) => void;
}

/** Fix tasks resolve to the task they fix (`fix-<id>-<n>`; `fix-build-<n>` resolves to `build`). */
function originalOf(state: ConvertState, t: TaskRecord): TaskRecord | undefined {
  return t.kind === 'fix' ? state.tasks[t.id.replace(/^fix-/, '').replace(/-\d+$/, '')] : t;
}

function isMotion(state: ConvertState, t: TaskRecord): boolean {
  return originalOf(state, t)?.kind === 'motion';
}

export async function runAgentLoop(
  root: string,
  agent: AgentId,
  mode: AgentMode,
  deps: AgentLoopDeps = {}
): Promise<{ stoppedFor: StopReason; ran: string[] }> {
  const runAgent =
    deps.runAgent ??
    ((r, a, t) => runAgentOnTask(r, a, t.file.split('\\').join('/'), t.targets));
  const verify =
    deps.verify ??
    ((r, state, id) =>
      runVerify({ state, exportDir: state.exportDir, nextDir: r, log: () => {} }, framerAdapter, id));
  const limit = deps.maxTasks ?? DEFAULT_MAX_TASKS;
  const ran: string[] = [];
  let lastTaskId = '';
  let lastSignature = '';

  for (;;) {
    const state = await loadState(root);
    const task = state ? pickNextTask(state) : undefined;
    if (!state || !task) return { stoppedFor: 'done', ran };
    // Animations cannot be judged automatically: they always need the user's eyes.
    if (isMotion(state, task)) return { stoppedFor: 'motion', ran };
    if (ran.length >= limit) return { stoppedFor: 'limit', ran };

    const result = await runAgent(root, agent, task);
    ran.push(task.id);
    if (result.exitCode !== 0) {
      deps.onResult?.({ task, exitCode: result.exitCode, outside: result.outside });
      return { stoppedFor: 'failed-agent', ran };
    }
    let verdict: { passed: string[]; failed: string[] };
    try {
      verdict = await verify(root, state, task.id);
    } catch (error) {
      deps.onResult?.({ task, exitCode: 0, outside: result.outside, verifyError: error });
      return { stoppedFor: 'verify-error', ran };
    }
    deps.onResult?.({ task, exitCode: 0, outside: result.outside, verify: verdict });
    const after = await loadState(root);
    // verify records attempts on the original task of a fix, and leaves the latest fix file pending.
    const original = after ? originalOf(after, task) : undefined;
    if (original?.status === 'needs-human' || after?.tasks[task.id]?.status === 'needs-human') {
      return { stoppedFor: 'needs-human', ran };
    }
    if (mode === 'one') return { stoppedFor: 'single', ran };
    // The same task picked again with nothing changed (e.g. verify skipped it on an infrastructure error)
    // would repeat forever: stop instead.
    const signature = `${task.id}|${after?.tasks[task.id]?.status}|${original?.status}|${original?.attempts}`;
    if (lastTaskId === task.id && lastSignature === signature) return { stoppedFor: 'stalled', ran };
    lastTaskId = task.id;
    lastSignature = signature;
  }
}

const STOP_TEXT: Record<StopReason, string> = {
  done: 'No pending tasks are left.',
  single: 'Ran one task. Review it, then run again or choose another action.',
  'needs-human': 'A task failed 3 times and needs you. See "View status".',
  motion: 'Only motion tasks are left. Check the animations yourself, then choose "Mark motion task done".',
  'failed-agent': 'The agent exited with an error.',
  'verify-error': 'Verification could not run.',
  stalled: 'Verification left the same task unchanged twice (see report.json errors). Check it, then run again.',
  limit: 'Reached the task limit for one run.',
};

let warned = false;

/** The dashboard's "Run AI agent" action: choose agent and mode, confirm once, run the loop, summarise. */
export async function runAgentFlow(root: string): Promise<void> {
  const agents = await detectAgents();
  if (agents.length === 0) {
    uiNote('Neither agy nor claude was found on PATH.', 'AI agent');
    return;
  }
  const agent =
    agents.length === 1
      ? agents[0]
      : await uiSelect<AgentId>(
          'Which AI agent?',
          agents.map((a) => ({ label: a, value: a }))
        );
  const mode = await uiSelect<AgentMode>('How much should it run?', [
    { label: 'Next task only, I review each one', value: 'one' },
    { label: 'Run all tasks until done or stuck', value: 'all' },
  ]);
  if (!warned) {
    uiNote(
      `${agent} runs with --dangerously-skip-permissions inside\n${root}\nIt can run any command there without asking.`,
      'Unattended AI agent'
    );
    if (!(await uiConfirm('Start the agent?', false))) return;
    warned = true;
  }

  const result = await runAgentLoop(root, agent, mode, {
    verify: async (r, state, id) => {
      const spinner = uiSpinner();
      spinner.start(STAGE_LABELS.verify);
      try {
        const out = await runVerify(
          { state, exportDir: state.exportDir, nextDir: r, log: (m) => spinner.message(m.slice(0, 80)) },
          framerAdapter,
          id
        );
        spinner.stop('Verification finished');
        await saveState(state);
        return out;
      } catch (error) {
        spinner.stop('Verification failed');
        throw error;
      }
    },
    onResult: ({ task, exitCode, outside, verify, verifyError }) => {
      const lines = [`${task.id}: agent exit ${exitCode}`];
      if (verify) lines.push('', formatVerifyResult(verify, root));
      if (verifyError) lines.push('', formatVerifyError(verifyError));
      if (outside.length) lines.push('', 'Changed outside this task’s files (not reverted):', ...outside.slice(0, 20).map((f) => `  ${f}`));
      uiNote(lines.join('\n'), 'Agent result');
    },
  });
  uiNote(`Tasks run: ${result.ran.length}\n${STOP_TEXT[result.stoppedFor]}`, 'AI agent finished');
}
