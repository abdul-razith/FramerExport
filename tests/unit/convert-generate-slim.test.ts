import assert from 'node:assert/strict';
import test from 'node:test';
import { rewriteTokens } from '../../src/convert/generate/slim.js';

test('rewriteTokens replaces token var with --color-<kebab>', () => {
  assert.equal(
    rewriteTokens('{"color":"var(--token-4f4e-12, rgb(17, 18, 18))"}', { '--token-4f4e-12': 'Ink Dark' }),
    '{"color":"var(--color-ink-dark)"}',
  );
});

test('rewriteTokens leaves unknown tokens', () => {
  const original = '{"color":"var(--token-unknown, rgb(17, 18, 18))","bg":"var(--token-other)"}';
  assert.equal(
    rewriteTokens(original, { '--token-4f4e-12': 'Ink Dark' }),
    original,
  );
});

test('rewriteTokens handles tokens without fallback and varied formats', () => {
  const map = {
    '--token-1': 'Primary Blue',
    '--token-2': 'Accent Orange',
    'token-3': 'Muted Gray',
  };

  // without fallback
  assert.equal(
    rewriteTokens('var(--token-1)', map),
    'var(--color-primary-blue)',
  );

  // with hex fallback
  assert.equal(
    rewriteTokens('var(--token-2, #ff6600)', map),
    'var(--color-accent-orange)',
  );

  // token in map without leading dashes
  assert.equal(
    rewriteTokens('var(--token-3, rgba(0, 0, 0, 0.5))', map),
    'var(--color-muted-gray)',
  );
});

test('rewriteTokens replaces multiple tokens in jsx and leaves non-token code intact', () => {
  const jsx = `<div style={{ color: "var(--token-a, rgb(0,0,0))", background: "var(--token-b, #fff)" }}>
    <span>Hello</span>
  </div>`;
  const result = rewriteTokens(jsx, {
    '--token-a': 'Dark Text',
    '--token-b': 'Light Bg',
  });
  assert.equal(
    result,
    `<div style={{ color: "var(--color-dark-text)", background: "var(--color-light-bg)" }}>
    <span>Hello</span>
  </div>`,
  );
});

test('rewriteTokens handles empty string, empty map, or missing arguments', () => {
  assert.equal(rewriteTokens('', {}), '');
  assert.equal(rewriteTokens('div', {}), 'div');
  assert.equal(rewriteTokens('var(--token-1)', {}), 'var(--token-1)');
});
