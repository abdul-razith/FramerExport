import fs from 'node:fs/promises';
import path from 'node:path';

export interface FileSnapshot {
  content?: Buffer;
  size: number;
  mtimeMs: number;
}

export interface TreeSnapshot {
  root: string;
  files: Map<string, FileSnapshot>;
  rootFiles: Set<string>;
  rootEntries: Set<string>;
}

export const MAX_FILE_BUFFER_SIZE = 5 * 1024 * 1024; // 5 MB

const ROOT_CONFIGS = [
  'package.json',
  'next.config.ts',
  'next.config.js',
  'next.config.mjs',
  'tsconfig.json',
  'postcss.config.mjs',
  'postcss.config.js',
  'eslint.config.mjs',
  'eslint.config.js',
  'AGENTS.md',
  'CLAUDE.md',
];

/**
 * Normalizes a path to POSIX slashes and removes leading `./` or `/`.
 * Preserves trailing slash if present (indicating a directory prefix).
 */
export function toPosixPath(p: string): string {
  let s = p.replace(/\\/g, '/');
  while (s.startsWith('./') || (s.startsWith('/') && !s.startsWith('//'))) {
    s = s.startsWith('./') ? s.slice(2) : s.slice(1);
  }
  return s;
}

/**
 * Checks whether a given relative path is within the allowed target list.
 * Exact match, or if a target ends in '/', any file starting with that target prefix is allowed.
 */
export function isAllowed(file: string, targets: string[]): boolean {
  const normFile = toPosixPath(file);
  for (const rawTarget of targets) {
    const target = toPosixPath(rawTarget);
    if (!target) continue;
    if (target.endsWith('/')) {
      if (normFile.startsWith(target)) {
        return true;
      }
    } else {
      if (normFile === target) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Determines whether a relative path belongs to ignored categories:
 * .next/, node_modules/, next-env.d.ts, .git/, and rest of .convert/
 * (except .convert/tasks/** which is watched).
 */
export function isIgnored(rel: string): boolean {
  const norm = toPosixPath(rel);
  if (norm === 'next-env.d.ts') return true;
  if (norm === '.next' || norm.startsWith('.next/')) return true;
  if (norm === 'node_modules' || norm.startsWith('node_modules/')) return true;
  if (norm === '.git' || norm.startsWith('.git/')) return true;
  if (norm === '.convert') return true;
  if (norm.startsWith('.convert/')) {
    if (norm === '.convert/tasks' || norm.startsWith('.convert/tasks/')) {
      return false;
    }
    return true;
  }
  return false;
}

async function walkDir(
  dir: string,
  onFile: (fullPath: string) => Promise<void>
): Promise<void> {
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
  while (dir !== stopAt && dir.startsWith(stopAt)) {
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

async function recordFileSnapshot(
  fullPath: string,
  rel: string,
  files: Map<string, FileSnapshot>
): Promise<void> {
  const stat = await fs.stat(fullPath);
  if (stat.size > MAX_FILE_BUFFER_SIZE) {
    files.set(rel, {
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    });
  } else {
    const content = await fs.readFile(fullPath);
    files.set(rel, {
      content,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    });
  }
}

/**
 * Snapshots the project tree, recording watched files (with buffer content unless > 5 MB)
 * and root file names, while ignoring internal/runtime paths.
 */
export async function snapshotTree(root: string): Promise<TreeSnapshot> {
  const resolvedRoot = path.resolve(root);
  const files = new Map<string, FileSnapshot>();
  const rootFiles = new Set<string>();
  const rootEntries = new Set<string>();

  // 1. Root directory entries
  let dirents: import('node:fs').Dirent[] = [];
  try {
    dirents = await fs.readdir(resolvedRoot, { withFileTypes: true });
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err;
  }

  for (const dirent of dirents) {
    rootEntries.add(dirent.name);
    if (dirent.isFile() && !isIgnored(dirent.name)) {
      rootFiles.add(dirent.name);
    }
  }

  // 2. Root configs
  for (const config of ROOT_CONFIGS) {
    const fullPath = path.join(resolvedRoot, config);
    try {
      const stat = await fs.stat(fullPath);
      if (stat.isFile()) {
        await recordFileSnapshot(fullPath, config, files);
      }
    } catch (err: any) {
      if (err?.code !== 'ENOENT') throw err;
    }
  }

  // 3. src/**
  const srcDir = path.join(resolvedRoot, 'src');
  await walkDir(srcDir, async (fullPath) => {
    const rel = toPosixPath(path.relative(resolvedRoot, fullPath));
    if (isIgnored(rel)) return;
    await recordFileSnapshot(fullPath, rel, files);
  });

  // 4. public/**
  const publicDir = path.join(resolvedRoot, 'public');
  await walkDir(publicDir, async (fullPath) => {
    const rel = toPosixPath(path.relative(resolvedRoot, fullPath));
    if (isIgnored(rel)) return;
    await recordFileSnapshot(fullPath, rel, files);
  });

  // 5. .convert/tasks/**
  const tasksDir = path.join(resolvedRoot, '.convert', 'tasks');
  await walkDir(tasksDir, async (fullPath) => {
    const rel = toPosixPath(path.relative(resolvedRoot, fullPath));
    if (isIgnored(rel)) return;
    await recordFileSnapshot(fullPath, rel, files);
  });

  return {
    root: resolvedRoot,
    files,
    rootFiles,
    rootEntries,
  };
}

/**
 * Compares current tree against before snapshot.
 * Reverts changes to unallowed watched files, recreates deleted watched files,
 * and deletes unallowed new files. Changes to allowed targets or ignored paths are kept.
 * Returns sorted array of reverted / deleted POSIX relative paths.
 */
export async function revertOutOfScope(
  root: string,
  before: TreeSnapshot,
  allowed: string[]
): Promise<string[]> {
  const resolvedRoot = path.resolve(root);
  const reverted = new Set<string>();

  // 1. Revert changes to or deletions of watched files that are not allowed
  for (const [relPath, record] of before.files) {
    if (isAllowed(relPath, allowed)) {
      continue;
    }

    const fullPath = path.join(resolvedRoot, relPath);
    let stat;
    try {
      stat = await fs.stat(fullPath);
    } catch (err: any) {
      if (err?.code !== 'ENOENT') throw err;
      stat = null;
    }

    if (!stat) {
      // Watched file was deleted -> recreate it
      if (record.content !== undefined) {
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, record.content);
        reverted.add(relPath);
      } else {
        reverted.add(relPath);
      }
    } else {
      // Watched file exists -> check if modified
      if (record.content !== undefined) {
        const currentContent = await fs.readFile(fullPath);
        if (!currentContent.equals(record.content)) {
          await fs.writeFile(fullPath, record.content);
          reverted.add(relPath);
        }
      } else {
        // Large file (> 5 MB) without buffer
        if (stat.size !== record.size || stat.mtimeMs !== record.mtimeMs) {
          reverted.add(relPath);
        }
      }
    }
  }

  // 2. Scan for newly created files that are not allowed and delete them
  // A. Root files & unallowed root directories
  let rootEntries: import('node:fs').Dirent[] = [];
  try {
    rootEntries = await fs.readdir(resolvedRoot, { withFileTypes: true });
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err;
  }

  for (const dirent of rootEntries) {
    const rel = toPosixPath(dirent.name);
    if (isIgnored(rel)) continue;

    if (dirent.isFile()) {
      if (!before.rootFiles.has(rel)) {
        if (!isAllowed(rel, allowed)) {
          await fs.unlink(path.join(resolvedRoot, rel));
          reverted.add(rel);
        }
      }
    } else if (dirent.isDirectory()) {
      if (dirent.name !== 'src' && dirent.name !== 'public' && dirent.name !== '.convert') {
        if (!before.rootEntries.has(dirent.name)) {
          const dirPath = path.join(resolvedRoot, dirent.name);
          await walkDir(dirPath, async (fullPath) => {
            const fileRel = toPosixPath(path.relative(resolvedRoot, fullPath));
            if (isIgnored(fileRel)) return;
            if (isAllowed(fileRel, allowed)) return;
            await fs.unlink(fullPath);
            await cleanEmptyDirs(fullPath, dirPath);
            reverted.add(fileRel);
          });
          // Only remove if completely empty (will not delete if allowed files remain)
          try {
            await fs.rmdir(dirPath);
          } catch {}
        }
      }
    }
  }

  // Helper to delete new unallowed files in a watched directory
  async function checkNewInDir(dirPath: string) {
    await walkDir(dirPath, async (fullPath) => {
      const rel = toPosixPath(path.relative(resolvedRoot, fullPath));
      if (isIgnored(rel)) return;
      if (before.files.has(rel)) return; // Existed before, handled in step 1
      if (isAllowed(rel, allowed)) return;

      await fs.unlink(fullPath);
      await cleanEmptyDirs(fullPath, dirPath);
      reverted.add(rel);
    });
  }

  // B. src/**
  await checkNewInDir(path.join(resolvedRoot, 'src'));

  // C. public/**
  await checkNewInDir(path.join(resolvedRoot, 'public'));

  // D. .convert/tasks/**
  await checkNewInDir(path.join(resolvedRoot, '.convert', 'tasks'));

  return Array.from(reverted).sort();
}
