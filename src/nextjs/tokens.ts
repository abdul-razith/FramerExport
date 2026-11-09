import type { Node, Style } from './model.js';

export interface ThemeTokens {
  colors: Record<string, string>;
  fonts: Record<string, string>;
  radii: Record<string, string>;
  shadows: Record<string, string>;
  colorByValue: Map<string, string>;
  fontByFamily: Map<string, string>;
  radiusByValue: Map<string, string>;
  shadowByValue: Map<string, string>;
}

const NAMED: Record<string, string> = {
  white: '#ffffff',
  black: '#000000',
  transparent: '#00000000',
};

const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');

/** Lowercase `#rrggbb`, or `#rrggbbaa` when alpha < 1. Unparseable input is returned unchanged. */
export function normalizeColor(css: string): string {
  const v = css.trim().toLowerCase();
  if (NAMED[v]) return NAMED[v];
  let m = v.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length === 8 && h.endsWith('ff')) h = h.slice(0, 6);
    return h.length === 6 || h.length === 8 ? '#' + h : css;
  }
  m = v.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (m) {
    const alphaRaw = m[4];
    let alpha = alphaRaw === undefined ? 1 : alphaRaw.endsWith('%') ? Number(alphaRaw.slice(0, -1)) / 100 : Number(alphaRaw);
    if (!Number.isFinite(alpha)) alpha = 1;
    const rgb = '#' + hex2(+m[1]) + hex2(+m[2]) + hex2(+m[3]);
    return alpha >= 1 ? rgb : rgb + hex2(alpha * 255);
  }
  return css;
}

function parseHex(hex: string): { r: number; g: number; b: number; a: number } {
  const h = hex.slice(1);
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
  };
}

const FAMILIES: [string, number, number][] = [
  ['red', 345, 360],
  ['red', 0, 15],
  ['orange', 15, 40],
  ['yellow', 40, 65],
  ['green', 65, 170],
  ['cyan', 170, 200],
  ['blue', 200, 250],
  ['purple', 250, 290],
  ['pink', 290, 345],
];

/** Deterministic readable name: hue family + lightness step (`green-900`), alpha suffix `-aNN`. */
export function nameColor(hex: string): string {
  const { r, g, b, a } = parseHex(normalizeColor(hex));
  const alpha = a < 1 ? `-a${Math.round(a * 100)}` : '';
  if (r === 255 && g === 255 && b === 255) return 'white' + alpha;
  if (r === 0 && g === 0 && b === 0) return 'black' + alpha;
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let family = 'neutral';
  if (s >= 0.1) {
    let h = 0;
    if (max === R) h = 60 * (((G - B) / d) % 6);
    else if (max === G) h = 60 * ((B - R) / d + 2);
    else h = 60 * ((R - G) / d + 4);
    if (h < 0) h += 360;
    family = FAMILIES.find(([, lo, hi]) => h >= lo && h < hi)![0];
  }
  const step = Math.min(950, Math.max(50, Math.round((1 - l) * 10) * 100 || 50));
  return `${family}-${step}${alpha}`;
}

const GENERIC_FAMILIES = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace']);

function primaryFamily(stack: string): string {
  return stack.split(',')[0].trim().replace(/^["']|["']$/g, '');
}

function fontRole(family: string): string | undefined {
  if (/mono/i.test(family)) return 'mono';
  if (/script|hand|me again/i.test(family)) return 'script';
  return undefined;
}

const kebab = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'font';

function allStyles(node: Node): Style[] {
  return [node.styles.base, node.styles.tablet, node.styles.mobile, node.hover].filter(
    (s): s is Style => !!s
  );
}

const SIDES = ['top', 'right', 'bottom', 'left'];

function colorValues(style: Style): string[] {
  const out: string[] = [];
  for (const prop of ['color', 'background-color', 'text-decoration-color']) {
    if (style[prop]) out.push(style[prop]);
  }
  for (const side of SIDES) {
    const width = parseFloat(style[`border-${side}-width`] ?? '0');
    const color = style[`border-${side}-color`];
    if (color && width > 0) out.push(color);
  }
  return out;
}

function uniformRadius(style: Style): string | undefined {
  const vals = ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map(
    (c) => style[`border-${c}-radius`]
  );
  return vals[0] && vals[0] !== '0px' && vals.every((v) => v === vals[0]) ? vals[0] : undefined;
}

/** Collects every colour, font family, repeated radius and repeated shadow into named tokens. */
export function collectTokens(roots: Node[]): ThemeTokens {
  const tokens: ThemeTokens = {
    colors: {},
    fonts: {},
    radii: {},
    shadows: {},
    colorByValue: new Map(),
    fontByFamily: new Map(),
    radiusByValue: new Map(),
    shadowByValue: new Map(),
  };
  const headingFamilies = new Map<string, number>();
  const textFamilies = new Map<string, number>();
  const families: string[] = [];
  const radiusCount = new Map<string, number>();
  const shadowCount = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

  const walk = (node: Node, inheritedFamily: string | undefined) => {
    for (const style of allStyles(node)) {
      for (const raw of colorValues(style)) {
        const hex = normalizeColor(raw);
        if (!hex.startsWith('#') || tokens.colorByValue.has(hex)) continue;
        if (hex.length === 9 && hex.endsWith('00')) continue; // fully transparent
        let name = nameColor(hex);
        for (let n = 2; tokens.colors[name]; n++) name = `${nameColor(hex)}-${n}`;
        tokens.colors[name] = hex;
        tokens.colorByValue.set(hex, name);
      }
      const radius = uniformRadius(style);
      if (radius) bump(radiusCount, radius);
      if (style['box-shadow'] && style['box-shadow'] !== 'none') bump(shadowCount, style['box-shadow']);
      if (style['font-family']) {
        const fam = primaryFamily(style['font-family']);
        if (!families.includes(fam)) families.push(fam);
      }
    }
    const family = node.styles.base['font-family']
      ? primaryFamily(node.styles.base['font-family'])
      : inheritedFamily;
    if (family) {
      if (/^h[1-3]$/.test(node.tag)) bump(headingFamilies, family);
      else if (node.text) bump(textFamilies, family);
    }
    node.children.forEach((c) => walk(c, family));
  };
  roots.forEach((r) => walk(r, undefined));

  const most = (m: Map<string, number>, exclude: Set<string>) =>
    [...m].filter(([f]) => !exclude.has(f)).sort((a, b) => b[1] - a[1])[0]?.[0];
  const assign = (family: string, role: string) => {
    if (tokens.fontByFamily.has(family) || tokens.fonts[role]) return;
    tokens.fonts[role] = GENERIC_FAMILIES.has(family) ? family : `"${family}"`;
    tokens.fontByFamily.set(family, role);
  };
  for (const fam of families) {
    const role = fontRole(fam);
    if (role) assign(fam, role);
  }
  const display = most(headingFamilies, new Set(tokens.fontByFamily.keys()));
  if (display) assign(display, 'display');
  const body = most(textFamilies, new Set(tokens.fontByFamily.keys()));
  if (body) assign(body, 'body');
  for (const fam of families) if (!tokens.fontByFamily.has(fam)) assign(fam, kebab(fam));

  const ranked = (m: Map<string, number>) =>
    [...m].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]);
  ranked(radiusCount).forEach(([value], i) => {
    tokens.radii[`radius-${i + 1}`] = value;
    tokens.radiusByValue.set(value, `radius-${i + 1}`);
  });
  ranked(shadowCount).forEach(([value], i) => {
    tokens.shadows[`shadow-${i + 1}`] = value;
    tokens.shadowByValue.set(value, `shadow-${i + 1}`);
  });
  return tokens;
}
