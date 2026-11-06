import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addTime,
  formatDuration,
  formatProgressLine,
  formatRunBanner,
  formatTimeSummary,
  formatWorkerLine,
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
  stages: {
    analyze: 'done',
    'extract-cms': 'done',
    scaffold: 'done',
    install: 'pending',
    generate: 'pending',
    tasks: 'done',
    baseline: 'pending',
    finalize: 'pending',
  },
  tasks: Object.fromEntries(tasks.map((t) => [t.id, t])),
  fileHashes: {},
  warnings: [],
  options: null,
  run: { status: 'idle' },
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

test('summarizeProgress counts pages and sections, with per-page time', () => {
  const s = stateWith(
    task('001-shell', 'shell', { status: 'done' }),
    task('101-page-home', 'page', { status: 'done', route: '/', sections: ['A', 'B'], passedSections: ['A', 'B'] }),
    task('102-page-about', 'page', { status: 'in-progress', route: '/about', sections: ['A', 'B', 'C'], passedSections: ['A'] }),
    task('fix-102-page-about-1', 'fix', { route: '/about' }),
  );
  addTime(s, 'setup', 60_000);
  addTime(s, '101-page-home', 120_000);
  addTime(s, '102-page-about', 30_000);
  const p = summarizeProgress(s);
  assert.deepEqual(
    { d: p.pagesDone, t: p.pagesTotal, sd: p.sectionsDone, st: p.sectionsTotal },
    { d: 1, t: 2, sd: 3, st: 5 },
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

test('formatProgressLine contains Review 1 when needs-review tasks exist', () => {
  const s = stateWith(
    task('101-page-home', 'page', { status: 'done', route: '/', sections: ['A'], passedSections: ['A'] }),
    task('102-page-about', 'page', { status: 'needs-review', route: '/about', sections: ['A', 'B'], passedSections: [] }),
  );
  const line = formatProgressLine(s);
  assert.ok(line.includes('Review 1'), `expected line to contain "Review 1", got "${line}"`);
});

test('formatRunBanner: returns null when not paused, formatted string when paused', () => {
  const s = stateWith(
    task('101-page-home', 'page', { status: 'done', route: '/', sections: Array.from({ length: 14 }, (_, i) => `S${i}`), passedSections: Array.from({ length: 14 }, (_, i) => `S${i}`) }),
    task('102-page-about', 'page', { status: 'pending', route: '/about', sections: Array.from({ length: 17 }, (_, i) => `T${i}`), passedSections: [] }),
  );
  assert.equal(formatRunBanner(s), null);

  s.run = {
    status: 'paused',
    reason: 'quota',
    quotaResetHint: '43h24m17s',
  };
  s.options = {
    agent: 'agy',
    testing: true,
    concurrency: 1,
    sectionTimeoutMin: 15,
    pageTimeoutMin: 15,
    pixelTolerance: 0.01,
    reportTolerance: 0.03,
  };

  assert.equal(
    formatRunBanner(s),
    'Paused at Sections 14/31 · reason: agy quota (resets in 43h24m17s)'
  );
});

test('formatWorkerLine formats exact string', () => {
  const line = formatWorkerLine({
    worker: 1,
    route: '/',
    section: 'Hero + About',
    agent: 'claude',
    ms: 252_000,
    lastLine: 'editing HeroAbout.tsx',
  });
  assert.equal(line, 'W1 · / · Hero + About · claude · 4m 12s · editing HeroAbout.tsx');
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
  for (let i = 0; i < 100 && calls < 2; i++) await new Promise((r) => setTimeout(r, 20));
  stop();
  const after = calls;
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(after >= 2, `expected at least 2 ticks, got ${after}`);
  assert.equal(calls, after);
});


import { formatPageReviewMessage } from '../../src/convert/progress.js';

test('formatPageReviewMessage names the page, its url, time and how far the run is', () => {
  const s = stateWith(
    task('page-home', 'page', { status: 'done', route: '/' }),
    task('page-about', 'page', { route: '/about' }),
  );
  addTime(s, 'page-home', 125_000);
  const msg = formatPageReviewMessage(s, { route: '/', url: 'http://127.0.0.1:4321/', taskId: 'page-home' });
  assert.match(msg, /Page \/ is done/);
  assert.match(msg, /http:\/\/127\.0\.0\.1:4321\//);
  assert.match(msg, /2m 05s/);
  assert.match(msg, /Pages 1\/2/);
  assert.ok(!formatPageReviewMessage(s, { route: '/', url: 'u', taskId: 'page-home' }).includes('needs review'));
});

test('formatPageReviewMessage flags a page that ended as needs-review', () => {
  const s = stateWith(task('page-home', 'page', { status: 'needs-review', route: '/' }));
  assert.match(formatPageReviewMessage(s, { route: '/', url: 'u', taskId: 'page-home' }), /needs review/);
});
