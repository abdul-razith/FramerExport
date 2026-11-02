import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Analysis } from '../../types.js';
import type { PlatformAdapter, StageContext } from '../types.js';
import { extractBaseCss } from './base-css.js';
import { buildSlice, findComponents } from './components.js';
import { derivePages } from './routes.js';
import { extractTokens } from './tokens.js';

async function analyze(ctx: StageContext, opts?: { animations?: boolean }): Promise<Analysis> {
  if (opts?.animations !== false) throw new Error('animation observation is wired in Task 11');
  const { exportDir, nextDir } = ctx;
  const pages = await derivePages(exportDir);
  ctx.log(`found ${pages.length} page(s)`);
  const loaded = await Promise.all(
    pages.map(async (p) => ({
      route: p.route,
      html: await readFile(path.join(exportDir, p.sourceFile), 'utf8')
    }))
  );
  const indexHtml = await readFile(path.join(exportDir, 'index.html'), 'utf8');
  const tokens = extractTokens(indexHtml, exportDir);
  const components = findComponents(loaded);
  ctx.log(`found ${components.length} component(s)`);

  const sliceDir = path.join(nextDir, '.convert', 'analysis', 'slices');
  await mkdir(sliceDir, { recursive: true });
  for (const c of components) {
    const page = loaded.find((l) => l.route === c.pages[0]) ?? loaded[0]!;
    await writeFile(path.join(nextDir, c.slice), buildSlice(page.html, c.selector), 'utf8');
  }
  await writeFile(path.join(sliceDir, '_base.css'), extractBaseCss(indexHtml), 'utf8');
  return { pages, tokens, components, animations: [] };
}

export const framerAdapter: PlatformAdapter = {
  id: 'framer',
  async canHandle(exportDir) {
    try {
      const report = JSON.parse(await readFile(path.join(exportDir, 'export-report.json'), 'utf8'));
      return report?.platform === 'framer';
    } catch {
      return false;
    }
  },
  analyze,
  sectionRootsSelector: '#main > *',
  async settle() {
    throw new Error('settle is implemented in Task 11');
  }
};
