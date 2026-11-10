import assert from 'node:assert/strict';
import test from 'node:test';
import { pageStructure, planComponents, structuralHash } from '../../src/nextjs/components.js';
import { emptyReport } from '../../src/nextjs/report.js';
import type { Node, PageModel, Style } from '../../src/nextjs/model.js';

let seq = 0;
function n(tag: string, extra: Partial<Node> = {}, children: Node[] = []): Node {
  const key = `${tag}:${seq++}`;
  return { id: key, key, tag, attrs: {}, styles: { base: {} as Style }, children, ...extra };
}
const text = (tag: string, name: string, value: string, styles: Style = {}) =>
  n(tag, { framerName: name, text: value, styles: { base: styles } });
const image = (src: string) =>
  n('img', { framerName: 'Image', asset: { kind: 'image', src, width: 240, height: 120 }, attrs: { alt: src } });

const card = (title: string, body: string, src: string) =>
  n('div', { framerName: 'Card', styles: { base: { display: 'flex' } } }, [
    image(src),
    text('h3', 'Title', title, { 'font-size': '24px' }),
    text('p', 'Body', body),
  ]);
const header = () =>
  n('header', { framerName: 'Logo + Menu' }, [text('span', 'Logo', 'Nudge'), n('nav', { framerName: 'Nav' }, [text('a', 'Link', 'Home', {})])]);
const footer = () => n('footer', { framerName: 'Footer' }, [text('p', 'Copyright', '© Nudge')]);

function page(route: string, sections: Node[]): PageModel {
  const root = n('body', {}, [n('div', { attrs: { id: 'main' } }, [n('div', { framerName: 'Desktop' }, sections)])]);
  return { route, sourceUrl: 'https://x.test' + route, title: route, meta: {}, root, screenshots: { base: '', tablet: '', mobile: '' } };
}

function pages(): PageModel[] {
  return [
    page('/', [
      header(),
      n('section', { framerName: 'Hero Section' }, [text('h1', 'Heading', 'Hello')]),
      n('section', { framerName: 'Projects' }, [card('A', 'a body', 'a.png'), card('B', 'b body', 'b.png'), card('C', 'c body', 'c.png')]),
      n('section', { framerName: 'Content' }, [text('p', 'Text', 'First')]),
      n('section', { framerName: 'Content' }, [text('p', 'Text', 'Second'), text('p', 'Text', 'Extra')]),
      footer(),
    ]),
    page('/about', [header(), n('section', { framerName: 'Hero Section' }, [text('h1', 'Heading', 'About'), text('p', 'Intro', 'x')]), footer()]),
  ];
}

test('structuralHash ignores text and image sources but not structure', () => {
  assert.equal(structuralHash(card('A', 'x', 'a.png')), structuralHash(card('B', 'y', 'b.png')));
  const extra = card('A', 'x', 'a.png');
  extra.children.push(text('span', 'Tag', 't'));
  assert.notEqual(structuralHash(extra), structuralHash(card('A', 'x', 'a.png')));
});

test('planComponents detects shared header and footer', () => {
  const plan = planComponents(pages(), emptyReport());
  assert.equal(plan.layout.header?.name, 'Header');
  assert.equal(plan.layout.footer?.name, 'Footer');
  assert.deepEqual(
    plan.pages.map((p) => [p.route, p.sections.map((s) => s.name)]),
    [
      ['/', ['Hero', 'Projects', 'Content', 'Content2']],
      ['/about', ['AboutHero']],
    ]
  );
});

test('repeated cards become one UI component with text and image props', () => {
  const plan = planComponents(pages(), emptyReport());
  assert.equal(plan.ui.length, 1);
  const cardComp = plan.ui[0];
  assert.equal(cardComp.name, 'Card');
  assert.deepEqual(
    cardComp.props.map((p) => [p.name, p.kind, p.path]),
    [
      ['title', 'text', [1]],
      ['body', 'text', [2]],
      ['image', 'image', [0]],
    ]
  );
  assert.equal(cardComp.instances.length, 3);
  assert.deepEqual(cardComp.instances[1].values, {
    title: 'B',
    body: 'b body',
    image: { src: 'b.png', alt: 'b.png', width: 240, height: 120 },
  });
});

test('generic and colliding names are reported as fallbacks', () => {
  const report = emptyReport();
  planComponents(pages(), report);
  assert.deepEqual(
    report.fallbackNames.map((f) => f.name),
    ['Content', 'Content2']
  );
});

test('behaviour marker sections get an Anchor name instead of clashing with motion components', () => {
  const marker = n('div', { framerName: 'Smooth Scroll', motion: { kind: 'smooth-scroll' } });
  const plan = planComponents([page('/', [header(), n('section', { framerName: 'Hero Section' }, [text('h1', 'Heading', 'x')]), marker, footer()])], emptyReport());
  assert.deepEqual(plan.pages[0].sections.map((s) => s.name), ['Hero', 'SmoothScrollAnchor']);
});

test('generic repeated fragments that are not siblings stay inline', () => {
  const frag = () => n('div', { framerName: 'Frame' }, [text('span', 'Text', 'a'), text('span', 'Text', 'b'), text('span', 'Text', 'c')]);
  const plan = planComponents(
    [page('/', [header(), n('section', { framerName: 'One' }, [frag(), text('p', 'X', 'x')]), n('section', { framerName: 'Two' }, [text('p', 'Y', 'y'), frag()]), footer()])],
    emptyReport()
  );
  assert.deepEqual(plan.ui.map((u) => u.name), []);
});

test('generic repeated siblings still become a list component', () => {
  const item = (t: string) => n('div', { framerName: 'Frame' }, [text('h3', 'Title', t), text('p', 'Body', t)]);
  const plan = planComponents([page('/', [header(), n('section', { framerName: 'Features' }, [item('a'), item('b'), item('c')]), text('p', 'Z', 'z'), footer()])], emptyReport());
  assert.equal(plan.ui.length, 1);
  assert.equal(plan.ui[0].instances.length, 3);
});

test('nodes that differ only by their SVG drawing are not the same component', () => {
  const icon = (svg: string) => n('svg', { asset: { kind: 'svg', src: '', width: 16, height: 16 }, attrs: { 'data-svg': svg } });
  const a = n('a', { framerName: 'Nav Item' }, [icon('<svg><path d="M0 0h1"/></svg>'), text('span', 'Label', 'Home')]);
  const b = n('a', { framerName: 'Nav Item' }, [icon('<svg><path d="M1 1h2"/></svg>'), text('span', 'Label', 'About')]);
  assert.notEqual(structuralHash(a), structuralHash(b));
});

function framerPage(route: string, sections: Node[]): PageModel {
  const fixed = (name: string, kids: Node[]) => n('div', { framerName: name, styles: { base: { position: 'fixed' } } }, kids);
  const root = n('body', {}, [
    n('div', { attrs: { id: 'main' } }, [
      n('div', { framerName: 'Desktop', styles: { base: { position: 'relative' } } }, sections),
      n('div', { attrs: { id: 'template-overlay' } }),
      fixed('Cursor', [text('p', 'Label', 'You')]),
    ]),
    n('div', { attrs: { id: '__framer-badge-container' }, styles: { base: { position: 'fixed' } } }, [n('a', { text: 'Made in Framer', attrs: { href: 'https://www.framer.com/' } })]),
    n('div', { attrs: { id: 'svg-templates' }, styles: { base: { position: 'absolute' } } }),
    fixed('Buy Button', [n('a', { text: 'Buy Nudge', attrs: { href: 'https://x.test/buy' } })]),
    n('iframe', { attrs: { id: '__framer-editorbar' } }),
  ]);
  return { route, sourceUrl: 'https://x.test' + route, title: route, meta: {}, root, screenshots: { base: '', tablet: '', mobile: '' } };
}

test('real Framer pages: sections are found inside #main, overlays go to the layout, Framer chrome is dropped', () => {
  const plan = planComponents(
    [
      framerPage('/', [header(), n('section', { framerName: 'Hero Section' }, [text('h1', 'Heading', 'Hi')]), footer()]),
      framerPage('/about', [header(), n('section', { framerName: 'About Hero' }, [text('h1', 'Heading', 'About')]), footer()]),
    ],
    emptyReport()
  );
  assert.equal(plan.layout.header?.name, 'Header');
  assert.equal(plan.layout.footer?.name, 'Footer');
  assert.deepEqual(plan.pages.map((p) => p.sections.map((s) => s.name)), [['Hero'], ['AboutHero']]);
  assert.deepEqual(plan.layout.overlays?.map((o) => o.name).sort(), ['BuyButton', 'Cursor']);
  const all = JSON.stringify(plan, (k, v) => (k === 'children' && Array.isArray(v) ? v.map((c: Node) => c.attrs?.id) : v));
  assert.doesNotMatch(all, /__framer-badge|__framer-editorbar/);
});

test('absolutely positioned content stops the search for the section container', () => {
  const board = n('div', { framerName: 'Board', styles: { base: { position: 'absolute' } } }, [image('photo.png')]);
  const wrapper = n('div', { styles: { base: { position: 'relative' } } }, [text('p', 'Hint', 'Drag the photos'), text('p', 'Hint2', 'Have fun')]);
  const root = n('body', {}, [n('div', { attrs: { id: 'main' } }, [n('div', { framerName: 'Desktop' }, [board, wrapper])])]);
  const s = pageStructure(root);
  assert.equal(s.content.framerName, 'Desktop');
  assert.deepEqual(s.overlays, []);
});
