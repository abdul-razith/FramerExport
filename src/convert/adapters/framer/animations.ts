import type { Page } from 'puppeteer';
import type { AnimationEntry } from '../../types.js';
import { warn } from '../../../logger/index.js';

type Snap = string[]; // per element: opacity, transform, filter, clip-path joined by SEP
interface Sample {
  t: number;
  snap: Snap;
}

const PROP_NAMES = ['opacity', 'transform', 'filter', 'clip-path'];
const SEP = '|~|';
const MAX_ELEMENTS = 2000;
const MAX_HOVER = 40;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Page-side helper, installed as a string so transpiler helpers never leak into the page.
const SETUP = String.raw`(() => {
  const re = /(^|\s)framer-[A-Za-z0-9_-]{4,}(\s|$)/;
  const els = [];
  const seen = new Set();
  const add = (el) => { if (!seen.has(el) && els.length < ${MAX_ELEMENTS}) { seen.add(el); els.push(el); } };
  const hover = [];
  for (const el of document.querySelectorAll('a, button, [data-framer-name*="Button"]')) {
    if (hover.length >= ${MAX_HOVER}) break;
    add(el);
    hover.push(els.indexOf(el));
  }
  let skipped = 0;
  for (const el of document.querySelectorAll('*')) {
    if (seen.has(el)) continue;
    if (el.hasAttribute('data-framer-name') || re.test(el.getAttribute('class') || '')) {
      if (els.length < ${MAX_ELEMENTS}) add(el); else skipped++;
    }
  }
  const esc = (v) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const attrSel = (el) => {
    const n = el.getAttribute('data-framer-name');
    if (!n) return null;
    const s = '[data-framer-name="' + esc(n) + '"]';
    return document.querySelectorAll(s).length === 1 ? s : null;
  };
  const selector = (el) => {
    const own = attrSel(el);
    if (own) return own;
    let path = '';
    let cur = el;
    while (cur && cur !== document.documentElement) {
      const a = cur !== el ? attrSel(cur) : null;
      if (a) { path = path ? a + ' > ' + path : a; break; }
      const parent = cur.parentElement;
      const idx = parent ? Array.prototype.indexOf.call(parent.children, cur) + 1 : 1;
      const seg = cur.tagName.toLowerCase() + ':nth-child(' + idx + ')';
      path = path ? seg + ' > ' + path : seg;
      if (cur === document.body) break;
      let match = null;
      try { const found = document.querySelectorAll(path); if (found.length === 1) match = found[0]; } catch (e) {}
      if (match === el) break;
      cur = parent;
    }
    return path;
  };
  const one = (el) => {
    const cs = getComputedStyle(el);
    return [cs.opacity, cs.transform, cs.filter, cs.clipPath].join('${SEP}');
  };
  window.__fx = {
    els,
    hover,
    count: els.length,
    snap: () => els.map(one),
    snapOne: (i) => one(els[i]),
    inView: () => {
      const out = [];
      for (let i = 0; i < els.length; i++) {
        const r = els[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth) out.push(i);
      }
      return out;
    },
    meta: (idx) => idx.map((i) => ({ selector: selector(els[i]), name: els[i].getAttribute('data-framer-name') })),
    maxScroll: () => Math.max(0, document.documentElement.scrollHeight - innerHeight),
  };
  return { count: els.length, skipped };
})()`;

interface Change {
  from: Record<string, string>;
  to: Record<string, string>;
  durationMs: number;
  delayMs: number;
  confidence: 'high' | 'low';
}

/** Analyse a series for one element; series[0] is the baseline. Samples after endT are ignored. */
function analyse(series: Array<{ t: number; v: string }>, startT: number, endT: number): Change | null {
  const s = series.filter((x, i) => i === 0 || x.t <= endT);
  if (s.length < 2) return null;
  const base = s[0].v.split(SEP);
  const last = s[s.length - 1].v.split(SEP);
  const from: Record<string, string> = {};
  const to: Record<string, string> = {};
  PROP_NAMES.forEach((name, k) => {
    if (base[k] !== last[k]) {
      from[name] = base[k];
      to[name] = last[k];
    }
  });
  if (Object.keys(to).length === 0) return null;
  let first = -1;
  let lastIdx = -1;
  let count = 0;
  for (let i = 1; i < s.length; i++) {
    if (s[i].v !== s[i - 1].v) {
      if (first < 0) first = i;
      lastIdx = i;
      count++;
    }
  }
  if (first < 0) return null;
  return {
    from,
    to,
    durationMs: Math.round(s[lastIdx].t - s[first - 1].t),
    delayMs: Math.max(0, Math.round(s[first - 1].t - startT)),
    confidence: count >= 3 ? 'high' : 'low',
  };
}

export async function observeAnimations(page: Page, route: string): Promise<AnimationEntry[]> {
  await sleep(300);
  const entries: AnimationEntry[] = [];
  try {
    const setup = (await page.evaluate(SETUP)) as { count: number; skipped: number };
    const count = setup.count;
    if (setup.skipped > 0) {
      warn(`animations: ${route}: tracked ${count} elements, skipped ${setup.skipped} beyond the ${MAX_ELEMENTS} cap`);
    }
    if (!count) return [];
    const takeSnap = async (): Promise<Sample> => {
      const snap = (await page.evaluate('window.__fx.snap()')) as Snap;
      return { t: performance.now(), snap };
    };
    const seriesFor = (samples: Sample[], i: number) => samples.map((s) => ({ t: s.t, v: s.snap[i] }));

    const baseline = await takeSnap();
    const inViewAtLoad = new Set((await page.evaluate('window.__fx.inView()')) as number[]);

    // Appear: sample every 50 ms for 1500 ms.
    const appearSamples: Sample[] = [baseline];
    while (performance.now() - baseline.t < 1500) {
      await sleep(50);
      appearSamples.push(await takeSnap());
    }

    // Loop: 4 samples of transform at 250 ms intervals, no interaction.
    const loopSamples: Sample[] = [await takeSnap()];
    for (let k = 0; k < 3; k++) {
      await sleep(250);
      loopSamples.push(await takeSnap());
    }
    const loopSet = new Set<number>();
    const found: Array<{ i: number; trigger: AnimationEntry['trigger']; c: Change }> = [];
    for (let i = 0; i < count; i++) {
      const tf = loopSamples.map((s) => s.snap[i].split(SEP)[1]);
      if (tf.every((v, k) => k === 0 || v !== tf[k - 1])) {
        loopSet.add(i);
        found.push({
          i,
          trigger: 'loop',
          c: { from: { transform: tf[0] }, to: { transform: tf[tf.length - 1] }, durationMs: 0, delayMs: 0, confidence: 'high' },
        });
      }
    }

    for (const i of inViewAtLoad) {
      if (loopSet.has(i)) continue;
      const c = analyse(seriesFor(appearSamples, i), baseline.t, Infinity);
      if (c) found.push({ i, trigger: 'appear', c });
    }

    // Scroll: 250 px steps, 50 ms wait, track elements newly in viewport.
    const maxScroll = (await page.evaluate('window.__fx.maxScroll()')) as number;
    const scrollSamples: Sample[] = [await takeSnap()];
    const entered = new Map<number, number>();
    const seen = new Set(inViewAtLoad);
    for (let y = 250; ; y += 250) {
      const pos = Math.min(y, maxScroll);
      await page.evaluate(`window.scrollTo(0, ${pos})`);
      await sleep(50);
      scrollSamples.push(await takeSnap());
      const now = (await page.evaluate('window.__fx.inView()')) as number[];
      const t = performance.now();
      for (const i of now) {
        if (!seen.has(i)) {
          seen.add(i);
          if (!loopSet.has(i)) entered.set(i, t);
        }
      }
      if (pos >= maxScroll) break;
    }
    if (entered.size) {
      const deadline = Math.max(...entered.values()) + 1500;
      while (performance.now() < deadline) {
        await sleep(50);
        scrollSamples.push(await takeSnap());
      }
    }
    for (const [i, t] of entered) {
      const c = analyse(seriesFor(scrollSamples, i), t, t + 1500);
      if (c) found.push({ i, trigger: 'scroll', c });
    }

    // Hover: up to 40 candidates; hover, wait 400 ms (sampled every 50 ms), diff.
    await page.evaluate('window.scrollTo(0, 0)');
    await sleep(100);
    const hoverIdx = [...new Set((await page.evaluate('window.__fx.hover')) as number[])].filter((i) => !loopSet.has(i));
    for (const i of hoverIdx) {
      try {
        const handle = await page.evaluateHandle(`window.__fx.els[${i}]`);
        const el = handle.asElement() as import('puppeteer').ElementHandle<Element> | null;
        if (!el) continue;
        const before = (await page.evaluate(`window.__fx.snapOne(${i})`)) as string;
        const series = [{ t: performance.now(), v: before }];
        await el.hover();
        const t0 = performance.now();
        while (performance.now() - t0 < 400) {
          await sleep(50);
          series.push({ t: performance.now(), v: (await page.evaluate(`window.__fx.snapOne(${i})`)) as string });
        }
        await handle.dispose();
        const c = analyse(series, series[0].t, Infinity);
        if (c) found.push({ i, trigger: 'hover', c });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/not visible|not clickable|not an HTMLElement|detached|Node is detached|Execution context was destroyed/i.test(msg)) throw err;
        // expected per-element failure (hidden, detached); skip
      }
    }
    await page.mouse.move(0, 0);

    const idx = [...new Set(found.map((f) => f.i))];
    const meta = (await page.evaluate(`window.__fx.meta(${JSON.stringify(idx)})`)) as Array<{
      selector: string;
      name: string | null;
    }>;
    const metaOf = new Map(idx.map((i, k) => [i, meta[k]]));
    for (const f of found) {
      const m = metaOf.get(f.i)!;
      const entry: AnimationEntry = {
        route,
        selector: m.selector,
        trigger: f.trigger,
        from: f.c.from,
        to: f.c.to,
        confidence: f.c.confidence,
      };
      if (m.name) entry.framerName = m.name;
      if (f.trigger !== 'loop') entry.durationMs = f.c.durationMs;
      if (f.trigger === 'appear' || f.trigger === 'scroll') entry.delayMs = f.c.delayMs;
      entries.push(entry);
    }
  } finally {
    await page.evaluate('delete window.__fx').catch(() => {});
  }
  return entries;
}
