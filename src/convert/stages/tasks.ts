import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { StageContext } from '../adapters/types.js';
import { countMatches } from '../adapters/framer/components.js';
import { pageSections } from '../adapters/framer/sections.js';
import { saveState } from '../state.js';
import type { AnimationEntry, ComponentInfo, PageInfo, TaskRecord } from '../types.js';
import { SHARED_RULES, TEMPLATES, type TemplateName } from '../tasks/templates/index.js';

const WIDTHS = [1440, 1000, 390];
const BASE_CSS = '.convert/analysis/slices/_base.css';

export function renderTemplate(name: TemplateName, vars: Record<string, string>): string {
  const missing = new Set<string>();
  const out = TEMPLATES[name].replace(/\{\{\s*([\w-]*)\s*\}\}/g, (_m, key: string) => {
    if (Object.hasOwn(vars, key)) return vars[key]!;
    missing.add(key);
    return '';
  });
  if (missing.size) throw new Error(`unreplaced template variable(s) in "${name}": ${[...missing].join(', ')}`);
  return out;
}

/** `/` -> `home`, `/about` -> `about`, `/blog/[slug]` -> `blog-slug`. */
export function routeSlug(route: string): string {
  const slug = route.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return slug || 'home';
}

function pageFile(route: string): string {
  return route === '/' ? 'src/app/page.tsx' : `src/app/${route.replace(/^\//, '')}/page.tsx`;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw error;
  }
}

const bullets = (items: string[], indent = ''): string => items.map((i) => `${indent}- ${i}`).join('\n');
const code = (s: string): string => `\`${s}\``;
const pad = (n: number): string => String(n).padStart(3, '0');
const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const routeOrder = (a: string, b: string): number => (a === b ? 0 : a === '/' ? -1 : b === '/' ? 1 : byString(a, b));

/** Atoms first: fewest descendant components (other selectors matching inside the slice), ties by name. */
function orderComponents(components: ComponentInfo[], slices: Map<string, string>): ComponentInfo[] {
  const weight = new Map<string, number>();
  for (const c of components) {
    const html = slices.get(c.name) ?? '';
    weight.set(
      c.name,
      html ? components.filter((o) => o.name !== c.name && countMatches(html, o.selector) > 0).length : 0,
    );
  }
  return [...components].sort((a, b) => weight.get(a.name)! - weight.get(b.name)! || byString(a.name, b.name));
}

/** Read a text file; ENOENT is logged and recorded as a `tasks:` warning, other errors propagate. */
async function readOrWarn(ctx: StageContext, file: string, label: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const msg = `tasks: missing ${label}`;
    ctx.log(msg);
    if (!ctx.state.warnings.includes(msg)) ctx.state.warnings.push(msg);
    return undefined;
  }
}

const toPosix = (p: string): string => p.split(path.sep).join('/');

/** Name of the single section used when no sections are detected: the whole page. */
export const FALLBACK_SECTION = 'page';

/**
 * Sections of an exported page; when none are detected, one `page` section covering `#main` (the Next
 * side marks it with `data-section="page"` on the page root). Shared by tasks and verify so both agree.
 */
export function sectionsWithFallback(sections: Array<{ name: string; selector: string }>): Array<{ name: string; selector: string }> {
  return sections.length ? sections : [{ name: FALLBACK_SECTION, selector: '#main' }];
}

/** Ordered section names of a page (see pageSections), with the `page` fallback. */
async function sectionsFor(ctx: StageContext, page: PageInfo): Promise<string[]> {
  const html = (await readOrWarn(ctx, path.join(ctx.exportDir, page.sourceFile), page.sourceFile)) ?? '';
  return sectionsWithFallback(pageSections(html)).map((s) => s.name);
}

export type TaskMode = 'page-first' | 'component-first';

/** Section names that appear on two or more pages: the site shell (navigation, footer, ...). */
export function sharedSectionNames(perPage: string[][]): string[] {
  const count = new Map<string, number>();
  for (const names of perPage) {
    for (const n of new Set(names)) count.set(n, (count.get(n) ?? 0) + 1);
  }
  return [...count]
    .filter(([n, c]) => c >= 2 && n !== FALLBACK_SECTION && !/^section-\d+$/.test(n))
    .map(([n]) => n);
}

/**
 * `page-first` (default): one shell task, then one task per page that carries its section checklist; components are
 * only reference material. `component-first`: the original layout with a task per component before the pages.
 */
export async function runTasks(ctx: StageContext, opts: { mode?: TaskMode } = {}): Promise<TaskRecord[]> {
  const mode = opts.mode ?? 'page-first';
  ctx.state.warnings = ctx.state.warnings.filter((w) => !w.startsWith('tasks:'));
  const analysis = path.join(ctx.nextDir, '.convert', 'analysis');
  const pages = await readJson<PageInfo[]>(path.join(analysis, 'pages.json'), []);
  const components = await readJson<ComponentInfo[]>(path.join(analysis, 'components.json'), []);
  const animations = await readJson<AnimationEntry[]>(path.join(analysis, 'animations.json'), []);

  const slices = new Map<string, string>();
  if (mode === 'component-first') {
    for (const c of components) {
      const html = await readOrWarn(ctx, path.join(ctx.nextDir, c.slice), c.slice);
      if (html !== undefined) slices.set(c.name, html);
    }
  }

  await mkdir(path.join(ctx.nextDir, '.convert', 'tasks'), { recursive: true });
  const records: TaskRecord[] = [];
  // Only files for ids generated here are written, so fix-*.md files are never touched.
  const emit = async (
    rec: Pick<TaskRecord, 'id' | 'kind' | 'targets'> & { route?: string; sections?: string[] },
    text: string,
  ): Promise<void> => {
    const file = `.convert/tasks/${rec.id}.md`;
    await writeFile(path.join(ctx.nextDir, file), text, 'utf8');
    const prev = ctx.state.tasks[rec.id];
    const record: TaskRecord = {
      ...rec,
      file,
      status: prev?.status ?? 'pending',
      attempts: prev?.attempts ?? 0,
      ...(prev?.passedSections ? { passedSections: prev.passedSections } : {}),
    };
    ctx.state.tasks[rec.id] = record;
    records.push(record);
  };

  const sortedPages = [...pages].sort((a, b) => routeOrder(a.route, b.route));
  const sectionsOf = new Map<string, string[]>();
  for (const p of sortedPages) sectionsOf.set(p.route, await sectionsFor(ctx, p));

  if (mode === 'page-first') {
    const shared = sharedSectionNames([...sectionsOf.values()]);
    const first = sortedPages[0];
    const target = 'src/components/shell/index.tsx';
    await emit(
      { id: '001-shell', kind: 'shell', targets: [target] },
      renderTemplate('shell', {
        taskId: '001-shell',
        targets: bullets([code(target)]),
        inputs: bullets([
          `Shared Framer base styles stripped from slices: ${code(BASE_CSS)}`,
          ...(first
            ? [`Original page HTML (read-only reference): ${code(toPosix(path.relative(ctx.nextDir, path.join(ctx.exportDir, first.sourceFile))))}`]
            : []),
          ...WIDTHS.map((w) => `Reference screenshot at ${w}px: ${code(`.convert/reference/${routeSlug(first?.route ?? '/')}/${w}.png`)}`),
        ]),
        shared: shared.length
          ? bullets(shared.map(code))
          : '- none detected: build the navigation, footer and any loader or cursor as you find them',
        rules: SHARED_RULES,
      }),
    );
  }

  for (const [i, c] of (mode === 'component-first' ? orderComponents(components, slices) : []).entries()) {
    const id = `${pad(i + 1)}-component-${c.name}`;
    const target = `src/components/${c.name}.tsx`;
    await emit(
      { id, kind: 'component', targets: [target] },
      renderTemplate('component', {
        taskId: id,
        name: c.name,
        targets: bullets([code(target)]),
        inputs: bullets([
          `Component slice (HTML + its CSS): ${code(c.slice)}`,
          `Shared Framer base styles stripped from slices: ${code(BASE_CSS)}`,
          ...WIDTHS.map((w) => `Reference crop at ${w}px: ${code(`.convert/reference/components/${c.name}/${w}.png`)}`),
        ]),
        props: c.variants.length
          ? bullets(c.variants.map((v) => `variant ${code(v)}`), '  ')
          : '  - none (single variant)',
        pages: c.pages.length ? c.pages.map(code).join(', ') : 'none',
        rules: SHARED_RULES,
      }),
    );
  }

  for (const [i, p] of sortedPages.entries()) {
    const slug = routeSlug(p.route);
    const id = `${101 + i}-page-${slug}`;
    const target = pageFile(p.route);
    const sections = sectionsOf.get(p.route) ?? [];
    const contentFile = p.dynamic ? `src/content/${p.dynamic.collection}.ts` : undefined;
    const used = components.filter((c) => c.pages.includes(p.route)).map((c) => c.name);
    await emit(
      { id, kind: 'page', route: p.route, targets: [target], sections },
      renderTemplate('page', {
        taskId: id,
        route: p.route,
        targets: bullets([code(target)]),
        inputs: bullets([
          `Original page HTML (read-only reference): ${code(toPosix(path.relative(ctx.nextDir, path.join(ctx.exportDir, p.sourceFile))))}`,
          `Shared Framer base styles stripped from slices: ${code(BASE_CSS)}`,
          ...(contentFile ? [`CMS content: ${code(contentFile)}`] : []),
          ...WIDTHS.map((w) => `Reference screenshot at ${w}px: ${code(`.convert/reference/${slug}/${w}.png`)}`),
        ]),
        sections:
          sections.length === 1 && sections[0] === FALLBACK_SECTION
            ? `  - ${code(FALLBACK_SECTION)}: \`data-section="${FALLBACK_SECTION}"\` on the root element (no sections detected; render the whole page inside it)`
            : bullets(sections.map((s) => `${code(s)}: \`data-section="${s}"\``), '  '),
        components:
          mode === 'page-first'
            ? used.length
              ? `- Reference only (no separate tasks): this page uses ${used.map(code).join(', ')}; slices are in \`.convert/analysis/slices/\`. Reuse what the shell task built in \`src/components/shell/\`.`
              : '- No shared components are used on this page.'
            : used.length
              ? `- Reuse the components built in \`src/components/\`: ${used.map(code).join(', ')}.`
              : '- No shared components are used on this page.',
        dynamic: p.dynamic
          ? `- Dynamic route: read items from ${code(contentFile!)} (param \`${p.dynamic.param}\`) and implement \`generateStaticParams\` for slugs: ${p.dynamic.slugs.map(code).join(', ')}.`
          : '- Static page.',
        rules: SHARED_RULES,
      }),
    );
  }

  const motionRoutes = [...new Set(animations.map((a) => a.route))].sort(routeOrder);
  for (const [i, route] of motionRoutes.entries()) {
    const slug = routeSlug(route);
    const id = `${201 + i}-motion-${slug}`;
    const targets = [pageFile(route), `src/components/motion/${slug}.tsx`];
    const kv = (o: Record<string, string>): string =>
      Object.entries(o).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none';
    const checklist = animations
      .filter((a) => a.route === route)
      .map((a) => {
        const timing = [a.durationMs !== undefined ? `${a.durationMs}ms` : '', a.delayMs ? `delay ${a.delayMs}ms` : '']
          .filter(Boolean)
          .join(', ');
        const conf = a.confidence === 'low' ? ', low confidence' : '';
        return `- [ ] ${code(a.framerName ?? a.selector)} (${a.trigger}${conf}): from { ${kv(a.from)} } to { ${kv(a.to)} }${timing ? `, ${timing}` : ''}; selector ${code(a.selector)}`;
      })
      .join('\n');
    await emit(
      { id, kind: 'motion', route, targets },
      renderTemplate('motion', {
        taskId: id,
        route,
        targets: bullets(targets.map(code)),
        inputs: bullets([
          `Observed animations: ${code('.convert/analysis/animations.json')} (entries for ${code(route)})`,
          ...WIDTHS.map((w) => `Reference screenshot at ${w}px: ${code(`.convert/reference/${slug}/${w}.png`)}`),
        ]),
        checklist,
        rules: SHARED_RULES,
      }),
    );
  }

  const guide = renderTemplate('agents', {
    rules: SHARED_RULES,
    exportDir: toPosix(path.relative(ctx.nextDir, ctx.exportDir)) || '.',
  });
  await writeFile(path.join(ctx.nextDir, 'AGENTS.md'), guide, 'utf8');
  await writeFile(path.join(ctx.nextDir, 'CLAUDE.md'), guide, 'utf8');

  ctx.state.stages.tasks = 'needs-ai';
  await saveState(ctx.state);
  return records;
}
