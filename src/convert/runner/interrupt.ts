import fs from 'node:fs/promises';
import path from 'node:path';
import { writeFileAtomic } from '../state.js';
import type { ConvertState, TaskRecord } from '../types.js';
import { toPosixPath } from './scope.js';

interface TaskSnapshotManifest {
  taskId: string;
  present: string[];
  absent: string[];
}

async function walkDir(dir: string, onFile: (fullPath: string) => Promise<void>): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err: any) {
    if (err?.code === 'ENOENT') return;
    throw err;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkDir(full, onFile);
    } else if (entry.isFile()) {
      await onFile(full);
    }
  }
}

async function cleanEmptyDirs(filePath: string, stopAt: string): Promise<void> {
  let dir = path.dirname(filePath);
  const resolvedStopAt = path.resolve(stopAt);
  while (dir !== resolvedStopAt && dir.startsWith(resolvedStopAt)) {
    try {
      const list = await fs.readdir(dir);
      if (list.length === 0) {
        await fs.rmdir(dir);
        dir = path.dirname(dir);
      } else {
        break;
      }
    } catch {
      break;
    }
  }
}

export function formatPartialTimestamp(date: Date = new Date()): string {
  const iso = date.toISOString();
  return iso.slice(0, 10).replace(/-/g, '') + '-' + iso.slice(11, 19).replace(/:/g, '');
}

/**
 * Finds all files currently existing on disk under root that match the task targets.
 */
export async function findTargetFiles(root: string, targets: string[]): Promise<string[]> {
  const found: string[] = [];
  const resolvedRoot = path.resolve(root);

  for (const rawTarget of targets) {
    const target = toPosixPath(rawTarget);
    if (!target) continue;
    const full = path.resolve(resolvedRoot, target);

    if (target.endsWith('/')) {
      try {
        const stat = await fs.stat(full);
        if (stat.isDirectory()) {
          await walkDir(full, async (fileFullPath) => {
            const rel = toPosixPath(path.relative(resolvedRoot, fileFullPath));
            found.push(rel);
          });
        }
      } catch (err: any) {
        if (err?.code !== 'ENOENT') throw err;
      }
    } else {
      try {
        const stat = await fs.stat(full);
        if (stat.isDirectory()) {
          await walkDir(full, async (fileFullPath) => {
            const rel = toPosixPath(path.relative(resolvedRoot, fileFullPath));
            found.push(rel);
          });
        } else if (stat.isFile()) {
          const rel = toPosixPath(path.relative(resolvedRoot, full));
          found.push(rel);
        }
      } catch (err: any) {
        if (err?.code !== 'ENOENT') throw err;
      }
    }
  }

  return Array.from(new Set(found)).sort();
}

/**
 * Saves a pre-task snapshot to `.convert/snapshots/<id>/`.
 * Copies existing target files into `files/` and writes `manifest.json` recording
 * present and absent files.
 */
export async function saveTaskSnapshot(root: string, task: TaskRecord): Promise<void> {
  const resolvedRoot = path.resolve(root);
  const snapshotDir = path.join(resolvedRoot, '.convert', 'snapshots', task.id);
  const filesDir = path.join(snapshotDir, 'files');
  const manifestPath = path.join(snapshotDir, 'manifest.json');

  await fs.rm(snapshotDir, { recursive: true, force: true });
  await fs.mkdir(filesDir, { recursive: true });

  const targets = task.targets && task.targets.length > 0 ? task.targets : (task.file ? [task.file] : []);
  const presentFiles: string[] = [];
  const absentTargets: string[] = [];

  for (const rawTarget of targets) {
    const target = toPosixPath(rawTarget);
    if (!target) continue;
    const full = path.resolve(resolvedRoot, target);

    let exists = false;
    try {
      const stat = await fs.stat(full);
      exists = true;
      if (stat.isDirectory()) {
        await walkDir(full, async (fileFullPath) => {
          const rel = toPosixPath(path.relative(resolvedRoot, fileFullPath));
          presentFiles.push(rel);
          const dest = path.join(filesDir, rel);
          await fs.mkdir(path.dirname(dest), { recursive: true });
          await fs.copyFile(fileFullPath, dest);
        });
      } else if (stat.isFile()) {
        const rel = toPosixPath(path.relative(resolvedRoot, full));
        presentFiles.push(rel);
        const dest = path.join(filesDir, rel);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.copyFile(full, dest);
      }
    } catch (err: any) {
      if (err?.code !== 'ENOENT') throw err;
    }

    if (!exists) {
      absentTargets.push(target);
    }
  }

  const manifest: TaskSnapshotManifest = {
    taskId: task.id,
    present: Array.from(new Set(presentFiles)).sort(),
    absent: Array.from(new Set(absentTargets)).sort(),
  };

  await writeFileAtomic(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

/**
 * Recovers an interrupted task:
 * - Copies current targets to `.convert/partial/<id>/<YYYYMMDD-HHmmss>/`
 * - Restores snapshot files, deletes files that were absent when snapshot was taken
 * - Sets `task.status = 'pending'`, leaves `task.attempts` unchanged
 * - Returns partial dir path
 */
export async function recoverTask(root: string, task: TaskRecord, now?: Date): Promise<string> {
  const resolvedRoot = path.resolve(root);
  const stamp = formatPartialTimestamp(now);
  const partialDir = path.join(resolvedRoot, '.convert', 'partial', task.id, stamp);
  await fs.mkdir(partialDir, { recursive: true });

  const targets = task.targets && task.targets.length > 0 ? task.targets : (task.file ? [task.file] : []);

  // 1. Copy current targets to partialDir
  const currentFiles = await findTargetFiles(resolvedRoot, targets);
  for (const rel of currentFiles) {
    const src = path.join(resolvedRoot, rel);
    const dest = path.join(partialDir, rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
  }

  // 2. Read snapshot manifest if it exists
  const snapshotDir = path.join(resolvedRoot, '.convert', 'snapshots', task.id);
  const filesDir = path.join(snapshotDir, 'files');
  const manifestPath = path.join(snapshotDir, 'manifest.json');

  let manifest: TaskSnapshotManifest | null = null;
  try {
    const raw = await fs.readFile(manifestPath, 'utf8');
    manifest = JSON.parse(raw);
  } catch {
    manifest = null;
  }

  if (manifest) {
    const presentSet = new Set(manifest.present);

    // Delete any currently existing target file that was NOT in snapshot present files
    for (const rel of currentFiles) {
      if (!presentSet.has(rel)) {
        const full = path.join(resolvedRoot, rel);
        await fs.rm(full, { force: true });
        await cleanEmptyDirs(full, resolvedRoot);
      }
    }

    // Delete any targets that were recorded as absent
    for (const rawAbsent of manifest.absent) {
      const absent = toPosixPath(rawAbsent);
      const full = path.resolve(resolvedRoot, absent);
      try {
        const stat = await fs.stat(full);
        if (stat.isDirectory()) {
          await fs.rm(full, { recursive: true, force: true });
        } else {
          await fs.rm(full, { force: true });
        }
        await cleanEmptyDirs(full, resolvedRoot);
      } catch {}
    }

    // Restore snapshot present files
    for (const rel of manifest.present) {
      const src = path.join(filesDir, rel);
      const dest = path.join(resolvedRoot, rel);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(src, dest);
    }
  }

  // 3. Update task
  task.status = 'pending';

  return partialDir;
}

/**
 * Finds all tasks with status === 'in-progress' (ignoring 'done', 'pending', etc.),
 * calls recoverTask on each, and returns their task IDs.
 */
export async function recoverInterrupted(root: string, state: ConvertState): Promise<string[]> {
  const recovered: string[] = [];
  for (const [id, task] of Object.entries(state.tasks)) {
    if (task.status === 'in-progress') {
      await recoverTask(root, task);
      recovered.push(id);
    }
  }
  return recovered;
}
