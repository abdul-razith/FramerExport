/**
 * Sources of ai-guide/scripts/results.mjs (where compare and parity record their numbers) and
 * ai-guide/scripts/gate.mjs (`npm run gate`: the one pass/fail for a rebuild, read from those numbers,
 * never from what a model writes in plan.md). Both run from nextjs-app/ with Node built-ins only.
 * Written as raw strings without `${` or backticks, so the script text is exactly what is below.
 */
export const RESULTS_MJS = String.raw`// Results of npm run compare and npm run parity, one file per page: ai-guide/results/<page>.json.
// Each entry carries the hash of nextjs-app/src/ when it was measured, so a later change makes it stale.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function files(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files(p, out);
    else out.push(p);
  }
  return out;
}

/** Root files that change what the site renders. */
const ROOT_FILES = /^(next\.config\.[cm]?[jt]s|package\.json|postcss\.config\.[cm]?[jt]s|tailwind\.config\.[cm]?[jt]s|tsconfig\.json)$/;

/** sha256 of everything that renders the site: src/, public/ and the root config files, by relative path. */
export function srcHash(appDir = process.cwd()) {
  const h = crypto.createHash('sha256');
  const roots = fs.existsSync(appDir) ? fs.readdirSync(appDir).filter((n) => ROOT_FILES.test(n)).map((n) => path.join(appDir, n)) : [];
  const all = [...files(path.join(appDir, 'src')), ...files(path.join(appDir, 'public')), ...roots];
  const rel = (f) => path.relative(appDir, f).split(path.sep).join('/');
  for (const f of all.sort((a, b) => (rel(a) < rel(b) ? -1 : rel(a) > rel(b) ? 1 : 0))) {
    h.update(rel(f) + '\0');
    h.update(fs.readFileSync(f));
    h.update('\0');
  }
  return h.digest('hex');
}

export function readResults(guideDir, slug) {
  try {
    return JSON.parse(fs.readFileSync(path.join(guideDir, 'results', slug + '.json'), 'utf8'));
  } catch {
    return undefined;
  }
}

/** Merges { sections: { <id>: { scores, motion } } } and/or { parity: { layout, motion, interaction } }. */
export function writeResults(guideDir, slug, patch, appDir = process.cwd()) {
  const current = readResults(guideDir, slug) || { sections: {} };
  const stamp = { srcHash: srcHash(appDir), at: new Date().toISOString() };
  for (const [id, entry] of Object.entries(patch.sections || {})) current.sections[id] = Object.assign({}, entry, stamp);
  if (patch.parity) current.parity = Object.assign({}, patch.parity, stamp);
  fs.mkdirSync(path.join(guideDir, 'results'), { recursive: true });
  fs.writeFileSync(path.join(guideDir, 'results', slug + '.json'), JSON.stringify(current, null, 1));
}
`;

export const GATE_MJS = String.raw`// Usage (in nextjs-app/): npm run gate
// The rebuild is done when this exits 0. It runs npm run check, then reads ai-guide/results/<page>.json
// (written by npm run compare and npm run parity) for every page in ai-guide/sections.json:
//   - every section compared, at 90% or more at 1440, 1024 and 390
//   - every section whose ref.md lists animations moved (motion ✓)
//   - parity run, with no layout or interaction differences
//   - nothing changed in src/ since those numbers were measured (else: stale, measure again)
// A section that stays below 90% after 3 fix rounds may be listed with its reason in
// ai-guide/results/accepted.json: { "<route>#<id>": "<reason>" }. It is shown, not failed.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readResults, srcHash } from './results.mjs';

const scripts = path.dirname(fileURLToPath(import.meta.url));
const guide = path.resolve(scripts, '..');
const PASS = 90;
const FLOOR = 80;
const WIDTHS = ['1440', '1024', '390'];
const problems = [];
const notes = [];

const check = spawnSync(process.execPath, [path.join(scripts, 'check.mjs')], { cwd: process.cwd(), encoding: 'utf8' });
const checkLines = (check.stdout + check.stderr).split(/\r?\n/);
// Timing typed by hand under a check-allow: shown with its reason, every run.
notes.push(...checkLines.filter((l) => l.startsWith('check-allow ')));
if (check.status !== 0) problems.push(checkLines.filter((l) => l.trim() && !l.startsWith('check-allow ')).join('\n'));

let pages = {};
try {
  pages = JSON.parse(fs.readFileSync(path.join(guide, 'sections.json'), 'utf8'));
} catch {
  problems.push('no ai-guide/sections.json');
}
let accepted = {};
try {
  accepted = JSON.parse(fs.readFileSync(path.join(guide, 'results', 'accepted.json'), 'utf8'));
} catch {}
const hash = srcHash(process.cwd());

for (const [route, page] of Object.entries(pages)) {
  const results = readResults(guide, page.slug);
  if (!results) {
    problems.push('no results for ' + route + ' — run npm run compare -- ' + route + ' and npm run parity -- ' + route + ' (with npm run dev running)');
    continue;
  }
  for (const s of page.sections || []) {
    const r = results.sections && results.sections[s.id];
    const label = s.id + ' ' + (s.name || '');
    if (!r) {
      problems.push(route + ' ' + label + ': not compared — npm run compare -- ' + route + ' --section ' + s.id);
      continue;
    }
    if (r.srcHash !== hash) {
      problems.push(route + ' ' + label + ': stale (src/ changed since it was compared) — npm run compare -- ' + route);
      continue;
    }
    const scores = WIDTHS.map((w) => w + ': ' + (typeof r.scores[w] === 'number' ? r.scores[w].toFixed(1) : r.scores[w] || 'missing'));
    const passes = (v) => v === 'absent' || (typeof v === 'number' && v >= PASS);
    const low = WIDTHS.some((w) => !passes(r.scores[w]));
    // Acceptance is for close calls only: every width measured, none under FLOOR.
    const acceptable = WIDTHS.every((w) => r.scores[w] === 'absent' || (typeof r.scores[w] === 'number' && r.scores[w] >= FLOOR));
    const reason = accepted[route + '#' + s.id];
    if (low && reason && acceptable) notes.push('accepted ' + route + '#' + s.id + ' (' + scores.join('  ') + '): ' + reason);
    else if (low && reason) problems.push(route + ' ' + label + '  ' + scores.join('  ') + '  cannot be accepted: every width must be measured and at least ' + FLOOR + '%');
    else if (low) problems.push(route + ' ' + label + '  ' + scores.join('  ') + '  below ' + PASS + '%');
    if (s.motion && r.motion !== true) problems.push(route + ' ' + label + '  motion ✗ (its ref.md lists animations, nothing moved)');
  }
  const p = results.parity;
  if (!p) problems.push('parity ' + route + ': not run — npm run parity -- ' + route);
  else if (p.srcHash !== hash) problems.push('parity ' + route + ': stale (src/ changed since it ran) — npm run parity -- ' + route);
  else {
    if (p.layout || p.interaction) problems.push('parity ' + route + ': layout ' + p.layout + ', interaction ' + p.interaction + ' (see ai-guide/parity/' + page.slug + '.md)');
    if (p.motion) notes.push('parity ' + route + ': ' + p.motion + ' motion timing item(s), see ai-guide/parity/' + page.slug + '.md');
  }
}

if (notes.length) console.log(notes.join('\n'));
if (problems.length) {
  console.log(problems.join('\n'));
  console.log('\ngate ✗ ' + problems.length + ' problem' + (problems.length === 1 ? '' : 's'));
  process.exit(1);
}
console.log('gate ✓');
`;
