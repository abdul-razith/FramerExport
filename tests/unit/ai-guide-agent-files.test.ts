import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AGENT_FILES, writeAgentFiles } from '../../src/ai-guide/agent-files.js';
import { AGENTS_MD } from '../../src/ai-guide/templates/agents.js';
import { renderReadme } from '../../src/ai-guide/templates/readme.js';
import { fixtureSite } from './ai-guide-fixture.js';

test('every agent gets the same rules file at the export root', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fe-agents-'));
  await writeAgentFiles(dir);
  assert.deepEqual(AGENT_FILES, ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.cursorrules', '.github/copilot-instructions.md']);
  for (const f of AGENT_FILES) assert.equal(readFileSync(path.join(dir, ...f.split('/')), 'utf8'), AGENTS_MD, f);
});

test('the guide README names every agent rules file and the new scripts', () => {
  const md = renderReadme(fixtureSite());
  for (const s of ['GEMINI.md', '.cursorrules', 'copilot-instructions.md', 'scripts/check.mjs', 'scripts/gate.mjs', 'motion/presets.ts']) assert.ok(md.includes(s), s);
});
