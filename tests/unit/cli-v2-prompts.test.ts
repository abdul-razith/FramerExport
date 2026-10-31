import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatShortcutHint,
  isCancelOperation,
  sanitizeInputText,
} from '../../src/cli-v2/ui/prompts.js';

test('formatShortcutHint generates clean brackets and muted description', () => {
  const hint = formatShortcutHint('Enter', 'select option');
  assert.ok(hint.includes('[Enter]'));
  assert.ok(hint.includes('select option'));
});

test('sanitizeInputText trims input and handles empty strings', () => {
  assert.equal(sanitizeInputText('   https://test.com  '), 'https://test.com');
  assert.equal(sanitizeInputText(''), '');
  assert.equal(sanitizeInputText(null as any), '');
});

test('isCancelOperation recognizes clack cancel symbol or cancellation flag', () => {
  assert.equal(isCancelOperation(Symbol('clack:cancel')), true);
  assert.equal(isCancelOperation('normal text'), false);
  assert.equal(isCancelOperation(null), false);
});
