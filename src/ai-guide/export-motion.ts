import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** One Framer animation setting found in the export's page JS for an element. */
export interface ExportAnimation {
  /** Export-relative module path (`scripts/vendor/<file>.mjs`). */
  file: string;
  /** Character offset of the element's props object in that file. */
  offset: number;
  className: string;
  layer?: string;
  kind: 'enter' | 'exit' | 'animate' | 'loop' | 'scroll' | 'appear';
  once?: boolean;
  /** The animated state (enter: start values; loop/exit/animate: target values), or the raw text (≤ 300 chars). */
  values: Record<string, unknown> | string;
  transition?: Record<string, unknown> | string;
  repeatType?: string;
  repeatDelay?: number;
}

export function loadVendorModules(exportDir: string): { file: string; text: string }[] {
  const dir = path.join(exportDir, 'scripts', 'vendor');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.m?js$/.test(f))
    .sort()
    .map((f) => ({ file: `scripts/vendor/${f}`, text: readFileSync(path.join(dir, f), 'utf8') }));
}

/** Index after a string, template literal or comment starting at `i`, or `i` when there is none. */
function skipLiteral(t: string, i: number): number {
  const c = t[i];
  if (c === '"' || c === "'") {
    let j = i + 1;
    while (j < t.length && t[j] !== c && t[j] !== '\n') j += t[j] === '\\' ? 2 : 1;
    return j + 1;
  }
  if (c === '`') {
    let j = i + 1;
    while (j < t.length && t[j] !== '`') {
      if (t[j] === '\\') j += 2;
      else if (t[j] === '$' && t[j + 1] === '{') j = matchClose(t, j + 1) + 1;
      else j++;
    }
    return j + 1;
  }
  if (c === '/' && t[i + 1] === '/') {
    const e = t.indexOf('\n', i);
    return e < 0 ? t.length : e;
  }
  if (c === '/' && t[i + 1] === '*') {
    const e = t.indexOf('*/', i + 2);
    return e < 0 ? t.length : e + 2;
  }
  return i;
}

/** Index of the bracket closing the one at `open` (`{`, `[` or `(`). */
function matchClose(t: string, open: number): number {
  let depth = 0;
  for (let i = open; i < t.length; i++) {
    const s = skipLiteral(t, i);
    if (s !== i) {
      i = s - 1;
      continue;
    }
    const c = t[i];
    if (c === '{' || c === '[' || c === '(') depth++;
    else if ((c === '}' || c === ']' || c === ')') && --depth === 0) return i;
  }
  return t.length - 1;
}

/** Top-level `key: value` entries of an object literal's inner text. */
function entries(inner: string): [string, string][] {
  const out: [string, string][] = [];
  let depth = 0;
  let start = 0;
  const push = (end: number) => {
    const part = inner.slice(start, end).trim();
    const m = part.match(/^(?:"([^"]+)"|'([^']+)'|`([^`]+)`|([\w$]+))\s*:\s*([\s\S]*)$/);
    if (m) out.push([m[1] ?? m[2] ?? m[3] ?? m[4], m[5].trim()]);
  };
  for (let i = 0; i < inner.length; i++) {
    const s = skipLiteral(inner, i);
    if (s !== i) {
      i = s - 1;
      continue;
    }
    const c = inner[i];
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') depth--;
    else if (c === ',' && depth === 0) {
      push(i);
      start = i + 1;
    }
  }
  push(inner.length);
  return out;
}

const ANIMATION_KEYS = /^(opacity|x|y|scale|scaleX|scaleY|rotate|rotateX|rotateY|skewX|skewY|delay|duration|ease|type|damping|stiffness|mass|bounce)$/;

class Unparsed extends Error {}

/** Evaluates a JS literal (objects, arrays, numbers, strings, `!0`/`!1`); identifiers resolve to module definitions. */
function evaluate(text: string, mod: string, depth = 0): unknown {
  const v = text.trim();
  if (/^-?(\d+\.?\d*|\.\d+)(e-?\d+)?$/i.test(v)) return Number(v);
  if (v === '!0' || v === 'true') return true;
  if (v === '!1' || v === 'false') return false;
  if (v === 'null' || v === 'void 0' || v === 'undefined') return null;
  const str = v.match(/^(?:"([^"\\]*)"|'([^'\\]*)'|`([^`$\\]*)`)$/);
  if (str) return str[1] ?? str[2] ?? str[3];
  if (v.startsWith('{') && matchClose(v, 0) === v.length - 1) {
    const obj: Record<string, unknown> = {};
    for (const [k, val] of entries(v.slice(1, -1))) obj[k] = evaluate(val, mod, depth);
    return obj;
  }
  if (v.startsWith('[') && matchClose(v, 0) === v.length - 1) {
    const inner = v.slice(1, -1).trim();
    return inner ? splitTop(inner).map((p) => evaluate(p, mod, depth)) : [];
  }
  if (/^[A-Za-z_$][\w$]*$/.test(v) && depth < 4) return resolve(v, mod, depth + 1);
  throw new Unparsed(v);
}

function splitTop(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const s = skipLiteral(inner, i);
    if (s !== i) {
      i = s - 1;
      continue;
    }
    const c = inner[i];
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inner.slice(start));
  return parts.filter((p) => p.trim());
}

/**
 * The value of `name = {...}` in the module. Minified code reuses short names in different scopes,
 * so when there are several definitions the one that looks like an animation wins.
 */
function resolve(name: string, mod: string, depth: number): unknown {
  const re = new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}\\s*=\\s*(?=[{\\[])`, 'g');
  const candidates: unknown[] = [];
  for (const m of mod.matchAll(re)) {
    const open = m.index! + m[0].length;
    try {
      candidates.push(evaluate(mod.slice(open, matchClose(mod, open) + 1), mod, depth));
    } catch {}
  }
  const animationLike = candidates.find((c) => c && typeof c === 'object' && Object.keys(c).some((k) => ANIMATION_KEYS.test(k)));
  if (animationLike !== undefined) return animationLike;
  if (candidates.length) return candidates[0];
  throw new Unparsed(name);
}

const raw = (text: string) => (text.length > 300 ? text.slice(0, 300) + '…' : text);

function value(text: string, mod: string): Record<string, unknown> | string {
  try {
    const v = evaluate(text, mod);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : raw(text);
  } catch {
    return raw(text);
  }
}

/** Object literal ranges `[open, close]` of a module, sorted by start. */
function objectRanges(t: string): [number, number][] {
  const out: [number, number][] = [];
  const stack: number[] = [];
  for (let i = 0; i < t.length; i++) {
    const s = skipLiteral(t, i);
    if (s !== i) {
      i = s - 1;
      continue;
    }
    if (t[i] === '{') stack.push(i);
    else if (t[i] === '}' && stack.length) out.push([stack.pop()!, i]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** Framer keeps a state's own timing inside the state (`{ opacity: 0, transition: {...} }`); that one applies. */
function ownTransition(a: ExportAnimation): ExportAnimation {
  if (typeof a.values !== 'object' || !('transition' in a.values)) return a;
  const { transition, ...values } = a.values;
  return { ...a, values, transition: transition as Record<string, unknown> };
}

/** Framer animation settings for elements carrying any of `classes`, read from the export's JS modules. */
export function findAnimations(modules: { file: string; text: string }[], classes: string[]): ExportAnimation[] {
  const out: ExportAnimation[] = [];
  for (const { file, text } of modules) {
    const present = classes.filter((c) => text.includes(c));
    if (!present.length) continue;
    const ranges = objectRanges(text);
    const seen = new Set<number>();
    for (const cls of present) {
      for (const m of text.matchAll(new RegExp(`(?<![\\w-])${cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'g'))) {
        let range: [number, number] | undefined;
        for (const r of ranges) if (r[0] < m.index! && r[1] > m.index! && (!range || r[0] > range[0])) range = r;
        if (!range || seen.has(range[0])) continue;
        const props = new Map(entries(text.slice(range[0] + 1, range[1])));
        if (!props.get('className')?.includes(cls)) continue;
        seen.add(range[0]);
        const base = { file, offset: range[0], className: cls, layer: (props.get('"data-framer-name"') ?? props.get('data-framer-name'))?.replace(/^[`"']|[`"']$/g, '') };
        const transitionOf = (key: string) => {
          const t = props.get(key);
          if (!t) return undefined;
          const v = value(t, text);
          return typeof v === 'object' && 'transition' in v ? (v.transition as Record<string, unknown>) : v;
        };
        const once = props.get('__framer__animateOnce') ? evaluateSafe(props.get('__framer__animateOnce')!, text) === true : undefined;
        if (props.has('__framer__enter')) out.push({ ...base, kind: 'enter', once, values: value(props.get('__framer__enter')!, text), transition: transitionOf('__framer__animate') });
        if (props.has('__framer__exit')) out.push({ ...base, kind: 'exit', values: value(props.get('__framer__exit')!, text), transition: transitionOf('__framer__animate') });
        if (props.has('__framer__loop'))
          out.push({
            ...base,
            kind: 'loop',
            values: value(props.get('__framer__loop')!, text),
            transition: props.has('__framer__loopTransition') ? value(props.get('__framer__loopTransition')!, text) : undefined,
            repeatType: strOf(props.get('__framer__loopRepeatType'), text),
            repeatDelay: numOf(props.get('__framer__loopRepeatDelay'), text),
          });
        for (const key of ['__framer__transformTargets', '__framer__scrollTransform']) {
          if (props.has(key)) out.push({ ...base, kind: 'scroll', values: value(props.get(key)!, text) });
        }
        if (props.has('initial') || (props.has('animate') && !props.has('__framer__enter'))) {
          out.push({ ...base, kind: 'appear', values: value(props.get('initial') ?? props.get('animate')!, text), transition: props.has('transition') ? value(props.get('transition')!, text) : undefined });
        } else if (props.has('__framer__animate') && !props.has('__framer__enter') && !props.has('__framer__exit')) {
          out.push({ ...base, kind: 'animate', values: value(props.get('__framer__animate')!, text) });
        }
      }
    }
  }
  return out.map(ownTransition);
}

function evaluateSafe(text: string, mod: string): unknown {
  try {
    return evaluate(text, mod);
  } catch {
    return undefined;
  }
}
const strOf = (t: string | undefined, mod: string) => (t ? (evaluateSafe(t, mod) as string | undefined) : undefined);
const numOf = (t: string | undefined, mod: string) => {
  const v = t ? evaluateSafe(t, mod) : undefined;
  return typeof v === 'number' ? v : undefined;
};

/** Values an element rests at when nothing is animating it. */
const REST: Record<string, number> = { opacity: 1, x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, rotateX: 0, rotateY: 0, skewX: 0, skewY: 0 };
const ORDER = Object.keys(REST);

const fmt = (v: unknown) => (Array.isArray(v) ? `[${v.join(', ')}]` : typeof v === 'object' ? JSON.stringify(v) : String(v));

function describeTransition(t: Record<string, unknown> | string | undefined): string {
  if (!t) return '';
  if (typeof t === 'string') return `transition ${t}`;
  const parts: string[] = [];
  if (t.type === 'spring') {
    const spring = ['stiffness', 'damping', 'mass', 'bounce'].filter((k) => t[k] !== undefined).map((k) => `${k} ${t[k]}`);
    parts.push(`spring ${spring.join(', ')}`.trim());
    if (t.duration !== undefined) parts.push(`duration ${t.duration}s`);
  } else {
    parts.push(`${t.type ?? 'tween'}${t.duration !== undefined ? ` ${t.duration}s` : ''}`);
    if (t.ease !== undefined) parts.push(`ease ${fmt(t.ease)}`);
  }
  if (typeof t.delay === 'number' && t.delay > 0) parts.push(`delay ${t.delay}s`);
  return parts.join(', ');
}

/** One readable line, e.g. `enter (in view, once): opacity 0→1, y 40→0 · spring stiffness 200, damping 30, delay 0.2s · source: …`. */
export function describeAnimation(a: ExportAnimation): string {
  const source = `source: ${a.file} @ ${a.offset}`;
  const head =
    a.kind === 'enter' ? `enter (in view${a.once ? ', once' : ''})`
    : a.kind === 'loop' ? `loop (${[a.repeatType, a.repeatDelay ? `repeat delay ${a.repeatDelay}s` : ''].filter(Boolean).join(', ') || 'repeat'})`
    : a.kind;
  let change: string;
  if (typeof a.values === 'string') change = `raw ${a.values}`;
  else {
    const v = a.values;
    const keys = [...ORDER.filter((k) => k in v), ...Object.keys(v).filter((k) => !ORDER.includes(k))];
    if (a.kind === 'enter') {
      change = keys.filter((k) => k in REST && v[k] !== REST[k]).map((k) => `${k} ${fmt(v[k])}→${REST[k]}`).join(', ');
    } else {
      change = keys.filter((k) => !(k in REST) || v[k] !== REST[k]).map((k) => `${k} ${fmt(v[k])}`).join(', ');
      if (a.kind === 'loop' || a.kind === 'exit' || a.kind === 'animate') change = change ? `to ${change}` : 'no change';
    }
  }
  return [`${head}: ${change || 'no visible change'}`, describeTransition(a.transition), source].filter(Boolean).join(' · ');
}
