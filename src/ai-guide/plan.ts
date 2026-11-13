import fs from 'node:fs/promises';
import path from 'node:path';
import { sectionDirName } from './section-ref.js';
import type { GuideCollection, GuidePage, GuideSection, GuideSite } from './types.js';

export interface PlanTask {
  number: number;
  title: string;
  kind: 'setup' | 'shell' | 'page' | 'collection' | 'review';
  route?: string;
}

const titleCase = (s: string) => s.split(/[-_\s/]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const pascal = (s: string) => titleCase(s.replace(/[^A-Za-z0-9]+/g, ' ')).replace(/\s+/g, '');

/** `/` → `Home`, `/play-ground` → `Play Ground`. */
export function pageName(route: string): string {
  return route === '/' ? 'Home' : titleCase(route.replace(/^\//, ''));
}

/** Folder for a page's section components: `/` → `home`, `/play-ground` → `play-ground`. */
const pageFolder = (route: string) => (route === '/' ? 'home' : route.replace(/^\//, '').replace(/\//g, '-'));

/** Pages that get their own task: everything except CMS list and detail pages. */
function pageTasksOf(site: GuideSite): GuidePage[] {
  const lists = new Set(site.collections.map((c) => c.indexRoute));
  return site.pages.filter((p) => !p.collection && !lists.has(p.route));
}

export function planTasks(site: GuideSite): PlanTask[] {
  const tasks: Omit<PlanTask, 'number'>[] = [
    { title: 'Create the Next.js project', kind: 'setup' },
    { title: 'Site shell', kind: 'shell' },
    ...pageTasksOf(site).map((p) => ({ title: `${pageName(p.route)} page (${p.route})`, kind: 'page' as const, route: p.route })),
    ...site.collections.map((c) => ({ title: `${titleCase(c.name)} collection (${c.indexRoute})`, kind: 'collection' as const, route: c.indexRoute })),
    { title: 'Review and cleanup', kind: 'review' },
  ];
  return tasks.map((t, i) => ({ ...t, number: i }));
}

export const CREATE_APP = 'npx create-next-app@latest nextjs-app --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes';
export const INSTALL = 'npm i motion gsap @gsap/react lenis @next/mdx @mdx-js/loader @mdx-js/react';
export const INSTALL_DEV = 'npm i -D @types/mdx puppeteer pngjs pixelmatch';
export const GATE = '≥ 90% at 1440, 1024 and 390';

const step = (n: number, title: string, body: string) => `- [ ] **Step ${n}: ${title}** — ${body}`;
/** `npm run compare -- <route> --section <id>`: the `--` keeps npm from taking the flags for itself. */
const compareCmd = (route: string, id?: string) => `\`npm run compare -- ${route}${id ? ` --section ${id}` : ''}\``;

function verifyStep(n: number, routes: string[]): string {
  return step(
    n,
    'Verify',
    `Use superpowers:verification-before-completion. In \`nextjs-app/\`: \`npm run build\` and \`npm run lint\` pass; ${routes
      .map((r) => compareCmd(r))
      .join(', ')} with \`npm run dev\` running: every section of this task shows ${GATE}; list any section still below with its scores and the reason. Check the page at desktop and mobile width.`
  );
}

const commitStep = (n: number, message: string) => step(n, 'Commit', `\`git add -A && git commit -m "${message}"\``);

const SHOWN = 6;
/** For a section that animates: build its animations in the same step, from ref.md's exact settings. */
function motionPart(s: GuideSection): string {
  const m = s.motion ?? [];
  if (!m.length) return '';
  const list = m.slice(0, SHOWN).join(', ') + (m.length > SHOWN ? `, +${m.length - SHOWN} more` : '');
  return ` → animate it with motion or GSAP using the exact settings in the \`## Animations\` part of ref.md (${list}); compare must print \`motion ✓\` for it, \`motion ✗\` means nothing moved`;
}

/** The page-level animation step: page-wide motion, then compare proves every animated section moves. */
function animationsStep(n: number, motionMds: string[], routes: string[]): string {
  return step(
    n,
    'Animations',
    `what the section steps did not cover: the page-wide motion and custom behaviour in ${motionMds.map((m) => `\`${m}\``).join(' and ')} (loader, cursor, scroll effects), checked against its \`frames/\`. Then, with \`npm run dev\` running, ${routes.map((r) => compareCmd(r)).join(' and ')}: no section may show \`motion ✗\` (it has animations in its ref.md but nothing moved). Do not tick this step while one does.`
  );
}

/** The per-section loop: read the export references, build, compare, fix (at most 3 rounds). */
function sectionStep(n: number, s: GuideSection, dir: string, component: string, content: string, route: string): string {
  const naming = s.generic ? ' (the layer name is generic: choose a meaningful component name)' : '';
  return step(
    n,
    `${s.id} ${s.name}`,
    `read \`${dir}/\` (ref.md, markup, styles.css, shot slices) → build \`${component}\`${naming} with its content from \`${content}\` and \`data-section="${s.id}"\` on its root${motionPart(s)} → ${compareCmd(route, s.id)} → fix and compare again, at most 3 fix rounds, until ${GATE}${s.motion?.length ? ' and `motion ✓`' : ''} → tick this step and write the three scores after it.`
  );
}

function setupTask(site: GuideSite): string[] {
  const routes = site.pages.filter((p) => !p.collection).map((p) => p.route);
  const detailStubs = site.collections.map((c) => `\`src/app${c.indexRoute}/[slug]/page.tsx\``);
  return [
    '**Files:** create `nextjs-app/` with create-next-app, then `next.config.ts`, `package.json` scripts, `src/app/globals.css`, `src/app/fonts.css`, `src/app/layout.tsx`, `public/fonts/*`, `public/images/*`, a stub `page.tsx` per route.',
    '**Read first:** `ai-guide/site.md`, `ai-guide/tokens.md`, `ai-guide/text-styles.css`, `ai-guide/files.md`.',
    '',
    step(1, 'Create the project', `in the export folder run \`${CREATE_APP}\`. It creates \`nextjs-app/\` with TypeScript, Tailwind, ESLint, the App Router, a \`src/\` folder, the \`@/*\` alias and a \`.gitignore\`.`),
    step(2, 'Install', `in \`nextjs-app/\`: \`${INSTALL}\` and \`${INSTALL_DEV}\` (latest versions; the last three are for \`npm run compare\`).`),
    step(3, 'Configure', 'MDX in `next.config.ts` with `@next/mdx` (`pageExtensions` includes `md` and `mdx`) and `src/mdx-components.tsx`; add the script `"compare": "node ../ai-guide/scripts/compare.mjs"` to `package.json`.'),
    step(4, 'Tokens', 'every colour, font, radius and shadow from `ai-guide/tokens.md` into `@theme` in `src/app/globals.css`; custom variants `tablet` = `@media (min-width: 810px) and (max-width: 1199px)` and `mobile` = `@media (max-width: 809px)` (the same ranges as Framer, so a tablet class never leaks into mobile).'),
    step(5, 'Text styles', 'turn each Framer text preset in `ai-guide/text-styles.css` into one Tailwind `@utility` in `src/app/globals.css`, named after its role (`text-heading-1`, `text-body`…), keeping its exact values per width; note in a comment which preset class each one replaces.'),
    step(6, 'Fonts', 'copy the font files listed in `ai-guide/files.md` to `public/fonts/` and declare them with `@font-face` in `src/app/fonts.css`, imported by `src/app/layout.tsx`.'),
    step(7, 'Images', 'copy every image in `ai-guide/files.md` from its export path to its suggested `public/images/...` name.'),
    step(
      8,
      'Route stubs',
      `a \`page.tsx\` under \`src/app/\` for each route that renders its title and "Not built yet": ${routes.join(', ')}${detailStubs.length ? `; plus ${detailStubs.join(', ')} for CMS detail pages` : ''}. Metadata (title, description) from \`ai-guide/site.md\`.`
    ),
    step(9, 'Verify', 'Use superpowers:verification-before-completion. In `nextjs-app/`: `npm run build` and `npm run lint` pass; `npm run dev` serves every route.'),
    commitStep(10, 'chore: create the Next.js project'),
  ];
}

function shellTask(site: GuideSite): string[] {
  const home = site.pages.find((p) => p.route === '/') ?? site.pages[0];
  const parts = site.shell ?? home.shell ?? [];
  const lines = [
    '**Files:** `src/components/layout/*` (Navbar, Footer, Loader, page background…), `src/components/motion/*`, `src/app/layout.tsx`, `src/content/layout.ts`.',
    `**Read first:** \`ai-guide/site.md\` (navigation, footer, shared sections), the folders in \`ai-guide/shell/\`, \`ai-guide/pages/${home.slug}/motion.md\` (the "Custom behaviour" and "Page-wide" parts), \`ai-guide/pages/${home.slug}/frames/load/\`.`,
    '',
    step(1, 'Layout content', '`src/content/layout.ts` with the navigation and footer links and texts from `ai-guide/site.md` and the shell `ref.md` files.'),
  ];
  parts.forEach((s, i) => {
    lines.push(sectionStep(i + 2, s, `ai-guide/shell/${sectionDirName(s)}`, `src/components/layout/${pascal(s.name) || `Part${i + 1}`}.tsx`, 'src/content/layout.ts', s.ownerRoute ?? '/'));
  });
  let n = parts.length + 2;
  lines.push(step(n++, 'Mobile menu and smooth scroll', 'a working mobile menu (button + panel, see the `## Interactive` part of the header ref.md); Lenis smooth scroll; only the custom behaviour `motion.md` lists.'));
  lines.push(step(n++, 'Root layout', '`src/app/layout.tsx` with fonts, the shell parts and Lenis; shared sections listed in `site.md` become components used by every page that has them.'));
  lines.push(verifyStep(n++, ['/', site.pages.find((p) => p.route !== '/' && !p.collection)?.route ?? '/']));
  lines.push(commitStep(n, 'feat: site shell'));
  return lines;
}

function pageTask(page: GuidePage): string[] {
  const base = `ai-guide/pages/${page.slug}`;
  const folder = pageFolder(page.route);
  const prefix = pascal(pageName(page.route));
  const content = `src/content/${folder}.ts`;
  const appFile = `src/app${page.route === '/' ? '' : page.route}/page.tsx`;
  const lines = [
    `**Files:** \`${content}\`, \`src/components/sections/${folder}/*.tsx\`, \`${appFile}\`.`,
    `**Read first:** \`${base}/desktop.png\`, \`${base}/tablet.png\`, \`${base}/mobile.png\`, \`${base}/motion.md\`, then each section folder in \`${base}/sections/\` when its step starts.`,
    '',
    step(1, 'Content', `\`${content}\` with every text, image and link of the page, from the \`## Content\` part of each section's ref.md, keyed by section.`),
  ];
  page.sections.forEach((s, i) => {
    const name = s.generic ? `${prefix}<Name>` : `${prefix}${pascal(s.name)}`;
    lines.push(sectionStep(i + 2, s, `${base}/sections/${sectionDirName(s)}`, `src/components/sections/${folder}/${name}.tsx`, content, page.route));
  });
  let n = page.sections.length + 2;
  lines.push(animationsStep(n++, [`${base}/motion.md`], [page.route]));
  lines.push(step(n++, 'Interactive states', 'every state in the `## Interactive` part of the section ref.md files (hover, open/closed), matching its before/after screenshots.'));
  lines.push(step(n++, 'Page', `\`${appFile}\` renders the sections in order with metadata.`));
  lines.push(verifyStep(n++, [page.route]));
  lines.push(commitStep(n, `feat: ${pageName(page.route).toLowerCase()} page`));
  return lines;
}

function collectionTask(c: GuideCollection, site: GuideSite): string[] {
  const list = site.pages.find((p) => p.route === c.indexRoute);
  const item = site.pages.find((p) => p.collection === c.name);
  const dir = c.indexRoute.replace(/^\//, '');
  const first = c.items[0]?.route ?? c.indexRoute;
  return [
    `**Files:** \`src/content/${c.name}/*.mdx\`, \`src/lib/${c.name}.ts\`, \`src/app/${dir}/page.tsx\`, \`src/app/${dir}/[slug]/page.tsx\`, \`src/components/sections/${dir}/*\`.`,
    `**Read first:** \`ai-guide/content.md\` (collection "${c.name}")${list ? `, \`ai-guide/pages/${list.slug}/sections/\`` : ''}${item ? `, \`ai-guide/pages/${item.slug}/sections/\` (one detail page)` : ''}.`,
    '',
    step(1, 'MDX items', `one \`src/content/${c.name}/<slug>.mdx\` per item listed in \`ai-guide/content.md\` (${c.items.length} items), front matter as described there, body = the article text from the item's export file.`),
    step(2, 'Loader', `\`src/lib/${c.name}.ts\`: typed list of items sorted as on the list page, and lookup by slug.`),
    step(3, 'List page', `\`src/app/${dir}/page.tsx\` and its sections, each built like a page section: ref.md + markup + styles.css → ${compareCmd(c.indexRoute, '<id>')} until ${GATE}.`),
    step(4, 'Detail template', `\`src/app/${dir}/[slug]/page.tsx\` with \`generateStaticParams\`, built from the detail page's section folders the same way (${compareCmd(first, '<id>')}); renders any item.`),
    animationsStep(5, [list, item].filter((p): p is GuidePage => !!p).map((p) => `ai-guide/pages/${p.slug}/motion.md`), [c.indexRoute, first]),
    verifyStep(6, [c.indexRoute, first]),
    commitStep(7, `feat: ${c.name} collection`),
  ];
}

function reviewTask(site: GuideSite): string[] {
  const routes = site.pages.filter((p) => !p.collection).map((p) => p.route);
  return [
    '**Files:** anything in `nextjs-app/` that the checks below find.',
    '**Read first:** `AGENTS.md`, `ai-guide/checklist.md`.',
    '',
    step(1, 'Duplicates', 'markup repeated in two or more components moves into `src/components/ui`.'),
    step(2, 'Names and size', 'meaningful component and prop names; no file over about 200 lines.'),
    step(3, 'No leftovers', 'no raw hex colours, no framer-* class names or Framer scripts, no placeholder text, no TODOs.'),
    step(4, 'Accessibility basics', 'alt text, one h1 per page, buttons vs links, focus styles, `prefers-reduced-motion`.'),
    verifyStep(5, routes),
    commitStep(6, 'refactor: review and cleanup'),
  ];
}

export function renderPlan(site: GuideSite): string {
  const out = [
    `# ${site.name} — Next.js rebuild plan`,
    '',
    '> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.',
    '',
    `**Goal:** Build a clean, editable Next.js version of ${site.name} (${site.sourceUrl}) in \`nextjs-app/\` that matches the original.`,
    '',
    "**Architecture:** One task per page, one step per section. Each section is built from the export's own markup and CSS (`ai-guide/pages/<page>/sections/<id>-<name>/`), then compared with the original until it matches; content lives in `src/content/` and MDX; shared parts live in `src/components/layout` and `src/components/ui`.",
    '',
    '**Tech Stack:** Next.js (App Router, `src/` folder, from `create-next-app@latest`), React, TypeScript, Tailwind CSS, motion, GSAP ScrollTrigger, Lenis, MDX.',
    '',
    '**Spec:** `ai-guide/site.md` and `AGENTS.md`.',
    '',
    '## Global Constraints',
    '',
    '- Follow every rule in `AGENTS.md`.',
    '- Reference widths 1440, 1024, 390; `tablet` = max 1199px, `mobile` = max 809px; fluid in between.',
    `- Every section: built from its \`markup*.html\` + \`styles.css\` with exact values, then ${GATE} in \`npm run compare\`, at most 3 fix rounds.`,
    '- Content only from `src/content/` and MDX; colours and fonts only from tokens; no Framer runtime, framer-* classes or inline style blobs.',
    '',
    '---',
    '',
  ];
  for (const t of planTasks(site)) {
    out.push(`### Task ${t.number}: ${t.title}`, '');
    const body =
      t.kind === 'setup'
        ? setupTask(site)
        : t.kind === 'shell'
          ? shellTask(site)
          : t.kind === 'page'
            ? pageTask(site.pages.find((p) => p.route === t.route)!)
            : t.kind === 'collection'
              ? collectionTask(site.collections.find((c) => c.indexRoute === t.route)!, site)
              : reviewTask(site);
    out.push(...body, '', '---', '');
  }
  return out.join('\n');
}

/** Writes plan.md, unless the existing one has ticked steps: then plan.new.md, so progress is kept. */
export async function writePlanFile(guideDir: string, content: string): Promise<'plan.md' | 'plan.new.md'> {
  const existing = await fs.readFile(path.join(guideDir, 'plan.md'), 'utf8').catch(() => '');
  const name = /- \[x\]/i.test(existing) ? 'plan.new.md' : 'plan.md';
  await fs.mkdir(guideDir, { recursive: true });
  await fs.writeFile(path.join(guideDir, name), content);
  return name;
}
