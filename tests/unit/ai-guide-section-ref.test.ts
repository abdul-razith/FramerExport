import assert from 'node:assert/strict';
import { test } from 'node:test';
import { markupFileNames, renderSectionRef, sectionDirName, sectionMotion, type SectionRefInput } from '../../src/ai-guide/section-ref.js';
import { guidePage } from './ai-guide-fixture.js';

function input(extra: Partial<SectionRefInput> = {}): SectionRefInput {
  const page = guidePage();
  const section = {
    ...page.sections[0],
    className: 'framer-hero',
    framerName: 'Hero Section',
    texts: ['Big desktop title', 'Small title'],
    widthsOf: { 'Big desktop title': ['base' as const], 'Small title': ['tablet' as const, 'mobile' as const] },
    generated: [{ text: '9:06:10 AM', kind: 'clock' as const }],
    decorations: ['ruler 0–1400'],
  };
  return {
    page,
    section,
    exportFile: 'index.html',
    markup: [
      { widths: ['base'], line: 12, html: '<h1>Big desktop title</h1>' },
      { widths: ['tablet', 'mobile'], line: 13, html: '<h1>Small title</h1>' },
    ],
    css: '/* all widths */\n.framer-hero {}\n',
    presets: ['framer-styles-preset-k1'],
    animations: [{ file: 'scripts/vendor/p.mjs', offset: 10, className: 'framer-hero-title', layer: 'Title', kind: 'enter', once: true, values: { opacity: 0, y: 40 } }],
    recorded: [{ key: 'k', label: 'Title', section: 'Hero Section', trigger: 'load', from: 'opacity 0', to: 'opacity 1', startMs: 400, durationMs: 600, frames: 'load/002–005' }],
    states: [{ section: '01', element: 'say-hi', action: 'hover', before: 'states/say-hi-hover-before.png', after: 'states/say-hi-hover-after.png' }],
    slices: { '1440': ['shot-1440-1.png'], '1024': ['shot-1024-1.png'], '390': ['shot-390-1.png', 'shot-390-2.png'] },
    ...extra,
  };
}

test('ref.md has every heading in order', () => {
  const md = renderSectionRef(input());
  const heads = md.split('\n').filter((l) => l.startsWith('#'));
  assert.equal(heads[0], '# 01 Hero Section — /');
  assert.deepEqual(heads.slice(1), ['## Where', '## Widths', '## Content', '## Animations', '## Interactive', '## Build']);
});

test('ref.md points at the export and labels widths', () => {
  const md = renderSectionRef(input());
  for (const s of [
    'index.html',
    'line 12',
    'data-framer-name="Hero Section"',
    'class="framer-hero"',
    '`markup.desktop.html`: desktop',
    '`markup.tablet-mobile.html`: tablet, mobile',
    '"Small title" (tablet, mobile)',
    'generated (clock)',
    'ruler 0–1400',
    'opacity 0→1',
    'Recorded on the live site',
    'states/say-hi-hover-after.png',
    'framer-styles-preset-k1',
    'ai-guide/text-styles.css',
    'data-section="01"',
    'shot-390-2.png',
  ]) {
    assert.ok(md.includes(s), `${s}\n\n${md}`);
  }
});

test('an extractor error shows as not available', () => {
  const md = renderSectionRef(input({ css: new Error('boom'), animations: new Error('x'), markup: new Error('gone') }));
  assert.ok(md.includes('styles.css: not available: boom'), md);
  const anim = md.split('## Animations')[1].split('## Interactive')[0];
  assert.ok(anim.includes('not available: x'));
  assert.ok(md.includes('markup: not available: gone'));
});

test('no animations and no states are said plainly', () => {
  const md = renderSectionRef(input({ animations: [], recorded: [], states: [] }));
  assert.ok(md.includes('No Framer animation settings for this section.'));
  assert.ok(md.includes('No hover or click changes found.'));
});

test('markup file names per copies', () => {
  assert.deepEqual(markupFileNames([{ widths: ['base', 'tablet', 'mobile'], line: 1, html: '' }]), ['markup.html']);
  assert.deepEqual(
    markupFileNames([
      { widths: ['base'], line: 1, html: '' },
      { widths: ['tablet', 'mobile'], line: 2, html: '' },
    ]),
    ['markup.desktop.html', 'markup.tablet-mobile.html']
  );
});

test('section folder names', () => {
  const page = guidePage();
  assert.equal(sectionDirName(page.sections[0]), '01-hero-section');
  assert.equal(sectionDirName(page.shell![0]), 'S1-header');
});

test('sectionMotion lists what moves: Framer settings and recorded load, in-view, scroll and loop motion', () => {
  const anim = (layer: string | undefined, className: string, kind: 'enter' | 'loop' | 'scroll') =>
    ({ file: 'scripts/vendor/a.mjs', offset: 1, className, layer, kind, values: {} });
  const list = sectionMotion(
    [anim('Name', 'framer-a', 'enter'), anim(undefined, 'framer-b-container', 'loop')],
    [
      { key: 'k', label: 'letters "Hi"', section: '', trigger: 'load' },
      { key: 'k', label: 'Text', section: '', trigger: 'scroll' },
      { key: 'k', label: 'Text', section: '', trigger: 'scroll' },
      { key: 'k', label: 'div "5:17 AM"', section: '', trigger: 'custom' },
      { key: 'k', label: 'Card', section: '', trigger: 'hover' },
    ]
  );
  assert.deepEqual(list, ['Name (enter)', 'framer-b-container (loop)', 'letters "Hi" (load)', 'Text (scroll)']);
});

test('sectionMotion ignores an extractor error', () => {
  assert.deepEqual(sectionMotion(new Error('x'), []), []);
});

const spin = {
  file: 'scripts/vendor/Loop.Ab12.mjs',
  offset: 99,
  className: 'framer-14tvjdo',
  layer: 'Interactive',
  kind: 'override' as const,
  values: {},
  override: { name: 'RotateLoop', code: 'function D() { x.to(e.current, { rotation: 360, duration: 3, repeat: -1 }); }', animates: true },
};
const link = { ...spin, className: 'framer-link', layer: 'Link', override: { name: 'withLink', code: 'function T(e) { return (t) => l(e, { ...t, href: `/x` }); }', animates: false } };

test('ref.md prints a code override with its source, to rebuild it from', () => {
  const md = renderSectionRef(input({ animations: [spin] }));
  const part = md.slice(md.indexOf('## Animations'), md.indexOf('## Interactive'));
  assert.ok(part.includes('**Interactive** (`framer-14tvjdo`) — code override RotateLoop'), part);
  assert.ok(part.includes('```js\nfunction D() { x.to(e.current, { rotation: 360, duration: 3, repeat: -1 }); }\n```'), part);
});

test('sectionMotion counts a code override only when it animates', () => {
  assert.deepEqual(sectionMotion([spin, link], []), ['Interactive (override RotateLoop)']);
});
