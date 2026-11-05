import type { TaskRecord } from '../types.js';

const SAFE_PROMPT_PATH = /^[A-Za-z0-9 ./_,-]+$/;

/**
 * Fixed prompt for agent processes.
 * Throws when the task file path contains characters unsafe for command execution.
 */
export function buildAgentPrompt(task: TaskRecord | string): string {
  const file = typeof task === 'string' ? task : task.file;
  if (!SAFE_PROMPT_PATH.test(file)) {
    throw new Error(`Unsafe task file path for the agent prompt: ${file}`);
  }
  return `Read AGENTS.md and ${file}, then complete that task. Edit only the files listed under Edit only. When finished, run the check command in its Done when section and stop when it passes or reports the limit.`;
}
