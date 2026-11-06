import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ConvertState, RunOptions, StageName } from './types.js';
import { fromPersisted, toPersisted } from './state-migrate.js';

export const STAGES: StageName[] = [
  'analyze',
  'extract-cms',
  'scaffold',
  'install',
  'generate',
  'tasks',
  'baseline',
  'finalize',
];

export const DEFAULT_OPTIONS: Omit<RunOptions, 'agent'> = {
  testing: true,
  concurrency: 1,
  pageMode: 'pause',
  sectionTimeoutMin: 15,
  pageTimeoutMin: 15,
  pixelTolerance: 0.01,
  reportTolerance: 0.03,
};

function stateFile(nextDir: string): string {
  return path.join(nextDir, '.convert', 'state.json');
}

export function initState(exportDir: string, nextDir: string): ConvertState {
  const stages = Object.fromEntries(STAGES.map((s) => [s, 'pending'])) as ConvertState['stages'];
  return {
    version: 2,
    exportDir,
    nextDir,
    stages,
    tasks: {},
    fileHashes: {},
    warnings: [],
    options: null,
    run: { status: 'idle' },
  };
}

export async function loadState(nextDir: string): Promise<ConvertState | null> {
  try {
    const raw = JSON.parse(await fs.readFile(stateFile(nextDir), 'utf8'));
    return fromPersisted(raw, nextDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Write `data` to a sibling temp file, then rename it over `file` (creating parent dirs). */
export async function writeFileAtomic(file: string, data: string | Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, data);
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export async function saveState(state: ConvertState): Promise<void> {
  const persisted = toPersisted(state);
  await writeFileAtomic(stateFile(state.nextDir), JSON.stringify(persisted, null, 2) + '\n');
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
  return STAGES.find((s) => state.stages[s] !== 'done' && state.stages[s] !== 'skipped') ?? null;
}
