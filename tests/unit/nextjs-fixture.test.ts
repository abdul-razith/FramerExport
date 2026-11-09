import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { serveFixture, FIXTURE_ROOT } from '../fixtures/nextjs/serve.js';

test('serveFixture serves the site with extensionless routes and 404s unknown paths', async () => {
  const server = await serveFixture(path.join(FIXTURE_ROOT, 'site'));
  try {
    const home = await fetch(server.url + '/');
    assert.equal(home.status, 200);
    assert.match(await home.text(), /data-framer-name="Hero Section"/);
    assert.equal((await fetch(server.url + '/blog/post-a')).status, 200);
    assert.equal((await fetch(server.url + '/missing')).status, 404);
  } finally {
    await server.close();
  }
});

test('fixture export folder is a Framer export with fonts and images', async () => {
  const exportDir = path.join(FIXTURE_ROOT, 'export');
  const report = JSON.parse(await fs.readFile(path.join(exportDir, 'export-report.json'), 'utf8'));
  assert.equal(report.platform, 'framer');
  await fs.stat(path.join(exportDir, 'assets/fonts/Inter-Regular.latin.woff2'));
  await fs.stat(path.join(exportDir, 'assets/images/hero.png'));
  const subpages = (await fs.readdir(path.join(exportDir, 'subpages'))).sort();
  assert.deepEqual(subpages, ['about.html', 'blog.html', 'blog_post-a.html', 'blog_post-b.html']);
});

test('export HTML carries animation start states that the live site does not', async () => {
  const exported = await fs.readFile(path.join(FIXTURE_ROOT, 'export/index.html'), 'utf8');
  const live = await fs.readFile(path.join(FIXTURE_ROOT, 'site/index.html'), 'utf8');
  assert.match(exported, /opacity:0;transform:translateY\(40px\)/);
  assert.match(exported, /display:inline-block;opacity:0\.001;transform:translateX\(40px\) scale\(0\.9\)/);
  assert.doesNotMatch(live, /opacity:0;transform/);
});
