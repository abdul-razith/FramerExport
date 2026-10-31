import { spawn, type ChildProcess } from 'node:child_process';
import type { AgentToolId } from './tool-check.js';

export interface SpawnWindowOptions {
  workingDir: string;
  agentId: AgentToolId | string;
  taskPrompt?: string;
  scriptPath?: string;
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

export function buildAgentCommand(agentId: string, taskPrompt?: string): string {
  if (!taskPrompt) return agentId;
  const escapedPrompt = taskPrompt.replace(/"/g, '\\"');
  if (agentId === 'agy') {
    return `agy -i "${escapedPrompt}"`;
  }
  return `${agentId} "${escapedPrompt}"`;
}

export function buildSpawnCommand(
  platform: NodeJS.Platform,
  workingDir: string,
  agentId: string,
  taskPrompt?: string,
  scriptPath?: string
): SpawnCommandDescriptor {
  const agentCommand = buildAgentCommand(agentId, taskPrompt);

  if (platform === 'win32') {
    const target = scriptPath || agentCommand;
    return {
      file: 'cmd.exe',
      args: ['/c', 'start', '""', 'cmd.exe', '/k', target],
    };
  }

  if (platform === 'darwin') {
    const rawInner = scriptPath ? `cd "${workingDir}" && ./${scriptPath}` : `cd "${workingDir}" && ${agentCommand}`;
    const escapedInner = rawInner.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return {
      file: 'osascript',
      args: [
        '-e',
        'tell application "Terminal" to activate',
        '-e',
        `tell application "Terminal" to do script "${escapedInner}"`,
      ],
    };
  }

  // Linux / BSD - default to x-terminal-emulator
  const innerCommand = scriptPath ? `cd "${workingDir}" && ./${scriptPath}` : `cd "${workingDir}" && ${agentCommand}`;
  return {
    file: 'x-terminal-emulator',
    args: ['-e', `bash -c '${innerCommand}; exec bash'`],
  };
}

export function spawnAgentWindow(options: SpawnWindowOptions): SpawnWindowResult {
  const platform = options.platform || process.platform;
  const descriptor = buildSpawnCommand(
    platform,
    options.workingDir,
    options.agentId,
    options.taskPrompt,
    options.scriptPath
  );
  const commandString = `${descriptor.file} ${descriptor.args.join(' ')}`;

  try {
    const child: ChildProcess = spawn(descriptor.file, descriptor.args, {
      cwd: options.workingDir,
      detached: true,
      stdio: 'ignore',
      shell: false,
      windowsHide: false,
    });

    child.on('error', (_err) => {
      // Handled to prevent process crash
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
