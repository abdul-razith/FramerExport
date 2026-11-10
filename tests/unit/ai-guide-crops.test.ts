import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PNG } from 'pngjs';
import { cropPng } from '../../src/ai-guide/crops.js';
import { COMPARE_MJS } from '../../src/ai-guide/templates/compare.js';

const tmpDir = () => fs.mkdtemp(path.join(os.tmpdir(), 'ai-guide-crops-'));

/** width×height, red top half, blue bottom half. */
async function writeTestPng(width: number, height: number): Promise<string> {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const top = y < height / 2;
      png.data[i] = top ? 255 : 0;
      png.data[i + 1] = 0;
      png.data[i + 2] = top ? 0 : 255;
      png.data[i + 3] = 255;
    }
  }
  const file = path.join(await tmpDir(), 'src.png');
  await fs.writeFile(file, PNG.sync.write(png));
  return file;
}

test('cropPng cuts the box out of the screenshot', async () => {
  const src = await writeTestPng(100, 200);
  const out = path.join(await tmpDir(), 'c.png');
  assert.equal(await cropPng(src, { x: 0, y: 100, w: 100, h: 50 }, out), true);
  const png = PNG.sync.read(await fs.readFile(out));
  assert.deepEqual([png.width, png.height], [100, 50]);
  assert.deepEqual([...png.data.subarray(0, 3)], [0, 0, 255]);
});

test('cropPng clamps to the image and skips empty boxes', async () => {
  const src = await writeTestPng(100, 200);
  const dir = await tmpDir();
  assert.equal(await cropPng(src, { x: 0, y: 180, w: 100, h: 500 }, path.join(dir, 'a.png')), true);
  assert.equal(PNG.sync.read(await fs.readFile(path.join(dir, 'a.png'))).height, 20);
  assert.equal(await cropPng(src, { x: 0, y: 300, w: 100, h: 10 }, path.join(dir, 'b.png')), false);
  assert.equal(await fs.stat(path.join(dir, 'b.png')).then(() => true, () => false), false);
});

test('the compare script is self-contained', () => {
  assert.doesNotMatch(COMPARE_MJS, /from ['"]\.\.?\//);
  for (const w of ['1440', '1024', '390']) assert.ok(COMPARE_MJS.includes(w));
});

test('the compare script is valid JavaScript', async () => {
  const { execFileSync } = await import('node:child_process');
  const file = path.join(await tmpDir(), 'compare.mjs');
  await fs.writeFile(file, COMPARE_MJS);
  execFileSync(process.execPath, ['--check', file]);
});

test('compare.mjs reads the route even after Git Bash rewrote it into a Windows path', async () => {
  const { spawnSync } = await import('node:child_process');
  const file = path.join(await tmpDir(), 'compare.mjs');
  await fs.writeFile(file, COMPARE_MJS);
  const run = (arg: string) =>
    spawnSync(process.execPath, [file, arg, '--base', 'http://127.0.0.1:9'], { cwd: process.cwd(), encoding: 'utf8' });
  assert.match(run('C:/Program Files/Git/about').stderr, /http:\/\/127\.0\.0\.1:9\/about/);
  assert.match(run('about').stderr, /http:\/\/127\.0\.0\.1:9\/about/);
  assert.match(run('--bogus').stderr, /Unknown argument/);
});
