import fs from 'node:fs/promises';
import path from 'node:path';
import { log, warn, success } from '../logger/index.js';
import type { NextjsOptions } from './options.js';
import { emptyReport, renderReport, type ConversionReport } from './report.js';
import type { ConversionContext, PageModel } from './model.js';

export interface ConversionSource {
  outDir: string;
  siteUrl: string;
  platform: { name: string };
  subpages: Map<string, string>;
}

interface ExportReport {
  source?: string;
  platform?: string;
}

async function readExportReport(exportDir: string): Promise<ExportReport | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(exportDir, 'export-report.json'), 'utf8'));
  } catch {
    return null;
  }
}

function routeDir(route: string): string {
  return route === '/' ? 'app' : `app${route}`;
}

const PLACEHOLDER = `export default function Page() {
  return (
    <main style={{ padding: 48 }}>
      <p>This page could not be converted. See CONVERSION-REPORT.md for the reason.</p>
    </main>
  );
}
`;

/** The full rule-based pipeline. Writes into nextjs.tmp/ and swaps it in only on success. */
async function convert(exportDir: string, sourceUrl: string, options: NextjsOptions): Promise<ConversionReport> {
  const report = emptyReport();
  const finalDir = path.join(exportDir, 'nextjs');
  const tmpDir = path.join(exportDir, 'nextjs.tmp');
  const cacheDir = path.join(exportDir, '.nextjs-cache');
  const ctx: ConversionContext = { exportDir, sourceUrl, outDir: tmpDir, cacheDir, options, report, log };

  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
    const { listExportPages, capturePages } = await import('./capture.js');
    const { extractStartStates } = await import('./framer/animations.js');
    const { mergeBreakpoints } = await import('./framer/breakpoints.js');
    const { attachMotion, motionUsage } = await import('./framer/motion-map.js');
    const { detectCollections, collectionRoutes, itemToMdx } = await import('./framer/collections.js');
    const { planComponents } = await import('./components.js');
    const { extractContent, ImageNamer } = await import('./content.js');
    const { collectTokens } = await import('./tokens.js');
    const { extractFontFaces } = await import('./fonts.js');
    const { writeProject } = await import('./emit/project.js');

    const list = listExportPages(exportDir, sourceUrl);
    const exportHtml = new Map(list.map((p) => [p.route, p.exportHtml]));
    const { captured, failed } = await capturePages(list, ctx);
    for (const f of failed) report.pages.push({ route: f.route, status: 'failed', error: f.error });

    const pages: PageModel[] = [];
    for (const c of captured) {
      try {
        const root = mergeBreakpoints(c, extractStartStates(exportHtml.get(c.route) ?? ''), report);
        attachMotion(root);
        pages.push({ route: c.route, sourceUrl: c.url, title: c.title, meta: c.meta, root, screenshots: c.screenshots });
        report.pages.push({ route: c.route, status: 'ok' });
      } catch (e) {
        report.pages.push({ route: c.route, status: 'failed', error: (e as Error).message });
      }
    }
    if (!pages.length) throw new Error('No page could be captured; nothing to convert.');
    const order = new Map(list.map((p, i) => [p.route, i]));
    pages.sort((a, b) => (order.get(a.route) ?? 0) - (order.get(b.route) ?? 0));
    report.pages.sort((a, b) => (order.get(a.route) ?? 0) - (order.get(b.route) ?? 0));

    const origin = new URL(sourceUrl).origin;
    const collections = detectCollections(pages);
    const itemRoutes = collectionRoutes(collections);
    const regular = pages.filter((p) => !itemRoutes.has(p.route));
    const images = new ImageNamer();
    const plan = planComponents(regular, report);
    const { files, bindings } = extractContent(plan, report, images, origin);
    const byRoute = new Map(pages.map((p) => [p.route, p]));
    const colls = collections.map((c) => {
      const usedSlugs = new Set<string>();
      const items = c.itemRoutes.map((r) =>
        itemToMdx(byRoute.get(r)!, c, { exportHtml: exportHtml.get(r) ?? '', images, usedSlugs })
      );
      return { c, items, itemPage: byRoute.get(c.itemRoutes[0])! };
    });

    if (process.env.FRAMER_NEXTJS_TEST_FAIL === 'emit') {
      throw new Error('Simulated failure (FRAMER_NEXTJS_TEST_FAIL=emit)');
    }

    await writeProject(
      tmpDir,
      {
        siteName: pages[0].title.split(/\s[-|–]\s/)[0] || new URL(sourceUrl).hostname,
        siteOrigin: origin,
        exportDir,
        tokens: collectTokens(pages.map((p) => p.root)),
        fonts: extractFontFaces(exportDir, list.map((p) => p.exportHtml)),
        plan,
        content: files,
        bindings,
        collections: colls,
        pages: regular,
        motion: new Set(pages.flatMap((p) => [...motionUsage(p.root)])),
        images,
      },
      (message) => {
        log(message);
        report.unconverted.push({ route: '(project)', what: message, why: 'see log' });
      }
    );
    for (const f of report.pages.filter((p) => p.status === 'failed')) {
      const file = path.join(tmpDir, routeDir(f.route), 'page.tsx');
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, PLACEHOLDER);
    }

    if (options.verify) {
      const { verifyProject } = await import('./verify.js');
      await verifyProject(tmpDir, pages, ctx);
    }
    if (options.aiRefine) log('AI refine is not available in this build yet; keeping the rule-based result.');

    await fs.writeFile(path.join(tmpDir, 'CONVERSION-REPORT.md'), renderReport(report));
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(path.join(cacheDir, 'report.json'), JSON.stringify(report, null, 2));
    await fs.rm(finalDir, { recursive: true, force: true });
    await fs.rename(tmpDir, finalDir);
    return report;
  } catch (e) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    report.fatal = (e as Error).stack ?? String(e);
    await fs.writeFile(path.join(exportDir, 'nextjs-error-report.md'), renderReport(report)).catch(() => undefined);
    await fs.mkdir(cacheDir, { recursive: true }).catch(() => undefined);
    await fs.writeFile(path.join(cacheDir, 'report.json'), JSON.stringify(report, null, 2)).catch(() => undefined);
    return report;
  }
}

function summarize(report: ConversionReport): void {
  const ok = report.pages.filter((p) => p.status === 'ok').length;
  log(`Next.js conversion: ${ok}/${report.pages.length} pages converted`);
  if (report.build) log(`Build: ${report.build.ok ? 'passed' : 'failed'}`);
  const low = report.similarity.filter((s) => s.score < 0.97);
  if (report.similarity.length) {
    log(`Visual similarity: ${report.similarity.length - low.length}/${report.similarity.length} checks at or above 97%`);
  }
}

/** Called after a successful export. Never throws: the static export must stay usable. */
export async function runNextConversion(exporter: ConversionSource, options: NextjsOptions): Promise<void> {
  if (exporter.platform.name !== 'framer') {
    warn('Next.js conversion supports Framer sites only; skipped');
    return;
  }
  try {
    log('Starting Next.js conversion...');
    const report = await convert(exporter.outDir, exporter.siteUrl, options);
    summarize(report);
    if (report.fatal) warn('Next.js conversion failed. See nextjs-error-report.md');
    else success('Next.js project written to nextjs/ (see nextjs/CONVERSION-REPORT.md)');
  } catch (e) {
    warn('Next.js conversion failed: ' + (e as Error).message);
  }
}

/** `framer-export to-nextjs <export-dir>`. Returns the process exit code. */
export async function runToNextjs(exportDir: string, options: NextjsOptions): Promise<number> {
  const exportReport = await readExportReport(exportDir);
  if (!exportReport || !exportReport.source) {
    warn(`${exportDir} is not a framer-export output folder (export-report.json missing or invalid)`);
    return 1;
  }
  if (exportReport.platform !== 'framer') {
    warn(`Next.js conversion supports Framer exports only; this export is "${exportReport.platform ?? 'unknown'}"`);
    return 1;
  }
  const report = await convert(exportDir, exportReport.source, options);
  summarize(report);
  if (report.fatal) {
    warn('Next.js conversion failed. See nextjs-error-report.md');
    return 1;
  }
  success(`Next.js project written to ${path.join(exportDir, 'nextjs')}`);
  return 0;
}
