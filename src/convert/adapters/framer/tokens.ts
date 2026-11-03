import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Tokens } from '../../types.js';

type Prop = 'color' | 'background' | 'border';
interface Usage {
  prop: Prop;
  count: number;
}

const BASE_NAME: Record<Prop, string> = { color: 'ink', background: 'surface', border: 'line' };

/** Base name by dominant usage; ties broken by the order color, background, border. */
export function nameColor(_value: string, usage: Usage[]): string {
  const totals: Record<Prop, number> = { color: 0, background: 0, border: 0 };
  for (const u of usage) totals[u.prop] += u.count;
  let best: Prop = 'color';
  for (const p of ['color', 'background', 'border'] as Prop[]) {
    if (totals[p] > totals[best]) best = p;
  }
  return BASE_NAME[best];
}

function classifyProp(prop: string): Prop | null {
  const p = prop.toLowerCase();
  if (p.startsWith('--')) return null;
  if (p.startsWith('background')) return 'background';
  if (p.startsWith('border') || p.startsWith('outline')) return 'border';
  if (p === 'color' || p === 'fill' || p === 'stroke' || p.endsWith('-color')) return 'color';
  return null;
}

function stripFontFaces(html: string): string {
  return html.replace(/@font-face\s*\{[^}]*\}/g, '');
}

function extractFontFaces(html: string): Array<{ family: string; weight: string; style: string; file: string; unicodeRange?: string }> {
  const out: Array<{ family: string; weight: string; style: string; file: string; unicodeRange?: string }> = [];
  for (const m of html.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const body = m[1];
    const family = /font-family:\s*["']?([^;"']+)["']?\s*;/.exec(body)?.[1]?.trim();
    const src = /url\(\s*["']?([^)"']+)["']?\s*\)/.exec(body)?.[1];
    if (!family || !src) continue;
    const weight = /font-weight:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? '400';
    const style = /font-style:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? 'normal';
    const unicodeRange = /unicode-range:\s*([^;]+);/.exec(body)?.[1]?.trim();
    out.push({ family, weight, style, file: src.replace(/^\.?\//, '').split('\\').join('/'), ...(unicodeRange ? { unicodeRange } : {}) });
  }
  return out;
}

function usedFamilies(html: string): Set<string> {
  const text = stripFontFaces(html).replace(/&quot;/g, '"');
  const used = new Set<string>();
  for (const m of text.matchAll(/font-family[\w-]*:\s*([^;}]*)/g)) {
    for (const part of m[1].split(',')) {
      const name = part.replace(/var\([^)]*$/, '').replace(/["')(]/g, '').trim();
      if (name) used.add(name);
    }
  }
  return used;
}

function extractFonts(html: string, exportDir: string): Tokens['fonts'] {
  const used = usedFamilies(html);
  const groups = new Map<string, Tokens['fonts'][number]>();
  for (const f of extractFontFaces(html)) {
    if (!used.has(f.family)) continue;
    if (!f.file.startsWith('assets/fonts/')) continue;
    if (!existsSync(path.join(exportDir, f.file))) continue;
    const key = `${f.family}|${f.weight}|${f.style}`;
    let g = groups.get(key);
    if (!g) {
      g = { family: f.family, files: [], weight: f.weight, style: f.style };
      groups.set(key, g);
    }
    if (!g.files.some((x) => x.path === f.file && x.unicodeRange === f.unicodeRange)) {
      g.files.push({ path: f.file, ...(f.unicodeRange ? { unicodeRange: f.unicodeRange } : {}) });
    }
  }
  return [...groups.values()];
}

function extractColors(html: string): { colors: Record<string, string>; tokenMap: Record<string, string> } {
  const values = new Map<string, string>();
  for (const m of html.matchAll(/(--token-[0-9a-f-]+)\s*:\s*([^;}]+)/g)) {
    const v = m[2].trim();
    if (/^(#|rgb|hsl)/i.test(v) && !values.has(m[1])) values.set(m[1], v);
  }
  const usage = new Map<string, Map<Prop, number>>();
  for (const m of html.matchAll(/([\w-]+)\s*:\s*([^;{}]*)/g)) {
    const prop = classifyProp(m[1]);
    if (!prop) continue;
    for (const u of m[2].matchAll(/var\(\s*(--token-[0-9a-f-]+)/g)) {
      const per = usage.get(u[1]) ?? new Map<Prop, number>();
      per.set(prop, (per.get(prop) ?? 0) + 1);
      usage.set(u[1], per);
    }
  }
  const colors: Record<string, string> = {};
  const tokenMap: Record<string, string> = {};
  const taken = new Map<string, number>();
  for (const [token, value] of [...values].sort(([a], [b]) => a.localeCompare(b))) {
    const list = [...(usage.get(token) ?? [])].map(([prop, count]) => ({ prop, count }));
    const base = nameColor(value, list);
    const n = (taken.get(base) ?? 0) + 1;
    taken.set(base, n);
    const name = n === 1 ? base : `${base}-${n}`;
    colors[name] = value;
    tokenMap[token] = name;
  }
  return { colors, tokenMap };
}

function extractTypeScale(html: string): Tokens['typeScale'] {
  const seen = new Map<string, { size: string; lineHeight: string; letterSpacing: string; px: number }>();
  for (const m of html.matchAll(/\{([^{}]*)\}/g)) {
    const body = m[1];
    const size = /(?:^|[;\s])(?:--framer-)?font-size:\s*([\d.]+(?:px|rem|em))/.exec(body)?.[1];
    if (!size) continue;
    const lh = /(?:^|[;\s])(?:--framer-)?line-height:\s*([\d.]+(?:px|rem|em|%)?)/.exec(body)?.[1] ?? 'normal';
    const ls = /(?:^|[;\s])(?:--framer-)?letter-spacing:\s*(-?[\d.]+(?:px|rem|em)|0)/.exec(body)?.[1] ?? 'normal';
    const key = `${size}|${lh}|${ls}`;
    if (seen.has(key)) continue;
    const num = parseFloat(size);
    seen.set(key, { size, lineHeight: lh, letterSpacing: ls, px: size.endsWith('px') ? num : num * 16 });
  }
  return [...seen.values()]
    .sort((a, b) => b.px - a.px)
    .map(({ size, lineHeight, letterSpacing }, i) => ({ name: `text-${i + 1}`, size, lineHeight, letterSpacing }));
}

export function extractTokens(html: string, exportDir: string): Tokens {
  const hasLg = /@media\s*\(\s*min-width\s*:\s*1200px\s*\)/.test(html);
  const hasMd = /@media\s*\(\s*max-width\s*:\s*809\.98px\s*\)/.test(html);
  if (!hasLg || !hasMd) {
    throw new Error(
      'Expected Framer breakpoint media queries (min-width: 1200px and max-width: 809.98px) were not found; cannot derive breakpoint tokens.'
    );
  }
  const { colors, tokenMap } = extractColors(html);
  return {
    colors,
    tokenMap,
    fonts: extractFonts(html, exportDir),
    typeScale: extractTypeScale(html),
    breakpoints: { md: 810, lg: 1200 },
  };
}
