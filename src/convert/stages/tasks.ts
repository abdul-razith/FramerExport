import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { StageContext } from '../adapters/types.js';
import { pageSections } from '../adapters/framer/sections.js';
import { saveState } from '../state.js';
import type { AnimationEntry, PageInfo, TaskRecord } from '../types.js';
import {
  SHARED_RULES,
  TEMPLATES,
  checkCommand,
  type TemplateName,
} from '../tasks/templates/index.js';
import {
  readManifest,
  type GeneratedManifest,
  type GeneratedPage,
  type GeneratedSection,
  type GeneratedShell,
  type MotionAnchor,
} from '../generate/manifest.js';
import { describeMotion } from '../tasks/motion-values.js';
import { componentName, kebabName } from '../generate/names.js';
import type { ScriptDrawn } from '../generate/script-drawn.js';

export { checkCommand };

const bullets = (items: string[], indent = ''): string => items.map((i) => `${indent}- ${i}`).join('\n');
const code = (s: string): string => `\`${s}\``;
const toPosix = (p: string): string => p.split(path.sep).join('/');

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

/** Name of the single section used when no sections are detected: the whole page. */
export const FALLBACK_SECTION = 'page';

/**
 * Sections of an exported page; when none are detected, one `page` section covering `#main`.
 */
export function sectionsWithFallback(sections: Array<{ name: string; selector: string }>): Array<{ name: string; selector: string }> {
  return sections.length ? sections : [{ name: FALLBACK_SECTION, selector: '#main' }];
}

/** Section names that appear on two or more pages. */
export function sharedSectionNames(perPage: string[][]): string[] {
  const count = new Map<string, number>();
  for (const names of perPage) {
    for (const n of new Set(names)) count.set(n, (count.get(n) ?? 0) + 1);
  }
  return [...count]
    .filter(([n, c]) => c >= 2 && n !== FALLBACK_SECTION && !/^section-\d+$/.test(n))
    .map(([n]) => n);
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

/** Ordered section names of a page (see pageSections), with the `page` fallback. */
async function sectionsFor(ctx: StageContext, page: PageInfo): Promise<string[]> {
  const html = (await readOrWarn(ctx, path.join(ctx.exportDir, page.sourceFile), page.sourceFile)) ?? '';
  return sectionsWithFallback(pageSections(html)).map((s) => s.name);
}

export function formatMotionLine(anchor: MotionAnchor): string {
  const desc = describeMotion(anchor.entry);
  const colonIdx = desc.indexOf(': ');
  const timing = colonIdx !== -1 ? desc.slice(0, colonIdx) : desc;
  const changes = colonIdx !== -1 ? desc.slice(colonIdx + 2) : '';
  const name = anchor.entry.framerName ? ` "${anchor.entry.framerName}"` : '';
  return `\`${anchor.id}\`${name} (${timing}): ${changes}`;
}

export function formatScriptDrawnLine(sd: ScriptDrawn): string {
  const sample = sd.sample ? ` "${sd.sample}"` : '';
  const ticking = sd.ticking ? ', ticking every second' : '';
  return `\`${sd.id}\`${sample}${ticking}`;
}

const dirTarget = (file: string): string => file.replace(/\.tsx$/, '') + '/';

/**
 * Builds a fallback manifest from pages.json and animations.json if generated.json
 * does not exist on disk (e.g. during pipeline tests before generate is run).
 */
export async function manifestFallback(ctx: StageContext): Promise<GeneratedManifest | null> {
  const analysis = path.join(ctx.nextDir, '.convert', 'analysis');
  let pages: PageInfo[] = [];
  try {
    pages = JSON.parse(await readFile(path.join(analysis, 'pages.json'), 'utf8')) as PageInfo[];
  } catch {
    return null;
  }
  if (!pages.length) return null;

  let animations: AnimationEntry[] = [];
  try {
    animations = JSON.parse(await readFile(path.join(analysis, 'animations.json'), 'utf8')) as AnimationEntry[];
  } catch {}

  const manifestPages: GeneratedPage[] = [];
  for (const p of pages) {
    const slug = routeSlug(p.route);
    let sectionNames: string[] = [];
    try {
      sectionNames = await sectionsFor(ctx, p);
    } catch {
      sectionNames = ['main'];
    }
    const taken = new Set<string>();
    const pageSecs: GeneratedSection[] = sectionNames.map((sName) => {
      const comp = componentName(sName, taken);
      return {
        name: sName,
        component: comp,
        file: `src/sections/${slug}/${comp}.tsx`,
        parts: [],
        motion: [],
        scriptDrawn: [],
        hasVariants: false,
        repeated: [],
        cmsFields: [],
      };
    });

    manifestPages.push({
      route: p.route,
      slug,
      view: `src/views/${slug}.tsx`,
      ...(p.dynamic ? { dynamic: { collection: p.dynamic.collection, firstSlug: p.dynamic.slugs[0] || 'first' } } : {}),
      sections: pageSecs,
      inline: [],
      shell: [],
    });
  }

  return {
    version: 1,
    pages: manifestPages,
    shell: [],
    motion: animations.map((entry, idx) => ({
      id: `m${idx + 1}`,
      route: entry.route,
      section: null,
      entry,
      matched: true,
    })),
    scriptDrawn: [],
    stubs: [],
    warnings: [],
  };
}

/**
 * (Re)writes every `.convert/tasks/<id>.md`, `AGENTS.md`, and `CLAUDE.md`
 * for the current `state.options.testing` setting.
 */
export async function renderTaskFiles(ctx: StageContext, manifest: GeneratedManifest): Promise<void> {
  const testing = ctx.state.options?.testing ?? true;
  const tasksDir = path.join(ctx.nextDir, '.convert', 'tasks');
  await mkdir(tasksDir, { recursive: true });

  // 1. Shell tasks
  for (const sh of manifest.shell) {
    const kebab = kebabName(sh.name);
    const id = `shell-${kebab}`;
    const targets = [sh.file, dirTarget(sh.file)];

    const reqLines: string[] = [
      `- Export the React component \`${sh.component}\` from ${code(sh.file)}.`,
      `- Shared across pages: ${sh.pages.map(code).join(', ')}.`,
    ];
    if (sh.differences && sh.differences.length > 0) {
      reqLines.push(`- Differences across pages to support via props:\n${bullets(sh.differences, '  ')}`);
    }
    reqLines.push('- Rebuild using Tailwind utilities; match layout, spacing, typography and colors at 1440, 1000 and 390 px wide.');

    const content = renderTemplate('shell', {
      taskId: id,
      name: sh.name,
      targets: bullets(targets.map(code)),
      inputs: bullets([`Generated shell component: ${code(sh.file)}`]),
      requirements: reqLines.join('\n'),
      rules: SHARED_RULES,
      doneWhen: `Run \`${checkCommand(id, testing)}\` and stop when it passes or reports the limit.`,
    });

    await writeFile(path.join(ctx.nextDir, `.convert/tasks/${id}.md`), content, 'utf8');
  }

  // 2. Section & Part tasks
  for (const page of manifest.pages) {
    for (const sec of page.sections) {
      if (sec.parts && sec.parts.length > 0) {
        // Part tasks
        for (const part of sec.parts) {
          const id = `sec-${page.slug}-${kebabName(sec.name)}-${kebabName(part.name)}`;
          const targets = [part.file, dirTarget(part.file)];

          const reqLines: string[] = [
            `- Export the React component \`${part.component}\` from ${code(part.file)}.`,
            `- Part of oversized section \`${sec.name}\` for route ${code(page.route)}.`,
            `- Rebuild using Tailwind utilities; match layout, spacing, typography and colors at 1440, 1000 and 390 px wide.`,
          ];

          const content = renderTemplate('section', {
            taskId: id,
            name: `${sec.name} / ${part.name}`,
            targets: bullets(targets.map(code)),
            inputs: bullets([`Generated part component: ${code(part.file)}`]),
            requirements: reqLines.join('\n'),
            rules: SHARED_RULES,
            doneWhen: `Run \`${checkCommand(id, testing)}\` and stop when it passes or reports the limit.`,
          });

          await writeFile(path.join(ctx.nextDir, `.convert/tasks/${id}.md`), content, 'utf8');
        }
      } else {
        // Normal section task
        const id = `sec-${page.slug}-${kebabName(sec.name)}`;
        const targets = [sec.file, dirTarget(sec.file)];

        const reqLines: string[] = [];

        // Breakpoints / Variants
        if (sec.hasVariants) {
          reqLines.push(
            '- Breakpoints: elements under `data-variant` are the same content per breakpoint; merge them into one responsive component with `md:` (≥ 810 px) and `lg:` (≥ 1200 px).'
          );
        }

        // Repeated items
        if (sec.repeated && sec.repeated.length > 0) {
          reqLines.push(
            `- Repeated items: ${sec.repeated.map(code).join(', ')}; render them from a data array with one component.`
          );
        }

        // Motion animations
        const secMotion = (sec.motion || [])
          .map((mId) => manifest.motion.find((m) => m.id === mId))
          .filter((m): m is MotionAnchor => Boolean(m));
        if (secMotion.length > 0) {
          reqLines.push(`- Animations:\n${bullets(secMotion.map(formatMotionLine), '  ')}`);
        }

        // Script-drawn content
        const secSd = manifest.scriptDrawn.filter((sd) => sd.section === sec.name);
        if (secSd.length > 0) {
          reqLines.push(`- Script-drawn content:\n${bullets(secSd.map(formatScriptDrawnLine), '  ')}`);
        }

        // CMS fields
        if (sec.cmsFields && sec.cmsFields.length > 0) {
          reqLines.push(
            `- CMS fields: render from the \`item\` prop: ${sec.cmsFields.map((f) => `\`cms:${f}\``).join(', ')}.`
          );
        }

        // Unanchored animations for this section or route
        const unanchored = manifest.motion.filter(
          (m) => !m.matched && (m.section === sec.name || (!m.section && m.route === page.route))
        );
        if (unanchored.length > 0) {
          reqLines.push(
            `\n### Unanchored animations\n${bullets(unanchored.map((m) => m.entry.framerName ?? m.entry.selector))}`
          );
        }

        const content = renderTemplate('section', {
          taskId: id,
          name: sec.name,
          targets: bullets(targets.map(code)),
          inputs: bullets([`Generated section JSX: ${code(sec.file)}`]),
          requirements: reqLines.join('\n'),
          rules: SHARED_RULES,
          doneWhen: `Run \`${checkCommand(id, testing)}\` and stop when it passes or reports the limit.`,
        });

        await writeFile(path.join(ctx.nextDir, `.convert/tasks/${id}.md`), content, 'utf8');
      }
    }

    // 3. Page task
    const pageId = `page-${page.slug}`;
    const wrapperFiles = page.sections.filter((s) => s.parts && s.parts.length > 0).map((s) => s.file);
    const pageTargets = [page.view, `src/components/page/${page.slug}/`, ...wrapperFiles];

    const pageReqLines: string[] = [
      `- Fill in the view component; compose the page sections in order:\n${bullets(page.sections.map((s) => code(s.component)), '  ')}`,
    ];

    if (page.dynamic) {
      pageReqLines.push(
        `- Dynamic route: read item from collection ${code(page.dynamic.collection)} (e.g. first item slug ${code(page.dynamic.firstSlug)}).`
      );
    }

    const pageUnanchored = manifest.motion.filter((m) => !m.matched && m.route === page.route);
    if (pageUnanchored.length > 0) {
      pageReqLines.push(
        `\n### Unanchored animations\n${bullets(pageUnanchored.map((m) => m.entry.framerName ?? m.entry.selector))}`
      );
    }

    pageReqLines.push('- Refactor the view\'s outer wrappers to clean Tailwind utilities.');
    pageReqLines.push('- Implement page-level effects (Lenis smooth scroll, page loader, custom cursor) if present.');

    const pageContent = renderTemplate('page', {
      taskId: pageId,
      route: page.route,
      targets: bullets(pageTargets.map(code)),
      inputs: bullets([`View file: ${code(page.view)}`]),
      requirements: pageReqLines.join('\n'),
      rules: SHARED_RULES,
      doneWhen: `Run \`${checkCommand(pageId, testing)}\` and stop when it passes or reports the limit.`,
    });

    await writeFile(path.join(ctx.nextDir, `.convert/tasks/${pageId}.md`), pageContent, 'utf8');
  }

  // 4. AGENTS.md and CLAUDE.md
  const guide = renderTemplate('agents', {
    rules: SHARED_RULES,
    exportDir: toPosix(path.relative(ctx.nextDir, ctx.exportDir)) || '.',
  });
  await writeFile(path.join(ctx.nextDir, 'AGENTS.md'), guide, 'utf8');
  await writeFile(path.join(ctx.nextDir, 'CLAUDE.md'), guide, 'utf8');
}

/**
 * Creates TaskRecord entries from the manifest, calls `renderTaskFiles`, sets `stages.tasks = 'done'`.
 * Keeps status and attempts of existing ids.
 */
export async function runTasks(
  ctx: StageContext,
  manifestParam?: GeneratedManifest,
): Promise<TaskRecord[]> {
  ctx.state.warnings = ctx.state.warnings.filter((w) => !w.startsWith('tasks:'));

  let manifest = manifestParam ?? (await readManifest(ctx.nextDir));
  if (!manifest) {
    manifest = await manifestFallback(ctx);
  }
  if (!manifest) {
    throw new Error('No generated manifest found: run the generate stage first');
  }

  // Shell task records
  const shellTasks: TaskRecord[] = manifest.shell.map((sh) => {
    const kebab = kebabName(sh.name);
    const id = `shell-${kebab}`;
    const file = `.convert/tasks/${id}.md`;
    const targets = [sh.file, dirTarget(sh.file)];
    const prev = ctx.state.tasks[id];
    return {
      id,
      kind: 'shell',
      section: sh.name,
      file,
      targets,
      dependsOn: [],
      status: prev?.status ?? 'pending',
      attempts: prev?.attempts ?? 0,
    };
  });

  const allShellIds = shellTasks.map((t) => t.id);

  // Section & Part task records
  const sectionTasks: TaskRecord[] = [];
  for (const page of manifest.pages) {
    for (const sec of page.sections) {
      if (sec.parts && sec.parts.length > 0) {
        for (const part of sec.parts) {
          const id = `sec-${page.slug}-${kebabName(sec.name)}-${kebabName(part.name)}`;
          const file = `.convert/tasks/${id}.md`;
          const targets = [part.file, dirTarget(part.file)];
          const prev = ctx.state.tasks[id];
          sectionTasks.push({
            id,
            kind: 'section',
            route: page.route,
            section: `${sec.name}/${part.name}`,
            file,
            targets,
            dependsOn: [...allShellIds],
            status: prev?.status ?? 'pending',
            attempts: prev?.attempts ?? 0,
          });
        }
      } else {
        const id = `sec-${page.slug}-${kebabName(sec.name)}`;
        const file = `.convert/tasks/${id}.md`;
        const targets = [sec.file, dirTarget(sec.file)];
        const prev = ctx.state.tasks[id];
        sectionTasks.push({
          id,
          kind: 'section',
          route: page.route,
          section: sec.name,
          file,
          targets,
          dependsOn: [...allShellIds],
          status: prev?.status ?? 'pending',
          attempts: prev?.attempts ?? 0,
        });
      }
    }
  }

  // Page task records
  const pageTasks: TaskRecord[] = manifest.pages.map((page) => {
    const id = `page-${page.slug}`;
    const file = `.convert/tasks/${id}.md`;
    const wrapperFiles = page.sections.filter((s) => s.parts && s.parts.length > 0).map((s) => s.file);
    const targets = [page.view, `src/components/page/${page.slug}/`, ...wrapperFiles];

    const pageSecPartIds: string[] = [];
    for (const sec of page.sections) {
      if (sec.parts && sec.parts.length > 0) {
        for (const part of sec.parts) {
          pageSecPartIds.push(`sec-${page.slug}-${kebabName(sec.name)}-${kebabName(part.name)}`);
        }
      } else {
        pageSecPartIds.push(`sec-${page.slug}-${kebabName(sec.name)}`);
      }
    }
    const usedShellIds = (page.shell || []).map((shName) => `shell-${kebabName(shName)}`);
    const dependsOn = [...new Set([...pageSecPartIds, ...usedShellIds])];

    const prev = ctx.state.tasks[id];
    return {
      id,
      kind: 'page',
      route: page.route,
      file,
      targets,
      dependsOn,
      sections: page.sections.map((s) => s.name),
      status: prev?.status ?? 'pending',
      attempts: prev?.attempts ?? 0,
      ...(prev?.passedSections ? { passedSections: prev.passedSections } : {}),
    };
  });

  const records = [...shellTasks, ...sectionTasks, ...pageTasks];

  for (const r of records) {
    ctx.state.tasks[r.id] = r;
  }

  await renderTaskFiles(ctx, manifest);

  ctx.state.stages.tasks = 'done';
  await saveState(ctx.state);
  return records;
}
