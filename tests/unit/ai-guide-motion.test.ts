import assert from 'node:assert/strict';
import test from 'node:test';
import { motionFromNodes, renderMotionMd, summarizeLoad } from '../../src/ai-guide/motion.js';
import type { MotionEntry } from '../../src/ai-guide/types.js';
import type { Node, Style } from '../../src/nextjs/model.js';
import { guidePage } from './ai-guide-fixture.js';

const s = (t: number, opacity: string, transform = 'none', text = 'Hi') => ({
  t,
  values: { 'body:0/div:0': { opacity, transform, text } },
});

test('an element that fades in and settles is a load animation with start and duration', () => {
  const samples = [s(0, '0'), s(200, '0'), s(400, '0.5'), s(600, '1'), s(800, '1'), s(1000, '1'), s(6000, '1')];
  const [e] = summarizeLoad(samples, 200);
  assert.equal(e.trigger, 'load');
  assert.equal(e.from, 'opacity 0');
  assert.equal(e.to, 'opacity 1');
  assert.equal(e.startMs, 200);
  assert.equal(e.durationMs, 400);
  assert.equal(e.frames, 'load/001–003');
});

test('an element still changing at the end of the window is a loop, not a load animation', () => {
  const samples = [0, 200, 400, 600].map((t, i) => s(t, '1', `rotate(${i * 30}deg)`));
  assert.equal(summarizeLoad(samples, 200)[0].trigger, 'loop');
});

test('text that changes during load is custom behaviour (typing, clock)', () => {
  const samples = [s(0, '1', 'none', 'H'), s(200, '1', 'none', 'He'), s(400, '1', 'none', 'Hey')];
  const [e] = summarizeLoad(samples, 200);
  assert.equal(e.trigger, 'custom');
  assert.match(e.note!, /text changes: "H" → "Hey"/);
});

test('static elements produce no entry', () => {
  assert.deepEqual(summarizeLoad([s(0, '1'), s(200, '1')], 200), []);
});

function node(key: string, extra: Partial<Node> = {}, children: Node[] = []): Node {
  return { id: key, key, tag: 'div', attrs: {}, styles: { base: {} as Style }, children, ...extra };
}

test('reveal, scroll-linked and hover come from the captured model', () => {
  const root = node('body:0', {}, [
    node('body:0/p:0', { motion: { kind: 'reveal', from: { opacity: 0, y: 40 } } }),
    node('body:0/div:1', { motion: { kind: 'scroll', scroll: [{ property: 'transform', values: ['scale(0.9)', 'scale(1)'] }] } }),
    node('body:0/a:0', { tag: 'a' }),
  ]);
  const entries = motionFromNodes(root, [{ key: 'body:0/a:0', style: { 'background-color': 'rgb(0, 0, 0)' } }]);
  assert.deepEqual(entries.map((e) => e.trigger).sort(), ['hover', 'in-view', 'scroll']);
});

const sampleEntries = (): MotionEntry[] => [
  { key: 'k:Hero Section/p:0', label: 'p "Hi"', section: '', trigger: 'load', from: 'opacity 0', to: 'opacity 1', startMs: 200, durationMs: 400, easing: 'ease-out', frames: 'load/001–003' },
  { key: 'k:Hero Section/span:0', label: 'span "H"', section: '', trigger: 'custom', note: 'text changes: "H" → "Hey"', frames: 'load/000–002' },
];

test('motion.md groups entries by section and lists custom behaviour separately', () => {
  const md = renderMotionMd(guidePage(), sampleEntries());
  assert.match(md, /^## Hero Section$/m);
  assert.match(md, /trigger: load · opacity 0 → opacity 1 · starts 200 ms · lasts 400 ms · ease-out · frames load\/001–003/);
  assert.match(md, /^## Custom behaviour$/m);
});

test('motion.md says so when a page has no animation', () => {
  assert.match(renderMotionMd(guidePage(), []), /No animation was detected on this page/);
});
