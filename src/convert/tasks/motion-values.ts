import type { AnimationEntry } from '../types.js';

export interface DecomposedTransform {
  x: number;
  y: number;
  rotate: number;
  scaleX: number;
  scaleY: number;
  skewX: number;
}

const IDENTITY: DecomposedTransform = {
  x: 0,
  y: 0,
  rotate: 0,
  scaleX: 1,
  scaleY: 1,
  skewX: 0,
};

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const res = Math.round(value * factor) / factor;
  return res === 0 ? 0 : res;
}

function decompose2D(
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number
): DecomposedTransform {
  const denom = a * a + b * b;
  const scaleX = Math.hypot(a, b);
  const scaleY = scaleX === 0 ? 0 : (a * d - b * c) / scaleX;
  const rotate = scaleX === 0 ? 0 : Math.atan2(b, a) * (180 / Math.PI);
  const skewX = scaleX === 0 ? 0 : Math.atan2(a * c + b * d, denom) * (180 / Math.PI);

  return {
    x: round(e, 2),
    y: round(f, 2),
    rotate: round(rotate, 1),
    scaleX: round(scaleX, 2),
    scaleY: round(scaleY, 2),
    skewX: round(skewX, 1),
  };
}

/**
 * Decomposes a CSS transform string into 2D translation, rotation, scale, and skew.
 *
 * - 'none' returns identity.
 * - 'matrix(a, b, c, d, e, f)' decomposes into components.
 * - Degrees are rounded to 0.1, px and scale to 0.01.
 * - Returns null for unparseable or unsupported transforms.
 */
export function decomposeTransform(value: string): DecomposedTransform | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.toLowerCase() === 'none') {
    return { ...IDENTITY };
  }

  const m2d = trimmed.match(/^matrix\((.+)\)$/i);
  if (m2d) {
    const parts = m2d[1]
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean);
    if (parts.length === 6) {
      const nums = parts.map(Number);
      if (!nums.some((n) => Number.isNaN(n))) {
        return decompose2D(nums[0], nums[1], nums[2], nums[3], nums[4], nums[5]);
      }
    }
    return null;
  }

  const m3d = trimmed.match(/^matrix3d\((.+)\)$/i);
  if (m3d) {
    const parts = m3d[1]
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean);
    if (parts.length === 16) {
      const nums = parts.map(Number);
      if (!nums.some((n) => Number.isNaN(n))) {
        // 2D projection inside a 4x4 matrix:
        // [0]=a, [1]=b, [4]=c, [5]=d, [12]=e, [13]=f
        return decompose2D(nums[0], nums[1], nums[4], nums[5], nums[12], nums[13]);
      }
    }
    return null;
  }

  return null;
}

function fmtPx(val: number): string {
  return val === 0 ? '0' : `${val}px`;
}

function fmtAngle(val: number): string {
  return val === 0 ? '0' : `${val}deg`;
}

function describeTransformChanges(fromTransform?: string, toTransform?: string): string[] {
  if (!fromTransform && !toTransform) return [];
  if (fromTransform === toTransform) return [];

  const normFrom = fromTransform ?? 'none';
  const normTo = toTransform ?? 'none';
  if (normFrom === normTo) return [];

  const dFrom = decomposeTransform(normFrom);
  const dTo = decomposeTransform(normTo);

  if (!dFrom || !dTo) {
    return [`transform ${fromTransform ?? 'none'}→${toTransform ?? 'none'}`];
  }

  const changes: string[] = [];

  const scaleXChanged = dFrom.scaleX !== dTo.scaleX;
  const scaleYChanged = dFrom.scaleY !== dTo.scaleY;
  if (
    scaleXChanged &&
    scaleYChanged &&
    dFrom.scaleX === dFrom.scaleY &&
    dTo.scaleX === dTo.scaleY
  ) {
    changes.push(`scale ${dFrom.scaleX}→${dTo.scaleX}`);
  } else {
    if (scaleXChanged) changes.push(`scaleX ${dFrom.scaleX}→${dTo.scaleX}`);
    if (scaleYChanged) changes.push(`scaleY ${dFrom.scaleY}→${dTo.scaleY}`);
  }

  if (dFrom.rotate !== dTo.rotate) {
    changes.push(`rotate ${fmtAngle(dFrom.rotate)}→${fmtAngle(dTo.rotate)}`);
  }

  if (dFrom.skewX !== dTo.skewX) {
    changes.push(`skewX ${fmtAngle(dFrom.skewX)}→${fmtAngle(dTo.skewX)}`);
  }

  if (dFrom.x !== dTo.x) {
    changes.push(`x ${fmtPx(dFrom.x)}→${fmtPx(dTo.x)}`);
  }

  if (dFrom.y !== dTo.y) {
    changes.push(`y ${fmtPx(dFrom.y)}→${fmtPx(dTo.y)}`);
  }

  return changes;
}

/**
 * Returns a human-readable description of an AnimationEntry's motion,
 * e.g. "scroll, 1.3 s: opacity 0→1, scale 0.8→1, y 20px→0".
 * Only changed components are listed. Appends ", low confidence" when confidence is 'low'.
 */
export function describeMotion(entry: AnimationEntry): string {
  const timing: string[] = [entry.trigger];
  if (entry.durationMs != null && entry.durationMs > 0) {
    timing.push(`${round(entry.durationMs / 1000, 1)} s`);
  }
  if (entry.delayMs != null && entry.delayMs > 0) {
    timing.push(`delay ${round(entry.delayMs / 1000, 1)} s`);
  }
  const prefix = timing.join(', ');

  const allChanges: string[] = [];

  // 1. Opacity
  if (
    entry.from.opacity !== entry.to.opacity &&
    (entry.from.opacity !== undefined || entry.to.opacity !== undefined)
  ) {
    const fromRaw = entry.from.opacity;
    const toRaw = entry.to.opacity;
    const fromNum = fromRaw !== undefined ? Number(fromRaw) : NaN;
    const toNum = toRaw !== undefined ? Number(toRaw) : NaN;
    const fromStr = !Number.isNaN(fromNum) ? String(round(fromNum, 2)) : (fromRaw ?? '1');
    const toStr = !Number.isNaN(toNum) ? String(round(toNum, 2)) : (toRaw ?? '1');
    allChanges.push(`opacity ${fromStr}→${toStr}`);
  }

  // 2. Transform components
  const tfChanges = describeTransformChanges(entry.from.transform, entry.to.transform);
  allChanges.push(...tfChanges);

  // 3. Other properties (e.g. filter, clip-path)
  const otherKeys = new Set([...Object.keys(entry.from), ...Object.keys(entry.to)]);
  otherKeys.delete('opacity');
  otherKeys.delete('transform');
  for (const key of [...otherKeys].sort()) {
    const fromVal = entry.from[key];
    const toVal = entry.to[key];
    if (fromVal !== toVal && (fromVal !== undefined || toVal !== undefined)) {
      allChanges.push(`${key} ${fromVal ?? 'none'}→${toVal ?? 'none'}`);
    }
  }

  const changeText = allChanges.length > 0 ? allChanges.join(', ') : 'none';
  const confidenceSuffix = entry.confidence === 'low' ? ', low confidence' : '';

  return `${prefix}: ${changeText}${confidenceSuffix}`;
}
