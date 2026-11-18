import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeAppear, parseAppearAnimations } from '../../src/ai-guide/appear-transitions.js';
import type { ExportAnimation } from '../../src/ai-guide/export-motion.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(here, '..', 'fixtures', 'appear', 'clara-theo-appear.html'), 'utf8');

const appear = (json: string, breakpoints = '[]') =>
  `<script type="framer/appear" id="__framer__appearAnimationsContent">${json}</script>` +
  `<script type="framer/appear" id="__framer__breakpoints">${breakpoints}</script>`;

test('reads the exact Framer transition of an appear animation', () => {
  const map = parseAppearAnimations(html);
  assert.deepEqual(map.get('a4be70')!.transition, { delay: 0.1, duration: 2.6, ease: [0.2, 0.7, 0.1, 1], type: 'tween' });
  assert.equal(map.get('a4be70')!.initial.scale, 1.06);
  assert.equal(map.get('a4be70')!.animate.scale, 1);
  assert.ok(!('transition' in map.get('a4be70')!.animate), 'transition is split out of animate');
});

test('keeps the delay and duration of each element separately', () => {
  const map = parseAppearAnimations(html);
  assert.equal(map.get('4kv6xh')!.transition.delay, 0.15);
  assert.equal(map.get('4kv6xh')!.transition.duration, 1.4);
  assert.equal(map.get('mcrxlu')!.transition.duration, 1.2);
});

test('names per-breakpoint variants from __framer__breakpoints', () => {
  const a = parseAppearAnimations(html).get('a4be70')!;
  assert.deepEqual(Object.keys(a.byBreakpoint).sort(), ['desktop', 'laptop', 'mobile', 'tablet']);
});

test('an export without the appear block gives an empty map', () => {
  assert.equal(parseAppearAnimations('<html><body></body></html>').size, 0);
});

test('malformed appear JSON gives an empty map instead of throwing', () => {
  assert.equal(parseAppearAnimations(appear('{bad')).size, 0);
});

test('a spring transition keeps stiffness and damping and gains no duration', () => {
  const json = JSON.stringify({
    abc123: { default: { initial: { opacity: 0 }, animate: { opacity: 1, transition: { type: 'spring', stiffness: 400, damping: 60, delay: 0 } } } },
  });
  const t = parseAppearAnimations(appear(json)).get('abc123')!.transition;
  assert.deepEqual(t, { type: 'spring', stiffness: 400, damping: 60, delay: 0 });
  assert.ok(!('duration' in t));
});

test('mergeAppear fills the transition of a matching appear animation only', () => {
  const base = { file: 'scripts/vendor/x.mjs', offset: 1, kind: 'appear' as const, values: { opacity: 0.001, y: 54 } };
  const merged = mergeAppear(
    [
      { ...base, className: 'framer-4kv6xh' },
      { ...base, className: 'framer-zzzzzz' },
      { ...base, kind: 'enter', className: 'framer-mcrxlu' },
    ] satisfies ExportAnimation[],
    parseAppearAnimations(html)
  );
  assert.equal((merged[0].transition as Record<string, unknown>).duration, 1.4);
  assert.equal(merged[1].transition, undefined);
  assert.equal(merged[2].transition, undefined, 'only kind appear is filled');
});

test('mergeAppear takes the start values from the HTML initial state (review minor 3)', () => {
  const a = mergeAppear(
    [{ file: 'x.mjs', offset: 1, kind: 'appear', className: 'framer-a4be70', values: { scale: 1 } }],
    parseAppearAnimations(html)
  )[0];
  assert.equal((a.values as Record<string, number>).scale, 1.06);
});

test('mergeAppear keeps per-width variants only when they differ (review item 5)', () => {
  const same = mergeAppear([{ file: 'x.mjs', offset: 1, kind: 'appear', className: 'framer-a4be70', values: {} }], parseAppearAnimations(html))[0];
  assert.equal(same.byBreakpoint, undefined, 'a4be70 variants are identical');
  const state = (y: number, delay: number) => ({ initial: { opacity: 0, y }, animate: { opacity: 1, y: 0, transition: { duration: 1, delay } } });
  const json = JSON.stringify({ abc: { default: state(54, 0), m1: state(20, 0.3) } });
  const bps = JSON.stringify([{ hash: 'd1', mediaQuery: '(min-width: 1200px)' }, { hash: 'm1', mediaQuery: '(max-width: 809.98px)' }]);
  const differ = mergeAppear([{ file: 'x.mjs', offset: 1, kind: 'appear', className: 'framer-abc', values: {} }], parseAppearAnimations(appear(json, bps)))[0];
  assert.deepEqual(Object.keys(differ.byBreakpoint ?? {}).sort(), ['desktop', 'mobile']);
  assert.equal(differ.byBreakpoint!.mobile!.initial.y, 20);
});
