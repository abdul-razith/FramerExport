import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectionDir,
  collectionRoutes,
  detectCollections,
  escapeMdx,
  toIsoDate,
} from '../../src/nextjs/framer/collections.js';
import type { Node, PageModel } from '../../src/nextjs/model.js';

let seq = 0;
function n(tag: string, extra: Partial<Node> = {}, children: Node[] = []): Node {
  const key = `${tag}:${seq++}`;
  return { id: key, key, tag, attrs: {}, styles: { base: {} }, children, ...extra };
}
function page(route: string, sectionNames: string[]): PageModel {
  const sections = sectionNames.map((name) => n('section', { framerName: name }, [n('p', { text: name })]));
  const root = n('body', {}, [n('div', { attrs: { id: 'main' } }, [n('div', { framerName: 'Desktop' }, sections)])]);
  return { route, sourceUrl: 'https://x.test' + route, title: route, meta: {}, root, screenshots: { base: '', tablet: '', mobile: '' } };
}

test('detectCollections finds item routes that share a template under an existing index', () => {
  const pages = [
    page('/', ['Header', 'Hero', 'Footer']),
    page('/blog', ['Header', 'Blog Hero', 'Posts', 'Footer']),
    page('/blog/post-a', ['Header', 'Post Header', 'Post Body', 'Footer']),
    page('/blog/post-b', ['Header', 'Post Header', 'Post Body', 'Footer']),
    page('/case-study', ['Header', 'Cases', 'Footer']),
    page('/case-study/only-one', ['Header', 'Case Header', 'Footer']),
    page('/docs/a', ['Header', 'Doc', 'Footer']),
    page('/docs/b', ['Header', 'Doc', 'Footer']),
  ];
  const cs = detectCollections(pages);
  assert.deepEqual(
    cs.map((c) => [c.name, c.dir, c.indexRoute, c.itemRoutes]),
    [['blog', 'blog', '/blog', ['/blog/post-a', '/blog/post-b']]]
  );
  assert.deepEqual([...collectionRoutes(cs)], ['/blog/post-a', '/blog/post-b']);
});

test('items with different templates are not a collection', () => {
  const pages = [
    page('/work', ['Header', 'Footer']),
    page('/work/a', ['Header', 'Alpha', 'Beta', 'Gamma', 'Footer']),
    page('/work/b', ['Header', 'Delta', 'Epsilon', 'Zeta', 'Footer']),
  ];
  assert.deepEqual(detectCollections(pages), []);
});

test('collectionDir pluralises URL segments', () => {
  assert.equal(collectionDir('blog'), 'blog');
  assert.equal(collectionDir('case-study'), 'case-studies');
  assert.equal(collectionDir('project'), 'projects');
  assert.equal(collectionDir('news'), 'news');
});

test('toIsoDate understands day-month-year and month-day-year', () => {
  assert.equal(toIsoDate('12 March 2025'), '2025-03-12');
  assert.equal(toIsoDate('Published April 3, 2025'), '2025-04-03');
  assert.equal(toIsoDate('no date here'), undefined);
});

test('escapeMdx escapes braces and angle brackets', () => {
  assert.equal(escapeMdx('Use {x} and a < b'), 'Use \\{x\\} and a \\< b');
});

test('a title Framer splits into word and letter spans is one field with the whole text', async () => {
  const { itemToMdx } = await import('../../src/nextjs/framer/collections.js');
  const { ImageNamer } = await import('../../src/nextjs/content.js');
  const word = (w: string) => n('span', { inline: Array.from(w).map((_, i) => i) }, Array.from(w).map((ch) => n('span', { text: ch })));
  const itemPage = (route: string, words: string[]) => {
    const h1 = n('h1', { inline: words.flatMap((_, i) => (i ? [' ', i] : [i])) }, words.map(word));
    const p = page(route, ['Header', 'Post Header', 'Post Body', 'Footer']);
    const header = (p.root.children[0].children[0].children[1]);
    header.children = [h1, n('p', { text: route.endsWith('a') ? '12 March 2025' : '3 May 2025' })];
    const rekey = (node: Node, key: string) => {
      node.key = key;
      node.children.forEach((c, i) => rekey(c, `${key}/${c.tag}:${i}`));
    };
    rekey(p.root, 'body:0');
    return p;
  };
  const pages = [
    page('/blog', ['Header', 'Posts', 'Footer']),
    itemPage('/blog/post-a', ['A', 'Greener', 'Workspace']),
    itemPage('/blog/post-b', ['Ideas', 'Need', 'Silence']),
  ];
  const [c] = detectCollections(pages);
  assert.deepEqual(c.fields.map((f) => [f.key, f.kind]), [['title', 'text'], ['text', 'date']]);
  const mdx = itemToMdx(pages[1], c, { exportHtml: '', images: new ImageNamer(), usedSlugs: new Set() });
  assert.deepEqual(mdx.metadata, { title: 'A Greener Workspace', text: '2025-03-12' });
});
