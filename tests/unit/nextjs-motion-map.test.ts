import assert from 'node:assert/strict';
import test from 'node:test';
import { attachMotion, motionUsage } from '../../src/nextjs/framer/motion-map.js';
import { mergeBreakpoints } from '../../src/nextjs/framer/breakpoints.js';
import { emptyReport } from '../../src/nextjs/report.js';
import type { Node, RawNode } from '../../src/nextjs/model.js';

let seq = 0;
function n(tag: string, extra: Partial<Node> = {}, children: Node[] = []): Node {
  const key = `${tag}:${seq++}`;
  return { id: key, key, tag, attrs: {}, styles: { base: {} }, children, ...extra };
}

test('attachMotion maps Framer markers and start states to motion specs', () => {
  const reveal = n('p', { framerName: 'Intro', text: 'x', animation: { kind: 'reveal', from: { opacity: 0, y: 40 } } });
  const split = n('p', { framerName: 'Tagline', animation: { kind: 'split-text', from: { opacity: 0, x: 40, scale: 0.9 } } });
  const smooth = n('div', { framerName: 'Smooth Scroll' });
  const cursor = n('div', { attrs: { 'data-framer-cursor': 'c1' } });
  const loader = n('div', { framerName: 'Loader' });
  const root = attachMotion(n('body', {}, [reveal, split, smooth, cursor, loader]));
  const [r, s, sm, c, l] = root.children;
  assert.deepEqual(r.motion, { kind: 'reveal', from: { opacity: 0, y: 40 } });
  assert.deepEqual(s.motion, { kind: 'split-text', from: { opacity: 0, x: 40, scale: 0.9 } });
  assert.deepEqual(sm.motion, { kind: 'smooth-scroll' });
  assert.deepEqual(c.motion, { kind: 'cursor' });
  assert.deepEqual(l.motion, { kind: 'loader' });
  assert.deepEqual([...motionUsage(root)].sort(), ['cursor', 'loader', 'reveal', 'smooth-scroll', 'split-text']);
});

test('mergeBreakpoints turns changing scroll samples into a scroll motion spec', () => {
  const tree = (): RawNode => ({
    key: 'body:0',
    tag: 'body',
    attrs: {},
    box: { x: 0, y: 0, w: 1, h: 1 },
    styles: {},
    visible: true,
    children: [
      {
        key: 'body:0/div[Parallax]:0',
        tag: 'div',
        framerName: 'Parallax',
        attrs: {},
        box: { x: 0, y: 0, w: 1, h: 1 },
        styles: {},
        visible: true,
        scrollSamples: [
          { transform: 'matrix(1, 0, 0, 1, 0, 0)', opacity: '1' },
          { transform: 'matrix(1, 0, 0, 1, 0, -50)', opacity: '1' },
          { transform: 'matrix(1, 0, 0, 1, 0, -100)', opacity: '1' },
        ],
        children: [],
      },
    ],
  });
  const root = mergeBreakpoints(
    { route: '/', url: '', title: '', meta: {}, trees: { base: tree(), tablet: tree(), mobile: tree() }, hover: [], screenshots: { base: '', tablet: '', mobile: '' } },
    new Map(),
    emptyReport()
  );
  assert.deepEqual(root.children[0].motion, {
    kind: 'scroll',
    scroll: [{ property: 'transform', values: ['matrix(1, 0, 0, 1, 0, 0)', 'matrix(1, 0, 0, 1, 0, -50)', 'matrix(1, 0, 0, 1, 0, -100)'] }],
  });
});
