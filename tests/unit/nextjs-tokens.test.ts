import assert from 'node:assert/strict';
import test from 'node:test';
import { collectTokens, nameColor, normalizeColor } from '../../src/nextjs/tokens.js';
import type { Node, Style } from '../../src/nextjs/model.js';

let seq = 0;
function node(tag: string, base: Style, children: Node[] = [], extra: Partial<Node> = {}): Node {
  const key = `${tag}:${seq++}`;
  return { id: key, key, tag, attrs: {}, styles: { base }, children, ...extra };
}

test('nameColor uses hue family and lightness step', () => {
  assert.equal(nameColor('#133324'), 'green-900');
  assert.equal(nameColor('#a1dfc5'), 'green-200');
  assert.equal(nameColor('#9a9da6'), 'neutral-400');
  assert.equal(nameColor('#ffffff'), 'white');
  assert.equal(nameColor('#000000'), 'black');
  assert.equal(nameColor('#ffffff1a'), 'white-a10');
  assert.equal(nameColor('#ff7373'), 'red-300');
});

test('normalizeColor converts rgb/rgba/short hex to lowercase hex', () => {
  assert.equal(normalizeColor('rgb(19, 51, 36)'), '#133324');
  assert.equal(normalizeColor('rgba(255, 255, 255, 0.1)'), '#ffffff1a');
  assert.equal(normalizeColor('#FFF'), '#ffffff');
  assert.equal(normalizeColor('rgba(0, 0, 0, 1)'), '#000000');
});

test('collectTokens gathers colours, fonts, radii and shadows', () => {
  const card = (bg: string) =>
    node('div', { 'background-color': bg, 'border-top-left-radius': '16px', 'border-top-right-radius': '16px', 'border-bottom-right-radius': '16px', 'border-bottom-left-radius': '16px' });
  const root = node(
    'body',
    { 'font-family': '"Inter Display", "Inter Display Placeholder", sans-serif', color: 'rgb(19, 51, 36)', 'background-color': 'rgb(161, 223, 197)' },
    [
      node('h1', {}, []),
      node('code', { 'font-family': '"DM Mono", monospace' }),
      card('rgb(255, 255, 255)'),
      card('rgba(255, 255, 255, 0.1)'),
      card('rgba(0, 0, 0, 0)'),
    ]
  );
  const tokens = collectTokens([root]);
  assert.deepEqual(tokens.colors, {
    'green-900': '#133324',
    'green-200': '#a1dfc5',
    white: '#ffffff',
    'white-a10': '#ffffff1a',
  });
  assert.equal(tokens.colorByValue.get('#ffffff1a'), 'white-a10');
  assert.equal(tokens.fonts.display, '"Inter Display"');
  assert.equal(tokens.fonts.mono, '"DM Mono"');
  assert.equal(tokens.fontByFamily.get('Inter Display'), 'display');
  assert.deepEqual(tokens.radii, { 'radius-1': '16px' });
  assert.equal(tokens.radiusByValue.get('16px'), 'radius-1');
});

test('two different colours with the same generated name get numbered', () => {
  const root = node('body', { color: '#133324' }, [node('p', { color: '#12301f' })]);
  const tokens = collectTokens([root]);
  assert.deepEqual(Object.keys(tokens.colors), ['green-900', 'green-900-2']);
});

test('generic font families are not quoted', () => {
  const tokens = collectTokens([node('body', { 'font-family': 'sans-serif' }, [node('code', { 'font-family': 'monospace' })])]);
  assert.ok(Object.values(tokens.fonts).includes('sans-serif'));
  assert.ok(Object.values(tokens.fonts).includes('monospace'));
});
