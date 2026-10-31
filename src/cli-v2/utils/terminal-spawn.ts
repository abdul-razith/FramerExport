import { spawn, type ChildProcess } from 'node:child_process';
import type { AgentToolId } from './tool-check.js';

export interface SpawnWindowOptions {
  workingDir: string;
  agentId: AgentToolId | string;
  taskPrompt?: string;
  platform?: NodeJS.Platform;
}

export interface SpawnCommandDescriptor {
  file: string;
  args: string[];
}

export interface SpawnWindowResult {
  success: boolean;
  commandString: string;
  error?: string;
  pid?: number;
}

export function buildSpawnCommand(
  platform: NodeJS.Platform,
  workingDir: string,
  agentId: string,
  taskPrompt?: string
): SpawnCommandDescriptor {
  const taskArg = taskPrompt ? ` "${taskPrompt.replace(/"/g, '\\"')}"` : '';
  const agentCommand = `${agentId}${taskArg}`;

  if (platform === 'win32') {
    return {
      file: 'cmd.exe',
      args: ['/c', 'start', 'cmd.exe', '/k', `cd /d "${workingDir}" && ${agentCommand}`],
    };
  }

  if (platform === 'darwin') {
    return {
      file: 'osascript',
      args: [
        '-e',
        `tell application "Terminal" to activate`,
        '-e',
        `tell application "Terminal" to do script "cd \\"${workingDir}\\" && ${agentCommand}"`,
      ],
    };
  }

  // Linux / BSD
  return {
    file: 'x-terminal-emulator',
    args: ['-e', `bash -c 'cd "${workingDir}" && ${agentCommand}; exec bash'`],
  };
}

export function spawnAgentWindow(options: SpawnWindowOptions): SpawnWindowResult {
  const platform = options.platform || process.platform;
  const descriptor = buildSpawnCommand(
    platform,
    options.workingDir,
    options.agentId,
    options.taskPrompt
  );
  const commandString = `${descriptor.file} ${descriptor.args.join(' ')}`;

  try {
    const child: ChildProcess = spawn(descriptor.file, descriptor.args, {
      detached: true,
      stdio: 'ignore',
      shell: platform === 'win32',
      windowsHide: false,
    });

    child.unref();

    return {
      success: true,
      commandString,
      pid: child.pid,
    };
  } catch (err) {
    return {
      success: false,
      commandString,
      error: (err as Error).message,
    };
  }
}
