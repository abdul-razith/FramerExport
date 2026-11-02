import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { PNG } from 'pngjs';
import { framerAdapter } from '../adapters/framer/index.js';
import type { StageContext } from '../adapters/types.js';
import { recordAttempt, saveState } from '../state.js';
import type { ComponentInfo, PageInfo, TaskRecord } from '../types.js';
import { SHARED_RULES } from '../tasks/templates/index.js';
import { capturePage, type CaptureResult } from '../verify/capture.js';
import { compareSections, crop, type SectionResult } from '../verify/diff.js';
import { compareDom, extractSectionDom, nextSections, type DomMismatch, type SectionDom } from '../verify/dom-check.js';
import { BuildFailedError, startExportServer, startNextServer } from '../verify/serve.js';
import { renderTemplate, routeSlug } from './tasks.js';

export const VERIFY_WIDTHS = [1440, 1000, 390] as const;
const BUILD_LOG_LINES = 80;
const MAX_TEXT = 400;

type Box = CaptureResult['sections'][number]['box'];

/** One verifiable route: the pages.json route plus the concrete export file and Next path that represent it. */
interface RouteJob {
  route: string;
  slug: string;
  exportFile: string;
  nextPath: string;
}

/** Cached reference data of one route at one width (`.convert/reference/<slug>/sections.json`). */
interface ReferenceWidth {
  sections: CaptureResult['sections'];
  dom: SectionDom[];
  /** Section name -> names of the components with an instance inside that section. */
  components: Record<string, string[]>;
  /** First-instance document box of every component present on the page (null if absent or zero-size). */
  componentBoxes: Record<string, Box | null>;
}

type ReportSection = Omit<SectionResult, 'diffPng' | 'expectedPng' | 'actualPng'>;

interface WidthOutcome {
  sections: SectionResult[];
  dom: DomMismatch[];
  error?: string;
  /** Reference section -> component names, for component-task scoping. */
  components: Record<string, string[]>;
}

interface Report {
  generatedAt: string;
  build?: { failed: true; fixTask?: string };
  routes: Record<string, Record<string, { sections: ReportSection[]; dom: DomMismatch[]; error?: string }>>;
  passed: string[];
  failed: string[];
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

export async function runVerify(ctx: StageContext, target?: string): Promise<{ passed: string[]; failed: string[] }> {
  const { state, nextDir, exportDir } = ctx;
  const convertDir = path.join(nextDir, '.convert');
  const analysisDir = path.join(convertDir, 'analysis');
  const diffsDir = path.join(convertDir, 'diffs');
  const refDir = path.join(convertDir, 'reference');

  try {
    await rm(diffsDir, { recursive: true, force: true });
    await mkdir(diffsDir, { recursive: true });

    const pages = await readJson<PageInfo[]>(path.join(analysisDir, 'pages.json'), []);
    const components = await readJson<ComponentInfo[]>(path.join(analysisDir, 'components.json'), []);
    const images = await readJson<Record<string, string>>(path.join(analysisDir, 'images.json'), {});
    const jobs = routeJobs(pages);
    const routes = routesMap(pages);

    // ---- target selection -------------------------------------------------------------------------
    const tasks = Object.values(state.tasks);
    const originalOf = (t: TaskRecord): TaskRecord | undefined =>
      t.kind === 'fix' ? state.tasks[t.id.replace(/^fix-/, '').replace(/-\d+$/, '')] : t;
    const routesOfTask = (t: TaskRecord): string[] => {
      if (t.kind === 'component') {
        const name = t.targets[0]?.replace(/^src\/components\//, '').replace(/\.tsx$/, '');
        return components.find((c) => c.name === name)?.pages ?? [];
      }
      return t.route ? [t.route] : [];
    };

    let selected: TaskRecord[];
    let selectedRoutes: string[];
    if (target === undefined) {
      selected = tasks.filter((t) => t.status !== 'done');
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
      if (task.kind === 'fix' && !original) {
        // fix-build-<n> (or an orphaned fix): verify everything.
        selected = tasks.filter((t) => t.status !== 'done');
        selectedRoutes = jobs.map((j) => j.route);
      } else {
        selected = [original!];
        selectedRoutes = routesOfTask(original!);
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

    const report: Report = { generatedAt: new Date().toISOString(), routes: {}, passed: [], failed: [], manualChecklist: [] };
    const outcomes = new Map<string, Map<number, WidthOutcome>>();

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
        const fixId = await writeBuildFix(ctx, error.log);
        ctx.log(`verify: build failed, wrote ${fixId}`);
        report.build = { failed: true, fixTask: fixId };
        report.failed.push('build');
        await writeFile(path.join(diffsDir, 'report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
        state.stages.verify = 'needs-ai';
        await saveState(state);
        return { passed: [], failed: ['build'] };
      }
      // A successful build resolves any outstanding build fixes.
      for (const t of tasks) if (t.kind === 'fix' && t.id.startsWith('fix-build-')) t.status = 'done';

      exportServer = await startExportServer(exportDir);
      browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
      const page = await browser.newPage();
      page.setDefaultNavigationTimeout(60_000);

      for (const job of verifyJobs) {
        const perWidth = new Map<number, WidthOutcome>();
        outcomes.set(job.route, perWidth);
        report.routes[job.route] = {};
        const html = await readFile(path.join(exportDir, job.exportFile), 'utf8').catch(() => '');
        const sections = framerAdapter.sections(html);
        const pageComponents = components.filter((c) => c.pages.includes(job.route));
        const refRouteDir = path.join(refDir, job.slug);
        const refJsonFile = path.join(refRouteDir, 'sections.json');
        const refJson = await readJson<Record<string, ReferenceWidth>>(refJsonFile, {});

        for (const width of VERIFY_WIDTHS) {
          ctx.log(`verify: ${job.route} @ ${width}px`);
          let outcome: WidthOutcome;
          try {
            const refPng = path.join(refRouteDir, `${width}.png`);
            let ref = refJson[String(width)];
            let expected: CaptureResult;
            if (ref && (await exists(refPng))) {
              expected = { png: await readFile(refPng), sections: ref.sections };
            } else {
              expected = await capturePage(page, exportUrl(exportServer.url, job.exportFile), width, 'export', sections);
              const dom = await extractSectionDom(page, sections);
              const layout = await componentLayout(page, sections, pageComponents);
              ref = { sections: expected.sections, dom, ...layout };
              await mkdir(refRouteDir, { recursive: true });
              await writeFile(refPng, expected.png);
              refJson[String(width)] = ref;
              await writeFile(refJsonFile, JSON.stringify(refJson, null, 2) + '\n', 'utf8');
            }
            await writeComponentCrops(ctx, refDir, job.route, width, expected.png, ref, components);

            const actual = await capturePage(page, nextServer.url + job.nextPath, width, 'next');
            const actualDom = await extractSectionDom(page, await nextSections(page));
            const results = compareSections(expected, actual, width);
            const dom = compareDom(ref.dom, actualDom, { routes, images });
            outcome = { sections: results, dom, components: ref.components };
          } catch (error) {
            ctx.log(`verify: ${job.route} @ ${width}px failed: ${errMsg(error)}`);
            outcome = { sections: [], dom: [], error: errMsg(error), components: {} };
          }
          perWidth.set(width, outcome);
          await writeDiffPngs(diffsDir, job.slug, width, outcome.sections);
          report.routes[job.route]![String(width)] = {
            sections: outcome.sections.map(({ diffPng: _d, expectedPng: _e, actualPng: _a, ...rest }) => rest),
            dom: outcome.dom,
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
    const routePasses = (route: string): boolean => {
      const perWidth = outcomes.get(route);
      if (!perWidth) return false;
      return VERIFY_WIDTHS.every((w) => {
        const o = perWidth.get(w);
        return !!o && !o.error && o.sections.length > 0 && o.sections.every((s) => s.pass) && o.dom.length === 0;
      });
    };
    const componentPasses = (name: string, routesUsed: string[]): boolean =>
      routesUsed.length > 0 &&
      routesUsed.every((route) => {
        const perWidth = outcomes.get(route);
        if (!perWidth) return false;
        return VERIFY_WIDTHS.every((w) => {
          const o = perWidth.get(w);
          if (!o || o.error) return false;
          const owning = Object.entries(o.components)
            .filter(([, names]) => names.includes(name))
            .map(([section]) => section);
          // No section holds the component: fall back to the whole route.
          if (!owning.length) return routePasses(route);
          return o.sections.filter((s) => owning.includes(s.name)).every((s) => s.pass) &&
            o.dom.every((d) => !owning.includes(d.section));
        });
      });

    const fixesOf = (id: string): TaskRecord[] =>
      tasks.filter((t) => t.kind === 'fix' && t.id.startsWith(`fix-${id}-`) && /^\d+$/.test(t.id.slice(`fix-${id}-`.length)));

    for (const task of evaluated) {
      if (task.kind === 'motion') {
        report.manualChecklist.push({ taskId: task.id, route: task.route, file: task.file, status: task.status });
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
      const failures = describeFailures(route, job?.slug ?? routeSlug(route), outcomes.get(route));
      const fixId = `fix-${task.id}-${task.attempts}`;
      const file = `.convert/tasks/${fixId}.md`;
      await mkdir(path.join(convertDir, 'tasks'), { recursive: true });
      await writeFile(
        path.join(nextDir, file),
        renderTemplate('fix', {
          taskId: task.id,
          attempt: String(task.attempts),
          targets: bullets(task.targets.map(code)),
          failures,
          doneWhen: `Run \`npx fexport convert verify ${task.id}\` and confirm it passes.`,
          rules: SHARED_RULES
        }),
        'utf8'
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
      if (t.kind === 'motion' && t.route && outcomes.has(t.route) && !report.manualChecklist.some((m) => m.taskId === t.id)) {
        report.manualChecklist.push({ taskId: t.id, route: t.route, file: t.file, status: t.status });
      }
    }

    await writeFile(path.join(diffsDir, 'report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
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

/** Crop `.convert/reference/components/<Name>/<width>.png` for components whose first page is `route`. */
async function writeComponentCrops(
  ctx: StageContext,
  refDir: string,
  route: string,
  width: number,
  png: Buffer,
  ref: ReferenceWidth,
  components: ComponentInfo[]
): Promise<void> {
  let decoded: PNG | undefined;
  for (const c of components) {
    if (c.pages[0] !== route) continue;
    const out = path.join(refDir, 'components', c.name, `${width}.png`);
    if (await exists(out)) continue;
    const box = ref.componentBoxes?.[c.name];
    if (!box) {
      ctx.log(`verify: warning: component ${c.name} not found (or zero-size) on ${route} at ${width}px; no reference crop`);
      continue;
    }
    decoded ??= PNG.sync.read(png);
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, PNG.sync.write(crop(decoded, box)));
  }
}

function describeFailures(route: string, slug: string, perWidth: Map<number, WidthOutcome> | undefined): string {
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

/** `fix-build-<n>.md` with the last lines of the build log. */
async function writeBuildFix(ctx: StageContext, log: string): Promise<string> {
  const { state, nextDir } = ctx;
  const existing = Object.keys(state.tasks).filter((id) => /^fix-build-\d+$/.test(id));
  const n = existing.reduce((max, id) => Math.max(max, Number(id.slice('fix-build-'.length))), 0) + 1;
  const id = `fix-build-${n}`;
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
  await mkdir(path.join(nextDir, '.convert', 'tasks'), { recursive: true });
  await writeFile(
    path.join(nextDir, file),
    renderTemplate('fix', {
      taskId: 'build',
      attempt: String(n),
      targets: targets.length ? bullets(targets.map(code)) : '- any file under `src/`',
      failures: `\`npm run build\` failed. Last ${BUILD_LOG_LINES} lines of the build output:\n\n${fence}\n${tail}\n${fence}`,
      doneWhen: 'Run `npx fexport convert verify` and confirm the build succeeds and verification passes.',
      rules: SHARED_RULES
    }),
    'utf8'
  );
  for (const [key, t] of Object.entries(state.tasks)) if (/^fix-build-\d+$/.test(key)) t.status = 'done';
  state.tasks[id] = { id, kind: 'fix', file, status: 'pending', attempts: 0, targets };
  return id;
}
