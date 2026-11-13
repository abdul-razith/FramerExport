import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parityEntry } from '../../src/ai-guide/parity-sources.js';
import type { ExportAnimation } from '../../src/ai-guide/export-motion.js';

const folder = 'ai-guide/pages/index/sections/02-about';
const base = { folder, exportFile: 'index.html', markup: [], animations: [], states: [], hoverClasses: [] };

test("a section's pointers name its folder, markup line and styles", () => {
  const e = parityEntry({ ...base, markup: [{ widths: ['base'], line: 120, html: '<div></div>' }] });
  assert.equal(e.folder, folder);
  assert.equal(e.markup, 'index.html:120');
  assert.equal(e.styles, 'ai-guide/pages/index/sections/02-about/styles.css');
});

test('animations point at their setting or override source', () => {
  const at = (kind: ExportAnimation['kind'], extra: Partial<ExportAnimation> = {}): ExportAnimation => ({
    file: 'scripts/vendor/p.mjs', offset: 977, className: 'framer-t', layer: 'Text', kind, values: {}, ...extra,
  });
  const e = parityEntry({
    ...base,
    animations: [
      at('enter'),
      at('override', { layer: 'Interactive', offset: 40, file: 'scripts/vendor/Loop.mjs', override: { name: 'RotateLoop', code: '', animates: true } }),
      at('text', { layer: undefined, className: 'framer-h' }),
    ],
  });
  assert.deepEqual(e.animations, [
    { label: 'Text', kind: 'enter', at: 'scripts/vendor/p.mjs @ 977' },
    { label: 'Interactive', kind: 'override RotateLoop', at: 'scripts/vendor/Loop.mjs @ 40' },
    { label: 'framer-h', kind: 'text', at: 'scripts/vendor/p.mjs @ 977' },
  ]);
});

test("hover classes point at the section's styles", () => {
  const e = parityEntry({
    ...base,
    hoverClasses: ['framer-x1'],
    states: [{ section: '02', element: 'say-hi', action: 'hover', before: 'states/say-hi-hover-before.png', after: 'states/say-hi-hover-after.png' }],
  });
  assert.deepEqual(e.hovers, [
    { element: 'framer-x1', at: `${folder}/styles.css (:hover)` },
    { element: 'say-hi', at: `${folder}/states/say-hi-hover-before.png` },
  ]);
});

test('an extractor error gives no pointers instead of failing', () => {
  const e = parityEntry({ ...base, markup: new Error('x'), animations: new Error('y') });
  assert.equal(e.markup, undefined);
  assert.deepEqual(e.animations, []);
});
