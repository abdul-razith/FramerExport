import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { framerAdapter } from '../../src/convert/adapters/framer/index.js';
import { derivePages } from '../../src/convert/adapters/framer/routes.js';
import { runPipeline } from '../../src/convert/pipeline.js';
import { initState } from '../../src/convert/state.js';
import { runAnalyze } from '../../src/convert/stages/analyze.js';
import { runExtractCms } from '../../src/convert/stages/extract-cms.js';
import { generateFiles } from '../../src/convert/stages/scaffold/index.js';
import type { PageInfo, Tokens } from '../../src/convert/types.js';

const tmps: string[] = [];
after(async () => {
  for (const d of tmps) await rm(d, { recursive: true, force: true });
});

const BREAKPOINTS = '<style>@media (min-width: 1200px) { .a { color: red; } } @media (max-width: 809.98px) { .a { color: blue; } }</style>';
const doc = (title: string, main: string, description = '') =>
  `<!doctype html><html><head><title>${title}</title>${BREAKPOINTS}${description ? `<meta name="description" content="${description}">` : ''}</head><body><div id="main">${main}</div></body></html>`;

async function makeExport(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fexport demote export '));
  tmps.push(dir);
  await mkdir(path.join(dir, 'subpages'), { recursive: true });
  await writeFile(path.join(dir, 'export-report.json'), JSON.stringify({ platform: 'framer' }));
  for (const [rel, content] of Object.entries(files)) await writeFile(path.join(dir, rel), content);
  return dir;
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

test('a lone detail page under a listing page stays static', async () => {
  const dir = await makeExport({
    'index.html': doc('Home', '<section data-framer-name="Hero"></section>'),
    'subpages/about.html': doc('About', '<section data-framer-name="Story"></section>'),
    'subpages/about_team.html': doc('Team', '<section data-framer-name="People"></section>'),
  });
  const pages = await derivePages(dir);
  assert.deepEqual(pages.map((p) => p.route), ['/', '/about', '/about/team']);
  assert.ok(pages.every((p) => !p.dynamic));
});

test('pipeline: /, /about, /about/team yields a static /about/team and a buildable scaffold', async () => {
  const exportDir = await makeExport({
    'index.html': doc('Home', '<section data-framer-name="Hero"></section>'),
    'subpages/about.html': doc('About', '<section data-framer-name="Story"></section>'),
    'subpages/about_team.html': doc('Team', '<section data-framer-name="People"></section>'),
  });
  const nextDir = exportDir + '-next';
  tmps.push(nextDir);
  const prev = process.env.FEXPORT_CONVERT_NO_ANIMATIONS;
  process.env.FEXPORT_CONVERT_NO_ANIMATIONS = '1';
  try {
    await runPipeline(exportDir, nextDir, { confirm: async () => true, log: () => {} });
  } finally {
    if (prev === undefined) delete process.env.FEXPORT_CONVERT_NO_ANIMATIONS;
    else process.env.FEXPORT_CONVERT_NO_ANIMATIONS = prev;
  }
  const pages = JSON.parse(await readFile(path.join(nextDir, '.convert', 'analysis', 'pages.json'), 'utf8')) as PageInfo[];
  const team = pages.find((p) => p.route === '/about/team');
  assert.ok(team, pages.map((p) => p.route).join(', '));
  assert.equal(team.dynamic, undefined);
  assert.equal(team.sourceFile, 'subpages/about_team.html');
  const team_page = await readFile(path.join(nextDir, 'src', 'app', 'about', 'team', 'page.tsx'), 'utf8');
  assert.match(team_page, /title: "Team"/);
  for (const f of await walk(path.join(nextDir, 'src'))) {
    assert.doesNotMatch(await readFile(f, 'utf8'), /@\/content\/'/, f);
  }
});

test('extract-cms: two similar detail pages without CMS data become static pages', async () => {
  const detail = (title: string, text: string) =>
    doc(title, `<div data-framer-name="Post"><h1>${text}</h1><div data-framer-name="Body"></div></div>`, `About ${title}`);
  const exportDir = await makeExport({
    'index.html': doc('Home', '<section data-framer-name="Hero"></section>'),
    'subpages/blog.html': doc('Blog', '<section data-framer-name="List"></section>'),
    'subpages/blog_one.html': detail('One', 'First'),
    'subpages/blog_two.html': detail('Two', 'Second'),
  });
  const nextDir = await mkdtemp(path.join(os.tmpdir(), 'fexport demote next '));
  tmps.push(nextDir);
  const ctx = { state: initState(exportDir, nextDir), exportDir, nextDir, log: () => {} };
  await runAnalyze(ctx, framerAdapter, { animations: false });
  const before = JSON.parse(await readFile(path.join(nextDir, '.convert', 'analysis', 'pages.json'), 'utf8')) as PageInfo[];
  assert.deepEqual(before.find((p) => p.dynamic)?.dynamic?.members, [
    { slug: 'one', sourceFile: 'subpages/blog_one.html' },
    { slug: 'two', sourceFile: 'subpages/blog_two.html' },
  ]);
  await runExtractCms(ctx);
  const pages = JSON.parse(await readFile(path.join(nextDir, '.convert', 'analysis', 'pages.json'), 'utf8')) as PageInfo[];
  assert.deepEqual(pages.map((p) => p.route), ['/', '/blog', '/blog/one', '/blog/two']);
  assert.ok(pages.every((p) => !p.dynamic));
  const two = pages.find((p) => p.route === '/blog/two')!;
  assert.equal(two.sourceFile, 'subpages/blog_two.html');
  assert.equal(two.title, 'Two');
  assert.equal(two.meta.description, 'About Two');
  assert.ok(ctx.state.warnings.some((w) => w.startsWith('extract-cms:') && w.includes('/blog/[slug]')));
});

test('scaffold refuses a dynamic page without a collection', () => {
  const tokens: Tokens = { colors: {}, tokenMap: {}, fonts: [], typeScale: [], breakpoints: { md: 810, lg: 1200 } };
  const page: PageInfo = {
    route: '/blog/[slug]',
    sourceFile: 'subpages/blog_one.html',
    title: 'One',
    meta: {},
    dynamic: { param: 'slug', collection: '', slugs: ['one'], members: [{ slug: 'one', sourceFile: 'subpages/blog_one.html' }] },
  };
  assert.throws(
    () => generateFiles({ pages: [page], tokens, components: [], animations: [] }, {}),
    /dynamic route \/blog\/\[slug\] has no CMS collection/,
  );
});

test('page without detected sections: task and verify share one `page` section on #main', async () => {
  const { sectionsWithFallback } = await import('../../src/convert/stages/tasks.js');
  assert.deepEqual(sectionsWithFallback(framerAdapter.sections(doc('Empty', ''))), [{ name: 'page', selector: '#main' }]);
  const exportDir = await makeExport({ 'index.html': doc('Empty', '') });
  const nextDir = exportDir + '-next';
  tmps.push(nextDir);
  const prev = process.env.FEXPORT_CONVERT_NO_ANIMATIONS;
  process.env.FEXPORT_CONVERT_NO_ANIMATIONS = '1';
  try {
    await runPipeline(exportDir, nextDir, { confirm: async () => true, log: () => {} });
  } finally {
    if (prev === undefined) delete process.env.FEXPORT_CONVERT_NO_ANIMATIONS;
    else process.env.FEXPORT_CONVERT_NO_ANIMATIONS = prev;
  }
  const task = await readFile(path.join(nextDir, '.convert', 'tasks', 'sec-home-page.md'), 'utf8');
  assert.match(task, /section page/);
  assert.match(task, /data-section/);
});
