import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, truncate, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { framerAdapter } from '../../src/convert/adapters/framer/index.js';
import { initState, loadState } from '../../src/convert/state.js';
import { runAnalyze } from '../../src/convert/stages/analyze.js';
import { richTextToHtml, runExtractCms } from '../../src/convert/stages/extract-cms.js';
import type { PageInfo } from '../../src/convert/types.js';

const fixture = path.resolve('tests/fixtures/framer-nudge-mini');
const tmps: string[] = [];
after(async () => {
  for (const d of tmps) await rm(d, { recursive: true, force: true });
});

async function prepare(exportDir = fixture) {
  const nextDir = await mkdtemp(path.join(os.tmpdir(), 'fexport cms '));
  tmps.push(nextDir);
  const state = initState(exportDir, nextDir);
  const ctx = { state, exportDir, nextDir, log: () => {} };
  await runAnalyze({ ...ctx, exportDir: fixture }, framerAdapter, { animations: false });
  return ctx;
}

let shared: Awaited<ReturnType<typeof prepare>> | undefined;
async function ran() {
  if (!shared) {
    shared = await prepare();
    await runExtractCms(shared);
  }
  return shared;
}

test('richTextToHtml converts Framer nodes and escapes text', () => {
  assert.equal(
    richTextToHtml([1, [4, 'h4', { dir: 'auto' }, [5, 'The Real Problem']], [4, 'p', {}, [5, 'a < b']]]),
    '<h4 dir="auto">The Real Problem</h4><p>a &lt; b</p>',
  );
});

test('fixture: caseStudy.ts has named fields and pages.json links the collection', async () => {
  const ctx = await ran();
  const src = await readFile(path.join(ctx.nextDir, 'src', 'content', 'caseStudy.ts'), 'utf8');
  assert.match(src, /export interface CaseStudy \{/);
  assert.match(src, /export const caseStudy: CaseStudy\[\] =/);
  assert.match(src, /slug: "meridian-health"/);
  assert.match(src, /title: "Meridian Health"/);
  assert.match(src, /date: "2026-03-19T00:00:00\.000Z"/);
  assert.match(src, /src: "\/images\/veyOMFLFvf4bfZJKXrpyPNzQWiw\.jpg"/);
  const pages = JSON.parse(
    await readFile(path.join(ctx.nextDir, '.convert', 'analysis', 'pages.json'), 'utf8'),
  ) as PageInfo[];
  assert.equal(pages.find((p) => p.route === '/case-study/[slug]')?.dynamic?.collection, 'caseStudy');
  assert.equal(pages.find((p) => p.route === '/blog/[slug]')?.dynamic?.collection, 'blog');
  assert.equal((await loadState(ctx.nextDir))?.stages['extract-cms'], 'done');
});

test('items without rendered pages are kept and unmatched ids are warned', async () => {
  const ctx = await ran();
  const src = await readFile(path.join(ctx.nextDir, 'src', 'content', 'caseStudy.ts'), 'utf8');
  assert.match(src, /slug: "stylebook"/);
  const blog = await readFile(path.join(ctx.nextDir, 'src', 'content', 'blog.ts'), 'utf8');
  assert.match(blog, /slug: "the-power-of-focus"/);
  assert.match(blog, /slug: "ideas-need-silence"/);
  assert.match(blog, /title: "The Power of Focus"/);
  assert.equal((blog.match(/slug: "/g) ?? []).length, 8, 'chunks merged and deduped by id');
  assert.ok(ctx.state.warnings.some((w) => /unmatched/.test(w)));
});

test('generated content files type-check with tsc --strict', async () => {
  const ctx = await ran();
  const win = process.platform === 'win32';
  for (const f of ['caseStudy.ts', 'blog.ts']) {
    const r = spawnSync(
      win ? 'npx.cmd' : 'npx',
      [
        'tsc',
        '--noEmit',
        '--strict',
        '--target',
        'es2022',
        '--module',
        'esnext',
        '--moduleResolution',
        'bundler',
        path.join(ctx.nextDir, 'src', 'content', f),
      ].map((a) => (win && a.includes(' ') ? `"${a}"` : a)),
      { encoding: 'utf8', shell: win },
    );
    assert.equal(r.status, 0, `${f}: ${r.stdout}${r.stderr}`);
  }
});

test('truncated chunks warn but never throw', async () => {
  const exportDir = await mkdtemp(path.join(os.tmpdir(), 'fexport cms export '));
  tmps.push(exportDir);
  await cp(fixture, exportDir, { recursive: true });
  const chunk = path.join(exportDir, 'data', 'hu3yniggG-chunk-default-0.framercms');
  const size = (await readFile(chunk)).length;
  await truncate(chunk, Math.floor(size * 0.75));
  const ctx = await prepare(exportDir);
  await runExtractCms(ctx);
  assert.ok(ctx.state.warnings.some((w) => /truncated/.test(w)));
  const src = await readFile(path.join(ctx.nextDir, 'src', 'content', 'caseStudy.ts'), 'utf8');
  assert.match(src, /slug: "meridian-health"/);
  // The truncated chunk lost "homestead"; the route still links and the item is scraped from its page.
  assert.match(src, /slug: "homestead"/);
  assert.ok(ctx.state.warnings.some((w) => /item "homestead" missing from decoded data/.test(w)));
  assert.equal(ctx.state.stages['extract-cms'], 'done');
});

test('re-running extract-cms is idempotent', async () => {
  const ctx = await prepare();
  await runExtractCms(ctx);
  const dir = path.join(ctx.nextDir, 'src', 'content');
  const snap = async () =>
    Object.fromEntries(await Promise.all((await readdir(dir)).sort().map(async (f) => [f, await readFile(path.join(dir, f), 'utf8')])));
  const first = await snap();
  const warnCount = ctx.state.warnings.length;
  await runExtractCms(ctx);
  assert.deepEqual(await snap(), first);
  assert.deepEqual(Object.keys(first), ['blog.ts', 'caseStudy.ts']);
  assert.equal(ctx.state.warnings.length, warnCount);
});

test('invalid date values are omitted with a warning, not thrown', async () => {
  const exportDir = await mkdtemp(path.join(os.tmpdir(), 'fexport cms bad date '));
  tmps.push(exportDir);
  await mkdir(path.join(exportDir, 'data'), { recursive: true });
  const str = (s: string) => {
    const b = Buffer.from(s);
    const l = Buffer.alloc(4);
    l.writeUInt32BE(b.length);
    return Buffer.concat([l, b]);
  };
  const date = Buffer.alloc(8);
  date.writeBigUInt64BE(BigInt(8.64e15) + 1n);
  const buf = Buffer.concat([
    Buffer.from([0, 3]),
    str('id'), Buffer.from([0x0c]), str('a1'),
    str('name'), Buffer.from([0x0c]), str('Hello'),
    str('when'), Buffer.from([0x04]), date,
  ]);
  await writeFile(path.join(exportDir, 'data', 'zzCol-chunk-default-0.framercms'), buf);
  const nextDir = await mkdtemp(path.join(os.tmpdir(), 'fexport cms '));
  tmps.push(nextDir);
  const ctx = { state: initState(exportDir, nextDir), exportDir, nextDir, log: () => {} };
  await runExtractCms(ctx);
  const src = await readFile(path.join(nextDir, 'src', 'content', 'zzCol.ts'), 'utf8');
  assert.match(src, /name: "Hello"/);
  assert.doesNotMatch(src, /when/);
  assert.ok(ctx.state.warnings.some((w) => /invalid date/.test(w)));
});
