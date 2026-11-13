/**
 * Source of ai-guide/scripts/parity.mjs. Runs from nextjs-app/ (`npm run parity -- <route>`), so
 * puppeteer is resolved from that project. Written as a raw string without `${` or backticks, so the
 * script text is exactly what is below.
 */
export const PARITY_MJS = String.raw`// Usage (in nextjs-app/, with the site running):
//   npm run parity -- <route> [--base http://localhost:3000] [--original <url>] [--load-ms 6000]
// Opens the original Framer page and the rebuild at 1440, 1024 and 390 with the same headless
// browser and lists every difference in ai-guide/parity/<page>.md:
//   layout       each section's top and height (the first section that moved is the cause)
//   motion       what moves on one site and not on the other (load, a slow scroll down, a rest)
//   interaction  what a hover changes on the original that it does not change on the rebuild
// Each item points into the export (ai-guide/parity/sources.json). A page is done when it is empty.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { interactionDiffs, layoutDiffs, motionDiffs, renderReport } from './parity-lib.mjs';

const require = createRequire(path.join(process.cwd(), 'package.json'));
const puppeteer = require('puppeteer');

const USAGE = 'Usage: npm run parity -- <route> [--base http://localhost:3000] [--original <url>] [--load-ms 6000]';
const args = process.argv.slice(2);
let base = 'http://localhost:3000';
let original;
let loadMs = 6000;
let route;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--base') base = args[++i];
  else if (args[i] === '--original') original = args[++i];
  else if (args[i] === '--load-ms') loadMs = Number(args[++i]);
  else if (args[i].startsWith('--')) {
    console.error('Unknown argument: ' + args[i] + '. ' + USAGE);
    process.exit(1);
  } else if (route === undefined) route = args[i];
}
// Git Bash on Windows rewrites "/about" into "C:/Program Files/Git/about": undo that.
route = '/' + (route ?? '/').replace(/^[A-Za-z]:[\\/].*?[\\/]Git[\\/]/, '').replace(/^\/+/, '');
if (route.length > 1) route = route.replace(/\/+$/, '');

const guideDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(guideDir, file), 'utf8'));
  } catch {
    return {};
  }
};
const pageInfo = readJson('sections.json')[route];
if (!pageInfo) {
  console.error('No page ' + route + ' in ai-guide/sections.json. ' + USAGE);
  process.exit(1);
}
const allSources = readJson('parity/sources.json');
const sources = Object.assign({}, allSources._shell ? { _shell: allSources._shell } : {}, allSources[route] || {});
original = original || pageInfo.url;
const slug = pageInfo.slug;
const sections = pageInfo.sections.map((s) => ({ id: s.id, className: s.className, live: s.live || {} }));
const WIDTHS = [1440, 1024, 390];
const HOVER_WIDTHS = [1440, 1024];
const MAX_PROBES = 8;
const outDir = path.join(guideDir, 'parity');
const shotDir = path.join(outDir, slug);
fs.mkdirSync(shotDir, { recursive: true });

// Runs in the page before its scripts: remembers every element that visibly moves and when.
function watch() {
  const seen = (window.__parityMoved = new Map());
  const add = (el, kind) => {
    if (!el || el.nodeType !== 1) return;
    const e = seen.get(el) || { kinds: new Set(), t: Math.round(performance.now()), scroll: !!window.__parityScrolling };
    e.kinds.add(kind);
    seen.set(el, e);
  };
  document.addEventListener('animationstart', (e) => add(e.target, 'css-animation'), true);
  document.addEventListener('transitionrun', (e) => {
    if (/^(opacity|transform|translate|scale|rotate)$/.test(e.propertyName)) add(e.target, 'css-transition');
  }, true);
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (...a) {
    add(this, 'waapi');
    return animate.apply(this, a);
  };
  const part = (s, p) => {
    const m = (s || '').match(new RegExp('(?:^|;)\\s*' + p + '\\s*:([^;]*)'));
    return m ? m[1].trim() : '';
  };
  const opacity = (s) => {
    const v = part(s, 'opacity');
    return v === '' ? 1 : Math.round(parseFloat(v) * 100) / 100;
  };
  const still = /^(none|translate(3d)?\(0(px)?(, ?0(px)?)*\)|matrix\(1, 0, 0, 1, 0, 0\)|translateX\(0(px)?\) translateY\(0(px)?\)|scale\(1\)|rotate\(0deg\))?$/;
  const shape = (s, p) => {
    const v = part(s, p);
    return still.test(v) ? 'none' : v.replace(/\s+/g, ' ');
  };
  new MutationObserver((list) => {
    for (const m of list) {
      const now = m.target.getAttribute('style');
      if (opacity(m.oldValue) !== opacity(now)) add(m.target, 'opacity');
      if (['transform', 'translate', 'scale', 'rotate'].some((p) => shape(m.oldValue, p) !== shape(now, p))) add(m.target, 'transform');
    }
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ['style'], attributeOldValue: true });
}

// Runs in the page: the section id of an element (rebuild: data-section; original: the export class).
function sectionTools(sections, side) {
  const byClass = new Map(sections.filter((s) => s.className).map((s) => [s.className, s.id]));
  window.__paritySectionOf = (el) => {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      if (side === 'rebuild' && e.getAttribute && e.getAttribute('data-section')) return e.getAttribute('data-section');
      if (side === 'original' && e.classList) for (const c of e.classList) if (byClass.has(c)) return byClass.get(c);
    }
    return '';
  };
  window.__parityRootOf = (s) => {
    const list = side === 'rebuild' ? document.querySelectorAll('[data-section="' + s.id + '"]') : s.className ? document.getElementsByClassName(s.className) : [];
    for (const el of list) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el;
    }
    return null;
  };
}

function readBoxes(sections) {
  const out = [];
  for (const s of sections) {
    const el = window.__parityRootOf(s);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    out.push({ id: s.id, top: r.top + scrollY, height: r.height });
  }
  return out;
}

function readMoved(sections, width) {
  const live = new Map(sections.map((s) => [s.id, s.live[String(width)] || []]));
  const inside = (r, b) => r.left + scrollX < b.x + b.w && r.right + scrollX > b.x && r.top + scrollY < b.y + b.h && r.bottom + scrollY > b.y;
  const own = (el) => Array.from(el.childNodes).filter((c) => c.nodeType === 3).map((c) => c.textContent).join('').replace(/\s+/g, ' ').trim();
  const out = [];
  for (const [el, info] of window.__parityMoved) {
    if (!el.isConnected) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.height > innerHeight * 2) continue;
    const section = window.__paritySectionOf(el);
    if (!section) continue;
    out.push({
      section,
      name: el.getAttribute('data-framer-name') || '',
      text: (own(el) || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      parentText: el.parentElement ? (el.parentElement.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60) : undefined,
      startMs: info.t,
      scroll: info.scroll,
      kinds: Array.from(info.kinds),
      live: !!el.closest('[data-live]') || (live.get(section) || []).some((b) => inside(r, b)),
    });
  }
  return out;
}

// Runs in the page: marks up to MAX_PROBES hover targets per section; returns their labels.
function markProbes(sections, max) {
  const out = [];
  let n = 0;
  for (const s of sections) {
    const root = window.__parityRootOf(s);
    if (!root) continue;
    let k = 0;
    for (const el of root.querySelectorAll('a, button, [role="button"]')) {
      const r = el.getBoundingClientRect();
      if (k >= max || r.width < 2 || r.height < 2) continue;
      el.setAttribute('data-parity-probe', String(n));
      const target = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('data-framer-name') || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 40);
      out.push({ n: n++, section: s.id, target });
      k++;
    }
  }
  return out;
}

function snapshot(n) {
  const el = document.querySelector('[data-parity-probe="' + n + '"]');
  if (!el) return {};
  const props = ['transform', 'translate', 'scale', 'rotate', 'background-color', 'color', 'box-shadow', 'opacity', 'border-color', 'text-decoration-line'];
  const out = {};
  [el, ...Array.from(el.querySelectorAll('*')).slice(0, 30)].forEach((node, k) => {
    const cs = getComputedStyle(node);
    for (const p of props) out[k + '|' + p] = cs.getPropertyValue(p);
    const r = node.getBoundingClientRect();
    out[k + '|size'] = Math.round(r.width) + 'x' + Math.round(r.height);
  });
  return out;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function visit(browser, url, width, side) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width, height: 900 });
    await page.evaluateOnNewDocument(watch);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
    await page.evaluate(sectionTools, sections, side);
    await wait(loadMs);
    const boxes = await page.evaluate(readBoxes, sections);
    await page.evaluate(() => (window.__parityScrolling = true));
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < height; y += 150) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await wait(120);
    }
    await wait(2000);
    const moved = await page.evaluate(readMoved, sections, width);
    const probes = [];
    if (HOVER_WIDTHS.includes(width)) {
      await page.evaluate(() => window.scrollTo(0, 0));
      for (const p of await page.evaluate(markProbes, sections, MAX_PROBES)) {
        const handle = await page.$('[data-parity-probe="' + p.n + '"]');
        if (!handle) continue;
        await page.evaluate((n) => {
          const el = document.querySelector('[data-parity-probe="' + n + '"]');
          window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + scrollY - 300));
        }, p.n);
        await wait(300);
        const before = await page.evaluate(snapshot, p.n);
        try {
          await handle.hover();
        } catch {
          continue;
        }
        await wait(400);
        const after = await page.evaluate(snapshot, p.n);
        const changed = Array.from(new Set(Object.keys(after).filter((k) => after[k] !== before[k]).map((k) => k.split('|')[1])));
        let image;
        if (changed.length) {
          image = 'ai-guide/parity/' + slug + '/' + p.section + '-' + p.n + '-' + side + '.png';
          await handle.screenshot({ path: path.join(shotDir, p.section + '-' + p.n + '-' + side + '.png') }).catch(() => (image = undefined));
        }
        probes.push({ section: p.section, target: p.target, action: 'hover', changed, image });
        await page.mouse.move(0, 0);
        await wait(200);
      }
    }
    return { boxes, moved, probes };
  } finally {
    await page.close().catch(() => undefined);
  }
}

const browser = await puppeteer.launch({ headless: true });
const result = { widths: {}, cannotMatch: [] };
try {
  for (const width of WIDTHS) {
    let theirs;
    let mine;
    let error;
    try {
      theirs = await visit(browser, original, width, 'original');
    } catch (e) {
      error = 'original not reachable: ' + (e && e.message ? e.message.split('\n')[0] : e);
    }
    try {
      mine = await visit(browser, base + route, width, 'rebuild');
    } catch (e) {
      error = (error ? error + '; ' : '') + 'rebuild not reachable at ' + base + route + ' (start the site with npm run dev): ' + (e && e.message ? e.message.split('\n')[0] : e);
    }
    if (!theirs || !mine) {
      result.widths[width] = { layout: [], motion: [], interaction: [], error };
      continue;
    }
    const motion = motionDiffs(theirs.moved, mine.moved);
    for (const m of motion.cannotMatch) if (!result.cannotMatch.some((x) => x.section === m.section && x.text === m.text)) result.cannotMatch.push(m);
    result.widths[width] = {
      layout: layoutDiffs(theirs.boxes, mine.boxes),
      motion: motion.diffs,
      interaction: interactionDiffs(theirs.probes, mine.probes),
    };
  }
} finally {
  await browser.close();
}

const report = renderReport(route, result, sources);
fs.writeFileSync(path.join(outDir, slug + '.md'), report);
for (const w of WIDTHS) {
  const r = result.widths[w];
  console.log(w + ': ' + (r.error ? r.error : 'layout ' + r.layout.filter((d) => !d.inherited).length + ', motion ' + r.motion.length + ', interaction ' + r.interaction.length));
}
console.log('Report: ai-guide/parity/' + slug + '.md');
`;
