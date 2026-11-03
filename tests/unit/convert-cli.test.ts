import assert from 'node:assert/strict';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { formatStatus, parseConvertArgs, runConvertCommand, runPipeline } from '../../src/convert/index.js';

const fixture = path.resolve('tests/fixtures/framer-nudge-mini');
const tmps: string[] = [];
after(async () => {
  for (const d of tmps) await rm(d, { recursive: true, force: true });
});
const io = () => ({ confirm: async () => true, log: () => {} });

test('parseConvertArgs handles each form', () => {
  assert.deepEqual(parseConvertArgs(['convert', './exp']), { command: 'run', exportDir: './exp', nextDir: undefined, target: undefined, yes: false });
  assert.deepEqual(parseConvertArgs(['convert', './exp', './out', '--yes']), { command: 'run', exportDir: './exp', nextDir: './out', target: undefined, yes: true });
  assert.equal(parseConvertArgs(['convert', 'status']).command, 'status');
  assert.equal(parseConvertArgs(['convert', 'next']).command, 'next');
  const v = parseConvertArgs(['convert', 'verify', '/about']);
  assert.equal(v.command, 'verify');
  assert.equal(v.target, '/about');
});

test('runPipeline refuses non-framer exports', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fexport wf '));
  tmps.push(dir);
  await writeFile(path.join(dir, 'export-report.json'), JSON.stringify({ platform: 'webflow' }));
  await assert.rejects(
    runPipeline(dir, dir + '-next', io()),
    /Only Framer exports are supported in this version \(found: webflow\)/
  );
});

test('runPipeline converts the fixture, then is a no-op', async () => {
  process.env.FEXPORT_CONVERT_NO_ANIMATIONS = '1';
  const base = await mkdtemp(path.join(os.tmpdir(), 'fexport pipe '));
  tmps.push(base);
  const nextDir = path.join(base, 'out next');
  const state = await runPipeline(fixture, nextDir, io());
  assert.equal(state.stages.analyze, 'done');
  assert.equal(state.stages['extract-cms'], 'done');
  assert.equal(state.stages.scaffold, 'done');
  assert.equal(state.stages.tasks, 'needs-ai');
  const again = await runPipeline(fixture, nextDir, io());
  assert.deepEqual(again, state);
  const text = formatStatus(state);
  assert.match(text, /needs-ai/);
  for (const id of Object.keys(state.tasks)) assert.ok(text.includes(id), id);
});

test('runConvertCommand status outside a project returns 1', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fexport none '));
  tmps.push(dir);
  const prev = process.cwd();
  process.chdir(dir);
  try {
    assert.equal(await runConvertCommand(['convert', 'status']), 1);
  } finally {
    process.chdir(prev);
  }
});
