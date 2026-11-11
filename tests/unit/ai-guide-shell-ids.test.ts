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
