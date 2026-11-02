import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { extractTokens, nameColor } from '../../src/convert/adapters/framer/tokens.js';

const dir = path.resolve('tests/fixtures/framer-nudge-mini');
const html = readFileSync(path.join(dir, 'index.html'), 'utf8');

test('extractTokens finds all 41 token variables with valid colors', () => {
  const t = extractTokens(html, dir);
  assert.equal(Object.keys(t.tokenMap).length, 41);
  for (const v of Object.values(t.colors)) assert.match(v, /^(#|rgb|hsl)/);
  const names = Object.values(t.tokenMap);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(Object.keys(t.colors).sort(), [...names].sort());
});

test('extractTokens keeps only used fonts whose files exist', () => {
  const t = extractTokens(html, dir);
  assert.ok(t.fonts.length > 0 && t.fonts.length < 93);
  for (const f of t.fonts) {
    assert.ok(f.files.length > 0);
    for (const file of f.files) assert.ok(existsSync(path.join(dir, file)), file);
  }
});

test('extractTokens derives a type scale and fixed breakpoints', () => {
  const t = extractTokens(html, dir);
  assert.ok(t.typeScale.length > 0);
  assert.equal(t.typeScale[0].name, 'text-1');
  assert.deepEqual(t.breakpoints, { md: 810, lg: 1200 });
});

test('nameColor picks the base name by dominant usage', () => {
  assert.equal(nameColor('#000', [{ prop: 'color', count: 5 }, { prop: 'background', count: 1 }]), 'ink');
  assert.equal(nameColor('#fff', [{ prop: 'background', count: 3 }]), 'surface');
  assert.equal(nameColor('#ccc', [{ prop: 'border', count: 2 }]), 'line');
});

test('extractTokens throws when breakpoint media are missing', () => {
  assert.throws(() => extractTokens('<style>a{color:red}</style>', dir), /breakpoint/);
});
