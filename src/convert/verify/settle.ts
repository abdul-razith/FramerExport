import type { Page } from 'puppeteer';

const FREEZE_CSS = '*{animation-duration:0s!important;transition-duration:0s!important}';
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function freezeCss(page: Page): Promise<void> {
  await page.addStyleTag({ content: FREEZE_CSS });
}

/** Scroll to the bottom in 250 px steps (triggering in-view effects), then back to the top. */
export async function scrollThrough(page: Page): Promise<void> {
  for (let y = 250; ; y += 250) {
    const max = (await page.evaluate(
      'Math.max(0, document.documentElement.scrollHeight - window.innerHeight)'
    )) as number;
    const pos = Math.min(y, max);
    await page.evaluate(`window.scrollTo(0, ${pos})`);
    await sleep(50);
    if (pos >= max) break;
  }
  await page.evaluate('window.scrollTo(0, 0)');
}

export async function fontsAndNetworkIdle(page: Page): Promise<void> {
  await page.evaluate('document.fonts.ready.then(() => true)');
  // Pages with long-polling or analytics may never go fully idle; settle for what we get.
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 10_000 }).catch(() => {});
}

/** Navigate to the current URL with `?__verify=1` if it is not already present. */
export function withVerifyFlag(url: string): string {
  const u = new URL(url);
  if (!u.searchParams.has('__verify')) u.searchParams.set('__verify', '1');
  return u.toString();
}

/** Settle a generated Next.js page: verify flag (skips motion, exposes gsap), frozen CSS, scroll, gsap to end. */
export async function settleNext(page: Page): Promise<void> {
  const target = withVerifyFlag(page.url());
  if (target !== page.url()) await page.goto(target, { waitUntil: 'load', timeout: 60_000 });
  await freezeCss(page);
  await scrollThrough(page);
  await page.evaluate('window.gsap?.globalTimeline.progress(1)');
  await fontsAndNetworkIdle(page);
}

/** Settle an exported Framer page: frozen CSS, scroll through, let JS appear effects finish. */
export async function settleExport(page: Page): Promise<void> {
  await freezeCss(page);
  await scrollThrough(page);
  await sleep(1500);
  await fontsAndNetworkIdle(page);
}
