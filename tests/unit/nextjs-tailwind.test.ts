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

test('a node hidden at a breakpoint keeps its display where it is visible', () => {
  assert.deepEqual(
    toTailwind({ base: { display: 'flex' } }, undefined, NO_TOKENS, ['base']).classes,
    ['flex', 'tablet:hidden']
  );
  assert.deepEqual(
    toTailwind({ base: { display: 'flex' }, tablet: { display: 'block' } }, undefined, NO_TOKENS, ['base', 'tablet']).classes,
    ['flex', 'tablet:block', 'mobile:hidden']
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

test('CSS line-height normal is not Tailwind leading-normal (1.5)', () => {
  assert.deepEqual(toTailwind({ base: { 'line-height': 'normal' } }, undefined, NO_TOKENS).classes, ['leading-[normal]']);
  assert.deepEqual(toTailwind({ base: { 'line-height': 'initial' } }, undefined, NO_TOKENS).classes, ['leading-[normal]']);
});

test('aspect-ratio derived from width/height attributes is not emitted', () => {
  assert.deepEqual(toTailwind({ base: { 'aspect-ratio': 'auto 240 / 120' } }, undefined, NO_TOKENS).classes, []);
  assert.deepEqual(toTailwind({ base: { 'aspect-ratio': '16 / 9' } }, undefined, NO_TOKENS).classes, ['aspect-[16/9]']);
});

test("Framer ::after borders become inset rings, or leftover CSS when they can't", () => {
  const tokens = tokensFor({ color: 'rgb(19, 51, 36)' });
  const solid = { widths: ['2px', '2px', '2px', '2px'], style: 'solid', color: 'rgb(19, 51, 36)' };
  assert.deepEqual(toTailwind({ base: {} }, undefined, tokens, undefined, solid).classes, ['ring-2', 'ring-inset', 'ring-green-900']);
  const dashed = { widths: ['1px', '0px', '1px', '0px'], style: 'dashed', color: 'rgb(19, 51, 36)' };
  const r = toTailwind({ base: {} }, undefined, tokens, undefined, dashed);
  assert.deepEqual(r.classes, []);
  assert.deepEqual(r.leftover.after, { 'border-width': '1px 0px 1px 0px', 'border-style': 'dashed', 'border-color': 'rgb(19, 51, 36)' });
});

test('Framer masks keep size, position and repeat', () => {
  const r = toTailwind(
    { base: { 'mask-image': 'url("a.png")', 'mask-size': 'cover', 'mask-position': '50% 50%', 'mask-repeat': 'no-repeat' } },
    undefined,
    NO_TOKENS
  );
  assert.deepEqual(r.leftover.base, {
    'mask-image': 'url("a.png")',
    'mask-size': 'cover',
    'mask-position': '50% 50%',
    'mask-repeat': 'no-repeat',
  });
});

test('fluid Framer sizes map to fluid utilities', () => {
  const cls = (base: Style) => toTailwind({ base }, undefined, NO_TOKENS).classes;
  assert.deepEqual(cls({ width: '100%', height: '100vh' }), ['w-full', 'h-screen']);
  assert.deepEqual(cls({ width: '100vw', height: 'min-content' }), ['w-screen', 'h-min']);
  assert.deepEqual(cls({ height: 'max-content', 'max-width': '1800px' }), ['h-max', 'max-w-[1800px]']);
  assert.deepEqual(cls({ height: 'calc(min(100vh, 100%) * 1)' }), ['h-[calc(min(100vh,_100%)_*_1)]']);
});

test('calc and viewport insets are kept, not dropped', () => {
  const r = toTailwind({ base: { position: 'absolute', top: 'calc(49.875% - 50px)', left: '-0.166667%' } }, undefined, NO_TOKENS);
  assert.deepEqual(r.classes, ['absolute', 'top-[calc(49.875%_-_50px)]', 'left-[-0.166667%]']);
  assert.deepEqual(r.leftover, {});
});

test('pointer-events none lets clicks through overlays', () => {
  const r = toTailwind({ base: { 'pointer-events': 'none' }, mobile: { 'pointer-events': 'auto' } }, undefined, NO_TOKENS);
  assert.deepEqual(r.classes, ['pointer-events-none', 'mobile:pointer-events-auto']);
});
