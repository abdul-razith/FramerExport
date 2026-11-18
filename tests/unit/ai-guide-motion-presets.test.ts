import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { mergeAppear, parseAppearAnimations } from '../../src/ai-guide/appear-transitions.js';
import type { ExportAnimation } from '../../src/ai-guide/export-motion.js';
import { APPEAR_TSX, buildMotionPresets, renderPresetsModule } from '../../src/ai-guide/motion-presets.js';
import { renderPlan } from '../../src/ai-guide/plan.js';
import { AGENTS_MD } from '../../src/ai-guide/templates/agents.js';
import { fixtureSite } from './ai-guide-fixture.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(here, '..', 'fixtures', 'appear', 'clara-theo-appear.html'), 'utf8');
const base = { file: 'scripts/vendor/x.mjs', offset: 1 };

const hero: ExportAnimation[] = mergeAppear(
  [
    { ...base, kind: 'appear', className: 'framer-a4be70', layer: 'Photo', values: { scale: 1.06 } },
    { ...base, kind: 'appear', className: 'framer-mcrxlu', values: { opacity: 0.001 } },
    { ...base, kind: 'appear', className: 'framer-4kv6xh', values: { opacity: 0.001, y: 54 } },
  ],
  parseAppearAnimations(html)
);

test('an appear animation becomes a load preset with the exact Framer values', () => {
  const { presets } = buildMotionPresets([{ section: 'hero', animations: hero }]);
  assert.deepEqual(presets.map((p) => p.key), ['hero-photo', 'hero-mcrxlu', 'hero-4kv6xh']);
  const title = presets[2];
  assert.equal(title.trigger, 'load');
  assert.deepEqual(title.from, { opacity: 0.001, y: 54 });
  assert.deepEqual(title.to, { opacity: 1, y: 0 });
  assert.deepEqual(title.transition, { delay: 0.15, duration: 1.4, ease: [0.2, 0.7, 0.1, 1], type: 'tween' });
});

test('keyOf maps each animation object to its preset key', () => {
  const { keyOf } = buildMotionPresets([{ section: 'hero', animations: hero }]);
  assert.equal(keyOf.get(hero[0]), 'hero-photo');
});

test('enter becomes in-view and loop keeps its values as the target', () => {
  const t = { type: 'spring', stiffness: 200, damping: 30 };
  const { presets } = buildMotionPresets([
    {
      section: 'cards',
      animations: [
        { ...base, kind: 'enter', className: 'framer-a', layer: 'Card', values: { opacity: 0, y: 40 }, transition: t },
        { ...base, kind: 'loop', className: 'framer-b', layer: 'Spinner', values: { rotate: 360 }, transition: { duration: 4 }, repeatType: 'loop' },
      ],
    },
  ]);
  assert.equal(presets[0].trigger, 'in-view');
  assert.deepEqual(presets[0].to, { opacity: 1, y: 0 });
  assert.equal(presets[1].trigger, 'loop');
  assert.deepEqual(presets[1].from, { rotate: 0 });
  assert.deepEqual(presets[1].to, { rotate: 360 });
  assert.equal(presets[1].repeatType, 'loop');
});

test('animations without a transition, and kinds with no preset, are left out', () => {
  const { presets } = buildMotionPresets([
    {
      section: 's',
      animations: [
        { ...base, kind: 'appear', className: 'framer-a', values: { opacity: 0 } },
        { ...base, kind: 'scroll', className: 'framer-b', values: { y: 10 }, transition: { duration: 1 } },
        { ...base, kind: 'exit', className: 'framer-c', values: { opacity: 0 }, transition: { duration: 1 } },
      ],
    },
  ]);
  assert.equal(presets.length, 0);
});

test('keys stay unique across sections and calls that share a taken set', () => {
  const taken = new Set<string>();
  const a = { ...base, kind: 'enter' as const, className: 'framer-a', layer: 'Title', values: { opacity: 0 }, transition: { duration: 1 } };
  const first = buildMotionPresets([{ section: 'hero', animations: [a, { ...a }] }], taken);
  const second = buildMotionPresets([{ section: 'hero', animations: [{ ...a }] }], taken);
  assert.deepEqual(first.presets.map((p) => p.key), ['hero-title', 'hero-title-2']);
  assert.deepEqual(second.presets.map((p) => p.key), ['hero-title-3']);
});

test('the presets module is valid TypeScript that exports presets and PresetKey', () => {
  const { presets } = buildMotionPresets([{ section: 'hero', animations: hero }]);
  const src = renderPresetsModule(presets);
  const out = ts.transpileModule(src, { reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.ESNext } });
  assert.deepEqual(out.diagnostics, []);
  assert.ok(src.includes('"hero-4kv6xh"'));
  assert.ok(src.includes('export type PresetKey'));
  assert.ok(src.includes('[0.2, 0.7, 0.1, 1]') || src.includes('[0.2,0.7,0.1,1]'));
});

test('the Appear component reads a preset and types no timing of its own', () => {
  assert.ok(APPEAR_TSX.includes("from './presets'"));
  assert.ok(APPEAR_TSX.includes('reducedMotion="user"'));
  assert.ok(!/duration:\s*\d/.test(APPEAR_TSX), 'no typed duration');
  // motion's `initial`/`animate` reject a plain `object`; the preset must be typed with motion's own types.
  assert.match(APPEAR_TSX, /from: TargetAndTransition/);
  assert.match(APPEAR_TSX, /transition: Transition/);
});

test('plan Task 0 copies the motion presets and AGENTS forbids typed timing', () => {
  assert.ok(renderPlan(fixtureSite()).includes('`ai-guide/motion/`'));
  assert.ok(AGENTS_MD.includes('<Appear preset='));
  assert.ok(AGENTS_MD.includes('never type a duration'));
});

test('in-view presets carry once and the Framer threshold (review item 2)', () => {
  const { presets } = buildMotionPresets([
    { section: 's', animations: [{ ...base, kind: 'enter', className: 'framer-a', layer: 'A', once: false, threshold: 0.1, values: { opacity: 0 }, transition: { duration: 1 } }] },
  ]);
  assert.equal(presets[0].once, false);
  assert.equal(presets[0].amount, 0.1);
});

test('loop presets carry repeatDelay (review item 3)', () => {
  const { presets } = buildMotionPresets([
    { section: 's', animations: [{ ...base, kind: 'loop', className: 'framer-a', layer: 'A', values: { rotate: 360 }, transition: { duration: 4 }, repeatDelay: 2 }] },
  ]);
  assert.equal(presets[0].repeatDelay, 2);
});

test('no preset when a value cannot be carried, or when widths differ (review items 4 and 5)', () => {
  const t = { duration: 1 };
  const { presets } = buildMotionPresets([
    {
      section: 's',
      animations: [
        { ...base, kind: 'enter', className: 'framer-a', layer: 'Blur', values: { opacity: 0, filter: 'blur(8px)' }, transition: t },
        { ...base, kind: 'enter', className: 'framer-b', layer: 'Pct', values: { x: '-50%' }, transition: t },
        { ...base, kind: 'appear', className: 'framer-c', layer: 'Widths', values: { opacity: 0 }, transition: t, byBreakpoint: { mobile: { initial: { opacity: 0, y: 20 }, animate: { opacity: 1 }, transition: t } } },
      ],
    },
  ]);
  assert.deepEqual(presets, []);
});

test('Appear keeps one element type for reduced motion and passes once, amount, repeatDelay and as (review item 1, minor 1)', () => {
  assert.ok(!APPEAR_TSX.includes('useReducedMotion'), 'no element swap on reduced motion');
  assert.match(APPEAR_TSX, /<MotionConfig reducedMotion="user">/);
  assert.match(APPEAR_TSX, /once: p\.once/);
  assert.match(APPEAR_TSX, /amount: p\.amount/);
  assert.match(APPEAR_TSX, /repeatDelay: p\.repeatDelay/);
  assert.match(APPEAR_TSX, /as\?: /);
});
