import assert from 'node:assert/strict';
import test from 'node:test';
import { takeAiGuideFlag } from '../../src/ai-guide/flag.js';
import { parseNextjsFlags } from '../../src/nextjs/options.js';

test('--ai-guide is taken out before the Next.js flags are parsed', () => {
  const args = ['https://x.framer.website', '--ai-guide'];
  assert.equal(takeAiGuideFlag(args), true);
  assert.deepEqual(args, ['https://x.framer.website']);
  assert.equal(parseNextjsFlags(args).enabled, false);
});

test('without the flag nothing is taken', () => {
  const args = ['https://x.framer.website', '--nextjs'];
  assert.equal(takeAiGuideFlag(args), false);
  assert.deepEqual(args, ['https://x.framer.website', '--nextjs']);
});
