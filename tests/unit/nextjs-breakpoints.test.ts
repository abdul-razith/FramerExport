import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeBreakpoints } from '../../src/nextjs/framer/breakpoints.js';
import { emptyReport } from '../../src/nextjs/report.js';
import type { CapturedPage } from '../../src/nextjs/capture.js';
import type { Node, RawNode, Style } from '../../src/nextjs/model.js';

function raw(
  key: string,
  tag: string,
  opts: { name?: string; text?: string; styles?: Style; visible?: boolean; attrs?: Record<string, string> } = {},
  children: RawNode[] = []
): RawNode {
  return {
    key,
    tag,
    framerName: opts.name,
    text: opts.text,
    attrs: opts.attrs ?? {},
    box: { x: 0, y: 0, w: 100, h: 20 },
    styles: opts.styles ?? {},
    visible: opts.visible ?? true,
    children,
  };
}

function page(base: RawNode, tablet: RawNode, mobile: RawNode, hover: CapturedPage['hover'] = []): CapturedPage {
  return {
    route: '/',
    url: 'https://x.test/',
    title: 't',
    meta: {},
    trees: { base, tablet, mobile },
    hover,
    screenshots: { base: '', tablet: '', mobile: '' },
  };
}

function find(node: Node, pred: (n: Node) => boolean): Node | undefined {
  if (pred(node)) return node;
  for (const c of node.children) {
    const hit = find(c, pred);
    if (hit) return hit;
  }
  return undefined;
}

function heading(size: string) {
  return raw('body:0', 'body', {}, [
    raw('body:0/h1[Heading]:0', 'h1', { name: 'Heading', text: 'Hi', styles: { 'font-size': size } }),
  ]);
}

test('an element present at all widths becomes one node with only differing overrides', () => {
  const root = mergeBreakpoints(page(heading('72px'), heading('72px'), heading('48px')), new Map(), emptyReport());
  const h1 = find(root, (n) => n.tag === 'h1')!;
  assert.deepEqual(h1.styles, { base: { 'font-size': '72px' }, mobile: { 'font-size': '48px' } });
  assert.equal(h1.visibility, undefined);
  assert.equal(h1.id, '/|body:0/h1[Heading]:0');
});

test('breakpoint-only variants are kept with their visibility and reported', () => {
  const tree = (navVisible: boolean, burgerVisible: boolean) =>
    raw('body:0', 'body', {}, [
      raw('body:0/nav[Nav]:0', 'nav', { name: 'Nav', visible: navVisible }),
      raw('body:0/button[Burger]:1', 'button', { name: 'Burger', text: 'Menu', visible: burgerVisible }),
    ]);
  const report = emptyReport();
  const root = mergeBreakpoints(page(tree(true, false), tree(true, false), tree(false, true)), new Map(), report);
  assert.deepEqual(find(root, (n) => n.framerName === 'Nav')!.visibility, ['base', 'tablet']);
  assert.deepEqual(find(root, (n) => n.framerName === 'Burger')!.visibility, ['mobile']);
  assert.deepEqual(
    report.keptDuplicates.map((d) => d.key).sort(),
    ['body:0/button[Burger]:1', 'body:0/nav[Nav]:0']
  );
  assert.deepEqual(
    root.children.map((c) => c.framerName),
    ['Nav', 'Burger']
  );
});

test('a property removed at a smaller breakpoint is reset with "initial"', () => {
  const tree = (width?: string) =>
    raw('body:0', 'body', {}, [raw('body:0/div[Box]:0', 'div', { name: 'Box', styles: width ? { width } : {} })]);
  const root = mergeBreakpoints(page(tree('300px'), tree('300px'), tree()), new Map(), emptyReport());
  assert.deepEqual(find(root, (n) => n.framerName === 'Box')!.styles, {
    base: { width: '300px' },
    mobile: { width: 'initial' },
  });
});

test('a hidden-* wrapper with one child and no own styles is collapsed into the child', () => {
  const tree = (visible: boolean) =>
    raw('body:0', 'body', {}, [
      raw('body:0/div:0', 'div', { attrs: { class: 'hidden-abc' }, visible }, visible
        ? [raw('body:0/div:0/nav[Nav]:0', 'nav', { name: 'Nav' })]
        : []),
    ]);
  const root = mergeBreakpoints(page(tree(true), tree(true), tree(false)), new Map(), emptyReport());
  assert.equal(root.children.length, 1);
  assert.equal(root.children[0].tag, 'nav');
  assert.deepEqual(root.children[0].visibility, ['base', 'tablet']);
});

test('start states and hover styles attach by key; images get asset info', () => {
  const tree = () =>
    raw('body:0', 'body', {}, [
      raw('body:0/p[Intro]:0', 'p', { name: 'Intro', text: 'Hello' }),
      raw('body:0/img[Hero Image]:1', 'img', {
        name: 'Hero Image',
        attrs: { src: 'https://x.test/a.png', alt: 'A', 'data-natural-width': '640', 'data-natural-height': '320' },
      }),
    ]);
  const starts = new Map([['body:0/p[Intro]:0', { kind: 'reveal' as const, from: { opacity: 0, y: 40 } }]]);
  const root = mergeBreakpoints(
    page(tree(), tree(), tree(), [{ key: 'body:0/p[Intro]:0', style: { color: '#ffffff' } }]),
    starts,
    emptyReport()
  );
  const intro = find(root, (n) => n.framerName === 'Intro')!;
  assert.deepEqual(intro.animation, { kind: 'reveal', from: { opacity: 0, y: 40 } });
  assert.deepEqual(intro.hover, { color: '#ffffff' });
  assert.deepEqual(find(root, (n) => n.tag === 'img')!.asset, {
    kind: 'image',
    src: 'https://x.test/a.png',
    width: 640,
    height: 320,
  });
});
