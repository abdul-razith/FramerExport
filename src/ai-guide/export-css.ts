import { BREAKPOINTS, CAPTURE_WIDTHS, type Breakpoint } from '../nextjs/model.js';
import { normalizeColor, type ThemeTokens } from '../nextjs/tokens.js';

/** One style rule of the export's CSS; `media` is the enclosing `@media` condition, if any. */
export interface CssRule {
  selector: string;
  body: string;
  media?: string;
}

/**
 * `all` (no media), `desktop` (≥1200), `tablet` (810–1199 only), `tablet-mobile` (≤1199),
 * `mobile` (≤809), `other` (anything else).
 */
export type WidthGroup = 'all' | 'desktop' | 'tablet' | 'tablet-mobile' | 'mobile' | 'other';

/** Skips a quoted string or comment starting at `i`; returns the index after it, or `i` when there is none. */
function skipQuoted(text: string, i: number): number {
  const c = text[i];
  if (c === '"' || c === "'") {
    let j = i + 1;
    while (j < text.length && text[j] !== c) j += text[j] === '\\' ? 2 : 1;
    return j + 1;
  }
  if (c === '/' && text[i + 1] === '*') {
    const end = text.indexOf('*/', i + 2);
    return end < 0 ? text.length : end + 2;
  }
  return i;
}

/** Index of the `}` matching the `{` at `open`. */
function matchBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const skip = skipQuoted(text, i);
    if (skip !== i) {
      i = skip - 1;
      continue;
    }
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return i;
  }
  return text.length;
}

function parseBlock(text: string, media: string | undefined, out: CssRule[]): void {
  let i = 0;
  let start = 0;
  while (i < text.length) {
    const skip = skipQuoted(text, i);
    if (skip !== i) {
      if (text[i] === '/') start = skip; // a comment is not part of the next selector
      i = skip;
      continue;
    }
    if (text[i] === ';' && text.slice(start, i).trim().startsWith('@')) {
      start = i + 1; // @import, @charset
    } else if (text[i] === '{') {
      const prelude = text.slice(start, i).trim();
      const close = matchBrace(text, i);
      const body = text.slice(i + 1, close);
      if (/^@media\b/i.test(prelude)) {
        const cond = prelude.replace(/^@media\s*/i, '').trim();
        parseBlock(body, media ? `${media} and ${cond}` : cond, out);
      } else if (/^@supports\b/i.test(prelude)) {
        parseBlock(body, media, out);
      } else if (!prelude.startsWith('@') && prelude) {
        out.push({ selector: prelude, body: body.trim(), ...(media ? { media } : {}) });
      }
      i = close + 1;
      start = i;
      continue;
    }
    i++;
  }
}

/** Every style rule in the page's `<style>` blocks, `@media` unwrapped; `@font-face`, `@keyframes` and similar are skipped. */
export function parseExportCss(html: string): CssRule[] {
  const out: CssRule[] = [];
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) parseBlock(m[1], undefined, out);
  return out;
}

/** Whether a media condition holds at a viewport width (min-/max-width only; anything else never holds). */
function mediaMatches(media: string, width: number): boolean {
  const parts = media.split(/\s+and\s+/i);
  let understood = false;
  for (const p of parts) {
    const m = p.match(/\(\s*(min|max)-width\s*:\s*([\d.]+)(px)?\s*\)/i);
    if (!m) {
      if (/^\s*(only\s+)?(screen|all)\s*$/i.test(p)) continue;
      return false;
    }
    understood = true;
    const v = Number(m[2]);
    if (m[1].toLowerCase() === 'min' ? width < v : width > v) return false;
  }
  return understood;
}

const WIDTHS = BREAKPOINTS.map((bp) => [bp, CAPTURE_WIDTHS[bp]] as const);

/** The capture widths a media condition applies to (all three when there is none). */
export function mediaWidths(media?: string): Breakpoint[] {
  return media ? WIDTHS.filter(([, w]) => mediaMatches(media, w)).map(([bp]) => bp) : [...BREAKPOINTS];
}

export function widthGroup(media?: string): WidthGroup {
  const key = mediaWidths(media).join(',');
  if (key === 'base,tablet,mobile') return media ? 'other' : 'all';
  if (key === 'base') return 'desktop';
  if (key === 'tablet') return 'tablet';
  if (key === 'tablet,mobile') return 'tablet-mobile';
  if (key === 'mobile') return 'mobile';
  return 'other';
}

const classRe = (cls: string) => new RegExp(`\\.${cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`);

/** `hidden-<id>` class → the widths where it is `display:none` (Framer's per-breakpoint copies). */
export function hiddenClassWidths(rules: CssRule[]): Map<string, Breakpoint[]> {
  const out = new Map<string, Breakpoint[]>();
  for (const r of rules) {
    if (!/display\s*:\s*none/i.test(r.body)) continue;
    for (const m of r.selector.matchAll(/\.(hidden-[\w-]+)/g)) {
      const widths = new Set([...(out.get(m[1]) ?? []), ...mediaWidths(r.media)]);
      out.set(m[1], BREAKPOINTS.filter((bp) => widths.has(bp)));
    }
  }
  return out;
}

/** `:root` custom properties: `--token-ink` → `rgb(20,20,20)`. */
function rootVariables(rules: CssRule[]): Map<string, string> {
  const vars = new Map<string, string>();
  for (const r of rules) {
    if (r.media || !/(^|,)\s*(:root|html|body)\s*(,|$)/.test(r.selector)) continue;
    for (const m of r.body.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) vars.set(m[1], m[2].trim());
  }
  return vars;
}

/** Replaces `var(--token-x, fallback)` by `var(--color-<name>) /* raw *\/` when its value is a known colour token. */
function withTokens(body: string, vars: Map<string, string>, tokens: ThemeTokens): string {
  return body.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g, (raw, name: string, fallback?: string) => {
    const value = vars.get(name) ?? fallback;
    const token = value ? tokens.colorByValue.get(normalizeColor(value)) : undefined;
    return token ? `var(--color-${token}) /* ${raw} */` : raw;
  });
}

const HEADINGS: Record<Exclude<WidthGroup, 'other'>, string> = {
  all: '/* all widths */',
  desktop: '/* desktop ≥1200px */',
  tablet: '/* tablet 810–1199px */',
  'tablet-mobile': '/* tablet + mobile ≤1199px */',
  mobile: '/* mobile ≤809px */',
};

const PRESET = /\.framer-styles-preset-/;

/** Rules whose selector parts pass `keep`, list parts trimmed to those, identical rules once, grouped by width. */
function collect(rules: CssRule[], keep: (part: string) => boolean, tokens: ThemeTokens): string {
  const vars = rootVariables(rules);
  const groups = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const r of rules) {
    const parts = r.selector.split(/,(?![^(]*\))/).map((p) => p.trim()).filter(keep);
    if (!parts.length) continue;
    const g = widthGroup(r.media);
    const heading = g === 'other' ? `/* @media ${r.media} */` : HEADINGS[g];
    const body = withTokens(r.body, vars, tokens)
      .split(/;(?![^(]*\))/)
      .map((d) => d.trim())
      .filter(Boolean)
      .join(';\n  ');
    const block = `${parts.join(',\n')} {\n  ${body};\n}`;
    if (seen.has(heading + block)) continue;
    seen.add(heading + block);
    groups.set(heading, [...(groups.get(heading) ?? []), block]);
  }
  const order = [HEADINGS.all, HEADINGS.desktop, HEADINGS['tablet-mobile'], HEADINGS.tablet, HEADINGS.mobile];
  const keys = [...groups.keys()].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  return keys.map((k) => `${k}\n${groups.get(k)!.join('\n')}`).join('\n\n') + (keys.length ? '\n' : '');
}

/** The export's rules that use any of `classes` (text style presets excluded: see `textStyles`). */
export function stylesForClasses(rules: CssRule[], classes: string[], tokens: ThemeTokens): string {
  const tests = classes.map(classRe);
  return collect(rules, (part) => !PRESET.test(part) && tests.some((t) => t.test(part)), tokens);
}

/** The rules of Framer's text style presets (`framer-styles-preset-*`), written once for the whole site. */
export function textStyles(rules: CssRule[], presets: string[], tokens: ThemeTokens): string {
  const tests = presets.map(classRe);
  return collect(rules, (part) => tests.some((t) => t.test(part)), tokens);
}
