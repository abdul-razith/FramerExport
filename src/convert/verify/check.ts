import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { readManifest, type GeneratedManifest } from '../generate/manifest.js';
import { kebabName } from '../generate/names.js';
import { routeSlug } from '../stages/tasks.js';
import { loadState, writeFileAtomic } from '../state.js';
import type { Box, TaskRecord } from '../types.js';
import { baselineDir, BASELINE_WIDTHS } from './baseline.js';
import { capturePageSections } from './capture-sections.js';
import { diffClusters } from './clusters.js';
import { codeViolations, readTargetSources } from './check-code.js';
import { requiredMotionIds, runMotionOnFreshPage, taskMotionAnchors } from './check-motion.js';
import { ensureDevServer, resolveDevUrl } from './dev-server.js';
import { compareDom, type DomMismatch, type SectionDom } from './dom-check.js';
import { movedTowards } from './motion-check.js';
import { settleNext, withVerifyFlag } from './settle.js';

export { checkMotion, movedTowards } from './motion-check.js';
export { codeViolations };

export interface WidthResult {
  width: number;
  ratio: number;
  heightDelta: number;
  pass: boolean;
  clusters: Box[];
  images?: {
    expected: string;
    actual: string;
    diff: string;
  };
}

export interface MotionResult {
  id: string;
  pass: boolean;
  lowConfidence: boolean;
  detail: string;
}

export interface CheckResult {
  taskId: string;
  mode: 'smoke' | 'full';
  pass: boolean;
  limitReached: boolean;
  widths: WidthResult[];
  dom: DomMismatch[];
  code: string[];
  motion: MotionResult[];
  errors: string[];
}

export const CHECK_LIMIT_MESSAGE =
  'Limit reached: stop and finish; the pipeline will review this section.';

/** A first `next dev` compile can take well over a minute on Windows. */
const NAVIGATION_TIMEOUT_MS = 120_000;

const checkLocks = new Map<string, Promise<unknown>>();

async function withCheckLock<T>(root: string, taskId: string, fn: () => Promise<T>): Promise<T> {
  const key = `${path.resolve(root)}:${taskId}`;
  const prev = checkLocks.get(key) ?? Promise.resolve();
  let release: () => void = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  checkLocks.set(key, prev.then(() => current, () => current));

  await prev.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (checkLocks.get(key) === current) {
      checkLocks.delete(key);
    }
  }
}

function checkFilePath(root: string, taskId: string): string {
  return path.join(root, '.convert', 'checks', `${taskId}.json`);
}

async function readCheckCalls(root: string, taskId: string): Promise<number> {
  try {
    const raw = await readFile(checkFilePath(root, taskId), 'utf8');
    const parsed = JSON.parse(raw);
    return typeof parsed?.calls === 'number' ? parsed.calls : 0;
  } catch {
    return 0;
  }
}

async function incrementCheckCalls(root: string, taskId: string): Promise<number> {
  return withCheckLock(root, taskId, async () => {
    const current = await readCheckCalls(root, taskId);
    const updated = current + 1;
    const filePath = checkFilePath(root, taskId);
    await writeFileAtomic(filePath, JSON.stringify({ calls: updated }, null, 2) + '\n');
    return updated;
  });
}

export async function resetCheckCalls(root: string, taskId: string): Promise<void> {
  return withCheckLock(root, taskId, async () => {
    const filePath = checkFilePath(root, taskId);
    await writeFileAtomic(filePath, JSON.stringify({ calls: 0 }, null, 2) + '\n');
  });
}

/**
 * Formats a CheckResult for display.
 * First line is `PASS <id>`, `FAIL <id>`, or the limit message.
 */
export function formatCheck(r: CheckResult): string {
  if (r.limitReached) {
    return CHECK_LIMIT_MESSAGE;
  }

  const lines: string[] = [];
  lines.push(r.pass ? `PASS ${r.taskId}` : `FAIL ${r.taskId}`);

  if (r.mode === 'smoke') {
    lines.push('  mode: smoke');
  }

  for (const w of r.widths) {
    const status = w.pass ? 'PASS' : 'FAIL';
    const pct = (w.ratio * 100).toFixed(2);
    lines.push(
      `  ${w.width}px: ${status} (ratio ${pct}%, delta ${w.heightDelta}px, ${w.clusters.length} clusters)`
    );
    if (w.images) {
      lines.push(`    diff: ${w.images.diff}`);
      lines.push(`    expected: ${w.images.expected}`);
      lines.push(`    actual: ${w.images.actual}`);
    }
  }

  for (const d of r.dom) {
    lines.push(
      `  dom: [${d.kind}] expected "${d.expected}" vs actual "${d.actual}" (section ${d.section})`
    );
  }

  for (const c of r.code) {
    lines.push(`  code: ${c}`);
  }

  for (const m of r.motion) {
    const status = m.pass ? 'PASS' : 'FAIL';
    const conf = m.lowConfidence ? ' [low-confidence]' : '';
    lines.push(`  motion: ${m.id} ${status}${conf} - ${m.detail}`);
  }

  for (const e of r.errors) {
    lines.push(`  error: ${e}`);
  }

  return lines.join('\n');
}

function determineTaskRoute(task: TaskRecord, manifest: GeneratedManifest | null): string {
  if (task.kind === 'shell') {
    if (manifest?.shell) {
      const sh = manifest.shell.find(
        (s) =>
          s.name === task.section ||
          kebabName(s.name) === kebabName(task.section || '') ||
          task.id.endsWith(kebabName(s.name))
      );
      if (sh?.pages && sh.pages.length > 0) {
        return sh.pages[0];
      }
    }
    return task.route || '/';
  }
  return task.route || '/';
}

function routeToPath(route: string, manifest: GeneratedManifest | null): string {
  if (!manifest) return route;
  const page = manifest.pages.find((p) => p.route === route);
  if (page?.dynamic?.firstSlug) {
    return route.replace(/\[[^\]]+\]/g, page.dynamic.firstSlug);
  }
  return route;
}

function buildUrl(base: string, pathname: string): string {
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  const p = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${b}${p}`;
}

/** Copy `src` onto an opaque white canvas of w x h. */
function pad(src: PNG, w: number, h: number): PNG {
  if (src.width === w && src.height === h) return src;
  const out = new PNG({ width: w, height: h });
  out.data.fill(255);
  PNG.bitblt(src, out, 0, 0, Math.min(src.width, w), Math.min(src.height, h), 0, 0);
  return out;
}

async function getSectionBox(page: Page, name: string): Promise<Box | null> {
  return (await page.evaluate(
    `((name) => {
      let el = null;
      try {
        const escaped = (window.CSS && window.CSS.escape)
          ? window.CSS.escape(name)
          : name.replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"');
        el = document.querySelector('[data-section="' + escaped + '"]');
      } catch (e) {}
      if (!el && name.includes('/')) {
        try {
          const root = name.split('/')[0];
          const escaped = (window.CSS && window.CSS.escape)
            ? window.CSS.escape(root)
            : root.replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"');
          el = document.querySelector('[data-section="' + escaped + '"]');
        } catch (e) {}
      }
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height };
    })(${JSON.stringify(name)})`
  )) as Box | null;
}

/**
 * Executes a fast section or page check against the baseline.
 */
export async function runCheck(
  root: string,
  taskId: string,
  opts?: {
    smoke?: boolean;
    countCall?: boolean;
    devUrl?: string;
    browser?: Browser;
  }
): Promise<CheckResult> {
  const mode = opts?.smoke ? 'smoke' : 'full';
  const shouldCount = opts?.countCall !== false;

  if (shouldCount) {
    const calls = await incrementCheckCalls(root, taskId);
    if (calls >= 4) {
      console.log(CHECK_LIMIT_MESSAGE);
      return {
        taskId,
        mode,
        pass: false,
        limitReached: true,
        widths: [],
        dom: [],
        code: [],
        motion: [],
        errors: []
      };
    }
  }

  const state = await loadState(root);
  if (!state) {
    return {
      taskId,
      mode,
      pass: false,
      limitReached: false,
      widths: [],
      dom: [],
      code: [],
      motion: [],
      errors: [`Could not load state from ${root}`]
    };
  }

  // A fix task is judged like the task it fixes (shell/page/section); only the call counter keys on its own id.
  let task = state.tasks[taskId];
  for (let hops = 0; task?.kind === 'fix' && task.fixOf && state.tasks[task.fixOf] && hops < 5; hops++) {
    task = state.tasks[task.fixOf];
  }
  if (!task) {
    return {
      taskId,
      mode,
      pass: false,
      limitReached: false,
      widths: [],
      dom: [],
      code: [],
      motion: [],
      errors: [`Unknown task: ${taskId}`]
    };
  }

  let devUrl = opts?.devUrl;
  if (!devUrl) {
    // The server is left running for the loop to reuse (spec 8.1).
    const server = await ensureDevServer(root, { keepAlive: true });
    devUrl = server.url;
  } else {
    // The pool's devUrl goes stale when the server was restarted on another port.
    devUrl = await resolveDevUrl(root, devUrl);
  }

  const manifest = await readManifest(root).catch(() => null);
  const route = determineTaskRoute(task, manifest);
  const concretePath = routeToPath(route, manifest);
  const targetUrl = buildUrl(devUrl, concretePath);

  // Read sources for code violations (directory targets expand recursively)
  const targetFiles =
    task.targets && task.targets.length > 0 ? task.targets : task.file ? [task.file] : [];
  const sources = await readTargetSources(root, targetFiles);

  const requiredMotion = requiredMotionIds(manifest, task);

  const code = codeViolations(sources, requiredMotion);
  const dom: DomMismatch[] = [];
  const widths: WidthResult[] = [];
  const motion: MotionResult[] = [];
  const errors: string[] = [];

  const ownsBrowser = !opts?.browser;
  const browser =
    opts?.browser ?? (await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }));

  let openedPage: Page | undefined;
  try {
    const page = await browser.newPage();
    openedPage = page;
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);

    if (mode === 'smoke') {
      let httpStatus = 200;
      const onResponse = (res: any) => {
        try {
          if (res.request().isNavigationRequest() && res.frame() === page.mainFrame()) {
            httpStatus = res.status();
          }
        } catch {}
      };
      page.on('response', onResponse);

      try {
        await page.setViewport({ width: 1440, height: 900 });
        const target = withVerifyFlag(targetUrl);
        const res = await page.goto(target, { waitUntil: 'load', timeout: NAVIGATION_TIMEOUT_MS });
        if (res) {
          httpStatus = res.status();
        }
        await settleNext(page).catch(() => {});
      } catch (err: any) {
        errors.push(`Navigation failed: ${err.message || String(err)}`);
      } finally {
        page.off('response', onResponse);
      }

      if (httpStatus >= 400) {
        errors.push(`HTTP ${httpStatus}`);
      }

      // A page task has no section of its own: every section of the page must be present.
      const smokeNames =
        task.kind === 'page' ? task.sections ?? [] : [task.section || task.id];
      for (const sectionName of smokeNames) {
        const box = await getSectionBox(page, sectionName);
        if (!box || box.width <= 0 || box.height <= 0) {
          errors.push(`Zero-size or missing section "${sectionName}"`);
        }
      }

      const pass = errors.length === 0;
      widths.push({
        width: 1440,
        ratio: 0,
        heightDelta: 0,
        pass,
        clusters: []
      });

      return {
        taskId,
        mode,
        pass,
        limitReached: false,
        widths,
        dom,
        code,
        motion,
        errors
      };
    }

    // Full mode: check widths [1440, 1000, 390]
    const sectionNames =
      task.kind === 'page' && task.sections && task.sections.length > 0
        ? task.sections
        : [task.section || task.id];

    const pixelTolerance = state.options?.pixelTolerance ?? 0.01;

    for (const width of BASELINE_WIDTHS) {
      let sectionCaptures: Map<string, any>;
      try {
        sectionCaptures = await capturePageSections(page, targetUrl, width, sectionNames);
      } catch (err: any) {
        errors.push(`Capture failed at ${width}px: ${err.message || String(err)}`);
        widths.push({
          width,
          ratio: 1,
          heightDelta: 0,
          pass: false,
          clusters: []
        });
        continue;
      }

      if (task.kind !== 'page') {
        const secName = task.section || task.id;
        const capture =
          sectionCaptures.get(secName) ??
          (secName.includes('/') ? sectionCaptures.get(secName.split('/')[0]) : undefined);

        if (!capture) {
          errors.push(`Section "${secName}" not found on ${targetUrl} at ${width}px`);
          widths.push({
            width,
            ratio: 1,
            heightDelta: 0,
            pass: false,
            clusters: []
          });
          continue;
        }

        const bDir = baselineDir(root, task);
        const expPngPath = path.join(bDir, `${width}.png`);
        const expJsonPath = path.join(bDir, `${width}.json`);

        if (!existsSync(expPngPath) || !existsSync(expJsonPath)) {
          errors.push(`Missing baseline at ${width}px for ${task.id}: ${bDir}`);
          widths.push({
            width,
            ratio: 1,
            heightDelta: 0,
            pass: false,
            clusters: []
          });
          continue;
        }

        const expPng = PNG.sync.read(await readFile(expPngPath));
        const expDom = JSON.parse(await readFile(expJsonPath, 'utf8')) as SectionDom;

        const heightDelta = capture.png.height - expPng.height;
        const w = Math.max(expPng.width, capture.png.width);
        const h = Math.max(expPng.height, capture.png.height);
        const ep = pad(expPng, w, h);
        const ap = pad(capture.png, w, h);
        const diff = new PNG({ width: w, height: h });
        const mismatched = pixelmatch(ep.data, ap.data, diff.data, w, h, {
          threshold: 0.1,
          includeAA: false
        });
        const ratio = mismatched / (w * h);
        const pass = ratio <= pixelTolerance && Math.abs(heightDelta) <= 4;
        const clusters = pass ? [] : diffClusters(diff, 3);

        let images: WidthResult['images'];
        if (!pass) {
          const checksDir = path.join(root, '.convert', 'checks', taskId);
          await mkdir(checksDir, { recursive: true });
          const expImg = path.join(checksDir, `${width}-expected.png`);
          const actImg = path.join(checksDir, `${width}-actual.png`);
          const diffImg = path.join(checksDir, `${width}-diff.png`);
          await writeFileAtomic(expImg, PNG.sync.write(ep));
          await writeFileAtomic(actImg, PNG.sync.write(ap));
          await writeFileAtomic(diffImg, PNG.sync.write(diff));
          images = {
            expected: expImg,
            actual: actImg,
            diff: diffImg
          };
        }

        widths.push({
          width,
          ratio,
          heightDelta,
          pass,
          clusters,
          images
        });

        // DOM check
        const domMismatches = compareDom([expDom], [capture.dom], { routes: {}, images: {} });
        for (const m of domMismatches) {
          if (
            !dom.some(
              (d) =>
                d.section === m.section &&
                d.kind === m.kind &&
                d.expected === m.expected &&
                d.actual === m.actual
            )
          ) {
            dom.push(m);
          }
        }
      } else {
        // Page task: compare every section on the page
        let pagePass = true;
        let maxRatio = 0;
        let maxHeightDelta = 0;
        const pageClusters: Box[] = [];
        let firstImages: WidthResult['images'];

        for (const secName of sectionNames) {
          const capture =
            sectionCaptures.get(secName) ??
            (secName.includes('/') ? sectionCaptures.get(secName.split('/')[0]) : undefined);

          if (!capture) {
            errors.push(`Section "${secName}" not found on ${targetUrl} at ${width}px`);
            pagePass = false;
            continue;
          }

          const secTask: TaskRecord = Object.values(state.tasks).find(
            (t) =>
              (t.route === task.route || !t.route) &&
              (t.section === secName || t.id.endsWith(kebabName(secName)))
          ) ?? {
            id: `sec-${routeSlug(task.route || '/')}-${kebabName(secName)}`,
            kind: 'section',
            route: task.route,
            section: secName,
            file: '',
            targets: [],
            status: 'pending',
            attempts: 0
          };

          const bDir = baselineDir(root, secTask);
          const expPngPath = path.join(bDir, `${width}.png`);
          const expJsonPath = path.join(bDir, `${width}.json`);

          if (!existsSync(expPngPath) || !existsSync(expJsonPath)) {
            // A root split into parts has no baseline of its own unless one was captured: its parts are
            // judged by their own tasks.
            const hasParts = Object.values(state.tasks).some(
              (t) =>
                t.kind === 'section' &&
                (t.route === task.route || !t.route) &&
                (t.section ?? '').startsWith(`${secName}/`)
            );
            if (hasParts) continue;
            errors.push(`Missing baseline at ${width}px for section ${secName}: ${bDir}`);
            pagePass = false;
            continue;
          }

          const expPng = PNG.sync.read(await readFile(expPngPath));
          const expDom = JSON.parse(await readFile(expJsonPath, 'utf8')) as SectionDom;

          const heightDelta = capture.png.height - expPng.height;
          const w = Math.max(expPng.width, capture.png.width);
          const h = Math.max(expPng.height, capture.png.height);
          const ep = pad(expPng, w, h);
          const ap = pad(capture.png, w, h);
          const diff = new PNG({ width: w, height: h });
          const mismatched = pixelmatch(ep.data, ap.data, diff.data, w, h, {
            threshold: 0.1,
            includeAA: false
          });
          const ratio = mismatched / (w * h);
          const secPass = ratio <= pixelTolerance && Math.abs(heightDelta) <= 4;

          maxRatio = Math.max(maxRatio, ratio);
          if (Math.abs(heightDelta) > Math.abs(maxHeightDelta)) {
            maxHeightDelta = heightDelta;
          }

          if (!secPass) {
            pagePass = false;
            const secClusters = diffClusters(diff, 3);
            pageClusters.push(...secClusters);

            if (!firstImages) {
              const checksDir = path.join(root, '.convert', 'checks', taskId);
              await mkdir(checksDir, { recursive: true });
              const expImg = path.join(checksDir, `${width}-expected.png`);
              const actImg = path.join(checksDir, `${width}-actual.png`);
              const diffImg = path.join(checksDir, `${width}-diff.png`);
              await writeFileAtomic(expImg, PNG.sync.write(ep));
              await writeFileAtomic(actImg, PNG.sync.write(ap));
              await writeFileAtomic(diffImg, PNG.sync.write(diff));
              firstImages = {
                expected: expImg,
                actual: actImg,
                diff: diffImg
              };
            }
          }

          const domMismatches = compareDom([expDom], [capture.dom], { routes: {}, images: {} });
          for (const m of domMismatches) {
            if (
              !dom.some(
                (d) =>
                  d.section === m.section &&
                  d.kind === m.kind &&
                  d.expected === m.expected &&
                  d.actual === m.actual
              )
            ) {
              dom.push(m);
            }
          }
        }

        widths.push({
          width,
          ratio: maxRatio,
          heightDelta: maxHeightDelta,
          pass: pagePass,
          clusters: pageClusters.slice(0, 3),
          images: firstImages
        });
      }
    }

    // Motion presence check in full mode, on a fresh tab (see runMotionOnFreshPage)
    const taskAnchors = taskMotionAnchors(manifest, task, sectionNames, requiredMotion);
    if (taskAnchors.length > 0) {
      try {
        motion.push(...(await runMotionOnFreshPage(browser, targetUrl, taskAnchors)));
      } catch (err: any) {
        errors.push(`Motion check failed: ${err.message || String(err)}`);
      }
    }
  } finally {
    await openedPage?.close().catch(() => {});
    if (ownsBrowser) {
      await browser.close().catch(() => {});
    }
  }

  const pass =
    !errors.length &&
    widths.length > 0 &&
    widths.every((w) => w.pass) &&
    dom.length === 0 &&
    code.length === 0 &&
    motion.every((m) => m.pass || m.lowConfidence);

  return {
    taskId,
    mode,
    pass,
    limitReached: false,
    widths,
    dom,
    code,
    motion,
    errors
  };
}
