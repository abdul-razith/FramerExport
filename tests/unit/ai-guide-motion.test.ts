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

test('identical entries (three cards with the same hover) are listed once', () => {
  const style = { 'background-color': 'rgb(0, 0, 0)' };
  const entries = motionFromNodes(node('body:0'), [
    { key: 'body:0/div[Card]:0', style },
    { key: 'body:0/div[Card]:1', style },
    { key: 'body:0/div[Card]:2', style },
  ]);
  assert.equal(entries.length, 1);
  assert.match(entries[0].note!, /×3/);
});

test('an entrance still moving when the recording ends is a load animation, not a loop', () => {
  const samples = Array.from({ length: 31 }, (_, i) => s(i * 200, i < 20 ? '0' : String(Math.min(1, (i - 19) * 0.08))));
  const [e] = summarizeLoad(samples, 200);
  assert.equal(e.trigger, 'load');
  assert.match(e.note!, /still moving when the recording ended/);
});

test('an element moving the whole time is a loop', () => {
  const samples = Array.from({ length: 31 }, (_, i) => s(i * 200, '1', `rotate(${i * 12}deg)`));
  assert.equal(summarizeLoad(samples, 200)[0].trigger, 'loop');
});

test('letters of a split word are one entry', () => {
  const values = (o: string) =>
    Object.fromEntries([...'Bejaman'].map((ch, i) => [`body:0/h1:0/span:${i}`, { opacity: o, transform: 'none', text: ch }]));
  const samples = [0, 200, 400, 600, 800, 1000].map((t, i) => ({ t, values: values(i < 2 ? '0' : '1') }));
  const entries = summarizeLoad(samples, 200);
  assert.equal(entries.length, 1);
  assert.match(entries[0].label, /letters "Bejaman"/);
});

test('scroll-linked transforms are described, not raw matrices', () => {
  const root = node('body:0', {}, [
    node('body:0/div:0', { motion: { kind: 'scroll', scroll: [{ property: 'transform', values: ['matrix(1, 0, 0, 1, 0, -40)', 'none'] }] } }),
  ]);
  const [e] = motionFromNodes(root, []);
  assert.match(e.note!, /transform: translateY -40px → none/);
});

test('an element that moves in bursts with pauses (carousel, blinking caret) is a loop', () => {
  // Moves for 400 ms every 2 s; still the rest of the time.
  const x = (t: number) => Math.floor(t / 2000) * 100 + Math.min(100, Math.max(0, ((t % 2000) - 1600) / 4));
  const samples = Array.from({ length: 31 }, (_, i) => s(i * 200, '1', `translateX(${x(i * 200)}px)`));
  assert.equal(summarizeLoad(samples, 200)[0].trigger, 'loop');
});

test('a two-step entrance (move, pause, move on) is still a load animation', () => {
  const xs = [0, 0, 20, 40, 40, 40, 60, 80, 80, 80, 80, 80, 80];
  const samples = xs.map((x, i) => s(i * 200, '1', `translateX(${x}px)`));
  assert.equal(summarizeLoad(samples, 200)[0].trigger, 'load');
});
