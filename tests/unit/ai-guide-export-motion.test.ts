import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { FIXTURE_V2 } from '../fixtures/ai-guide/build-fixture.js';
import { describeAnimation, findAnimations, loadVendorModules } from '../../src/ai-guide/export-motion.js';

const modules = loadVendorModules(path.join(FIXTURE_V2, 'export'));

test('loadVendorModules reads scripts/vendor modules with export-relative paths', () => {
  assert.deepEqual(modules.map((m) => m.file), ['scripts/vendor/page.Abc123.mjs']);
});

test('reads enter animation with resolved identifiers', () => {
  const found = findAnimations(modules, ['framer-hero-title']);
  assert.equal(found.length, 1);
  const a = found[0];
  assert.equal(a.kind, 'enter');
  assert.equal(a.once, true);
  assert.equal(a.layer, 'Title');
  assert.equal((a.values as Record<string, unknown>).opacity, 0);
  assert.equal((a.values as Record<string, unknown>).y, 40);
  const line = describeAnimation(a);
  for (const s of ['enter (in view, once)', 'opacity 0→1', 'y 40→0', 'stiffness 200', 'damping 30', 'delay 0.2s', 'scripts/vendor/page.Abc123.mjs @']) {
    assert.ok(line.includes(s), `${s} in ${line}`);
  }
  assert.ok(!line.includes('x 0→0'), line);
});

test('the animation-like definition wins over a decoy', () => {
  const [a] = findAnimations(modules, ['framer-hero-title']);
  assert.deepEqual(a.transition, { delay: 0.2, damping: 30, stiffness: 200, type: 'spring' });
});

test('reads a loop', () => {
  const found = findAnimations(modules, ['framer-ruler']);
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, 'loop');
  const line = describeAnimation(found[0]);
  assert.ok(line.includes('x 150') && line.includes('mirror') && line.includes('4s'), line);
});

test('a static section has no animations', () => {
  assert.deepEqual(findAnimations(modules, ['framer-faq']), []);
});

test('unparseable values stay raw', () => {
  const text = 'var q = { __framer__enter: weird(1), className: `framer-x` };';
  const [a] = findAnimations([{ file: 'scripts/vendor/x.mjs', text }], ['framer-x']);
  assert.equal(typeof a.values, 'string');
  assert.ok((a.values as string).includes('weird(1)'));
});

test('braces inside strings and templates do not break the scan', () => {
  const text = 'var s = "{", t = `a ${b} }`; var o = { __framer__enter: { opacity: 0 }, className: `framer-y` };';
  const [a] = findAnimations([{ file: 'f.mjs', text }], ['framer-y']);
  assert.deepEqual(a.values, { opacity: 0 });
});

test('a transition inside the state object is the one that applies', () => {
  const text = 'var Fn, Pn; (Pn = { delay: 0, duration: 0, type: `tween` }), (Fn = { opacity: 0, transition: { delay: 3.3, duration: 0.4, type: `tween` } });' +
    ' var o = { __framer__animate: { transition: Pn }, __framer__exit: Fn, className: `framer-l` };';
  const [a] = findAnimations([{ file: 'f.mjs', text }], ['framer-l']);
  assert.equal(a.kind, 'exit');
  assert.deepEqual(a.values, { opacity: 0 });
  assert.equal(describeAnimation(a), 'exit: to opacity 0 · tween 0.4s, delay 3.3s · source: f.mjs @ ' + a.offset);
});
