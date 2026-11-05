import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { framerAdapter } from '../adapters/framer/index.js';
import type { PlatformAdapter, StageContext } from '../adapters/types.js';
import { readManifest } from '../generate/manifest.js';
import { kebabName } from '../generate/names.js';
import { routeSlug, sectionsWithFallback } from '../stages/tasks.js';
import type { PageInfo } from '../types.js';
import { BASELINE_WIDTHS } from './baseline.js';
import { capturePage } from './capture.js';
import { crop, pad, pairByName } from './diff.js';
import { captureFilmstrip } from './filmstrip.js';
import { renderReportHtml, type ReportData } from './report-html.js';
import { startExportServer, startNextServer } from './serve.js';
import { withVerifyFlag } from './settle.js';

export { type ReportData };

export interface ReportDeps {
  startExportServer: typeof startExportServer;
  startNextServer: typeof startNextServer;
  launchBrowser: () => Promise<Browser>;
  sleep: (ms: number) => Promise<void>;
  captureFilmstrip: typeof captureFilmstrip;
  maskDelayMs?: number;
  widths?: readonly number[];
  adapter?: PlatformAdapter;
}

/**
 * Compute a dynamic mask comparing two captures of the same page/section (taken at different times).
 * Returns a Uint8Array of length `w * h`, where element is 1 if pixel differs (or outside smaller bounds),
 * and 0 if identical.
 */
export function dynamicMask(a: PNG, b: PNG): Uint8Array {
  const w = Math.max(a.width, b.width);
  const h = Math.max(a.height, b.height);
  const mask = new Uint8Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (x >= a.width || y >= a.height || x >= b.width || y >= b.height) {
        mask[idx] = 1;
        continue;
      }
      const aPos = (y * a.width + x) * 4;
      const bPos = (y * b.width + x) * 4;
      if (
        a.data[aPos] !== b.data[bPos] ||
        a.data[aPos + 1] !== b.data[bPos + 1] ||
        a.data[aPos + 2] !== b.data[bPos + 2] ||
        a.data[aPos + 3] !== b.data[bPos + 3]
      ) {
        mask[idx] = 1;
      }
    }
  }

  return mask;
}

/**
 * Compare expected vs actual images ignoring pixels flagged in `mask`.
 * Masked pixels are excluded from both numerator (diffCount) and denominator (unmaskedTotal).
 * If `diffOut` is provided, the pixelmatch visual diff is rendered into it.
 */
export function maskedRatio(expected: PNG, actual: PNG, mask: Uint8Array, diffOut?: PNG): number {
  const w = Math.max(expected.width, actual.width);
  const h = Math.max(expected.height, actual.height);
  const ep = pad(expected, w, h);
  const ap = pad(actual, w, h);

  let finalMask = mask;
  if (mask.length !== w * h) {
    finalMask = new Uint8Array(w * h);
    const maskW = expected.width;
    const maskH = expected.height;
    for (let y = 0; y < Math.min(maskH, h); y++) {
      for (let x = 0; x < Math.min(maskW, w); x++) {
        finalMask[y * w + x] = mask[y * maskW + x];
      }
    }
  }

  const outData = diffOut ? diffOut.data : null;
  const count = pixelmatch(ep.data, ap.data, outData, w, h, {
    threshold: 0.1,
    ignoreMask: finalMask
  });

  let unmaskedTotal = 0;
  for (let i = 0; i < w * h; i++) {
    if (!finalMask[i]) {
      unmaskedTotal++;
    }
  }

  return unmaskedTotal === 0 ? 0 : count / unmaskedTotal;
}

interface RouteJob {
  route: string;
  slug: string;
  exportFile: string;
  nextPath: string;
}

function exportUrl(base: string, file: string): string {
  const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
  return cleanBase + (file === 'index.html' ? '/' : '/' + file.replace(/^\//, ''));
}

function nextUrl(base: string, nextPath: string): string {
  const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const p = nextPath.startsWith('/') ? nextPath : '/' + nextPath;
  return cleanBase + p;
}

/**
 * Run end-to-end report generation:
 * - Starts Next.js and export servers
 * - Captures export twice 2 s apart to detect dynamic regions
 * - Captures Next.js page and compares sections across 3 widths using maskedRatio
 * - Captures filmstrips for original vs Next.js
 * - Writes images and .convert/report/index.html
 * - Returns { file, over } where over is the count of section widths exceeding tolerance.
 */
export async function runReport(
  ctx: StageContext,
  opts: { tolerance: number; route?: string },
  deps?: Partial<ReportDeps>
): Promise<{ file: string; over: number }> {
  const t0 = Date.now();
  const reportDir = path.join(ctx.nextDir, '.convert', 'report');
  const imagesDir = path.join(reportDir, 'images');
  await mkdir(imagesDir, { recursive: true });

  const startExport = deps?.startExportServer ?? startExportServer;
  const startNext = deps?.startNextServer ?? startNextServer;
  const launchBrowser = deps?.launchBrowser ?? (() => puppeteer.launch({ headless: true, args: ['--no-sandbox'] }));
  const sleep = deps?.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const filmstripFn = deps?.captureFilmstrip ?? captureFilmstrip;
  const maskDelayMs = deps?.maskDelayMs ?? 2000;
  const widths = deps?.widths ?? BASELINE_WIDTHS;
  const adapter = deps?.adapter ?? framerAdapter;

  const manifest = await readManifest(ctx.nextDir).catch(() => null);

  // Discover routes to verify
  let routeJobs: RouteJob[] = [];

  const pagesFile = path.join(ctx.nextDir, '.convert', 'analysis', 'pages.json');
  let analysisPages: PageInfo[] = [];
  try {
    const raw = await readFile(pagesFile, 'utf8');
    analysisPages = JSON.parse(raw);
  } catch {}

  if (manifest && manifest.pages && manifest.pages.length > 0) {
    for (const p of manifest.pages) {
      const slug = p.slug || routeSlug(p.route);
      let nextPath = p.route;
      let exportFile = p.route === '/' ? 'index.html' : `${slug}.html`;
      if (p.dynamic?.firstSlug) {
        nextPath = p.route.replace(/\[[^\]]+\]/g, p.dynamic.firstSlug);
        const parent = p.route.replace(/^\//, '').split('/')[0]!;
        exportFile = `subpages/${parent.split('/').join('_')}_${p.dynamic.firstSlug}.html`;
      }
      const pageInfo = analysisPages.find((ap) => ap.route === p.route);
      if (pageInfo) {
        exportFile = pageInfo.sourceFile;
      }
      routeJobs.push({ route: p.route, slug, exportFile, nextPath });
    }
  } else if (analysisPages.length > 0) {
    for (const p of analysisPages) {
      const slug = routeSlug(p.route);
      if (p.dynamic) {
        const parent = p.route.replace(/^\//, '').split('/')[0]!;
        const first = p.dynamic.slugs[0] ?? 'sample';
        const file = `subpages/${parent.split('/').join('_')}_${first}.html`;
        routeJobs.push({ route: p.route, slug, exportFile: file, nextPath: `/${parent}/${first}` });
      } else {
        routeJobs.push({ route: p.route, slug, exportFile: p.sourceFile, nextPath: p.route });
      }
    }
  } else {
    routeJobs.push({ route: '/', slug: 'home', exportFile: 'index.html', nextPath: '/' });
  }

  if (opts.route) {
    routeJobs = routeJobs.filter((r) => r.route === opts.route);
  }

  ctx.log('report: starting Next.js server');
  const nextServer = await startNext(ctx.nextDir);

  ctx.log('report: starting export server');
  const exportServer = await startExport(ctx.exportDir);

  const browser = await launchBrowser();
  let overCount = 0;
  const reportPages: ReportData['pages'] = [];

  try {
    const page = await browser.newPage();

    for (const job of routeJobs) {
      const { route, slug, exportFile, nextPath: np } = job;
      ctx.log(`report: processing route ${route}`);

      const origUrl = exportUrl(exportServer.url, exportFile);
      const targetNextUrl = nextUrl(nextServer.url, np);

      // Filmstrip capture
      ctx.log(`report: capturing filmstrip for ${route}`);
      const origFrames = await filmstripFn(page, origUrl, widths[0]);
      const nextFrames = await filmstripFn(page, withVerifyFlag(targetNextUrl), widths[0]);

      const origFilmstripPaths: string[] = [];
      for (let f = 0; f < origFrames.length; f++) {
        const filename = `filmstrip-${slug}-orig-${f}.png`;
        await writeFile(path.join(imagesDir, filename), origFrames[f]);
        origFilmstripPaths.push(`images/${filename}`);
      }

      const nextFilmstripPaths: string[] = [];
      for (let f = 0; f < nextFrames.length; f++) {
        const filename = `filmstrip-${slug}-next-${f}.png`;
        await writeFile(path.join(imagesDir, filename), nextFrames[f]);
        nextFilmstripPaths.push(`images/${filename}`);
      }

      // Read export HTML to extract section selectors
      const exportHtmlPath = path.join(ctx.exportDir, exportFile);
      const html = await readFile(exportHtmlPath, 'utf8').catch(() => '');
      const sections = sectionsWithFallback(adapter.sections(html));

      const sectionWidthsMap = new Map<
        string,
        Array<{
          width: number;
          ratio: number;
          pass: boolean;
          images: { original: string; next: string; diff: string };
        }>
      >();

      for (const width of widths) {
        ctx.log(`report: capturing ${route} @ ${width}px`);
        // First export capture
        const exp1 = await capturePage(page, origUrl, width, 'export', sections);
        if (maskDelayMs > 0) {
          await sleep(maskDelayMs);
        }
        // Second export capture (for dynamic masking)
        const exp2 = await capturePage(page, origUrl, width, 'export', sections);
        // Next capture
        const nxt = await capturePage(page, targetNextUrl, width, 'next', undefined);

        const exp1Png = PNG.sync.read(exp1.png);
        const exp2Png = PNG.sync.read(exp2.png);
        const nxtPng = PNG.sync.read(nxt.png);

        const pairs = pairByName(exp1.sections, nxt.sections);

        for (const [i, j] of pairs) {
          if (i !== null && j !== null) {
            const name = exp1.sections[i].name;
            const secE1 = crop(exp1Png, exp1.sections[i].box);
            const box2 = exp2.sections.find((s) => s.name === name)?.box ?? exp1.sections[i].box;
            const secE2 = crop(exp2Png, box2);
            const secNxt = crop(nxtPng, nxt.sections[j].box);

            const mask = dynamicMask(secE1, secE2);

            const maxW = Math.max(secE1.width, secNxt.width);
            const maxH = Math.max(secE1.height, secNxt.height);
            const diffPng = new PNG({ width: maxW, height: maxH });
            const ratio = maskedRatio(secE1, secNxt, mask, diffPng);
            const pass = ratio <= opts.tolerance;
            if (!pass) overCount++;

            const ep = pad(secE1, maxW, maxH);
            const np = pad(secNxt, maxW, maxH);

            const secKebab = kebabName(name);
            const origFile = `${slug}-${secKebab}-${width}-original.png`;
            const nextFile = `${slug}-${secKebab}-${width}-next.png`;
            const diffFile = `${slug}-${secKebab}-${width}-diff.png`;

            await writeFile(path.join(imagesDir, origFile), PNG.sync.write(ep));
            await writeFile(path.join(imagesDir, nextFile), PNG.sync.write(np));
            await writeFile(path.join(imagesDir, diffFile), PNG.sync.write(diffPng));

            if (!sectionWidthsMap.has(name)) {
              sectionWidthsMap.set(name, []);
            }
            sectionWidthsMap.get(name)!.push({
              width,
              ratio,
              pass,
              images: {
                original: `images/${origFile}`,
                next: `images/${nextFile}`,
                diff: `images/${diffFile}`
              }
            });
          } else if (i !== null && j === null) {
            const name = exp1.sections[i].name;
            const secE1 = crop(exp1Png, exp1.sections[i].box);
            overCount++;

            const secKebab = kebabName(name);
            const origFile = `${slug}-${secKebab}-${width}-original.png`;
            const nextFile = `${slug}-${secKebab}-${width}-next.png`;
            const diffFile = `${slug}-${secKebab}-${width}-diff.png`;

            const blank = new PNG({ width: secE1.width, height: secE1.height });
            blank.data.fill(220);

            await writeFile(path.join(imagesDir, origFile), PNG.sync.write(secE1));
            await writeFile(path.join(imagesDir, nextFile), PNG.sync.write(blank));
            await writeFile(path.join(imagesDir, diffFile), PNG.sync.write(blank));

            if (!sectionWidthsMap.has(name)) {
              sectionWidthsMap.set(name, []);
            }
            sectionWidthsMap.get(name)!.push({
              width,
              ratio: 1.0,
              pass: false,
              images: {
                original: `images/${origFile}`,
                next: `images/${nextFile}`,
                diff: `images/${diffFile}`
              }
            });
          } else if (i === null && j !== null) {
            const name = nxt.sections[j].name;
            const secNxt = crop(nxtPng, nxt.sections[j].box);
            overCount++;

            const secKebab = kebabName(name);
            const origFile = `${slug}-${secKebab}-${width}-original.png`;
            const nextFile = `${slug}-${secKebab}-${width}-next.png`;
            const diffFile = `${slug}-${secKebab}-${width}-diff.png`;

            const blank = new PNG({ width: secNxt.width, height: secNxt.height });
            blank.data.fill(220);

            await writeFile(path.join(imagesDir, origFile), PNG.sync.write(blank));
            await writeFile(path.join(imagesDir, nextFile), PNG.sync.write(secNxt));
            await writeFile(path.join(imagesDir, diffFile), PNG.sync.write(blank));

            if (!sectionWidthsMap.has(name)) {
              sectionWidthsMap.set(name, []);
            }
            sectionWidthsMap.get(name)!.push({
              width,
              ratio: 1.0,
              pass: false,
              images: {
                original: `images/${origFile}`,
                next: `images/${nextFile}`,
                diff: `images/${diffFile}`
              }
            });
          }
        }
      }

      const sectionsList = Array.from(sectionWidthsMap.entries()).map(([name, widthsData]) => ({
        name,
        widths: widthsData
      }));

      reportPages.push({
        route,
        sections: sectionsList,
        filmstrip: {
          original: origFilmstripPaths,
          next: nextFilmstripPaths
        }
      });
    }

    await page.close().catch(() => {});
  } finally {
    await browser.close().catch(() => {});
    await exportServer.stop().catch(() => {});
    await nextServer.stop().catch(() => {});
  }

  const needsReview = Object.values(ctx.state.tasks)
    .filter((t) => t.status === 'needs-review' || t.status === 'needs-human')
    .map((t) => t.id);

  const stubs = manifest?.stubs ?? [];

  const reportData: ReportData = {
    generatedAt: new Date().toISOString(),
    totalMs: Date.now() - t0,
    pages: reportPages,
    needsReview,
    stubs
  };

  const html = renderReportHtml(reportData);
  const reportFile = path.join(reportDir, 'index.html');
  await writeFile(reportFile, html, 'utf8');

  return { file: reportFile, over: overCount };
}
