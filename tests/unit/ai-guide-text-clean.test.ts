import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanTexts } from '../../src/ai-guide/text-clean.js';

const all = ['base', 'tablet', 'mobile'] as const;
const item = (text: string, widths: readonly string[] = all, key = text) => ({ text, widths: [...widths] as ('base' | 'tablet' | 'mobile')[], key });

test('ruler numbers become one decoration', () => {
  const nums = Array.from({ length: 15 }, (_, i) => item(String(i * 100), all, `r${i}`));
  const out = cleanTexts([item('Hello'), ...nums, item('Bye')], new Map());
  assert.deepEqual(out.decorations, ['ruler 0–1400']);
  assert.deepEqual(out.texts.map((t) => t.text), ['Hello', 'Bye']);
});

test('two or three numbers are content, not a ruler', () => {
  const out = cleanTexts([item('1'), item('2'), item('3')], new Map());
  assert.deepEqual(out.texts.map((t) => t.text), ['1', '2', '3']);
  assert.deepEqual(out.decorations, []);
});

test('clock text is generated and its element is live', () => {
  const out = cleanTexts([item('9:06:10 AM', all, 'clock')], new Map());
  assert.equal(out.generated[0].kind, 'clock');
  assert.equal(out.generated[0].text, '9:06:10 AM');
  assert.deepEqual(out.liveKeys, ['clock']);
  assert.deepEqual(out.texts, []);
});

test('a fixed date is content', () => {
  const out = cleanTexts([item('Mar 19, 2026')], new Map());
  assert.deepEqual(out.texts.map((t) => t.text), ['Mar 19, 2026']);
});

test('text at two widths is listed once', () => {
  const out = cleanTexts([item('Hi', ['base'], 'a'), item('Hi', ['mobile'], 'b')], new Map());
  assert.deepEqual(out.texts, [{ text: 'Hi', widths: ['base', 'mobile'] }]);
});

test('a paragraph split into different lines per width is content, not a changing value', () => {
  const out = cleanTexts([item('I am a designer', ['base'], 'p')], new Map([['p', ['I am a designer', 'I am a', 'designer']]]));
  assert.deepEqual(out.generated, []);
  assert.deepEqual(out.texts.map((t) => t.text), ['I am a designer']);
});

test('values that differ only in their digits are changing', () => {
  const out = cleanTexts([item('12 visitors', all, 'v')], new Map([['v', ['12 visitors', '15 visitors']]]));
  assert.equal(out.generated[0].kind, 'changing');
});
