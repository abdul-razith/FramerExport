import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { parseTransform, extractStartStates } from '../../src/nextjs/framer/animations.js';
import { FIXTURE_ROOT } from '../fixtures/nextjs/serve.js';

test('parseTransform keeps only non-identity components', () => {
  assert.deepEqual(
    parseTransform('translateX(40px) translateY(0px) scale(0.9) rotate(0deg) skewX(0deg) skewY(0deg)'),
    { x: 40, scale: 0.9 }
  );
  assert.deepEqual(parseTransform('translateY(40px)'), { y: 40 });
  assert.deepEqual(parseTransform('translate(12px, -8px) rotate(15deg)'), { x: 12, y: -8, rotate: 15 });
  assert.deepEqual(parseTransform('none'), {});
});

test('parseTransform ignores percentage translate used for positioning', () => {
  assert.deepEqual(parseTransform('translate(-50%, -50%)'), {});
});

test('parseTransform decodes matrix()', () => {
  assert.deepEqual(parseTransform('matrix(0.9, 0, 0, 0.9, 40, 0)'), { x: 40, scale: 0.9 });
});

const html = fs.readFileSync(path.join(FIXTURE_ROOT, 'export', 'index.html'), 'utf8');
const states = extractStartStates(html);

test('extractStartStates finds a reveal with its start state', () => {
  const entry = [...states].find(([key]) => /p\[Intro\]:\d+$/.test(key));
  assert.ok(entry, 'Intro has a start state');
  assert.deepEqual(entry![1], { kind: 'reveal', from: { opacity: 0, y: 40 } });
});

test('extractStartStates groups per-letter spans into one split-text entry on the parent', () => {
  const entry = [...states].find(([key]) => /p\[Tagline\]:\d+$/.test(key));
  assert.ok(entry, 'Tagline has a split-text spec');
  assert.deepEqual(entry![1], { kind: 'split-text', from: { opacity: 0, x: 40, scale: 0.9 } });
  assert.equal(
    [...states.keys()].filter((k) => /p\[Tagline\]:\d+\/span/.test(k)).length,
    0,
    'letter spans are not returned individually'
  );
});

test('extractStartStates keys start at body:0 like the browser serializer', () => {
  for (const key of states.keys()) assert.match(key, /^body:0\//);
});
