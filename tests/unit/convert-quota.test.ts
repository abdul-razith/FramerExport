import assert from 'node:assert/strict';
import test from 'node:test';
import { detectQuota } from '../../src/convert/runner/quota.js';

test('detectQuota: agy quota reached with reset duration returns hit and resetHint', () => {
  const line = 'error: Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 43h24m17s.';
  const hit = detectQuota(line);
  assert.ok(hit, 'expected quota hit');
  assert.equal(hit.line, line);
  assert.equal(hit.resetHint, '43h24m17s');
});

test('detectQuota: RESOURCE_EXHAUSTED error with code 429 returns hit without resetHint', () => {
  const line = 'AGY_ERROR: {"short_error":"RESOURCE_EXHAUSTED (code 429)…"}';
  const hit = detectQuota(line);
  assert.ok(hit, 'expected quota hit');
  assert.equal(hit.line, line);
  assert.equal(hit.resetHint, undefined);
});

test('detectQuota: checking quota of tasks is not a quota hit', () => {
  const line = 'Checking quota of tasks';
  const hit = detectQuota(line);
  assert.equal(hit, null);
});

test('detectQuota: rate limit alone is not a quota hit', () => {
  const line = 'rate limit';
  const hit = detectQuota(line);
  assert.equal(hit, null);
});

test('detectQuota: rate limit exceeded with try again reset hint', () => {
  const line = 'rate limit exceeded. try again in 5 minutes.';
  const hit = detectQuota(line);
  assert.ok(hit, 'expected quota hit');
  assert.equal(hit.line, line);
  assert.equal(hit.resetHint, '5 minutes');
});

test('detectQuota: usage limit hit returns hit', () => {
  const line = 'Usage limit hit for project';
  const hit = detectQuota(line);
  assert.ok(hit, 'expected quota hit');
  assert.equal(hit.line, line);
});

test('detectQuota: unrelated normal output returns null', () => {
  assert.equal(detectQuota('Compiling page /about...'), null);
  assert.equal(detectQuota('Done in 1.2s'), null);
});
