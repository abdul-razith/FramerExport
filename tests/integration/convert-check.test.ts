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
import { stopDevServer } from '../../src/convert/verify/dev-server.js';
import { isPidAlive, stopAllManaged } from '../../src/convert/verify/proc.js';

const PAGE_CSS = `* { margin: 0; padding: 0; box-sizing: border-box; }
.hero { height: 300px; width: 100%; background: #ff0000; }
.footer { height: 120px; width: 100%; background: #00aa00; }`;

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

    if (url.pathname === '/multi') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<!doctype html><html><head><style>${PAGE_CSS}</style></head><body>
<div data-section="hero" class="hero"><h1>Hero</h1></div>
<div data-section="footer" class="footer"><p>Footer</p></div></body></html>`);
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

function stateWith(root: string, tasks: TaskRecord[]) {
  const state = initState(path.join(root, 'export'), root);
  for (const t of tasks) state.tasks[t.id] = t;
  return state;
}

function ctxFor(root: string, state: ReturnType<typeof initState>): StageContext {
  return { exportDir: state.exportDir, nextDir: root, state, log: () => {}, warn: () => {} };
}

const sectionTask = (id: string, route: string, section: string): TaskRecord => ({
  id,
  kind: 'section',
  route,
  section,
  file: '',
  targets: [],
  status: 'done',
  attempts: 0
});

test('I3: the fix task of a shell task resolves the shell baseline', async () => {
  heroBg = '#ff0000';
  const root = await tmp('convert check shellfix ');
  const state = stateWith(root, [
    { id: 'shell-hero', kind: 'shell', section: 'hero', file: '', targets: [], status: 'done', attempts: 0 },
    {
      id: 'fix-shell-hero',
      kind: 'fix',
      fixOf: 'shell-hero',
      route: '/',
      section: 'hero',
      file: '',
      targets: [],
      status: 'pending',
      attempts: 0
    }
  ]);
  await saveState(state);
  await runBaseline(ctxFor(root, state), serverUrl);

  const res = await runCheck(root, 'fix-shell-hero', { devUrl: serverUrl, countCall: false });
  assert.deepEqual(res.errors, []);
  assert.equal(res.pass, true);
  assert.equal(res.taskId, 'fix-shell-hero');
});

test('I3: the fix task of a page task checks the page sections', async () => {
  const root = await tmp('convert check pagefix ');
  const state = stateWith(root, [
    sectionTask('sec-multi-hero', '/multi', 'hero'),
    sectionTask('sec-multi-footer', '/multi', 'footer'),
    {
      id: 'page-multi',
      kind: 'page',
      route: '/multi',
      sections: ['hero', 'footer'],
      file: '',
      targets: [],
      status: 'done',
      attempts: 0
    },
    {
      id: 'fix-page-multi',
      kind: 'fix',
      fixOf: 'page-multi',
      route: '/multi',
      file: '',
      targets: [],
      status: 'pending',
      attempts: 0
    }
  ]);
  await saveState(state);
  await runBaseline(ctxFor(root, state), serverUrl);

  const res = await runCheck(root, 'fix-page-multi', { devUrl: serverUrl, countCall: false });
  assert.deepEqual(res.errors, []);
  assert.equal(res.pass, true);
});

test('I2: smoke on a page task passes when every section has a box; a missing section fails', async () => {
  const root = await tmp('convert check pagesmoke ');
  const pageTask = (sections: string[]): TaskRecord => ({
    id: 'page-multi',
    kind: 'page',
    route: '/multi',
    sections,
    file: '',
    targets: [],
    status: 'pending',
    attempts: 0
  });
  await saveState(stateWith(root, [pageTask(['hero', 'footer'])]));
  const ok = await runCheck(root, 'page-multi', { smoke: true, devUrl: serverUrl, countCall: false });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.pass, true);

  await saveState(stateWith(root, [pageTask(['hero', 'ghost'])]));
  const bad = await runCheck(root, 'page-multi', { smoke: true, devUrl: serverUrl, countCall: false });
  assert.equal(bad.pass, false);
  assert(bad.errors.some((e) => e.includes('ghost')));
});

test('I8: a page task skips a root section that has parts and no baseline of its own', async () => {
  const root = await tmp('convert check parts ');
  const state = stateWith(root, [
    sectionTask('sec-multi-hero-part', '/multi', 'hero/part'),
    sectionTask('sec-multi-footer', '/multi', 'footer'),
    {
      id: 'page-multi',
      kind: 'page',
      route: '/multi',
      sections: ['hero', 'footer'],
      file: '',
      targets: [],
      status: 'done',
      attempts: 0
    }
  ]);
  await saveState(state);
  await runBaseline(ctxFor(root, state), serverUrl);

  const res = await runCheck(root, 'page-multi', { devUrl: serverUrl, countCall: false });
  assert.deepEqual(res.errors, []);
  assert.equal(res.pass, true);
});

test('C1: a stale devUrl follows .convert/dev-server.json to the restarted server', async () => {
  const root = await tmp('convert check stale ');
  await saveState(stateWith(root, [sectionTask('sec-hero', '/', 'hero')]));
  await mkdir(path.join(root, '.convert'), { recursive: true });
  await writeFile(
    path.join(root, '.convert', 'dev-server.json'),
    JSON.stringify({ pid: process.pid, port: Number(new URL(serverUrl).port), startedAt: new Date().toISOString() })
  );
  const res = await runCheck(root, 'sec-hero', { smoke: true, devUrl: 'http://127.0.0.1:1', countCall: false });
  assert.deepEqual(res.errors, []);
  assert.equal(res.pass, true);
});

test('I7: framer- classes in files under a directory target are reported', async () => {
  const root = await tmp('convert check dirtarget ');
  const state = stateWith(root, [
    { ...sectionTask('sec-hero', '/', 'hero'), targets: ['src/components/Hero.tsx', 'src/components/hero/'] }
  ]);
  await saveState(state);
  await mkdir(path.join(root, 'src', 'components', 'hero', 'deep'), { recursive: true });
  await writeFile(path.join(root, 'src', 'components', 'Hero.tsx'), 'export const Hero = () => <div className="ok" />;');
  await writeFile(
    path.join(root, 'src', 'components', 'hero', 'deep', 'Part.tsx'),
    'export const Part = () => <div className="framer-1x y" />;'
  );
  const res = await runCheck(root, 'sec-hero', { smoke: true, devUrl: serverUrl, countCall: false });
  assert(res.code.some((c) => c.includes('Part.tsx')), `code: ${JSON.stringify(res.code)}`);
});

test('I1: a check that starts the dev server leaves it running for reuse', async () => {
  const root = await tmp('convert check keepalive ');
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'x', private: true, type: 'module', scripts: { dev: 'node dev.mjs' } })
  );
  await writeFile(
    path.join(root, 'dev.mjs'),
    `import http from 'node:http';
const i = process.argv.indexOf('-p');
http.createServer((q, r) => {
  r.writeHead(200, { 'content-type': 'text/html' });
  r.end('<!doctype html><body><div data-section="hero" style="height:100px">x</div></body>');
}).listen(Number(process.argv[i + 1]), '127.0.0.1');
`
  );
  await saveState(stateWith(root, [sectionTask('sec-hero', '/', 'hero')]));
  try {
    const res = await runCheck(root, 'sec-hero', { smoke: true, countCall: false });
    assert.deepEqual(res.errors, []);
    const info = JSON.parse(await readFile(path.join(root, '.convert', 'dev-server.json'), 'utf8'));
    await stopAllManaged(); // would kill a managed (non keepAlive) child
    assert.equal(isPidAlive(info.pid), true, 'dev server must outlive the check');
  } finally {
    await stopDevServer(root);
  }
});
