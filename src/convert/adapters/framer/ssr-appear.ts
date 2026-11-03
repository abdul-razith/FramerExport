import type { Page } from 'puppeteer';
import type { AnimationEntry } from '../../types.js';
import { parseNodes, type Node } from './components.js';
import { NON_VISUAL, stablePathFromMain } from './selectors.js';

/**
 * Framer SSR-renders the initial state of an appear effect as inline `opacity`/`transform` and runs the
 * effect right after load, often before the runtime observer's first snapshot. These helpers recover such
 * effects from the export HTML: the inline value is the `from`, the settled computed value the `to`.
 */

export interface SsrInitial {
  /** Hydration-stable path from `#main`. */
  selector: string;
  name?: string;
  from: { opacity?: string; transform?: string };
}

const MAX_CANDIDATES = 500;

/** Inline style declarations; `;` inside parentheses or quotes (data URLs) does not split. */
function declarations(style: string): Map<string, string> {
  const out = new Map<string, string>();
  let depth = 0;
  let quote = '';
  let start = 0;
  const flush = (end: number) => {
    const decl = style.slice(start, end);
    const colon = decl.indexOf(':');
    if (colon > 0) out.set(decl.slice(0, colon).trim().toLowerCase(), decl.slice(colon + 1).trim());
    start = end + 1;
  };
  for (let i = 0; i < style.length; i++) {
    const c = style[i]!;
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === ';' && depth === 0) flush(i);
  }
  flush(style.length);
  return out;
}

/** True for `none`, empty, or a list of transform functions that each leave the element unchanged. */
export function isIdentityTransform(value: string): boolean {
  const t = value.trim().toLowerCase();
  if (!t || t === 'none') return true;
  const fns = [...t.matchAll(/([a-z0-9]+)\(([^()]*)\)/g)];
  if (t.replace(/([a-z0-9]+)\(([^()]*)\)/g, '').trim() !== '') return false;
  const IDENTITY_3D = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return fns.every(([, fn, raw]) => {
    const args = raw!.split(/[\s,]+/).filter(Boolean).map((a) => parseFloat(a));
    if (!args.length || args.some((a) => !Number.isFinite(a))) return false;
    if (/^(translate|rotate|skew)/.test(fn!)) return args.every((a) => a === 0);
    if (/^scale/.test(fn!)) return args.every((a) => a === 1);
    if (fn === 'matrix') return args.join() === '1,0,0,1,0,0';
    if (fn === 'matrix3d') return args.join() === IDENTITY_3D.join();
    return false;
  });
}

/** Elements inside `#main` whose inline style sets `opacity` < 1 or a non-identity `transform`. */
export function ssrAppearCandidates(html: string): SsrInitial[] {
  const nodes = parseNodes(html);
  const main = nodes.find((n) => n.id === 'main');
  if (!main) return [];
  const insideMain = (n: Node) => {
    for (let a = n.parent; a; a = a.parent) if (a === main) return true;
    return false;
  };
  const out: SsrInitial[] = [];
  for (const n of nodes) {
    if (out.length >= MAX_CANDIDATES) break;
    if (!n.attrs.style || NON_VISUAL.has(n.tag) || !insideMain(n)) continue;
    const decl = declarations(n.attrs.style);
    const from: SsrInitial['from'] = {};
    const opacity = decl.get('opacity');
    if (opacity !== undefined && parseFloat(opacity) < 1) from.opacity = opacity;
    const transform = decl.get('transform');
    if (transform !== undefined && !isIdentityTransform(transform)) from.transform = transform;
    if (!from.opacity && !from.transform) continue;
    const c: SsrInitial = { selector: stablePathFromMain(n, main), from };
    if (n.name !== undefined) c.name = n.name;
    out.push(c);
  }
  return out;
}

// Page-side reader, evaluated as a string so transpiler helpers never leak into the page.
const READ = String.raw`((cands) => {
  const close = (a, b) => {
    const x = new DOMMatrix(a).toFloat64Array();
    const y = new DOMMatrix(b).toFloat64Array();
    return x.every((v, i) => Math.abs(v - y[i]) < 0.01);
  };
  const out = [];
  for (const c of cands) {
    let el = null;
    try {
      const all = document.querySelectorAll(c.selector);
      if (all.length === 1) el = all[0];
    } catch (e) {}
    if (!el) continue;
    if (c.name !== undefined && el.getAttribute('data-framer-name') !== c.name) continue;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth)) continue;
    const cs = getComputedStyle(el);
    const from = {};
    const to = {};
    if (c.from.opacity !== undefined && !(Math.abs(parseFloat(c.from.opacity) - parseFloat(cs.opacity)) < 0.01)) {
      from.opacity = c.from.opacity;
      to.opacity = cs.opacity;
    }
    if (c.from.transform !== undefined) {
      // Resolve the inline value (percentages refer to the element's own box) on a same-size probe.
      const probe = document.createElement('div');
      const w = el.offsetWidth !== undefined ? el.offsetWidth : r.width;
      const h = el.offsetHeight !== undefined ? el.offsetHeight : r.height;
      probe.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;width:' + w + 'px;height:' + h + 'px';
      probe.style.transform = c.from.transform;
      document.body.appendChild(probe);
      const initial = getComputedStyle(probe).transform;
      probe.remove();
      let same = initial === cs.transform;
      try { if (!same) same = close(initial, cs.transform); } catch (e) {}
      if (!same) {
        from.transform = c.from.transform;
        to.transform = cs.transform;
      }
    }
    if (Object.keys(to).length) out.push({ i: c.i, from, to });
  }
  return out;
})`;

/**
 * Read the settled state of `candidates` on the loaded (not scrolled) page. Entries are emitted for
 * elements within the first viewport whose computed opacity/transform differ from the SSR inline values.
 */
export async function readSsrAppear(page: Page, route: string, candidates: SsrInitial[]): Promise<AnimationEntry[]> {
  if (!candidates.length) return [];
  const payload = candidates.map((c, i) => ({ i, selector: c.selector, name: c.name, from: c.from }));
  const found = (await page.evaluate(`${READ}(${JSON.stringify(payload)})`)) as Array<{
    i: number;
    from: Record<string, string>;
    to: Record<string, string>;
  }>;
  return found.map((f) => {
    const c = candidates[f.i]!;
    const entry: AnimationEntry = { route, selector: c.selector, trigger: 'appear', from: f.from, to: f.to, confidence: 'low' };
    if (c.name !== undefined) entry.framerName = c.name;
    return entry;
  });
}

/** Drop SSR entries whose element already has an observed appear (or loop) entry. */
export async function withoutObserved(
  page: Page,
  ssr: AnimationEntry[],
  observed: AnimationEntry[]
): Promise<AnimationEntry[]> {
  const known = observed.filter((e) => e.trigger === 'appear' || e.trigger === 'loop').map((e) => e.selector);
  if (!ssr.length || !known.length) return ssr;
  const keep = (await page.evaluate(
    `((ssr, known) => {
      const q = (s) => { try { return document.querySelector(s); } catch (e) { return null; } };
      const els = new Set(known.map(q).filter(Boolean));
      return ssr.map((s) => !known.includes(s) && !els.has(q(s)));
    })(${JSON.stringify(ssr.map((e) => e.selector))}, ${JSON.stringify(known)})`
  )) as boolean[];
  return ssr.filter((_, i) => keep[i]);
}
