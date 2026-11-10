import { existsSync, readdirSync, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { warn } from '../logger/index.js';
import { capturePages, listExportPages, type CapturedPage } from '../nextjs/capture.js';
import { looseHash, pageStructure } from '../nextjs/components.js';
import { ImageNamer } from '../nextjs/content.js';
import { extractStartStates } from '../nextjs/framer/animations.js';
import { mergeBreakpoints } from '../nextjs/framer/breakpoints.js';
import { detectCollections, fullText, toIsoDate, type Collection } from '../nextjs/framer/collections.js';
import { attachMotion } from '../nextjs/framer/motion-map.js';
import { extractFontFaces } from '../nextjs/fonts.js';
import type { Breakpoint, ConversionContext, Node, PageModel } from '../nextjs/model.js';
import { emptyReport } from '../nextjs/report.js';
import { collectTokens } from '../nextjs/tokens.js';
import { cropPng } from './crops.js';
import { motionFromNodes, renderMotionMd, summarizeLoad } from './motion.js';
import { buildGuidePage, renderOutline, sectionStem } from './outline.js';
import { renderPlan, writePlanFile } from './plan.js';
import { recordPage } from './record.js';
import { renderContentMd, renderFilesMd, renderSiteMd, renderTokensMd } from './site-docs.js';
import { AGENTS_MD } from './templates/agents.js';
import { CHECKLIST_MD } from './templates/checklist.js';
import { COMPARE_MJS } from './templates/compare.js';
import { renderReadme } from './templates/readme.js';
import type { GuideCollection, GuideLink, GuidePage, GuideSite, MotionEntry } from './types.js';

export { takeAiGuideFlag } from './flag.js';

const SHOT_NAMES: Record<Breakpoint, string> = { base: 'desktop', tablet: 'tablet', mobile: 'mobile' };
const FRAME_EVERY_MS = 200;

/** Maps a captured image URL to its file in the export: Framer keeps the file ID in the name. */
function assetLookup(exportDir: string): (src: string) => string | undefined {
  const dir = path.join(exportDir, 'assets', 'images');
  const files = existsSync(dir) ? readdirSync(dir) : [];
  return (src) => {
    let stem = '';
    try {
      stem = path.posix.basename(new URL(src, 'http://local').pathname);
    } catch {
      return undefined;
    }
    const base = stem.replace(/\.[a-z0-9]+$/i, '');
    const hit = files.find((f) => f === stem) ?? files.find((f) => f.startsWith(base + '-') || f.startsWith(base + '.'));
    return hit ? `assets/images/${hit}` : undefined;
  };
}

/** Which export file holds each route (`index.html` or `subpages/<file>.html`). */
function exportFiles(exportDir: string, pages: { route: string; exportHtml: string }[]): Map<string, string> {
  const out = new Map<string, string>([['/', 'index.html']]);
  const sub = path.join(exportDir, 'subpages');
  const files = existsSync(sub) ? readdirSync(sub).filter((f) => f.endsWith('.html')) : [];
  const byContent = new Map(files.map((f) => [readFileSync(path.join(sub, f), 'utf8'), f]));
  for (const p of pages) if (p.route !== '/') out.set(p.route, `subpages/${byContent.get(p.exportHtml) ?? p.route.slice(1).replace(/\//g, '_') + '.html'}`);
  return out;
}

function linksIn(node: Node, origin: string): GuideLink[] {
  const out: GuideLink[] = [];
  const walk = (n: Node) => {
    if (n.tag === 'a' && n.attrs.href) {
      const text = fullText(n).replace(/\s+/g, ' ').trim();
      let href = n.attrs.href;
      try {
        const u = new URL(href, origin);
        if (u.origin === origin) href = u.pathname.replace(/\/+$/, '') || '/';
      } catch {}
      if (text && !out.some((l) => l.text === text && l.href === href)) out.push({ text, href });
      return;
    }
    n.children.forEach(walk);
  };
  walk(node);
  return out;
}

/** First element matching `test` (depth-first), for finding the navigation and the footer. */
function find(node: Node, test: (n: Node) => boolean): Node | undefined {
  if (test(node)) return node;
  for (const c of node.children) {
    const hit = find(c, test);
    if (hit) return hit;
  }
  return undefined;
}

function guideCollection(c: Collection, byRoute: Map<string, PageModel>, lookup: (src: string) => string | undefined, files: Map<string, string>): GuideCollection {
  const fieldNode = (page: PageModel, nodeKey: string) => find(page.root, (n) => n.key === nodeKey);
  const dateField = c.fields.find((f) => f.kind === 'date');
  const coverField = c.fields.find((f) => f.kind === 'image');
  return {
    name: c.name,
    indexRoute: c.indexRoute,
    itemPattern: `${c.indexRoute}/[slug]`,
    items: c.itemRoutes.map((route) => {
      const page = byRoute.get(route)!;
      const dateNode = dateField && fieldNode(page, dateField.nodeKey);
      const cover = coverField && fieldNode(page, coverField.nodeKey)?.asset?.src;
      return {
        slug: route.split('/').pop()!,
        route,
        title: page.title.split(/\s[-|–]\s/)[0],
        date: dateNode ? toIsoDate(fullText(dateNode)) : undefined,
        cover: cover ? (lookup(cover) ?? cover) : undefined,
        exportFile: files.get(route) ?? '',
      };
    }),
    fields: c.fields.map((f) => ({ key: f.key, kind: f.kind })),
  };
}

async function writeCrops(dir: string, page: GuidePage, captured: CapturedPage): Promise<void> {
  for (const s of page.sections) {
    for (const [bp, name] of Object.entries(SHOT_NAMES) as [Breakpoint, string][]) {
      const box = s.boxes[bp];
      if (box) await cropPng(captured.screenshots[bp], box, path.join(dir, 'sections', `${sectionStem(s)}-${name}.png`));
    }
  }
}

/** Empties ai-guide/ but keeps plan.md, so ticked progress survives (writePlanFile decides). */
async function resetGuideDir(guideDir: string): Promise<void> {
  await fs.mkdir(guideDir, { recursive: true });
  for (const entry of await fs.readdir(guideDir)) {
    if (entry !== 'plan.md') await fs.rm(path.join(guideDir, entry), { recursive: true, force: true });
  }
}

async function build(exportDir: string, sourceUrl: string, guideDir: string, log: (m: string) => void): Promise<void> {
  await resetGuideDir(guideDir);
  const list = listExportPages(exportDir, sourceUrl);
  if (process.env.FRAMER_AIGUIDE_TEST_FAIL) throw new Error('Simulated failure (FRAMER_AIGUIDE_TEST_FAIL)');
  const report = emptyReport();
  const ctx: ConversionContext = {
    exportDir,
    sourceUrl,
    outDir: guideDir,
    cacheDir: path.join(guideDir, '.capture'),
    options: { aiRefine: false, verify: false, cliSkipPermissions: true },
    report,
    log,
  };
  const { captured, failed } = await capturePages(list, ctx);
  for (const f of failed) log(`AI guide: could not capture ${f.route} (${f.error})`);
  if (!captured.length) throw new Error('No page could be captured.');

  const exportHtml = new Map(list.map((p) => [p.route, p.exportHtml]));
  const files = exportFiles(exportDir, list);
  const pages: PageModel[] = captured.map((c) => {
    const root = attachMotion(mergeBreakpoints(c, extractStartStates(exportHtml.get(c.route) ?? ''), report));
    return { route: c.route, sourceUrl: c.url, title: c.title, meta: c.meta, root, screenshots: c.screenshots };
  });
  const byRoute = new Map(pages.map((p) => [p.route, p]));
  const capturedBy = new Map(captured.map((c) => [c.route, c]));
  const collections = detectCollections(pages);
  const itemOf = new Map(collections.flatMap((c) => c.itemRoutes.map((r) => [r, c.name] as const)));
  const origin = new URL(sourceUrl).origin;
  const images = new ImageNamer();
  const lookup = assetLookup(exportDir);

  const guidePages: GuidePage[] = pages.map((p) => {
    const c = capturedBy.get(p.route)!;
    const page = buildGuidePage({ route: p.route, title: p.title, exportFile: files.get(p.route) ?? '', root: p.root, trees: c.trees, images, origin, localAsset: lookup });
    const collection = itemOf.get(p.route);
    return collection ? { ...page, collection } : page;
  });

  // Section screenshots, reference screenshots, recordings and motion notes, page by page.
  const firstItems = new Set(collections.map((c) => c.itemRoutes[0]));
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    for (const page of guidePages) {
      const dir = path.join(guideDir, 'pages', page.slug);
      const c = capturedBy.get(page.route)!;
      await fs.mkdir(dir, { recursive: true });
      for (const [bp, name] of Object.entries(SHOT_NAMES) as [Breakpoint, string][]) {
        await fs.copyFile(c.screenshots[bp], path.join(dir, `${name}.png`));
      }
      await writeCrops(dir, page, c);
      const entries: MotionEntry[] = motionFromNodes(byRoute.get(page.route)!.root, c.hover);
      if (!page.collection || firstItems.has(page.route)) {
        log(`AI guide: recording ${page.route}`);
        const rec = await recordPage(browser, c.url, dir, { frameEveryMs: FRAME_EVERY_MS });
        entries.push(...summarizeLoad(rec.samples, FRAME_EVERY_MS));
        entries.push(...summarizeLoad(rec.midSamples, FRAME_EVERY_MS, 'loop').filter((e) => e.trigger === 'loop'));
      }
      await fs.writeFile(path.join(dir, 'outline.md'), renderOutline(page));
      await fs.writeFile(path.join(dir, 'motion.md'), renderMotionMd(page, entries));
    }
  } finally {
    await browser.close().catch(() => undefined);
  }

  const home = byRoute.get('/') ?? pages[0];
  const navNode = find(home.root, (n) => n.tag === 'nav' || /^(nav|navigation|menu|header)/i.test(n.framerName ?? '') || n.tag === 'header');
  const footerNode = find(home.root, (n) => n.tag === 'footer' || /footer/i.test(n.framerName ?? ''));
  const shared = new Map<string, { name: string; routes: string[] }>();
  for (const p of pages.filter((x) => !itemOf.has(x.route))) {
    for (const s of pageStructure(p.root).sections) {
      const h = looseHash(s);
      const entry = shared.get(h) ?? { name: s.framerName ?? s.tag, routes: [] };
      if (!entry.routes.includes(p.route)) entry.routes.push(p.route);
      shared.set(h, entry);
    }
  }
  const usedImages = new Set(guidePages.flatMap((p) => p.sections.flatMap((s) => s.images.map((i) => i.exportPath))));
  const listDir = (d: string) => (existsSync(path.join(exportDir, d)) ? readdirSync(path.join(exportDir, d)).map((f) => `${d}/${f}`) : []);
  const site: GuideSite = {
    name: pages[0].title.split(/\s[-|–]\s/)[0] || new URL(sourceUrl).hostname,
    sourceUrl,
    pages: guidePages,
    collections: collections.map((c) => guideCollection(c, byRoute, lookup, files)),
    nav: navNode ? linksIn(navNode, origin) : [],
    footer: footerNode ? linksIn(footerNode, origin) : [],
    sharedSections: [...shared.values()].filter((s) => s.routes.length > 1),
    tokens: collectTokens(pages.map((p) => p.root)),
    fonts: extractFontFaces(exportDir, list.map((p) => p.exportHtml)),
    exportFiles: {
      images: listDir('assets/images')
        .filter((f) => !usedImages.has(f))
        .map((f) => ({ exportPath: f, suggested: `/images/${path.basename(f)}`, width: 0, height: 0, alt: '' })),
      videos: listDir('assets/videos'),
      data: listDir('data'),
    },
  };

  await fs.writeFile(path.join(guideDir, 'site.md'), renderSiteMd(site));
  await fs.writeFile(path.join(guideDir, 'files.md'), renderFilesMd(site));
  await fs.writeFile(path.join(guideDir, 'content.md'), renderContentMd(site));
  await fs.writeFile(path.join(guideDir, 'tokens.md'), renderTokensMd(site));
  await fs.writeFile(path.join(guideDir, 'README.md'), renderReadme(site));
  await fs.writeFile(path.join(guideDir, 'checklist.md'), CHECKLIST_MD);
  await fs.mkdir(path.join(guideDir, 'scripts'), { recursive: true });
  await fs.writeFile(path.join(guideDir, 'scripts', 'compare.mjs'), COMPARE_MJS);
  const planFile = await writePlanFile(guideDir, renderPlan(site));
  if (planFile === 'plan.new.md') log('AI guide: plan.md has ticked steps, so the new plan was written to ai-guide/plan.new.md');
  await fs.writeFile(path.join(exportDir, 'AGENTS.md'), AGENTS_MD);
  await fs.writeFile(path.join(exportDir, 'CLAUDE.md'), AGENTS_MD);
}

/** Writes AGENTS.md, CLAUDE.md and ai-guide/ into a Framer export. Never throws. */
export async function runAiGuide(
  exportDir: string,
  sourceUrl: string,
  log: (m: string) => void
): Promise<{ ok: boolean; guideDir: string }> {
  const guideDir = path.join(exportDir, 'ai-guide');
  try {
    log('Writing the AI guide...');
    await build(exportDir, sourceUrl, guideDir, log);
    log(`AI guide written to ${guideDir} — open the export folder in Claude Code or agy (see ai-guide/README.md)`);
    return { ok: true, guideDir };
  } catch (e) {
    const err = e as Error;
    await fs.mkdir(guideDir, { recursive: true }).catch(() => undefined);
    await fs
      .writeFile(path.join(guideDir, 'ERROR.md'), `# The AI guide could not be written\n\n${err.message}\n\n\`\`\`\n${err.stack ?? ''}\n\`\`\`\n\nThe HTML export itself is complete and usable.\n`)
      .catch(() => undefined);
    warn(`AI guide failed: ${err.message} (see ai-guide/ERROR.md)`);
    return { ok: false, guideDir };
  } finally {
    await fs.rm(path.join(guideDir, '.capture'), { recursive: true, force: true }).catch(() => undefined);
  }
}

/** `framer-export ai-guide <export-dir>`. Returns the process exit code. */
export async function runAiGuideCommand(exportDir: string): Promise<number> {
  let report: { source?: string; platform?: string } | null = null;
  try {
    report = JSON.parse(await fs.readFile(path.join(exportDir, 'export-report.json'), 'utf8'));
  } catch {}
  if (!report?.source) {
    warn(`${exportDir} is not a framer-export output folder (export-report.json missing or invalid)`);
    return 1;
  }
  if (report.platform !== 'framer') {
    warn(`The AI guide supports Framer exports only; this export is "${report.platform ?? 'unknown'}"`);
    return 1;
  }
  const { ok } = await runAiGuide(exportDir, report.source, (m) => console.log(`  ${m}`));
  return ok ? 0 : 1;
}
