import type { ExportAnimation } from './export-motion.js';

/**
 * Framer's on-load ("appear") animations, read from the JSON it ships in the page HTML
 * (`<script type="framer/appear" id="__framer__appearAnimationsContent">`). Unlike the page JS, this
 * block holds the exact transition (delay, duration, ease or spring) for every element, per breakpoint.
 */

export type Breakpoint = 'desktop' | 'laptop' | 'tablet' | 'mobile';

export interface AppearState {
  initial: Record<string, number>;
  /** The settled state, without its `transition`. */
  animate: Record<string, number>;
  transition: Record<string, unknown>;
}

export interface AppearAnimation extends AppearState {
  /** The class suffix: the element's class is `framer-<id>`. */
  id: string;
  byBreakpoint: Partial<Record<Breakpoint, AppearState>>;
}

function scriptJson(html: string, id: string): unknown {
  const m = html.match(new RegExp(`<script[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</script>`));
  if (!m) return undefined;
  try {
    return JSON.parse(m[1]);
  } catch {
    return undefined;
  }
}

/** Names a Framer media query: no max → desktop, no min → mobile, else laptop (min ≥ 1200) or tablet. */
function breakpointOf(mediaQuery: string): Breakpoint {
  const min = mediaQuery.match(/min-width:\s*([\d.]+)px/);
  const max = mediaQuery.match(/max-width:\s*([\d.]+)px/);
  if (!max) return 'desktop';
  if (!min) return 'mobile';
  return Number(min[1]) >= 1200 ? 'laptop' : 'tablet';
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function stateOf(v: unknown): AppearState | undefined {
  if (!isObject(v) || !isObject(v.initial) || !isObject(v.animate)) return undefined;
  const { transition, ...animate } = v.animate;
  return {
    initial: v.initial as Record<string, number>,
    animate: animate as Record<string, number>,
    transition: isObject(transition) ? transition : {},
  };
}

export function parseAppearAnimations(html: string): Map<string, AppearAnimation> {
  const out = new Map<string, AppearAnimation>();
  const content = scriptJson(html, '__framer__appearAnimationsContent');
  if (!isObject(content)) return out;
  const names = new Map<string, Breakpoint>();
  const breakpoints = scriptJson(html, '__framer__breakpoints');
  if (Array.isArray(breakpoints)) {
    for (const b of breakpoints) {
      if (isObject(b) && typeof b.hash === 'string' && typeof b.mediaQuery === 'string') names.set(b.hash, breakpointOf(b.mediaQuery));
    }
  }
  for (const [id, entry] of Object.entries(content)) {
    if (!isObject(entry)) continue;
    // An entry is either the state itself or `{ default: state, <breakpoint hash>: state, … }`.
    const base = stateOf(entry) ?? stateOf(entry.default);
    if (!base) continue;
    const byBreakpoint: Partial<Record<Breakpoint, AppearState>> = {};
    if (!stateOf(entry)) {
      for (const [key, value] of Object.entries(entry)) {
        const state = stateOf(value);
        const name = key === 'default' ? 'desktop' : names.get(key);
        if (state && name) byBreakpoint[name] = state;
      }
    }
    out.set(id, { id, ...base, byBreakpoint });
  }
  return out;
}

const sameState = (a: AppearState, b: AppearState) =>
  JSON.stringify([a.initial, a.animate, a.transition]) === JSON.stringify([b.initial, b.animate, b.transition]);

/**
 * Takes each `appear` animation whose class is `framer-<id>` from the page's appear JSON: its start
 * values (`initial`), its exact `transition`, and its per-width states when those differ.
 */
export function mergeAppear(animations: ExportAnimation[], appear: Map<string, AppearAnimation>): ExportAnimation[] {
  return animations.map((a) => {
    if (a.kind !== 'appear') return a;
    const found = appear.get(a.className.replace(/^framer-/, ''));
    if (!found) return a;
    const states = Object.values(found.byBreakpoint);
    const differs = states.some((s) => !sameState(s, found));
    return { ...a, values: found.initial, transition: found.transition, ...(differs ? { byBreakpoint: found.byBreakpoint } : {}) };
  });
}
