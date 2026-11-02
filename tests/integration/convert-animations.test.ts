import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { observeAnimations } from '../../src/convert/adapters/framer/animations.js';

let browser: Browser;
let page: Page;
before(async () => {
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  page = await browser.newPage();
  await page.setViewport({ width: 800, height: 600 });
});
after(async () => {
  await browser?.close();
});

const HTML = `<!doctype html><html><head><style>
body { margin: 0; }
[data-framer-name="Fade"], [data-framer-name="Reveal"] { height: 50px; opacity: 0; transition: opacity 600ms linear; }
[data-framer-name="Fade"].on, [data-framer-name="Reveal"].on { opacity: 1; }
button { display: block; width: 100px; height: 40px; transition: transform 200ms linear; }
button:hover { transform: scale(1.2); }
[data-framer-name="Spinner"] { width: 40px; height: 40px; animation: mv 1s linear infinite; }
@keyframes mv { from { transform: translateX(0); } to { transform: translateX(100px); } }
#spacer { height: 3000px; }
#end { height: 1000px; }
</style></head><body>
<div data-framer-name="Fade"></div>
<button data-framer-name="HoverButton">Go</button>
<div data-framer-name="Spinner"></div>
<div id="spacer"></div>
<div data-framer-name="Reveal"></div>
<div id="end"></div>
<script>
setTimeout(() => document.querySelector('[data-framer-name="Fade"]').classList.add('on'), 500);
new IntersectionObserver((entries, obs) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add('on'); obs.unobserve(e.target); }
}).observe(document.querySelector('[data-framer-name="Reveal"]'));
</script></body></html>`;

test('observeAnimations records appear, scroll, hover and loop animations', async () => {
  await page.setContent(HTML);
  const entries = await observeAnimations(page, '/');
  const by = (t: string) => entries.filter((e) => e.trigger === t);

  assert.equal(entries.length, 4, JSON.stringify(entries, null, 1));
  for (const t of ['appear', 'scroll', 'hover', 'loop']) assert.equal(by(t).length, 1, t);

  const appear = by('appear')[0];
  assert.equal(appear.selector, '[data-framer-name="Fade"]');
  assert.equal(appear.framerName, 'Fade');
  assert.equal(appear.route, '/');
  assert.equal(appear.from.opacity, '0');
  assert.equal(appear.to.opacity, '1');
  assert.ok(appear.durationMs! >= 450 && appear.durationMs! <= 800, `duration ${appear.durationMs}`);

  const scroll = by('scroll')[0];
  assert.equal(scroll.selector, '[data-framer-name="Reveal"]');
  assert.equal(scroll.to.opacity, '1');

  const hover = by('hover')[0];
  assert.equal(hover.selector, '[data-framer-name="HoverButton"]');
  assert.ok(hover.to.transform && hover.to.transform !== 'none');

  assert.equal(by('loop')[0].selector, '[data-framer-name="Spinner"]');
});
