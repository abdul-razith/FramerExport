import assert from 'node:assert/strict';
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, test } from 'node:test';
import { runPipeline, type ConvertIo } from '../../src/convert/pipeline.js';
import { runAgents, type RunDeps, type RunIo } from '../../src/convert/run.js';
import { createPauseController } from '../../src/convert/runner/pool.js';
import { loadState } from '../../src/convert/state.js';
import type { RunOptions } from '../../src/convert/types.js';

const tmps: string[] = [];
const fixtureDir = path.resolve('tests/fixtures/framer-nudge-mini');

after(async () => {
  for (const d of tmps) {
    await rm(d, { recursive: true, force: true }).catch(() => {});
  }
});

afterEach(() => {
  delete process.env.FEXPORT_AGENT_CMD;
  delete process.env.FAKE_AGENT_MODE;
  delete process.env.FAKE_AGENT_TARGET;
});

async function findFiles(dir: string, ext = '.tsx'): Promise<string[]> {
  const found: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        found.push(...(await findFiles(full, ext)));
      } else if (e.isFile() && full.endsWith(ext)) {
        found.push(full);
      }
    }
  } catch {}
  return found;
}

test('pipeline and agent orchestration on framer-nudge-mini', async () => {
  // Temp dir with a space
  const tmpBase = await mkdtemp(path.join(os.tmpdir(), 'fexport space '));
  tmps.push(tmpBase);

  const exportDir = path.join(tmpBase, 'framer nudge mini');
  await cp(fixtureDir, exportDir, { recursive: true });
  const nextDir = path.join(tmpBase, 'out next');

  process.env.FEXPORT_AGENT_CMD = path.resolve('tests/fixtures/fake-agent.mjs');
  process.env.FAKE_AGENT_MODE = 'edit';
  delete process.env.FAKE_AGENT_TARGET;

  const options: RunOptions = {
    testing: false,
    agent: 'agy',
    concurrency: 1,
    sectionTimeoutMin: 15,
    pageTimeoutMin: 15,
    pixelTolerance: 0.01,
    reportTolerance: 0.03,
  };

  const logs: string[] = [];
  const io: ConvertIo = {
    confirm: async () => true,
    log: (m) => logs.push(m),
  };

  // 1. Run pipeline
  const pipelineState = await runPipeline(exportDir, nextDir, io, options, {
    install: async (ctx) => {
      ctx.state.stages.install = 'done';
    },
  });

  assert.equal(pipelineState.stages.tasks, 'done', 'pipeline reaches tasks: done');
  assert.equal(pipelineState.stages.baseline, 'skipped', 'baseline is skipped when testing: false');

  // 2. Run agents
  let devServerStopped = false;
  const runDeps: RunDeps = {
    devServer: async () => ({
      url: 'http://127.0.0.1:1',
      pid: process.pid,
      stop: async () => {
        devServerStopped = true;
      },
    }),
    check: async (taskId) => ({
      taskId,
      mode: 'full',
      pass: true,
      limitReached: false,
      widths: [],
      dom: [],
      code: [],
      motion: [],
      errors: [],
    }),
    finalize: async () => ({
      buildOk: true,
    }),
  };

  const pause = createPauseController();
  const runIo: RunIo = {
    onEvent() {},
    pause,
    onQuota: async () => 'stay',
  };

  const outcome = await runAgents(nextDir, runIo, runDeps);
  assert.equal(outcome.status, 'done', 'runAgents returns status: done');

  const finalState = await loadState(nextDir);
  assert.ok(finalState, 'state exists on disk');
  assert.equal(finalState.run.status, 'done', 'run.status is done');

  const taskList = Object.values(finalState.tasks);
  assert.ok(taskList.length > 0, 'there must be tasks');
  for (const t of taskList) {
    assert.equal(t.status, 'done', `task ${t.id} must be done`);
  }

  assert.equal(devServerStopped, true, 'dev server was stopped');

  // Verify real fake-agent processes ran (each section file ends with // edited)
  const sectionsDir = path.join(nextDir, 'src', 'sections');
  const sectionFiles = await findFiles(sectionsDir, '.tsx');
  assert.ok(sectionFiles.length > 0, 'should have created section files under src/sections');

  for (const file of sectionFiles) {
    const content = await readFile(file, 'utf8');
    assert.match(
      content.trimEnd(),
      /\/\/ edited$/,
      `section file ${file} must end with // edited`
    );
  }
});
