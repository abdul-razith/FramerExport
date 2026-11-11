import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGuidePage, renderOutline } from '../../src/ai-guide/outline.js';
import { pageSlug } from '../../src/ai-guide/types.js';
import { ImageNamer } from '../../src/nextjs/content.js';
import type { Breakpoint, Node, RawNode, Style } from '../../src/nextjs/model.js';

function n(key: string, tag: string, extra: Partial<Node> = {}, children: Node[] = []): Node {
  return { id: key, key, tag, attrs: {}, styles: { base: {} as Style }, children, ...extra };
}

/** Raw tree for one breakpoint: same keys, with the given boxes. */
function raw(node: Node, boxes: Record<string, { x: number; y: number; w: number; h: number }>): RawNode {
  return {
    key: node.key,
    tag: node.tag,
    attrs: node.attrs,
    ...(node.text ? { text: node.text } : {}),
    ...(node.inline ? { inline: node.inline } : {}),
    box: boxes[node.key] ?? { x: 0, y: 0, w: 0, h: 0 },
    styles: {},
    visible: true,
    children: node.children.map((c) => raw(c, boxes)),
  };
}

function args(sections: Node[], route = '/') {
  const root = n('body:0', 'body', {}, [n('body:0/main:0', 'main', {}, sections)]);
  const sizes: Record<Breakpoint, [number, number]> = { base: [1440, 900], tablet: [1024, 780], mobile: [390, 640] };
  const trees = Object.fromEntries(
    Object.entries(sizes).map(([bp, [w, h]]) => [
      bp,
      raw(root, Object.fromEntries(sections.map((s, i) => [s.key, { x: 0, y: i * h, w, h }]))),
    ])
  ) as Record<Breakpoint, RawNode>;
  return { route, title: 'Home', exportFile: 'index.html', root, trees, images: new ImageNamer(), origin: 'https://nudge.framer.website' };
}

const hero = () =>
  n('body:0/main:0/section[Hero Section]:0', 'section', { framerName: 'Hero Section' }, [
    n('h:1', 'p', { text: 'my name is' }),
    n('h:2', 'h1', { text: 'BEJAMAN' }),
    n('h:3', 'img', { framerName: 'Avatar', attrs: { alt: 'Portrait' }, asset: { kind: 'image', src: 'https://framerusercontent.com/images/abc.png', width: 80, height: 80 } }),
    n('h:4', 'a', { text: 'Contact me', attrs: { href: 'https://nudge.framer.website/contact' } }),
  ]);
const projects = () =>
  n('body:0/main:0/section[Projects]:1', 'section', { framerName: 'Projects' }, [n('p:1', 'h2', { text: 'Featured works' })]);
const homeArgs = () => args([hero(), projects()]);

test('each top-level section becomes an outline block with text, images and links', () => {
  const page = buildGuidePage(homeArgs());
  assert.deepEqual(page.sections.map((s) => s.name), ['Hero Section', 'Projects']);
  assert.deepEqual(page.sections[0].texts, ['my name is', 'BEJAMAN']);
  assert.deepEqual(page.sections[0].links, [{ text: 'Contact me', href: '/contact' }]);
  assert.equal(page.sections[0].images[0].suggested, '/images/avatar.png');
  assert.deepEqual(page.sections[0].boxes.base, { x: 0, y: 0, w: 1440, h: 900 });
});

test('generic Framer layer names are flagged for renaming', () => {
  const page = buildGuidePage(args([n('body:0/main:0/div[Frame 12]:0', 'div', { framerName: 'Frame 12' }, [n('t', 'p', { text: 'x' })]), projects()]));
  assert.equal(page.sections[0].generic, true);
  assert.equal(page.sections[1].generic, false);
});

test('a page without detectable sections still has one section', () => {
  const root = n('body:0', 'body', { text: 'Only text' });
  const trees = { base: raw(root, {}), tablet: raw(root, {}), mobile: raw(root, {}) };
  const page = buildGuidePage({ ...homeArgs(), root, trees });
  assert.equal(page.sections.length, 1);
  assert.deepEqual(page.sections[0].texts, ['Only text']);
});

test('outline.md lists sizes per width, screenshots and content', () => {
  const md = renderOutline(buildGuidePage(homeArgs()));
  assert.match(md, /^## 01 Hero Section — 1440×900 \(tablet 1024×780, mobile 390×640\)$/m);
  assert.match(md, /screenshot: sections\/01-hero-section-\{desktop,tablet,mobile\}\.png/);
  assert.match(md, /text: "my name is" · "BEJAMAN"/);
  assert.match(md, /links: "Contact me" → \/contact/);
  assert.match(md, /export markup: index\.html, element data-framer-name="Hero Section"/);
});

test('pageSlug', () => {
  assert.equal(pageSlug('/'), 'index');
  assert.equal(pageSlug('/blog/a-post'), 'blog_a-post');
});

test('a block container marked inline keeps its children separate (texts and links)', () => {
  const nav = n('body:0/main:0/header[Logo + Menu]:0', 'header', { framerName: 'Logo + Menu', inline: ['Nudge', 0] }, [
    n('nv', 'nav', { inline: [0, 1] }, [
      n('a1', 'a', { text: 'Home', attrs: { href: '/' } }),
      n('a2', 'a', { text: 'About', attrs: { href: '/about' } }),
    ]),
  ]);
  const [s] = buildGuidePage(args([nav, projects()])).sections;
  assert.deepEqual(s.links.map((l) => l.text), ['Home', 'About']);
  assert.ok(!s.texts.some((t) => t.includes('HomeAbout')), s.texts.join(' | '));
});

test('letters split into spans inside a div are one text, and repeated images are listed once', () => {
  const letters = [...'Welcome'].map((ch, i) => n(`l${i}`, 'span', { text: ch }));
  const img = () => n(`i${Math.random()}`, 'img', { framerName: 'Item', asset: { kind: 'image', src: 'https://framerusercontent.com/images/x.png', width: 10, height: 10 } });
  const loader = n('body:0/main:0/div[Loader]:0', 'div', { framerName: 'Loader' }, [
    n('w', 'div', { inline: [0, 1, 2, 3, 4, 5, 6] }, letters),
    img(),
    img(),
  ]);
  const [s] = buildGuidePage(args([loader, projects()])).sections;
  assert.deepEqual(s.texts, ['Welcome']);
  assert.equal(s.images.length, 1);
});

test('letters split into divs are one text too', () => {
  const letters = [...'Welcome!'].map((ch, i) => n(`d${i}`, 'div', { text: ch }));
  const loader = n('body:0/main:0/div[Loader]:0', 'div', { framerName: 'Loader' }, [n('w', 'div', {}, letters)]);
  assert.deepEqual(buildGuidePage(args([loader, projects()])).sections[0].texts, ['Welcome!']);
});

test('sections come from the split parts with ids, shell parts get S ids, texts carry their widths', () => {
  const a = homeArgs();
  const desktop = n('c:1', 'h1', { text: 'Big desktop title', visibility: ['base'] });
  const small = n('c:2', 'h1', { text: 'Small title', visibility: ['tablet', 'mobile'] });
  const heroNode = n('not-captured', 'section', { framerName: 'Hero Section', attrs: { class: 'framer-text framer-abc12 hidden-x' } }, [desktop, small]);
  const header = n('hdr', 'header', { framerName: 'Header', text: 'Nudge' });
  const page = buildGuidePage({
    ...a,
    parts: [
      { node: heroNode, name: 'Hero Section' },
      { node: projects(), name: 'Projects' },
    ],
    shellParts: [{ node: header, name: 'Header' }],
  });
  assert.deepEqual(page.sections.map((s) => s.id), ['01', '02']);
  assert.equal(page.sections[0].className, 'framer-abc12');
  assert.deepEqual(page.sections[0].widthsOf['Small title'], ['tablet', 'mobile']);
  assert.deepEqual(page.sections[0].widthsOf['Big desktop title'], ['base']);
  assert.deepEqual(page.shell?.map((s) => [s.id, s.name, s.shell]), [['S1', 'Header', true]]);
});

test('texts come from each width’s capture, so a copy shown only on mobile is kept with its widths', () => {
  const a = homeArgs();
  const heroNode = n('S', 'section', { framerName: 'Hero' }, [n('S/d', 'h1', { text: 'Big desktop title' })]);
  const rawHero = (bp: 'base' | 'tablet' | 'mobile'): RawNode => ({
    key: 'S', tag: 'section', attrs: {}, box: { x: 0, y: 0, w: 100, h: 100 }, styles: {}, visible: true,
    children: [
      { key: 'S/d', tag: 'h1', attrs: {}, text: 'Big desktop title', box: { x: 0, y: 0, w: 10, h: 10 }, styles: {}, visible: bp === 'base', children: [] },
      { key: 'S/m', tag: 'h1', attrs: {}, text: 'Small title', box: { x: 0, y: 0, w: 10, h: 10 }, styles: {}, visible: bp !== 'base', children: [] },
      { key: 'S/r', tag: 'div', attrs: {}, box: { x: 0, y: 0, w: 10, h: 10 }, styles: {}, visible: true, inline: [0, ' ', 1, ' ', 2, ' ', 3],
        children: ['0', '100', '200', '300'].map((t, i) => ({ key: `S/r/${i}`, tag: 'span', attrs: {}, text: t, box: { x: 0, y: 0, w: 5, h: 5 }, styles: {}, visible: true, children: [] })) },
    ],
  });
  const trees = { base: rawHero('base'), tablet: rawHero('tablet'), mobile: rawHero('mobile') };
  const page = buildGuidePage({ ...a, trees, parts: [{ node: heroNode, name: 'Hero' }] });
  const s = page.sections[0];
  assert.deepEqual(s.widthsOf['Small title'], ['tablet', 'mobile']);
  assert.deepEqual(s.widthsOf['Big desktop title'], ['base']);
  assert.deepEqual(s.decorations, ['ruler 0–300']);
  assert.ok(!s.texts.some((t) => /^\d+$/.test(t) || t.includes('0100')), s.texts.join(' | '));
});

test('a code component container class is the section class', () => {
  const node = n('cc', 'div', { attrs: { class: 'framer-b1hv7o-container' } }, [n('cc/t', 'p', { text: 'x' })]);
  const page = buildGuidePage({ ...homeArgs(), parts: [{ node, name: 'Grid' }] });
  assert.equal(page.sections[0].className, 'framer-b1hv7o-container');
});
