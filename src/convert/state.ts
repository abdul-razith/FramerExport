import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ConvertState, StageName, TaskStatus } from './types.js';

export const STAGES: StageName[] = ['analyze', 'extract-cms', 'scaffold', 'tasks', 'verify'];

const MAX_ATTEMPTS = 3;

function stateFile(nextDir: string): string {
  return path.join(nextDir, '.convert', 'state.json');
}

export function initState(exportDir: string, nextDir: string): ConvertState {
  const stages = Object.fromEntries(STAGES.map((s) => [s, 'pending'])) as ConvertState['stages'];
  return {
    version: 1,
    exportDir,
    nextDir,
    stages,
    tasks: {},
    fileHashes: {},
    warnings: [],
  };
}

export async function loadState(nextDir: string): Promise<ConvertState | null> {
  try {
    return JSON.parse(await fs.readFile(stateFile(nextDir), 'utf8')) as ConvertState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function saveState(state: ConvertState): Promise<void> {
  const file = stateFile(state.nextDir);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.state.json.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, JSON.stringify(state, null, 2) + '\n', 'utf8');
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export async function findProjectRoot(fromDir: string): Promise<string | null> {
  let dir = path.resolve(fromDir);
  for (;;) {
    try {
      await fs.access(stateFile(dir));
      return dir;
    } catch {}
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function nextStage(state: ConvertState): StageName | null {
  return STAGES.find((s) => state.stages[s] !== 'done') ?? null;
}

export function recordAttempt(state: ConvertState, taskId: string, passed: boolean): TaskStatus {
  const task = state.tasks[taskId];
  if (!task) throw new Error(`Unknown task: ${taskId}`);
  if (passed) {
    task.status = 'done';
  } else {
    task.attempts += 1;
    task.status = task.attempts >= MAX_ATTEMPTS ? 'needs-human' : 'in-progress';
  }
  return task.status;
}
