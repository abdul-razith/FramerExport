import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { serveFixture, FIXTURE_ROOT } from '../fixtures/nextjs/serve.js';
import { capturePages, listExportPages } from '../../src/nextjs/capture.js';
import { extractStartStates } from '../../src/nextjs/framer/animations.js';
import { mergeBreakpoints } from '../../src/nextjs/framer/breakpoints.js';
import { detectCollections, itemToMdx } from '../../src/nextjs/framer/collections.js';
import { ImageNamer } from '../../src/nextjs/content.js';
import { emptyReport } from '../../src/nextjs/report.js';
import type { ConversionContext, PageModel } from '../../src/nextjs/model.js';

let server: { url: string; close(): Promise<void> };
let pages: PageModel[];
let exportHtml: Map<string, string>;

before(async () => {
  server = await serveFixture(path.join(FIXTURE_ROOT, 'site'));
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fexport-coll-'));
  const ctx: ConversionContext = {
    exportDir: path.join(FIXTURE_ROOT, 'export'),
    sourceUrl: server.url + '/',
    outDir: cacheDir,
    cacheDir,
    options: { aiRefine: false, verify: false, cliSkipPermissions: true },
    report: emptyReport(),
    log: () => {},
  };
  const list = listExportPages(ctx.exportDir, ctx.sourceUrl).filter((p) => p.route.startsWith('/blog'));
  exportHtml = new Map(list.map((p) => [p.route, p.exportHtml]));
  const { captured } = await capturePages(list, ctx);
  pages = captured.map((c) => ({
    route: c.route,
    sourceUrl: c.url,
    title: c.title,
    meta: c.meta,
    root: mergeBreakpoints(c, extractStartStates(exportHtml.get(c.route)!), ctx.report),
    screenshots: c.screenshots,
  }));
});

after(async () => {
  await server?.close();
});

test('the fixture blog is detected with its fields', () => {
  const [blog] = detectCollections(pages);
  assert.equal(blog.name, 'blog');
  assert.deepEqual(blog.itemRoutes, ['/blog/post-a', '/blog/post-b']);
  assert.deepEqual(
    blog.fields.map((f) => [f.key, f.kind]),
    [
      ['title', 'text'],
      ['date', 'date'],
      ['cover', 'image'],
    ]
  );
});

test('itemToMdx produces metadata and a markdown body in document order', () => {
  const [blog] = detectCollections(pages);
  const images = new ImageNamer();
  const used = new Set<string>();
  const page = pages.find((p) => p.route === '/blog/post-a')!;
  const item = itemToMdx(page, blog, { exportHtml: exportHtml.get(page.route)!, images, usedSlugs: used });
  assert.equal(item.slug, 'post-a');
  assert.equal(item.file, 'blog/post-a.mdx');
  assert.deepEqual(item.metadata, {
    title: 'The Power of Focus',
    date: '2025-03-12',
    cover: '/images/the-power-of-focus.png',
  });
  assert.match(item.body, /^Focus is a skill/m);
  assert.match(item.body, /^## Deep Work$/m);
  assert.match(item.body, /^- Define the outcome$/m);
  assert.match(item.body, /Read more \[about focus\]\(https:\/\/example\.com\/focus\)\./);
  assert.match(item.body, /!\[Desk detail\]\(\/images\/desk-detail\.png\)/);
});

test('colliding slugs get a numeric suffix', () => {
  const [blog] = detectCollections(pages);
  const ctx = { images: new ImageNamer(), usedSlugs: new Set<string>() };
  const page = pages.find((p) => p.route === '/blog/post-a')!;
  const html = exportHtml.get(page.route)!;
  assert.equal(itemToMdx(page, blog, { ...ctx, exportHtml: html }).slug, 'post-a');
  assert.equal(itemToMdx(page, blog, { ...ctx, exportHtml: html }).slug, 'post-a-2');
});
