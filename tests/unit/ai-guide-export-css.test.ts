import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FIXTURE_V2 } from '../fixtures/ai-guide/build-fixture.js';
import { hiddenClassWidths, parseExportCss, stylesForClasses, textStyles, widthGroup } from '../../src/ai-guide/export-css.js';
import type { ThemeTokens } from '../../src/nextjs/tokens.js';

const html = readFileSync(path.join(FIXTURE_V2, 'export/index.html'), 'utf8');
const rules = parseExportCss(html);

function tokens(colors: Record<string, string> = {}): ThemeTokens {
  return {
    colors: {}, fonts: {}, radii: {}, shadows: {},
    colorByValue: new Map(Object.entries(colors)),
    fontByFamily: new Map(), radiusByValue: new Map(), shadowByValue: new Map(),
  };
}

test('parseExportCss unwraps media rules', () => {
  assert.ok(rules.some((r) => r.selector === '.framer-hero-title' && r.media?.includes('1199px')));
  assert.ok(!rules.some((r) => r.selector.startsWith('@font-face')));
});

test('widthGroup sorts media queries into width groups', () => {
  assert.equal(widthGroup(undefined), 'all');
  assert.equal(widthGroup('(max-width:1199px)'), 'tablet-mobile');
  assert.equal(widthGroup('(min-width: 810px) and (max-width: 1199.98px)'), 'tablet');
  assert.equal(widthGroup('(min-width: 0) and (max-width: 809.98px)'), 'mobile');
  assert.equal(widthGroup('(max-width: 809.98px)'), 'mobile');
  assert.equal(widthGroup('(min-width: 810px)'), 'other');
  assert.equal(widthGroup('(min-width:1200px)'), 'desktop');
  assert.equal(widthGroup('print'), 'other');
});

test('hiddenClassWidths reads which widths hide a copy', () => {
  const hidden = hiddenClassWidths(rules);
  assert.deepEqual(hidden.get('hidden-m1'), ['tablet', 'mobile']);
  assert.deepEqual(hidden.get('hidden-d1'), ['base']);
});

test('stylesForClasses keeps only matching rules grouped by width', () => {
  const out = stylesForClasses(rules, ['framer-hero-title'], tokens());
  assert.match(out, /\/\* all widths \*\//);
  assert.match(out, /font-size:72px/);
  assert.match(out, /\/\* tablet \+ mobile ≤1199px \*\//);
  assert.match(out, /font-size:56px/);
  assert.doesNotMatch(out, /framer-works/);
  const hero = stylesForClasses(rules, ['framer-hero'], tokens());
  assert.doesNotMatch(hero, /font-size:72px/);
  assert.match(stylesForClasses(rules, ['framer-cta-btn'], tokens()), /\.framer-cta-btn:hover/);
});

test('tokens replace Framer variables', () => {
  const out = stylesForClasses(rules, ['framer-hero-title'], tokens({ '#141414': 'ink' }));
  assert.match(out, /var\(--color-ink\) \/\* var\(--token-ink,#141414\) \*\//);
});

test('selector lists keep only the parts for these classes, and repeated rules come once', () => {
  const css = '<style>.a .framer-x, .a .framer-other { color: red } .framer-x{gap:4px}</style><style>.framer-x{gap:4px}</style>';
  const out = stylesForClasses(parseExportCss(css), ['framer-x'], tokens());
  assert.match(out, /^\.a \.framer-x \{/m);
  assert.doesNotMatch(out, /framer-other/);
  assert.equal(out.match(/gap:4px/g)?.length, 1);
});

test('text style presets are left to the site-level text styles', () => {
  const css = '<style>.framer-styles-preset-k1:not(.rich-text-wrapper){font-size:20px}.framer-x{gap:4px}</style>';
  const rules = parseExportCss(css);
  assert.doesNotMatch(stylesForClasses(rules, ['framer-x', 'framer-styles-preset-k1'], tokens()), /font-size/);
  assert.match(textStyles(rules, ['framer-styles-preset-k1'], tokens()), /font-size:20px/);
});

test('the Framer tablet range gets its own heading', () => {
  const css = '<style>.framer-x{gap:4px}@media (min-width: 810px) and (max-width: 1199.98px){.framer-x{gap:8px}}</style>';
  const out = stylesForClasses(parseExportCss(css), ['framer-x'], tokens());
  assert.match(out, /\/\* tablet 810–1199px \*\/\n\.framer-x \{\n  gap:8px;/);
});
