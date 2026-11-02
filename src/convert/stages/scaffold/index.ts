import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { StageContext } from '../../adapters/types.js';
import { saveState } from '../../state.js';
import type { Analysis, ComponentInfo, PageInfo, Tokens } from '../../types.js';
import { generateFiles } from './files.js';

export { generateFiles } from './files.js';
export { STACK_VERSIONS } from './versions.js';

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
const exists = (p: string) => readFile(p).then(() => true, () => false);

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw error;
  }
}

async function readIfExists(file: string): Promise<string> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return '';
  }
}

async function listFiles(dir: string, ext: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith(ext)).map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

/** Images from assets/images referenced by page HTML or CMS content. */
async function collectImages(ctx: StageContext): Promise<Record<string, string>> {
  let available: string[];
  try {
    available = await readdir(path.join(ctx.exportDir, 'assets', 'images'));
  } catch {
    return {};
  }
  const have = new Set(available);
  const sources = [
    path.join(ctx.exportDir, 'index.html'),
    ...(await listFiles(path.join(ctx.exportDir, 'subpages'), '.html')),
    ...(await listFiles(path.join(ctx.nextDir, 'src', 'content'), '.ts')),
  ];
  const used = new Set<string>();
  for (const file of sources) {
    const text = await readIfExists(file);
    for (const m of text.matchAll(/(?:assets\/images|\/images)\/([A-Za-z0-9._%~@+-]+)/g)) {
      let name = m[1]!;
      try {
        name = decodeURIComponent(name);
      } catch {}
      if (have.has(name)) used.add(name);
      else if (have.has(m[1]!)) used.add(m[1]!);
    }
  }
  const manifest: Record<string, string> = {};
  for (const name of [...used].sort()) manifest[`assets/images/${name}`] = `/images/${name}`;
  return manifest;
}

async function copyInto(src: string, dest: string): Promise<boolean> {
  if (!(await exists(src))) return false;
  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(src, dest);
  return true;
}

export async function runScaffold(
  ctx: StageContext,
  opts: { confirmOverwrite?: (file: string) => Promise<boolean> } = {},
): Promise<{ written: string[]; skipped: string[] }> {
  const dir = path.join(ctx.nextDir, '.convert', 'analysis');
  const required = async <T>(name: string): Promise<T> => {
    const value = await readJson<T | null>(path.join(dir, name), null);
    if (value === null) throw new Error(`scaffold requires analysis: missing ${name}; run analyze first`);
    return value;
  };
  const pages = await required<PageInfo[]>('pages.json');
  const tokens = await required<Tokens>('tokens.json');
  ctx.state.warnings = ctx.state.warnings.filter((w) => !w.startsWith('scaffold:'));
  const components = await readJson<ComponentInfo[] | null>(path.join(dir, 'components.json'), null);
  if (components === null) ctx.state.warnings.push('scaffold: components.json missing; treated as empty');
  const analysis: Analysis = { pages, tokens, components: components ?? [], animations: [] };

  const report = await readJson<{ source?: unknown }>(path.join(ctx.exportDir, 'export-report.json'), {});
  let siteOrigin: string | undefined;
  try {
    if (typeof report.source === 'string') siteOrigin = new URL(report.source).origin;
  } catch {}

  const imageManifest = await collectImages(ctx);
  const files = generateFiles(analysis, imageManifest, siteOrigin);

  const written: string[] = [];
  const skipped: string[] = [];
  for (const [rel, content] of files) {
    const abs = path.join(ctx.nextDir, ...rel.split('/'));
    const onDisk = await readIfExists(abs);
    const present = await exists(abs);
    if (present) {
      const stored = ctx.state.fileHashes[rel];
      const untouched = stored !== undefined ? sha256(onDisk) === stored : onDisk === content;
      if (!untouched && onDisk !== content && !(await opts.confirmOverwrite?.(rel))) {
        skipped.push(rel);
        ctx.state.warnings.push(`scaffold: kept edited file ${rel}`);
        continue;
      }
    }
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf8');
    ctx.state.fileHashes[rel] = sha256(content);
    written.push(rel);
  }

  for (const font of analysis.tokens.fonts) {
    for (const f of font.files) {
      const base = path.posix.basename(f.path.replaceAll('\\', '/'));
      const ok = await copyInto(
        path.join(ctx.exportDir, ...f.path.split('/')),
        path.join(ctx.nextDir, 'public', 'fonts', base),
      );
      if (!ok) ctx.state.warnings.push(`scaffold: font file missing in export: ${f.path}`);
    }
  }
  for (const exportPath of Object.keys(imageManifest)) {
    await copyInto(
      path.join(ctx.exportDir, ...exportPath.split('/')),
      path.join(ctx.nextDir, 'public', 'images', path.posix.basename(exportPath)),
    );
  }
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'images.json'), JSON.stringify(imageManifest, null, 2) + '\n', 'utf8');

  ctx.state.stages.scaffold = 'done';
  await saveState(ctx.state);
  ctx.log(`scaffold: ${written.length} written, ${skipped.length} skipped`);
  return { written, skipped };
}
