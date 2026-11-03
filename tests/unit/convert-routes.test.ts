import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  derivePages,
  namedLayers,
  routeFromSubpageFile,
  structureSignature,
  templateSimilarity
} from '../../src/convert/adapters/framer/routes.js';

const fixture = path.resolve('tests/fixtures/framer-nudge-mini');

test('routeFromSubpageFile maps export file names to routes', () => {
  assert.equal(routeFromSubpageFile('index.html'), '/');
  assert.equal(routeFromSubpageFile('about.html'), '/about');
  assert.equal(routeFromSubpageFile('blog_the-power-of-focus.html'), '/blog/the-power-of-focus');
});

test('structureSignature ignores text and attribute values except data-framer-name', () => {
  const a = '<div id="main"><div data-framer-name="Hero" class="x"><p>Hello</p></div></div>';
  const b = '<div id="main"><div data-framer-name="Hero" class="y"><p>Bye</p></div></div>';
  const c = '<div id="main"><div data-framer-name="Other"><p>Hello</p></div></div>';
  assert.equal(structureSignature(a), structureSignature(b));
  assert.notEqual(structureSignature(a), structureSignature(c));
});

test('derivePages groups CMS detail pages into dynamic routes', async () => {
  const pages = await derivePages(fixture);
  const routes = pages.map((p) => p.route);
  for (const r of ['/', '/about', '/blog', '/case-study', '/blog/[slug]', '/case-study/[slug]']) {
    assert.ok(routes.includes(r), `missing ${r} in ${routes.join(', ')}`);
  }
  assert.ok(!routes.includes('/blog/the-power-of-focus'));
  const blog = pages.find((p) => p.route === '/blog/[slug]');
  assert.deepEqual(blog?.dynamic, { param: 'slug', collection: '', slugs: ['the-power-of-focus'] });
  assert.equal(blog?.sourceFile, 'subpages/blog_the-power-of-focus.html');
  const cs = pages.find((p) => p.route === '/case-study/[slug]');
  assert.deepEqual(cs?.dynamic?.slugs, ['meridian-health']);
  assert.equal(pages.find((p) => p.route === '/')?.sourceFile, 'index.html');
  for (const p of pages) assert.ok(p.title.length > 0, `empty title for ${p.route}`);
  assert.ok(pages.find((p) => p.route === '/about')?.meta.description);
});

// On the real nudge export every blog/case-study detail page had a different exact #main skeleton:
// CMS-driven variant names (data-framer-name="Design" vs "Workspace" on a framer-v-* variant root), rich
// text runs, icon paths and a missing "Next Case Study" section on the last case study. Exact-signature
// grouping turned 11 of 12 detail pages into static routes.
test('namedLayers skips variant roots; templateSimilarity tolerates a missing section', () => {
  const html = (variant: string, extra = '') =>
    `<div id="main"><div data-framer-name="Hero"><h1><span>a</span></h1><div class="framer-punG5 framer-v-1jlddzp" data-framer-name="${variant}"><div data-framer-name="Category"></div></div></div>${extra}<div data-framer-name="Body"></div><div data-framer-name="Footer"></div></div>`;
  assert.deepEqual(namedLayers(html('Design')), namedLayers(html('Workspace')));
  assert.deepEqual(namedLayers(html('Design')), ['div[Hero]', 'div[Category]', 'div[Body]', 'div[Footer]']);
  const withNext = namedLayers(html('Design', '<div data-framer-name="Next"></div>'));
  assert.ok(templateSimilarity(namedLayers(html('Design')), withNext) >= 0.85);
  assert.ok(templateSimilarity(['div[A]', 'div[B]'], ['div[C]', 'div[D]']) === 0);
});

test('derivePages folds detail pages that differ only in variants and text runs into one dynamic route', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fexport routes '));
  try {
    const page = (title: string, variant: string, spans: string) =>
      `<html><head><title>${title}</title></head><body><div id="main"><div data-framer-name="Post"><h1>${spans}</h1><div class="framer-v-abc" data-framer-name="${variant}"></div></div></div></body></html>`;
    await mkdir(path.join(dir, 'subpages'));
    await writeFile(path.join(dir, 'index.html'), '<html><head><title>Home</title></head><body><div id="main"><section data-framer-name="Hero"></section></div></body></html>');
    await writeFile(path.join(dir, 'subpages', 'blog.html'), '<html><head><title>Blog</title></head><body><div id="main"><section data-framer-name="List"></section></div></body></html>');
    await writeFile(path.join(dir, 'subpages', 'blog_one.html'), page('One', 'Design', '<span>a</span>'));
    await writeFile(path.join(dir, 'subpages', 'blog_two.html'), page('Two', 'Workspace', '<span>a</span><span>b</span>'));
    await writeFile(path.join(dir, 'subpages', 'blog_three.html'), page('Three', 'Design', ''));
    // A different template under the same parent stays a static route.
    await writeFile(
      path.join(dir, 'subpages', 'blog_archive.html'),
      '<html><head><title>Archive</title></head><body><div id="main"><div data-framer-name="Grid"></div><div data-framer-name="Pager"></div></div></body></html>'
    );
    const pages = await derivePages(dir);
    assert.deepEqual(pages.map((p) => p.route), ['/', '/blog', '/blog/archive', '/blog/[slug]']);
    assert.deepEqual(pages.find((p) => p.dynamic)?.dynamic?.slugs, ['one', 'three', 'two']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
