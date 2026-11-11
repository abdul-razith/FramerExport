import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { swapIn } from '../../src/ai-guide/swap.js';

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aiguide-swap-'));
  const guide = path.join(root, 'ai-guide');
  const build = path.join(root, '.ai-guide-build');
  await fs.mkdir(path.join(guide, 'pages'), { recursive: true });
  await fs.writeFile(path.join(guide, 'site.md'), 'old');
  await fs.writeFile(path.join(guide, 'plan.md'), '- [x] done');
  await fs.writeFile(path.join(guide, 'pages', 'stale.md'), 'stale');
  return { root, guide, build };
}

test('the new guide replaces the old one and keeps plan.md', async () => {
  const { root, guide, build } = await setup();
  await fs.mkdir(build);
  await fs.writeFile(path.join(build, 'site.md'), 'new');
  await swapIn(build, guide);
  assert.equal(await fs.readFile(path.join(guide, 'site.md'), 'utf8'), 'new');
  assert.equal(await fs.readFile(path.join(guide, 'plan.md'), 'utf8'), '- [x] done');
  assert.ok(!existsSync(path.join(guide, 'pages', 'stale.md')));
  assert.deepEqual((await fs.readdir(root)).sort(), ['ai-guide']);
});

test('when the new guide cannot be moved in, the old guide is back in place', async () => {
  const { guide, build } = await setup();
  // No build folder: the move fails, like a locked file on Windows would make it fail.
  await assert.rejects(swapIn(build, guide));
  assert.equal(await fs.readFile(path.join(guide, 'site.md'), 'utf8'), 'old');
  assert.ok(existsSync(path.join(guide, 'pages', 'stale.md')));
});
