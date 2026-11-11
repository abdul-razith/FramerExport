import fs from 'node:fs/promises';
import path from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import type { Browser, ElementHandle, Page } from 'puppeteer';
import { slugify } from './outline.js';

/** A hover or click that visibly changed a section, with its before/after screenshots. */
export interface InteractionState {
  /** Section id (`03`, `S1`). */
  section: string;
  /** Readable element name (its Framer layer name, else its class). */
  element: string;
  action: 'hover' | 'click';
  /** Paths relative to `outDir` (`states/<element>-<action>-before.png`). */
  before: string;
  after: string;
}

export interface InteractionTarget {
  id: string;
  /** Classes of the section element (the first one present on the page is used). */
  selectorClasses: string[];
  /** Classes with a `:hover` rule in the section's CSS. */
  hoverClasses: string[];
}

const MAX_PER_PAGE = 20;
const SETTLE_MS = 600;
const CHANGED = 0.005;

interface Candidate {
  index: number;
  action: 'hover' | 'click';
  name: string;
}

/** Runs in the page: the section's reacting elements, in document order (hover classes, then clickable non-links). */
function candidatesInPage(selectorClasses: string[], hoverClasses: string[]): { action: 'hover' | 'click'; name: string }[] {
  const section = selectorClasses.map((c) => document.querySelector('.' + CSS.escape(c))).find(Boolean);
  if (!section) return [];
  const all = Array.from(section.querySelectorAll('*'));
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };
  const label = (el: Element) => el.getAttribute('data-framer-name') || Array.from(el.classList).find((c) => c.startsWith('framer-')) || el.tagName.toLowerCase();
  const out: { action: 'hover' | 'click'; name: string }[] = [];
  for (const el of all) {
    if (!visible(el) || el.closest('a')) continue;
    if (hoverClasses.some((c) => el.classList.contains(c))) out.push({ action: 'hover', name: label(el) });
    else if (getComputedStyle(el).cursor === 'pointer' && !(el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer')) {
      out.push({ action: 'click', name: label(el) });
    }
  }
  return out;
}

/** The handle of candidate `index` of a section (same order as candidatesInPage). */
async function candidateHandle(page: Page, t: InteractionTarget, index: number) {
  const handle = await page.evaluateHandle(
    (selectorClasses: string[], hoverClasses: string[], i: number) => {
      const section = selectorClasses.map((c) => document.querySelector('.' + CSS.escape(c))).find(Boolean);
      if (!section) return null;
      const list: Element[] = [];
      for (const el of Array.from(section.querySelectorAll('*'))) {
        const r = el.getBoundingClientRect();
        if (!(r.width > 0 && r.height > 0) || getComputedStyle(el).visibility === 'hidden' || el.closest('a')) continue;
        if (hoverClasses.some((c) => el.classList.contains(c))) list.push(el);
        else if (getComputedStyle(el).cursor === 'pointer' && !(el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer')) list.push(el);
      }
      return list[i] ?? null;
    },
    t.selectorClasses,
    t.hoverClasses,
    index
  );
  return handle.asElement() as ElementHandle<Element> | null;
}

async function sectionShot(page: Page, t: InteractionTarget): Promise<Buffer | undefined> {
  const el = (await page.evaluateHandle((cls: string[]) => cls.map((c) => document.querySelector('.' + CSS.escape(c))).find(Boolean) ?? null, t.selectorClasses)).asElement();
  if (!el) return undefined;
  return Buffer.from(await (el as ElementHandle<Element>).screenshot({ type: 'png' }));
}

function differs(a: Buffer, b: Buffer): boolean {
  const pa = PNG.sync.read(a);
  const pb = PNG.sync.read(b);
  if (pa.width !== pb.width || pa.height !== pb.height) return true;
  const diff = pixelmatch(pa.data, pb.data, undefined, pa.width, pa.height, { threshold: 0.1 });
  return diff / (pa.width * pa.height) > CHANGED;
}

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += 600) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });
  await new Promise((r) => setTimeout(r, 800));
}

/**
 * Hovers and clicks the elements of each section that react (a `:hover` rule, or a pointer cursor on
 * something that is not a link) and keeps a before/after screenshot pair when the section visibly
 * changed. The page is reloaded before each click; links are never followed. At most 20 per page.
 */
export async function recordInteractions(browser: Browser, url: string, targets: InteractionTarget[], outDir: string, width: number): Promise<InteractionState[]> {
  const page = await browser.newPage();
  const states: InteractionState[] = [];
  try {
    await page.setViewport({ width, height: 900 });
    await page.evaluateOnNewDocument('globalThis.__name = (fn) => fn;');
    await open(page, url);
    const plan: { t: InteractionTarget; c: Candidate }[] = [];
    for (const t of targets) {
      const found = (await page.evaluate(candidatesInPage, t.selectorClasses, t.hoverClasses)) as { action: 'hover' | 'click'; name: string }[];
      found.forEach((c, index) => plan.push({ t, c: { index, ...c } }));
    }
    const used = new Set<string>();
    for (const { t, c } of plan.slice(0, MAX_PER_PAGE)) {
      try {
        if (c.action === 'click') await open(page, url);
        const handle = await candidateHandle(page, t, c.index);
        if (!handle) continue;
        await handle.scrollIntoView();
        await new Promise((r) => setTimeout(r, 300));
        const before = await sectionShot(page, t);
        if (!before) continue;
        if (c.action === 'hover') await handle.hover();
        else await handle.click();
        await new Promise((r) => setTimeout(r, SETTLE_MS));
        if (page.url().replace(/#.*$/, '') !== url.replace(/#.*$/, '')) {
          await open(page, url); // a click navigated after all: not a state of this page
          continue;
        }
        const after = await sectionShot(page, t);
        if (c.action === 'hover') await page.mouse.move(0, 0);
        if (!after || !differs(before, after)) continue;
        let base = `${slugify(c.name)}-${c.action}`;
        for (let i = 2; used.has(base); i++) base = `${slugify(c.name)}-${c.action}-${i}`;
        used.add(base);
        const files = { before: `states/${base}-before.png`, after: `states/${base}-after.png` };
        await fs.mkdir(path.join(outDir, 'states'), { recursive: true });
        await fs.writeFile(path.join(outDir, files.before), before);
        await fs.writeFile(path.join(outDir, files.after), after);
        states.push({ section: t.id, element: slugify(c.name), action: c.action, ...files });
      } catch {
        // One element that cannot be hovered or clicked does not stop the others.
      }
    }
  } finally {
    await page.close().catch(() => undefined);
  }
  return states;
}
