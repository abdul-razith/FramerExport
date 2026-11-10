import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serveFixture, FIXTURE_ROOT } from '../fixtures/nextjs/serve.js';
import { runAiGuide } from '../../src/ai-guide/index.js';

let server: { url: string; close(): Promise<void> };

async function exportCopy(sourceUrl: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fexport-aiguide-'));
  await fs.cp(path.join(FIXTURE_ROOT, 'export'), dir, { recursive: true });
  const reportFile = path.join(dir, 'export-report.json');
  const report = JSON.parse(await fs.readFile(reportFile, 'utf8'));
  report.source = sourceUrl;
  await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
  return dir;
}

/** Hash of every file under dir (relative path + content), except the excluded top-level names. */
async function hashTree(dir: string, exclude: string[] = []): Promise<string> {
  const files = (await fs.readdir(dir, { recursive: true, withFileTypes: true }))
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)).replace(/\\/g, '/'))
    .filter((f) => !exclude.includes(f.split('/')[0]))
    .sort();
  const h = createHash('sha256');
  for (const f of files) h.update(f).update(await fs.readFile(path.join(dir, f)));
  return h.digest('hex');
}

before(async () => {
  server = await serveFixture(path.join(FIXTURE_ROOT, 'site'));
});

after(async () => {
  await server?.close();
});

test('ai-guide writes the guide next to an unchanged export', { timeout: 600000 }, async () => {
  const dir = await exportCopy(server.url + '/');
  const before = await hashTree(dir);
  process.env.FRAMER_AIGUIDE_TEST_FAIL = 'record:/about';
  let ok = false;
  try {
    ({ ok } = await runAiGuide(dir, server.url + '/', () => {}));
  } finally {
    delete process.env.FRAMER_AIGUIDE_TEST_FAIL;
  }
  assert.equal(ok, true, existsSync(path.join(dir, 'ai-guide/ERROR.md')) ? await fs.readFile(path.join(dir, 'ai-guide/ERROR.md'), 'utf8') : '');
  for (const f of [
    'AGENTS.md', 'CLAUDE.md', 'ai-guide/README.md', 'ai-guide/site.md', 'ai-guide/files.md', 'ai-guide/content.md',
    'ai-guide/tokens.md', 'ai-guide/checklist.md', 'ai-guide/plan.md', 'ai-guide/scripts/compare.mjs',
    'ai-guide/pages/index/outline.md', 'ai-guide/pages/index/motion.md', 'ai-guide/pages/index/desktop.png',
    'ai-guide/pages/index/sections/02-hero-section-desktop.png', 'ai-guide/pages/index/frames/scroll/000.png',
  ]) {
    assert.ok(existsSync(path.join(dir, f)), f);
  }
  assert.equal(await hashTree(dir, ['AGENTS.md', 'CLAUDE.md', 'ai-guide', '.nextjs-cache']), before);
  assert.equal(existsSync(path.join(dir, 'nextjs-app')), false);
  // Frames are only saved when the page repaints, so a mostly static page has few of them.
  assert.ok((await fs.readdir(path.join(dir, 'ai-guide/pages/index/frames/load'))).length >= 1, 'load frames recorded');
  const outline = await fs.readFile(path.join(dir, 'ai-guide/pages/index/outline.md'), 'utf8');
  assert.match(outline, /links: "Home" → \/ · "About" → \/about · "Blog" → \/blog/);
  const plan = await fs.readFile(path.join(dir, 'ai-guide/plan.md'), 'utf8');
  assert.match(plan, /### Task 2: Home page \(\/\)/);
  assert.match(plan, /### Task \d+: Blog collection \(\/blog\)/);
  // One page's recording failing does not fail the guide; that page says so.
  assert.match(await fs.readFile(path.join(dir, 'ai-guide/pages/about/motion.md'), 'utf8'), /recording failed/);
  const motion = await fs.readFile(path.join(dir, 'ai-guide/pages/index/motion.md'), 'utf8');
  assert.match(motion, /^## Custom behaviour$/m, motion);
  assert.match(motion, /text changes/, motion);
});

test('a failure writes ai-guide/ERROR.md and leaves the export usable', async () => {
  const dir = await exportCopy(server.url + '/');
  // A guide from an earlier run survives a failed re-run.
  await fs.mkdir(path.join(dir, 'ai-guide/pages/index'), { recursive: true });
  await fs.writeFile(path.join(dir, 'ai-guide/site.md'), 'previous guide');
  await fs.writeFile(path.join(dir, 'ai-guide/pages/index/outline.md'), 'previous outline');
  process.env.FRAMER_AIGUIDE_TEST_FAIL = '1';
  try {
    assert.equal((await runAiGuide(dir, server.url + '/', () => {})).ok, false);
  } finally {
    delete process.env.FRAMER_AIGUIDE_TEST_FAIL;
  }
  assert.match(await fs.readFile(path.join(dir, 'ai-guide/ERROR.md'), 'utf8'), /FRAMER_AIGUIDE_TEST_FAIL/);
  assert.ok(existsSync(path.join(dir, 'index.html')));
  assert.equal(await fs.readFile(path.join(dir, 'ai-guide/site.md'), 'utf8'), 'previous guide');
  assert.equal(await fs.readFile(path.join(dir, 'ai-guide/pages/index/outline.md'), 'utf8'), 'previous outline');
});
