import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { derivePages, routeFromSubpageFile, structureSignature } from '../../src/convert/adapters/framer/routes.js';

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
