import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAgentCommand, buildSpawnCommand, spawnAgentWindow } from '../../src/cli-v2/utils/terminal-spawn.js';

test('buildAgentCommand formats agy with --dangerously-skip-permissions and -i interactive flag', () => {
  assert.equal(
    buildAgentCommand('agy', 'Read CONVERSION_SPEC.md'),
    'agy --dangerously-skip-permissions -i "Read CONVERSION_SPEC.md"'
  );
  assert.equal(buildAgentCommand('agy'), 'agy --dangerously-skip-permissions');
});

test('buildAgentCommand formats claude and codex with prompt', () => {
  assert.equal(buildAgentCommand('claude', 'Read CLAUDE.md'), 'claude "Read CLAUDE.md"');
  assert.equal(buildAgentCommand('codex', 'Read AGENTS.md'), 'codex "Read AGENTS.md"');
  assert.equal(buildAgentCommand('claude'), 'claude');
});

test('buildSpawnCommand formats Windows start command with scriptPath', () => {
  const cmd = buildSpawnCommand('win32', 'C:\\my-export', 'agy', 'Read CLAUDE.md', 'start-conversion.cmd');
  assert.equal(cmd.file, 'cmd.exe');
  assert.ok(cmd.args.includes('/c'));
  assert.ok(cmd.args.includes('start'));
  assert.ok(cmd.args.includes('""'));
  assert.ok(cmd.args.includes('start-conversion.cmd'));
  // Must NOT include cd /d in arguments to prevent quote-stripping syntax errors
  assert.ok(!cmd.args.join(' ').includes('cd /d'));
});

test('buildSpawnCommand formats Windows start command directly without scriptPath', () => {
  const cmd = buildSpawnCommand('win32', 'C:\\my-export', 'claude', 'Read CLAUDE.md');
  assert.equal(cmd.file, 'cmd.exe');
  assert.ok(cmd.args.includes('/c'));
  assert.ok(cmd.args.includes('start'));
  assert.ok(cmd.args.includes('""'));
  const fullCommandString = cmd.args.join(' ');
  assert.ok(fullCommandString.includes('claude "Read CLAUDE.md"'));
  assert.ok(!fullCommandString.includes('cd /d'));
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

test('buildSpawnCommand formats Darwin osascript with scriptPath', () => {
  const cmd = buildSpawnCommand('darwin', '/Users/test/my-export', 'claude', 'Read "CLAUDE.md"', 'start-conversion.sh');
  assert.equal(cmd.file, 'osascript');
  const doScriptArg = cmd.args.find((a) => a.includes('do script'));
  assert.ok(doScriptArg);
  assert.ok(doScriptArg.includes('start-conversion.sh'));
});

test('buildSpawnCommand formats Linux terminal command', () => {
  const cmd = buildSpawnCommand('linux', '/home/test/my-export', 'codex', 'Read AGENTS.md');
  assert.ok(cmd.file.length > 0);
  assert.ok(cmd.args.some((a) => a.includes('/home/test/my-export')));
});

test('buildSpawnCommand formats Linux terminal command with scriptPath', () => {
  const cmd = buildSpawnCommand('linux', '/home/test/my-export', 'codex', 'Read AGENTS.md', 'start-conversion.sh');
  assert.ok(cmd.file.length > 0);
  assert.ok(cmd.args.some((a) => a.includes('start-conversion.sh')));
});

test('spawnAgentWindow attaches error handler and does not throw on invalid binary', () => {
  const result = spawnAgentWindow({
    workingDir: process.cwd(),
    agentId: 'nonexistent_agent_binary_xyz',
    platform: 'linux',
  });
  assert.equal(typeof result.commandString, 'string');
});
