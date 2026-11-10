import fs from 'node:fs/promises';
import path from 'node:path';
import { log, warn, success } from '../logger/index.js';
import type { NextjsOptions } from './options.js';
import { emptyReport, renderReport, type ConversionReport } from './report.js';
import type { ConversionContext, PageModel } from './model.js';
import type { ProjectModel } from './emit/project.js';

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

    const model: ProjectModel = {
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
    };
    const emit = async (dir: string, m: ProjectModel) => {
      await writeProject(dir, m, (message) => {
        log(message);
        report.unconverted.push({ route: '(project)', what: message, why: 'see log' });
      });
      for (const f of report.pages.filter((p) => p.status === 'failed')) {
        const file = path.join(dir, routeDir(f.route), 'page.tsx');
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, PLACEHOLDER);
      }
    };
    await emit(tmpDir, model);

    const { verifyProject } = await import('./verify.js');
    if (options.verify) await verifyProject(tmpDir, pages, ctx);

    if (options.aiRefine) {
      const { runRefine } = await import('./refine/index.js');
      const refined = await runRefine(model, ctx);
      if (refined !== model && (report.refine?.accepted ?? 0) > 0) {
        const refineDir = path.join(exportDir, 'nextjs.refine.tmp');
        await fs.rm(refineDir, { recursive: true, force: true });
        await emit(refineDir, refined);
        let keep = true;
        if (options.verify) {
          // Reuse the installed dependencies, then check the refined project once.
          await fs.rename(path.join(tmpDir, 'node_modules'), path.join(refineDir, 'node_modules')).catch(() => undefined);
          const before = { build: report.build, similarity: report.similarity };
          report.similarity = [];
          await verifyProject(refineDir, pages, ctx);
          const worse = report.similarity.filter((s) => {
            const b = before.similarity.find((x) => x.route === s.route && x.width === s.width)?.score ?? 1;
            return s.score < Math.min(0.97, b) - 0.005;
          });
          keep = !!report.build?.ok && worse.length === 0;
          if (!keep) {
            report.refine!.stoppedEarly =
              `Final check of the AI-refined project failed (${report.build?.ok ? `${worse.length} page/width checks got worse` : 'build failed'}); kept the rule-based project.`;
            report.build = before.build;
            report.similarity = before.similarity;
            await fs.rename(path.join(refineDir, 'node_modules'), path.join(tmpDir, 'node_modules')).catch(() => undefined);
          }
        }
        if (keep) {
          await fs.rm(tmpDir, { recursive: true, force: true });
          await fs.rename(refineDir, tmpDir);
        } else {
          await fs.rm(refineDir, { recursive: true, force: true });
        }
      }
    }

    // Swap safely: a rename either succeeds or changes nothing, unlike a recursive delete that can
    // fail half-way when a dev server or editor holds files in the old folder.
    let outputDir = finalDir;
    const oldDir = `${finalDir}.old`;
    try {
      if (process.env.FRAMER_NEXTJS_TEST_FAIL === 'swap') throw new Error('EBUSY: simulated lock');
      await fs.rm(oldDir, { recursive: true, force: true }).catch(() => undefined);
      if (await fs.stat(finalDir).then(() => true, () => false)) await fs.rename(finalDir, oldDir);
      await fs.rename(tmpDir, finalDir);
      await fs.rm(oldDir, { recursive: true, force: true }).catch(() => undefined);
    } catch (e) {
      outputDir = path.join(exportDir, 'nextjs.new');
      await fs.rm(outputDir, { recursive: true, force: true });
      await fs.rename(tmpDir, outputDir);
      const message = `The previous nextjs/ folder is in use (${(e as Error).message}); the new project was saved as nextjs.new/`;
      report.unconverted.push({ route: '(project)', what: message, why: 'Close programs using nextjs/ (dev server, editor), then replace it with nextjs.new/' });
      warn(message);
    }
    await fs.writeFile(path.join(outputDir, 'CONVERSION-REPORT.md'), renderReport(report));
    // An error report from an earlier failed run no longer describes the current output.
    await fs.rm(path.join(exportDir, 'nextjs-error-report.md'), { force: true });
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(path.join(cacheDir, 'report.json'), JSON.stringify(report, null, 2));
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
