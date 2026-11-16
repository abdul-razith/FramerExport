/**
 * Source of ai-guide/scripts/parity.mjs. Runs from nextjs-app/ (`npm run parity -- <route>`), so
 * puppeteer is resolved from that project. Written as a raw string without `${` or backticks, so the
 * script text is exactly what is below.
 */
export const PARITY_MJS = String.raw`// Usage (in nextjs-app/, with the site running):
//   npm run parity -- <route> [--base http://localhost:3000] [--original <url>] [--load-ms 6000] [--dump]
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
let dump = false;
let route;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--base') base = args[++i];
  else if (args[i] === '--original') original = args[++i];
  else if (args[i] === '--load-ms') loadMs = Number(args[++i]);
  else if (args[i] === '--dump') dump = true;
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
const sections = pageInfo.sections.map((s) => ({ id: s.id, className: s.className, name: s.name, boxes: s.boxes || {}, live: s.live || {} }));
const WIDTHS = [1440, 1024, 390];
const HOVER_WIDTHS = [1440, 1024];
const MAX_PROBES = 8;
const outDir = path.join(guideDir, 'parity');
const shotDir = path.join(outDir, slug);
fs.mkdirSync(shotDir, { recursive: true });

// Runs in the page before its scripts: remembers every element that visibly moves and when.
function watch() {
  const seen = (window.__parityMoved = new Map());
  // Not seen: not displayed, or inside something hidden or fully transparent (its own opacity is
  // what it animates, so it does not count).
  const hidden = (el) => {
    for (let a = el; a && a.nodeType === 1; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.display === 'none' || cs.visibility === 'hidden') return true;
      if (a !== el && parseFloat(cs.opacity) < 0.01) return true;
    }
    return false;
  };
  window.__parityHidden = hidden;
  // No text, no fill, no border, no shadow and no image inside: nothing to see.
  window.__parityBlank = (el) => {
    if ((el.textContent || '').trim()) return false;
    for (const n of [el, ...Array.from(el.querySelectorAll('*')).slice(0, 80)]) {
      if (/^(IMG|SVG|svg|CANVAS|VIDEO|PICTURE|IFRAME)$/.test(n.tagName)) return false;
      const cs = getComputedStyle(n);
      const seen = (c) => c && c !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(c);
      if (seen(cs.backgroundColor) || cs.backgroundImage !== 'none' || cs.boxShadow !== 'none') return false;
      if (parseFloat(cs.borderTopWidth) + parseFloat(cs.borderRightWidth) + parseFloat(cs.borderBottomWidth) + parseFloat(cs.borderLeftWidth) > 0 && seen(cs.borderTopColor)) return false;
      if (parseFloat(cs.outlineWidth) > 0 && cs.outlineStyle !== 'none') return false;
      const before = getComputedStyle(n, '::after');
      if (before.content !== 'none' && (seen(before.backgroundColor) || parseFloat(before.borderTopWidth) > 0)) return false;
    }
    return true;
  };
  const add = (el, kind, at) => {
    if (!el || el.nodeType !== 1) return;
    // A polled Web Animation knows when it started (same clock as performance.now()).
    const now = Math.round(typeof at === 'number' ? at : performance.now());
    let e = seen.get(el);
    if (!e) {
      e = { kinds: new Set(), t: now, scroll: !!window.__parityScrolling };
      // Described now, while it is in the page: it may be removed before the end (an unmounted loader).
      if (window.__parityDescribe) e.first = window.__parityDescribe(el);
    }
    // Style changes start motion only when they come frame after frame (see below); a lone change or two only set a state.
    // CSS and Web Animations start when their event fires.
    // An animation's own start time (CSS or Web Animation) replaces the moment an event or a call
    // reported it: events arrive whenever the browser gets to them, which varies with load.
    if (kind === 'waapi-start' && e.start !== undefined && e.startFrom === 'event') {
      e.start = now;
      e.startFrom = 'clock';
    }
    if (kind === 'waapi-start') kind = 'waapi';
    // Separate changes (writes in one tick are one); a state set once or twice is not motion.
    if (e.prev === undefined || now - e.prev >= 4) e.count = (e.count || 0) + 1;
    if (kind === 'opacity' || kind === 'transform') {
      // Bursts of changes (apart by more than 150ms): a loop keeps coming back, or never stops for
      // seconds, even when it pauses off screen before the report reads it.
      if (e.lastStyle === undefined || now - e.lastStyle > 150) {
        e.bursts = (e.bursts || 0) + 1;
        e.burstStart = now;
      } else if (now - e.burstStart > 3000) e.loop = true;
      if (e.bursts >= 5) e.loop = true;
      e.lastStyle = now;
    }
    if (e.start === undefined) {
      if (kind !== 'opacity' && kind !== 'transform') {
        e.start = now;
        e.startFrom = typeof at === 'number' ? 'clock' : 'event';
      } else {
        // Motion changes the style frame after frame: three changes in a row, each within 100ms of
        // the last. One or two quick writes only set a start state.
        // Writes in the same tick (a library setting several properties) are one change.
        if (e.prev !== undefined && now - e.prev < 4) {
          // same change
        } else if (e.prev !== undefined && now - e.prev <= 100) e.run = (e.run || 1) + 1;
        else {
          e.run = 1;
          e.runStart = now;
        }
        if (e.run >= 3) e.start = e.runStart;
      }
      if (e.start !== undefined) e.scroll = !!window.__parityScrolling;
    }
    // Whether it could be seen when it began to move (steps that never run frame by frame: by the third).
    if (e.hiddenAtStart === undefined && (e.start !== undefined || e.count >= 3)) e.hiddenAtStart = hidden(el);
    e.prev = now;
    e.kinds.add(kind);
    seen.set(el, e);
  };
  document.addEventListener('animationstart', (e) => add(e.target, 'css-animation'), true);
  document.addEventListener('transitionrun', (e) => {
    if (/^(opacity|transform|translate|scale|rotate)$/.test(e.propertyName)) add(e.target, 'css-transition');
  }, true);
  // An animation begins to move when its delay ends.
  const begins = (an) => an.startTime + ((an.effect && an.effect.getTiming().delay) || 0) / (an.playbackRate || 1);
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (...a) {
    add(this, 'waapi');
    const an = animate.apply(this, a);
    an.ready.then(() => add(this, 'waapi-start', begins(an))).catch(() => undefined);
    return an;
  };
  // Web Animations built without element.animate() (motion builds them directly) are found by asking
  // the document for its running animations.
  setInterval(() => {
    for (const an of document.getAnimations()) {
      if (!an.effect || !an.effect.target || an.startTime === null) continue;
      add(an.effect.target, 'waapi-start', begins(an));
      if (an.effect.getTiming().iterations === Infinity) seen.get(an.effect.target).loop = true;
    }
  }, 100);
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
    // 0 and 0px are the same; translateZ(0) only makes a layer, it does not move anything.
    const v = part(s, p).replace(/(^|[^\d.])0px/g, '$10').replace(/translateZ\(0\)/g, '').replace(/\s+/g, ' ').trim();
    return still.test(v) ? 'none' : v;
  };
  const sig = (s) => opacity(s) + '|' + ['transform', 'translate', 'scale', 'rotate'].map((p) => shape(s, p)).join('|');
  // The last style change of each element: a change put back within 100ms (hydration rewriting a
  // style) is no motion, so it is undone.
  const lastChange = new WeakMap();
  const change = (target, was, now) => {
    const before = sig(was);
    const after = sig(now);
    if (before === after) return;
    const t = performance.now();
    const rec = lastChange.get(target);
    if (rec && t - rec.t <= 100 && after === rec.before) {
      lastChange.delete(target);
      const e = seen.get(target);
      if (e && e.start === undefined) {
        if (rec.fresh) seen.delete(target);
        else Object.assign(e, rec.state);
      }
      return;
    }
    const old = seen.get(target);
    const state = old ? { prev: old.prev, count: old.count, bursts: old.bursts, burstStart: old.burstStart, lastStyle: old.lastStyle, loop: old.loop } : undefined;
    lastChange.set(target, { before, t, fresh: !old, state });
    if (opacity(was) !== opacity(now)) add(target, 'opacity');
    if (['transform', 'translate', 'scale', 'rotate'].some((p) => shape(was, p) !== shape(now, p))) add(target, 'transform');
  };
  new MutationObserver((list) => {
    // Records come in batches: each one's new style is the next record's old style (the element's
    // current style only for its last one), so a move made and undone in one tick shows as both.
    const order = new Map();
    for (const m of list) {
      if (!order.has(m.target)) order.set(m.target, []);
      order.get(m.target).push(m.oldValue);
    }
    for (const [target, olds] of order) {
      const values = olds.concat([target.getAttribute('style')]);
      for (let i = 0; i < olds.length; i++) change(target, values[i], values[i + 1]);
    }
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ['style'], attributeOldValue: true });
}

// Runs in the page: the section id of an element (rebuild: data-section; original: the export class).
function sectionTools(sections, side) {
  const byClass = new Map(sections.filter((s) => s.className).map((s) => [s.className, s.id]));
  window.__paritySectionOf = (el) => {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      if (side === 'rebuild' && e.getAttribute && e.getAttribute('data-section')) return e.getAttribute('data-section');
      if (side === 'original') {
        if (e.classList) for (const c of e.classList) if (byClass.has(c) && window.__parityRootOf(sections.find((s) => s.id === byClass.get(c))) === e) return byClass.get(c);
        for (const s of sections) if (!s.className && window.__parityRootOf(s) === e) return s.id;
      }
    }
    return '';
  };
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    // A faded or hidden part (a loader after it went) is not shown.
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.01;
  };
  const boxOf = (s) => s.boxes && s.boxes[innerWidth >= 1200 ? '1440' : innerWidth >= 810 ? '1024' : '390'];
  const sizeGap = (el, b) => {
    const r = el.getBoundingClientRect();
    return Math.abs(r.width - b.w) + Math.abs(r.height - b.h);
  };
  const posGap = (el, b) => {
    const r = el.getBoundingClientRect();
    const fixed = getComputedStyle(el).position === 'fixed';
    return Math.abs(r.left - b.x) + Math.abs(r.top + (fixed ? 0 : scrollY) - b.y);
  };
  const best = (list, b) => list.slice().sort((x, y) => sizeGap(x, b) - sizeGap(y, b) || posGap(x, b) - posGap(y, b))[0];
  let cache = { at: -1, roots: new Map() };
  // Roots found by place and size (no class, no name) are kept while they stay in the page.
  const placed = new Map();
  window.__parityRootOf = (s) => {
    if (side === 'rebuild') {
      for (const el of document.querySelectorAll('[data-section="' + s.id + '"]')) if (shown(el)) return el;
      return null;
    }
    // Several lookups per moving element: keep the roots for a moment.
    const now = performance.now();
    if (now - cache.at > 300) cache = { at: now, roots: new Map() };
    if (cache.roots.has(s.id)) return cache.roots.get(s.id);
    const b = boxOf(s);
    const byClass = s.className ? Array.from(document.getElementsByClassName(s.className)).filter(shown) : [];
    let root = null;
    if (byClass.length === 1 || (byClass.length && !b)) root = byClass[0];
    else if (byClass.length) root = best(byClass, b);
    else if (b && s.name) {
      const named = Array.from(document.querySelectorAll('[data-framer-name]')).filter((el) => el.getAttribute('data-framer-name') === s.name && shown(el) && sizeGap(el, b) <= 8);
      root = named.length ? best(named, b) : null;
    }
    if (!root && b && !s.className) {
      // No class and no name on the page (a part added by a script): its captured place and size.
      const kept = placed.get(s.id);
      const keptOk = kept && kept.isConnected && shown(kept);
      const here = Array.from(document.querySelectorAll('body *')).filter((el) => sizeGap(el, b) <= 4 && posGap(el, b) <= 8 && shown(el));
      // The outermost of the elements stacked there, a fixed one first (overlays, badges). A fixed
      // one that appears later (a badge fading in) replaces another element found there first.
      const outer = here.filter((el) => !here.some((o) => o !== el && o.contains(el)));
      const fixed = outer.find((el) => getComputedStyle(el).position === 'fixed');
      const keptFixed = keptOk && getComputedStyle(kept).position === 'fixed';
      root = (keptFixed ? kept : fixed) || (keptOk ? kept : outer[0]) || null;
      if (root) placed.set(s.id, root);
    }
    cache.roots.set(s.id, root);
    return root;
  };
  const clean = (t, n = 60) => (t || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const own = (el) => clean(Array.from(el.childNodes).filter((c) => c.nodeType === 3).map((c) => c.textContent).join(''));
  window.__parityDescribe = (el) => {
    const r = el.getBoundingClientRect();
    // Split letters sit in per-word spans: their text is the text block's (heading, paragraph).
    const block = el.parentElement && (el.parentElement.closest('h1,h2,h3,h4,h5,h6,p,li,[data-framer-component-type="RichTextContainer"]') || el.parentElement);
    return {
      section: window.__paritySectionOf(el),
      name: el.getAttribute('data-framer-name') || '',
      text: own(el) || clean(el.textContent),
      parentText: block ? clean(block.textContent) : undefined,
      // Whole, to find a line inside a text animated as one on the other site.
      full: clean(el.textContent, 300),
      parentFull: block ? clean(block.textContent, 300) : undefined,
      // The size before transforms: a ring scaled to nothing at this moment is still a ring.
      w: Math.max(r.width, el.offsetWidth || 0),
      h: Math.max(r.height, el.offsetHeight || 0),
    };
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
  // Times from the page's own DOMContentLoaded, so the network and hydration speed do not count.
  const nav = performance.getEntriesByType('navigation')[0];
  const ready = nav ? nav.domContentLoadedEventEnd : 0;
  const out = [];
  const at = performance.now();
  for (const [el, info] of window.__parityMoved) {
    // A start state set once or twice (and put in place again on a re-split) never moved.
    if (info.start === undefined && (info.count || 0) < 3) continue;
    // Paints nothing (a transparent overlay that blocks clicks): its motion cannot be seen.
    if (el.isConnected && window.__parityBlank(el)) continue;
    // Moved only while it could not be seen (a caret blinking in a bubble already gone) and still unseen.
    if (info.hiddenAtStart && (!el.isConnected || window.__parityHidden(el))) continue;
    // Still changing at the end of the rest after the scroll: a loop (also kept for the hover probes).
    if (info.lastStyle !== undefined && at - info.lastStyle < 800) info.loop = true;
    // Described now when it is still shown in a section, else as it was when it first moved
    // (removed since, or inside a part that has faded out, like a loader).
    const now = el.isConnected ? window.__parityDescribe(el) : null;
    const d = now && now.section ? now : info.first || now;
    if (!d || !d.section || d.w < 2 || d.h < 2 || d.h > innerHeight * 2) continue;
    const r = el.isConnected ? el.getBoundingClientRect() : null;
    out.push({
      section: d.section,
      name: d.name,
      text: d.text,
      parentText: d.parentText,
      full: d.full,
      parentFull: d.parentFull,
      loop: !!info.loop,
      startMs: Math.round((info.start !== undefined ? info.start : info.t) - ready),
      scroll: info.scroll,
      kinds: Array.from(info.kinds),
      live: (r && (!!el.closest('[data-live]') || (live.get(d.section) || []).some((b) => inside(r, b)))) || false,
    });
  }
  return out;
}

// Runs in the page: marks the hover targets of each section and returns their labels. The original
// gets up to MAX_PROBES per section; the rebuild gets exactly the targets the original probed.
function markProbes(sections, max, wanted) {
  const norm = (t) => (t || '').replace(/[​-‏⁠﻿]/g, '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 60);
  const out = [];
  let n = 0;
  for (const s of sections) {
    const root = window.__parityRootOf(s);
    if (!root) continue;
    const want = wanted ? wanted.filter((w) => w.section === s.id).map((w) => norm(w.target)) : null;
    let k = 0;
    // The root itself can be the link (a badge whose section marker is on the <a>).
    const links = [root, ...root.querySelectorAll('a, button, [role="button"]')].filter((el) => el.matches('a, button, [role="button"]'));
    for (const el of links) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const target = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('data-framer-name') || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 40);
      if (want ? !want.includes(norm(target)) : k >= max) continue;
      // A link inside another section nested in this one (a header in a page section) is that section's.
      if (window.__paritySectionOf(el) !== s.id) continue;
      el.setAttribute('data-parity-probe', String(n));
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
  [el, ...Array.from(el.querySelectorAll('*')).slice(0, 200)].forEach((node, k) => {
    // A loop inside the link changes on its own, hovered or not.
    if (node.hasAttribute('data-parity-restless')) return;
    const cs = getComputedStyle(node);
    for (const p of props) out[k + '|' + p] = cs.getPropertyValue(p);
    const r = node.getBoundingClientRect();
    out[k + '|size'] = Math.round(r.width) + 'x' + Math.round(r.height);
  });
  return out;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function visit(browser, url, width, side, wanted) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width, height: 900 });
    await page.evaluateOnNewDocument(sectionTools, sections, side);
    await page.evaluateOnNewDocument(watch);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
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
      for (const p of await page.evaluate(markProbes, sections, MAX_PROBES, wanted || null)) {
        const handle = await page.$('[data-parity-probe="' + p.n + '"]');
        if (!handle) continue;
        await page.evaluate((n) => {
          const el = document.querySelector('[data-parity-probe="' + n + '"]');
          window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + scrollY - 300));
        }, p.n);
        await wait(300);
        await page.evaluate((n) => {
          const el = document.querySelector('[data-parity-probe="' + n + '"]');
          for (const node of [el, ...el.querySelectorAll('*')]) {
            const e = window.__parityMoved.get(node);
            const infinite = node.getAnimations().some((an) => an.effect && an.effect.getTiming().iterations === Infinity);
            if ((e && e.loop) || infinite) node.setAttribute('data-parity-restless', '');
          }
        }, p.n);
        // What changes on its own (a loop inside the link) over the same wait is not the hover.
        const idle = await page.evaluate(snapshot, p.n);
        await wait(400);
        const before = await page.evaluate(snapshot, p.n);
        const restless = new Set(Object.keys(before).filter((k) => before[k] !== idle[k]));
        try {
          await handle.hover();
        } catch {
          continue;
        }
        await wait(400);
        const after = await page.evaluate(snapshot, p.n);
        const changed = Array.from(new Set(Object.keys(after).filter((k) => after[k] !== before[k] && !restless.has(k)).map((k) => k.split('|')[1])));
        let image;
        if (changed.length) {
          // Named after the target, so the original's and the rebuild's images pair up.
          const name = p.section + '-' + p.target.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) + '-' + side + '.png';
          image = 'ai-guide/parity/' + slug + '/' + name;
          await handle.screenshot({ path: path.join(shotDir, name) }).catch(() => (image = undefined));
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
const raw = {};
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
      mine = await visit(browser, base + route, width, 'rebuild', theirs ? theirs.probes.map((p) => ({ section: p.section, target: p.target })) : null);
    } catch (e) {
      error = (error ? error + '; ' : '') + 'rebuild not reachable at ' + base + route + ' (start the site with npm run dev): ' + (e && e.message ? e.message.split('\n')[0] : e);
    }
    if (!theirs || !mine) {
      // Nothing to compare, but what was measured on the rebuild is still shown.
      const rebuildOnly = mine ? { sections: mine.boxes.length, moving: mine.moved.length, probes: mine.probes.length } : undefined;
      result.widths[width] = { layout: [], motion: [], interaction: [], error, rebuildOnly };
      continue;
    }
    if (dump) raw[width] = { original: theirs, rebuild: mine };
    const motion = motionDiffs(theirs.moved, mine.moved);
    for (const m of motion.cannotMatch) if (!result.cannotMatch.some((x) => x.section === m.section && x.text === m.text)) result.cannotMatch.push(m);
    result.widths[width] = {
      layout: layoutDiffs(theirs.boxes, mine.boxes),
      motion: motion.diffs,
      offsetMs: motion.offsetMs,
      interaction: interactionDiffs(theirs.probes, mine.probes),
    };
  }
} finally {
  await browser.close();
}

const report = renderReport(route, result, sources);
// --dump: what was measured on both sites, to see why an item is (or is not) reported.
if (dump) fs.writeFileSync(path.join(outDir, slug + '.raw.json'), JSON.stringify(raw, null, 1));
fs.writeFileSync(path.join(outDir, slug + '.md'), report);
for (const w of WIDTHS) {
  const r = result.widths[w];
  console.log(w + ': ' + (r.error ? r.error : 'layout ' + r.layout.filter((d) => !d.inherited).length + ', motion ' + r.motion.length + ', interaction ' + r.interaction.length));
}
console.log('Report: ai-guide/parity/' + slug + '.md');
`;
