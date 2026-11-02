import type { Page } from 'puppeteer';
import { settleExport, settleNext, withVerifyFlag } from './settle.js';

export interface CaptureResult {
  png: Buffer;
  sections: Array<{ name: string; box: { x: number; y: number; width: number; height: number } }>;
}

type Box = CaptureResult['sections'][number]['box'];

/**
 * Load `url` at `width × 900`, settle it and take a full-page screenshot plus document-space section boxes.
 * Export mode boxes the adapter-defined `sections` (required); next mode boxes every `[data-section]` element.
 * Sections with a zero-width or zero-height box are dropped.
 */
export async function capturePage(
  page: Page,
  url: string,
  width: number,
  mode: 'export' | 'next',
  sections?: Array<{ name: string; selector: string }>
): Promise<CaptureResult> {
  if (mode === 'export' && !sections) throw new Error('capturePage: export mode requires the page sections');
  await page.setViewport({ width, height: 900 });
  await page.goto(mode === 'next' ? withVerifyFlag(url) : url, { waitUntil: 'load', timeout: 60_000 });
  if (mode === 'next') await settleNext(page);
  else await settleExport(page);

  const boxes = (await page.evaluate(
    `((mode, sections) => {
      const box = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height };
      };
      if (mode === 'next') {
        return Array.from(document.querySelectorAll('[data-section]')).map((el) => ({
          name: el.getAttribute('data-section') || '',
          box: box(el)
        }));
      }
      return sections.map((s) => {
        let el = null;
        try { el = document.querySelector(s.selector); } catch (e) {}
        return { name: s.name, box: box(el) };
      });
    })(${JSON.stringify(mode)}, ${JSON.stringify(sections ?? [])})`
  )) as Array<{ name: string; box: Box | null }>;

  const png = Buffer.from(await page.screenshot({ type: 'png', fullPage: true }));
  return {
    png,
    sections: boxes
      .filter((s): s is { name: string; box: Box } => !!s.box && s.box.width > 0 && s.box.height > 0)
      .map((s) => ({ name: s.name, box: s.box }))
  };
}
