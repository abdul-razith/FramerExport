import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import puppeteer, { type Browser } from 'puppeteer';
import type { StageContext } from '../../src/convert/adapters/types.js';
import { initState, saveState } from '../../src/convert/state.js';
import type { TaskRecord } from '../../src/convert/types.js';
import { runBaseline } from '../../src/convert/verify/baseline.js';
import { formatCheck, runCheck } from '../../src/convert/verify/check.js';

const tmps: string[] = [];
let browser: Browser | undefined;
let server: http.Server;
let serverUrl: string;
let heroBg = '#ff0000';

async function tmp(prefix = 'convert check int '): Promise<string> {
  const d = await mkdtemp(path.join(os.tmpdir(), prefix));
  tmps.push(d);
  return d;
}

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (url.pathname === '/error500') {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('Internal Server Error');
      return;
    }

    // Default route "/"
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html>
<html>
  <head>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      .hero { height: 300px; width: 100%; background: ${heroBg}; }
      @media (max-width: 1000px) { .hero { height: 250px; } }
      @media (max-width: 390px) { .hero { height: 200px; } }
    </style>
  </head>
  <body>
    <div data-section="hero" class="hero">
      <h1>Hero Headline</h1>
      <a href="/explore">Explore</a>
    </div>
  </body>
</html>`);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      serverUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

after(async () => {
  await browser?.close().catch(() => {});
  await new Promise<void>((resolve) => server.close(() => resolve())).catch(() => {});
  for (const d of tmps) {
    await rm(d, { recursive: true, force: true }).catch(() => {});
  }
});

test('identical page -> PASS at all widths', async () => {
  heroBg = '#ff0000';
  const root = await tmp('convert check identical ');
  const state = initState(path.join(root, 'export'), root);
  const task: TaskRecord = {
    id: 'sec-hero',
    kind: 'section',
    section: 'hero',
    route: '/',
    file: 'src/components/Hero.tsx',
    targets: ['src/components/Hero.tsx'],
    status: 'pending',
    attempts: 0
  };
  state.tasks['sec-hero'] = task;
  await saveState(state);

  // Write dummy source file for code check
  const heroFile = path.join(root, 'src', 'components', 'Hero.tsx');
  await mkdir(path.dirname(heroFile), { recursive: true });
  await writeFile(
    heroFile,
    `export function Hero() { return <div className="bg-red-500">Hero Headline<a href="/explore">Explore</a></div>; }`
  );

  // Capture baseline using Task 12's runBaseline
  const ctx: StageContext = {
    exportDir: state.exportDir,
    nextDir: root,
    state,
    log: () => {},
    warn: () => {}
  };
  await runBaseline(ctx, serverUrl);

  // Run check against the identical page
  const res = await runCheck(root, 'sec-hero', { devUrl: serverUrl, countCall: false });

  assert.equal(res.pass, true);
  assert.equal(res.taskId, 'sec-hero');
  assert.equal(res.mode, 'full');
  assert.equal(res.limitReached, false);
  assert.equal(res.widths.length, 3);
  for (const w of res.widths) {
    assert.equal(w.pass, true, `Width ${w.width} should pass`);
    assert.equal(w.clusters.length, 0);
  }
  assert.equal(res.dom.length, 0);
  assert.equal(res.code.length, 0);

  const lines = formatCheck(res).split('\n');
  assert(lines[0].startsWith('PASS sec-hero'));
});

test('page with a changed background -> FAIL with clusters and three image paths', async () => {
  heroBg = '#ff0000';
  const root = await tmp('convert check changed ');
  const state = initState(path.join(root, 'export'), root);
  const task: TaskRecord = {
    id: 'sec-hero',
    kind: 'section',
    section: 'hero',
    route: '/',
    file: 'src/components/Hero.tsx',
    targets: ['src/components/Hero.tsx'],
    status: 'pending',
    attempts: 0
  };
  state.tasks['sec-hero'] = task;
  await saveState(state);

  // Write source file
  const heroFile = path.join(root, 'src', 'components', 'Hero.tsx');
  await mkdir(path.dirname(heroFile), { recursive: true });
  await writeFile(
    heroFile,
    `export function Hero() { return <div className="bg-blue-500">Hero Headline<a href="/explore">Explore</a></div>; }`
  );

  // Capture baseline on "/" (which has red background)
  const ctx: StageContext = {
    exportDir: state.exportDir,
    nextDir: root,
    state,
    log: () => {},
    warn: () => {}
  };
  await runBaseline(ctx, serverUrl);

  // Now change server background to blue
  heroBg = '#0000ff';

  // Run check against the changed page
  const res = await runCheck(root, 'sec-hero', { devUrl: serverUrl, countCall: false });

  assert.equal(res.pass, false);
  assert.equal(res.taskId, 'sec-hero');
  assert.equal(res.mode, 'full');
  assert.equal(res.widths.length, 3);

  // Every width should fail due to color change
  for (const w of res.widths) {
    assert.equal(w.pass, false, `Width ${w.width} should fail`);
    assert(w.clusters.length > 0, `Width ${w.width} should have clusters`);
    assert(w.images !== undefined, `Width ${w.width} should have image paths`);
    assert(existsSync(w.images.expected), `Expected image must exist at ${w.images.expected}`);
    assert(existsSync(w.images.actual), `Actual image must exist at ${w.images.actual}`);
    assert(existsSync(w.images.diff), `Diff image must exist at ${w.images.diff}`);
  }

  const lines = formatCheck(res).split('\n');
  assert(lines[0].startsWith('FAIL sec-hero'));
});

test('smoke on a 500 page -> FAIL', async () => {
  const root = await tmp('convert check smoke ');
  const state = initState(path.join(root, 'export'), root);
  const task: TaskRecord = {
    id: 'sec-error',
    kind: 'section',
    section: 'hero',
    route: '/error500',
    file: 'src/components/Error.tsx',
    targets: ['src/components/Error.tsx'],
    status: 'pending',
    attempts: 0
  };
  state.tasks['sec-error'] = task;
  await saveState(state);

  const res = await runCheck(root, 'sec-error', { smoke: true, devUrl: serverUrl, countCall: false });

  assert.equal(res.pass, false);
  assert.equal(res.mode, 'smoke');
  assert(res.errors.some((e) => e.includes('500')), 'Errors should mention 500');

  const lines = formatCheck(res).split('\n');
  assert(lines[0].startsWith('FAIL sec-error'));
});
