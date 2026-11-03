import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { framerAdapter } from '../../src/convert/adapters/framer/index.js';
import { extractBaseCss } from '../../src/convert/adapters/framer/base-css.js';
import { pageSections } from '../../src/convert/adapters/framer/sections.js';
import { initState, loadState } from '../../src/convert/state.js';
import { runAnalyze } from '../../src/convert/stages/analyze.js';

const fixture = path.resolve('tests/fixtures/framer-nudge-mini');
const tmps: string[] = [];
async function tmp(): Promise<string> {
  const d = await mkdtemp(path.join(os.tmpdir(), 'fexport analyze '));
  tmps.push(d);
  return d;
}
after(async () => {
  for (const d of tmps) await rm(d, { recursive: true, force: true });
});

test('canHandle: framer fixture true, webflow false, missing report false', async () => {
  assert.equal(await framerAdapter.canHandle(fixture), true);
  const wf = await tmp();
  await writeFile(path.join(wf, 'export-report.json'), '{"platform":"webflow"}');
  assert.equal(await framerAdapter.canHandle(wf), false);
  assert.equal(await framerAdapter.canHandle(await tmp()), false);
});

test('runAnalyze writes analysis files, slices, base css, and marks stage done', async () => {
  const nextDir = await tmp();
  const state = initState(fixture, nextDir);
  await runAnalyze({ state, exportDir: fixture, nextDir, log: () => {} }, framerAdapter, { animations: false });
  const dir = path.join(nextDir, '.convert', 'analysis');
  for (const f of ['pages', 'tokens', 'components', 'animations']) {
    JSON.parse(await readFile(path.join(dir, `${f}.json`), 'utf8'));
  }
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'animations.json'), 'utf8')), []);
  const slices = (await readdir(path.join(dir, 'slices'))).filter((f) => f !== '_base.css');
  assert.ok(slices.length >= 1);
  const base = await readFile(path.join(dir, 'slices', '_base.css'), 'utf8');
  assert.ok(base.length > 0);
  assert.ok(base.includes('.framer-text'));
  assert.equal((await loadState(nextDir))?.stages.analyze, 'done');
  await stat(path.join(nextDir, '.convert', 'state.json'));
});

test('animations: false and FEXPORT_CONVERT_NO_ANIMATIONS=1 skip runtime observation', async () => {
  const read = async (nextDir: string) =>
    JSON.parse(await readFile(path.join(nextDir, '.convert', 'analysis', 'animations.json'), 'utf8'));
  const a = await tmp();
  await runAnalyze({ state: initState(fixture, a), exportDir: fixture, nextDir: a, log: () => {} }, framerAdapter, {
    animations: false
  });
  assert.deepEqual(await read(a), []);

  const b = await tmp();
  const prev = process.env.FEXPORT_CONVERT_NO_ANIMATIONS;
  process.env.FEXPORT_CONVERT_NO_ANIMATIONS = '1';
  try {
    // Default (animations omitted) would launch a browser; the env flag must short-circuit it.
    await runAnalyze({ state: initState(fixture, b), exportDir: fixture, nextDir: b, log: () => {} }, framerAdapter);
  } finally {
    if (prev === undefined) delete process.env.FEXPORT_CONVERT_NO_ANIMATIONS;
    else process.env.FEXPORT_CONVERT_NO_ANIMATIONS = prev;
  }
  assert.deepEqual(await read(b), []);
});

test('framerAdapter.sections is the page section definition', () => {
  const html = readFileSync(path.join(fixture, 'index.html'), 'utf8');
  assert.deepEqual(framerAdapter.sections(html), pageSections(html));
});

test('extractBaseCss keeps only global-class rules, preserving @media', () => {
  const html =
    '<style>.framer-text{color:red}.framer-AbC12{color:blue}p.framer-text, .framer-AbC12 p{margin:0}' +
    '@media (max-width:800px){.framer-text{color:green}.framer-AbC12{x:y}}' +
    '@font-face{font-family:X}</style>';
  const css = extractBaseCss(html);
  assert.ok(css.includes('.framer-text {color:red}'));
  assert.ok(css.includes('p.framer-text {margin:0}'));
  assert.ok(css.includes('@media (max-width:800px)'));
  assert.ok(!css.includes('AbC12'));
  assert.ok(!css.includes('font-face'));
});

test('runAnalyze clears stale slice files before writing new ones', async () => {
  const nextDir = await tmp();
  const slices = path.join(nextDir, '.convert', 'analysis', 'slices');
  await mkdir(slices, { recursive: true });
  await writeFile(path.join(slices, 'RenamedAway.html'), '<div>stale</div>');
  await runAnalyze({ state: initState(fixture, nextDir), exportDir: fixture, nextDir, log: () => {} }, framerAdapter, {
    animations: false
  });
  const files = await readdir(slices);
  assert.ok(!files.includes('RenamedAway.html'), files.join(', '));
  const comps = JSON.parse(await readFile(path.join(nextDir, '.convert', 'analysis', 'components.json'), 'utf8'));
  assert.equal(files.length, comps.length + 1); // + _base.css
});
