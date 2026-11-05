import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  agentCommand,
  detectAgents,
  pickBinaryLine,
  resolveAgentBinary,
  spawnAgent,
} from '../../src/convert/runner/agent-process.js';
import { isPidAlive, stopAllManaged } from '../../src/convert/verify/proc.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fakeAgentFixture = path.resolve(__dirname, '../fixtures/fake-agent.mjs');

const tmps: string[] = [];

after(async () => {
  await stopAllManaged();
  for (const d of tmps) {
    await rm(d, { recursive: true, force: true }).catch(() => {});
  }
});

afterEach(() => {
  delete process.env.FEXPORT_AGENT_CMD;
  delete process.env.FAKE_AGENT_MODE;
  delete process.env.FAKE_AGENT_TARGET;
});

async function makeTmp(prefix = 'agent process '): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tmps.push(dir);
  return dir;
}

test('agentCommand: default returns agent with danger flag', () => {
  delete process.env.FEXPORT_AGENT_CMD;
  const res = agentCommand('agy', 'write some code');
  assert.deepEqual(res, {
    command: 'agy',
    args: ['-p', 'write some code', '--dangerously-skip-permissions'],
  });

  const resClaude = agentCommand('claude', 'fix it');
  assert.deepEqual(resClaude, {
    command: 'claude',
    args: ['-p', 'fix it', '--dangerously-skip-permissions'],
  });
});

test('agentCommand: uses FEXPORT_AGENT_CMD when configured', () => {
  process.env.FEXPORT_AGENT_CMD = fakeAgentFixture;
  const res = agentCommand('agy', 'do work');
  assert.deepEqual(res, {
    command: process.execPath,
    args: [fakeAgentFixture, 'agy', '-p', 'do work'],
  });
});

test('pickBinaryLine: prefers .cmd/.exe/.bat on Windows, first line on others', () => {
  const winOut = 'C:\\bin\\agent\nC:\\bin\\agent.cmd\nC:\\bin\\agent.exe';
  assert.equal(pickBinaryLine(winOut, 'win32'), 'C:\\bin\\agent.cmd');
  assert.equal(pickBinaryLine('/usr/local/bin/agent\n/usr/bin/agent', 'linux'), '/usr/local/bin/agent');
  assert.equal(pickBinaryLine('', 'win32'), null);
});

test('resolveAgentBinary and detectAgents: handle agents on PATH', async () => {
  const agy = await resolveAgentBinary('agy');
  assert.ok(agy === null || typeof agy === 'string');
  const detected = await detectAgents();
  assert.ok(Array.isArray(detected));
});

test('spawnAgent: hang mode with timeoutMs: 1500 times out within 5s in cwd with space', async () => {
  const cwd = await makeTmp('hang test ');
  const logFile = path.join(cwd, 'logs', 'hang.log');
  process.env.FEXPORT_AGENT_CMD = fakeAgentFixture;
  process.env.FAKE_AGENT_MODE = 'hang';

  const cmd = agentCommand('agy', 'test prompt');
  const start = Date.now();
  const handle = spawnAgent({
    command: cmd.command,
    args: cmd.args,
    cwd,
    timeoutMs: 1500,
    logFile,
  });

  assert.ok(typeof handle.pid === 'number' && handle.pid > 0);
  const exit = await handle.done;
  const elapsed = Date.now() - start;

  assert.equal(exit.timedOut, true);
  assert.equal(exit.killed, false);
  assert.ok(elapsed < 5000, `Expected elapsed < 5000ms, got ${elapsed}ms`);
  assert.equal(isPidAlive(handle.pid!), false);
});

test('spawnAgent: spawn-child mode + timeout kills grandchild process', async () => {
  const cwd = await makeTmp('child test ');
  const logFile = path.join(cwd, 'logs', 'child.log');
  process.env.FEXPORT_AGENT_CMD = fakeAgentFixture;
  process.env.FAKE_AGENT_MODE = 'spawn-child';

  let gcPid: number | undefined;
  const cmd = agentCommand('claude', 'child prompt');
  const handle = spawnAgent({
    command: cmd.command,
    args: cmd.args,
    cwd,
    timeoutMs: 1500,
    logFile,
    onLine: (line) => {
      const n = Number(line.trim());
      if (Number.isInteger(n) && n > 0 && !gcPid) {
        gcPid = n;
      }
    },
  });

  const exit = await handle.done;
  assert.equal(exit.timedOut, true);
  assert.ok(gcPid, `Expected grandchild pid to be printed, got: ${gcPid}`);
  assert.equal(isPidAlive(gcPid!), false);
});

test('spawnAgent: quota mode sets quota and exitCode 3 and writes to log file', async () => {
  const cwd = await makeTmp('quota test ');
  const logFile = path.join(cwd, 'logs', 'quota.log');
  process.env.FEXPORT_AGENT_CMD = fakeAgentFixture;
  process.env.FAKE_AGENT_MODE = 'quota';

  const cmd = agentCommand('agy', 'quota prompt');
  const handle = spawnAgent({
    command: cmd.command,
    args: cmd.args,
    cwd,
    timeoutMs: 10_000,
    logFile,
  });

  const exit = await handle.done;
  assert.equal(exit.exitCode, 3);
  assert.equal(exit.timedOut, false);
  assert.ok(exit.quota, 'expected quota hit on exit');
  assert.equal(exit.quota.resetHint, '43h24m17s');

  const content = await readFile(logFile, 'utf8');
  assert.ok(content.includes('Individual quota reached'), `log file missing quota message: ${content}`);
});

test('spawnAgent: edit mode appends // edited\\n to target and exits 0', async () => {
  const cwd = await makeTmp('edit test ');
  const targetFile = path.join(cwd, 'src', 'sections', 'Hero.tsx');
  await mkdir(path.dirname(targetFile), { recursive: true });
  await writeFile(targetFile, 'export function Hero() {}\n');
  const logFile = path.join(cwd, 'logs', 'edit.log');

  process.env.FEXPORT_AGENT_CMD = fakeAgentFixture;
  process.env.FAKE_AGENT_MODE = 'edit';
  process.env.FAKE_AGENT_TARGET = targetFile;

  const cmd = agentCommand('agy', 'edit prompt');
  const handle = spawnAgent({
    command: cmd.command,
    args: cmd.args,
    cwd,
    timeoutMs: 10_000,
    logFile,
  });

  const exit = await handle.done;
  assert.equal(exit.exitCode, 0);
  assert.equal(exit.timedOut, false);
  assert.equal(exit.killed, false);

  const editedContent = await readFile(targetFile, 'utf8');
  assert.ok(editedContent.endsWith('// edited\n'), `expected file to end with // edited\\n: ${editedContent}`);
});

test('spawnAgent: outside mode writes outside files', async () => {
  const cwd = await makeTmp('outside test ');
  const targetFile = path.join(cwd, 'target.txt');
  await writeFile(targetFile, 'hello\n');
  const logFile = path.join(cwd, 'logs', 'outside.log');

  process.env.FEXPORT_AGENT_CMD = fakeAgentFixture;
  process.env.FAKE_AGENT_MODE = 'outside';
  process.env.FAKE_AGENT_TARGET = targetFile;

  const cmd = agentCommand('claude', 'outside prompt');
  const handle = spawnAgent({
    command: cmd.command,
    args: cmd.args,
    cwd,
    timeoutMs: 10_000,
    logFile,
  });

  const exit = await handle.done;
  assert.equal(exit.exitCode, 0);

  const css = await readFile(path.join(cwd, 'src', 'app', 'globals.css'), 'utf8');
  assert.equal(css, '/* outside */\n');
  const png = await readFile(path.join(cwd, 'scratch.png'), 'utf8');
  assert.equal(png, 'png');
});

test('spawnAgent: explicit kill stops agent and marks killed: true', async () => {
  const cwd = await makeTmp('kill test ');
  const logFile = path.join(cwd, 'logs', 'kill.log');
  process.env.FEXPORT_AGENT_CMD = fakeAgentFixture;
  process.env.FAKE_AGENT_MODE = 'hang';

  const cmd = agentCommand('agy', 'hang prompt');
  const handle = spawnAgent({
    command: cmd.command,
    args: cmd.args,
    cwd,
    timeoutMs: 30_000,
    logFile,
  });

  await new Promise((r) => setTimeout(r, 200));
  await handle.kill();
  const exit = await handle.done;

  assert.equal(exit.killed, true);
  assert.equal(exit.timedOut, false);
  assert.equal(isPidAlive(handle.pid!), false);
});
