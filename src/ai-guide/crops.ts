import fs from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import type { Box } from '../nextjs/model.js';

/** Writes the part of a full-page screenshot inside `box` (clamped to the image). False when nothing is left. */
export async function cropPng(sourcePng: string, box: Box, outPng: string): Promise<boolean> {
  const src = PNG.sync.read(await fs.readFile(sourcePng));
  const x = Math.max(0, Math.round(box.x));
  const y = Math.max(0, Math.round(box.y));
  const w = Math.min(src.width, Math.round(box.x + box.w)) - x;
  const h = Math.min(src.height, Math.round(box.y + box.h)) - y;
  if (w <= 0 || h <= 0) return false;
  const out = new PNG({ width: w, height: h });
  PNG.bitblt(src, out, x, y, w, h, 0, 0);
  await fs.mkdir(path.dirname(outPng), { recursive: true });
  await fs.writeFile(outPng, PNG.sync.write(out));
  return true;
}
