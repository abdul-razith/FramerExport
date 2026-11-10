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
    if (series.slice(-3).some((s) => !same(s.v, last.v))) {
      entries.push({ key, label, section: '', trigger: 'loop', note: `keeps changing: ${describe(first.v, last.v) || 'transform'} …`, frames: frames(first.t, last.t) });
      continue;
    }
    const firstChange = series.findIndex((s) => !same(s.v, first.v));
    const start = firstChange > 0 ? series[firstChange - 1].t : first.t;
    let endIndex = series.length - 1;
    while (endIndex > 0 && same(series[endIndex - 1].v, last.v)) endIndex--;
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
    });
  }
  return entries;
}

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
      entries.push({ key: n.key, label, section: '', trigger: 'scroll', note: (m.scroll ?? []).map((s) => `${s.property}: ${s.values.join(' → ')}`).join('; ') + ' (top → bottom of the page)' });
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

/** Repeated elements (cards in a grid) with the same animation are listed once, with a count. */
function mergeRepeats(entries: MotionEntry[]): MotionEntry[] {
  const out: (MotionEntry & { count: number })[] = [];
  for (const e of entries) {
    const parent = e.key.split('/').slice(0, -1).join('/');
    const twin = out.find(
      (o) => o.label === e.label && o.trigger === e.trigger && o.note === e.note && o.from === e.from && o.key.split('/').slice(0, -1).join('/') === parent
    );
    if (twin) twin.count++;
    else out.push({ ...e, count: 1 });
  }
  return out.map(({ count, ...e }) => (count > 1 ? { ...e, note: `${e.note ? e.note + ' ' : ''}(×${count})` } : e));
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
