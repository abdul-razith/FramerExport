import fs from 'node:fs/promises';
import path from 'node:path';
import type { Browser, Page } from 'puppeteer';
import { settlePage } from '../nextjs/capture.js';
import type { TimelineSample } from './types.js';

export interface RecordResult {
  samples: TimelineSample[];
  midSamples: TimelineSample[];
  loadFrames: number;
  scrollFrames: number;
}

/**
 * Opacity, transform and own text of every visible element, keyed like the capture's
 * serializeInPage: `tag[framerName]:index` segments from `body:0`, index = position among the
 * parent's element children.
 */
function sampleInPage(): TimelineSample['values'] {
  const out: TimelineSample['values'] = {};
  const skip = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE', 'IFRAME']);
  const walk = (el: Element, key: string) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      let text = '';
      for (const c of Array.from(el.childNodes)) if (c.nodeType === Node.TEXT_NODE) text += c.textContent ?? '';
      out[key] = { opacity: cs.opacity, transform: cs.transform, text: text.replace(/\s+/g, ' ').trim().slice(0, 80) };
    }
    if (el.tagName.toLowerCase() === 'svg') return;
    Array.from(el.children).forEach((c, i) => {
      if (skip.has(c.tagName)) return;
      const name = c.getAttribute('data-framer-name');
      walk(c, `${key}/${c.tagName.toLowerCase()}${name ? `[${name}]` : ''}:${i}`);
    });
  };
  walk(document.body, 'body:0');
  return out;
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

async function recordWindow(page: Page, dir: string, ms: number, every: number, startedAt: number): Promise<TimelineSample[]> {
  await fs.mkdir(dir, { recursive: true });
  const samples: TimelineSample[] = [];
  const begin = Date.now();
  for (let i = 0; Date.now() - begin < ms; i++) {
    const due = begin + i * every;
    if (Date.now() < due) await new Promise((r) => setTimeout(r, due - Date.now()));
    const t = Date.now() - startedAt;
    await page.screenshot({ path: path.join(dir, `${pad(i)}.png`) as `${string}.png` }).catch(() => undefined);
    const values = await page.evaluate(sampleInPage).catch(() => ({}));
    samples.push({ t, values });
  }
  return samples;
}

/** Records how a page moves: the first seconds after load, a pass of scroll frames, and 2 s mid-page. */
export async function recordPage(
  browser: Browser,
  url: string,
  outDir: string,
  opts: { loadMs?: number; frameEveryMs?: number } = {}
): Promise<RecordResult> {
  const loadMs = opts.loadMs ?? 6000;
  const every = opts.frameEveryMs ?? 200;
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1440, height: 900 });
    const startedAt = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    const load = await recordWindow(page, path.join(outDir, 'frames', 'load'), loadMs, every, startedAt);

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
    const midStart = Date.now();
    const mid = await recordWindow(page, path.join(outDir, 'frames', 'loop'), 2000, every, midStart);

    return { samples: changingOnly(load), midSamples: changingOnly(mid), loadFrames: load.length, scrollFrames };
  } finally {
    await page.close().catch(() => undefined);
  }
}
