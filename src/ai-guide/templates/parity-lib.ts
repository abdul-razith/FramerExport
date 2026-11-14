/**
 * Source of ai-guide/scripts/parity-lib.mjs: the pure part of the parity report (diffs and the
 * report text), imported by parity.mjs. Written as a raw string without `${` or backticks, so the
 * script text is exactly what is below.
 */
export const PARITY_LIB_MJS = String.raw`// Diffs between the original site and the rebuild, and the report text. Used by parity.mjs.

const LAYOUT_TOL = 4;
// Load animations start on a rendered frame, which varies by up to ~200ms between runs.
const TIME_TOL = 300;

/** Text for matching: case, spacing, non-breaking spaces and invisible marks do not count. */
export function normText(s) {
  return String(s || '')
    .replace(/[​-‏⁠﻿]/g, '')
    .replace(/ /g, ' ')
    // Whitespace depends on where elements start and end (a card's name and text joined or not).
    .replace(/\s+/g, '')
    .toLowerCase()
    .slice(0, 60);
}

/**
 * Section tops and heights compared. The first section whose top moved is the cause; sections below
 * that moved by the same amount inherit it. A section on one site only is missing or extra, and is
 * then the cause of what moved below it.
 */
export function layoutDiffs(original, rebuild, tol = LAYOUT_TOL) {
  const shown = (list) => list.filter((b) => b.height > 0);
  const o = shown(original);
  const r = shown(rebuild);
  const mine = new Map(r.map((b, i) => [b.id, Object.assign({ index: i }, b)]));
  const theirs = new Set(o.map((b) => b.id));
  const out = [];
  let shift = 0;
  // A section missing or extra above the next common section explains its shift.
  let structural = false;
  let lastIndex = -1;
  for (const a of o) {
    const b = mine.get(a.id);
    if (!b) {
      out.push({ id: a.id, kind: 'missing', original: a.top, inherited: false });
      structural = true;
      continue;
    }
    if (r.slice(lastIndex + 1, b.index).some((x) => !theirs.has(x.id))) structural = true;
    lastIndex = b.index;
    const dt = Math.round(b.top - a.top);
    const dh = Math.round(b.height - a.height);
    if (Math.abs(dt) > tol) out.push({ id: a.id, kind: 'top', original: Math.round(a.top), rebuild: Math.round(b.top), delta: dt, inherited: structural || Math.abs(dt - shift) <= tol });
    structural = false;
    if (Math.abs(dh) > tol) out.push({ id: a.id, kind: 'height', original: Math.round(a.height), rebuild: Math.round(b.height), delta: dh, inherited: false });
    // What the sections below should be shifted by when nothing else changes.
    shift = dt + dh;
  }
  for (const b of r) if (!theirs.has(b.id)) out.push({ id: b.id, kind: 'extra', rebuild: b.top, inherited: false });
  return out;
}

/** Split letters (one or two characters with a parent text) become one item for their text. */
export function groupLetters(raw) {
  const out = [];
  const groups = new Map();
  for (const m of raw) {
    const piece = String(m.text || '').trim().length <= 2 && m.parentText && normText(m.parentText) !== normText(m.text);
    if (!piece) {
      out.push(m);
      continue;
    }
    const key = m.section + '|' + m.parentText;
    const g = groups.get(key);
    if (g) {
      g.startMs = Math.min(g.startMs, m.startMs);
      g.kinds = Array.from(new Set(g.kinds.concat(m.kinds)));
      g.live = g.live || m.live;
      g.scroll = g.scroll && m.scroll;
    } else {
      const item = { section: m.section, name: m.name, text: m.parentText, startMs: m.startMs, kinds: m.kinds.slice(), live: m.live, scroll: m.scroll };
      groups.set(key, item);
      out.push(item);
    }
  }
  // Several movements of one text (its start state set, then animated; letters and their line) are
  // one item: the earliest start, on load if any of them was.
  const merged = [];
  const byText = new Map();
  for (const m of out) {
    const key = m.section + '|' + normText(m.text);
    const g = normText(m.text) ? byText.get(key) : undefined;
    if (!g) {
      const item = Object.assign({}, m, { kinds: m.kinds.slice() });
      if (normText(m.text)) byText.set(key, item);
      merged.push(item);
      continue;
    }
    g.startMs = Math.min(g.startMs, m.startMs);
    g.kinds = Array.from(new Set(g.kinds.concat(m.kinds)));
    g.live = g.live || m.live;
    g.scroll = !!(g.scroll && m.scroll);
  }
  return merged;
}

const label = (m) => m.text || m.name || 'element';
/** Same text, or one text inside the other (a heading animated whole vs. one of its words or lines). */
function sameText(a, b) {
  const x = normText(a.text);
  const y = normText(b.text);
  if (!x || !y) return !x && !y;
  return x === y || (Math.min(x.length, y.length) >= 3 && (x.includes(y) || y.includes(x)));
}

/**
 * What moves on one site and not the other, by section, then text, then layer name. Generated
 * (live) items never count: they go to cannotMatch.
 */
export function motionDiffs(original, rebuild, tolMs = TIME_TOL) {
  const o = groupLetters(original);
  const r = groupLetters(rebuild).filter((m) => !m.live);
  const cannotMatch = o.filter((m) => m.live);
  const used = new Set();
  const diffs = [];
  const timed = [];
  // Every same-text pair first, then a text that only contains another (a heading word inside a
  // line, a whole paragraph and its lines): a containing text must not take an item's own pair.
  const pairOf = new Map();
  for (const a of o) {
    if (a.live || !a.text) continue;
    const i = r.findIndex((b, k) => !used.has(k) && b.section === a.section && normText(a.text) === normText(b.text));
    if (i >= 0) {
      used.add(i);
      pairOf.set(a, i);
    }
  }
  for (const a of o) {
    if (a.live) continue;
    // Elements without text (images, shapes) match in order; the layer name only breaks ties.
    const free = (b, k) => !used.has(k) && b.section === a.section && sameText(a, b);
    let i = pairOf.has(a) ? pairOf.get(a) : -1;
    if (i < 0) i = r.findIndex((b, k) => free(b, k) && (a.text || b.name === a.name));
    if (i < 0) i = r.findIndex(free);
    if (i < 0) {
      diffs.push({ section: a.section, kind: 'missing', label: label(a), originalMs: a.startMs, scroll: !!a.scroll });
      continue;
    }
    used.add(i);
    if (!!a.scroll !== !!r[i].scroll) {
      diffs.push({ section: a.section, kind: 'trigger', label: label(a), originalMs: a.startMs, rebuildMs: r[i].startMs, scroll: !!a.scroll });
      continue;
    }
    // Scroll-triggered start times depend on page speed, not on the animation: only load ones are timed.
    if (!a.scroll && !r[i].scroll) timed.push([a, r[i]]);
  }
  // The original starts its effects when its scripts are ready, which varies by hundreds of ms
  // from run to run. With enough load items, the median gap is that lag: an item is late or early
  // when it is out of step with the rest of the page.
  const gaps = timed.map(([a, b]) => b.startMs - a.startMs).sort((x, y) => x - y);
  const offsetMs = gaps.length >= 3 ? Math.round(gaps[Math.floor((gaps.length - 1) / 2)]) : 0;
  for (const [a, b] of timed) {
    if (Math.abs(b.startMs - a.startMs - offsetMs) > tolMs) diffs.push({ section: a.section, kind: 'timing', label: label(a), originalMs: a.startMs, rebuildMs: b.startMs });
  }
  r.forEach((b, k) => {
    if (!used.has(k)) diffs.push({ section: b.section, kind: 'extra', label: label(b), rebuildMs: b.startMs, scroll: !!b.scroll });
  });
  return { diffs, cannotMatch, offsetMs };
}

/** Hover and press changes the original makes that the rebuild does not make (or makes differently). */
export function interactionDiffs(original, rebuild) {
  // rotate, scale and translate are transforms written another way.
  const set = (list) => Array.from(new Set(list.map((p) => (/^(rotate|scale|translate)$/.test(p) ? 'transform' : p)))).sort().join(',');
  const out = [];
  for (const a of original) {
    if (!a.changed.length) continue;
    // Several rebuild targets can share a label (a logo link and a nav link both "Home"): the one
    // that changes the same things counts, else the first.
    const same = rebuild.filter((x) => x.section === a.section && x.action === a.action && normText(x.target) === normText(a.target));
    if (same.some((x) => set(x.changed) === set(a.changed))) continue;
    const b = same.find((x) => x.changed.length) || same[0];
    out.push({ section: a.section, target: a.target, action: a.action, original: a.changed, rebuild: b ? b.changed : null, image: a.image });
  }
  return out;
}

function pointerFor(src, item) {
  if (!src) return '';
  const want = normText(item);
  const a = src.animations.find((x) => normText(x.label) === want) || src.animations[0];
  return a ? a.at + ' (' + a.kind + ')' : src.folder;
}

/** The report: per width, per check, one line per difference with its pointer into the export. */
export function renderReport(page, result, sources) {
  const src = (id) => sources[id] || (sources._shell && sources._shell[id]);
  // Numeric keys come back in ascending order: list desktop first.
  const widths = Object.keys(result.widths).sort((x, y) => Number(y) - Number(x));
  let layout = 0;
  let motion = 0;
  let interaction = 0;
  for (const w of widths) {
    layout += result.widths[w].layout.filter((d) => !d.inherited).length;
    motion += result.widths[w].motion.length;
    interaction += result.widths[w].interaction.length;
  }
  const failed = widths.filter((w) => result.widths[w].error);
  const total = layout + motion + interaction;
  const out = [
    '# Parity: ' + page,
    '',
    (failed.length ? 'Not compared at ' + failed.join(', ') + ' (see below): fix that and run npm run parity again. ' : '') +
      (total === 0
        ? failed.length
          ? 'No differences at the widths that were compared.'
          : 'No differences. This page matches the original.'
        : total + ' differences (layout ' + layout + ', motion ' + motion + ', interaction ' + interaction + '). Fix each from its pointer, then run npm run parity again.'),
    '',
  ];
  for (const w of widths) {
    const r = result.widths[w];
    out.push('## ' + w, '');
    if (r.error) out.push('- ' + r.error);
    if (r.rebuildOnly) out.push('- rebuild measured: ' + r.rebuildOnly.sections + ' sections, ' + r.rebuildOnly.moving + ' moving elements, ' + r.rebuildOnly.probes + ' hover targets');
    if (r.error || r.rebuildOnly) out.push('');
    out.push('### Layout', '');
    if (!r.layout.length) out.push('- none');
    for (const d of r.layout) {
      const s = src(d.id);
      const where = s ? ' → ' + s.styles + (s.markup ? ' · markup ' + s.markup : '') : '';
      if (d.kind === 'missing') out.push('- ' + d.id + ': missing on the rebuild (no data-section="' + d.id + '")' + where);
      else if (d.kind === 'extra') out.push('- ' + d.id + ': only on the rebuild');
      else if (d.inherited) out.push('- ' + d.id + ': ' + d.kind + ' ' + (d.delta > 0 ? '+' : '') + d.delta + 'px, follows the section above');
      else out.push('- ' + d.id + ': ' + d.kind + ' ' + (d.delta > 0 ? '+' : '') + d.delta + 'px (original ' + d.original + ', rebuild ' + d.rebuild + ')' + where);
    }
    out.push('', '### Motion', '');
    // The original's load speed varies by run: a page-wide lag is said once, not per item.
    if (Math.abs(r.offsetMs || 0) > TIME_TOL) out.push('On-load animations start ' + Math.abs(r.offsetMs) + ' ms ' + (r.offsetMs < 0 ? 'earlier' : 'later') + ' overall than on the original (its own load speed varies by run); the items below are out of step with that.', '');
    if (!r.motion.length) out.push('- none');
    for (const d of r.motion) {
      const p = pointerFor(src(d.section), d.label);
      const when = (ms) => (d.scroll ? 'when scrolled to' : 'at ' + ms + ' ms');
      if (d.kind === 'missing') out.push('- ' + d.section + ' · ' + d.label + ': missing on the rebuild (moves on the original ' + when(d.originalMs) + ')' + (p ? ' → ' + p : ''));
      else if (d.kind === 'extra') out.push('- ' + d.section + ' · ' + d.label + ': moves on the rebuild only (' + when(d.rebuildMs) + ')');
      else if (d.kind === 'trigger')
        out.push('- ' + d.section + ' · ' + d.label + ': ' + (d.scroll ? 'plays on load on the rebuild, when scrolled to on the original' : 'plays when scrolled to on the rebuild, on load on the original') + (p ? ' → ' + p : ''));
      else out.push('- ' + d.section + ' · ' + d.label + ': starts at ' + d.rebuildMs + ' ms, the original at ' + d.originalMs + ' ms' + (p ? ' → ' + p : ''));
    }
    out.push('', '### Interaction', '');
    if (!r.interaction.length) out.push('- none');
    for (const d of r.interaction) {
      const s = src(d.section);
      const h = s && (s.hovers.find((x) => normText(x.element) === normText(d.target)) || s.hovers[0]);
      out.push('- ' + d.section + ' · ' + d.target + ' (' + d.action + '): the original changes ' + d.original.join(', ') + '; the rebuild ' + (d.rebuild && d.rebuild.length ? 'changes ' + d.rebuild.join(', ') : 'changes nothing') + (h ? ' → ' + h.at : s ? ' → ' + s.styles : '') + (d.image ? ' · ' + d.image : ''));
    }
    out.push('');
  }
  out.push('## Cannot match', '', 'Generated or random on the original (clocks, live values): not compared.', '');
  if (!result.cannotMatch.length) out.push('- none');
  for (const m of result.cannotMatch) out.push('- ' + m.section + ' · ' + label(m));
  out.push('');
  return out.join('\n');
}
`;
