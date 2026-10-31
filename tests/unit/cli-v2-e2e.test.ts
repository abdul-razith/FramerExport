import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCliV2Args, showCliV2Help } from '../../src/cli-v2/index.js';

test('parseCliV2Args parses direct url and outDir arguments', () => {
  const parsed = parseCliV2Args(['https://test.framer.app', './my-test']);
  assert.equal(parsed.url, 'https://test.framer.app');
  assert.equal(parsed.outDir, './my-test');
  assert.equal(parsed.subpages, false);
});

test('parseCliV2Args recognizes flags like --subpages, --provider, -h, --help', () => {
  const parsed = parseCliV2Args(['--subpages', '--platform', 'webflow', 'https://test.com']);
  assert.equal(parsed.subpages, true);
  assert.equal(parsed.provider, 'webflow');
  assert.equal(parsed.url, 'https://test.com');
});

test('showCliV2Help returns comprehensive usage text', () => {
  const help = showCliV2Help();
  assert.ok(help.includes('fexport-v2'));
  assert.ok(help.includes('USAGE'));
  assert.ok(help.includes('OPTIONS'));
});
