import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import {
  snapshotScript,
  type SnapshotPlan,
  type SnapshotOut,
} from '../../src/convert/generate/snapshot.js';

let browser: Browser;
let page: Page;

before(async () => {
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  page = await browser.newPage();
  await page.setJavaScriptEnabled(false);
});

after(async () => {
  await browser?.close();
});

function createPlan(overrides: Partial<SnapshotPlan> = {}): SnapshotPlan {
  return {
    sections: [],
    appear: [],
    hiddenMap: {},
    motion: [],
    cms: [],
    components: [],
    scriptDrawn: [],
    emptyBytes: 1000,
    oversizedBytes: 120000,
    ...overrides,
  };
}

test('transform:none inline on an element whose class sets transform: rotate(5deg) is kept; transform:none on plain element is removed; opacity:1 removed; slimmed equals removed count', async () => {
  const html = `<!doctype html><html><head>
<style>
  .rotated { transform: rotate(5deg); }
</style>
</head><body>
<div id="main">
  <div id="hero" data-section="Hero">
    <div id="el1" class="rotated" style="transform: none">Rotated</div>
    <div id="el2" style="transform: none; opacity: 1">Plain</div>
  </div>
</div>
</body></html>`;

  await page.setContent(html);

  const plan = createPlan({
    sections: [{ name: 'Hero', selector: '#hero' }],
  });

  const out = (await page.evaluate(snapshotScript(plan))) as SnapshotOut;

  assert.equal(out.slimmed, 2, 'two redundant inline properties should be removed');
  const heroSection = out.sections.find((s) => s.name === 'Hero');
  assert.ok(heroSection);
  // el1 should keep transform: "none"
  assert.match(heroSection.jsx, /"transform":\s*"none"/);
  // el2 should have had both transform and opacity removed, so no style attribute on el2
  assert.match(heroSection.jsx, /<div id="el2">/);
  assert.doesNotMatch(heroSection.jsx, /id="el2"[^>]*style=/);
});

test('two sections -> viewJsx contains exactly two <fexport-section data-name= placeholders in order; empty section stays inline in viewJsx with empty: true', async () => {
  const html = `<!doctype html><html><head></head><body>
<div id="main">
  <div id="hero"><h1>Hero Title</h1></div>
  <div id="empty"></div>
  <div id="footer"><p>Footer Content</p></div>
</div>
</body></html>`;

  await page.setContent(html);

  const plan = createPlan({
    sections: [
      { name: 'Hero', selector: '#hero' },
      { name: 'EmptySection', selector: '#empty' },
      { name: 'Footer', selector: '#footer' },
    ],
  });

  const out = (await page.evaluate(snapshotScript(plan))) as SnapshotOut;

  assert.equal(out.sections.length, 3);
  assert.equal(out.sections[0].name, 'Hero');
  assert.equal(out.sections[0].empty, false);

  assert.equal(out.sections[1].name, 'EmptySection');
  assert.equal(out.sections[1].empty, true);

  assert.equal(out.sections[2].name, 'Footer');
  assert.equal(out.sections[2].empty, false);

  // viewJsx contains exactly two <fexport-section data-name= placeholders in order
  const matches = [...out.viewJsx.matchAll(/<fexport-section data-name="([^"]+)"/g)];
  assert.equal(matches.length, 2);
  assert.equal(matches[0][1], 'Hero');
  assert.equal(matches[1][1], 'Footer');

  // Empty section div stays inline in viewJsx
  assert.match(out.viewJsx, /<div id="empty"[^>]*><\/div>/);
  assert.doesNotMatch(out.viewJsx, /<fexport-section data-name="EmptySection"/);
});

test('element with class hidden-c (map {hidden-c:[\'phone\']}) gets data-variant="desktop tablet"; section hasVariants true', async () => {
  const html = `<!doctype html><html><head></head><body>
<div id="main">
  <div id="hero">
    <div class="hidden-c">Desktop and tablet only</div>
  </div>
</div>
</body></html>`;

  await page.setContent(html);

  const plan = createPlan({
    sections: [{ name: 'Hero', selector: '#hero' }],
    hiddenMap: { 'hidden-c': ['phone'] },
  });

  const out = (await page.evaluate(snapshotScript(plan))) as SnapshotOut;
  const heroSection = out.sections.find((s) => s.name === 'Hero');
  assert.ok(heroSection);
  assert.equal(heroSection.hasVariants, true);
  assert.match(heroSection.jsx, /data-variant="desktop tablet"/);
});

test('motion selector that matches gets data-motion="m1"; unmatched motion appears in unmatchedMotion without throwing', async () => {
  const html = `<!doctype html><html><head></head><body>
<div id="main">
  <div id="hero">
    <h1 class="heading">Animated heading</h1>
  </div>
</div>
</body></html>`;

  await page.setContent(html);

  const plan = createPlan({
    sections: [{ name: 'Hero', selector: '#hero' }],
    motion: [
      { id: 'm1', selector: '.heading' },
      { id: 'm2', selector: '.unmatched-missing' },
      { id: 'm3', selector: '::malformed-selector[[' },
    ],
  });

  const out = (await page.evaluate(snapshotScript(plan))) as SnapshotOut;
  const heroSection = out.sections.find((s) => s.name === 'Hero');
  assert.ok(heroSection);
  assert.deepEqual(heroSection.motion, ['m1']);
  assert.match(heroSection.jsx, /data-motion="m1"/);

  assert.ok(out.unmatchedMotion.includes('m2'));
  assert.ok(out.unmatchedMotion.includes('m3'));
});

test('text equal to a CMS value gets data-cms="title"; cmsFields lists title', async () => {
  const html = `<!doctype html><html><head></head><body>
<div id="main">
  <div id="hero">
    <h1 class="title">My Dynamic Post Title</h1>
    <p>Static subtitle</p>
  </div>
</div>
</body></html>`;

  await page.setContent(html);

  const plan = createPlan({
    sections: [{ name: 'Hero', selector: '#hero' }],
    cms: [{ field: 'title', value: 'My Dynamic Post Title' }],
  });

  const out = (await page.evaluate(snapshotScript(plan))) as SnapshotOut;
  const heroSection = out.sections.find((s) => s.name === 'Hero');
  assert.ok(heroSection);
  assert.deepEqual(heroSection.cmsFields, ['title']);
  assert.match(heroSection.jsx, /data-cms="title"/);
});

test('section JSX larger than oversizedBytes returns parts named after its data-framer-name children', async () => {
  const html = `<!doctype html><html><head></head><body>
<div id="main">
  <div id="hero">
    <div data-framer-name="HeaderBlock">
      <h2>Section Header with substantial content block</h2>
      <p>Paragraph text inside header block describing the section purpose.</p>
    </div>
    <div data-framer-name="BodyBlock">
      <p>Body block content providing detailed text and structure inside the section.</p>
      <button>Action Button</button>
    </div>
  </div>
</div>
</body></html>`;

  await page.setContent(html);

  const plan = createPlan({
    sections: [{ name: 'Hero', selector: '#hero' }],
    oversizedBytes: 200,
  });

  const out = (await page.evaluate(snapshotScript(plan))) as SnapshotOut;
  const heroSection = out.sections.find((s) => s.name === 'Hero');
  assert.ok(heroSection);
  assert.equal(heroSection.parts.length, 2);
  assert.equal(heroSection.parts[0].name, 'HeaderBlock');
  assert.equal(heroSection.parts[1].name, 'BodyBlock');

  // Direct children replaced by <fexport-part data-name="...">
  assert.match(heroSection.jsx, /<fexport-part data-name="HeaderBlock"/);
  assert.match(heroSection.jsx, /<fexport-part data-name="BodyBlock"/);
});

test('repeated component names with >= 2 matches appear in repeated', async () => {
  const html = `<!doctype html><html><head></head><body>
<div id="main">
  <div id="hero">
    <div class="card">Card 1</div>
    <div class="card">Card 2</div>
    <div class="card">Card 3</div>
    <div class="btn">Button 1</div>
  </div>
</div>
</body></html>`;

  await page.setContent(html);

  const plan = createPlan({
    sections: [{ name: 'Hero', selector: '#hero' }],
    components: [
      { name: 'Card', selector: '.card' },
      { name: 'Button', selector: '.btn' },
    ],
  });

  const out = (await page.evaluate(snapshotScript(plan))) as SnapshotOut;
  const heroSection = out.sections.find((s) => s.name === 'Hero');
  assert.ok(heroSection);
  assert.deepEqual(heroSection.repeated, ['Card']);
});

test('Review Focus 1: hydrated motion selectors that do not match static DOM are recorded in unmatchedMotion and generate never crashes', async () => {
  // Static HTML without hydration dynamic nodes
  const html = `<!doctype html><html><head></head><body>
<div id="main">
  <div id="hero" data-framer-name="HeroSection">
    <div class="static-anchor" data-framer-name="StaticCard">Static text</div>
  </div>
</div>
</body></html>`;

  await page.setContent(html);

  // Motion recorded on hydrated DOM with runtime-only node selector
  const plan = createPlan({
    sections: [{ name: 'Hero', selector: '#hero' }],
    motion: [
      { id: 'm1', selector: '#hero .static-anchor' },
      { id: 'm2', selector: '#hero > div.runtime-hydrated-wrapper > div:nth-child(3)' },
      { id: 'm3', selector: '#nonexistent-id [data-framer-name="RuntimeOnly"]' },
    ],
  });

  // Must not throw, m1 matches, m2 and m3 become unmatchedMotion
  const out = (await page.evaluate(snapshotScript(plan))) as SnapshotOut;
  assert.ok(out);
  assert.deepEqual(out.unmatchedMotion, ['m2', 'm3']);
  const heroSection = out.sections.find((s) => s.name === 'Hero');
  assert.ok(heroSection);
  assert.deepEqual(heroSection.motion, ['m1']);
});

test('multiple motion entries and CMS fields matching the same element split into distinct array items', async () => {
  const html = `<!doctype html><html><head></head><body>
<div id="main">
  <div id="hero">
    <h1 class="hero-title shared-target">Multi Target Title</h1>
  </div>
</div>
</body></html>`;

  await page.setContent(html);

  const plan = createPlan({
    sections: [{ name: 'Hero', selector: '#hero' }],
    motion: [
      { id: 'm1', selector: '.shared-target' },
      { id: 'm2', selector: 'h1.hero-title' },
    ],
    cms: [
      { field: 'title', value: 'Multi Target Title' },
      { field: 'heading', value: 'Multi Target Title' },
    ],
  });

  const out = (await page.evaluate(snapshotScript(plan))) as SnapshotOut;
  const heroSection = out.sections.find((s) => s.name === 'Hero');
  assert.ok(heroSection);
  assert.deepEqual(heroSection.motion, ['m1', 'm2']);
  assert.deepEqual(heroSection.cmsFields, ['title', 'heading']);
  assert.match(heroSection.jsx, /data-motion="m1 m2"/);
  assert.match(heroSection.jsx, /data-cms="title heading"/);
});



test('two children sharing a data-framer-name become uniquely named parts with exact placeholders (I5)', async () => {
  const html = `<!doctype html><html><head></head><body>
<div id="main">
  <div id="hero">
    <div data-framer-name="Card"><p>First card with enough text to be a part of the section.</p></div>
    <div data-framer-name="Card"><p>Second card with enough text to be a part of the section.</p></div>
  </div>
</div>
</body></html>`;
  await page.setContent(html);
  const plan = createPlan({ sections: [{ name: 'Hero', selector: '#hero' }], oversizedBytes: 100 });
  const out = (await page.evaluate(snapshotScript(plan))) as SnapshotOut;
  const hero = out.sections.find((s) => s.name === 'Hero')!;
  assert.deepEqual(hero.parts.map((p) => p.name), ['Card', 'Card 2']);
  assert.match(hero.parts[0].jsx, /First card/);
  assert.match(hero.parts[1].jsx, /Second card/);
  assert.match(hero.jsx, /<fexport-part data-name="Card"/);
  assert.match(hero.jsx, /<fexport-part data-name="Card 2"/);
});

test('parts carry their own motion, cms, variant and repeated info; the section keeps only root-level info (I4)', async () => {
  const html = `<!doctype html><html><head></head><body>
<div id="main">
  <div id="hero" class="root-el">
    <div data-framer-name="Left" class="a"><h2 class="title">Left title text content</h2><i class="item"></i><i class="item"></i></div>
    <div data-framer-name="Right" class="b"><p class="body">Right body text content</p></div>
  </div>
</div>
</body></html>`;
  await page.setContent(html);
  const plan = createPlan({
    sections: [{ name: 'Hero', selector: '#hero' }],
    oversizedBytes: 100,
    motion: [
      { id: 'm1', selector: '.title' },
      { id: 'm2', selector: '.body' },
      { id: 'm3', selector: '.root-el' },
    ],
    cms: [{ field: 'heading', value: 'Left title text content' }],
    components: [{ name: 'Item', selector: '.item' }],
    hiddenMap: { b: ['phone'] },
  });
  const out = (await page.evaluate(snapshotScript(plan))) as SnapshotOut;
  const hero = out.sections.find((s) => s.name === 'Hero')!;
  const left = hero.parts.find((p) => p.name === 'Left')!;
  const right = hero.parts.find((p) => p.name === 'Right')!;
  assert.deepEqual(left.motion, ['m1']);
  assert.deepEqual(left.cmsFields, ['heading']);
  assert.deepEqual(left.repeated, ['Item']);
  assert.equal(left.hasVariants, false);
  assert.deepEqual(right.motion, ['m2']);
  assert.equal(right.hasVariants, true);
  assert.deepEqual(hero.motion, ['m3'], 'only the section root motion stays on the section');
  assert.deepEqual(hero.cmsFields, []);
  assert.deepEqual(hero.repeated, []);
  assert.equal(hero.hasVariants, false);
});

test('script-drawn item below the fold gets data-script-drawn on the element at its document position (I6)', async () => {
  const html = `<!doctype html><html><head><style>body{margin:0}</style></head><body>
<div id="main">
  <div id="hero" style="height:3000px"><div id="top" style="height:100px">Top</div></div>
  <div id="below" style="height:200px"><p id="clock" style="margin:0;height:40px">12:00</p></div>
</div>
</body></html>`;
  await page.setContent(html);
  const box = (await page.evaluate(`(() => { const r = document.getElementById('clock').getBoundingClientRect(); return { x: r.x + 5, y: r.y + window.scrollY + 5 }; })()`)) as { x: number; y: number };
  assert.ok(box.y > 3000, 'precondition: item is far below the first screen');
  const plan = createPlan({
    sections: [
      { name: 'Hero', selector: '#hero' },
      { name: 'Below', selector: '#below' },
    ],
    scriptDrawn: [{ id: 's1', section: 'Below', x: box.x, y: box.y }],
  });
  const out = (await page.evaluate(snapshotScript(plan))) as SnapshotOut;
  const below = out.sections.find((s) => s.name === 'Below')!;
  assert.deepEqual(below.scriptDrawn, ['s1']);
  assert.match(below.jsx, /<p[^>]*data-script-drawn="s1"/, 'annotation lands on the clock element');
});
