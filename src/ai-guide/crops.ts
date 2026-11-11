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

/**
 * Cuts the part of a full-page screenshot inside `box` into slices of at most `sliceHeight` px
 * (`<prefix>-1.png`, `-2.png`…), so a tall section keeps its detail when an AI looks at it.
 */
export async function sliceSection(sourcePng: string, box: Box, outDir: string, prefix: string, sliceHeight = 900): Promise<string[]> {
  const files: string[] = [];
  for (let top = 0, i = 1; top < box.h; top += sliceHeight, i++) {
    const file = path.join(outDir, `${prefix}-${i}.png`);
    if (await cropPng(sourcePng, { x: box.x, y: box.y + top, w: box.w, h: Math.min(sliceHeight, box.h - top) }, file)) files.push(file);
  }
  return files;
}
