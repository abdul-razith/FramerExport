import assert from 'node:assert/strict';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { existsSync } from 'node:fs';
import { pickNextTask } from '../../src/convert/pipeline.js';
import { initState } from '../../src/convert/state.js';
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

test('unknown convert target prints usage and returns 1 without creating dirs', async () => {
  const lines: string[] = [];
  const sink = { log: (m: string) => lines.push(m), error: (m: string) => lines.push(m) };
  const name = 'bogus-not-a-dir';
  assert.equal(await runConvertCommand([name], sink), 1);
  const text = lines.join(' ');
  assert.match(text, /Export folder not found/);
  assert.match(text, /Usage:/);
  assert.equal(existsSync(path.resolve(name + '-next')), false);
});

test('convert --help returns 0', async () => {
  const lines: string[] = [];
  assert.equal(await runConvertCommand(['--help'], { log: (m) => lines.push(m), error: (m) => lines.push(m) }), 0);
  assert.match(lines.join(' '), /Usage:/);
});

test('pickNextTask prefers fix tasks', () => {
  const state = initState('/e', '/n');
  const mk = (id: string) => ({ id, kind: 'fix' as const, file: id + '.md', status: 'pending' as const, attempts: 0, targets: [] });
  state.tasks = { '001-a': mk('001-a'), 'fix-002': mk('fix-002') };
  assert.equal(pickNextTask(state)?.id, 'fix-002');
});
