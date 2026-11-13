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

// A page module that wraps plain divs with code overrides from the site's own code file, the way
// Framer exports them (`le(g.div, { nodeId, override, scopeId })`), plus a minified name clash.
const overrideModules = [
  {
    file: 'scripts/vendor/page.Ov1.mjs',
    text: [
      'import { Tt as le } from "./framer.X.mjs";',
      'import { a as F, i as Ae, o as Me, s as Sc } from "./Loop.Ab12.mjs";',
      'var J = {};',
      'function boot() { (J = le(g.div, { nodeId: `lIy854w_h`, override: Ae, scopeId: `IMzwiuEeL` })), (hn = le(g.div, { nodeId: `cpqFm`, override: F, scopeId: `IMzwiuEeL` })), (Lk = le(g.a, { nodeId: `kLk`, override: Me, scopeId: `IMzwiuEeL` })), (Dot = le(g.div, { nodeId: `dT`, override: Sc, scopeId: `IMzwiuEeL` })); }',
      'function Page() { return [p(J, { className: `framer-14tvjdo`, "data-framer-name": `Interactive`, transformTemplate: Rn }), p(hn, { className: `framer-1rci139`, "data-framer-name": `Prototype animate` }), p(`div`, { className: `framer-plain` }), p(Lk, { className: `framer-link` }), p(Dot, { className: `framer-dot` })]; }',
    ].join('\n'),
  },
  {
    file: 'scripts/vendor/Loop.Ab12.mjs',
    text: [
      'function D() { let e = d(null), t = d(null); return (n(() => { let n = x.context(() => { t.current = x.to(e.current, { rotation: 360, duration: 3, ease: `none`, repeat: -1, delay: 0.5, paused: !0 }); w.create({ trigger: e.current, start: `top bottom`, onEnter: () => t.current?.resume(), onLeave: () => t.current?.pause() }); }, e); return () => n.revert(); }, []), { ref: e }); }',
      'function O() { let e = d(null); return (n(() => { x.to(e.current, { rotation: -360, duration: 3, ease: `none`, repeat: -1 }); }, []), { ref: e }); }',
      'function I(e) { return (t) => (c(b), l(e, { ...t, ...D(t) })); }',
      'function L(e) { return (t) => (c(b), l(e, { ...t, ...O(t) })); }',
      'function T(e) { return (t) => l(e, { ...t, href: `/x` }); }',
      'function k(e = 0) { let t = d(null); return (n(() => { x.set(t.current, { scale: 0 }); x.to(t.current, { scale: 1, duration: 1, delay: e, ease: `power2.inOut`, repeat: -1, yoyo: !0 }); }, [e]), { ref: t }); }',
      'function j() { return k(0.1); }',
      'function B(e) { return (t) => (c(b), l(e, { ...t, ...j(t) })); }',
      'var W = e(() => { (I.displayName = `RotateLoop`), (L.displayName = `RotateReverseLoop`), (T.displayName = `withLink`), (B.displayName = `ScaleLoop1`); });',
      'export { L as a, I as i, T as o, B as s, W as t };',
    ].join('\n'),
  },
];

test('a code override on an element is found with its name and the source that animates it', () => {
  const [a, ...rest] = findAnimations(overrideModules, ['framer-14tvjdo']);
  assert.equal(rest.length, 0);
  assert.equal(a.kind, 'override');
  assert.equal(a.layer, 'Interactive');
  assert.equal(a.override?.name, 'RotateLoop');
  assert.equal(a.file, 'scripts/vendor/Loop.Ab12.mjs');
  assert.ok(a.override?.code.includes('rotation: 360, duration: 3'), a.override?.code);
  assert.ok(a.override?.code.includes('start: `top bottom`'), 'its ScrollTrigger (plays only on screen) is part of the source');
  assert.equal(a.override?.animates, true);
});

test('each element gets its own override, even with the same wrapper module', () => {
  const [a] = findAnimations(overrideModules, ['framer-1rci139']);
  assert.equal(a.override?.name, 'RotateReverseLoop');
  assert.ok(a.override?.code.includes('rotation: -360'), a.override?.code);
});

test('an element without an override wrapper has no override', () => {
  assert.deepEqual(findAnimations(overrideModules, ['framer-plain']), []);
});

test('describeAnimation names the override and says it is the site’s own code', () => {
  const [a] = findAnimations(overrideModules, ['framer-14tvjdo']);
  const line = describeAnimation(a);
  for (const s of ['code override RotateLoop', 'scripts/vendor/Loop.Ab12.mjs @']) assert.ok(line.includes(s), `${s} in ${line}`);
});

test('an override that does not animate is reported as not animating', () => {
  const [a] = findAnimations(overrideModules, ['framer-link']);
  assert.equal(a.override?.name, 'withLink');
  assert.equal(a.override?.animates, false);
});

test('a hook that only calls another hook brings that hook’s source too', () => {
  const [a] = findAnimations(overrideModules, ['framer-dot']);
  assert.equal(a.override?.name, 'ScaleLoop1');
  assert.ok(a.override?.code.includes('return k(0.1)'), a.override?.code);
  assert.ok(a.override?.code.includes('scale: 1, duration: 1, delay: e'), a.override?.code);
  assert.equal(a.override?.animates, true);
});

// Framer text effects as exported: a shared start state and spring, an effect built by a function
// (it needs the scroll target ref) and one plain object, passed as `effect:` to rich text.
const textModules = [
  {
    file: 'scripts/vendor/page.Txt.mjs',
    text: [
      'var Bn, Vn, Hn, Un, Bn2;',
      'function init() { (Bn2 = { decoy: 1 }), (Bn = { opacity: 0.001, rotate: 0, scale: 0.9, skewX: 0, skewY: 0, x: 40, y: 0 }), (Vn = { damping: 40, delay: 0.03, mass: 4, stiffness: 400, type: `spring` }), (Hn = (e) => ({ effect: Bn, repeat: !1, startDelay: 3.3, target: { ref: e }, threshold: 1, tokenization: `character`, transition: Vn, trigger: `onScrollTarget`, type: `appear` })), (Un = { effect: { opacity: 0.001, rotate: 0, scale: 1, skewX: 0, skewY: 0, x: 0, y: 40 }, repeat: !1, startDelay: 3.5, threshold: 0.5, tokenization: `line`, transition: { damping: 40, delay: 0.01, mass: 4, stiffness: 400, type: `spring` }, trigger: `onInView`, type: `appear` }); }',
      'function Page() { return [p(rt, { __fromCanvasComponent: !0, children: p(r, { children: `Bejaman` }), className: `framer-name1`, effect: Hn(C), fonts: [`Inter`] }), p(rt, { className: `framer-lines`, effect: Un, fonts: [`Inter`] })]; }',
    ].join('\n'),
  },
];

test('a text effect built by a function is read with its split, start state, spring and trigger', () => {
  const [a, ...rest] = findAnimations(textModules, ['framer-name1']);
  assert.equal(rest.length, 0);
  assert.equal(a.kind, 'text');
  const v = a.values as Record<string, unknown>;
  assert.equal(v.tokenization, 'character');
  assert.equal(v.trigger, 'onScrollTarget');
  assert.equal(v.startDelay, 3.3);
  assert.deepEqual(v.effect, { opacity: 0.001, rotate: 0, scale: 0.9, skewX: 0, skewY: 0, x: 40, y: 0 });
  assert.deepEqual(a.transition, { damping: 40, delay: 0.03, mass: 4, stiffness: 400, type: 'spring' });
  const line = describeAnimation(a);
  for (const s of ['text effect, per character', 'opacity 0.001→1', 'x 40→0', 'scale 0.9→1', 'stiffness 400', 'damping 40', 'mass 4', '0.03s between characters', 'after 3.3s', 'scroll target'])
    assert.ok(line.includes(s), `${s} in ${line}`);
});

test('a plain-object text effect split by line, in view', () => {
  const [a] = findAnimations(textModules, ['framer-lines']);
  assert.equal(a.kind, 'text');
  const line = describeAnimation(a);
  for (const s of ['text effect, per line', 'y 40→0', 'in view', '0.01s between lines', 'after 3.5s']) assert.ok(line.includes(s), `${s} in ${line}`);
});
