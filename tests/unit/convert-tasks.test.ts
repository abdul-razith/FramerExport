import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { countMatches } from '../../src/convert/adapters/framer/components.js';
import { framerAdapter } from '../../src/convert/adapters/framer/index.js';
import { initState, loadState } from '../../src/convert/state.js';
import { runAnalyze } from '../../src/convert/stages/analyze.js';
import { runExtractCms } from '../../src/convert/stages/extract-cms.js';
import { runScaffold } from '../../src/convert/stages/scaffold/index.js';
import { renderTemplate, runTasks } from '../../src/convert/stages/tasks.js';
import type { AnimationEntry, ComponentInfo } from '../../src/convert/types.js';

const fixture = path.resolve('tests/fixtures/framer-nudge-mini');
const tmps: string[] = [];
after(async () => {
  for (const d of tmps) await rm(d, { recursive: true, force: true });
});

async function prepare(base = os.tmpdir()) {
  const nextDir = await mkdtemp(path.join(base, 'fexport tasks '));
  tmps.push(nextDir);
  const ctx = { state: initState(fixture, nextDir), exportDir: fixture, nextDir, log: () => {} };
  await runAnalyze(ctx, framerAdapter, { animations: false });
  await runExtractCms(ctx);
  await runScaffold(ctx);
  return ctx;
}

const motion: AnimationEntry = {
  route: '/about',
  selector: '.framer-abc',
  framerName: 'Hero Title',
  trigger: 'appear',
  from: { opacity: '0', y: '40px' },
  to: { opacity: '1', y: '0px' },
  durationMs: 600,
  confidence: 'high',
};

let shared: Awaited<ReturnType<typeof prepare>> & { records?: Awaited<ReturnType<typeof runTasks>> };
async function ran() {
  if (!shared) {
    shared = await prepare();
    await writeFile(path.join(shared.nextDir, '.convert/analysis/animations.json'), JSON.stringify([motion]));
    shared.records = await runTasks(shared);
  }
  return shared as typeof shared & { records: Awaited<ReturnType<typeof runTasks>> };
}
const read = (ctx: { nextDir: string }, rel: string) => readFile(path.join(ctx.nextDir, rel), 'utf8');
const HEADINGS = ['## Goal', '## Edit only', '## Inputs', '## Requirements', '## Rules', '## Done when'];

test('renderTemplate substitutes and throws on unreplaced', () => {
  assert.throws(() => renderTemplate('fix', {}), /unreplaced/);
  const out = renderTemplate('fix', {
    taskId: 'fix-001', attempt: '2', targets: '- `a.tsx`', failures: 'boom', doneWhen: 'run it', rules: 'R',
  });
  assert.match(out, /fix-001/);
  assert.doesNotMatch(out, /\{\{/);
});

test('task ids unique and sorted, kinds numbered', async () => {
  const { records } = await ran();
  const ids = records.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, [...ids].sort());
  assert.match(ids[0]!, /^001-component-/);
  assert.ok(ids.some((i) => i === '101-page-home'));
  assert.ok(ids.includes('102-page-about'));
  assert.ok(ids.includes('201-motion-about'));
  const pages = records.filter((r) => r.kind === 'page');
  assert.equal(pages[0]!.route, '/');
  assert.deepEqual(pages[0]!.targets, ['src/app/page.tsx']);
  assert.ok(pages.some((p) => p.targets[0] === 'src/app/blog/[slug]/page.tsx'));
});

test('atoms first: components with fewer descendant components come first', async () => {
  const ctx = await ran();
  const comps = JSON.parse(await read(ctx, '.convert/analysis/components.json')) as ComponentInfo[];
  const order = ctx.records.filter((r) => r.kind === 'component').map((r) => r.id.replace(/^\d+-component-/, ''));
  assert.equal(order.length, comps.length);
  assert.deepEqual(new Set(order), new Set(comps.map((c) => c.name)));
  const weight = new Map<string, number>();
  for (const c of comps) {
    const html = await read(ctx, c.slice);
    weight.set(c.name, comps.filter((o) => o.name !== c.name && countMatches(html, o.selector) > 0).length);
  }
  const ws = order.map((n) => weight.get(n)!);
  assert.deepEqual(ws, [...ws].sort((a, b) => a - b));
  for (let i = 1; i < order.length; i++) if (ws[i] === ws[i - 1]) assert.ok(order[i - 1]! < order[i]!);
});

test('every task file has six headings in order and exact Done when', async () => {
  const ctx = await ran();
  for (const r of ctx.records) {
    assert.equal(r.file, `.convert/tasks/${r.id}.md`);
    const text = await read(ctx, r.file);
    let at = -1;
    for (const h of HEADINGS) {
      const i = text.indexOf(`\n${h}\n`);
      assert.ok(i > at, `${r.id}: ${h}`);
      at = i;
    }
    assert.doesNotMatch(text, /\{\{/);
    const done = text.slice(text.indexOf('## Done when'));
    if (r.kind === 'motion') {
      assert.match(done, /Tick every item in the checklist above, then run `npx fexport convert verify \/about`\./);
    } else {
      assert.match(done, new RegExp(`Run \`npx fexport convert verify ${r.id}\` and confirm it passes\.`));
      assert.match(text, /\.convert\/analysis\/slices\/_base\.css/);
    }
  }
});

test('component and page task content', async () => {
  const ctx = await ran();
  const dark = await read(ctx, '.convert/tasks/' + ctx.records.find((r) => r.id.endsWith('-DarkButton'))!.id + '.md');
  assert.match(dark, /src\/components\/DarkButton\.tsx/);
  assert.match(dark, /\.convert\/analysis\/slices\/DarkButton\.html/);
  for (const w of [1440, 1000, 390]) assert.match(dark, new RegExp(`\.convert/reference/components/DarkButton/${w}\.png`));
  assert.match(dark, /Tablet/);
  const home = await read(ctx, '.convert/tasks/101-page-home.md');
  assert.ok(home.includes('`Hero + About`: `data-section="Hero + About"`'));
  assert.match(home, /\.convert\/reference\/home\/1440\.png/);
  const blog = ctx.records.find((r) => r.route === '/blog/[slug]' && r.kind === 'page')!;
  const blogText = await read(ctx, blog.file);
  assert.match(blogText, /\.convert\/reference\/blog-slug\/390\.png/);
  assert.match(blogText, /src\/content\/blog\.ts/);
  const mo = await read(ctx, '.convert/tasks/201-motion-about.md');
  assert.match(mo, /- \[ \] .*Hero Title/);
});

test('AGENTS.md equals CLAUDE.md, shares rules, stage needs-ai, state registered', async () => {
  const ctx = await ran();
  const a = await read(ctx, 'AGENTS.md');
  assert.equal(a, await read(ctx, 'CLAUDE.md'));
  assert.match(a, /convert status/);
  assert.match(a, /convert next/);
  assert.match(a, /convert verify/);
  const rules = (await read(ctx, '.convert/tasks/101-page-home.md')).split('## Rules\n')[1]!.split('\n## ')[0]!;
  assert.ok(a.includes(rules.trim()));
  const state = await loadState(ctx.nextDir);
  assert.equal(state!.stages.tasks, 'needs-ai');
  assert.ok(state!.tasks['101-page-home']);
});

test('re-run keeps status/attempts and fix files', async () => {
  const ctx = await ran();
  ctx.state.tasks['101-page-home']!.status = 'in-progress';
  ctx.state.tasks['101-page-home']!.attempts = 2;
  await mkdir(path.join(ctx.nextDir, '.convert/tasks'), { recursive: true });
  await writeFile(path.join(ctx.nextDir, '.convert/tasks/fix-001.md'), 'keep me');
  await runTasks(ctx);
  assert.equal(ctx.state.tasks['101-page-home']!.status, 'in-progress');
  assert.equal(ctx.state.tasks['101-page-home']!.attempts, 2);
  assert.equal(await read(ctx, '.convert/tasks/fix-001.md'), 'keep me');
  assert.ok((await readdir(path.join(ctx.nextDir, '.convert/tasks'))).includes('fix-001.md'));
});

// Same drive as the fixture (os.tmpdir() may be on another Windows drive, where no relative path exists).
test('task files are portable: no absolute export path, relative source resolves', async () => {
  const ctx = await prepare(path.resolve('tests'));
  await runTasks(ctx);
  const abs = ctx.exportDir;
  for (const f of [...(await readdir(path.join(ctx.nextDir, '.convert/tasks'))).map((n) => '.convert/tasks/' + n), 'AGENTS.md']) {
    const text = await read(ctx, f);
    assert.ok(!text.includes(abs) && !text.includes(abs.split(path.sep).join('/')), f);
  }
  const text = await read(ctx, '.convert/tasks/101-page-home.md');
  const rel = /Original page HTML \(read-only reference\): `([^`]+)`/.exec(text)![1]!;
  await access(path.resolve(ctx.nextDir, rel));
  assert.match(await read(ctx, 'AGENTS.md'), /Original export: `[^`]+`/);
});

test('missing slice and source are reported as warnings, not swallowed', async () => {
  const ctx = await prepare();
  await rm(path.join(ctx.nextDir, '.convert/analysis/slices/Arrow.html'));
  const pages = JSON.parse(await read(ctx, '.convert/analysis/pages.json')) as Array<{ sourceFile: string }>;
  pages[1]!.sourceFile = 'subpages/gone.html';
  await writeFile(path.join(ctx.nextDir, '.convert/analysis/pages.json'), JSON.stringify(pages));
  const logs: string[] = [];
  ctx.log = (m: string) => logs.push(m);
  await runTasks(ctx);
  assert.ok(ctx.state.warnings.includes('tasks: missing .convert/analysis/slices/Arrow.html'));
  assert.ok(ctx.state.warnings.includes('tasks: missing subpages/gone.html'));
  assert.equal(logs.length, 2);
  await runTasks(ctx);
  assert.equal(ctx.state.warnings.filter((w) => w.startsWith('tasks:')).length, 2);
});
