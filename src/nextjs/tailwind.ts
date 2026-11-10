import type { AfterBorder, Breakpoint, Node, Style } from './model.js';
import { normalizeColor, type ThemeTokens } from './tokens.js';

export interface TailwindResult {
  classes: string[];
  leftover: Partial<Record<Breakpoint | 'hover' | 'after', Style>>;
}

const PREFIX: Record<Breakpoint | 'hover', string> = {
  base: '',
  tablet: 'tablet:',
  mobile: 'mobile:',
  hover: 'hover:',
};

const FONT_SIZES: Record<number, string> = {
  12: 'xs', 14: 'sm', 16: 'base', 18: 'lg', 20: 'xl', 24: '2xl', 30: '3xl',
  36: '4xl', 48: '5xl', 60: '6xl', 72: '7xl', 96: '8xl', 128: '9xl',
};
const FONT_WEIGHTS: Record<string, string> = {
  '100': 'thin', '200': 'extralight', '300': 'light', '400': 'normal', '500': 'medium',
  '600': 'semibold', '700': 'bold', '800': 'extrabold', '900': 'black',
};
const JUSTIFY: Record<string, string> = {
  'flex-start': 'start', start: 'start', center: 'center', 'flex-end': 'end', end: 'end',
  'space-between': 'between', 'space-around': 'around', 'space-evenly': 'evenly', stretch: 'stretch',
};
const ALIGN: Record<string, string> = {
  'flex-start': 'start', start: 'start', center: 'center', 'flex-end': 'end', end: 'end',
  stretch: 'stretch', baseline: 'baseline',
};
const DISPLAY: Record<string, string> = {
  flex: 'flex', 'inline-flex': 'inline-flex', grid: 'grid', 'inline-grid': 'inline-grid',
  block: 'block', 'inline-block': 'inline-block', inline: 'inline', none: 'hidden', contents: 'contents',
};

/** Properties that never become utilities in v1 (spec 6.2) → CSS module. */
const LEFTOVER = new Set([
  'background-image', 'transform', 'filter', 'backdrop-filter', 'mix-blend-mode', 'clip-path',
  'mask-image', 'mask-size', 'mask-position', 'mask-repeat', 'mask-mode', 'object-position',
]);

const SKIP_VALUES = new Set(['normal', 'none', 'auto']);

const num = (v: string): number | undefined => {
  const m = v.trim().match(/^(-?[\d.]+)px$/);
  return m ? Number(m[1]) : undefined;
};

const arb = (v: string) => `[${v.trim().replace(/\s+/g, '_')}]`;

/** Spacing value → `6`, `0`, `[22px]`, `[50%]`, `-4`. */
function spacing(v: string): { neg: boolean; val: string } | undefined {
  if (v === 'initial') return { neg: false, val: '0' };
  const n = num(v);
  if (n === undefined) {
    if (v === '100%') return { neg: false, val: 'full' };
    // %, vh, calc(), min()… stay as arbitrary values; only keywords are not lengths.
    return /^[a-z-]+$/.test(v) ? undefined : { neg: false, val: arb(v) };
  }
  const abs = Math.abs(n);
  const val = abs === 0 ? '0' : abs % 4 === 0 && abs / 4 <= 96 ? String(abs / 4) : arb(`${abs}px`);
  return { neg: n < 0, val };
}

function spaceClass(prefix: string, v: string): string | undefined {
  if (v === 'auto') return `${prefix}-auto`;
  const s = spacing(v);
  return s ? `${s.neg ? '-' : ''}${prefix}-${s.val}` : undefined;
}

function sizeClass(prefix: string, v: string): string | undefined {
  if (v === 'initial' || v === 'auto') {
    if (prefix.startsWith('min')) return `${prefix}-0`;
    if (prefix.startsWith('max')) return `${prefix}-none`;
    return `${prefix}-auto`;
  }
  if (v === '100%') return `${prefix}-full`;
  if (v === 'fit-content') return `${prefix}-fit`;
  if (v === 'min-content') return `${prefix}-min`;
  if (v === 'max-content') return `${prefix}-max`;
  if (v === '100vw' && prefix.endsWith('w')) return `${prefix}-screen`;
  if (v === '100vh' && prefix.endsWith('h')) return `${prefix}-screen`;
  const n = num(v);
  if (n !== undefined) {
    if (n === 0) return `${prefix}-0`;
    if (n > 0 && n % 4 === 0 && n / 4 <= 96) return `${prefix}-${n / 4}`;
    return `${prefix}-${arb(v)}`;
  }
  if (/^[\d.]+(%|vw|vh|svh|dvh|lvh|rem|em)$/.test(v) || /^(calc|min|max|clamp)\(/.test(v)) return `${prefix}-${arb(v)}`;
  return undefined;
}

function colorClass(prefix: string, v: string, tokens: ThemeTokens): string | undefined | null {
  if (v === 'initial' || v === 'transparent') return `${prefix}-transparent`;
  const hex = normalizeColor(v);
  if (hex.length === 9 && hex.endsWith('00')) return `${prefix}-transparent`;
  const name = tokens.colorByValue.get(hex);
  return name ? `${prefix}-${name}` : null; // null → leftover (never emit raw hex)
}

function sides(style: Style, pattern: (side: string) => string): (string | undefined)[] {
  return ['top', 'right', 'bottom', 'left'].map((s) => style[pattern(s)]);
}

function boxShorthand(
  base: string,
  [t, r, b, l]: (string | undefined)[],
  make: (prefix: string, v: string) => string | undefined
): string[] {
  const out: string[] = [];
  if (t !== undefined && t === r && t === b && t === l) return [make(base, t)].filter(Boolean) as string[];
  if (l !== undefined && l === r) out.push(make(base + 'x', l)!);
  else {
    if (r !== undefined) out.push(make(base + 'r', r)!);
    if (l !== undefined) out.push(make(base + 'l', l)!);
  }
  if (t !== undefined && t === b) out.push(make(base + 'y', t)!);
  else {
    if (t !== undefined) out.push(make(base + 't', t)!);
    if (b !== undefined) out.push(make(base + 'b', b)!);
  }
  // keep x/y before single sides in a stable order: x, y, then t r b l
  const order = ['x', 'y', 't', 'r', 'b', 'l'];
  return out
    .filter(Boolean)
    .sort((a, b2) => order.indexOf(axisOf(a, base)) - order.indexOf(axisOf(b2, base)));
}

function axisOf(cls: string, base: string): string {
  const stripped = cls.replace(/^-/, '');
  return stripped.slice(base.length, base.length + 1);
}

function radiusClass(v: string, tokens: ThemeTokens): string {
  if (v === 'initial' || v === '0px') return 'none';
  const token = tokens.radiusByValue.get(v);
  if (token) return token.replace(/^radius-/, '');
  if (v === '50%' || (num(v) ?? 0) >= 9999) return 'full';
  return arb(v);
}

interface Ctx {
  tokens: ThemeTokens;
  classes: string[];
  leftover: Style;
}

function mapStyle(style: Style, ctx: Ctx): void {
  const { tokens, classes, leftover } = ctx;
  const push = (c: string | undefined) => {
    if (c) classes.push(c);
  };
  const done = new Set<string>();
  const take = (p: string) => {
    done.add(p);
    return style[p];
  };

  // Layout
  const display = take('display');
  if (display) push(display === 'initial' ? 'block' : DISPLAY[display] ?? undefined);
  const position = take('position');
  if (position && position !== 'static') push(position === 'initial' ? 'static' : position);
  for (const side of ['top', 'right', 'bottom', 'left']) {
    const v = take(side);
    if (v) push(spaceClass(side, v === 'initial' ? 'auto' : v));
  }
  const pe = take('pointer-events');
  if (pe === 'none' || pe === 'auto') push(`pointer-events-${pe}`);
  const z = take('z-index');
  if (z && z !== 'auto') push(['0', '10', '20', '30', '40', '50'].includes(z) ? `z-${z}` : `z-[${z}]`);
  const dir = take('flex-direction');
  if (dir && dir !== 'row') push({ column: 'flex-col', 'row-reverse': 'flex-row-reverse', 'column-reverse': 'flex-col-reverse', initial: 'flex-row' }[dir]);
  const wrap = take('flex-wrap');
  if (wrap === 'wrap') push('flex-wrap');
  if (wrap === 'initial') push('flex-nowrap');
  const grow = take('flex-grow');
  if (grow && grow !== '0') push(grow === '1' ? 'grow' : `grow-[${grow}]`);
  const shrink = take('flex-shrink');
  if (shrink === '0') push('shrink-0');
  const basis = take('flex-basis');
  if (basis && basis !== 'auto') push(sizeClass('basis', basis));
  const justify = take('justify-content');
  if (justify && JUSTIFY[justify]) push(`justify-${JUSTIFY[justify]}`);
  const items = take('align-items');
  if (items && ALIGN[items]) push(`items-${ALIGN[items]}`);
  const self = take('align-self');
  if (self && ALIGN[self]) push(`self-${ALIGN[self]}`);
  const rowGap = take('row-gap');
  const colGap = take('column-gap');
  const gap = take('gap');
  const rg = rowGap && rowGap !== 'normal' ? rowGap : undefined;
  const cg = colGap && colGap !== 'normal' ? colGap : undefined;
  if (rg || cg) {
    if (rg === cg) push(spaceClass('gap', rg!));
    else {
      if (cg) push(spaceClass('gap-x', cg));
      if (rg) push(spaceClass('gap-y', rg));
    }
  } else if (gap && gap !== 'normal') {
    const [a, b] = gap.split(/\s+/);
    if (!b || a === b) push(spaceClass('gap', a));
    else {
      push(spaceClass('gap-y', a));
      push(spaceClass('gap-x', b));
    }
  }
  for (const p of ['grid-template-columns', 'grid-template-rows']) {
    const v = take(p);
    if (v && v !== 'none') push(`${p.endsWith('columns') ? 'grid-cols' : 'grid-rows'}-${arb(v)}`);
  }

  // Box
  for (const [p, prefix] of [
    ['width', 'w'], ['height', 'h'], ['min-width', 'min-w'], ['max-width', 'max-w'],
    ['min-height', 'min-h'], ['max-height', 'max-h'],
  ] as const) {
    const v = take(p);
    if (v === undefined) continue;
    if ((p.startsWith('max') && v === 'none') || (p.startsWith('min') && (v === '0px' || v === 'auto'))) continue;
    const c = sizeClass(prefix, v);
    if (c) push(c);
    else leftover[p] = v;
  }
  for (const [kind, prefix] of [['padding', 'p'], ['margin', 'm']] as const) {
    const vals = sides(style, (s) => `${kind}-${s}`);
    ['top', 'right', 'bottom', 'left'].forEach((s) => done.add(`${kind}-${s}`));
    if (vals.every((v) => v === undefined)) continue;
    classes.push(...boxShorthand(prefix, vals, spaceClass));
  }

  // Typography
  const family = take('font-family');
  if (family) {
    const primary = family.split(',')[0].trim().replace(/^["']|["']$/g, '');
    const role = tokens.fontByFamily.get(primary);
    if (role) push(`font-${role}`);
    else leftover['font-family'] = family;
  }
  const size = take('font-size');
  if (size) {
    const n = num(size);
    if (n !== undefined && FONT_SIZES[n]) push(`text-${FONT_SIZES[n]}`);
    else if (size !== 'initial') push(`text-${arb(size)}`);
  }
  const weight = take('font-weight');
  if (weight && FONT_WEIGHTS[weight]) push(`font-${FONT_WEIGHTS[weight]}`);
  const fstyle = take('font-style');
  if (fstyle === 'italic') push('italic');
  if (fstyle === 'initial' || fstyle === 'normal') push('not-italic');
  const lh = take('line-height');
  if (lh) push(lh === 'normal' || lh === 'initial' ? 'leading-[normal]' : `leading-${arb(lh)}`);
  const ls = take('letter-spacing');
  if (ls && ls !== 'normal') push(ls === 'initial' ? 'tracking-normal' : `tracking-${arb(ls)}`);
  const align = take('text-align');
  if (align && ['center', 'right', 'left', 'justify', 'end'].includes(align)) push(`text-${align}`);
  if (align === 'start' || align === 'initial') push('text-start');
  const transform = take('text-transform');
  if (transform && transform !== 'none') push(transform === 'initial' ? 'normal-case' : transform);
  const deco = take('text-decoration-line');
  if (deco) push(deco === 'none' || deco === 'initial' ? 'no-underline' : deco === 'line-through' ? 'line-through' : deco === 'underline' ? 'underline' : undefined);
  const ws = take('white-space');
  if (ws && ws !== 'normal') push(ws === 'initial' ? 'whitespace-normal' : `whitespace-${ws}`);

  // Colour
  for (const [p, prefix] of [['color', 'text'], ['background-color', 'bg']] as const) {
    const v = take(p);
    if (v === undefined) continue;
    if (p === 'background-color' && normalizeColor(v) === '#00000000') continue;
    const c = colorClass(prefix, v, tokens);
    if (c) push(c);
    else if (c === null) leftover[p] = v;
  }

  // Border
  const widths = sides(style, (s) => `border-${s}-width`);
  const colors = sides(style, (s) => `border-${s}-color`);
  const styles = sides(style, (s) => `border-${s}-style`);
  for (const s of ['top', 'right', 'bottom', 'left']) {
    done.add(`border-${s}-width`);
    done.add(`border-${s}-color`);
    done.add(`border-${s}-style`);
  }
  const hasBorder = widths.some((w) => w !== undefined && w !== '0px');
  if (hasBorder || widths.some((w) => w === 'initial')) {
    const borderWidth = (prefix: string, v: string) => {
      if (v === 'initial' || v === '0px') return `${prefix}-0`;
      const n = num(v);
      if (n === 1) return prefix;
      if (n !== undefined && [2, 4, 8].includes(n)) return `${prefix}-${n}`;
      return `${prefix}-${arb(v)}`;
    };
    if (widths.every((w) => w === widths[0]) && widths[0] !== undefined) push(borderWidth('border', widths[0]));
    else {
      ['t', 'r', 'b', 'l'].forEach((s, i) => {
        if (widths[i] !== undefined) push(borderWidth(`border-${s}`, widths[i]!));
      });
    }
    const st = styles.find((x) => x && x !== 'solid' && x !== 'none');
    if (st && ['dashed', 'dotted', 'double'].includes(st)) push(`border-${st}`);
    const c = colors.find((x, i) => x && widths[i] && widths[i] !== '0px');
    if (c) {
      const cls = colorClass('border', c, tokens);
      if (cls) push(cls);
      else leftover['border-color'] = c;
    }
  }

  // Radius
  const radii = ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((c) => {
    done.add(`border-${c}-radius`);
    return style[`border-${c}-radius`];
  });
  if (radii.some((r) => r !== undefined)) {
    if (radii.every((r) => r === radii[0])) {
      const r = radiusClass(radii[0]!, tokens);
      push(r === '' ? 'rounded' : `rounded-${r}`);
    } else {
      ['tl', 'tr', 'br', 'bl'].forEach((c, i) => {
        if (radii[i] !== undefined) push(`rounded-${c}-${radiusClass(radii[i]!, tokens)}`);
      });
    }
  }

  // Effects
  const shadow = take('box-shadow');
  if (shadow && shadow !== 'none') {
    const token = tokens.shadowByValue.get(shadow);
    push(shadow === 'initial' ? 'shadow-none' : token ? token : `shadow-${arb(shadow)}`);
  }
  const opacity = take('opacity');
  if (opacity && opacity !== '1') {
    const o = opacity === 'initial' ? 100 : Math.round(Number(opacity) * 100);
    push(o % 5 === 0 ? `opacity-${o}` : `opacity-[${opacity}]`);
  }
  const ox = take('overflow-x');
  const oy = take('overflow-y');
  if (ox && ox === oy && ox !== 'visible') push(`overflow-${ox === 'initial' ? 'visible' : ox}`);
  else {
    if (ox && ox !== 'visible') push(`overflow-x-${ox === 'initial' ? 'visible' : ox}`);
    if (oy && oy !== 'visible') push(`overflow-y-${oy === 'initial' ? 'visible' : oy}`);
  }
  const fit = take('object-fit');
  if (fit && fit !== 'fill') push(`object-${fit === 'initial' ? 'fill' : fit}`);
  const aspect = take('aspect-ratio');
  if (aspect && !aspect.startsWith('auto')) push(`aspect-${arb(aspect.replace(/\s*\/\s*/, '/'))}`);

  for (const [p, v] of Object.entries(style)) {
    if (done.has(p)) continue;
    if (LEFTOVER.has(p)) {
      if (!SKIP_VALUES.has(v) && v !== 'initial' && (v !== '50% 50%' || p === 'mask-position')) leftover[p] = v;
      continue;
    }
    if (!SKIP_VALUES.has(v)) leftover[p] = v;
  }
}

function visibilityClasses(vis: Breakpoint[] | undefined, style: Node['styles']): string[] {
  if (!vis) return [];
  const shown = (bp: Breakpoint) => vis.includes(bp);
  const displayFor = (bp: Breakpoint) => {
    const d =
      (bp === 'mobile' ? style.mobile?.display : undefined) ??
      (bp !== 'base' ? style.tablet?.display : undefined) ??
      style.base.display;
    return d && DISPLAY[d] && d !== 'none' ? DISPLAY[d] : 'block';
  };
  const out: string[] = [];
  // The display classes are emitted here (and removed from the per-breakpoint styles), so every
  // breakpoint where the node is visible must state its display again.
  if (!shown('base')) out.push('hidden');
  else if (style.base.display && style.base.display !== 'none' && DISPLAY[style.base.display]) {
    out.push(DISPLAY[style.base.display]);
  }
  let visibleSoFar = shown('base');
  let current = shown('base') ? displayFor('base') : 'hidden';
  for (const bp of ['tablet', 'mobile'] as const) {
    if (shown(bp)) {
      const d = displayFor(bp);
      if (!visibleSoFar || d !== current) out.push(`${bp}:${d}`);
      current = d;
    } else if (visibleSoFar) {
      out.push(`${bp}:hidden`);
      current = 'hidden';
    }
    visibleSoFar = shown(bp);
  }
  return out;
}

/** Computed styles (+ hover, + breakpoint visibility) → Tailwind classes and leftover CSS. */
export function toTailwind(
  styles: Node['styles'],
  hover: Style | undefined,
  tokens: ThemeTokens,
  visibility?: Breakpoint[],
  afterBorder?: AfterBorder
): TailwindResult {
  const classes: string[] = [];
  const leftover: TailwindResult['leftover'] = {};
  if (afterBorder) {
    // Framer's ::after overlay border does not affect layout; an inset ring renders the same.
    const w = afterBorder.widths;
    const px = num(w[0]);
    const colorName = tokens.colorByValue.get(normalizeColor(afterBorder.color));
    if (w.every((x) => x === w[0]) && afterBorder.style === 'solid' && px !== undefined && colorName) {
      const width = px === 1 ? 'ring' : Number.isInteger(px) ? `ring-${px}` : `ring-[${px}px]`;
      classes.push(width, 'ring-inset', `ring-${colorName}`);
    } else {
      leftover.after = {
        'border-width': w.join(' '),
        'border-style': afterBorder.style,
        'border-color': afterBorder.color,
      };
    }
  }
  const vis = visibilityClasses(visibility, styles);
  const sources: [Breakpoint | 'hover', Style | undefined][] = [
    ['base', styles.base],
    ['tablet', styles.tablet],
    ['mobile', styles.mobile],
    ['hover', hover],
  ];
  for (const [bp, style] of sources) {
    if (!style) continue;
    const ctx: Ctx = { tokens, classes: [], leftover: {} };
    const s = { ...style };
    if (vis.length && 'display' in s) delete s.display;
    mapStyle(s, ctx);
    classes.push(...ctx.classes.map((c) => PREFIX[bp] + c));
    if (Object.keys(ctx.leftover).length) leftover[bp] = ctx.leftover;
  }
  return { classes: [...new Set([...vis, ...classes.filter((c) => !c.startsWith('ring')), ...classes.filter((c) => c.startsWith('ring'))])], leftover };
}
