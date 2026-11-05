import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { framerAdapter } from '../../src/convert/adapters/framer/index.js';
import { initState } from '../../src/convert/state.js';
import { runAnalyze } from '../../src/convert/stages/analyze.js';
import type { ConvertState, PageInfo } from '../../src/convert/types.js';
import { stopAllManaged } from '../../src/convert/verify/proc.js';
import { runReport } from '../../src/convert/verify/report.js';

const fixture = path.resolve('tests/fixtures/framer-nudge-mini');
const tmps: string[] = [];
let nextDir: string;
let exportDir: string;
let indexHtml: string;
let sections: Array<{ name: string; selector: string }>;
let routes: Record<string, string>;

after(async () => {
  await stopAllManaged();
  if (!process.env.KEEP_VERIFY_TMP) {
    for (const d of tmps) {
      await rm(d, { recursive: true, force: true }).catch(() => {});
    }
  }
});

const START = `const i = process.argv.indexOf('-p');
if (i > 0) process.env.PORT = process.argv[i + 1];
await import('./serve.js');
`;

function dynamicParent(route: string): string {
  return route.replace(/\/\[slug\]$/, '').replace(/^\//, '');
}

function routesMap(pages: PageInfo[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const p of pages) {
    if (p.dynamic) {
      const parent = dynamicParent(p.route);
      for (const s of p.dynamic.slugs) map[`subpages/${parent.split('/').join('_')}_${s}.html`] = `/${parent}/${s}`;
    } else {
      map[p.sourceFile] = p.route;
    }
  }
  return map;
}

function standInScript(secs: Array<{ name: string; selector: string }>, routeMap: Record<string, string>): string {
  return `<script>(() => {
  const secs = ${JSON.stringify(secs)};
  const routes = ${JSON.stringify(routeMap)};
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
    }
  };
  apply();
  document.addEventListener('DOMContentLoaded', apply);
  setInterval(apply, 50);
})();</script>`;
}

before(async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fexport-report-'));
  tmps.push(root);
  nextDir = path.join(root, 'next app');
  exportDir = path.join(root, 'my export');
  await cp(fixture, nextDir, { recursive: true });
  await cp(fixture, exportDir, { recursive: true });
  await writeFile(path.join(nextDir, 'start.mjs'), START);
  await mkdir(path.join(nextDir, 'node_modules'), { recursive: true });
  await writeFile(path.join(nextDir, 'build.mjs'), `console.log('stand-in build ok');\n`);
  await writeFile(
    path.join(nextDir, 'package.json'),
    JSON.stringify({ name: 'next-stand-in', private: true, type: 'module', scripts: { build: 'node build.mjs', start: 'node start.mjs' } })
  );

  indexHtml = await readFile(path.join(fixture, 'index.html'), 'utf8');
  sections = framerAdapter.sections(indexHtml);

  // Run analyze to get pages.json
  const state = initState(exportDir, nextDir);
  await runAnalyze({ state, exportDir, nextDir, log: () => {} }, framerAdapter, { animations: false });
  await writeFile(path.join(nextDir, '.convert', 'analysis', 'images.json'), '{}\n');

  const pagesFile = path.join(nextDir, '.convert', 'analysis', 'pages.json');
  const allPages = JSON.parse(await readFile(pagesFile, 'utf8')) as PageInfo[];
  const homeOnly = allPages.filter((p) => p.route === '/');
  await writeFile(pagesFile, JSON.stringify(homeOnly));
  routes = routesMap(homeOnly);

  const standInHtml = indexHtml.replace(/<\/body>/i, `${standInScript(sections, routes)}</body>`);
  await writeFile(path.join(nextDir, 'index.html'), standInHtml);
});

test('runReport generates index.html referencing existing images with over 0 for identical pages', { timeout: 600_000 }, async () => {
  const state = initState(exportDir, nextDir);
  const ctx = { state, exportDir, nextDir, log: (m: string) => console.log(m) };

  const result = await runReport(ctx, { tolerance: 0.005 }, { maskDelayMs: 0 });

  assert.equal(result.over, 0);
  const expectedReportFile = path.join(nextDir, '.convert', 'report', 'index.html');
  assert.equal(path.resolve(result.file), path.resolve(expectedReportFile));

  const reportStat = await stat(result.file);
  assert.ok(reportStat.isFile());

  const html = await readFile(result.file, 'utf8');
  assert.match(html, /Conversion Report/);
  assert.match(html, /Page: <code>\/<\/code>/);

  // Extract all <img> src attributes
  const imgMatches = Array.from(html.matchAll(/<img[^>]+src="([^">]+)"/g)).map((m) => m[1]);
  assert.ok(imgMatches.length > 0, 'Report must contain images');

  // Verify that every referenced image exists on disk
  const reportDir = path.dirname(result.file);
  for (const src of imgMatches) {
    const resolvedPath = path.resolve(reportDir, src);
    const imgStat = await stat(resolvedPath);
    assert.ok(imgStat.isFile(), `Referenced image must exist: ${src}`);
  }
});
