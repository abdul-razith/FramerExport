import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FIXTURE_V2 } from '../fixtures/ai-guide/build-fixture.js';
import { hiddenClassWidths, parseExportCss } from '../../src/ai-guide/export-css.js';
import { classesIn, presetClassesIn, sectionMarkup } from '../../src/ai-guide/export-markup.js';

const html = readFileSync(path.join(FIXTURE_V2, 'export/index.html'), 'utf8');
const hidden = hiddenClassWidths(parseExportCss(html));

test('hero has a desktop copy and a tablet+mobile copy', async () => {
  const copies = await sectionMarkup(html, { framerName: 'Hero', className: 'framer-hero' }, hidden);
  assert.equal(copies.length, 2);
  const desktop = copies.find((c) => c.html.includes('Big desktop title'))!;
  const small = copies.find((c) => c.html.includes('Small title'))!;
  assert.deepEqual(desktop.widths, ['base']);
  assert.deepEqual(small.widths, ['tablet', 'mobile']);
  assert.ok(!desktop.html.includes('Small title'));
  assert.ok(desktop.line > 0 && small.line > 0);
});

test('a section without copies is one markup for all widths', async () => {
  const copies = await sectionMarkup(html, { className: 'framer-faq' }, hidden);
  assert.equal(copies.length, 1);
  assert.deepEqual(copies[0].widths, ['base', 'tablet', 'mobile']);
  assert.match(copies[0].html, /What do you do\?/);
});

test('runtime attributes are removed', async () => {
  const copies = await sectionMarkup(html, { framerName: 'Hero' }, hidden);
  for (const c of copies) {
    assert.doesNotMatch(c.html, /data-framer-appear-id|<!--\$-->|transform:none/);
    assert.match(c.html, /class="framer-hero-title"/);
  }
});

test('an element that is not in the export gives no copies', async () => {
  assert.deepEqual(await sectionMarkup(html, { framerName: 'Nope', className: 'framer-nope' }, hidden), []);
});

test('classesIn lists framer classes', async () => {
  const [copy] = await sectionMarkup(html, { className: 'framer-works' }, hidden);
  const classes = classesIn(copy.html);
  assert.deepEqual(classes, ['framer-works', 'framer-panel']);
  const hero = await sectionMarkup(html, { framerName: 'Hero' }, hidden);
  assert.ok(!classesIn(hero[0].html).includes('ssr-variant'));
});

test('letter- and word-split text collapses into one element', async () => {
  const src = `<section class="framer-s"><p class="framer-t">${[...'Hello'].map((c) => `<span style="display:inline-block;opacity:0.001;transform:translateX(40px)">${c}</span>`).join('')}</p>
  <p class="framer-w"><span>Make</span> <span>things</span> <span>simple</span></p></section>`;
  const [copy] = await sectionMarkup(src, { className: 'framer-s' }, new Map());
  assert.match(copy.html, /<p class="framer-t" data-split="letters">\s*Hello\s*<\/p>/);
  assert.match(copy.html, /<p class="framer-w" data-split="words">\s*Make things simple\s*<\/p>/);
});

test('animation start states are dropped from inline styles, real values kept, tabs indent', async () => {
  const src = `<section class="framer-s"><div><p style="--framer-text-color:red;opacity:0.001;transform:translateY(40px);will-change:transform">Hi</p></div></section>`;
  const [copy] = await sectionMarkup(src, { className: 'framer-s' }, new Map());
  assert.match(copy.html, /style="--framer-text-color: ?red"/);
  assert.doesNotMatch(copy.html, /opacity|translateY|will-change/);
  assert.match(copy.html, /^\t+</m);
});

test('classesIn leaves out framer-text and presets; presetClassesIn lists the presets', () => {
  const html = '<p class="framer-text framer-styles-preset-k1 framer-a">x</p>';
  assert.deepEqual(classesIn(html), ['framer-a']);
  assert.deepEqual(presetClassesIn(html), ['framer-styles-preset-k1']);
});
