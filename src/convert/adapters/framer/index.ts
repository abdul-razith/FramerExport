import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer, { type Browser } from 'puppeteer';
import type { Analysis, AnimationEntry, PageInfo } from '../../types.js';
import type { PlatformAdapter, StageContext } from '../types.js';
import { extractBaseCss } from './base-css.js';
import { buildSlice, findComponents } from './components.js';
import { derivePages } from './routes.js';
import { extractTokens } from './tokens.js';
import { observeAnimations } from './animations.js';
import { pageSections } from './sections.js';
import { settleExport } from '../../verify/settle.js';
import { startExportServer } from '../../verify/serve.js';
import { warn } from '../../../logger/index.js';

async function analyze(ctx: StageContext, opts?: { animations?: boolean }): Promise<Analysis> {
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
  const animations = opts?.animations === false ? [] : await observeExport(ctx, pages);
  return { pages, tokens, components, animations };
}

/**
 * Serve the export and record runtime animations on every static route plus the first slug of each
 * dynamic route (a dynamic page's `sourceFile` is its first member). The browser and server are always torn down.
 */
async function observeExport(ctx: StageContext, pages: PageInfo[]): Promise<AnimationEntry[]> {
  const server = await startExportServer(ctx.exportDir);
  let browser: Browser | undefined;
  const entries: AnimationEntry[] = [];
  try {
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    for (const p of pages) {
      // Entries carry the pages.json route (`/blog/[slug]` for dynamic pages) so they join with pages.json.
      const route = p.route;
      const url = server.url + (p.sourceFile === 'index.html' ? '/' : '/' + p.sourceFile);
      try {
        await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
        const found = await observeAnimations(page, route);
        ctx.log(`animations: ${route}: ${found.length} observed`);
        entries.push(...found);
      } catch (err) {
        warn(`animations: ${route}: observation failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } finally {
    await browser?.close().catch(() => {});
    await server.stop();
  }
  return entries;
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
  sections: pageSections,
  settle: settleExport
};
