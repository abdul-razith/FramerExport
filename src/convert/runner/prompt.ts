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
  return `Read AGENTS.md and ${file}, then complete that task. Edit only the files listed under Edit only. Do not run the check, the dev server or the build: the runner verifies your work as soon as you stop. Stop when your edits are finished.`;
}
