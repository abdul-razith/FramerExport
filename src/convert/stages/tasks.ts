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

/** Ordered section names of a page (see pageSections). */
async function sectionsFor(ctx: StageContext, page: PageInfo): Promise<string[]> {
  let html = '';
  try {
    html = await readFile(path.join(ctx.exportDir, page.sourceFile), 'utf8');
  } catch {}
  return pageSections(html).map((s) => s.name);
}

export async function runTasks(ctx: StageContext): Promise<TaskRecord[]> {
  const analysis = path.join(ctx.nextDir, '.convert', 'analysis');
  const pages = await readJson<PageInfo[]>(path.join(analysis, 'pages.json'), []);
  const components = await readJson<ComponentInfo[]>(path.join(analysis, 'components.json'), []);
  const animations = await readJson<AnimationEntry[]>(path.join(analysis, 'animations.json'), []);

  const slices = new Map<string, string>();
  for (const c of components) {
    try {
      slices.set(c.name, await readFile(path.join(ctx.nextDir, c.slice), 'utf8'));
    } catch {}
  }

  await mkdir(path.join(ctx.nextDir, '.convert', 'tasks'), { recursive: true });
  const records: TaskRecord[] = [];
  // Only files for ids generated here are written, so fix-*.md files are never touched.
  const emit = async (
    rec: Pick<TaskRecord, 'id' | 'kind' | 'targets'> & { route?: string },
    text: string,
  ): Promise<void> => {
    const file = `.convert/tasks/${rec.id}.md`;
    await writeFile(path.join(ctx.nextDir, file), text, 'utf8');
    const prev = ctx.state.tasks[rec.id];
    const record: TaskRecord = { ...rec, file, status: prev?.status ?? 'pending', attempts: prev?.attempts ?? 0 };
    ctx.state.tasks[rec.id] = record;
    records.push(record);
  };

  for (const [i, c] of orderComponents(components, slices).entries()) {
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

  const sortedPages = [...pages].sort((a, b) => routeOrder(a.route, b.route));
  for (const [i, p] of sortedPages.entries()) {
    const slug = routeSlug(p.route);
    const id = `${101 + i}-page-${slug}`;
    const target = pageFile(p.route);
    const sections = await sectionsFor(ctx, p);
    const contentFile = p.dynamic ? `src/content/${p.dynamic.collection}.ts` : undefined;
    const used = components.filter((c) => c.pages.includes(p.route)).map((c) => c.name);
    await emit(
      { id, kind: 'page', route: p.route, targets: [target] },
      renderTemplate('page', {
        taskId: id,
        route: p.route,
        targets: bullets([code(target)]),
        inputs: bullets([
          `Original page HTML (read-only reference): ${code(path.join(ctx.exportDir, p.sourceFile))}`,
          `Shared Framer base styles stripped from slices: ${code(BASE_CSS)}`,
          ...(contentFile ? [`CMS content: ${code(contentFile)}`] : []),
          ...WIDTHS.map((w) => `Reference screenshot at ${w}px: ${code(`.convert/reference/${slug}/${w}.png`)}`),
        ]),
        sections: sections.length
          ? bullets(sections.map((s) => `${code(s)}: \`data-section="${s}"\``), '  ')
          : '  - (no sections detected; render the page content in a single section)',
        components: used.length
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

  const guide = renderTemplate('agents', { rules: SHARED_RULES });
  await writeFile(path.join(ctx.nextDir, 'AGENTS.md'), guide, 'utf8');
  await writeFile(path.join(ctx.nextDir, 'CLAUDE.md'), guide, 'utf8');

  ctx.state.stages.tasks = 'needs-ai';
  await saveState(ctx.state);
  return records;
}
