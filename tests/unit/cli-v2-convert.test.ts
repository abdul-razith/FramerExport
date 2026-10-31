import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAgentSelection, type AgentResolution } from '../../src/cli-v2/screens/convert.js';
import type { AgentToolStatus } from '../../src/cli-v2/utils/tool-check.js';

test('resolveAgentSelection confirms chosen agent when available', () => {
  const tools: AgentToolStatus[] = [
    { id: 'claude', name: 'Claude Code', available: true, path: 'C:\\bin\\claude.exe' },
    { id: 'codex', name: 'Codex', available: false },
    { id: 'agy', name: 'Antigravity CLI', available: false },
  ];

  const res: AgentResolution = resolveAgentSelection('claude', tools);
  assert.equal(res.status, 'available');
  assert.equal(res.selectedAgent, 'claude');
});

test('resolveAgentSelection lists installed alternatives when chosen agent is missing', () => {
  const tools: AgentToolStatus[] = [
    { id: 'claude', name: 'Claude Code', available: false },
    { id: 'codex', name: 'Codex', available: false },
    { id: 'agy', name: 'Antigravity CLI', available: true, path: 'C:\\bin\\agy.exe' },
  ];

  const res: AgentResolution = resolveAgentSelection('claude', tools);
  assert.equal(res.status, 'missing-alternatives-available');
  assert.deepEqual(res.availableAlternatives, ['agy']);
});

test('resolveAgentSelection returns none-available when zero agents are found on PATH', () => {
  const tools: AgentToolStatus[] = [
    { id: 'claude', name: 'Claude Code', available: false },
    { id: 'codex', name: 'Codex', available: false },
    { id: 'agy', name: 'Antigravity CLI', available: false },
  ];

  const res: AgentResolution = resolveAgentSelection('claude', tools);
  assert.equal(res.status, 'none-available');
  assert.deepEqual(res.availableAlternatives, []);
});
