import assert from 'node:assert/strict';
import test from 'node:test';
import { toTailwind } from '../../src/nextjs/tailwind.js';
import { collectTokens } from '../../src/nextjs/tokens.js';
import type { Node, Style } from '../../src/nextjs/model.js';

function tokensFor(...styles: Style[]) {
  const nodes: Node[] = styles.map((base, i) => ({
    id: String(i),
    key: String(i),
    tag: 'div',
    attrs: {},
    styles: { base },
    children: [],
  }));
  return collectTokens(nodes);
}

const NO_TOKENS = tokensFor();

test('flex column with gap maps to named classes', () => {
  const r = toTailwind({ base: { display: 'flex', 'flex-direction': 'column', gap: '24px' } }, undefined, NO_TOKENS);
  assert.deepEqual(r.classes, ['flex', 'flex-col', 'gap-6']);
});

test('off-scale sizes use arbitrary values', () => {
  assert.deepEqual(toTailwind({ base: { width: '347px' } }, undefined, NO_TOKENS).classes, ['w-[347px]']);
  assert.deepEqual(toTailwind({ base: { gap: '22px' } }, undefined, NO_TOKENS).classes, ['gap-[22px]']);
});

test('colours always map to token classes', () => {
  const tokens = tokensFor({ color: 'rgb(19, 51, 36)', 'background-color': 'rgba(255, 255, 255, 0.1)' });
  const r = toTailwind(
    { base: { color: 'rgb(19, 51, 36)', 'background-color': 'rgba(255, 255, 255, 0.1)' } },
    undefined,
    tokens
  );
  assert.deepEqual(r.classes, ['text-green-900', 'bg-white-a10']);
});

test('breakpoint overrides use desktop-first tablet: and mobile: prefixes', () => {
  const r = toTailwind({ base: { 'font-size': '72px' }, mobile: { 'font-size': '48px' } }, undefined, NO_TOKENS);
  assert.deepEqual(r.classes, ['text-7xl', 'mobile:text-5xl']);
});

test('padding collapses to the shortest form', () => {
  const pad = (t: string, r: string, b: string, l: string): Style => ({
    'padding-top': t,
    'padding-right': r,
    'padding-bottom': b,
    'padding-left': l,
  });
  assert.deepEqual(toTailwind({ base: pad('16px', '16px', '16px', '16px') }, undefined, NO_TOKENS).classes, ['p-4']);
  assert.deepEqual(toTailwind({ base: pad('16px', '24px', '16px', '24px') }, undefined, NO_TOKENS).classes, ['px-6', 'py-4']);
  assert.deepEqual(
    toTailwind({ base: pad('1px', '24px', '16px', '24px') }, undefined, NO_TOKENS).classes,
    ['px-6', 'pt-[1px]', 'pb-4']
  );
});

test('unsupported properties go to leftover CSS', () => {
  const r = toTailwind(
    { base: { 'clip-path': 'circle(50%)', display: 'flex' }, mobile: { filter: 'blur(4px)' } },
    undefined,
    NO_TOKENS
  );
  assert.deepEqual(r.classes, ['flex']);
  assert.deepEqual(r.leftover, { base: { 'clip-path': 'circle(50%)' }, mobile: { filter: 'blur(4px)' } });
});

test('hover styles map with the hover: prefix', () => {
  const tokens = tokensFor({ 'background-color': '#ffffff1a' });
  const r = toTailwind({ base: {} }, { 'background-color': '#ffffff1a' }, tokens);
  assert.deepEqual(r.classes, ['hover:bg-white-a10']);
});

test('properties reset with "initial" map to their default utility', () => {
  const r = toTailwind({ base: { width: '300px' }, mobile: { width: 'initial' } }, undefined, NO_TOKENS);
  assert.deepEqual(r.classes, ['w-75', 'mobile:w-auto']);
});

test('breakpoint visibility becomes hidden/display classes', () => {
  assert.deepEqual(
    toTailwind({ base: { display: 'flex' } }, undefined, NO_TOKENS, ['mobile']).classes,
    ['hidden', 'mobile:flex']
  );
  assert.deepEqual(
    toTailwind({ base: {} }, undefined, NO_TOKENS, ['base', 'tablet']).classes,
    ['mobile:hidden']
  );
});

test('border, radius and font tokens', () => {
  const tokens = tokensFor(
    { 'font-family': '"Inter Display", sans-serif' },
    ...[1, 2, 3].map(() => ({
      'border-top-left-radius': '16px',
      'border-top-right-radius': '16px',
      'border-bottom-right-radius': '16px',
      'border-bottom-left-radius': '16px',
    }))
  );
  const r = toTailwind(
    {
      base: {
        'font-family': '"Inter Display", sans-serif',
        'border-top-left-radius': '16px',
        'border-top-right-radius': '16px',
        'border-bottom-right-radius': '16px',
        'border-bottom-left-radius': '16px',
      },
    },
    undefined,
    tokens
  );
  assert.deepEqual(r.classes, ['font-inter-display', 'rounded-1']);
});

test('output never contains a raw hex colour', () => {
  const r = toTailwind({ base: { color: '#123456', 'background-color': 'rgb(1, 2, 3)' } }, undefined, NO_TOKENS);
  for (const c of r.classes) assert.doesNotMatch(c, /#/);
});
