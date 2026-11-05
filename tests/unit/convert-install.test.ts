import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import type { StageContext } from '../../src/convert/adapters/types.js';
import { initState, loadState } from '../../src/convert/state.js';
import { runInstall } from '../../src/convert/stages/install.js';

const tmps: string[] = [];
after(async () => {
  for (const d of tmps) {
    await fs.rm(d, { recursive: true, force: true });
  }
});

async function makeTmp(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'convert install '));
  tmps.push(dir);
  return dir;
}

test('runInstall with fake npm returning code 0 sets stages.install to done', async () => {
  const tmpDir = await makeTmp();
  const ctx: StageContext = {
    state: initState('/fake/export', tmpDir),
    exportDir: '/fake/export',
    nextDir: tmpDir,
    log: () => {},
  };
  let calledCwd: string | undefined;
  await runInstall(ctx, {
    npm: async (cwd) => {
      calledCwd = cwd;
      return { code: 0, tail: '' };
    },
  });
  assert.equal(calledCwd, tmpDir);
  assert.equal(ctx.state.stages.install, 'done');
  assert.equal(ctx.state.warnings.length, 0);

  const loaded = await loadState(tmpDir);
  assert.equal(loaded?.stages.install, 'done');
});

test('runInstall with fake npm returning code 1 sets stages.install to failed and pushes warning containing tail', async () => {
  const tmpDir = await makeTmp();
  const ctx: StageContext = {
    state: initState('/fake/export', tmpDir),
    exportDir: '/fake/export',
    nextDir: tmpDir,
    log: () => {},
  };
  await runInstall(ctx, {
    npm: async () => ({ code: 1, tail: 'E404 not found in npm registry' }),
  });
  assert.equal(ctx.state.stages.install, 'failed');
  assert.equal(ctx.state.warnings.length, 1);
  assert.match(ctx.state.warnings[0]!, /^install: npm install failed \(exit 1\)/);
  assert.match(ctx.state.warnings[0]!, /E404/);

  const loaded = await loadState(tmpDir);
  assert.equal(loaded?.stages.install, 'failed');
  assert.equal(loaded?.warnings.length, 1);
  assert.match(loaded?.warnings[0]!, /E404/);
});

test('runInstall handles failure when tail is empty', async () => {
  const tmpDir = await makeTmp();
  const ctx: StageContext = {
    state: initState('/fake/export', tmpDir),
    exportDir: '/fake/export',
    nextDir: tmpDir,
    log: () => {},
  };
  await runInstall(ctx, {
    npm: async () => ({ code: 127, tail: '' }),
  });
  assert.equal(ctx.state.stages.install, 'failed');
  assert.equal(ctx.state.warnings[0], 'install: npm install failed (exit 127)');
});

test('default npm uses spawnManaged and handles nextDir with spaces', async () => {
  const tmpDir = await makeTmp();
  const ctx: StageContext = {
    state: initState('/fake/export', tmpDir),
    exportDir: '/fake/export',
    nextDir: tmpDir,
    log: () => {},
  };
  // A package.json in the temp dir stops npm walking up to the home folder; the
  // file: dependency cannot resolve, so npm fails offline without touching anything else.
  await fs.writeFile(
    path.join(tmpDir, 'package.json'),
    JSON.stringify({ name: 't', version: '1.0.0', private: true, dependencies: { missing: 'file:./does-not-exist.tgz' } }),
  );
  await runInstall(ctx);
  assert.equal(ctx.state.stages.install, 'failed');
  assert.ok(ctx.state.warnings.length > 0);
  assert.match(ctx.state.warnings[0]!, /^install: npm install failed \(exit/);
});
