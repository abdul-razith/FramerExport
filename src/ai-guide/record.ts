import fs from 'node:fs/promises';
import path from 'node:path';
import type { Browser, Page } from 'puppeteer';
import { settlePage } from '../nextjs/capture.js';
import { needsMoreTime } from './motion.js';
import type { TimelineSample } from './types.js';

export interface RecordResult {
  samples: TimelineSample[];
  midSamples: TimelineSample[];
  loadFrames: number;
  scrollFrames: number;
}

/**
 * Runs in the page. Every `every` ms until `untilMs` (page time, from navigation start), stores the
 * opacity, transform and own text of every visible element in `window[store]`, keyed like the
 * capture's serializeInPage: `tag[framerName]:index` segments from `body:0`. Sampling inside the
 * page keeps the 200 ms rhythm exact; screenshots from outside are far slower.
 */
function installSampler(every: number, untilMs: number, store: string, fromNow: boolean): void {
  const w = window as unknown as Record<string, unknown>;
  const samples: { t: number; values: Record<string, { opacity: string; transform: string; text: string }> }[] = [];
  w[store] = samples;
  const origin = fromNow ? performance.now() : 0;
  const skip = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE', 'IFRAME']);
  const sample = () => {
    const out: Record<string, { opacity: string; transform: string; text: string }> = {};
    const walk = (el: Element, key: string) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none') return;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        let text = '';
        for (const c of Array.from(el.childNodes)) if (c.nodeType === 3) text += c.textContent ?? '';
        out[key] = { opacity: cs.opacity, transform: cs.transform, text: text.replace(/\s+/g, ' ').trim().slice(0, 80) };
      }
      if (el.tagName.toLowerCase() === 'svg') return;
      Array.from(el.children).forEach((c, i) => {
        if (skip.has(c.tagName)) return;
        const name = c.getAttribute('data-framer-name');
        walk(c, `${key}/${c.tagName.toLowerCase()}${name ? `[${name}]` : ''}:${i}`);
      });
    };
    if (document.body) walk(document.body, 'body:0');
    return out;
  };
  const tick = () => {
    const t = Math.round(performance.now() - origin);
    if (t > untilMs) return;
    samples.push({ t, values: sample() });
    setTimeout(tick, every);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tick);
  else tick();
}

/** Drops keys that never change, so the samples stay small. */
function changingOnly(samples: TimelineSample[]): TimelineSample[] {
  const changing = new Set<string>();
  const first = samples[0]?.values ?? {};
  for (const s of samples.slice(1)) {
    for (const [k, v] of Object.entries(s.values)) {
      const f = first[k];
      if (!f || f.opacity !== v.opacity || f.transform !== v.transform || f.text !== v.text) changing.add(k);
    }
  }
  return samples.map((s) => ({ t: s.t, values: Object.fromEntries(Object.entries(s.values).filter(([k]) => changing.has(k))) }));
}

const pad = (n: number) => String(n).padStart(3, '0');

/**
 * Streams frames with Chrome's screencast (screenshots take ~1 s each, far too slow for a 200 ms
 * rhythm) until `ms` has passed since `startedAt`; keeps the first frame of each `every`-ms slot.
 */
async function shoot(page: Page, dir: string, ms: number, every: number, startedAt: number): Promise<number> {
  await fs.mkdir(dir, { recursive: true });
  const cdp = await page.createCDPSession();
  const taken = new Set<number>();
  const writes: Promise<void>[] = [];
  cdp.on('Page.screencastFrame', (f: { data: string; sessionId: number }) => {
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => undefined);
    const slot = Math.round((Date.now() - startedAt) / every);
    if (taken.has(slot) || Date.now() - startedAt > ms) return;
    taken.add(slot);
    writes.push(fs.writeFile(path.join(dir, `${pad(slot)}.jpg`), Buffer.from(f.data, 'base64')));
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, everyNthFrame: 1 });
  const left = ms - (Date.now() - startedAt);
  if (left > 0) await new Promise((r) => setTimeout(r, left));
  await cdp.send('Page.stopScreencast').catch(() => undefined);
  await Promise.all(writes);
  await cdp.detach().catch(() => undefined);
  return taken.size;
}

/** Records how a page moves: 6–12 s after load (longer while it still moves), a pass of scroll frames, and 2 s mid-page. */
export async function recordPage(
  browser: Browser,
  url: string,
  outDir: string,
  opts: { loadMs?: number; maxLoadMs?: number; frameEveryMs?: number } = {}
): Promise<RecordResult> {
  const loadMs = opts.loadMs ?? 6000;
  const maxLoadMs = Math.max(loadMs, opts.maxLoadMs ?? 12000);
  const every = opts.frameEveryMs ?? 200;
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1440, height: 900 });
    // Bundlers (tsx/esbuild keepNames) wrap named functions in __name(), which the page lacks.
    await page.evaluateOnNewDocument('globalThis.__name = (fn) => fn;');
    await page.evaluateOnNewDocument(installSampler, every, maxLoadMs, '__aiGuideLoad', false);
    const startedAt = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    const loadDir = path.join(outDir, 'frames', 'load');
    const readLoad = async () =>
      ((await page.evaluate(() => (window as unknown as Record<string, unknown>).__aiGuideLoad)) as TimelineSample[] | undefined) ?? [];
    let loadFrames = await shoot(page, loadDir, loadMs, every, startedAt);
    // Keep recording while the page still moves (a long loader delays every entrance after it).
    for (let until = loadMs + 2000; until <= maxLoadMs && needsMoreTime(await readLoad(), Date.now() - startedAt, maxLoadMs); until += 2000) {
      loadFrames += await shoot(page, loadDir, until, every, startedAt);
    }
    await new Promise((r) => setTimeout(r, every * 2));
    const load = (await readLoad()).filter((s) => s.t <= Date.now() - startedAt);

    await settlePage(page);
    const scrollDir = path.join(outDir, 'frames', 'scroll');
    await fs.mkdir(scrollDir, { recursive: true });
    const height = await page.evaluate(() => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight));
    let scrollFrames = 0;
    for (let y = 0; y < height; y += 450) {
      await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
      await new Promise((r) => setTimeout(r, 400));
      await page.screenshot({ path: path.join(scrollDir, `${pad(scrollFrames++)}.png`) as `${string}.png` });
    }

    await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), Math.max(0, height / 2 - 450));
    await new Promise((r) => setTimeout(r, 600));
    await page.evaluate(installSampler, every, 2000, '__aiGuideMid', true);
    await shoot(page, path.join(outDir, 'frames', 'loop'), 2000, every, Date.now());
    await new Promise((r) => setTimeout(r, every * 2));
    const mid = (await page.evaluate(() => (window as unknown as Record<string, unknown>).__aiGuideMid)) as TimelineSample[];

    return { samples: changingOnly(load ?? []), midSamples: changingOnly(mid ?? []), loadFrames, scrollFrames };
  } finally {
    await page.close().catch(() => undefined);
  }
}
