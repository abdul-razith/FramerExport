import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSpawnCommand } from '../../src/cli-v2/utils/terminal-spawn.js';

test('buildSpawnCommand formats Windows start command with cd /d and agent task', () => {
  const cmd = buildSpawnCommand('win32', 'C:\\my-export', 'claude', 'Read CLAUDE.md');
  assert.match(cmd.file, /cmd\.exe/i);
  assert.ok(cmd.args.includes('/k'));
  const fullCommandString = cmd.args.join(' ');
  assert.ok(fullCommandString.includes('cd /d "C:\\my-export"'));
  assert.ok(fullCommandString.includes('claude "Read CLAUDE.md"'));
});

test('buildSpawnCommand formats Darwin osascript command', () => {
  const cmd = buildSpawnCommand('darwin', '/Users/test/my-export', 'agy', 'Read AGENTS.md');
  assert.equal(cmd.file, 'osascript');
  assert.ok(cmd.args.some((a) => a.includes('Terminal')));
  assert.ok(cmd.args.some((a) => a.includes('cd') && a.includes('/Users/test/my-export')));
});

test('buildSpawnCommand formats Linux terminal command', () => {
  const cmd = buildSpawnCommand('linux', '/home/test/my-export', 'codex', 'Read AGENTS.md');
  assert.ok(cmd.file === 'x-terminal-emulator' || cmd.file === 'gnome-terminal');
  assert.ok(cmd.args.some((a) => a.includes('/home/test/my-export')));
});
