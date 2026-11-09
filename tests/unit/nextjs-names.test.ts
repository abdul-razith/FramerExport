import assert from 'node:assert/strict';
import test from 'node:test';
import { componentName, NameRegistry, roleOf, toCamel, toPascal, toSlug } from '../../src/nextjs/framer/names.js';
import type { Node } from '../../src/nextjs/model.js';

const node = (tag: string, extra: Partial<Node> = {}, children: Node[] = []): Node => ({
  id: tag,
  key: tag,
  tag,
  attrs: {},
  styles: { base: {} },
  children,
  ...extra,
});

test('toPascal / toCamel build valid identifiers', () => {
  assert.equal(toPascal('Hero Section'), 'HeroSection');
  assert.equal(toPascal('Logo + Menu'), 'LogoMenu');
  assert.equal(toPascal('20% Space'), 'X20Space');
  assert.equal(toCamel('Text + date'), 'textDate');
  assert.equal(toCamel('20% Space'), 'x20Space');
});

test('toSlug transliterates and falls back to "item"', () => {
  assert.equal(toSlug('Ünïcode Post Title!'), 'unicode-post-title');
  assert.equal(toSlug('  '), 'item');
});

test('componentName strips Section/Container and keeps meaningful layer names', () => {
  assert.deepEqual(componentName(node('section', { framerName: 'Hero Section' }), ''), { name: 'Hero', fallback: false });
  assert.deepEqual(componentName(node('div', { framerName: 'Logo + Menu' }), ''), { name: 'LogoMenu', fallback: false });
});

test('generic layer names fall back to section + role', () => {
  const img = node('img', { framerName: 'Frame', asset: { kind: 'image', src: 'a.png', width: 1, height: 1 } });
  assert.deepEqual(componentName(img, 'Hero'), { name: 'HeroImage', fallback: true });
  assert.deepEqual(componentName(node('section', { framerName: 'Content' }), ''), { name: 'Content', fallback: true });
});

test('roleOf classifies nodes', () => {
  assert.equal(roleOf(node('h2', { text: 'x' })), 'Heading');
  assert.equal(roleOf(node('ul')), 'List');
  assert.equal(roleOf(node('a', { text: 'Go' })), 'Button');
  assert.equal(roleOf(node('p', { text: 'x' })), 'Text');
  assert.equal(
    roleOf(node('div', {}, [node('img', { asset: { kind: 'image', src: '', width: 1, height: 1 } }), node('h3', { text: 't' })])),
    'Card'
  );
  assert.equal(roleOf(node('div')), 'Group');
});

test('NameRegistry adds numeric suffixes', () => {
  const reg = new NameRegistry();
  assert.equal(reg.unique('Content'), 'Content');
  assert.equal(reg.unique('Content'), 'Content2');
  assert.equal(reg.unique('Content'), 'Content3');
});
