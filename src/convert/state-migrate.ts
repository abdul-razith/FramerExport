import fs from 'node:fs';
import path from 'node:path';
import type { ConvertState, TaskRecord } from './types.js';

function isAbsolutePath(p: string): boolean {
  return path.win32.isAbsolute(p) || path.posix.isAbsolute(p);
}

export function resolveExportDir(stored: string, nextDir: string): { dir: string; missing: boolean } {
  if (!stored) {
    return { dir: '', missing: true };
  }

  if (!isAbsolutePath(stored)) {
    const resolved = path.resolve(nextDir, stored);
    return { dir: resolved, missing: !fs.existsSync(resolved) };
  }

  if (fs.existsSync(stored)) {
    return { dir: path.resolve(stored), missing: false };
  }

  const parts = stored.split(/[/\\]+/).filter(Boolean);
  const base = parts.length > 0 ? parts[parts.length - 1] : '';
  const sibling = path.join(path.dirname(nextDir), base);
  if (base && fs.existsSync(sibling)) {
    return { dir: sibling, missing: false };
  }

  return { dir: stored, missing: true };
}

export function fromPersisted(raw: unknown, nextDir: string): ConvertState {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const isV1 = data.version === 1;
  const rawTasks = (data.tasks && typeof data.tasks === 'object' ? data.tasks : {}) as Record<string, TaskRecord>;
  const hasTasks = Object.keys(rawTasks).length > 0;
  // Old task kinds/statuses, a v1 file with tasks, or the marker written by toPersisted (a save upgrades the
  // file to v2, so the marker keeps the project recognisable as legacy).
  const hasOldTaskModel = Object.values(rawTasks).some(
    (t) => (t?.kind as string) === 'component' || (t?.kind as string) === 'motion' || (t?.status as string) === 'needs-human'
  );
  const legacyTasks = (isV1 && hasTasks) || data.legacyProject === true || hasOldTaskModel ? true : undefined;

  const exportInfo = resolveExportDir(String(data.exportDir ?? ''), nextDir);

  const stages: ConvertState['stages'] = isV1
    ? {
        analyze: data.stages?.analyze ?? 'pending',
        'extract-cms': data.stages?.['extract-cms'] ?? 'pending',
        scaffold: data.stages?.scaffold ?? 'pending',
        install: 'pending',
        generate: 'pending',
        tasks: 'pending',
        baseline: 'pending',
        finalize: 'pending',
      }
    : {
        analyze: data.stages?.analyze ?? 'pending',
        'extract-cms': data.stages?.['extract-cms'] ?? 'pending',
        scaffold: data.stages?.scaffold ?? 'pending',
        install: data.stages?.install ?? 'pending',
        generate: data.stages?.generate ?? 'pending',
        tasks: data.stages?.tasks ?? 'pending',
        baseline: data.stages?.baseline ?? 'pending',
        finalize: data.stages?.finalize ?? 'pending',
      };

  const state: ConvertState = {
    version: 2,
    exportDir: exportInfo.dir,
    nextDir,
    stages,
    tasks: rawTasks,
    fileHashes: (data.fileHashes && typeof data.fileHashes === 'object' ? data.fileHashes : {}) as Record<string, string>,
    warnings: Array.isArray(data.warnings) ? [...data.warnings] : [],
    options: data.options ?? null,
    run: data.run ?? { status: 'idle' },
  };

  if (data.timing) {
    state.timing = data.timing;
  }
  if (legacyTasks) {
    state.legacyTasks = true;
  }
  if (exportInfo.missing) {
    state.exportMissing = true;
  }

  return state;
}

export function toPersisted(state: ConvertState): object {
  const relExportDir = path.relative(state.nextDir, state.exportDir).replace(/\\/g, '/');
  const { nextDir, legacyTasks, exportMissing, ...rest } = state;
  return {
    ...rest,
    version: 2,
    exportDir: relExportDir,
    ...(legacyTasks ? { legacyProject: true } : {}),
  };
}
