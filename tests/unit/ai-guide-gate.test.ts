import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CHECK_MJS } from '../../src/ai-guide/templates/check.js';
import { COMPARE_MJS } from '../../src/ai-guide/templates/compare.js';
import { GATE_MJS, RESULTS_MJS } from '../../src/ai-guide/templates/gate.js';
import { PARITY_MJS } from '../../src/ai-guide/templates/parity.js';
import { renderPlan } from '../../src/ai-guide/plan.js';
import { AGENTS_MD } from '../../src/ai-guide/templates/agents.js';
import { fixtureSite } from './ai-guide-fixture.js';

const component = 'export function HomeHero({ c }) {\n  return <div data-section="01">{c.title}</div>;\n}\n';

/** An export with a one-section guide (section 01, animated), the scripts, and a clean nextjs-app. */
function project(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'fe-gate-'));
  const put = (rel: string, body: string) => {
    const p = path.join(root, ...rel.split('/'));
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, body);
  };
  put('ai-guide/scripts/check.mjs', CHECK_MJS);
  put('ai-guide/scripts/gate.mjs', GATE_MJS);
  put('ai-guide/scripts/results.mjs', RESULTS_MJS);
  put('ai-guide/sections.json', JSON.stringify({ '/': { slug: 'index', sections: [{ id: '01', name: 'Hero', motion: 2 }] } }));
  put('nextjs-app/src/components/sections/home/HomeHero.tsx', component);
  return root;
}

const results = (root: string) => import(pathToFileURL(path.join(root, 'ai-guide', 'scripts', 'results.mjs')).href);
const app = (root: string) => path.join(root, 'nextjs-app');

async function record(root: string, scores = { 1440: 99, 1024: 98, 390: 97 }, moved = true, parity = { layout: 0, motion: 3, interaction: 0 }) {
  const r = await results(root);
  const guide = path.join(root, 'ai-guide');
  r.writeResults(guide, 'index', { sections: { '01': { scores, motion: moved } } }, app(root));
  r.writeResults(guide, 'index', { parity }, app(root));
}

function gate(root: string) {
  const r = spawnSync(process.execPath, [path.join('..', 'ai-guide', 'scripts', 'gate.mjs')], { cwd: app(root), encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
}

test('gate fails when compare has never written results', () => {
  const r = gate(project());
  assert.equal(r.code, 1);
  assert.match(r.out, /no results for \/ .*npm run compare/);
});

test('gate passes with fresh scores ≥ 90, motion, zero layout and interaction differences and a clean check', async () => {
  const root = project();
  await record(root);
  const r = gate(root);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /gate ✓/);
});

test('gate fails when src changed after the results were written', async () => {
  const root = project();
  await record(root);
  writeFileSync(path.join(app(root), 'src', 'components', 'sections', 'home', 'HomeHero.tsx'), component + '// changed\n');
  const r = gate(root);
  assert.equal(r.code, 1);
  assert.match(r.out, /stale/);
});

test('gate fails below 90% unless accepted.json gives a reason', async () => {
  const root = project();
  await record(root, { 1440: 99, 1024: 85, 390: 97 });
  assert.match(gate(root).out, /01 .*1024: 85/);
  assert.equal(gate(root).code, 1);
  writeFileSync(path.join(root, 'ai-guide', 'results', 'accepted.json'), JSON.stringify({ '/#01': 'tablet grain layer differs; 3 rounds done' }));
  const r = gate(root);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /accepted.*tablet grain layer/);
});

test('gate fails when an animated section did not move', async () => {
  const root = project();
  await record(root, undefined, false);
  const r = gate(root);
  assert.equal(r.code, 1);
  assert.match(r.out, /01 .*motion ✗/);
});

test('gate fails on parity layout or interaction differences, and when parity was never run', async () => {
  const root = project();
  await record(root, undefined, true, { layout: 2, motion: 0, interaction: 0 });
  assert.match(gate(root).out, /parity .*layout 2/);
  const noParity = project();
  const r = await results(noParity);
  r.writeResults(path.join(noParity, 'ai-guide'), 'index', { sections: { '01': { scores: { 1440: 99, 1024: 99, 390: 99 }, motion: true } } }, app(noParity));
  assert.match(gate(noParity).out, /npm run parity/);
  assert.equal(gate(noParity).code, 1);
});

test('gate fails when check fails', async () => {
  const root = project();
  writeFileSync(path.join(app(root), 'src', 'components', 'Pic.tsx'), 'export const P = () => <img src="a.png" alt="" />;\n');
  await record(root);
  const r = gate(root);
  assert.equal(r.code, 1);
  assert.match(r.out, /no-raw-img/);
});

test('writeResults merges sections from several compare runs', async () => {
  const root = project();
  const r = await results(root);
  const guide = path.join(root, 'ai-guide');
  r.writeResults(guide, 'index', { sections: { '01': { scores: { 1440: 90, 1024: 90, 390: 90 }, motion: true } } }, app(root));
  r.writeResults(guide, 'index', { sections: { '02': { scores: { 1440: 91, 1024: 91, 390: 91 }, motion: null } } }, app(root));
  const json = JSON.parse(readFileSync(path.join(guide, 'results', 'index.json'), 'utf8'));
  assert.deepEqual(Object.keys(json.sections).sort(), ['01', '02']);
  assert.equal(typeof json.sections['01'].srcHash, 'string');
});

test('compare and parity write their numbers through results.mjs', () => {
  assert.match(COMPARE_MJS, /from '\.\/results\.mjs'/);
  assert.match(COMPARE_MJS, /writeResults\(/);
  assert.match(PARITY_MJS, /from '\.\/results\.mjs'/);
  assert.match(PARITY_MJS, /writeResults\(/);
});

test('Task 0 adds npm run gate and AGENTS makes it the definition of done', () => {
  assert.ok(renderPlan(fixtureSite()).includes('"gate": "node ../ai-guide/scripts/gate.mjs"'));
  assert.ok(AGENTS_MD.includes('`npm run gate`'));
});

test('final review 6: accepted.json cannot accept a missing section or a score under 80%', async () => {
  for (const scores of [{ 1440: 99, 1024: 'not found', 390: 97 }, { 1440: 99, 1024: 70, 390: 97 }]) {
    const root = project();
    await record(root, scores as never);
    writeFileSync(path.join(root, 'ai-guide', 'results', 'accepted.json'), JSON.stringify({ '/#01': 'reason' }));
    const r = gate(root);
    assert.equal(r.code, 1, JSON.stringify(scores));
    assert.match(r.out, /cannot be accepted/);
  }
});

test('final review 9: a section absent at a width on both sites passes that width', async () => {
  const root = project();
  await record(root, { 1440: 99, 1024: 98, 390: 'absent' } as never);
  assert.equal(gate(root).code, 0, gate(root).out);
  assert.match(COMPARE_MJS, /'absent'/);
});

test('final review 8: changes to public/ or the root config make results stale', async () => {
  const root = project();
  await record(root);
  mkdirSync(path.join(app(root), 'public', 'images'), { recursive: true });
  writeFileSync(path.join(app(root), 'public', 'images', 'hero.jpg'), 'x');
  assert.match(gate(root).out, /stale/);
  const root2 = project();
  await record(root2);
  writeFileSync(path.join(app(root2), 'next.config.ts'), 'export default {};');
  assert.match(gate(root2).out, /stale/);
});

test('final review 5: the gate lists every check-allow with its reason', async () => {
  const root = project();
  writeFileSync(path.join(app(root), 'src', 'components', 'Menu.tsx'), 'export const M = () => (\n  // check-allow no-typed-timing: menu open/close, header ref.md Interactive\n  <motion.div transition={{ duration: 0.3 }} />\n);\n');
  await record(root);
  const r = gate(root);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /check-allow .*Menu\.tsx:3 .*menu open\/close/);
});

test('final review 1, 4, 5: plan and AGENTS make gate ✓ the finish line and agree on parity and check-allow', () => {
  const md = renderPlan(fixtureSite());
  assert.match(md, /\*\*Step \d+: Verify\*\* — .*`npm run gate`/);
  assert.doesNotMatch(md, /list any section still below with its scores and the reason/);
  assert.match(md, /motion items .*advisory/);
  assert.match(AGENTS_MD, /motion items .*advisory/);
  assert.doesNotMatch(AGENTS_MD, /a page is done when that report is empty/);
  assert.match(AGENTS_MD, /check-allow no-typed-timing: <reason>/);
  assert.doesNotMatch(AGENTS_MD, /FadeIn, Reveal, TypingText/);
});
