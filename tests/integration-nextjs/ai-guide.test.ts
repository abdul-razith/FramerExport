import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serveFixture } from '../fixtures/nextjs/serve.js';
import { FIXTURE_V2 } from '../fixtures/ai-guide/build-fixture.js';
import { runAiGuide } from '../../src/ai-guide/index.js';

let server: { url: string; close(): Promise<void> };

async function exportCopy(sourceUrl: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fexport-aiguide-'));
  await fs.cp(path.join(FIXTURE_V2, 'export'), dir, { recursive: true });
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

const read = (dir: string, f: string) => fs.readFile(path.join(dir, f), 'utf8');

before(async () => {
  server = await serveFixture(path.join(FIXTURE_V2, 'site'));
});

after(async () => {
  await server?.close();
});

test('ai-guide v2 writes section references next to an unchanged export', { timeout: 900000 }, async () => {
  const dir = await exportCopy(server.url + '/');
  const before = await hashTree(dir);
  process.env.FRAMER_AIGUIDE_TEST_FAIL = 'record:/services,section:/';
  let ok = false;
  try {
    ({ ok } = await runAiGuide(dir, server.url + '/', () => {}));
  } finally {
    delete process.env.FRAMER_AIGUIDE_TEST_FAIL;
  }
  assert.equal(ok, true, existsSync(path.join(dir, 'ai-guide/ERROR.md')) ? await read(dir, 'ai-guide/ERROR.md') : '');
  assert.equal(await hashTree(dir, ['AGENTS.md', 'CLAUDE.md', 'ai-guide', '.nextjs-cache']), before);
  assert.equal(existsSync(path.join(dir, 'nextjs-app')), false);

  const sectionsDir = path.join(dir, 'ai-guide/pages/index/sections');
  const folders = (await fs.readdir(sectionsDir)).sort();
  const hero = folders.find((f) => /^\d\d-hero$/.test(f));
  assert.ok(hero, folders.join(', '));
  for (const f of ['ref.md', 'markup.desktop.html', 'markup.tablet-mobile.html', 'styles.css', 'shot-1440-1.png']) {
    assert.ok(existsSync(path.join(sectionsDir, hero!, f)), `${hero}/${f}`);
  }
  assert.ok(folders.some((f) => /works-panel-1$/.test(f)), folders.join(', '));
  assert.ok(!folders.some((f) => /ghost|loader|header|desktop/.test(f)), folders.join(', '));

  const shell = (await fs.readdir(path.join(dir, 'ai-guide/shell'))).sort();
  assert.ok(shell.some((f) => /^S\d-header$/.test(f)), shell.join(', '));
  assert.ok(shell.some((f) => /^S\d-loader$/.test(f)), shell.join(', '));

  const ref = await read(sectionsDir, `${hero}/ref.md`);
  assert.ok(ref.includes('opacity 0→1'), ref);
  assert.ok(ref.includes('"Small title" (tablet, mobile)'), ref);
  assert.ok(ref.includes('generated (clock)'), ref);
  assert.ok(ref.includes('ruler 0–1400'), ref);
  assert.doesNotMatch(ref.split('## Content')[1].split('## Animations')[0], /"100"/);
  assert.match(await read(sectionsDir, `${hero}/styles.css`), /font-size:\s*72px/);

  const faq = folders.find((f) => /faq$/.test(f))!;
  assert.match(await read(sectionsDir, `${faq}/ref.md`), /question \(click\)/);

  const json = JSON.parse(await read(dir, 'ai-guide/sections.json'));
  assert.ok(json['/'].sections.some((s: { id: string }) => s.id.startsWith('S')));
  assert.ok(json['/'].sections.find((s: { name: string }) => s.name === 'Hero').live['1440'].length >= 1);

  const plan = await read(dir, 'ai-guide/plan.md');
  assert.ok(plan.includes('npx create-next-app@latest'));
  assert.ok(plan.includes('npm run compare -- / --section 01'));
  assert.ok(existsSync(path.join(dir, 'ai-guide/text-styles.css')));
  assert.ok(existsSync(path.join(dir, 'ai-guide/scripts/compare.mjs')));
  for (const f of ['AGENTS.md', 'CLAUDE.md', 'ai-guide/README.md', 'ai-guide/site.md', 'ai-guide/tokens.md', 'ai-guide/pages/index/motion.md', 'ai-guide/pages/index/desktop.png']) {
    assert.ok(existsSync(path.join(dir, f)), f);
  }
  // One section failing does not fail the guide; its ref.md says so.
  const shellRefs = await Promise.all(shell.map((f) => read(dir, `ai-guide/shell/${f}/ref.md`)));
  assert.equal(shellRefs.filter((r) => r.includes('could not be written')).length, 1, shellRefs.join('\n---\n'));
  // Shell ids are unique per page in sections.json.
  for (const route of Object.keys(json)) {
    const sIds = json[route].sections.map((x: { id: string }) => x.id).filter((id: string) => id.startsWith('S'));
    assert.equal(new Set(sIds).size, sIds.length, `${route}: ${sIds.join(',')}`);
  }
  // One page's recording failing does not fail the guide; that page says so.
  assert.match(await read(dir, 'ai-guide/pages/services/motion.md'), /recording failed/);
});

test('one page failing writes a note in its folder and the rest of the guide', { timeout: 900000 }, async () => {
  const dir = await exportCopy(server.url + '/');
  process.env.FRAMER_AIGUIDE_TEST_FAIL = 'page:/services';
  let ok = false;
  try {
    ({ ok } = await runAiGuide(dir, server.url + '/', () => {}));
  } finally {
    delete process.env.FRAMER_AIGUIDE_TEST_FAIL;
  }
  assert.equal(ok, true);
  assert.match(await read(dir, 'ai-guide/pages/services/ERROR.md'), /Simulated page failure/);
  assert.ok(existsSync(path.join(dir, 'ai-guide/pages/index/motion.md')));
  assert.ok(existsSync(path.join(dir, 'ai-guide/plan.md')));
});

test('a failure writes ai-guide/ERROR.md and leaves the export and the previous guide', async () => {
  const dir = await exportCopy(server.url + '/');
  await fs.mkdir(path.join(dir, 'ai-guide/pages/index'), { recursive: true });
  await fs.writeFile(path.join(dir, 'ai-guide/site.md'), 'previous guide');
  process.env.FRAMER_AIGUIDE_TEST_FAIL = '1';
  try {
    assert.equal((await runAiGuide(dir, server.url + '/', () => {})).ok, false);
  } finally {
    delete process.env.FRAMER_AIGUIDE_TEST_FAIL;
  }
  assert.match(await read(dir, 'ai-guide/ERROR.md'), /FRAMER_AIGUIDE_TEST_FAIL/);
  assert.ok(existsSync(path.join(dir, 'index.html')));
  assert.equal(await read(dir, 'ai-guide/site.md'), 'previous guide');
});
