import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { framerAdapter } from '../../src/convert/adapters/framer/index.js';
import { runConvertCommand } from '../../src/convert/index.js';
import { initState, saveState } from '../../src/convert/state.js';
import { runVerify } from '../../src/convert/stages/verify.js';
import type { ConvertState } from '../../src/convert/types.js';

const tmps: string[] = [];
after(async () => {
  for (const d of tmps) await rm(d, { recursive: true, force: true });
});

async function project(stages: Partial<ConvertState['stages']>, withModules: boolean) {
  const nextDir = await mkdtemp(path.join(os.tmpdir(), 'fexport guard '));
  tmps.push(nextDir);
  const state = initState(path.join(nextDir, 'export'), nextDir);
  Object.assign(state.stages, stages);
  state.tasks['101-page-home'] = {
    id: '101-page-home',
    kind: 'page',
    route: '/',
    file: '.convert/tasks/101-page-home.md',
    status: 'pending',
    attempts: 0,
    targets: ['src/app/page.tsx'],
  };
  await saveState(state);
  if (withModules) await mkdir(path.join(nextDir, 'node_modules'));
  const ctx = { state, exportDir: state.exportDir, nextDir, log: () => {} };
  return { ctx, nextDir };
}

const stateJson = (nextDir: string) => readFile(path.join(nextDir, '.convert', 'state.json'), 'utf8');

async function cli(cwd: string, argv: string[]): Promise<{ code: number; text: string }> {
  const lines: string[] = [];
  const prev = process.cwd();
  process.chdir(cwd);
  try {
    const code = await runConvertCommand(argv, { log: (m) => lines.push(m), error: (m) => lines.push(m) });
    return { code, text: lines.join('\n') };
  } finally {
    process.chdir(prev);
  }
}

for (const stages of [
  {},
  { analyze: 'done', 'extract-cms': 'done' },
  { analyze: 'done', 'extract-cms': 'done', scaffold: 'done' },
] as Array<Partial<ConvertState['stages']>>) {
  test(`verify refuses an incomplete pipeline (${JSON.stringify(stages)})`, async () => {
    const { ctx, nextDir } = await project(stages, true);
    const before = await stateJson(nextDir);
    await assert.rejects(runVerify(ctx, framerAdapter), /Pipeline incomplete: run "fexport convert <exportDir>" first/);
    assert.equal(await stateJson(nextDir), before);
    const { code, text } = await cli(nextDir, ['convert', 'verify']);
    assert.equal(code, 1);
    assert.match(text, /Pipeline incomplete/);
    assert.equal(await stateJson(nextDir), before);
  });
}

test('verify without node_modules stops before building: no attempt, no fix file, exit 1', async () => {
  const { ctx, nextDir } = await project(
    { analyze: 'done', 'extract-cms': 'done', scaffold: 'done', tasks: 'needs-ai' },
    false,
  );
  const before = await stateJson(nextDir);
  await assert.rejects(
    runVerify(ctx, framerAdapter),
    (e: Error) => e.message === `Dependencies not installed: run "npm install" in ${nextDir}`,
  );
  assert.equal(ctx.state.tasks['101-page-home']!.attempts, 0);
  assert.equal(ctx.state.tasks.build, undefined);
  assert.equal(await stateJson(nextDir), before);
  assert.equal(existsSync(path.join(nextDir, '.convert', 'tasks')) ? (await readdir(path.join(nextDir, '.convert', 'tasks'))).length : 0, 0);
  const { code, text } = await cli(nextDir, ['convert', 'verify', '101-page-home']);
  assert.equal(code, 1);
  assert.match(text, /Dependencies not installed: run "npm install" in /);
  assert.equal(await stateJson(nextDir), before);
});
