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
