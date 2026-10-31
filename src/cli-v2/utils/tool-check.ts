import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export type AgentToolId = 'claude' | 'codex' | 'agy';

export interface AgentToolStatus {
  id: AgentToolId | string;
  name: string;
  available: boolean;
  path?: string;
}

const AGENT_METADATA: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  agy: 'Antigravity CLI',
};

export async function checkToolOnPath(toolName: string): Promise<{ available: boolean; path?: string }> {
  const isWindows = process.platform === 'win32';
  const checkCmd = isWindows ? `where.exe "${toolName}"` : `which "${toolName}"`;

  try {
    const { stdout } = await execAsync(checkCmd, { windowsHide: true });
    const firstLine = stdout.trim().split(/\r?\n/)[0]?.trim();
    if (firstLine) {
      return { available: true, path: firstLine };
    }
    return { available: false };
  } catch {
    return { available: false };
  }
}

export async function detectInstalledAgents(
  toolIds: (AgentToolId | string)[] = ['claude', 'codex', 'agy']
): Promise<AgentToolStatus[]> {
  const results: AgentToolStatus[] = [];

  for (const id of toolIds) {
    const name = AGENT_METADATA[id] || id;
    const { available, path } = await checkToolOnPath(id);
    results.push({
      id,
      name,
      available,
      path,
    });
  }

  return results;
}
