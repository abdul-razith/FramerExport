import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { agentCommand, defaultAgent, spawnAgent } from '../../src/convert/runner/agent-process.js';
import { buildAgentPrompt } from '../../src/convert/runner/prompt.js';
import { stopAllManaged } from '../../src/convert/verify/proc.js';

const tmps: string[] = [];
after(async () => {
  await stopAllManaged();
  for (const d of tmps) await rm(d, { recursive: true, force: true }).catch(() => {});
});
async function makeTmp(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'agent launch '));
  tmps.push(dir);
  return dir;
}

test('I2: defaultAgent is the first detected agent, agy only when none is installed', async () => {
  assert.equal(await defaultAgent(async () => ['claude']), 'claude');
  assert.equal(await defaultAgent(async () => ['agy', 'claude']), 'agy');
  assert.equal(await defaultAgent(async () => []), 'agy');
});

test('I2: spawning a missing binary resolves with spawnError instead of a normal exit', async () => {
  const dir = await makeTmp();
  const handle = spawnAgent({
    command: path.join(dir, 'no-such-agent-binary'),
    args: ['-p', 'x'],
    cwd: dir,
    timeoutMs: 5000,
    logFile: path.join(dir, 'logs', 'a.log'),
  });
  const exit = await handle.done;
  assert.ok(exit.spawnError, 'spawnError is set');
  assert.match(exit.spawnError!, /ENOENT/);
});

test('I5: agentCommand launches the resolved binary path', () => {
  delete process.env.FEXPORT_AGENT_CMD;
  const r = agentCommand('claude', 'p', 'C:\bin\claude.cmd');
  assert.equal(r.command, 'C:\bin\claude.cmd');
});

test('I5: a .cmd shim in a spaced path receives the real prompt as one -p argument', { skip: process.platform !== 'win32' }, async () => {
  const dir = await makeTmp();
  const out = path.join(dir, 'argv.json');
  await writeFile(
    path.join(dir, 'dump.mjs'),
    `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(out)}, JSON.stringify(process.argv.slice(2)));`
  );
  const shim = path.join(dir, 'agent.cmd');
  await writeFile(shim, `@echo off\r\n"${process.execPath}" "%~dp0dump.mjs" %*\r\n`);
  const prompt = buildAgentPrompt('.convert/tasks/sec-home-hero.md');
  const { command, args } = agentCommand('claude', prompt, shim);
  const exit = await spawnAgent({
    command,
    args,
    cwd: dir,
    timeoutMs: 20000,
    logFile: path.join(dir, 'logs', 'a.log'),
  }).done;
  assert.equal(exit.exitCode, 0);
  const argv = JSON.parse(await readFile(out, 'utf8')) as string[];
  assert.deepEqual(argv, ['-p', prompt, '--dangerously-skip-permissions']);
});

test('I6: a quota line written right before exit(3) is detected (resolves on close, not exit)', async () => {
  const dir = await makeTmp();
  const script = path.join(dir, 'late.mjs');
  await writeFile(
    script,
    [
      "process.stderr.write('x'.repeat(200000) + String.fromCharCode(10));",
      "process.stderr.write('error: Individual quota reached. Resets in 43h24m17s.' + String.fromCharCode(10));",
      'process.exit(3);',
    ].join(String.fromCharCode(10))
  );
  await mkdir(path.join(dir, 'logs'), { recursive: true });
  const exit = await spawnAgent({
    command: process.execPath,
    args: [script],
    cwd: dir,
    timeoutMs: 20000,
    logFile: path.join(dir, 'logs', 'a.log'),
  }).done;
  assert.equal(exit.exitCode, 3);
  assert.equal(exit.quota?.resetHint, '43h24m17s');
});
