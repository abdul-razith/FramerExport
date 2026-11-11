import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assignShellIds } from '../../src/ai-guide/shell-ids.js';

test('shell parts get one id per structure, shared across pages, first page owns each part', () => {
  const { ids, owners } = assignShellIds([
    { route: '/', hashes: ['grid', 'header', 'badge'] },
    { route: '/about', hashes: ['header', 'grid', 'menu'] },
    { route: '/play', hashes: ['menu', 'badge'] },
  ]);
  assert.deepEqual(ids, [['S1', 'S2', 'S3'], ['S2', 'S1', 'S4'], ['S4', 'S3']]);
  assert.deepEqual(owners, [
    { route: '/', index: 0, id: 'S1' },
    { route: '/', index: 1, id: 'S2' },
    { route: '/', index: 2, id: 'S3' },
    { route: '/about', index: 2, id: 'S4' },
  ]);
});

test('two parts with the same structure on one page get their own ids', () => {
  const { ids } = assignShellIds([
    { route: '/', hashes: ['dot', 'dot'] },
    { route: '/a', hashes: ['dot', 'dot'] },
  ]);
  assert.deepEqual(ids, [['S1', 'S2'], ['S1', 'S2']]);
});

test('a shell part is recognised across pages by its Framer class, even when its size differs', async () => {
  const { shellKey } = await import('../../src/ai-guide/shell-ids.js');
  const node = (cls: string, h: string) => ({ id: 'x', key: 'x', tag: 'div', attrs: { class: cls }, styles: { base: { height: h } }, children: [] });
  assert.equal(shellKey(node('framer-b1hv7o-container', '5000px')), shellKey(node('framer-b1hv7o-container', '7000px')));
  assert.notEqual(shellKey(node('framer-aaa', '1px')), shellKey(node('framer-bbb', '1px')));
  assert.equal(shellKey(node('', '1px')), shellKey(node('', '1px')));
});

test('a shell part without a Framer class is recognised by its name, text and size', async () => {
  const { shellKey } = await import('../../src/ai-guide/shell-ids.js');
  const badge = (top: string) => ({
    id: 'b', key: 'b', tag: 'a', framerName: 'Section', attrs: { href: '/buy' }, styles: { base: { top } },
    children: [{ id: 't', key: 't', tag: 'span', text: 'BUY NUDGE', attrs: {}, styles: { base: {} }, children: [] }],
  });
  const box = { x: 0, y: 0, w: 150, h: 40 };
  assert.equal(shellKey(badge('10px'), box), shellKey(badge('900px'), box));
  assert.notEqual(shellKey(badge('10px'), box), shellKey(badge('10px'), { ...box, w: 300 }));
});
