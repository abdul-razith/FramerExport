import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer, { type Browser, type HTTPResponse, type Page } from 'puppeteer';
import { PNG } from 'pngjs';
import type { PlatformAdapter, StageContext } from '../adapters/types.js';
import { recordAttempt, saveState, writeFileAtomic } from '../state.js';
import type { ComponentInfo, PageInfo, TaskRecord } from '../types.js';
import { CLI_INVOCATION, SHARED_RULES } from '../tasks/templates/index.js';
import { capturePage, type CaptureResult } from '../verify/capture.js';
import { compareSections, crop, type SectionResult } from '../verify/diff.js';
import { compareDom, extractSectionDom, nextSections, type DomMismatch, type SectionDom } from '../verify/dom-check.js';
import { BuildFailedError, startExportServer, startNextServer } from '../verify/serve.js';
import { renderTemplate, routeSlug } from './tasks.js';

export const VERIFY_WIDTHS = [1440, 1000, 390] as const;
const BUILD_LOG_LINES = 80;
const MAX_TEXT = 400;
/** Synthetic task tracking consecutive build failures (capped by recordAttempt like any task). */
const BUILD_TASK = 'build';

export interface VerifyOptions {
  /** Page navigation timeout in ms (default 60 000). */
  navigationTimeoutMs?: number;
}

type Box = CaptureResult['sections'][number]['box'];

/** One verifiable route: the pages.json route plus the concrete export file and Next path that represent it. */
interface RouteJob {
  route: string;
  slug: string;
  exportFile: string;
  nextPath: string;
}

/** Cached reference data of one route at one width. */
interface ReferenceWidth {
  sections: CaptureResult['sections'];
  dom: SectionDom[];
  /** Section name -> names of the components with an instance inside that section. */
  components: Record<string, string[]>;
  /** First-instance document box of every component present on the page (null if absent or zero-size). */
  componentBoxes: Record<string, Box | null>;
}

/** `.convert/reference/<slug>/sections.json`: widths are valid only while `key` matches the export page. */
interface ReferenceCache {
  key: string;
  widths: Record<string, ReferenceWidth>;
}

type ReportSection = Omit<SectionResult, 'diffPng' | 'expectedPng' | 'actualPng'>;

interface WidthOutcome {
  sections: SectionResult[];
  dom: DomMismatch[];
  /** Infrastructure error (navigation timeout, browser, export server): no verdict for this width. */
  error?: string;
  /** Next answered the page with a 5xx status (`HTTP <status>`): a code defect, so a failure. */
  http?: string;
  /** Reference section -> component names, for component-task scoping. */
  components: Record<string, string[]>;
}

interface Report {
  generatedAt: string;
  build?: { failed: true; fixTask?: string; attempts: number };
  routes: Record<
    string,
    Record<string, { sections: ReportSection[]; dom: DomMismatch[]; http?: string; error?: string }>
  >;
  errors: Array<{ route: string; width: number; message: string }>;
  passed: string[];
  failed: string[];
  /** Tasks left untouched because infrastructure errors prevented a verdict. */
  skipped: string[];
  manualChecklist: Array<{ taskId: string; route?: string; file: string; status: string }>;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw error;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
/**
 * Cache key of `.convert/reference/<slug>/sections.json`: the export page plus every section's name and
 * selector, so a change in how selectors are built invalidates references captured with the old ones.
 */
export function referenceKey(html: string, sections: Array<{ name: string; selector: string }>): string {
  return sha256(html + '\u0000' + JSON.stringify(sections.map((s) => [s.name, s.selector])));
}
const code = (s: string): string => `\`${s}\``;
const bullets = (items: string[]): string => items.map((i) => `- ${i}`).join('\n');
const fileSafe = (s: string): string => s.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'section';
const truncate = (s: string): string => (s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) + '…' : s);
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** `/blog/[slug]` -> `blog`, `/a/b/[slug]` -> `a/b`. */
function dynamicParent(route: string): string {
  return route.replace(/\/\[slug\]$/, '').replace(/^\//, '');
}

/** Static pages as-is; a dynamic page is represented by its first slug. */
function routeJobs(pages: PageInfo[]): RouteJob[] {
  return pages.map((p) => {
    const slug = routeSlug(p.route);
    if (p.dynamic && p.dynamic.slugs.length) {
      const parent = dynamicParent(p.route);
      const first = p.dynamic.slugs[0]!;
      return {
        route: p.route,
        slug,
        exportFile: `subpages/${parent.split('/').join('_')}_${first}.html`,
        nextPath: `/${parent}/${first}`
      };
    }
    return { route: p.route, slug, exportFile: p.sourceFile, nextPath: p.route };
  });
}

/** Export-relative page file -> Next route, for normalizing export-side links. */
export function routesMap(pages: PageInfo[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const p of pages) {
    if (p.dynamic) {
      const parent = dynamicParent(p.route);
      for (const s of p.dynamic.slugs) map[`subpages/${parent.split('/').join('_')}_${s}.html`] = `/${parent}/${s}`;
    } else {
      map[p.sourceFile] = p.route;
    }
  }
  return map;
}

function exportUrl(base: string, file: string): string {
  return base + (file === 'index.html' ? '/' : '/' + file);
}

/** Sections -> contained component names, and first-instance boxes of every component, on the loaded page. */
async function componentLayout(
  page: Page,
  sections: Array<{ name: string; selector: string }>,
  components: ComponentInfo[]
): Promise<Pick<ReferenceWidth, 'components' | 'componentBoxes'>> {
  return (await page.evaluate(
    `((sections, comps) => {
      const q = (root, sel) => { try { return root.querySelector(sel); } catch (e) { return null; } };
      const m = (el, sel) => { try { return el.matches(sel); } catch (e) { return false; } };
      const components = {};
      for (const s of sections) {
        const el = q(document, s.selector);
        components[s.name] = el ? comps.filter((c) => m(el, c.selector) || q(el, c.selector)).map((c) => c.name) : [];
      }
      const componentBoxes = {};
      for (const c of comps) {
        const el = q(document, c.selector);
        if (!el) { componentBoxes[c.name] = null; continue; }
        const r = el.getBoundingClientRect();
        componentBoxes[c.name] = r.width > 0 && r.height > 0
          ? { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height }
          : null;
      }
      return { components, componentBoxes };
    })(${JSON.stringify(sections)}, ${JSON.stringify(components.map((c) => ({ name: c.name, selector: c.selector })))})`
  )) as Pick<ReferenceWidth, 'components' | 'componentBoxes'>;
}

/** Load a route's reference cache; a missing, stale (key mismatch) or corrupt file is a cache miss. */
async function readReference(file: string, key: string, warn: (msg: string) => void): Promise<ReferenceCache> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { key, widths: {} };
    throw error;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ReferenceCache>;
    if (parsed && parsed.key === key && parsed.widths && typeof parsed.widths === 'object') {
      return { key, widths: parsed.widths };
    }
  } catch {
    warn(`verify: corrupt reference cache ${file}; recapturing`);
  }
  return { key, widths: {} };
}

/** A precondition of verify is unmet; nothing was changed (no attempt used, no state written). */
export class VerifyRefusedError extends Error {}

export async function runVerify(
  ctx: StageContext,
  adapter: PlatformAdapter,
  target?: string,
  opts: VerifyOptions = {}
): Promise<{ passed: string[]; failed: string[] }> {
  const { state, nextDir, exportDir } = ctx;
  if (state.stages.scaffold !== 'done' || (state.stages.tasks !== 'needs-ai' && state.stages.tasks !== 'done')) {
    throw new VerifyRefusedError('Pipeline incomplete: run "fexport convert <exportDir>" first');
  }
  if (!(await exists(path.join(nextDir, 'node_modules')))) {
    throw new VerifyRefusedError(`Dependencies not installed: run "npm install" in ${nextDir}`);
  }
  const navigationTimeoutMs = opts.navigationTimeoutMs ?? 60_000;
  const convertDir = path.join(nextDir, '.convert');
  const analysisDir = path.join(convertDir, 'analysis');
  const diffsDir = path.join(convertDir, 'diffs');
  const refDir = path.join(convertDir, 'reference');
  const warn = (msg: string): void => {
    ctx.log(msg);
    if (!state.warnings.includes(msg)) state.warnings.push(msg);
  };

  try {
    state.warnings = state.warnings.filter((w) => !w.startsWith('verify:'));
    await rm(diffsDir, { recursive: true, force: true });
    await mkdir(diffsDir, { recursive: true });

    const pages = await readJson<PageInfo[]>(path.join(analysisDir, 'pages.json'), []);
    const components = await readJson<ComponentInfo[]>(path.join(analysisDir, 'components.json'), []);
    const images = await readJson<Record<string, string>>(path.join(analysisDir, 'images.json'), {});
    const jobs = routeJobs(pages);
    const routes = routesMap(pages);

    // ---- target selection -------------------------------------------------------------------------
    const tasks = Object.values(state.tasks);
    /** A fix task resolves to the (non-fix) task it fixes; build fixes resolve to nothing. */
    const originalOf = (t: TaskRecord): TaskRecord | undefined => {
      if (t.kind !== 'fix') return t;
      if (!t.id.startsWith('fix-')) return undefined;
      const original = state.tasks[t.id.replace(/^fix-/, '').replace(/-\d+$/, '')];
      return original && original.kind !== 'fix' ? original : undefined;
    };
    const routesOfTask = (t: TaskRecord): string[] => {
      if (t.kind === 'component') {
        const name = t.targets[0]?.replace(/^src\/components\//, '').replace(/\.tsx$/, '');
        return components.find((c) => c.name === name)?.pages ?? [];
      }
      return t.route ? [t.route] : [];
    };
    // Untargeted runs leave tasks that already need a human alone.
    const outstanding = (): TaskRecord[] => tasks.filter((t) => t.status !== 'done' && t.status !== 'needs-human');

    let selected: TaskRecord[];
    let selectedRoutes: string[];
    if (target === undefined) {
      selected = outstanding();
      selectedRoutes = jobs.map((j) => j.route);
    } else if (target.startsWith('/')) {
      const job = jobs.find((j) => j.route === target || j.nextPath === target);
      if (!job) throw new Error(`verify: unknown route ${target}`);
      selectedRoutes = [job.route];
      selected = tasks.filter((t) => (t.kind === 'page' || t.kind === 'motion') && t.route === job.route);
    } else {
      const task = state.tasks[target];
      if (!task) throw new Error(`verify: unknown task or route ${target}`);
      const original = originalOf(task);
      if (!original) {
        // The build task, fix-build-<n> or an orphaned fix: verify everything outstanding.
        selected = outstanding();
        selectedRoutes = jobs.map((j) => j.route);
      } else {
        selected = [original];
        selectedRoutes = routesOfTask(original);
      }
    }
    // Fix tasks are resolved through their original task.
    const evaluated = [
      ...new Map(
        selected
          .map(originalOf)
          .filter((t): t is TaskRecord => !!t && t.kind !== 'fix')
          .map((t) => [t.id, t] as const)
      ).values()
    ];
    const verifyJobs = jobs.filter((j) => selectedRoutes.includes(j.route));

    const report: Report = {
      generatedAt: new Date().toISOString(),
      routes: {},
      errors: [],
      passed: [],
      failed: [],
      skipped: [],
      manualChecklist: []
    };
    const writeReport = () => writeFileAtomic(path.join(diffsDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    const outcomes = new Map<string, Map<number, WidthOutcome>>();
    const infraError = (route: string, width: number, message: string): void => {
      report.errors.push({ route, width, message });
      warn(`verify: ${route}${width ? ` @ ${width}px` : ''}: ${message}`);
    };

    // ---- servers, browser, capture ----------------------------------------------------------------
    let nextServer: Awaited<ReturnType<typeof startNextServer>> | undefined;
    let exportServer: Awaited<ReturnType<typeof startExportServer>> | undefined;
    let browser: Browser | undefined;
    try {
      try {
        ctx.log('verify: building the Next.js app');
        nextServer = await startNextServer(nextDir);
      } catch (error) {
        if (!(error instanceof BuildFailedError)) throw error;
        state.tasks[BUILD_TASK] ??= {
          id: BUILD_TASK,
          kind: 'fix',
          file: '.convert/tasks/fix-build.md',
          status: 'pending',
          attempts: 0,
          targets: []
        };
        const status = recordAttempt(state, BUILD_TASK, false);
        const attempts = state.tasks[BUILD_TASK]!.attempts;
        report.failed.push('build');
        if (status === 'needs-human') {
          warn(`verify: build failed ${attempts} times; needs human`);
          report.build = { failed: true, attempts };
          state.stages.verify = 'failed';
        } else {
          const fixId = await writeBuildFix(ctx, error.log, attempts);
          ctx.log(`verify: build failed, wrote ${fixId}`);
          report.build = { failed: true, fixTask: fixId, attempts };
          state.stages.verify = 'needs-ai';
        }
        await writeReport();
        await saveState(state);
        return { passed: [], failed: ['build'] };
      }
      // A successful build resolves the build task and any outstanding build fixes.
      if (state.tasks[BUILD_TASK]) {
        recordAttempt(state, BUILD_TASK, true);
        state.tasks[BUILD_TASK]!.attempts = 0; // the cap counts consecutive failures
      }
      for (const t of tasks) if (t.kind === 'fix' && t.id.startsWith('fix-build-')) t.status = 'done';

      let page: Page | undefined;
      try {
        exportServer = await startExportServer(exportDir);
        browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
        page = await browser.newPage();
        page.setDefaultNavigationTimeout(navigationTimeoutMs);
      } catch (error) {
        for (const job of verifyJobs) infraError(job.route, 0, `verify could not start: ${errMsg(error)}`);
      }

      for (const job of page ? verifyJobs : []) {
        const perWidth = new Map<number, WidthOutcome>();
        outcomes.set(job.route, perWidth);
        report.routes[job.route] = {};
        const html = await readFile(path.join(exportDir, job.exportFile), 'utf8').catch(() => '');
        const sections = adapter.sections(html);
        const pageComponents = components.filter((c) => c.pages.includes(job.route));
        const refRouteDir = path.join(refDir, job.slug);
        const refJsonFile = path.join(refRouteDir, 'sections.json');
        const refKey = referenceKey(html, sections);
        const cache = await readReference(refJsonFile, refKey, warn);

        for (const width of VERIFY_WIDTHS) {
          ctx.log(`verify: ${job.route} @ ${width}px`);
          let outcome: WidthOutcome;
          try {
            const refPng = path.join(refRouteDir, `${width}.png`);
            let ref = cache.widths[String(width)];
            let expected: CaptureResult;
            if (ref && (await exists(refPng))) {
              expected = { png: await readFile(refPng), sections: ref.sections };
            } else {
              expected = await capturePage(
                page!,
                exportUrl(exportServer!.url, job.exportFile),
                width,
                'export',
                sections,
                navigationTimeoutMs
              );
              const dom = await extractSectionDom(page!, sections);
              const layout = await componentLayout(page!, sections, pageComponents);
              ref = { sections: expected.sections, dom, ...layout };
              await writeFileAtomic(refPng, expected.png);
              cache.widths[String(width)] = ref;
              await writeFileAtomic(refJsonFile, JSON.stringify(cache, null, 2) + '\n');
            }
            await writeComponentCrops(refDir, job.route, html, width, expected.png, ref, components, warn);

            let status: number | undefined;
            const onResponse = (res: HTTPResponse): void => {
              if (res.request().isNavigationRequest() && res.frame() === page!.mainFrame()) status = res.status();
            };
            page!.on('response', onResponse);
            let actual: CaptureResult;
            try {
              actual = await capturePage(page!, nextServer.url + job.nextPath, width, 'next', undefined, navigationTimeoutMs);
            } finally {
              page!.off('response', onResponse);
            }
            const actualDom = await extractSectionDom(page!, await nextSections(page!));
            const results = compareSections(expected, actual, width);
            const dom = compareDom(ref.dom, actualDom, { routes, images });
            outcome = { sections: results, dom, components: ref.components };
            if (status !== undefined && status >= 500) outcome.http = `HTTP ${status}`;
          } catch (error) {
            infraError(job.route, width, errMsg(error));
            outcome = { sections: [], dom: [], error: errMsg(error), components: {} };
            // A timed-out or crashed tab can stay wedged (later CDP calls hang until the protocol timeout):
            // continue in a fresh tab and let the old one close in the background.
            const wedged = page!;
            page = await browser!.newPage();
            page.setDefaultNavigationTimeout(navigationTimeoutMs);
            void wedged.close().catch(() => {});
          }
          perWidth.set(width, outcome);
          await writeDiffPngs(diffsDir, job.slug, width, outcome.sections);
          report.routes[job.route]![String(width)] = {
            sections: outcome.sections.map(({ diffPng: _d, expectedPng: _e, actualPng: _a, ...rest }) => rest),
            dom: outcome.dom,
            ...(outcome.http ? { http: outcome.http } : {}),
            ...(outcome.error ? { error: outcome.error } : {})
          };
        }
      }
    } finally {
      await browser?.close().catch(() => {});
      await exportServer?.stop().catch(() => {});
      await nextServer?.stop().catch(() => {});
    }

    // ---- task outcomes ----------------------------------------------------------------------------
    const jobOf = new Map(jobs.map((j) => [j.route, j]));
    const erroredRoutes = new Set(report.errors.map((e) => e.route));
    const routePasses = (route: string): boolean => {
      const perWidth = outcomes.get(route);
      if (!perWidth) return false;
      return VERIFY_WIDTHS.every((w) => {
        const o = perWidth.get(w);
        return (
          !!o && !o.error && !o.http && o.sections.length > 0 && o.sections.every((s) => s.pass) && o.dom.length === 0
        );
      });
    };
    const componentPasses = (name: string, routesUsed: string[]): boolean =>
      routesUsed.length > 0 &&
      routesUsed.every((route) => {
        const perWidth = outcomes.get(route);
        if (!perWidth) return false;
        return VERIFY_WIDTHS.every((w) => {
          const o = perWidth.get(w);
          if (!o || o.error || o.http) return false;
          const owning = Object.entries(o.components)
            .filter(([, names]) => names.includes(name))
            .map(([section]) => section);
          // No section holds the component: fall back to the whole route.
          if (!owning.length) return routePasses(route);
          return (
            o.sections.filter((s) => owning.includes(s.name)).every((s) => s.pass) &&
            o.dom.every((d) => !owning.includes(d.section))
          );
        });
      });

    const fixesOf = (id: string): TaskRecord[] =>
      tasks.filter(
        (t) => t.kind === 'fix' && t.id.startsWith(`fix-${id}-`) && /^\d+$/.test(t.id.slice(`fix-${id}-`.length))
      );

    for (const task of evaluated) {
      if (task.kind === 'motion') {
        report.manualChecklist.push({ taskId: task.id, route: task.route, file: task.file, status: task.status });
        continue;
      }
      // Infrastructure errors give no verdict: the task keeps its status and no attempt is used.
      if (routesOfTask(task).some((r) => erroredRoutes.has(r))) {
        report.skipped.push(task.id);
        ctx.log(`verify: ${task.id} not judged (infrastructure errors; see report.json errors)`);
        continue;
      }
      if (task.kind === 'component') {
        const name = task.targets[0]?.replace(/^src\/components\//, '').replace(/\.tsx$/, '') ?? '';
        const used = routesOfTask(task);
        if (componentPasses(name, used)) {
          recordAttempt(state, task.id, true);
          report.passed.push(task.id);
        } else {
          // Not a failed attempt: the component stays pending until its pages pass.
          report.failed.push(task.id);
        }
        continue;
      }
      // page task
      const route = task.route!;
      if (routePasses(route)) {
        recordAttempt(state, task.id, true);
        for (const f of fixesOf(task.id)) f.status = 'done';
        report.passed.push(task.id);
        continue;
      }
      report.failed.push(task.id);
      const status = recordAttempt(state, task.id, false);
      if (status === 'needs-human') {
        ctx.log(`verify: ${task.id} failed ${task.attempts} times; needs a human`);
        continue;
      }
      const job = jobOf.get(route);
      const failures = describeFailures(route, job?.slug ?? routeSlug(route), job?.nextPath ?? route, outcomes.get(route));
      const fixId = `fix-${task.id}-${task.attempts}`;
      const file = `.convert/tasks/${fixId}.md`;
      await writeFileAtomic(
        path.join(nextDir, file),
        renderTemplate('fix', {
          taskId: task.id,
          attempt: String(task.attempts),
          targets: bullets(task.targets.map(code)),
          failures,
          doneWhen: `Run \`${CLI_INVOCATION} verify ${task.id}\` and confirm it passes.`,
          rules: SHARED_RULES
        })
      );
      // Earlier fix files for this task are superseded by the new one.
      for (const f of fixesOf(task.id)) f.status = 'done';
      state.tasks[fixId] = {
        id: fixId,
        kind: 'fix',
        route,
        file,
        status: 'pending',
        attempts: 0,
        targets: [...task.targets]
      };
      ctx.log(`verify: ${task.id} failed; wrote ${file}`);
    }

    // Motion tasks for every verified route belong on the manual checklist, even when not targeted.
    for (const t of tasks) {
      if (
        t.kind === 'motion' &&
        t.route &&
        outcomes.has(t.route) &&
        !report.manualChecklist.some((m) => m.taskId === t.id)
      ) {
        report.manualChecklist.push({ taskId: t.id, route: t.route, file: t.file, status: t.status });
      }
    }

    await writeReport();
    state.stages.verify = Object.values(state.tasks).every((t) => t.kind === 'motion' || t.status === 'done')
      ? 'done'
      : 'needs-ai';
    await saveState(state);
    return { passed: report.passed, failed: report.failed };
  } catch (error) {
    await saveState(state).catch(() => {});
    throw error;
  }
}

/** Write `<width>-<section>-{expected,actual,diff}.png` for every failing section that has images. */
async function writeDiffPngs(diffsDir: string, slug: string, width: number, results: SectionResult[]): Promise<void> {
  const dir = path.join(diffsDir, slug);
  for (const r of results) {
    if (r.pass || !r.diffPng) continue;
    await mkdir(dir, { recursive: true });
    const base = `${width}-${fileSafe(r.name)}`;
    await writeFile(path.join(dir, `${base}-expected.png`), r.expectedPng!);
    await writeFile(path.join(dir, `${base}-actual.png`), r.actualPng!);
    await writeFile(path.join(dir, `${base}-diff.png`), r.diffPng);
  }
}

/**
 * Crop `.convert/reference/components/<Name>/<width>.png` for components whose first page is `route`.
 * `key.json` holds, per width, sha256(first page HTML + selector); a crop is redone when its key changes.
 */
async function writeComponentCrops(
  refDir: string,
  route: string,
  html: string,
  width: number,
  png: Buffer,
  ref: ReferenceWidth,
  components: ComponentInfo[],
  warn: (msg: string) => void
): Promise<void> {
  let decoded: PNG | undefined;
  for (const c of components) {
    if (c.pages[0] !== route) continue;
    const dir = path.join(refDir, 'components', c.name);
    const out = path.join(dir, `${width}.png`);
    const keyFile = path.join(dir, 'key.json');
    const key = sha256(html + '\u0000' + c.selector);
    const keys = await readJson<Record<string, string>>(keyFile, {}).catch(() => ({}) as Record<string, string>);
    if (keys[String(width)] === key && (await exists(out))) continue;
    const box = ref.componentBoxes?.[c.name];
    if (!box) {
      warn(`verify: component ${c.name} not found (or zero-size) on ${route} at ${width}px; no reference crop`);
      continue;
    }
    decoded ??= PNG.sync.read(png);
    await writeFileAtomic(out, PNG.sync.write(crop(decoded, box)));
    await writeFileAtomic(keyFile, JSON.stringify({ ...keys, [String(width)]: key }, null, 2) + '\n');
  }
}

function describeFailures(
  route: string,
  slug: string,
  nextPath: string,
  perWidth: Map<number, WidthOutcome> | undefined
): string {
  const lines: string[] = [];
  if (!perWidth) return `- Route ${code(route)} was not verified.`;
  const dom = new Map<string, { m: DomMismatch; widths: number[] }>();
  for (const width of VERIFY_WIDTHS) {
    const o = perWidth.get(width);
    if (!o) continue;
    if (o.error) {
      lines.push(`- Route ${code(route)} at ${width}px: capture failed: ${o.error}`);
      continue;
    }
    if (o.http) lines.push(`- Route ${code(route)} at ${width}px: the Next.js app answered ${code(nextPath)} with ${o.http}.`);
    if (!o.sections.length) lines.push(`- Route ${code(route)} at ${width}px: no sections could be compared.`);
    for (const s of o.sections) {
      if (s.pass) continue;
      lines.push(
        `- Section ${code(s.name)} at ${width}px (route ${code(route)}): ${s.reason ?? 'failed'} ` +
          `(pixel ratio ${s.ratio.toFixed(4)}, height delta ${s.heightDelta}px)`
      );
      if (s.diffPng) {
        const base = `.convert/diffs/${slug}/${width}-${fileSafe(s.name)}`;
        lines.push(`  - expected: ${code(`${base}-expected.png`)}`);
        lines.push(`  - actual: ${code(`${base}-actual.png`)}`);
        lines.push(`  - diff: ${code(`${base}-diff.png`)}`);
      }
    }
    for (const m of o.dom) {
      const key = JSON.stringify([m.section, m.kind, m.expected, m.actual]);
      const entry = dom.get(key);
      if (entry) entry.widths.push(width);
      else dom.set(key, { m, widths: [width] });
    }
  }
  if (dom.size) {
    if (lines.length) lines.push('');
    lines.push('DOM mismatches:', '');
    for (const { m, widths } of dom.values()) {
      lines.push(`- Section ${code(m.section)}: ${m.kind} mismatch at ${widths.map((w) => `${w}px`).join(', ')}`);
      lines.push(`  - expected: ${JSON.stringify(truncate(m.expected))}`);
      lines.push(`  - actual: ${JSON.stringify(truncate(m.actual))}`);
    }
  }
  return lines.join('\n') || `- Route ${code(route)} failed verification.`;
}

/** `fix-build-<attempt>.md` with the last lines of the build log; earlier build fixes are superseded. */
async function writeBuildFix(ctx: StageContext, log: string, attempt: number): Promise<string> {
  const { state, nextDir } = ctx;
  const id = `fix-build-${attempt}`;
  const file = `.convert/tasks/${id}.md`;
  const targets = [
    ...new Set(
      Object.values(state.tasks)
        .filter((t) => t.kind !== 'fix' && t.status !== 'done')
        .flatMap((t) => t.targets)
    )
  ];
  const tail = log.replace(/\s+$/, '').split(/\r?\n/).slice(-BUILD_LOG_LINES).join('\n');
  const fence = tail.includes('```') ? '~~~~' : '```';
  await writeFileAtomic(
    path.join(nextDir, file),
    renderTemplate('fix', {
      taskId: 'build',
      attempt: String(attempt),
      targets: targets.length ? bullets(targets.map(code)) : '- any file under `src/`',
      failures: `\`npm run build\` failed. Last ${BUILD_LOG_LINES} lines of the build output:\n\n${fence}\n${tail}\n${fence}`,
      doneWhen: `Run \`${CLI_INVOCATION} verify\` and confirm the build succeeds and verification passes.`,
      rules: SHARED_RULES
    })
  );
  for (const [key, t] of Object.entries(state.tasks)) if (/^fix-build-\d+$/.test(key)) t.status = 'done';
  state.tasks[id] = { id, kind: 'fix', file, status: 'pending', attempts: 0, targets };
  return id;
}
