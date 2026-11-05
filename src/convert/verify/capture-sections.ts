import { PNG } from 'pngjs';
import type { Page } from 'puppeteer';
import type { Box } from '../types.js';
import { crop } from './diff.js';
import { extractSectionDom, type SectionDom } from './dom-check.js';
import { prepareCapture } from './env.js';
import { settleNext, withVerifyFlag } from './settle.js';

export interface SectionCapture {
  png: PNG;
  box: Box;
  dom: SectionDom;
}

/**
 * Capture sections on a generated Next.js page at a specific viewport width.
 *
 * 1. Sets viewport to `width × 900`
 * 2. Prepares page for deterministic capture (clock freeze, reduced motion)
 * 3. Navigates to `url` with `?__verify=1`
 * 4. Settles the page (freeze CSS, scroll through, gsap progress, network idle)
 * 5. Locates `[data-section="<name>"]` for each name to extract bounding boxes
 * 6. Extracts visible DOM using `extractSectionDom`
 * 7. Takes one full-page screenshot and crops PNG per section
 * 8. Missing or zero-size sections are omitted from the returned Map
 */
export async function capturePageSections(
  page: Page,
  url: string,
  width: number,
  names: string[],
  timeoutMs = 60_000
): Promise<Map<string, SectionCapture>> {
  await page.setViewport({ width, height: 900 });
  await prepareCapture(page);

  const target = withVerifyFlag(url);
  await page.goto(target, { waitUntil: 'load', timeout: timeoutMs });
  await settleNext(page);

  const boxes = (await page.evaluate(
    `((names) => {
      const box = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height };
      };
      return names.map((name) => {
        let el = null;
        try {
          const escaped = (window.CSS && window.CSS.escape)
            ? window.CSS.escape(name)
            : name.replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"');
          el = document.querySelector('[data-section="' + escaped + '"]');
        } catch (e) {}
        if (!el && name.includes('/')) {
          try {
            const root = name.split('/')[0];
            const escaped = (window.CSS && window.CSS.escape)
              ? window.CSS.escape(root)
              : root.replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"');
            el = document.querySelector('[data-section="' + escaped + '"]');
          } catch (e) {}
        }
        return { name, box: box(el) };
      });
    })(${JSON.stringify(names)})`
  )) as Array<{ name: string; box: Box | null }>;

  const sectionSelectors = names.map((name) => {
    const escaped = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    if (name.includes('/')) {
      const rootEscaped = name.split('/')[0].replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      return {
        name,
        selector: `[data-section="${escaped}"], [data-section="${rootEscaped}"]`
      };
    }
    return {
      name,
      selector: `[data-section="${escaped}"]`
    };
  });

  const doms = await extractSectionDom(page, sectionSelectors);
  const domMap = new Map<string, SectionDom>(doms.map((d) => [d.name, d]));

  const screenshotBuffer = await page.screenshot({ type: 'png', fullPage: true });
  const fullPng = PNG.sync.read(Buffer.from(screenshotBuffer));

  const result = new Map<string, SectionCapture>();

  for (const { name, box } of boxes) {
    if (!box || box.width <= 0 || box.height <= 0) {
      continue;
    }
    const cropped = crop(fullPng, box);
    const dom = domMap.get(name) ?? { name, text: '', links: [], images: [] };
    result.set(name, { png: cropped, box, dom });
  }

  return result;
}
