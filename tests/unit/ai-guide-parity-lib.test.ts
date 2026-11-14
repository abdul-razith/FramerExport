import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PARITY_LIB_MJS } from '../../src/ai-guide/templates/parity-lib.js';

// The lib ships as plain JS in the guide; test exactly that file.
type Lib = Record<string, (...args: never[]) => unknown>;
let lib: Lib;
let file: string;
before(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'parity-lib-'));
  file = path.join(dir, 'parity-lib.mjs');
  await fs.writeFile(file, PARITY_LIB_MJS);
  lib = await import(pathToFileURL(file).href);
});
const call = <T>(name: string, ...args: unknown[]) => (lib[name] as (...a: unknown[]) => T)(...args);

type LayoutDiff = { id: string; kind: string; delta?: number; inherited: boolean };
type MotionDiff = { section: string; kind: string; label: string };
const box = (id: string, top: number, height = 900) => ({ id, top, height });
const moved = (section: string, text: string, extra: Record<string, unknown> = {}) => ({ section, name: '', text, startMs: 1200, kinds: ['transform'], ...extra });

test('the first section whose top moved is the cause, the ones below inherit it', () => {
  const d = call<LayoutDiff[]>('layoutDiffs', [box('01', 0), box('02', 900), box('03', 1800)], [box('01', 0), box('02', 942), box('03', 1842)]);
  assert.equal(d.length, 2);
  assert.deepEqual([d[0].id, d[0].kind, d[0].delta, d[0].inherited], ['02', 'top', 42, false]);
  assert.deepEqual([d[1].id, d[1].delta, d[1].inherited], ['03', 42, true]);
});

test('differences within 4px are not reported', () => {
  assert.deepEqual(call('layoutDiffs', [box('01', 0), box('02', 900)], [box('01', 3), box('02', 903, 897)]), []);
});

test('a section on one site only is missing or extra, not a cascade', () => {
  const d = call<LayoutDiff[]>('layoutDiffs', [box('01', 0), box('02', 900), box('03', 1800)], [box('01', 0), box('03', 1800), box('99', 2700)]);
  assert.deepEqual(d.map((x) => [x.id, x.kind]), [['02', 'missing'], ['99', 'extra']]);
});

test('zero-height sections are ignored', () => {
  assert.deepEqual(call('layoutDiffs', [box('01', 0), box('S2', 0, 0)], [box('01', 0)]), []);
});

test('split letters become their text', () => {
  const letters = ['F', 'E', 'A'].map((t) => moved('03', t, { parentText: 'FEATURED' }));
  const g = call<{ text: string }[]>('groupLetters', letters);
  assert.equal(g.length, 1);
  assert.equal(g[0].text, 'FEATURED');
});

test('text that differs only in case and spacing matches', () => {
  const { diffs } = call<{ diffs: MotionDiff[] }>('motionDiffs', [moved('03', 'FEATURED  WORKS')], [moved('03', 'Featured works')]);
  assert.deepEqual(diffs, []);
  assert.equal(call('normText', '‎‎I’m  Bejaman'), call('normText', 'i’m bejaman'));
});

test('an animation only on the original is missing; on the rebuild only, extra', () => {
  const { diffs } = call<{ diffs: MotionDiff[] }>('motionDiffs', [moved('02', 'it’s me')], [moved('02', 'You')]);
  assert.deepEqual(diffs.map((d) => [d.section, d.kind]).sort(), [['02', 'extra'], ['02', 'missing']]);
});

test('a start more than 300ms apart is a timing difference', () => {
  const late = call<{ diffs: MotionDiff[] }>('motionDiffs', [moved('01', 'Hi', { startMs: 1200 })], [moved('01', 'Hi', { startMs: 1550 })]);
  assert.deepEqual(late.diffs.map((d) => d.kind), ['timing']);
  assert.deepEqual(call<{ diffs: MotionDiff[] }>('motionDiffs', [moved('01', 'Hi', { startMs: 1200 })], [moved('01', 'Hi', { startMs: 1450 })]).diffs, []);
});

test('generated text is never a difference', () => {
  const r = call<{ diffs: MotionDiff[]; cannotMatch: unknown[] }>('motionDiffs', [moved('01', '5:17:32 AM', { live: true })], []);
  assert.deepEqual(r.diffs, []);
  assert.equal(r.cannotMatch.length, 1);
});

test('a hover that changes something on the original but nothing on the rebuild is reported', () => {
  const probe = (changed: string[]) => ({ section: '05', target: 'Contact me', action: 'hover', changed });
  assert.equal(call<unknown[]>('interactionDiffs', [probe(['transform'])], [probe([])]).length, 1);
  assert.deepEqual(call('interactionDiffs', [probe(['transform'])], [probe(['transform'])]), []);
});

test('of several rebuild targets with the same label, the one that matches the hover is compared', () => {
  const probe = (target: string, changed: string[]) => ({ section: 'S3', target, action: 'hover', changed });
  // The logo link reads "Home" too and changes nothing; the nav link HOME changes its background.
  assert.deepEqual(call('interactionDiffs', [probe('HOME', ['background-color'])], [probe('Home', []), probe('HOME', ['background-color'])]), []);
});

test('rotate, scale and translate count as transform in a hover', () => {
  const probe = (changed: string[]) => ({ section: '02', target: 'CONTACT', action: 'hover', changed });
  assert.deepEqual(call('interactionDiffs', [probe(['transform', 'color'])], [probe(['rotate', 'color'])]), []);
});

test('the report points each item into the export', () => {
  const sources = {
    '02': {
      folder: 'ai-guide/pages/index/sections/02-about',
      markup: 'index.html:120',
      styles: 'ai-guide/pages/index/sections/02-about/styles.css',
      animations: [{ label: 'Text', kind: 'enter', at: 'scripts/vendor/p.mjs @ 977' }],
      hovers: [],
    },
  };
  const md = call<string>(
    'renderReport',
    'index',
    {
      widths: {
        '1440': {
          layout: [{ id: '02', kind: 'top', original: 900, rebuild: 942, delta: 42, inherited: false }],
          motion: [{ section: '02', kind: 'missing', label: 'Text' }],
          interaction: [],
        },
        '390': { layout: [], motion: [], interaction: [], error: 'original not reachable: timeout' },
      },
      cannotMatch: [],
    },
    sources
  );
  const motionLine = md.split('\n').find((l) => l.includes('Text') && l.includes('missing'))!;
  assert.ok(motionLine.includes('scripts/vendor/p.mjs @ 977'), motionLine);
  const layoutLine = md.split('\n').find((l) => l.includes('+42'))!;
  assert.ok(layoutLine.includes('02-about/styles.css') && layoutLine.includes('index.html:120'), layoutLine);
  assert.match(md, /original not reachable/);
  assert.match(md.trimEnd(), /## Cannot match[\s\S]*$/);
});

test('the lib is self-contained valid JavaScript', () => {
  assert.doesNotMatch(PARITY_LIB_MJS, /from ['"]\.\.?\//);
  execFileSync(process.execPath, ['--check', file]);
});

test('scroll-triggered animations are not timed, and say when they move', () => {
  const { diffs } = call<{ diffs: (MotionDiff & { scroll?: boolean })[] }>('motionDiffs', [moved('03', 'Card', { startMs: 9000, scroll: true }), moved('04', 'Note', { startMs: 9500, scroll: true })], [moved('03', 'Card', { startMs: 4000, scroll: true })]);
  assert.deepEqual(diffs.map((d) => [d.section, d.kind]), [['04', 'missing']]);
  const md = call<string>('renderReport', 'p', { widths: { '1440': { layout: [], motion: diffs, interaction: [] } }, cannotMatch: [] }, {});
  assert.ok(md.includes('when scrolled to'), md);
});

test('the report lists widths from desktop to mobile', () => {
  const empty = { layout: [], motion: [], interaction: [] };
  const md = call<string>('renderReport', 'p', { widths: { 390: empty, 1024: empty, 1440: empty }, cannotMatch: [] }, {});
  assert.ok(md.indexOf('## 1440') < md.indexOf('## 1024') && md.indexOf('## 1024') < md.indexOf('## 390'), md);
});

// Final review fixes.
test('a width that could not be compared is never reported as matching', () => {
  const md = call<string>('renderReport', 'p', { widths: { 1440: { layout: [], motion: [], interaction: [], error: 'original not reachable: timeout', rebuildOnly: { sections: 3, moving: 5, probes: 2 } } }, cannotMatch: [] }, {});
  assert.doesNotMatch(md, /matches the original/);
  assert.match(md, /Not compared at 1440/);
  assert.match(md, /rebuild measured: 3 sections, 5 moving elements, 2 hover targets/);
});

test('a missing section is the only cause listed, the sections below follow it', () => {
  const d = call<LayoutDiff[]>('layoutDiffs', [box('01', 0, 500), box('02', 500, 500), box('03', 1000, 500), box('04', 1500, 500)], [box('01', 0, 500), box('03', 500, 500), box('04', 1000, 500)]);
  assert.deepEqual(d.filter((x) => !x.inherited).map((x) => [x.id, x.kind]), [['02', 'missing']]);
});

test('an extra section on the rebuild is the only cause listed', () => {
  const d = call<LayoutDiff[]>('layoutDiffs', [box('01', 0, 500), box('03', 500, 500)], [box('01', 0, 500), box('99', 500, 300), box('03', 800, 500)]);
  assert.deepEqual(d.filter((x) => !x.inherited).map((x) => [x.id, x.kind]), [['99', 'extra']]);
});

test('moving elements without text match in order within their section', () => {
  const { diffs } = call<{ diffs: MotionDiff[] }>('motionDiffs', [moved('02', '', { name: 'Hero Image' }), moved('02', '', { name: 'Star' })], [moved('02', ''), moved('02', '')]);
  assert.deepEqual(diffs, []);
});

test('a whole heading matches the same heading split by word', () => {
  const words = [...'FEATURED'].map((t) => moved('03', t, { parentText: 'FEATURED WORKS' })).concat([...'WORKS'].map((t) => moved('03', t, { parentText: 'FEATURED WORKS' })));
  const { diffs } = call<{ diffs: MotionDiff[] }>('motionDiffs', words, [moved('03', 'Featured works')]);
  assert.deepEqual(diffs, []);
  const part = call<{ diffs: MotionDiff[] }>('motionDiffs', [moved('03', 'FEATURED WORKS')], [moved('03', 'Featured')]);
  assert.deepEqual(part.diffs, []);
});

test('a short label on its own is not folded into its parent text', () => {
  const g = call<{ text: string }[]>('groupLetters', [moved('04', '01', { parentText: '01' })]);
  assert.deepEqual(g.map((x) => x.text), ['01']);
});

// Noise fixes after the first real run.
test('exact texts pair before a container that contains them', () => {
  const card = 'Mar 19, 2026 Meridian Health When therapists spend less time';
  const { diffs } = call<{ diffs: MotionDiff[] }>(
    'motionDiffs',
    [moved('04', 'Meridian Health'), moved('04', 'When therapists spend less time'), moved('04', card)],
    [moved('04', card), moved('04', 'Meridian Health'), moved('04', 'When therapists spend less time')]
  );
  assert.deepEqual(diffs, []);
});

test('several movements of the same text are one item', () => {
  const { diffs } = call<{ diffs: MotionDiff[] }>('motionDiffs', [moved('04', 'Meridian Health', { startMs: 1300 })], [moved('04', 'Meridian Health', { startMs: 1335 }), moved('04', 'Meridian Health', { startMs: 1380 })]);
  assert.deepEqual(diffs, []);
});

test('an animation that plays on load on the rebuild but on scroll on the original is a trigger difference', () => {
  const { diffs } = call<{ diffs: (MotionDiff & { scroll?: boolean })[] }>('motionDiffs', [moved('04', 'Meridian Health', { startMs: 12397, scroll: true })], [moved('04', 'Meridian Health', { startMs: 1335 })]);
  assert.deepEqual(diffs.map((d) => [d.section, d.kind, d.label]), [['04', 'trigger', 'Meridian Health']]);
  const md = call<string>('renderReport', 'p', { widths: { 1440: { layout: [], motion: diffs, interaction: [] } }, cannotMatch: [] }, {});
  assert.ok(md.includes('plays on load on the rebuild, when scrolled to on the original'), md);
});
