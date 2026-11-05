import type { Page } from 'puppeteer';

export interface FilmstripOptions {
  delays?: number[];
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Capture a series of filmstrip frames for a URL:
 * - Frames at 0 ms, 300 ms, 600 ms after load (or custom delays)
 * - Remaining frames (default 3) at progressive scroll positions down the document.
 */
export async function captureFilmstrip(
  page: Page,
  url: string,
  width: number,
  frames = 6,
  opts?: FilmstripOptions
): Promise<Buffer[]> {
  const sleepFn = opts?.sleep ?? defaultSleep;
  const delays = opts?.delays ?? [0, 300, 300];

  await page.setViewport({ width, height: 900 });
  await page.goto(url, { waitUntil: 'load', timeout: 60_000 });

  const result: Buffer[] = [];

  // Time-based frames
  const timeFramesCount = Math.min(3, frames);
  for (let i = 0; i < timeFramesCount; i++) {
    const delay = delays[i] ?? 300;
    if (delay > 0) {
      await sleepFn(delay);
    }
    const buf = Buffer.from(await page.screenshot({ type: 'png' }));
    result.push(buf);
  }

  // Scroll-based frames
  const scrollCount = frames - result.length;
  if (scrollCount > 0) {
    const maxScroll = await page.evaluate(() => {
      const docHeight = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
        document.body.offsetHeight,
        document.documentElement.offsetHeight
      );
      return Math.max(0, docHeight - window.innerHeight);
    });

    for (let i = 0; i < scrollCount; i++) {
      const fraction = (i + 1) / (scrollCount + 1);
      const scrollY = Math.round(fraction * maxScroll);
      await page.evaluate((y) => window.scrollTo(0, y), scrollY);
      await sleepFn(50);
      const buf = Buffer.from(await page.screenshot({ type: 'png' }));
      result.push(buf);
    }
  }

  return result;
}
