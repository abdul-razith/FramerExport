import fs from 'node:fs/promises';
import path from 'node:path';
import { NEXT_PROJECT_VERSIONS } from '../nextjs/versions.js';
import { sectionStem } from './outline.js';
import type { GuideCollection, GuidePage, GuideSite } from './types.js';

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

const step = (n: number, title: string, body: string) => `- [ ] **Step ${n}: ${title}** — ${body}`;

function verifyStep(n: number, routes: string[]): string {
  return step(
    n,
    'Verify',
    `Use superpowers:verification-before-completion. In \`nextjs-app/\`: \`npm run build\` and \`npm run lint\` pass; ${routes
      .map((r) => `\`npm run compare ${r}\``)
      .join(', ')} and read the side-by-side images in \`ai-guide/compare/\`; check the page in \`npm run dev\` at desktop and mobile width. Report the differences that remain.`
  );
}

const commitStep = (n: number, message: string) => step(n, 'Commit', `\`git add -A && git commit -m "${message}"\``);

function setupTask(site: GuideSite): string[] {
  const deps = Object.entries(NEXT_PROJECT_VERSIONS.dependencies).map(([k, v]) => `${k}@${v}`).join(' ');
  const devDeps = Object.entries(NEXT_PROJECT_VERSIONS.devDependencies).map(([k, v]) => `${k}@${v}`).join(' ');
  const routes = site.pages.filter((p) => !p.collection).map((p) => p.route);
  return [
    '**Files:** create `nextjs-app/` (package.json, next.config.ts, tsconfig.json, postcss.config.mjs, eslint.config.mjs, .prettierrc, app/layout.tsx, app/globals.css, app/fonts.css, public/images/*, a stub `page.tsx` per route).',
    '**Read first:** `ai-guide/site.md`, `ai-guide/tokens.md`, `ai-guide/files.md`.',
    '',
    step(1, 'Create the project', `in \`nextjs-app/\` with App Router, TypeScript, \`src\`-less layout and the \`@/*\` import alias. Install exactly: \`npm install ${deps}\` and \`npm install -D ${devDeps}\`.`),
    step(2, 'Configure', 'MDX in `next.config.ts` (`pageExtensions` includes `mdx`), Tailwind 4 via `@tailwindcss/postcss`, ESLint flat config with `eslint-config-next`, Prettier with `prettier-plugin-tailwindcss`. Scripts: dev, build, start, lint, format, and `"compare": "node ../ai-guide/scripts/compare.mjs"`.'),
    step(3, 'Tokens', 'every colour, font, radius and shadow from `ai-guide/tokens.md` into `@theme` in `app/globals.css`; custom variants `tablet` = `@media (max-width: 1199px)` and `mobile` = `@media (max-width: 809px)`; base `box-sizing: border-box`.'),
    step(4, 'Fonts', 'copy the font files listed in `ai-guide/files.md` to `public/fonts/` and declare them with `@font-face` in `app/fonts.css`.'),
    step(5, 'Images', 'copy every image in `ai-guide/files.md` from its export path to its suggested `public/images/...` name.'),
    step(6, 'Route stubs', `a \`page.tsx\` for each route that renders its title and "Not built yet": ${routes.join(', ')}; plus \`app/${site.collections.map((c) => c.indexRoute.replace(/^\//, '')).join('|') || '<collection>'}/[slug]/page.tsx\` stubs for CMS detail pages. Metadata (title, description) from \`ai-guide/site.md\`.`),
    verifyStep(7, ['/']),
    commitStep(8, 'chore: create the Next.js project'),
  ];
}

function shellTask(site: GuideSite): string[] {
  const home = site.pages.find((p) => p.route === '/') ?? site.pages[0];
  return [
    '**Files:** `components/layout/Navbar.tsx`, `components/layout/Footer.tsx`, `components/layout/Loader.tsx` (when the site has one), `components/motion/*`, `app/layout.tsx`, `content/layout.ts`.',
    `**Read first:** \`ai-guide/site.md\` (navigation, footer, shared sections), \`ai-guide/pages/${home.slug}/outline.md\`, \`ai-guide/pages/${home.slug}/motion.md\` (the "Custom behaviour" and "Page-wide" parts), \`ai-guide/pages/${home.slug}/frames/load/\`.`,
    '',
    step(1, 'Layout content', '`content/layout.ts` with the navigation and footer links and texts from `ai-guide/site.md`.'),
    step(2, 'Navbar', 'desktop navigation and a working mobile menu (button + panel), matching the home screenshots at 1440 and 390; active link state.'),
    step(3, 'Footer', 'from the footer section of the outline and screenshots.'),
    step(4, 'Loader, cursor and smooth scroll', 'only what `motion.md` lists as custom behaviour (page loader, custom cursor, smooth scroll); rebuild the loader from the load frames.'),
    step(5, 'Root layout', '`app/layout.tsx` with fonts, Navbar, Footer, Loader and Lenis; shared sections listed in `site.md` become components used by every page that has them.'),
    verifyStep(6, ['/', site.pages.find((p) => p.route !== '/' && !p.collection)?.route ?? '/']),
    commitStep(7, 'feat: site shell'),
  ];
}

function pageTask(page: GuidePage): string[] {
  const base = `ai-guide/pages/${page.slug}`;
  const folder = pageFolder(page.route);
  const prefix = pascal(pageName(page.route));
  const lines = [
    `**Files:** \`content/${folder}.ts\`, \`components/sections/${folder}/*.tsx\`, \`app${page.route === '/' ? '' : page.route}/page.tsx\`.`,
    `**Read first:** \`${base}/outline.md\`, \`${base}/motion.md\`, \`${base}/desktop.png\`, \`${base}/tablet.png\`, \`${base}/mobile.png\`, the section crops in \`${base}/sections/\`.`,
    '',
    step(1, 'Content', `\`content/${folder}.ts\` with every text, image and link of the page from the outline, keyed by section.`),
  ];
  page.sections.forEach((s, i) => {
    const component = s.generic ? `components/sections/${folder}/${prefix}<Name>.tsx` : `components/sections/${folder}/${prefix}${pascal(s.name)}.tsx`;
    const naming = s.generic ? ' (the layer name is generic: choose a meaningful <Name>)' : '';
    lines.push(step(i + 2, s.name, `build \`${component}\` from \`${base}/outline.md#${sectionStem(s).slice(0, 2)}\` and \`${base}/sections/${sectionStem(s)}-*.png\`${naming}.`));
  });
  let n = page.sections.length + 2;
  lines.push(step(n++, 'Animations', `everything \`${base}/motion.md\` lists for this page, using the frames in \`${base}/frames/\`.`));
  lines.push(step(n++, 'Page', `\`app${page.route === '/' ? '' : page.route}/page.tsx\` renders the sections in order with metadata.`));
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
    `**Files:** \`content/${c.name}/*.mdx\`, \`lib/${c.name}.ts\`, \`app/${dir}/page.tsx\`, \`app/${dir}/[slug]/page.tsx\`, \`components/sections/${dir}/*\`.`,
    `**Read first:** \`ai-guide/content.md\` (collection "${c.name}")${list ? `, \`ai-guide/pages/${list.slug}/\`` : ''}${item ? `, \`ai-guide/pages/${item.slug}/\` (one detail page)` : ''}.`,
    '',
    step(1, 'MDX items', `one \`content/${c.name}/<slug>.mdx\` per item listed in \`ai-guide/content.md\` (${c.items.length} items), front matter as described there, body = the article text from the item's export file.`),
    step(2, 'Loader', `\`lib/${c.name}.ts\`: typed list of items sorted as on the list page, and lookup by slug.`),
    step(3, 'List page', `\`app/${dir}/page.tsx\` and its sections, built like a page task from the list page outline.`),
    step(4, 'Detail template', `\`app/${dir}/[slug]/page.tsx\` with \`generateStaticParams\`, built from the detail page outline; renders any item.`),
    step(5, 'Animations', 'from the list and detail pages\' `motion.md`.'),
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
    step(1, 'Duplicates', 'markup repeated in two or more components moves into `components/ui`.'),
    step(2, 'Names and size', 'meaningful component and prop names; no file over about 200 lines.'),
    step(3, 'No leftovers', 'no raw hex colours, no pixel positions copied from screenshots, no framer-* class names or Framer scripts, no placeholder text, no TODOs.'),
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
    `**Goal:** Build a clean, editable Next.js version of ${site.name} (${site.sourceUrl}) in \`nextjs-app/\`.`,
    '',
    '**Architecture:** One task per page. Each page is built from its outline, screenshots and motion notes in `ai-guide/pages/<page>/`; content lives in `content/` and MDX; shared parts live in `components/layout` and `components/ui`.',
    '',
    '**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind 4, motion, GSAP ScrollTrigger, Lenis, MDX.',
    '',
    '**Spec:** `ai-guide/site.md` and `AGENTS.md`.',
    '',
    '## Global Constraints',
    '',
    '- Follow every rule in `AGENTS.md`.',
    '- Reference widths 1440, 1024, 390; `tablet` = max 1199px, `mobile` = max 809px; fluid in between.',
    '- Content only from `content/` and MDX; colours only from tokens; no Framer runtime, classes or generated CSS.',
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
