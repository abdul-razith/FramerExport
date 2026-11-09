import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { extractJson, INSTRUCTION_JSON, ProviderAuthError, ProviderRateLimitError, type LlmProvider, type LlmRequest } from './types.js';

export type ExecFn = (
  cmd: string,
  args: string[],
  opts: { cwd: string; input?: string; timeoutMs: number }
) => Promise<{ code: number | null; stdout: string; stderr: string }>;

export const defaultExec: ExecFn = (cmd, args, { cwd, input, timeoutMs }) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, shell: process.platform === 'win32', windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: stderr + String(e) });
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });

const quoteArg = (s: string) => (process.platform === 'win32' ? `"${s.replace(/"/g, '\\"')}"` : s);

let counter = 0;

/**
 * Claude Code (`claude -p`) or Antigravity (`agy -p`) as a provider, using the user's existing login.
 * Every call runs in a fresh empty folder holding only the prompt, schema and screenshots,
 * and the folder is deleted afterwards, so the agent never sees the user's project.
 */
export function createAgentCli(
  id: 'claude-code' | 'agy',
  opts: { model?: string; skipPermissions: boolean; sandboxRoot: string; timeoutMs?: number },
  exec: ExecFn = defaultExec
): LlmProvider {
  return {
    id,
    model: opts.model ?? 'default',
    supportsImages: true,
    rpm: 10,
    async complete(req: LlmRequest): Promise<string> {
      const dir = path.join(opts.sandboxRoot, `sandbox-${process.pid}-${++counter}`);
      await fs.mkdir(dir, { recursive: true });
      try {
        const images: string[] = [];
        for (const [i, file] of (req.images ?? []).entries()) {
          const name = `image-${i + 1}${path.extname(file) || '.png'}`;
          await fs.copyFile(file, path.join(dir, name));
          images.push(name);
        }
        await fs.writeFile(path.join(dir, 'schema.json'), JSON.stringify(req.schema, null, 2));
        const prompt = [
          req.system,
          '',
          req.user,
          ...(images.length ? ['', `Screenshots in this folder: ${images.join(', ')}`] : []),
          '',
          `${INSTRUCTION_JSON} (also saved as schema.json)`,
          JSON.stringify(req.schema),
          '',
          'Do not create, edit or delete any files. Reply with the JSON object only.',
        ].join('\n');
        const timeoutMs = opts.timeoutMs ?? 300000;
        let result;
        if (id === 'agy') {
          await fs.writeFile(path.join(dir, 'prompt.md'), prompt);
          const args = [
            '--output-format', 'json',
            '--json-schema', 'schema.json',
            '--sandbox',
            '--print-timeout', `${Math.round(timeoutMs / 1000)}s`,
            ...(opts.skipPermissions ? ['--dangerously-skip-permissions'] : []),
            ...(opts.model ? ['--model', opts.model] : []),
            '-p', quoteArg('Read prompt.md in the current folder and follow it exactly.'),
          ];
          result = await exec('agy', args, { cwd: dir, timeoutMs: timeoutMs + 30000 });
        } else {
          const args = ['-p', '--output-format', 'json', ...(opts.model ? ['--model', opts.model] : [])];
          result = await exec('claude', args, { cwd: dir, input: prompt, timeoutMs });
        }
        if (result.code !== 0) {
          const msg = `${id} exited with ${result.code}: ${(result.stderr || result.stdout).slice(0, 500)}`;
          if (/rate.?limit|quota|usage limit/i.test(msg)) throw new ProviderRateLimitError(msg);
          if (/log ?in|auth|unauthori[sz]ed/i.test(msg)) throw new ProviderAuthError(msg);
          throw new Error(msg);
        }
        const outer = JSON.parse(extractJson(result.stdout)) as { result?: string; response?: string; status?: string };
        // claude: { result }, agy: { status, response } (verified against the installed CLIs).
        const reply = id === 'agy' ? outer.response : outer.result;
        if (reply === undefined) throw new Error(`${id}: unexpected output ${result.stdout.slice(0, 300)}`);
        return extractJson(reply);
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    },
  };
}
