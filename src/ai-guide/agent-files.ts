import fs from 'node:fs/promises';
import path from 'node:path';
import { AGENTS_MD } from './templates/agents.js';

/** Where each coding agent looks for project rules; all get the same text. */
export const AGENT_FILES = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.cursorrules', '.github/copilot-instructions.md'] as const;

export async function writeAgentFiles(exportDir: string): Promise<void> {
  for (const file of AGENT_FILES) {
    const target = path.join(exportDir, ...file.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, AGENTS_MD);
  }
}
