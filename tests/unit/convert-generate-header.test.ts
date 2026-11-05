import assert from 'node:assert/strict';
import test from 'node:test';
import { FILE_HEADER } from '../../src/convert/generate/index.js';

test('generated file header disables eslint before the ts-nocheck pragma', () => {
  const lines = FILE_HEADER.split('\n');
  assert.equal(lines[0], '/* eslint-disable */');
  assert.ok(FILE_HEADER.indexOf('eslint-disable') < FILE_HEADER.indexOf('@ts-nocheck'));
  assert.ok(FILE_HEADER.includes('// @ts-nocheck'));
});
