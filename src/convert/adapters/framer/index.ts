import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import type { Analysis, AnimationEntry, PageInfo } from '../../types.js';
import type { PlatformAdapter, StageContext } from '../types.js';
import { extractBaseCss } from './base-css.js';
import { buildSlice, findComponents } from './components.js';
import { derivePages } from './routes.js';
import { extractTokens } from './tokens.js';
import { observeAnimations } from './animations.js';
import { pageSections } from './sections.js';
import { readSsrChanges, ssrAppearCandidates, ssrAppearEntries, withoutObserved, type SsrChange } from './ssr-appear.js';
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
  const animations = opts?.animations === false ? [] : await observeExport(ctx, pages, loaded.map((l) => l.html));
  return { pages, tokens, components, animations };
}

/**
 * Observe runtime animations on a loaded page, plus appear effects recovered from the export HTML's SSR
 * initial styles that the observer did not already record. The SSR state is read once the page has
 * settled (~2.5 s, before scrolling) and again, back at the top, after observation (for effects that wait
 * for a loader).
 */
export async function observePage(page: Page, route: string, html: string): Promise<AnimationEntry[]> {
  const candidates = ssrAppearCandidates(html);
  const changes: SsrChange[] = [];
  const read = async (only?: Set<number>) => {
    try {
      changes.push(...(await readSsrChanges(page, candidates, only)));
    } catch (err) {
      warn(`animations: ${route}: SSR appear check failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const found = await observeAnimations(page, route, { onSettled: () => read() });
  if (candidates.length) {
    await page.evaluate('window.scrollTo(0, 0)').catch(() => {});
    await new Promise((r) => setTimeout(r, 100));
    const seen = new Set(changes.map((c) => c.i));
    await read(new Set(candidates.map((_, i) => i).filter((i) => !seen.has(i))));
  }
  changes.sort((a, b) => a.i - b.i);
  const ssr = ssrAppearEntries(route, candidates, changes);
  return [...found, ...(await withoutObserved(page, ssr, found))];
}

/**
 * Serve the export and record runtime animations on every static route plus the first slug of each
 * dynamic route (a dynamic page's `sourceFile` is its first member). The browser and server are always torn down.
 */
async function observeExport(ctx: StageContext, pages: PageInfo[], htmls: string[]): Promise<AnimationEntry[]> {
  const server = await startExportServer(ctx.exportDir);
  let browser: Browser | undefined;
  const entries: AnimationEntry[] = [];
  try {
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    for (const [i, p] of pages.entries()) {
      // Entries carry the pages.json route (`/blog/[slug]` for dynamic pages) so they join with pages.json.
      const route = p.route;
      const url = server.url + (p.sourceFile === 'index.html' ? '/' : '/' + p.sourceFile);
      try {
        await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
        const found = await observePage(page, route, htmls[i] ?? '');
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
