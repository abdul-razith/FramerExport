import assert from 'node:assert/strict';
import test from 'node:test';
import { validateUrlInput, deriveInitialOutDir } from '../../src/cli-v2/screens/details.js';
import { getProviderChoices } from '../../src/cli-v2/screens/provider.js';
import { parseConcurrencyOption } from '../../src/cli-v2/screens/options.js';

test('validateUrlInput rejects invalid protocols or credentials', () => {
  assert.equal(typeof validateUrlInput('ftp://test.com'), 'string');
  assert.equal(typeof validateUrlInput('https://user:pass@test.com'), 'string');
  assert.equal(typeof validateUrlInput('not-a-url'), 'string');
  assert.equal(validateUrlInput('https://mybrand.framer.app'), undefined);
});

test('deriveInitialOutDir extracts clean slug from URL', () => {
  assert.ok(deriveInitialOutDir('https://mybrand.framer.app').includes('framer-mybrand'));
  assert.ok(deriveInitialOutDir('https://test.webflow.io').includes('webflow-test'));
});

test('getProviderChoices includes Auto-detect as first item', () => {
  const choices = getProviderChoices();
  assert.equal(choices[0].value, 'auto');
  assert.ok(choices.some((c) => c.value === 'framer'));
  assert.ok(choices.some((c) => c.value === 'webflow'));
});

test('parseConcurrencyOption parses numeric options safely', () => {
  assert.equal(parseConcurrencyOption(12), 12);
  assert.equal(parseConcurrencyOption('20'), 20);
  assert.equal(parseConcurrencyOption('invalid'), 12);
});
