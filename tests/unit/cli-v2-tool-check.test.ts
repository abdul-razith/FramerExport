import assert from 'node:assert/strict';
import test from 'node:test';
import { detectInstalledAgents } from '../../src/cli-v2/utils/tool-check.js';

test('detectInstalledAgents returns status for claude, codex, and agy', async () => {
  const result = await detectInstalledAgents(['claude', 'codex', 'agy']);
  assert.equal(result.length, 3);
  const ids = result.map((t) => t.id);
  assert.deepEqual(ids, ['claude', 'codex', 'agy']);
  assert.equal(typeof result[0].available, 'boolean');
  assert.equal(typeof result[0].name, 'string');
});

test('detectInstalledAgents handles unknown tools gracefully', async () => {
  const result = await detectInstalledAgents(['nonexistent_binary_xyz_12345']);
  assert.equal(result.length, 1);
  assert.equal(result[0].available, false);
});
