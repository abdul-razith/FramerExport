import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSpawnCommand, spawnAgentWindow } from '../../src/cli-v2/utils/terminal-spawn.js';

test('buildSpawnCommand formats Windows start command with empty title and cd /d', () => {
  const cmd = buildSpawnCommand('win32', 'C:\\my-export', 'claude', 'Read CLAUDE.md');
  assert.equal(cmd.file, 'cmd.exe');
  assert.ok(cmd.args.includes('/c'));
  assert.ok(cmd.args.includes('start'));
  assert.ok(cmd.args.includes('""')); // Empty title to prevent title misparsing
  const fullCommandString = cmd.args.join(' ');
  assert.ok(fullCommandString.includes('cd /d "C:\\my-export"'));
  assert.ok(fullCommandString.includes('claude "Read CLAUDE.md"'));
});

test('buildSpawnCommand formats Darwin osascript with escaped quotes inside do script', () => {
  const cmd = buildSpawnCommand('darwin', '/Users/test/my-export', 'claude', 'Read "CLAUDE.md"');
  assert.equal(cmd.file, 'osascript');
  const doScriptArg = cmd.args.find((a) => a.includes('do script'));
  assert.ok(doScriptArg);
  // Quotes inside the AppleScript string must be escaped with backslashes
  assert.ok(doScriptArg.includes('\\"'));
  assert.ok(!doScriptArg.includes('do script "cd "/Users'));
});

test('buildSpawnCommand formats Linux terminal command', () => {
  const cmd = buildSpawnCommand('linux', '/home/test/my-export', 'codex', 'Read AGENTS.md');
  assert.ok(cmd.file.length > 0);
  assert.ok(cmd.args.some((a) => a.includes('/home/test/my-export')));
});

test('spawnAgentWindow attaches error handler and does not throw on invalid binary', () => {
  // Test that attempting to spawn an impossible binary returns error or attaches error listener without crashing Node
  const result = spawnAgentWindow({
    workingDir: process.cwd(),
    agentId: 'nonexistent_agent_binary_xyz',
    platform: 'linux',
  });
  assert.equal(typeof result.commandString, 'string');
});
