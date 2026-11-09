import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { serveFixture, FIXTURE_ROOT } from '../fixtures/nextjs/serve.js';
import { capturePages, listExportPages, type CapturedPage } from '../../src/nextjs/capture.js';
import { emptyReport } from '../../src/nextjs/report.js';
import type { ConversionContext, RawNode } from '../../src/nextjs/model.js';

let server: { url: string; close(): Promise<void> };
let cacheDir: string;
let captured: CapturedPage[];
let failed: { route: string; error: string }[];

function find(node: RawNode, pred: (n: RawNode) => boolean): RawNode | undefined {
  if (pred(node)) return node;
  for (const child of node.children) {
    const hit = find(child, pred);
    if (hit) return hit;
  }
  return undefined;
}

before(async () => {
  server = await serveFixture(path.join(FIXTURE_ROOT, 'site'), ['/about']);
  cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fexport-capture-'));
  const ctx: ConversionContext = {
    exportDir: path.join(FIXTURE_ROOT, 'export'),
    sourceUrl: server.url + '/',
    outDir: path.join(cacheDir, 'out'),
    cacheDir,
    options: { aiRefine: false, verify: false, cliSkipPermissions: true },
    report: emptyReport(),
    log: () => {},
  };
  const pages = listExportPages(ctx.exportDir, ctx.sourceUrl).filter((p) =>
    ['/', '/about'].includes(p.route)
  );
  ({ captured, failed } = await capturePages(pages, ctx));
});

after(async () => {
  await server?.close();
});

test('listExportPages maps export files to routes via canonical links', () => {
  const pages = listExportPages(path.join(FIXTURE_ROOT, 'export'), 'https://nudge.example/');
  assert.deepEqual(
    pages.map((p) => [p.route, p.url]),
    [
      ['/', 'https://nudge.example/'],
      ['/about', 'https://nudge.example/about'],
      ['/blog', 'https://nudge.example/blog'],
      ['/blog/post-a', 'https://nudge.example/blog/post-a'],
      ['/blog/post-b', 'https://nudge.example/blog/post-b'],
    ]
  );
  assert.match(pages[0].exportHtml, /opacity:0;transform:translateY\(40px\)/);
});

test('capturePages returns three trees with breakpoint-specific computed styles', () => {
  const home = captured.find((p) => p.route === '/')!;
  const h1 = (bp: 'base' | 'tablet' | 'mobile') =>
    find(home.trees[bp], (n) => n.tag === 'h1')!;
  assert.equal(h1('base').styles['font-size'], '72px');
  assert.equal(h1('tablet').styles['font-size'], '72px');
  assert.equal(h1('mobile').styles['font-size'], '48px');
  assert.equal(h1('base').text, 'Build {curly} <tag> "quotes" & emoji 🚀');
  assert.equal(home.title, 'Nudge Fixture');
  assert.equal(home.meta.description, 'Fixture home page');
});

test('nodes inside hidden-abc are invisible at mobile and visible at base', () => {
  const home = captured.find((p) => p.route === '/')!;
  const nav = (bp: 'base' | 'mobile') => find(home.trees[bp], (n) => n.framerName === 'Nav');
  const wrapper = (bp: 'base' | 'mobile') =>
    find(home.trees[bp], (n) => (n.attrs.class ?? '').includes('hidden-abc'))!;
  assert.equal(wrapper('base').visible, true);
  assert.ok(nav('base'));
  assert.equal(wrapper('mobile').visible, false);
  assert.equal(wrapper('mobile').children.length, 0);
});

test('keys are stable across widths for the same element', () => {
  const home = captured.find((p) => p.route === '/')!;
  const key = (bp: 'base' | 'tablet' | 'mobile') =>
    find(home.trees[bp], (n) => n.framerName === 'Intro')!.key;
  assert.equal(key('base'), key('tablet'));
  assert.equal(key('base'), key('mobile'));
  assert.match(key('base'), /p\[Intro\]:\d+$/);
});

test('hover rules are attached by key', () => {
  const home = captured.find((p) => p.route === '/')!;
  const cards = [] as RawNode[];
  const walk = (n: RawNode) => {
    if (n.framerName === 'Card') cards.push(n);
    n.children.forEach(walk);
  };
  walk(home.trees.base);
  assert.equal(cards.length, 3);
  const hover = home.hover.find((h) => h.key === cards[0].key);
  assert.ok(hover, 'card hover rule recorded');
  assert.equal(hover!.style['background-color'], '#ffffff1a', 'var() resolved to the token value');
});

test('screenshots exist for all three breakpoints', async () => {
  const home = captured.find((p) => p.route === '/')!;
  for (const bp of ['base', 'tablet', 'mobile'] as const) {
    const stat = await fs.stat(home.screenshots[bp]);
    assert.ok(stat.size > 0);
  }
});

test('a page returning an HTTP error is reported and does not stop other pages', () => {
  assert.deepEqual(
    failed.map((f) => f.route),
    ['/about']
  );
  assert.match(failed[0].error, /500/);
  assert.deepEqual(
    captured.map((p) => p.route),
    ['/']
  );
});

test('inherited values are kept where the browser default overrides inheritance', () => {
  const home = captured.find((p) => p.route === '/')!;
  const navLink = find(home.trees.base, (n) => n.tag === 'a' && n.text === 'Home')!;
  assert.equal(navLink.styles.color, 'rgb(255, 255, 255)', 'link colour kept despite equal parent colour');
  assert.equal(navLink.styles['text-decoration-line'], 'none');
  const h1 = find(home.trees.base, (n) => n.tag === 'h1')!;
  assert.equal(h1.styles['font-weight'], '400', 'h1 weight kept although the parent is also 400');
});

test('flex items do not report the blockified display value', () => {
  const home = captured.find((p) => p.route === '/')!;
  const logo = find(home.trees.base, (n) => n.framerName === 'Logo')!;
  assert.equal(logo.styles.display, undefined);
});

test('zero insets on relatively positioned elements are not recorded', () => {
  const home = captured.find((p) => p.route === '/')!;
  const withZeroInset: string[] = [];
  const walk = (n: RawNode) => {
    if (n.styles.position === 'relative' && ['top', 'right', 'bottom', 'left'].some((k) => n.styles[k] === '0px')) withZeroInset.push(n.key);
    n.children.forEach(walk);
  };
  walk(home.trees.base);
  assert.deepEqual(withZeroInset, []);
});
