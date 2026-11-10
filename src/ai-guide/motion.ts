import { parseTransform } from '../nextjs/framer/animations.js';
import type { Node, Style, Transform } from '../nextjs/model.js';
import type { GuidePage, MotionEntry, TimelineSample } from './types.js';

type Value = TimelineSample['values'][string];

const same = (a: Value | undefined, b: Value | undefined) => !!a && !!b && a.opacity === b.opacity && a.transform === b.transform;

/** `div[Hero Tag]:3` → `Hero Tag`; `p:1` → `p "text"`. */
function labelOf(key: string, text = ''): string {
  const last = key.split('/').pop() ?? key;
  const named = last.match(/\[(.+)\]/)?.[1];
  if (named) return named;
  const tag = last.replace(/:\d+$/, '');
  return text ? `${tag} "${text.slice(0, 30)}"` : tag;
}

function describeTransform(t: Omit<Transform, 'opacity'>): string[] {
  const parts: string[] = [];
  if (t.x) parts.push(`translateX ${t.x}px`);
  if (t.y) parts.push(`translateY ${t.y}px`);
  if (t.rotate) parts.push(`rotate ${t.rotate}°`);
  if (t.scale !== undefined) parts.push(`scale ${t.scale}`);
  return parts;
}

function describe(v: Value, other: Value): string {
  const parts: string[] = [];
  if (v.opacity !== other.opacity) parts.push(`opacity ${v.opacity}`);
  if (v.transform !== other.transform) parts.push(...(describeTransform(parseTransform(v.transform)).length ? describeTransform(parseTransform(v.transform)) : ['no transform']));
  return parts.join(', ');
}

/** Numbers that move during the animation, for overshoot detection. */
function numbers(v: Value): number[] {
  const t = parseTransform(v.transform);
  return [Number(v.opacity), t.x ?? 0, t.y ?? 0, t.rotate ?? 0, t.scale ?? 1];
}

function overshoots(series: Value[]): boolean {
  const first = numbers(series[0]);
  const last = numbers(series[series.length - 1]);
  return series.some((v) =>
    numbers(v).some((x, i) => {
      const dir = Math.sign(last[i] - first[i]);
      return dir !== 0 && Math.sign(x - last[i]) === dir && Math.abs(x - last[i]) > 1e-3;
    })
  );
}

const frame = (t: number, every: number) => String(Math.round(t / every)).padStart(3, '0');

/** Turns load (or mid-page) timeline samples into motion entries; static elements give none. */
export function summarizeLoad(samples: TimelineSample[], frameEveryMs: number, framesDir = 'load'): MotionEntry[] {
  if (samples.length < 2) return [];
  const keys = new Set(samples.flatMap((s) => Object.keys(s.values)));
  const entries: MotionEntry[] = [];
  for (const key of keys) {
    const series = samples.filter((s) => s.values[key]).map((s) => ({ t: s.t, v: s.values[key] }));
    if (series.length < 2) continue;
    const first = series[0];
    const last = series[series.length - 1];
    const frames = (a: number, b: number) => `${framesDir}/${frame(a, frameEveryMs)}–${frame(b, frameEveryMs)}`;
    const label = labelOf(key, last.v.text);
    if (series.some((s) => s.v.text !== first.v.text)) {
      entries.push({ key, label, section: '', trigger: 'custom', note: `text changes: "${first.v.text}" → "${last.v.text}"`, frames: frames(first.t, last.t) });
      continue;
    }
    if (series.every((s) => same(s.v, last.v))) continue;
    const firstChange = series.findIndex((s) => !same(s.v, first.v));
    const start = firstChange > 0 ? series[firstChange - 1].t : first.t;
    const stillMoving = series.slice(-3).some((s) => !same(s.v, last.v));
    if (stillMoving) {
      // A loop moves the whole time; an entrance that began late is merely unfinished.
      const active = series.slice(Math.max(1, firstChange));
      const moving = active.filter((s, i) => !same(s.v, (i === 0 ? series[Math.max(0, firstChange - 1)] : active[i - 1]).v)).length;
      if (last.t - start >= LOOP_MIN_MS && moving / active.length >= 0.7) {
        entries.push({ key, label, section: '', trigger: 'loop', note: `keeps changing: ${describe(first.v, last.v) || 'transform'} …`, frames: frames(first.t, last.t) });
        continue;
      }
    }
    let endIndex = series.length - 1;
    while (!stillMoving && endIndex > 0 && same(series[endIndex - 1].v, last.v)) endIndex--;
    const end = series[endIndex].t;
    entries.push({
      key,
      label,
      section: '',
      trigger: 'load',
      from: describe(first.v, last.v),
      to: describe(last.v, first.v),
      startMs: start,
      durationMs: end - start,
      easing: overshoots(series.map((s) => s.v)) ? 'spring-like overshoot' : 'ease-out',
      frames: frames(start, end),
      ...(stillMoving ? { note: 'still moving when the recording ended — see the last frames for its final state' } : {}),
    });
  }
  return mergeRepeats(entries);
}

/** Below this, an element still changing at the end of the recording is an unfinished entrance. */
const LOOP_MIN_MS = 2500;

function describeFrom(t: Transform | undefined): string {
  if (!t) return '';
  return [t.opacity !== undefined ? `opacity ${t.opacity}` : '', ...describeTransform(t)].filter(Boolean).join(', ');
}

/** Animations the capture already knows: in-view reveals, scroll-linked values, markers, hover CSS. */
export function motionFromNodes(root: Node, hover: { key: string; style: Style }[]): MotionEntry[] {
  const entries: MotionEntry[] = [];
  const visit = (n: Node) => {
    const m = n.motion;
    const label = n.framerName ?? labelOf(n.key, n.text);
    if (m?.kind === 'reveal' || m?.kind === 'split-text') {
      entries.push({ key: n.key, label, section: '', trigger: 'in-view', from: describeFrom(m.from), to: 'its normal state', note: m.kind === 'split-text' ? 'letters/words animate one after another' : undefined });
    } else if (m?.kind === 'scroll') {
      entries.push({ key: n.key, label, section: '', trigger: 'scroll', note: (m.scroll ?? []).map((s) => `${s.property}: ${s.values.map((v) => readableValue(s.property, v)).join(' → ')}`).join('; ') + ' (top → bottom of the page)' });
    } else if (m?.kind === 'loader' || m?.kind === 'cursor' || m?.kind === 'smooth-scroll') {
      const what = { loader: 'page loader (see load frames)', cursor: 'custom cursor that follows the mouse', 'smooth-scroll': 'smooth scrolling for the whole page' }[m.kind];
      entries.push({ key: n.key, label, section: '', trigger: 'custom', note: what });
    }
    n.children.forEach(visit);
  };
  visit(root);
  for (const h of hover) {
    entries.push({ key: h.key, label: labelOf(h.key), section: '', trigger: 'hover', note: Object.entries(h.style).map(([p, v]) => `${p}: ${v}`).join('; ') });
  }
  return mergeRepeats(entries);
}

/** `span "B"` → `B`: the one-character label of a letter Framer split into its own span. */
const letterOf = (label: string) => label.match(/^[a-z0-9]+ "(.{1,2})"$/)?.[1];

/**
 * Siblings with the same animation are listed once: repeated elements (cards in a grid) with a
 * count, and the letters of a split word as `letters "<word>"` (staggered when their starts differ).
 */
function mergeRepeats(entries: MotionEntry[]): MotionEntry[] {
  type Group = MotionEntry & { count: number; letters: string; end: number; starts: Set<number> };
  const out: Group[] = [];
  const parentOf = (k: string) => k.split('/').slice(0, -1).join('/');
  for (const e of entries) {
    const letter = letterOf(e.label);
    const twin = out.find(
      (o) =>
        o.trigger === e.trigger &&
        o.from === e.from &&
        o.to === e.to &&
        parentOf(o.key) === parentOf(e.key) &&
        (letter !== undefined ? o.letters !== '' : o.label === e.label && o.note === e.note)
    );
    const end = (e.startMs ?? 0) + (e.durationMs ?? 0);
    if (twin) {
      twin.count++;
      twin.letters += letter ?? '';
      twin.end = Math.max(twin.end, end);
      if (e.startMs !== undefined) twin.starts.add(e.startMs);
      twin.startMs = Math.min(twin.startMs ?? Infinity, e.startMs ?? Infinity);
      if (twin.startMs === Infinity) delete twin.startMs;
    } else {
      out.push({ ...e, count: 1, letters: letter ?? '', end, starts: new Set(e.startMs !== undefined ? [e.startMs] : []) });
    }
  }
  return out.map(({ count, letters, end, starts, ...e }) => {
    if (count === 1) return e;
    if (letters) {
      const merged: MotionEntry = { ...e, label: `letters "${letters}"` };
      if (merged.startMs !== undefined && merged.durationMs !== undefined) merged.durationMs = end - merged.startMs;
      if (starts.size > 1) merged.note = `${merged.note ? merged.note + ' · ' : ''}one letter after another (staggered)`;
      return merged;
    }
    return { ...e, note: `${e.note ? e.note + ' ' : ''}(×${count})` };
  });
}

/** `matrix(1, 0, 0, 1, 0, -40)` → `translateY -40px`. */
function readableValue(property: string, value: string): string {
  if (property !== 'transform' || value === 'none') return value;
  return describeTransform(parseTransform(value)).join(', ') || 'none';
}

function line(e: MotionEntry): string {
  const parts = [`trigger: ${e.trigger}`];
  if (e.from || e.to) parts.push(`${e.from || '?'} → ${e.to || '?'}`);
  if (e.startMs !== undefined) parts.push(`starts ${e.startMs} ms`);
  if (e.durationMs !== undefined) parts.push(`lasts ${e.durationMs} ms`);
  if (e.easing) parts.push(e.easing);
  if (e.note) parts.push(e.note);
  if (e.frames) parts.push(`frames ${e.frames}`);
  return `- **${e.label}** — ${parts.join(' · ')}`;
}

export function renderMotionMd(page: GuidePage, entries: MotionEntry[]): string {
  const out = [`# Animations — ${page.route}`, ''];
  if (!entries.length) {
    out.push('No animation was detected on this page.', '');
    return out.join('\n');
  }
  out.push(
    'Measured on the live site. Times are from page load. Frames are in `frames/` (load, scroll, loop), numbered in 200 ms steps; a frame is only saved when the page changed, so a missing number means nothing moved at that moment. Rebuild with motion (load, in-view, hover) or GSAP ScrollTrigger (scroll); animate only transform and opacity.',
    ''
  );
  const sectionOf = (e: MotionEntry) =>
    e.section || page.sections.find((s) => e.key === s.key || e.key.startsWith(s.key + '/'))?.name || 'Page-wide';
  const normal = entries.filter((e) => e.trigger !== 'custom');
  const groups = new Map<string, MotionEntry[]>();
  for (const e of normal) groups.set(sectionOf(e), [...(groups.get(sectionOf(e)) ?? []), e]);
  const order = [...page.sections.map((s) => s.name), 'Page-wide'];
  for (const name of order) {
    const list = groups.get(name);
    if (list) out.push(`## ${name}`, '', ...list.map(line), '');
  }
  const custom = entries.filter((e) => e.trigger === 'custom');
  if (custom.length) {
    out.push('## Custom behaviour', '', 'Not a plain style animation: write a small component for each (e.g. TypingText, LiveClock, Loader).', '');
    out.push(...custom.map((e) => `${line(e)} · section: ${sectionOf(e)}`), '');
  }
  return out.join('\n');
}
