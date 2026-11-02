import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import puppeteer from 'puppeteer';
import { framerAdapter } from '../../src/convert/adapters/framer/index.js';
import { initState } from '../../src/convert/state.js';
import { runAnalyze } from '../../src/convert/stages/analyze.js';
import { capturePage } from '../../src/convert/verify/capture.js';
import { freePort, spawnManaged, stopAllManaged } from '../../src/convert/verify/proc.js';
import { BuildFailedError, startExportServer, startNextServer } from '../../src/convert/verify/serve.js';

const fixture = path.resolve('tests/fixtures/framer-nudge-mini');
const tmps: string[] = [];
async function tmp(prefix = 'fexport verify '): Promise<string> {
  const d = await mkdtemp(path.join(os.tmpdir(), prefix));
  tmps.push(d);
  return d;
}
after(async () => {
  await stopAllManaged();
  for (const d of tmps) await rm(d, { recursive: true, force: true }).catch(() => {});
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getStatus(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 3000 }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function listenOnce(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(port, () => srv.close(() => resolve()));
  });
}

test('freePort returns a bindable port', async () => {
  const port = await freePort();
  assert.ok(port > 0);
  await listenOnce(port);
});

test('startExportServer serves a fixture copy in a path with a space, stop frees the port', { timeout: 60_000 }, async () => {
  const dir = path.join(await tmp(), 'my export');
  await cp(fixture, dir, { recursive: true });
  const server = await startExportServer(dir);
  let stopped = false;
  try {
    assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(await getStatus(server.url + '/'), 200);
    await server.stop();
    stopped = true;
    await listenOnce(Number(new URL(server.url).port));
  } finally {
    if (!stopped) await server.stop();
  }
});

test('managed children are registered and killed by the shutdown cleanup', { timeout: 30_000 }, async () => {
  const proc = spawnManaged(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { cwd: os.tmpdir() });
  try {
    const pid = proc.child.pid!;
    assert.ok(pid > 0);
    assert.ok(isAlive(pid));
    assert.ok(process.listenerCount('SIGINT') >= 1);
    assert.ok(process.listenerCount('SIGTERM') >= 1);
    await stopAllManaged();
    assert.equal(isAlive(pid), false);
    await proc.stop(); // already exited: resolves immediately
  } finally {
    await proc.stop();
  }
});

function pngWidth(png: Buffer): number {
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
  return png.readUInt32BE(16);
}

test('capturePage on the fixture export at 1440 returns a 1440px PNG and >=3 sections', { timeout: 120_000 }, async () => {
  const server = await startExportServer(fixture);
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const sections = framerAdapter.sections(readFileSync(path.join(fixture, 'index.html'), 'utf8'));
    const result = await capturePage(page, server.url + '/', 1440, 'export', sections);
    assert.equal(pngWidth(result.png), 1440);
    assert.ok(result.sections.length >= 3, JSON.stringify(result.sections));
    for (const s of result.sections) {
      assert.ok(s.box.width > 0 && s.box.height > 0, s.name);
      assert.ok(sections.some((x) => x.name === s.name), s.name);
    }
  } finally {
    await browser.close();
    await server.stop();
  }
});

test('capturePage in next mode reads [data-section] elements', { timeout: 60_000 }, async () => {
  const dir = await tmp();
  await writeFile(
    path.join(dir, 'serve.js'),
    `import http from 'node:http';
http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<!doctype html><body style="margin:0"><section data-section="hero" style="height:300px">a</section><section data-section="cta" style="height:200px">b</section><div data-section="empty" style="height:0"></div></body>');
}).listen(process.env.PORT);`
  );
  await writeFile(path.join(dir, 'package.json'), '{"type":"module"}');
  const server = await startExportServer(dir);
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const result = await capturePage(page, server.url + '/', 800, 'next');
    assert.equal(pngWidth(result.png), 800);
    assert.deepEqual(result.sections, [
      { name: 'hero', box: { x: 0, y: 0, width: 800, height: 300 } },
      { name: 'cta', box: { x: 0, y: 300, width: 800, height: 200 } }
    ]);
    assert.ok(page.url().includes('__verify=1'), page.url());
  } finally {
    await browser.close();
    await server.stop();
  }
});

test('startNextServer rejects with BuildFailedError when the build fails', { timeout: 60_000 }, async () => {
  const dir = path.join(await tmp(), 'next app');
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'broken', private: true, scripts: { build: 'node -e "console.log(\'build-out\');process.exit(1)"' } })
  );
  await assert.rejects(
    () => startNextServer(dir),
    (err: unknown) => {
      assert.ok(err instanceof BuildFailedError, String(err));
      assert.match(err.log, /build-out/);
      return true;
    }
  );
});

test('runAnalyze with animations observes the fixture export and writes animations.json', { timeout: 600_000 }, async () => {
  const nextDir = await tmp();
  const state = initState(fixture, nextDir);
  await runAnalyze({ state, exportDir: fixture, nextDir, log: () => {} }, framerAdapter, { animations: true });
  const anims = JSON.parse(await readFile(path.join(nextDir, '.convert', 'analysis', 'animations.json'), 'utf8'));
  assert.ok(Array.isArray(anims));
  for (const a of anims) assert.equal(typeof a.route, 'string');
});
