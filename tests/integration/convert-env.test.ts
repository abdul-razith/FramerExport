import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { extractSectionDom } from '../../src/convert/verify/dom-check.js';
import { FIXED_TIME, prepareCapture } from '../../src/convert/verify/env.js';

let browser: Browser;
let page: Page;

before(async () => {
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  page = await browser.newPage();
});

after(async () => {
  await browser?.close();
});

test('prepareCapture locks client clock and enables prefers-reduced-motion', async () => {
  await prepareCapture(page);
  await page.goto(
    `data:text/html,<!DOCTYPE html><html><body><script>
      window.__snapshot = {
        iso: new Date().toISOString(),
        now: Date.now(),
        motion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        custom: new Date(Date.UTC(2020, 0, 1)).toISOString()
      };
    </script></body></html>`
  );

  const snapshot = await page.evaluate(
    'window.__snapshot'
  ) as { iso: string; now: number; motion: boolean; custom: string };

  assert.equal(snapshot.iso, '2026-01-01T12:00:00.000Z');
  assert.equal(snapshot.now, FIXED_TIME);
  assert.equal(snapshot.now, 1767268800000);
  assert.equal(snapshot.motion, true);
  assert.equal(snapshot.custom, '2020-01-01T00:00:00.000Z');
});

test('extractSectionDom counts only visible elements (display:none omitted)', async () => {
  await page.setContent(`
    <div data-section="Content">
      <a href="/visible-link">Visible Link</a>
      <a href="/hidden-link" style="display:none">Hidden Link</a>
      <div style="display:none">
        <a href="/nested-hidden">Nested Hidden Link</a>
      </div>
      <img src="http://127.0.0.1:5/visible.png" alt="vis">
      <img src="http://127.0.0.1:5/hidden.png" style="display:none" alt="hid">
    </div>
  `);

  const sections = [{ name: 'Content', selector: '[data-section="Content"]' }];
  const dom = await extractSectionDom(page, sections);

  assert.equal(dom.length, 1);
  assert.deepEqual(dom[0].links, ['/visible-link']);
  assert.equal(dom[0].images.length, 1);
  assert.ok(dom[0].images[0].includes('visible.png'));
});
