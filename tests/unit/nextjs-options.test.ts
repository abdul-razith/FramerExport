import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNextjsFlags } from '../../src/nextjs/options.js';
import { nodeKey } from '../../src/nextjs/model.js';

test('parseNextjsFlags consumes flags and leaves positional args', () => {
  const args = [
    'https://x.framer.website',
    'out',
    '--nextjs',
    '--ai-refine',
    '--ai-provider',
    'agy',
    '--ai-model',
    'm1',
    '--no-verify',
  ];
  const r = parseNextjsFlags(args);
  assert.deepEqual(args, ['https://x.framer.website', 'out']);
  assert.equal(r.enabled, true);
  assert.deepEqual(r.options, {
    aiRefine: true,
    aiProvider: 'agy',
    aiModel: 'm1',
    verify: false,
    cliSkipPermissions: true,
  });
});

test('parseNextjsFlags defaults', () => {
  assert.deepEqual(parseNextjsFlags(['u']), {
    enabled: false,
    options: { aiRefine: false, verify: true, cliSkipPermissions: true },
  });
});

test('--ai-cli-skip-permissions false disables the skip flag', () => {
  assert.equal(
    parseNextjsFlags(['u', '--ai-cli-skip-permissions', 'false']).options.cliSkipPermissions,
    false
  );
});

test('unknown --ai-provider throws with the list of valid ids', () => {
  assert.throws(() => parseNextjsFlags(['u', '--ai-provider', 'nope']), /claude-code.*agy.*gemini/);
});

test('nodeKey format', () => {
  assert.equal(
    nodeKey([
      { tag: 'div', framerName: 'Hero Section', index: 0 },
      { tag: 'h1', index: 2 },
    ]),
    'div[Hero Section]:0/h1:2'
  );
});
