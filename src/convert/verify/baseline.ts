import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import puppeteer, { type Browser } from 'puppeteer';
import type { StageContext } from '../adapters/types.js';
import { readManifest, type GeneratedManifest } from '../generate/manifest.js';
import { kebabName } from '../generate/names.js';
import { routeSlug } from '../stages/tasks.js';
import { saveState, writeFileAtomic } from '../state.js';
import type { TaskRecord } from '../types.js';
import { capturePageSections } from './capture-sections.js';

export const BASELINE_WIDTHS = [1440, 1000, 390] as const;

/**
 * Returns the baseline artifact directory for a shell or section task:
 * - Section task: `.convert/baseline/<slug>/<kebab>`
 * - Shell task: `.convert/baseline/shell/<kebab>`
 */
export function baselineDir(nextDir: string, task: TaskRecord): string {
  if (task.kind === 'shell') {
    const rawName = task.section || task.id.replace(/^shell-/, '');
    const kebab = kebabName(rawName);
    return path.join(nextDir, '.convert', 'baseline', 'shell', kebab);
  }

  let slug = task.route ? routeSlug(task.route) : '';
  let kebab = task.section ? kebabName(task.section) : '';

  if (!slug || !kebab) {
    if (task.id.startsWith('sec-')) {
      const remainder = task.id.slice(4);
      if (kebab) {
        if (remainder.endsWith(`-${kebab}`)) {
          slug ||= remainder.slice(0, -(kebab.length + 1));
        } else {
          const parts = remainder.split('-');
          slug ||= parts[0];
        }
      } else if (slug) {
        if (remainder.startsWith(`${slug}-`)) {
          kebab ||= remainder.slice(slug.length + 1);
        } else {
          const parts = remainder.split('-');
          kebab ||= parts.slice(1).join('-') || parts[0];
        }
      } else {
        const parts = remainder.split('-');
        slug = parts[0] || 'home';
        kebab = parts.slice(1).join('-') || 'section';
      }
    } else {
      slug ||= 'home';
      kebab ||= kebabName(task.id);
    }
  }

  return path.join(nextDir, '.convert', 'baseline', slug, kebab);
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

/**
 * Capture baseline screenshots and DOM JSON for every shell and section task in `ctx.state.tasks`.
 *
 * - Iterates every shell and section task
 * - Determines the route for each task (from manifest for shells, or default '/')
 * - Captures each section at widths [1440, 1000, 390]
 * - Writes `<baselineDir>/<width>.png` and `<baselineDir>/<width>.json`
 * - Sets `ctx.state.stages.baseline = 'done'` and persists state via `saveState(ctx.state)`
 */
export async function runBaseline(
  ctx: StageContext,
  devUrl: string,
  opts?: { widths?: readonly number[]; browser?: Browser }
): Promise<void> {
  const tasks = Object.values(ctx.state.tasks).filter(
    (t) => t.kind === 'shell' || t.kind === 'section'
  );

  if (tasks.length === 0) {
    ctx.state.stages.baseline = 'done';
    await saveState(ctx.state);
    return;
  }

  const manifest = await readManifest(ctx.nextDir).catch(() => null);

  const tasksByRoute = new Map<string, TaskRecord[]>();
  for (const task of tasks) {
    const route = determineTaskRoute(task, manifest);
    const existing = tasksByRoute.get(route);
    if (existing) {
      existing.push(task);
    } else {
      tasksByRoute.set(route, [task]);
    }
  }

  const widths = opts?.widths ?? BASELINE_WIDTHS;
  const ownsBrowser = !opts?.browser;
  const browser = opts?.browser ?? (await puppeteer.launch({ headless: true, args: ['--no-sandbox'] }));

  try {
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(60_000);

    for (const [route, routeTasks] of tasksByRoute) {
      const concretePath = routeToPath(route, manifest);
      const url = buildUrl(devUrl, concretePath);
      const names = [...new Set(routeTasks.map((t) => t.section || t.id))];

      for (const width of widths) {
        ctx.log(`baseline: capturing route ${route} @ ${width}px (${names.join(', ')})`);
        const sectionData = await capturePageSections(page, url, width, names);

        for (const task of routeTasks) {
          const name = task.section || task.id;
          const data =
            sectionData.get(name) ??
            (name.includes('/') ? sectionData.get(name.split('/')[0]) : undefined);

          if (!data) {
            ctx.log(`baseline: section "${name}" for task ${task.id} not found on ${url}`);
            continue;
          }

          const dir = baselineDir(ctx.nextDir, task);
          await mkdir(dir, { recursive: true });
          await writeFileAtomic(path.join(dir, `${width}.png`), PNG.sync.write(data.png));
          await writeFileAtomic(path.join(dir, `${width}.json`), JSON.stringify(data.dom, null, 2) + '\n');
        }
      }
    }
  } finally {
    if (ownsBrowser) {
      await browser.close().catch(() => {});
    }
  }

  ctx.state.stages.baseline = 'done';
  await saveState(ctx.state);
}
