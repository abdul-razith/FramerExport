import assert from 'node:assert/strict';
import test from 'node:test';
import { planComponents } from '../../src/nextjs/components.js';
import { extractContent, ImageNamer } from '../../src/nextjs/content.js';
import { emptyReport } from '../../src/nextjs/report.js';
import type { Node, PageModel, Style } from '../../src/nextjs/model.js';

let seq = 0;
function n(tag: string, extra: Partial<Node> = {}, children: Node[] = []): Node {
  const key = `${tag}:${seq++}`;
  return { id: key, key, tag, attrs: {}, styles: { base: {} as Style }, children, ...extra };
}
const text = (tag: string, name: string | undefined, value: string) => n(tag, { framerName: name, text: value });
const image = (src: string, alt: string) =>
  n('img', { framerName: 'Image', asset: { kind: 'image', src, width: 240, height: 120 }, attrs: { alt } });
const card = (title: string, body: string, src: string) =>
  n('div', { framerName: 'Card' }, [image(src, 'Project ' + title), text('h3', 'Title', title), text('p', 'Body', body)]);
const header = () =>
  n('header', { framerName: 'Logo + Menu' }, [text('span', 'Logo', 'Nudge'), n('a', { framerName: 'About Link', text: 'About', attrs: { href: '/about' } })]);
const footer = () => n('footer', { framerName: 'Footer' }, [text('p', 'Copyright', '© Nudge')]);
const SPECIAL = 'Build {curly} <tag> "quotes" & emoji 🚀';

function page(route: string, sections: Node[]): PageModel {
  const root = n('body', {}, [n('div', { attrs: { id: 'main' } }, [n('div', { framerName: 'Desktop' }, sections)])]);
  return { route, sourceUrl: 'https://x.test' + route, title: route, meta: {}, root, screenshots: { base: '', tablet: '', mobile: '' } };
}

function build() {
  const pages = [
    page('/', [
      header(),
      n('section', { framerName: 'Hero Section' }, [
        text('h1', 'Heading', SPECIAL),
        text('span', 'Arrow', '→'),
        image('https://cdn.test/hero.png?scale=2', 'Studio desk'),
      ]),
      n('section', { framerName: 'Projects' }, [
        card('A', 'a body', 'https://cdn.test/a.png'),
        card('B', 'b body', 'https://cdn.test/b.png'),
        card('C', 'c body', 'https://cdn.test/c.png'),
      ]),
      footer(),
    ]),
    page('/about', [header(), n('section', { framerName: 'About Hero' }, [text('h1', 'Heading', 'About us')]), footer()]),
    page('/blog', [header(), n('section', { framerName: 'Blog Hero' }, [text('h1', 'Heading', 'Blog')]), footer()]),
  ];
  const report = emptyReport();
  const plan = planComponents(pages, report);
  const images = new ImageNamer();
  return { ...extractContent(plan, report, images), report, images };
}

function get(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
}

test('one content module per page plus layout', () => {
  const { files } = build();
  assert.deepEqual(files.map((f) => [f.module, f.typeName]), [
    ['home', 'HomeContent'],
    ['about', 'AboutContent'],
    ['blog', 'BlogContent'],
    ['layout', 'LayoutContent'],
  ]);
});

test('text is copied exactly, including JSX-significant characters', () => {
  const home = build().files.find((f) => f.module === 'home')!;
  assert.equal(get(home.data, 'hero.heading'), SPECIAL);
});

test('repeated components become arrays of their prop values with public image paths', () => {
  const home = build().files.find((f) => f.module === 'home')!;
  const cards = get(home.data, 'projects.cards') as Record<string, unknown>[];
  assert.equal(cards.length, 3);
  assert.deepEqual(cards[1], {
    title: 'B',
    body: 'b body',
    image: { src: '/images/project-b.png', alt: 'Project B', width: 240, height: 120 },
  });
});

test('images and links become structured values', () => {
  const { files } = build();
  const home = files.find((f) => f.module === 'home')!;
  assert.deepEqual(get(home.data, 'hero.image'), { src: '/images/studio-desk.png', alt: 'Studio desk', width: 240, height: 120 });
  const layout = files.find((f) => f.module === 'layout')!;
  assert.deepEqual(get(layout.data, 'header.aboutLink'), { label: 'About', href: '/about' });
});

test('every binding resolves inside its section content', () => {
  const { files, bindings } = build();
  const sectionData = new Map<string, unknown>();
  for (const [id, { module, key }] of bindings.section) {
    sectionData.set(id, (files.find((f) => f.module === module)!.data as Record<string, unknown>)[key]);
  }
  assert.ok(bindings.section.size >= 5);
  const all = [...bindings.text, ...bindings.image, ...bindings.href];
  assert.ok(all.length > 0);
  for (const [, rel] of all) {
    const found = [...sectionData.values()].some((d) => get(d, rel) !== undefined);
    assert.ok(found, `binding ${rel} resolves`);
  }
});

test('decorative text stays in JSX and is reported', () => {
  const { files, report, bindings } = build();
  const home = files.find((f) => f.module === 'home')!;
  assert.equal(JSON.stringify(home.data).includes('→'), false);
  assert.deepEqual(report.textExceptions, [{ route: '/', text: '→' }]);
  assert.equal([...bindings.text.values()].includes('hero.arrow'), false);
});

test('ImageNamer reuses paths per source and de-duplicates names', () => {
  const namer = new ImageNamer();
  assert.equal(namer.publicPath('https://cdn.test/x.png', 'Hero'), '/images/hero.png');
  assert.equal(namer.publicPath('https://cdn.test/x.png', 'Other'), '/images/hero.png');
  assert.equal(namer.publicPath('https://cdn.test/y.png?w=2', 'Hero'), '/images/hero-2.png');
  assert.equal(namer.publicPath('https://cdn.test/z', 'Ünïcode Name!'), '/images/unicode-name.png');
  assert.deepEqual([...namer.entries()].map(([src]) => src), ['https://cdn.test/x.png', 'https://cdn.test/y.png', 'https://cdn.test/z']);
});

test('a split-text parent is bound as one text value', () => {
  const letters = [...'Hello'].map((ch) => n('span', { text: ch }));
  const tagline = n('p', { framerName: 'Tagline', animation: { kind: 'split-text', from: { opacity: 0 } } }, letters);
  const pages = [
    page('/', [
      n('section', { framerName: 'Hero Section' }, [tagline]),
      n('section', { framerName: 'Outro' }, [text('p', 'Note', 'Bye')]),
    ]),
  ];
  const report = emptyReport();
  const { files, bindings } = extractContent(planComponents(pages, report), report, new ImageNamer());
  assert.deepEqual(files[0].data, { hero: { tagline: 'Hello' }, outro: { note: 'Bye' } });
  assert.equal(bindings.text.get(tagline.id), 'tagline');
  assert.equal(letters.some((l) => bindings.text.has(l.id)), false);
});

test('ImageNamer treats resize variants of one image as the same file', () => {
  const namer = new ImageNamer();
  assert.equal(
    namer.publicPath('https://framerusercontent.com/images/a.jpg?scale-down-to=512', 'Cover'),
    namer.publicPath('https://framerusercontent.com/images/a.jpg', 'Other')
  );
});

test('inline text segments are bound one by one around inline elements', () => {
  const link = n('a', { text: 'full story', attrs: { href: '/story' } });
  const para = n('p', { framerName: 'Read More', text: 'Read the today.', inline: ['Read the ', 0, ' today.'] }, [link]);
  const pages = [page('/', [n('section', { framerName: 'Hero Section' }, [para]), n('section', { framerName: 'Outro' }, [text('p', 'Note', 'Bye')])])];
  const report = emptyReport();
  const { files, bindings } = extractContent(planComponents(pages, report), report, new ImageNamer());
  assert.deepEqual(files[0].data.hero, { readMore: 'Read the', readMore2: 'today.', link: { label: 'full story', href: '/story' } });
  assert.equal(bindings.text.get(`${para.id}~0`), 'readMore');
  assert.equal(bindings.text.get(`${para.id}~2`), 'readMore2');
  assert.equal(bindings.text.has(para.id), false);
});
