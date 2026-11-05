import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { hasFramerClassName } from '../stages/finalize.js';

const SOURCE_EXTENSIONS = new Set(['.tsx', '.ts']);
const SKIP_DIRS = new Set(['node_modules', '.next', '.git']);

/**
 * Checks source files for Framer export class names (class attributes only, so `data-framer-name` and
 * `framer-motion` imports are fine) and missing required motion data attributes.
 */
export function codeViolations(
  sources: Array<{ file: string; text: string }>,
  requiredMotion: string[]
): string[] {
  const violations: string[] = [];

  for (const { file, text } of sources) {
    if (hasFramerClassName(text)) {
      violations.push(`${file}: framer- class name`);
    }
  }

  for (const id of requiredMotion) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\bdata-motion\\s*=\\s*["'{][^"'>}]*?\\b${escaped}\\b[^"'>}]*?["'}]`);
    const found = sources.some((s) => re.test(s.text));
    if (!found) {
      violations.push(`missing data-motion="${id}"`);
    }
  }

  return violations;
}

async function walkSources(dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await walkSources(full, out);
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
}

/**
 * Reads the task's target files. A directory target (`src/components/hero/`) expands recursively to its
 * `.tsx` / `.ts` files so code split out of the main file is still inspected. Missing targets are skipped.
 */
export async function readTargetSources(
  root: string,
  targets: string[]
): Promise<Array<{ file: string; text: string }>> {
  const sources: Array<{ file: string; text: string }> = [];
  const seen = new Set<string>();
  for (const rel of targets) {
    const abs = path.resolve(root, rel);
    const files: string[] = [];
    if (/[\\/]$/.test(rel)) {
      await walkSources(abs, files);
    } else {
      files.push(abs);
    }
    for (const file of files) {
      if (seen.has(file)) continue;
      seen.add(file);
      try {
        const text = await readFile(file, 'utf8');
        sources.push({ file: path.relative(root, file).split(path.sep).join('/'), text });
      } catch {
        // file might not exist yet, or the target is a directory without a trailing slash
        const nested: string[] = [];
        await walkSources(file, nested);
        for (const n of nested) {
          if (seen.has(n)) continue;
          seen.add(n);
          try {
            sources.push({
              file: path.relative(root, n).split(path.sep).join('/'),
              text: await readFile(n, 'utf8')
            });
          } catch {
            // skip
          }
        }
      }
    }
  }
  return sources;
}
