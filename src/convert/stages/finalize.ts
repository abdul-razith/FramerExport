import fs from 'node:fs/promises';
import path from 'node:path';
import type { StageContext } from '../adapters/types.js';
import { saveState, writeFileAtomic } from '../state.js';
import { renderTemplate } from './tasks.js';
import { checkCommand, SHARED_RULES } from '../tasks/templates/index.js';
import type { CheckResult } from '../verify/check.js';
import type { TaskRecord } from '../types.js';

const CODE_EXTENSIONS = new Set(['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs']);
const FRAMER_CLASS_REGEX = /\bframer-(?!motion\b)/;

/**
 * Checks if source code contains a Framer CSS class name within a className attribute or property.
 */
export function hasFramerClassName(text: string): boolean {
  const classRe = /\bclassName\s*[:=]\s*/g;
  let match: RegExpExecArray | null;
  while ((match = classRe.exec(text)) !== null) {
    const startIndex = match.index + match[0].length;
    if (startIndex >= text.length) break;
    const firstChar = text[startIndex];

    if (firstChar === '"' || firstChar === "'" || firstChar === '`') {
      const quote = firstChar;
      let i = startIndex + 1;
      let escaped = false;
      while (i < text.length) {
        const ch = text[i];
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === quote) {
          break;
        }
        i++;
      }
      const literal = text.slice(startIndex + 1, i);
      if (FRAMER_CLASS_REGEX.test(literal)) {
        return true;
      }
    } else if (firstChar === '{') {
      let depth = 0;
      let i = startIndex;
      let inString: string | null = null;
      let escaped = false;
      while (i < text.length) {
        const ch = text[i];
        if (inString) {
          if (escaped) {
            escaped = false;
          } else if (ch === '\\') {
            escaped = true;
          } else if (ch === inString) {
            inString = null;
          }
        } else {
          if (ch === '"' || ch === "'" || ch === '`') {
            inString = ch;
          } else if (ch === '{') {
            depth++;
          } else if (ch === '}') {
            depth--;
            if (depth === 0) {
              const expr = text.slice(startIndex + 1, i);
              if (FRAMER_CLASS_REGEX.test(expr)) {
                return true;
              }
              break;
            }
          }
        }
        i++;
      }
    }
  }
  return false;
}

function samePath(a: string, b: string): boolean {
  if (process.platform === 'win32') {
    return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  }
  return path.resolve(a) === path.resolve(b);
}

async function walkDir(dir: string, excludeDir?: string): Promise<string[]> {
  const files: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (excludeDir && samePath(fullPath, excludeDir)) {
          continue;
        }
        files.push(...(await walkDir(fullPath, excludeDir)));
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  } catch {
    // Directory might not exist
  }
  return files;
}

/**
 * Returns all files under `src/` (except `src/styles/framer/`) containing `framer-` in a `className`.
 */
export async function framerClassFiles(nextDir: string): Promise<string[]> {
  const srcDir = path.join(nextDir, 'src');
  const excludeDir = path.join(nextDir, 'src', 'styles', 'framer');
  const allFiles = await walkDir(srcDir, excludeDir);

  const matched: string[] = [];
  for (const file of allFiles) {
    const ext = path.extname(file).toLowerCase();
    if (!CODE_EXTENSIONS.has(ext)) continue;
    try {
      const content = await fs.readFile(file, 'utf8');
      if (hasFramerClassName(content)) {
        matched.push(file);
      }
    } catch {
      // Skip unreadable files
    }
  }
  return matched;
}

/**
 * Removes `import '@/styles/framer/…';` lines from .tsx files in `src/`, deletes `src/styles/framer/`,
 * and returns the number of files changed.
 */
export async function dropFramerCss(nextDir: string): Promise<number> {
  const srcDir = path.join(nextDir, 'src');
  const excludeDir = path.join(nextDir, 'src', 'styles', 'framer');
  const allFiles = await walkDir(srcDir, excludeDir);

  const importRe = /^\s*import\s+['"]@\/styles\/framer\/[^'"]*['"];?\s*$/;
  let changedCount = 0;

  for (const file of allFiles) {
    if (!file.endsWith('.tsx')) continue;
    try {
      const content = await fs.readFile(file, 'utf8');
      const lines = content.split(/\r?\n/);
      const filtered = lines.filter((line) => !importRe.test(line));
      if (filtered.length !== lines.length) {
        const eol = content.includes('\r\n') ? '\r\n' : '\n';
        await writeFileAtomic(file, filtered.join(eol));
        changedCount++;
      }
    } catch {
      // Skip files that can't be read/written
    }
  }

  const cssDir = path.join(nextDir, 'src', 'styles', 'framer');
  await fs.rm(cssDir, { recursive: true, force: true });

  return changedCount;
}

export interface FinalizeDeps {
  check(id: string): Promise<CheckResult>;
  build(): Promise<{ ok: boolean; log: string }>;
  report(): Promise<{ file: string }>;
}

export interface FinalizeResult {
  buildOk: boolean;
  fixTask?: string;
  report?: string;
}

/**
 * Runs the finalize stage of the conversion pipeline:
 * - Drops Framer CSS only when framerClassFiles is empty, else issues a warning.
 * - When testing is enabled: re-checks every done shell and section task; any failures become 'needs-review'.
 * - Runs production build.
 * - On build failure: writes or updates a 'fix-build' task. After 2 failures, marks it 'needs-review' and stage 'failed'.
 * - When testing is enabled and build succeeds: generates verification report.
 * - Sets stages.finalize = 'done' on success.
 */
export async function runFinalize(
  ctx: StageContext,
  deps: FinalizeDeps
): Promise<FinalizeResult> {
  const isTesting = ctx.state.options?.testing !== false;

  const classFiles = await framerClassFiles(ctx.nextDir);
  if (classFiles.length === 0) {
    await dropFramerCss(ctx.nextDir);
  } else {
    const msg = `finalize: Framer CSS kept; framer- classes remain in ${classFiles.length} files`;
    ctx.log(msg);
    if (ctx.state.warnings) {
      ctx.state.warnings.push(msg);
    }
  }

  if (isTesting) {
    const doneTasks = Object.values(ctx.state.tasks)
      .filter((t) => (t.kind === 'shell' || t.kind === 'section') && t.status === 'done')
      .sort((a, b) => a.id.localeCompare(b.id));

    for (const task of doneTasks) {
      const res = await deps.check(task.id);
      if (!res.pass) {
        task.status = 'needs-review';
      }
    }
  }

  const buildRes = await deps.build();
  if (!buildRes.ok) {
    let attempts = 1;
    const existingFix = ctx.state.tasks['fix-build'];
    if (existingFix) {
      attempts = (existingFix.attempts || 0) + 1;
      existingFix.attempts = attempts;
      if (attempts >= 2) {
        existingFix.status = 'needs-review';
        ctx.state.stages.finalize = 'failed';
        await saveState(ctx.state);
        return { buildOk: false, fixTask: 'fix-build' };
      }
      existingFix.status = 'pending';
    } else {
      const fixTask: TaskRecord = {
        id: 'fix-build',
        kind: 'fix',
        targets: ['src/'],
        file: '.convert/tasks/fix-build.md',
        status: 'pending',
        attempts,
      };
      ctx.state.tasks['fix-build'] = fixTask;
    }

    const fixFilePath = path.join(ctx.nextDir, '.convert', 'tasks', 'fix-build.md');
    const templateContent = renderTemplate('fix', {
      taskId: 'fix-build',
      attempt: String(attempts),
      targets: '- `src/`',
      failures: buildRes.log || 'Production build failed.',
      rules: SHARED_RULES,
      doneWhen: `Run \`${checkCommand('fix-build', isTesting)}\` and stop when it passes or reports the limit.`,
    });
    await writeFileAtomic(fixFilePath, templateContent);
    await saveState(ctx.state);
    return { buildOk: false, fixTask: 'fix-build' };
  }

  if (ctx.state.tasks['fix-build']) {
    ctx.state.tasks['fix-build'].status = 'done';
  }

  let reportFile: string | undefined;
  if (isTesting) {
    const rep = await deps.report();
    reportFile = rep.file;
  }

  ctx.state.stages.finalize = 'done';
  await saveState(ctx.state);

  return {
    buildOk: true,
    ...(reportFile ? { report: reportFile } : {}),
  };
}
