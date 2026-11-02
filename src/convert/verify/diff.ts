import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import type { CaptureResult } from './capture.js';

export interface SectionResult {
  name: string;
  width: number;
  ratio: number;
  heightDelta: number;
  pass: boolean;
  reason?: string;
  diffPng?: Buffer;
  expectedPng?: Buffer;
  actualPng?: Buffer;
}

const MAX_RATIO = 0.005;
const MAX_HEIGHT_DELTA = 2;
const UNNAMED = /^section-\d+$/;

/**
 * Pair expected and actual entries: exact name first (first unused match), then leftover unnamed
 * `section-<n>` entries by order. Returns index pairs; `null` marks a side without a counterpart.
 */
export function pairByName(
  expected: Array<{ name: string }>,
  actual: Array<{ name: string }>
): Array<[number | null, number | null]> {
  const usedA = new Set<number>();
  const pairE = new Map<number, number>();
  expected.forEach((e, i) => {
    const j = actual.findIndex((a, k) => !usedA.has(k) && a.name === e.name);
    if (j >= 0) {
      usedA.add(j);
      pairE.set(i, j);
    }
  });
  const leftE = expected.map((_, i) => i).filter((i) => !pairE.has(i) && UNNAMED.test(expected[i].name));
  const leftA = actual.map((_, k) => k).filter((k) => !usedA.has(k) && UNNAMED.test(actual[k].name));
  for (let n = 0; n < Math.min(leftE.length, leftA.length); n++) {
    pairE.set(leftE[n], leftA[n]);
    usedA.add(leftA[n]);
  }
  const out: Array<[number | null, number | null]> = expected.map((_, i) => [i, pairE.get(i) ?? null]);
  actual.forEach((_, k) => {
    if (!usedA.has(k)) out.push([null, k]);
  });
  return out;
}

function crop(src: PNG, box: { x: number; y: number; width: number; height: number }): PNG {
  const x0 = Math.min(Math.max(0, Math.round(box.x)), src.width - 1);
  const y0 = Math.min(Math.max(0, Math.round(box.y)), src.height - 1);
  const w = Math.max(1, Math.min(Math.round(box.width), src.width - x0));
  const h = Math.max(1, Math.min(Math.round(box.height), src.height - y0));
  const out = new PNG({ width: w, height: h });
  PNG.bitblt(src, out, x0, y0, w, h, 0, 0);
  return out;
}

/** Copy `src` onto an opaque white canvas of w x h. */
function pad(src: PNG, w: number, h: number): PNG {
  if (src.width === w && src.height === h) return src;
  const out = new PNG({ width: w, height: h });
  out.data.fill(255);
  PNG.bitblt(src, out, 0, 0, Math.min(src.width, w), Math.min(src.height, h), 0, 0);
  return out;
}

/** Compare each expected section against its actual counterpart (cropped by box, padded to equal size). */
export function compareSections(expected: CaptureResult, actual: CaptureResult, width: number): SectionResult[] {
  const ePng = PNG.sync.read(expected.png);
  const aPng = PNG.sync.read(actual.png);
  const results: SectionResult[] = [];
  for (const [i, j] of pairByName(expected.sections, actual.sections)) {
    if (i === null || j === null) {
      const name = (i !== null ? expected.sections[i] : actual.sections[j as number]).name;
      results.push({
        name,
        width,
        ratio: 1,
        heightDelta: 0,
        pass: false,
        reason: i !== null ? `missing section ${name}` : `unexpected section ${name}`
      });
      continue;
    }
    const e = crop(ePng, expected.sections[i].box);
    const a = crop(aPng, actual.sections[j].box);
    const w = Math.max(e.width, a.width);
    const h = Math.max(e.height, a.height);
    const ep = pad(e, w, h);
    const ap = pad(a, w, h);
    const diff = new PNG({ width: w, height: h });
    const count = pixelmatch(ep.data, ap.data, diff.data, w, h, { threshold: 0.1 });
    const ratio = count / (w * h);
    const heightDelta = a.height - e.height;
    const pass = ratio <= MAX_RATIO && Math.abs(heightDelta) <= MAX_HEIGHT_DELTA;
    const r: SectionResult = { name: expected.sections[i].name, width, ratio, heightDelta, pass };
    if (!pass) {
      r.reason = ratio > MAX_RATIO ? `pixel diff ${(ratio * 100).toFixed(2)}%` : `height delta ${heightDelta}px`;
      r.diffPng = PNG.sync.write(diff);
      r.expectedPng = PNG.sync.write(ep);
      r.actualPng = PNG.sync.write(ap);
    }
    results.push(r);
  }
  return results;
}
