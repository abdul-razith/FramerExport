import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serveFixture, FIXTURE_ROOT } from '../fixtures/nextjs/serve.js';
import { runToNextjs } from '../../src/nextjs/index.js';
import type { ConversionReport } from '../../src/nextjs/report.js';

const OPTIONS = { aiRefine: false, verify: true, cliSkipPermissions: true };
const NO_VERIFY = { ...OPTIONS, verify: false };

let server: { url: string; close(): Promise<void> };
let failingServer: { url: string; close(): Promise<void> };

async function exportCopy(sourceUrl: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fexport-convert-'));
  await fs.cp(path.join(FIXTURE_ROOT, 'export'), dir, { recursive: true });
  const reportFile = path.join(dir, 'export-report.json');
  const report = JSON.parse(await fs.readFile(reportFile, 'utf8'));
  report.source = sourceUrl;
  await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
  return dir;
}

async function readReport(dir: string): Promise<ConversionReport> {
  return JSON.parse(await fs.readFile(path.join(dir, '.nextjs-cache', 'report.json'), 'utf8'));
}

before(async () => {
  server = await serveFixture(path.join(FIXTURE_ROOT, 'site'));
  failingServer = await serveFixture(path.join(FIXTURE_ROOT, 'site'), ['/about']);
});

after(async () => {
  await server?.close();
  await failingServer?.close();
});

test(
  'to-nextjs converts the fixture export into a project that builds and matches the original',
  { skip: !!process.env.CI_OFFLINE, timeout: 900000 },
  async () => {
    const dir = await exportCopy(server.url + '/');
    assert.equal(await runToNextjs(dir, OPTIONS), 0);
    const next = path.join(dir, 'nextjs');
    for (const f of [
      'app/page.tsx',
      'app/about/page.tsx',
      'app/blog/page.tsx',
      'app/blog/[slug]/page.tsx',
      'content/blog/post-a.mdx',
      'content/blog/post-b.mdx',
      'CONVERSION-REPORT.md',
    ]) {
      assert.ok(existsSync(path.join(next, f)), `${f} exists`);
    }
    const report = await readReport(dir);
    assert.equal(report.build?.ok, true, report.build?.output);
    for (const route of ['/', '/about', '/blog', '/blog/post-a', '/blog/post-b']) {
      const scores = report.similarity.filter((s) => s.route === route);
      assert.equal(scores.length, 3, `${route} scored at 3 widths`);
      for (const s of scores) assert.ok(s.score >= 0.97, `${route} @${s.width}px scored ${s.score.toFixed(4)}`);
    }
    // Review Focus 3: JSX-significant characters survive into the built HTML.
    const html = await fs.readFile(path.join(next, '.next', 'server', 'app', 'index.html'), 'utf8');
    assert.ok(html.includes('Build {curly} &lt;tag&gt;'), 'braces and angle brackets rendered as text');
    assert.ok(html.includes('🚀'));
  }
);

test('a page that fails to capture gets a placeholder and the rest still converts', async () => {
  const dir = await exportCopy(failingServer.url + '/');
  await fs.writeFile(path.join(dir, 'nextjs-error-report.md'), 'from an earlier failed run');
  assert.equal(await runToNextjs(dir, NO_VERIFY), 0);
  assert.equal(existsSync(path.join(dir, 'nextjs-error-report.md')), false, 'stale error report removed');
  const placeholder = await fs.readFile(path.join(dir, 'nextjs', 'app', 'about', 'page.tsx'), 'utf8');
  assert.match(placeholder, /could not be converted/);
  assert.ok(existsSync(path.join(dir, 'nextjs', 'app', 'page.tsx')));
  const report = await readReport(dir);
  assert.deepEqual(
    report.pages.filter((p) => p.status === 'failed').map((p) => p.route),
    ['/about']
  );
});

test('a crash keeps the previous nextjs/ folder and writes an error report', async () => {
  const dir = await exportCopy(server.url + '/');
  await fs.mkdir(path.join(dir, 'nextjs'), { recursive: true });
  await fs.writeFile(path.join(dir, 'nextjs', 'marker.txt'), 'previous');
  process.env.FRAMER_NEXTJS_TEST_FAIL = 'emit';
  try {
    assert.equal(await runToNextjs(dir, NO_VERIFY), 1);
  } finally {
    delete process.env.FRAMER_NEXTJS_TEST_FAIL;
  }
  assert.equal(await fs.readFile(path.join(dir, 'nextjs', 'marker.txt'), 'utf8'), 'previous');
  assert.equal(existsSync(path.join(dir, 'nextjs.tmp')), false);
  assert.match(await fs.readFile(path.join(dir, 'nextjs-error-report.md'), 'utf8'), /FRAMER_NEXTJS_TEST_FAIL/);
});

test('if the old nextjs/ folder is locked, the new project is kept as nextjs.new', async () => {
  const dir = await exportCopy(server.url + '/');
  await fs.mkdir(path.join(dir, 'nextjs'), { recursive: true });
  await fs.writeFile(path.join(dir, 'nextjs', 'marker.txt'), 'previous');
  process.env.FRAMER_NEXTJS_TEST_FAIL = 'swap';
  try {
    assert.equal(await runToNextjs(dir, NO_VERIFY), 0);
  } finally {
    delete process.env.FRAMER_NEXTJS_TEST_FAIL;
  }
  assert.equal(await fs.readFile(path.join(dir, 'nextjs', 'marker.txt'), 'utf8'), 'previous');
  assert.ok(existsSync(path.join(dir, 'nextjs.new', 'app', 'page.tsx')), 'new project kept');
  const report = await readReport(dir);
  assert.match(report.unconverted.map((u) => u.what).join('\n'), /nextjs\.new/);
});
