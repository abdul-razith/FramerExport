import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Box, Breakpoint, Node } from '../../src/nextjs/model.js';
import { looseHash } from '../../src/nextjs/components.js';
import { splitPage } from '../../src/ai-guide/split.js';

let counter = 0;
const boxOf = new Map<string, Box>();

/** A node with a desktop box (the same at every width) and optional position/text. */
function n(name: string, box: [number, number, number, number], children: Node[] = [], opts: { position?: string; text?: string; tag?: string } = {}): Node {
  const key = `k${counter++}`;
  boxOf.set(key, { x: box[0], y: box[1], w: box[2], h: box[3] });
  return {
    id: key, key, tag: opts.tag ?? 'div', framerName: name, text: opts.text, attrs: {},
    styles: { base: opts.position ? { position: opts.position } : {} }, children,
  };
}
const boxes = (node: Node): Partial<Record<Breakpoint, Box>> => {
  const b = boxOf.get(node.key);
  return b ? { base: b, tablet: b, mobile: b } : {};
};
const names = (parts: { name: string }[]) => parts.map((p) => p.name);

test('descends through a full-page wrapper; a full-page decoration without content goes to the shell', () => {
  const hero = n('Hero', [0, 0, 1440, 800], [n('Title', [0, 0, 400, 80], [], { text: 'Hi' })]);
  const works = n('Works', [0, 800, 1440, 1000], [n('Text', [0, 800, 400, 80], [], { text: 'Work' })]);
  const wrap = n('Wrap', [0, 0, 1440, 1800], [hero, works]);
  const grid = n('Section 1', [0, 0, 1440, 1800], [n('Line', [100, 0, 1, 1800])], { position: 'absolute' });
  const root = n('body', [0, 0, 1440, 1800], [wrap, grid], { tag: 'body' });
  const { sections, shell } = splitPage(root, boxes, new Set(), 1800);
  assert.deepEqual(names(sections), ['Hero', 'Works']);
  assert.deepEqual(names(shell), ['Section 1']);
});

test('skips 0×0 layers', () => {
  const root = n('body', [0, 0, 1440, 1000], [n('Ghost', [0, 0, 0, 0]), n('Hero', [0, 0, 1440, 1000], [], { text: 'Hi' })], { tag: 'body' });
  assert.deepEqual(names(splitPage(root, boxes, new Set(), 1000).sections), ['Hero']);
});

test('fixed overlays and shared parts go to the shell', () => {
  const header = n('Header', [0, 0, 1440, 56], [], { text: 'Nudge' });
  const loader = n('Loader', [0, 0, 1440, 900], [], { position: 'fixed', text: 'Welcome!' });
  const hero = n('Hero', [0, 56, 1440, 900], [], { text: 'Hi' });
  const root = n('body', [0, 0, 1440, 956], [header, loader, hero], { tag: 'body' });
  const { sections, shell } = splitPage(root, boxes, new Set([looseHash(header)]), 956);
  assert.deepEqual(names(sections), ['Hero']);
  assert.deepEqual(names(shell), ['Header', 'Loader']);
});

test('a tall section with similar panels is split into them', () => {
  const panel = (i: number) => n('Panel', [0, 100 + i * 700, 1440, 700], [n('Title', [0, 0, 300, 60], [], { text: `Project ${i}`, tag: 'h2' })]);
  const contain = n('Contain', [0, 100, 1440, 2100], [panel(0), panel(1), panel(2)]);
  const works = n('Works', [0, 0, 1440, 2200], [n('Heading', [0, 0, 400, 100], [], { text: 'Works' }), contain]);
  const intro = n('Intro', [0, 2200, 1440, 600], [], { text: 'Hello' });
  const root = n('body', [0, 0, 1440, 2800], [works, intro], { tag: 'body' });
  const { sections } = splitPage(root, boxes, new Set(), 2800);
  assert.deepEqual(names(sections), ['Works — Heading', 'Works — Panel 1', 'Works — Panel 2', 'Works — Panel 3', 'Intro']);
  assert.ok(sections.slice(0, 4).every((s) => s.parent === 'Works'));
});

test('plain sections under body stay as they are', () => {
  const parts = ['A', 'B', 'C'].map((x, i) => n(x, [0, i * 500, 1440, 500], [], { text: x }));
  const root = n('body', [0, 0, 1440, 1500], parts, { tag: 'body' });
  const { sections, shell } = splitPage(root, boxes, new Set(), 1500);
  assert.deepEqual(names(sections), ['A', 'B', 'C']);
  assert.deepEqual(shell, []);
});

test('a page-high absolute layer goes to the shell even when it holds text (background grids, rulers)', () => {
  const grid = n('', [0, 0, 1440, 3000], [n('Ruler', [0, 0, 1440, 40], [], { text: '100' })], { position: 'absolute' });
  const hero = n('Hero', [0, 0, 1440, 1500], [], { text: 'Hi' });
  const works = n('Works', [0, 1500, 1440, 1500], [], { text: 'Work' });
  const root = n('body', [0, 0, 1440, 3000], [grid, hero, works], { tag: 'body' });
  const { sections, shell } = splitPage(root, boxes, new Set(), 3000);
  assert.deepEqual(names(sections), ['Hero', 'Works']);
  assert.equal(shell.length, 1);
});

test('a tall wrapper of full-width parts stacked one under another is opened, even below 90% of the page', () => {
  const intro = n('Intro', [0, 0, 1440, 800], [], { text: 'Intro' });
  const bio = n('Bio', [0, 800, 1440, 1200], [], { text: 'Bio' });
  const timeline = n('Timeline', [0, 2000, 1440, 2000], [], { text: 'Time' });
  const contain = n('Contain', [0, 0, 1440, 4000], [intro, bio, timeline]);
  const all = n('All Content', [0, 0, 1440, 4000], [contain]);
  const cta = n('CTA', [0, 4000, 1440, 1200], [], { text: 'Talk' });
  const root = n('body', [0, 0, 1440, 5200], [all, cta], { tag: 'body' });
  const { sections } = splitPage(root, boxes, new Set(), 5200);
  assert.deepEqual(names(sections), ['All Content — Intro', 'All Content — Bio', 'All Content — Timeline', 'CTA']);
});

test('a tall section laid out side by side is not opened', () => {
  const left = n('Left', [0, 0, 700, 2000], [], { text: 'L' });
  const right = n('Right', [740, 0, 700, 2000], [], { text: 'R' });
  const gallery = n('Gallery', [0, 0, 1440, 2000], [left, right]);
  const root = n('body', [0, 0, 1440, 3000], [gallery, n('End', [0, 2000, 1440, 1000], [], { text: 'E' })], { tag: 'body' });
  assert.deepEqual(names(splitPage(root, boxes, new Set(), 3000).sections), ['Gallery', 'End']);
});

test('stacked parts are full width of their own container, not of the page', () => {
  const a = n('Intro', [120, 0, 1200, 900], [], { text: 'Intro' });
  const b = n('Bio', [120, 900, 1200, 1200], [], { text: 'Bio' });
  const contain = n('Contain', [120, 0, 1200, 2100], [a, b]);
  const all = n('All Content', [0, 0, 1440, 2100], [contain]);
  const root = n('body', [0, 0, 1440, 3000], [all, n('CTA', [0, 2100, 1440, 900], [], { text: 'T' })], { tag: 'body' });
  assert.deepEqual(names(splitPage(root, boxes, new Set(), 3000).sections), ['All Content — Intro', 'All Content — Bio', 'CTA']);
});
