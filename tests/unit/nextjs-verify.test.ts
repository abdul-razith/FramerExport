import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { compareScreenshots } from '../../src/nextjs/verify.js';

async function png(width: number, height: number, paint: (x: number, y: number) => number[]): Promise<string> {
  const img = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const i = (y * width + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fexport-png-'));
  const file = path.join(dir, 'x.png');
  await fs.writeFile(file, PNG.sync.write(img));
  return file;
}

test('identical screenshots score 1', async () => {
  const a = await png(20, 10, () => [19, 51, 36]);
  const b = await png(20, 10, () => [19, 51, 36]);
  assert.equal(compareScreenshots(a, b), 1);
});

test('10% changed pixels score about 0.9', async () => {
  const a = await png(20, 10, () => [255, 255, 255]);
  const b = await png(20, 10, (x) => (x < 2 ? [0, 0, 0] : [255, 255, 255]));
  const score = compareScreenshots(a, b);
  assert.ok(Math.abs(score - 0.9) <= 0.01, `score ${score}`);
});

test('different heights are padded with white instead of throwing', async () => {
  const a = await png(20, 10, () => [255, 255, 255]);
  const b = await png(20, 20, () => [255, 255, 255]);
  assert.equal(compareScreenshots(a, b), 1);
});
