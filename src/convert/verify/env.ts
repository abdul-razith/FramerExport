import type { Page } from 'puppeteer';

/** Fixed UTC timestamp: 2026-01-01T12:00:00.000Z */
export const FIXED_TIME = Date.UTC(2026, 0, 1, 12, 0, 0);

const CLOCK_SCRIPT = `((fixedTime) => {
  const OrigDate = window.Date;
  function MockDate(...args) {
    if (!(this instanceof MockDate)) {
      return new OrigDate(fixedTime).toString();
    }
    if (args.length === 0) {
      return new OrigDate(fixedTime);
    }
    return new OrigDate(...args);
  }
  MockDate.prototype = OrigDate.prototype;
  Object.setPrototypeOf(MockDate, OrigDate);
  MockDate.now = () => fixedTime;
  window.Date = MockDate;
})(${FIXED_TIME})`;

/**
 * Prepares Puppeteer page for deterministic capture:
 * - Overrides `Date` and `Date.now` via `evaluateOnNewDocument` so `new Date().toISOString()` returns `2026-01-01T12:00:00.000Z`.
 * - Preserves Date constructor capabilities when arguments are passed.
 * - Emulates media features: `prefers-reduced-motion: reduce`.
 */
export async function prepareCapture(page: Page): Promise<void> {
  await page.evaluateOnNewDocument(CLOCK_SCRIPT);
  await page.evaluate(CLOCK_SCRIPT).catch(() => {});
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
}
