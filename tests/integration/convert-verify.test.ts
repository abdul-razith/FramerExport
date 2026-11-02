import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { framerAdapter } from '../../src/convert/adapters/framer/index.js';
import { initState, loadState } from '../../src/convert/state.js';
import { runAnalyze } from '../../src/convert/stages/analyze.js';
import { routesMap, runVerify } from '../../src/convert/stages/verify.js';
import type { ConvertState, PageInfo } from '../../src/convert/types.js';
import { stopAllManaged } from '../../src/convert/verify/proc.js';

const fixture = path.resolve('tests/fixtures/framer-nudge-mini');
const PAGE_TASK = '101-page-home';
const tmps: string[] = [];
let nextDir: string; // the Next stand-in (path contains a space)
let indexHtml: string;
let sections: Array<{ name: string; selector: string }>;
let routes: Record<string, string>;

after(async () => {
  await stopAllManaged();
  if (!process.env.KEEP_VERIFY_TMP) for (const d of tmps) await rm(d, { recursive: true, force: true }).catch(() => {});
});

// `npm run start -- -p <port>`: map -p to PORT, then run the export's own static server.
const START = `const i = process.argv.indexOf('-p');
if (i > 0) process.env.PORT = process.argv[i + 1];
await import('./serve.js');
`;

/**
 * Script injected into the stand-in's index.html: keeps `data-section` on every export section element
 * (re-applied, so hydration re-renders cannot drop it), rewrites export page links to Next routes (as a
 * real Next app would have them) and optionally replaces one section's first text.
 */
function standInScript(secs: Array<{ name: string; selector: string }>, changeSection?: string): string {
  return `<script>(() => {
  const secs = ${JSON.stringify(secs)};
  const change = ${JSON.stringify(changeSection ?? null)};
  const routes = ${JSON.stringify(routes)};
  const apply = () => {
    for (const a of document.querySelectorAll('a[href]')) {
      const raw = a.getAttribute('href');
      const rel = raw.replace(/^https?:\\/\\/(?:127\\.0\\.0\\.1|localhost)(?::\\d+)?/i, '').split(/[?#]/)[0]
        .replace(/^(?:\\.{1,2}\\/)+/, '').replace(/^\\/+/, '');
      if (Object.hasOwn(routes, rel)) a.setAttribute('href', routes[rel]);
    }
    for (const s of secs) {
      const el = document.querySelector(s.selector);
      if (el && el.getAttribute('data-section') !== s.name) el.setAttribute('data-section', s.name);
      if (el && s.name === change) {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (n.data === 'Verify changed text') break;
          if (n.data.trim().length >= 3 && !/^(SCRIPT|STYLE)$/.test(n.parentElement.tagName)) { n.data = 'Verify changed text'; break; }
        }
      }
    }
  };
  apply();
  document.addEventListener('DOMContentLoaded', apply);
  setInterval(apply, 50);
})();</script>`;
}

async function writeStandInIndex(changeSection?: string): Promise<void> {
  const html = indexHtml.replace(/<\/body>/i, `${standInScript(sections, changeSection)}</body>`);
  await writeFile(path.join(nextDir, 'index.html'), html);
}

async function writeScripts(build: string): Promise<void> {
  await writeFile(
    path.join(nextDir, 'package.json'),
    JSON.stringify({ name: 'next-stand-in', private: true, type: 'module', scripts: { build, start: 'node start.mjs' } })
  );
}

async function freshState(): Promise<ConvertState> {
  const state = initState(fixture, nextDir);
  state.tasks[PAGE_TASK] = {
    id: PAGE_TASK,
    kind: 'page',
    route: '/',
    file: `.convert/tasks/${PAGE_TASK}.md`,
    status: 'pending',
    attempts: 0,
    targets: ['src/app/page.tsx']
  };
  return state;
}

const ctxFor = (state: ConvertState) => ({ state, exportDir: fixture, nextDir, log: (m: string) => console.log(m) });
type ReportJson = {
  routes: Record<string, Record<string, { sections: Array<{ pass: boolean }>; dom: unknown[]; error?: string }>>;
};
/** Failing sections, DOM mismatches and errors per route/width, for assertion messages. */
const failureSummary = (report: ReportJson): string =>
  JSON.stringify(
    Object.entries(report.routes).flatMap(([route, widths]) =>
      Object.entries(widths).map(([w, r]) => ({ route, w, bad: r.sections.filter((s) => !s.pass), dom: r.dom, error: r.error }))
    )
  ).slice(0, 4000);
const exists = (p: string) => stat(p).then(() => true, () => false);

before(async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fexport verify '));
  tmps.push(root);
  nextDir = path.join(root, 'next app');
  await cp(fixture, nextDir, { recursive: true });
  await writeFile(path.join(nextDir, 'start.mjs'), START);
  await writeFile(path.join(nextDir, 'build.mjs'), `console.log('stand-in build ok');\n`);
  indexHtml = await readFile(path.join(fixture, 'index.html'), 'utf8');
  sections = framerAdapter.sections(indexHtml);
  assert.ok(sections.length >= 3);
  // Analysis files (pages.json, components.json) without the browser-based animation pass.
  await runAnalyze(ctxFor(initState(fixture, nextDir)), framerAdapter, { animations: false });
  await writeFile(path.join(nextDir, '.convert', 'analysis', 'images.json'), '{}\n');
  const pages = JSON.parse(await readFile(path.join(nextDir, '.convert', 'analysis', 'pages.json'), 'utf8')) as PageInfo[];
  routes = routesMap(pages);
  assert.ok(Object.keys(routes).length > 1);
});

test('matching stand-in -> page task done, report lists every width passing', { timeout: 900_000 }, async () => {
  await writeScripts('node build.mjs');
  await writeStandInIndex();
  const state = await freshState();
  const t0 = Date.now();
  const result = await runVerify(ctxFor(state), '/');
  console.log(`matching run: ${Date.now() - t0} ms`);
  const report = JSON.parse(await readFile(path.join(nextDir, '.convert', 'diffs', 'report.json'), 'utf8'));
  assert.deepEqual(result, { passed: [PAGE_TASK], failed: [] }, failureSummary(report));
  assert.equal(state.tasks[PAGE_TASK]!.status, 'done');
  assert.equal(state.stages.verify, 'done');
  for (const w of ['1440', '1000', '390']) {
    const r = report.routes['/'][w];
    assert.ok(r.sections.length >= 3, w);
    assert.ok(r.sections.every((s: { pass: boolean }) => s.pass), w);
    assert.deepEqual(r.dom, []);
    assert.ok(await exists(path.join(nextDir, '.convert', 'reference', 'home', `${w}.png`)));
  }
  assert.deepEqual(report.passed, [PAGE_TASK]);
  const refSections = JSON.parse(await readFile(path.join(nextDir, '.convert', 'reference', 'home', 'sections.json'), 'utf8'));
  assert.ok(refSections['1440'].dom.length >= 3);
  assert.equal((await loadState(nextDir))!.tasks[PAGE_TASK]!.status, 'done');
});

test('changed text -> fix tasks for attempts 1 and 2, then needs-human with no third fix', { timeout: 1_800_000 }, async () => {
  await writeScripts('node build.mjs');
  const target = sections.find((s) => s.name === 'Hero + About') ?? sections[0]!;
  await writeStandInIndex(target.name);
  const state = await freshState();
  const fix = (n: number) => path.join(nextDir, '.convert', 'tasks', `fix-${PAGE_TASK}-${n}.md`);

  const t0 = Date.now();
  const first = await runVerify(ctxFor(state), '/');
  console.log(`failing run 1: ${Date.now() - t0} ms`);
  assert.deepEqual(first, { passed: [], failed: [PAGE_TASK] });
  assert.equal(state.tasks[PAGE_TASK]!.status, 'in-progress');
  assert.equal(state.stages.verify, 'needs-ai');
  const md = await readFile(fix(1), 'utf8');
  assert.match(md, new RegExp(`Section \`${target.name.replace(/[+]/g, '\\+')}\``));
  assert.match(md, /text mismatch/);
  assert.match(md, /Verify changed text/);
  assert.match(md, /npx fexport convert verify 101-page-home/);
  assert.equal(state.tasks[`fix-${PAGE_TASK}-1`]?.kind, 'fix');
  assert.deepEqual(state.tasks[`fix-${PAGE_TASK}-1`]?.targets, ['src/app/page.tsx']);

  await runVerify(ctxFor(state), '/');
  assert.equal(state.tasks[PAGE_TASK]!.status, 'in-progress');
  assert.ok(await exists(fix(2)));
  await runVerify(ctxFor(state), PAGE_TASK);
  console.log(`three failing runs: ${Date.now() - t0} ms`);
  assert.equal(state.tasks[PAGE_TASK]!.status, 'needs-human');
  assert.equal(await exists(fix(3)), false);
  assert.equal(state.stages.verify, 'needs-ai');
});

test('failing build -> fix-build-1.md with the build output, no page verification', { timeout: 120_000 }, async () => {
  await writeFile(path.join(nextDir, 'build-fail.mjs'), `console.log('stand-in build exploded: E_BOOM');\nprocess.exit(1);\n`);
  await writeScripts('node build-fail.mjs');
  const state = await freshState();
  const result = await runVerify(ctxFor(state), undefined);
  assert.deepEqual(result, { passed: [], failed: ['build'] });
  const md = await readFile(path.join(nextDir, '.convert', 'tasks', 'fix-build-1.md'), 'utf8');
  assert.match(md, /E_BOOM/);
  assert.equal(state.tasks['fix-build-1']?.status, 'pending');
  assert.equal(state.tasks[PAGE_TASK]!.attempts, 0);
  assert.equal(state.stages.verify, 'needs-ai');
  const report = JSON.parse(await readFile(path.join(nextDir, '.convert', 'diffs', 'report.json'), 'utf8'));
  assert.deepEqual(report.routes, {});
});
