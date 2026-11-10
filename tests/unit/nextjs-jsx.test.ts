import assert from 'node:assert/strict';
import test from 'node:test';
import { escapeJsxText, renderNode, type JsxContext } from '../../src/nextjs/emit/jsx.js';
import { attachMotion } from '../../src/nextjs/framer/motion-map.js';
import { collectTokens } from '../../src/nextjs/tokens.js';
import type { Node } from '../../src/nextjs/model.js';
import type { ContentBindings } from '../../src/nextjs/content.js';

let seq = 0;
function n(tag: string, extra: Partial<Node> = {}, children: Node[] = []): Node {
  const key = `${tag}:${seq++}`;
  return { id: key, key, tag, attrs: {}, styles: { base: {} }, children, ...extra };
}

function bindings(): ContentBindings {
  return { section: new Map(), text: new Map(), image: new Map(), href: new Map(), instance: new Map() };
}

function ctx(extra: Partial<JsxContext> = {}): JsxContext {
  return {
    tokens: collectTokens([]),
    contentVar: 'content',
    bindings: bindings(),
    components: new Map(),
    imports: new Set(),
    siteOrigin: 'https://nudge.test',
    ...extra,
  };
}

test('escapeJsxText uses a string literal only when needed', () => {
  assert.equal(escapeJsxText('a {b} <c> "d" 🚀'), '{"a {b} <c> \\"d\\" 🚀"}');
  assert.equal(escapeJsxText('plain'), 'plain');
});

test('bound text renders as a content expression with Tailwind classes', () => {
  const h1 = n('h1', { text: 'Hello', styles: { base: { 'font-size': '72px' }, mobile: { 'font-size': '48px' } } });
  const c = ctx();
  c.bindings!.text.set(h1.id, 'heading');
  assert.equal(renderNode(h1, c), '<h1 className="text-7xl mobile:text-5xl">{content.heading}</h1>');
});

test('unbound text is escaped', () => {
  assert.equal(renderNode(n('span', { text: '{x} → <y>' }), ctx()), '<span>{"{x} → <y>"}</span>');
});

test('images render with next/image', () => {
  const img = n('img', { asset: { kind: 'image', src: 'https://cdn/x.png', width: 10, height: 5 }, attrs: { alt: 'x' } });
  const c = ctx();
  c.bindings!.image.set(img.id, 'image');
  const out = renderNode(img, c);
  assert.equal(out, '<Image src={content.image.src} alt={content.image.alt} width={content.image.width} height={content.image.height} />');
  assert.ok(c.imports.has("import Image from 'next/image';"));
});

test('same-origin links use next/link, external links stay anchors', () => {
  const internal = n('a', { text: 'About', attrs: { href: 'https://nudge.test/about' } });
  const external = n('a', { text: 'Docs', attrs: { href: 'https://example.com/x', target: '_blank', rel: 'noopener' } });
  const c = ctx();
  c.bindings!.text.set(internal.id, 'about.label');
  c.bindings!.href.set(internal.id, 'about.href');
  assert.equal(renderNode(internal, c), '<Link href={content.about.href}>{content.about.label}</Link>');
  assert.ok(c.imports.has("import Link from 'next/link';"));
  assert.equal(renderNode(external, ctx()), '<a href="https://example.com/x" target="_blank" rel="noopener">Docs</a>');
});

test('framer attributes, classes and inline styles are never emitted', () => {
  const div = n('div', {
    framerName: 'Box',
    attrs: { class: 'framer-abc hidden-x', 'data-framer-name': 'Box', style: 'color:red', 'aria-label': 'Box', id: 'x1' },
  });
  const out = renderNode(div, ctx());
  assert.doesNotMatch(out, /data-framer|framer-|style=|class=/);
  assert.match(out, /aria-label="Box"/);
});

test('motion wrappers and split text', () => {
  const reveal = n('p', { text: 'Hi', animation: { kind: 'reveal', from: { opacity: 0, y: 40 } } });
  const letters = [...'Hello'].map((ch) => n('span', { text: ch }));
  const split = n('p', { animation: { kind: 'split-text', from: { opacity: 0, x: 40, scale: 0.9 } } }, letters);
  const smooth = n('div', { framerName: 'Smooth Scroll' });
  const root = attachMotion(n('section', {}, [reveal, split, smooth]));
  const c = ctx();
  c.bindings!.text.set(reveal.id, 'intro');
  c.bindings!.text.set(split.id, 'tagline');
  const out = renderNode(root, c);
  assert.match(
    out,
    /<motion\.p initial=\{\{ opacity: 0, y: 40 \}\} whileInView=\{\{ opacity: 1, y: 0 \}\} viewport=\{\{ once: true \}\} transition=\{reveal\}>\{content\.intro\}<\/motion\.p>/
  );
  assert.match(out, /<SplitText as="p" text=\{content\.tagline\} from=\{\{ opacity: 0, x: 40, scale: 0\.9 \}\} \/>/);
  assert.doesNotMatch(out, /Smooth/);
  assert.ok(c.imports.has("import * as motion from 'motion/react-client';"));
  assert.ok(c.imports.has("import { reveal } from '@/components/motion/config';"));
  assert.ok(c.imports.has("import { SplitText } from '@/components/motion/SplitText';"));
});

test('revealed images and links use motion-wrapped next components', () => {
  const img = n('img', {
    asset: { kind: 'image', src: 'x', width: 1, height: 1 },
    motion: { kind: 'reveal', from: { opacity: 0 } },
  });
  const c = ctx();
  c.bindings!.image.set(img.id, 'image');
  assert.equal(
    renderNode(img, c),
    '<MotionImage initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={reveal} src={content.image.src} alt={content.image.alt} width={content.image.width} height={content.image.height} />'
  );
  assert.ok(c.imports.has("import { MotionImage } from '@/components/motion/MotionImage';"));
});

test('consecutive component instances render as a map over the content array', () => {
  const cards = [0, 1, 2].map(() => n('div', {}, [n('h3', { text: 't' })]));
  const section = n('section', {}, cards);
  const c = ctx();
  cards.forEach((card, i) => {
    c.components.set(card.id, 'Card');
    c.bindings!.instance.set(card.id, { array: 'cards', index: i });
  });
  assert.equal(
    renderNode(section, c),
    '<section>{content.cards.map((item, i) => <Card key={i} {...item} />)}</section>'
  );
  assert.ok(c.imports.has("import { Card } from '@/components/ui/Card';"));
});

test('UI template mode renders props', () => {
  const img = n('img', { asset: { kind: 'image', src: 'x', width: 1, height: 1 } });
  const title = n('h3', { text: 'A' });
  const fixed = n('span', { text: 'Read' });
  const card = n('div', {}, [img, title, fixed]);
  const c = ctx({
    bindings: undefined,
    props: new Map([
      [img.id, { kind: 'image' as const, name: 'image' }],
      [title.id, { kind: 'text' as const, name: 'title' }],
    ]),
  });
  assert.equal(
    renderNode(card, c),
    '<div><Image src={image.src} alt={image.alt} width={image.width} height={image.height} /><h3>{title}</h3><span>Read</span></div>'
  );
});

test('behaviour markers keep their place in the layout as empty hidden elements', () => {
  const marker = attachMotion(n('div', { framerName: 'Smooth Scroll', styles: { base: { width: '0px' } } }));
  assert.equal(renderNode(marker, ctx()), '<div aria-hidden="true" className="w-0" />');
});

test('image overrides can replace alt text', () => {
  const img = n('img', { asset: { kind: 'image', src: 'x', width: 4, height: 2 }, attrs: { alt: 'Old' } });
  const c = ctx({ overrides: new Map([[img.id, { image: 'metadata.cover', alt: 'metadata.title' }]]) });
  assert.equal(renderNode(img, c), '<Image src={metadata.cover} alt={metadata.title} width={4} height={2} />');
});

test('numeric attributes are emitted as numbers', () => {
  assert.equal(renderNode(n('div', { attrs: { tabindex: '-1' } }), ctx()), '<div tabIndex={-1} />');
});

test('a component instance without content binding renders inline instead of a prop-less component', () => {
  const inner = n('div', {}, [n('span', { text: 'x' })]);
  const c = ctx({ bindings: undefined, props: new Map() });
  c.components.set(inner.id, 'Badge');
  assert.equal(renderNode(n('section', {}, [inner]), c), '<section><div><span>x</span></div></section>');
});

test('block elements inside text elements become spans so the HTML stays valid', () => {
  const inner = n('div', {}, [n('div', { text: 'x', styles: { base: { display: 'flex' } } })]);
  const out = renderNode(n('p', {}, [inner]), ctx());
  assert.equal(out, '<p><span className="block"><span className="flex">x</span></span></p>');
});

test('divs outside text elements stay divs', () => {
  assert.equal(renderNode(n('section', {}, [n('div', { text: 'x' })]), ctx()), '<section><div>x</div></section>');
});

test('images without a content binding use a local path, never the remote Framer URL', () => {
  const img = n('img', { asset: { kind: 'image', src: 'https://framerusercontent.com/images/a.png?w=2', width: 4, height: 2 }, attrs: { alt: 'Logo' } });
  const c = ctx({ bindings: undefined, localImage: (src, alt) => (src.includes('a.png') ? `/images/${alt.toLowerCase()}.png` : '') });
  assert.equal(renderNode(img, c), '<Image src="/images/logo.png" alt="Logo" width={4} height={2} />');
});

test('inline content renders in order with its spaces', () => {
  const link = n('a', { text: 'full story', attrs: { href: 'https://example.com/x' } });
  const para = n('p', { text: 'Read the today.', inline: ['Read the ', 0, ' today.'] }, [link]);
  const c = ctx();
  c.bindings!.text.set(`${para.id}~0`, 'read');
  assert.equal(
    renderNode(para, c),
    '<p>{content.read}{" "}<a href="https://example.com/x">full story</a>{" today."}</p>'
  );
});

test('scroll effects inside text elements use a span wrapper', () => {
  const word = n('span', { text: 'x', motion: { kind: 'scroll', scroll: [{ property: 'opacity', values: ['0', '1'] }] } });
  const out = renderNode(n('p', {}, [word]), ctx());
  assert.match(out, /<ScrollEffect as="span" values=/);
  const block = n('div', { text: 'y', motion: { kind: 'scroll', scroll: [{ property: 'opacity', values: ['0', '1'] }] } });
  assert.doesNotMatch(renderNode(n('section', {}, [block]), ctx()), /as="span"/);
});

test('a collection override replaces a split text as a whole', () => {
  const span = (t: string): Node => ({ id: `s-${t}`, key: `s-${t}`, tag: 'span', attrs: {}, styles: { base: {} }, children: [], text: t });
  const h1: Node = { id: 'h', key: 'h', tag: 'h1', attrs: {}, styles: { base: {} }, children: [span('A'), span('B')], inline: [0, ' ', 1] };
  const out = renderNode(h1, {
    tokens: { colorByValue: new Map(), colors: [], fonts: [], radii: [], shadows: [] } as never,
    contentVar: 'content',
    components: new Map(),
    imports: new Set(),
    siteOrigin: 'https://x.test',
    overrides: new Map([['h', { text: 'entry.metadata.title' }]]),
  });
  assert.equal(out, '<h1>{entry.metadata.title}</h1>');
});
