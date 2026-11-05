import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { ensureDevServer, stopDevServer, type DevServer } from '../../src/convert/verify/dev-server.js';
import { isPidAlive, killPidTree, stopAllManaged } from '../../src/convert/verify/proc.js';

const tmps: string[] = [];

after(async () => {
  await stopAllManaged();
  for (const d of tmps) {
    await rm(d, { recursive: true, force: true }).catch(() => {});
  }
});

async function createStandInProject(opts: { exitCode?: number; answers500?: boolean } = {}): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'convert dev '));
  tmps.push(dir);
  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: 'stand-in-dev',
      private: true,
      type: 'module',
      scripts: { dev: 'node dev.mjs' }
    })
  );

  let script: string;
  if (typeof opts.exitCode === 'number') {
    script = `process.exit(${opts.exitCode});\n`;
  } else if (opts.answers500) {
    script = `import http from 'node:http';
const pIdx = process.argv.indexOf('-p');
const port = pIdx !== -1 ? Number(process.argv[pIdx + 1]) : 3000;
const srv = http.createServer((req, res) => {
  res.writeHead(500, { 'content-type': 'text/plain' });
  res.end('internal server error');
});
srv.listen(port, '127.0.0.1');
`;
  } else {
    script = `import http from 'node:http';
const pIdx = process.argv.indexOf('-p');
const port = pIdx !== -1 ? Number(process.argv[pIdx + 1]) : 3000;
const srv = http.createServer((req, res) => {
  if (req.url === '/env') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(process.env.NEXT_TELEMETRY_DISABLED ?? '');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('ok');
});
srv.listen(port, '127.0.0.1');
`;
  }

  await writeFile(path.join(dir, 'dev.mjs'), script);
  return dir;
}

test('ensureDevServer starts dev server, writes .convert/dev-server.json, and reuses same pid on second call', async () => {
  const dir = await createStandInProject();
  const s1 = await ensureDevServer(dir);

  assert.ok(s1.pid > 0, 'dev server pid should be positive');
  assert.ok(s1.url.startsWith('http://127.0.0.1:'), 'url should point to loopback');

  const res1 = await fetch(s1.url + '/');
  assert.equal(res1.status, 200);
  assert.equal(await res1.text(), 'ok');

  const infoPath = path.join(dir, '.convert', 'dev-server.json');
  const infoRaw = await readFile(infoPath, 'utf8');
  const info = JSON.parse(infoRaw);
  assert.equal(info.pid, s1.pid);
  assert.equal(info.port, Number(new URL(s1.url).port));
  assert.ok(info.startedAt, 'startedAt should be present');

  // Second ensureDevServer reuses the same pid and url
  const s2 = await ensureDevServer(dir);
  assert.equal(s2.pid, s1.pid);
  assert.equal(s2.url, s1.url);

  await s2.stop();
  assert.equal(isPidAlive(s1.pid), false, 'pid should no longer be alive after stop()');
  await assert.rejects(() => stat(infoPath), /ENOENT/, 'dev-server.json should be removed');
});

test('after killing dev server pid, ensureDevServer starts a fresh server on a new port and rewrites info file (Review Focus 5)', async () => {
  const dir = await createStandInProject();
  const s1 = await ensureDevServer(dir);
  const pid1 = s1.pid;
  const port1 = Number(new URL(s1.url).port);

  // Dev server dies mid-run
  await killPidTree(pid1);
  assert.equal(isPidAlive(pid1), false, 'pid1 should be killed');

  // Next ensureDevServer detects dead server, starts a fresh server on a free port, and rewrites dev-server.json
  const s2 = await ensureDevServer(dir);
  assert.notEqual(s2.pid, pid1, 'should start a new process');
  assert.ok(s2.pid > 0);

  const res2 = await fetch(s2.url + '/');
  assert.equal(res2.status, 200);
  assert.equal(await res2.text(), 'ok');

  const infoRaw = await readFile(path.join(dir, '.convert', 'dev-server.json'), 'utf8');
  const info = JSON.parse(infoRaw);
  assert.equal(info.pid, s2.pid);
  assert.equal(info.port, Number(new URL(s2.url).port));

  await s2.stop();
  assert.equal(isPidAlive(s2.pid), false);
});

test('dev server dies and previous port is occupied -> ensureDevServer starts fresh server on another free port (Review Focus 5)', async () => {
  const dir = await createStandInProject();
  const s1 = await ensureDevServer(dir);
  const pid1 = s1.pid;
  const port1 = Number(new URL(s1.url).port);

  await killPidTree(pid1);
  assert.equal(isPidAlive(pid1), false);

  // Take the previous port with an unrelated server
  const blocker = http.createServer((req, res) => {
    res.writeHead(418, { 'content-type': 'text/plain' });
    res.end('teapot blocker');
  });
  await new Promise<void>((resolve, reject) => {
    blocker.once('error', reject);
    blocker.listen(port1, '127.0.0.1', () => resolve());
  });

  try {
    const s2 = await ensureDevServer(dir);
    assert.notEqual(s2.pid, pid1);
    const port2 = Number(new URL(s2.url).port);
    assert.notEqual(port2, port1, 'new server must use a different free port');

    const res = await fetch(s2.url + '/');
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'ok');

    const infoRaw = await readFile(path.join(dir, '.convert', 'dev-server.json'), 'utf8');
    const info = JSON.parse(infoRaw);
    assert.equal(info.pid, s2.pid);
    assert.equal(info.port, port2);

    await s2.stop();
  } finally {
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
  }
});

test('stopDevServer leaves no live pid and deletes .convert/dev-server.json', async () => {
  const dir = await createStandInProject();
  const s = await ensureDevServer(dir);
  const infoPath = path.join(dir, '.convert', 'dev-server.json');

  assert.equal(isPidAlive(s.pid), true);
  await stat(infoPath);

  await stopDevServer(dir);

  assert.equal(isPidAlive(s.pid), false, 'recorded pid must be killed');
  await assert.rejects(() => stat(infoPath), /ENOENT/, 'dev-server.json must be deleted');

  // Calling stopDevServer when no server is recorded is a clean no-op
  await stopDevServer(dir);
});

test('keepAlive: true starts a detached server that can be stopped with stopDevServer', async () => {
  const dir = await createStandInProject();
  const s = await ensureDevServer(dir, { keepAlive: true });

  assert.ok(s.pid > 0);
  const res = await fetch(s.url + '/');
  assert.equal(res.status, 200);

  assert.equal(isPidAlive(s.pid), true);

  await stopDevServer(dir);
  assert.equal(isPidAlive(s.pid), false);
  await assert.rejects(() => stat(path.join(dir, '.convert', 'dev-server.json')), /ENOENT/);
});

test('NEXT_TELEMETRY_DISABLED=1 is passed in the child environment', async () => {
  const dir = await createStandInProject();
  const s = await ensureDevServer(dir);

  const res = await fetch(s.url + '/env');
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '1', 'NEXT_TELEMETRY_DISABLED should be 1');

  await s.stop();
});

test('ensureDevServer reuses server even if GET / answers 500', async () => {
  const dir = await createStandInProject({ answers500: true });
  const s1 = await ensureDevServer(dir);

  const res1 = await fetch(s1.url + '/');
  assert.equal(res1.status, 500);

  const s2 = await ensureDevServer(dir);
  assert.equal(s2.pid, s1.pid);

  await s2.stop();
});

test('ensureDevServer fails fast when dev script exits before becoming ready', async () => {
  const dir = await createStandInProject({ exitCode: 42 });

  await assert.rejects(
    () => ensureDevServer(dir, { readyTimeoutMs: 5000 }),
    /dev server exited before becoming ready \(code 42\)/
  );
});
