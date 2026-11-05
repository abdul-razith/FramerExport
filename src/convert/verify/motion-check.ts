import type { Page } from 'puppeteer';
import type { AnimationEntry } from '../types.js';
import type { MotionAnchor } from '../generate/manifest.js';
import { decomposeTransform } from '../tasks/motion-values.js';
import type { MotionResult } from './check.js';

export { type MotionResult };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function extractNumericProps(rec: Record<string, string> | undefined): Record<string, number> {
  const props: Record<string, number> = {};
  if (!rec) return props;

  // 1. Opacity
  if (rec.opacity !== undefined) {
    const num = parseFloat(rec.opacity);
    if (!Number.isNaN(num)) {
      props.opacity = num;
    }
  }

  // 2. Transform
  if (rec.transform !== undefined) {
    const d = decomposeTransform(rec.transform);
    if (d) {
      props.x = d.x;
      props.y = d.y;
      props.rotate = d.rotate;
      props.scaleX = d.scaleX;
      props.scaleY = d.scaleY;
      props.skewX = d.skewX;
    } else {
      const t = rec.transform;
      const rot = t.match(/rotate\(\s*([+-]?\d+(?:\.\d+)?)(deg|rad|turn)?\s*\)/i);
      if (rot) {
        let val = parseFloat(rot[1]);
        const unit = (rot[2] || 'deg').toLowerCase();
        if (unit === 'rad') val = val * (180 / Math.PI);
        else if (unit === 'turn') val = val * 360;
        props.rotate = val;
      }
      const tr = t.match(
        /translate(?:3d)?\(\s*([+-]?\d+(?:\.\d+)?)(?:px)?(?:\s*,\s*([+-]?\d+(?:\.\d+)?)(?:px)?)?/i
      );
      if (tr) {
        props.x = parseFloat(tr[1]);
        if (tr[2]) props.y = parseFloat(tr[2]);
      }
      const sc = t.match(/scale(?:3d)?\(\s*([+-]?\d+(?:\.\d+)?)(?:\s*,\s*([+-]?\d+(?:\.\d+)?))?/i);
      if (sc) {
        const sx = parseFloat(sc[1]);
        const sy = sc[2] ? parseFloat(sc[2]) : sx;
        props.scaleX = sx;
        props.scaleY = sy;
      }
      const scX = t.match(/scaleX\(\s*([+-]?\d+(?:\.\d+)?)\s*\)/i);
      if (scX) props.scaleX = parseFloat(scX[1]);
      const scY = t.match(/scaleY\(\s*([+-]?\d+(?:\.\d+)?)\s*\)/i);
      if (scY) props.scaleY = parseFloat(scY[1]);
      const trX = t.match(/translateX\(\s*([+-]?\d+(?:\.\d+)?)(?:px)?\s*\)/i);
      if (trX) props.x = parseFloat(trX[1]);
      const trY = t.match(/translateY\(\s*([+-]?\d+(?:\.\d+)?)(?:px)?\s*\)/i);
      if (trY) props.y = parseFloat(trY[1]);
      const skX = t.match(/skewX\(\s*([+-]?\d+(?:\.\d+)?)(?:deg)?\s*\)/i);
      if (skX) props.skewX = parseFloat(skX[1]);
    }
  }

  // 3. Direct properties: rotate, scale, scaleX, scaleY, x, y, skewX, etc.
  for (const [key, val] of Object.entries(rec)) {
    if (key === 'transform') continue;
    if (key === 'scale') {
      const num = parseFloat(val);
      if (!Number.isNaN(num)) {
        props.scaleX = num;
        props.scaleY = num;
      }
      continue;
    }
    const num = parseFloat(val);
    if (!Number.isNaN(num)) {
      if (props[key] === undefined) {
        props[key] = num;
      }
    }
  }

  return props;
}

/**
 * Determines the property with the largest recorded change between `entry.from` and `entry.to`
 * (e.g. `opacity`, or a component from `decomposeTransform` like `rotate`, `scaleX`, `scaleY`, `x`, `y`, `skewX`).
 * Returns `true` when `after` is at least 25 % of `|to − from|` closer to `to` than `before`.
 */
export function movedTowards(
  entry: Pick<AnimationEntry, 'from' | 'to'>,
  before: Record<string, string>,
  after: Record<string, string>
): boolean {
  const fromProps = extractNumericProps(entry.from);
  const toProps = extractNumericProps(entry.to);
  const beforeProps = extractNumericProps(before);
  const afterProps = extractNumericProps(after);

  const candidateKeys = new Set([...Object.keys(fromProps), ...Object.keys(toProps)]);
  let maxChange = 0;
  let targetProp: string | null = null;

  for (const key of candidateKeys) {
    const f = fromProps[key] ?? (key === 'scaleX' || key === 'scaleY' || key === 'opacity' ? 1 : 0);
    const t = toProps[key] ?? (key === 'scaleX' || key === 'scaleY' || key === 'opacity' ? 1 : 0);
    const change = Math.abs(t - f);
    if (change > maxChange) {
      maxChange = change;
      targetProp = key;
    }
  }

  if (!targetProp || maxChange <= 1e-4) {
    return false;
  }

  const f = fromProps[targetProp] ?? (targetProp === 'scaleX' || targetProp === 'scaleY' || targetProp === 'opacity' ? 1 : 0);
  const t = toProps[targetProp] ?? (targetProp === 'scaleX' || targetProp === 'scaleY' || targetProp === 'opacity' ? 1 : 0);
  const b = beforeProps[targetProp];
  const a = afterProps[targetProp];

  if (b === undefined || a === undefined) {
    return false;
  }

  const distBefore = Math.abs(t - b);
  const distAfter = Math.abs(t - a);
  const progress = distBefore - distAfter;

  return progress >= 0.25 * maxChange - 1e-6;
}

async function getElementStyles(page: Page, motionId: string): Promise<Record<string, string> | null> {
  return await page.evaluate((id: string) => {
    const el = document.querySelector(`[data-motion="${id}"]`);
    if (!el) return null;
    const s = window.getComputedStyle(el);
    return {
      opacity: s.opacity,
      transform: s.transform,
      filter: s.filter,
      clipPath: s.clipPath
    };
  }, motionId);
}

function hasStyleChanged(before: Record<string, string>, after: Record<string, string>): boolean {
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of allKeys) {
    if (before[k] !== after[k]) return true;
  }
  return false;
}

function cleanUrlWithoutVerify(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete('__verify');
    return u.toString();
  } catch {
    return url.replace(/[?&]__verify=[^&]*/g, '').replace(/\?$/, '');
  }
}

/**
 * Checks motion presence and behavior on the given page without freeze or verify flags.
 */
export async function checkMotion(
  page: Page,
  url: string,
  anchors: MotionAnchor[]
): Promise<MotionResult[]> {
  if (!anchors || anchors.length === 0) {
    return [];
  }

  const resultsMap = new Map<string, MotionResult>();
  const targetUrl = cleanUrlWithoutVerify(url);

  // Navigate to url without ?__verify=1 and without freezing animations
  await page.goto(targetUrl, { waitUntil: 'load', timeout: 30_000 });

  const appearAnchors = anchors.filter((a) => (a.entry.trigger ?? 'appear') === 'appear');
  const scrollAnchors = anchors.filter((a) => a.entry.trigger === 'scroll');
  const hoverAnchors = anchors.filter((a) => a.entry.trigger === 'hover');
  const loopAnchors = anchors.filter((a) => a.entry.trigger === 'loop');

  // 1. Appear: sample immediately at 0 ms after load, then after 1,500 ms
  if (appearAnchors.length > 0) {
    const appearBefore = new Map<string, Record<string, string> | null>();
    for (const a of appearAnchors) {
      appearBefore.set(a.id, await getElementStyles(page, a.id));
    }

    await sleep(1500);

    for (const a of appearAnchors) {
      const before = appearBefore.get(a.id);
      const after = await getElementStyles(page, a.id);
      const isLowConfidence = a.entry.confidence === 'low';

      if (!before || !after) {
        resultsMap.set(a.id, {
          id: a.id,
          pass: false,
          lowConfidence: isLowConfidence,
          detail: `Element [data-motion="${a.id}"] not found on page`
        });
        continue;
      }

      const pass = movedTowards(a.entry, before, after);
      resultsMap.set(a.id, {
        id: a.id,
        pass,
        lowConfidence: isLowConfidence,
        detail: pass
          ? 'Motion verified: element moved towards target on appear'
          : `Element did not move towards target on appear (before: ${JSON.stringify(before)}, after: ${JSON.stringify(after)})`
      });
    }
  }

  // 2. Loop: sample at t and t + 2,000 ms (pass on any change)
  if (loopAnchors.length > 0) {
    const loopBefore = new Map<string, Record<string, string> | null>();
    for (const a of loopAnchors) {
      loopBefore.set(a.id, await getElementStyles(page, a.id));
    }

    await sleep(2000);

    for (const a of loopAnchors) {
      const before = loopBefore.get(a.id);
      const after = await getElementStyles(page, a.id);
      const isLowConfidence = a.entry.confidence === 'low';

      if (!before || !after) {
        resultsMap.set(a.id, {
          id: a.id,
          pass: false,
          lowConfidence: isLowConfidence,
          detail: `Element [data-motion="${a.id}"] not found on page`
        });
        continue;
      }

      const changed = hasStyleChanged(before, after);
      resultsMap.set(a.id, {
        id: a.id,
        pass: changed,
        lowConfidence: isLowConfidence,
        detail: changed
          ? 'Motion verified: loop style changes detected over 2000ms'
          : 'Element showed no change over 2000ms'
      });
    }
  }

  // 3. Scroll: sample before and after scrollIntoView + 1,500 ms
  for (const a of scrollAnchors) {
    const isLowConfidence = a.entry.confidence === 'low';
    const before = await getElementStyles(page, a.id);

    if (!before) {
      resultsMap.set(a.id, {
        id: a.id,
        pass: false,
        lowConfidence: isLowConfidence,
        detail: `Element [data-motion="${a.id}"] not found on page`
      });
      continue;
    }

    try {
      await page.evaluate((id: string) => {
        const el = document.querySelector(`[data-motion="${id}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, a.id);
    } catch (err: any) {
      resultsMap.set(a.id, {
        id: a.id,
        pass: false,
        lowConfidence: isLowConfidence,
        detail: `scrollIntoView failed for [data-motion="${a.id}"]: ${err.message || String(err)}`
      });
      continue;
    }

    await sleep(1500);

    const after = await getElementStyles(page, a.id);
    if (!after) {
      resultsMap.set(a.id, {
        id: a.id,
        pass: false,
        lowConfidence: isLowConfidence,
        detail: `Element [data-motion="${a.id}"] not found after scroll`
      });
      continue;
    }

    const pass = movedTowards(a.entry, before, after);
    resultsMap.set(a.id, {
      id: a.id,
      pass,
      lowConfidence: isLowConfidence,
      detail: pass
        ? 'Motion verified: element moved towards target on scroll'
        : `Element did not move towards target on scroll (before: ${JSON.stringify(before)}, after: ${JSON.stringify(after)})`
    });
  }

  // 4. Hover: sample before and after page.hover
  for (const a of hoverAnchors) {
    const isLowConfidence = a.entry.confidence === 'low';

    // Move mouse away so initial unhovered state is captured
    await page.mouse.move(0, 0).catch(() => {});
    await sleep(100);

    const before = await getElementStyles(page, a.id);

    if (!before) {
      resultsMap.set(a.id, {
        id: a.id,
        pass: false,
        lowConfidence: isLowConfidence,
        detail: `Element [data-motion="${a.id}"] not found on page`
      });
      continue;
    }

    try {
      await page.hover(`[data-motion="${a.id}"]`);
    } catch (err: any) {
      resultsMap.set(a.id, {
        id: a.id,
        pass: false,
        lowConfidence: isLowConfidence,
        detail: `page.hover failed for [data-motion="${a.id}"]: ${err.message || String(err)}`
      });
      continue;
    }

    const hoverWaitMs = Math.min(1500, Math.max(300, a.entry.durationMs ?? 300));
    await sleep(hoverWaitMs);

    // Sample while still hovered!
    const after = await getElementStyles(page, a.id);

    // Move mouse away after sampling `after`
    await page.mouse.move(0, 0).catch(() => {});

    if (!after) {
      resultsMap.set(a.id, {
        id: a.id,
        pass: false,
        lowConfidence: isLowConfidence,
        detail: `Element [data-motion="${a.id}"] not found after hover`
      });
      continue;
    }

    const pass = movedTowards(a.entry, before, after);
    resultsMap.set(a.id, {
      id: a.id,
      pass,
      lowConfidence: isLowConfidence,
      detail: pass
        ? 'Motion verified: element moved towards target on hover'
        : `Element did not move towards target on hover (before: ${JSON.stringify(before)}, after: ${JSON.stringify(after)})`
    });
  }

  return anchors.map((a) => {
    return (
      resultsMap.get(a.id) ?? {
        id: a.id,
        pass: false,
        lowConfidence: a.entry?.confidence === 'low',
        detail: `Check not run for [data-motion="${a.id}"]`
      }
    );
  });
}
