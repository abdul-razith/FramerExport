import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addTime,
  formatDuration,
  formatProgressLine,
  formatTimeSummary,
  progressBar,
  summarizeProgress,
  timeTaskId,
} from '../../src/convert/progress.js';
import type { ConvertState, TaskRecord } from '../../src/convert/types.js';

const task = (id: string, kind: TaskRecord['kind'], extra: Partial<TaskRecord> = {}): TaskRecord => ({
  id,
  kind,
  file: `.convert/tasks/${id}.md`,
  status: 'pending',
  attempts: 0,
  targets: [],
  ...extra,
});
const stateWith = (...tasks: TaskRecord[]): ConvertState => ({
  version: 1,
  exportDir: 'e',
  nextDir: 'n',
  stages: { analyze: 'done', 'extract-cms': 'done', scaffold: 'done', tasks: 'needs-ai', verify: 'pending' },
  tasks: Object.fromEntries(tasks.map((t) => [t.id, t])),
  fileHashes: {},
  warnings: [],
});

test('formatDuration: seconds, minutes, hours', () => {
  assert.equal(formatDuration(0), '0s');
  assert.equal(formatDuration(45_000), '45s');
  assert.equal(formatDuration(4 * 60_000 + 12_000), '4m 12s');
  assert.equal(formatDuration(62 * 60_000 + 5_000), '1h 02m');
  assert.equal(formatDuration(-5), '0s');
});

test('progressBar fills proportionally and handles an empty total', () => {
  assert.equal(progressBar(3, 9, 9), '▓▓▓░░░░░░');
  assert.equal(progressBar(0, 0, 4), '░░░░');
  assert.equal(progressBar(9, 9, 4), '▓▓▓▓');
});

test('timeTaskId resolves a fix task to the task it fixes', () => {
  const s = stateWith(task('101-page-home', 'page'), task('fix-101-page-home-2', 'fix'));
  assert.equal(timeTaskId(s, 'fix-101-page-home-2'), '101-page-home');
  assert.equal(timeTaskId(s, '101-page-home'), '101-page-home');
  assert.equal(timeTaskId(s, 'build'), 'build');
});

test('addTime accumulates active time and stamps the start once', () => {
  const s = stateWith(task('101-page-home', 'page'));
  addTime(s, '101-page-home', 1000, new Date('2026-01-01T10:00:00Z'));
  addTime(s, '101-page-home', 500, new Date('2026-01-01T11:00:00Z'));
  addTime(s, 'setup', 200);
  assert.equal(s.timing!.byTask['101-page-home'], 1500);
  assert.equal(s.timing!.byTask.setup, 200);
  assert.equal(s.timing!.startedAt, '2026-01-01T10:00:00.000Z');
  addTime(s, 'x', -50);
  assert.equal(s.timing!.byTask.x ?? 0, 0);
});

test('summarizeProgress counts pages, sections and motion, with per-page time', () => {
  const s = stateWith(
    task('001-shell', 'shell', { status: 'done' }),
    task('101-page-home', 'page', { status: 'done', route: '/', sections: ['A', 'B'], passedSections: ['A', 'B'] }),
    task('102-page-about', 'page', { status: 'in-progress', route: '/about', sections: ['A', 'B', 'C'], passedSections: ['A'] }),
    task('201-motion-home', 'motion', { status: 'pending', route: '/' }),
    task('fix-102-page-about-1', 'fix', { route: '/about' }),
  );
  addTime(s, 'setup', 60_000);
  addTime(s, '101-page-home', 120_000);
  addTime(s, '102-page-about', 30_000);
  const p = summarizeProgress(s);
  assert.deepEqual(
    { d: p.pagesDone, t: p.pagesTotal, sd: p.sectionsDone, st: p.sectionsTotal, md: p.motionDone, mt: p.motionTotal },
    { d: 1, t: 2, sd: 3, st: 5, md: 0, mt: 1 },
  );
  assert.equal(p.overallMs, 210_000);
  assert.deepEqual(
    p.pages.map((x) => [x.route, x.ms, x.status]),
    [['/', 120_000, 'done'], ['/about', 30_000, 'in-progress']],
  );
  assert.equal(p.shellDone, true);
});

test('summarizeProgress is safe without timing or sections (older projects)', () => {
  const s = stateWith(task('101-page-home', 'page', { route: '/' }));
  const p = summarizeProgress(s);
  assert.equal(p.overallMs, 0);
  assert.equal(p.sectionsTotal, 0);
  assert.equal(p.pagesTotal, 1);
});

test('formatProgressLine is one compact line', () => {
  const s = stateWith(
    task('101-page-home', 'page', { status: 'done', route: '/', sections: ['A'], passedSections: ['A'] }),
    task('102-page-about', 'page', { route: '/about', sections: ['A', 'B'], passedSections: [] }),
  );
  addTime(s, '101-page-home', 90_000);
  const line = formatProgressLine(s);
  assert.ok(!line.includes('\n'));
  assert.match(line, /Pages 1\/2/);
  assert.match(line, /Sections 1\/3/);
  assert.match(line, /1m 30s/);
});

test('formatTimeSummary lists each page and names the slowest', () => {
  const s = stateWith(
    task('101-page-home', 'page', { status: 'done', route: '/' }),
    task('102-page-about', 'page', { status: 'done', route: '/about' }),
  );
  addTime(s, 'setup', 30_000);
  addTime(s, '101-page-home', 60_000);
  addTime(s, '102-page-about', 600_000);
  const text = formatTimeSummary(s);
  assert.match(text, /Overall\s+11m 30s/);
  assert.match(text, /\/about\s+10m 00s/);
  assert.match(text, /Slowest: \/about/);
  assert.match(text, /Setup\s+30s/);
});

import { sectionOutcomes } from '../../src/convert/stages/verify.js';

const outcome = (sections: Array<[string, boolean]>, dom: string[] = [], error?: string) => ({
  sections: sections.map(([name, pass]) => ({ name, pass })),
  dom: dom.map((section) => ({ section })),
  ...(error ? { error } : {}),
});

test('sectionOutcomes: a section passes only when it passes at every width without DOM mismatches', () => {
  const perWidth = new Map([
    [1440, outcome([['Hero', true], ['CTA', true], ['Footer', true]], ['CTA'])],
    [1000, outcome([['Hero', true], ['CTA', true], ['Footer', false]])],
    [390, outcome([['Hero', true], ['CTA', true], ['Footer', true]])],
  ]);
  const r = sectionOutcomes(perWidth, [1440, 1000, 390]);
  assert.deepEqual(r.names, ['Hero', 'CTA', 'Footer']);
  assert.deepEqual(r.passed, ['Hero']);
});

test('sectionOutcomes: a width with an error passes nothing; a missing width passes nothing', () => {
  const ok = outcome([['Hero', true]]);
  assert.deepEqual(sectionOutcomes(new Map([[1440, ok], [390, outcome([], [], 'boom')]]), [1440, 390]).passed, []);
  assert.deepEqual(sectionOutcomes(new Map([[1440, ok]]), [1440, 390]).passed, []);
});

import { formatLiveLine, startTicker } from '../../src/convert/progress.js';

test('formatLiveLine shows task, agent, this-run, page and overall time on one line', () => {
  const s = stateWith(
    task('101-page-home', 'page', { route: '/', sections: ['A', 'B'], passedSections: ['A'] }),
    task('102-page-about', 'page', { route: '/about' }),
  );
  addTime(s, '101-page-home', 60_000);
  addTime(s, '102-page-about', 120_000);
  const line = formatLiveLine(s, '101-page-home', { agent: 'agy', runMs: 5_000, lastLine: 'editing hero' });
  assert.ok(!line.includes('\n'));
  assert.match(line, /Page 1\/2/);
  assert.match(line, /\/ /);
  assert.match(line, /agy/);
  assert.match(line, /this run 5s/);
  assert.match(line, /page 1m 05s/);
  assert.match(line, /overall 3m 05s/);
  assert.match(line, /editing hero/);
});

test('formatLiveLine copes with a fix task, an unknown task and a missing agent', () => {
  const s = stateWith(task('101-page-home', 'page', { route: '/' }), task('fix-101-page-home-1', 'fix', { route: '/' }));
  assert.match(formatLiveLine(s, 'fix-101-page-home-1', { runMs: 1000 }), /Page 1\/1/);
  assert.match(formatLiveLine(s, 'nope', { runMs: 1000 }), /this run 1s/);
});

test('startTicker calls update on an interval and stops cleanly', async () => {
  let calls = 0;
  const stop = startTicker(() => calls++, 10);
  await new Promise((r) => setTimeout(r, 55));
  stop();
  const after = calls;
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(after >= 2, `expected at least 2 ticks, got ${after}`);
  assert.equal(calls, after);
});
