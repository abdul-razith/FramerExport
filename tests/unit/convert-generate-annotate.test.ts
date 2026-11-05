import assert from 'node:assert/strict';
import test from 'node:test';
import { hiddenClassMap, variantLabel } from '../../src/convert/generate/annotate.js';

test('hiddenClassMap reads Framer breakpoint media queries', () => {
  const css =
    '@media (min-width: 1200px) { .hidden-a { display: none !important; } }' +
    '@media (min-width: 810px) and (max-width: 1199.98px) { .hidden-b { display: none !important; } }' +
    '@media (max-width: 809.98px) { .hidden-c, .hidden-d { display: none !important; } }';
  assert.deepEqual(hiddenClassMap(css), {
    'hidden-a': ['desktop'],
    'hidden-b': ['tablet'],
    'hidden-c': ['phone'],
    'hidden-d': ['phone'],
  });
});

test('hiddenClassMap supports custom breakpoints', () => {
  const css =
    '@media (min-width: 1024px) { .hidden-desk { display: none; } }' +
    '@media (min-width: 768px) and (max-width: 1023.98px) { .hidden-tab { display: none; } }' +
    '@media (max-width: 767.98px) { .hidden-mob { display: none; } }';
  assert.deepEqual(hiddenClassMap(css, { md: 768, lg: 1024 }), {
    'hidden-desk': ['desktop'],
    'hidden-tab': ['tablet'],
    'hidden-mob': ['phone'],
  });
});

test('hiddenClassMap ignores rules without display: none and non-hidden classes', () => {
  const css =
    '@media (min-width: 1200px) { .hidden-a { opacity: 0; } .visible-b { display: none; } }';
  assert.deepEqual(hiddenClassMap(css), {});
});

test('hiddenClassMap handles multi-breakpoint rules and comma-separated media queries', () => {
  const css =
    '@media (max-width: 1199.98px) { .hidden-small { display: none; } }' +
    '@media (max-width: 809.98px), (min-width: 1200px) { .hidden-bookends { display: none; } }';
  assert.deepEqual(hiddenClassMap(css), {
    'hidden-small': ['tablet', 'phone'],
    'hidden-bookends': ['desktop', 'phone'],
  });
});

test('variantLabel', () => {
  const m = { 'hidden-b': ['tablet'], 'hidden-c': ['phone'] } as const;
  assert.equal(variantLabel(['x', 'hidden-b', 'hidden-c'], m), 'desktop');
  assert.equal(variantLabel(['hidden-c'], m), 'desktop tablet');
  assert.equal(variantLabel(['x'], m), null);
});

test('variantLabel returns null when no hidden classes are present', () => {
  const m = { 'hidden-a': ['desktop'] } as const;
  assert.equal(variantLabel([], m), null);
  assert.equal(variantLabel(['btn', 'container'], m), null);
  assert.equal(variantLabel(['hidden-a'], {}), null);
});

test('variantLabel shows desktop phone when hidden on tablet', () => {
  const m = { 'hidden-tab': ['tablet'] } as const;
  assert.equal(variantLabel(['hidden-tab'], m), 'desktop phone');
});

test('variantLabel accepts dot-prefixed selectors in class list', () => {
  const m = { 'hidden-c': ['phone'] } as const;
  assert.equal(variantLabel(['.hidden-c'], m), 'desktop tablet');
});
