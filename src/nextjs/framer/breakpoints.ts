import type { CapturedPage } from '../capture.js';
import type { ConversionReport } from '../report.js';
import {
  BREAKPOINTS,
  type AnimationSpec,
  type Asset,
  type Breakpoint,
  type Node,
  type RawNode,
  type Style,
} from '../model.js';

type Variants = Partial<Record<Breakpoint, RawNode>>;

/** Wrapper elements whose only job is Framer's per-breakpoint `hidden-*` toggling. */
const HIDDEN_CLASS = /\bhidden-[a-z0-9]+\b/;
const WRAPPER_NEUTRAL_PROPS = new Set(['display']);

function prune(node: RawNode): RawNode | null {
  if (!node.visible) return null;
  return { ...node, children: node.children.map(prune).filter((c): c is RawNode => c !== null) };
}

function sameElement(a: RawNode, b: RawNode): boolean {
  if (a.tag !== b.tag) return false;
  if (a.framerName || b.framerName) return a.framerName === b.framerName;
  return (a.text ?? '') === (b.text ?? '');
}

/** LCS alignment of two sibling lists; unmatched items keep their relative order. */
function align<A, B>(a: A[], b: B[], match: (x: A, y: B) => boolean): [A | undefined, B | undefined][] {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = match(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: [A | undefined, B | undefined][] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && match(a[i], b[j])) {
      out.push([a[i++], b[j++]]);
    } else if (j >= b.length || (i < a.length && dp[i + 1][j] >= dp[i][j + 1])) {
      out.push([a[i++], undefined]);
    } else {
      out.push([undefined, b[j++]]);
    }
  }
  return out;
}

function representative(v: Variants): RawNode {
  return (v.base ?? v.tablet ?? v.mobile)!;
}

function alignChildren(v: Variants): Variants[] {
  const baseTablet = align(v.base?.children ?? [], v.tablet?.children ?? [], sameElement).map(
    ([base, tablet]): Variants => ({ base, tablet })
  );
  return align(baseTablet, v.mobile?.children ?? [], (entry, m) => sameElement(representative(entry), m)).map(
    ([entry, mobile]) => ({ ...(entry ?? {}), mobile })
  );
}

function diff(prev: Style, cur: Style): Style | undefined {
  const out: Style = {};
  for (const [k, value] of Object.entries(cur)) if (prev[k] !== value) out[k] = value;
  for (const k of Object.keys(prev)) if (!(k in cur)) out[k] = 'initial';
  return Object.keys(out).length ? out : undefined;
}

function assetOf(node: RawNode): Asset | undefined {
  const num = (v: string | undefined, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : Math.round(fallback);
  };
  if (node.tag === 'img') {
    return {
      kind: 'image',
      src: node.attrs.src ?? '',
      width: num(node.attrs['data-natural-width'], node.box.w),
      height: num(node.attrs['data-natural-height'], node.box.h),
    };
  }
  if (node.tag === 'video') {
    return { kind: 'video', src: node.attrs.src ?? '', width: Math.round(node.box.w), height: Math.round(node.box.h) };
  }
  if (node.tag === 'svg') {
    return { kind: 'svg', src: '', width: Math.round(node.box.w), height: Math.round(node.box.h) };
  }
  return undefined;
}

interface MergeCtx {
  route: string;
  starts: Map<string, AnimationSpec>;
  hover: Map<string, Style>;
  report: ConversionReport;
}

function mergeVariants(v: Variants, ctx: MergeCtx): Node {
  const present = BREAKPOINTS.filter((bp) => v[bp]);
  const rep = representative(v);
  const styles: Node['styles'] = { base: { ...v[present[0]]!.styles } };
  let effective = styles.base;
  for (const bp of present.slice(1)) {
    const d = diff(effective, v[bp]!.styles);
    if (d) styles[bp as 'tablet' | 'mobile'] = d;
    effective = v[bp]!.styles;
  }
  const node: Node = {
    id: `${ctx.route}|${rep.key}`,
    key: rep.key,
    tag: rep.tag,
    attrs: { ...rep.attrs },
    styles,
    children: alignChildren(v).map((child) => mergeVariants(child, ctx)),
  };
  if (rep.framerName) node.framerName = rep.framerName;
  if (rep.text) node.text = rep.text;
  if (present.length < BREAKPOINTS.length) {
    node.visibility = present;
    ctx.report.keptDuplicates.push({ route: ctx.route, key: rep.key });
  }
  const animation = ctx.starts.get(rep.key);
  if (animation) node.animation = animation;
  const hover = ctx.hover.get(rep.key);
  if (hover) node.hover = hover;
  const asset = assetOf(rep);
  if (asset) node.asset = asset;
  if (rep.scrollSamples?.length) {
    const scroll = (['transform', 'opacity'] as const)
      .map((property) => ({ property, values: rep.scrollSamples!.map((s) => s[property] ?? '') }))
      .filter((s) => s.values.some((v) => v !== s.values[0]));
    if (scroll.length) node.motion = { kind: 'scroll', scroll };
  }
  return collapseWrapper(node);
}

function collapseWrapper(node: Node): Node {
  if (!HIDDEN_CLASS.test(node.attrs.class ?? '') || node.children.length !== 1 || node.text) return node;
  const ownProps = [node.styles.base, node.styles.tablet, node.styles.mobile]
    .filter(Boolean)
    .flatMap((s) => Object.keys(s!));
  if (!ownProps.every((p) => WRAPPER_NEUTRAL_PROPS.has(p))) return node;
  const child = node.children[0];
  if (node.visibility) {
    const childVis = child.visibility ?? [...BREAKPOINTS];
    child.visibility = childVis.filter((bp) => node.visibility!.includes(bp));
  }
  return child;
}

/** Merges the three captured trees of a page into one tree with per-breakpoint overrides. */
export function mergeBreakpoints(
  page: CapturedPage,
  starts: Map<string, AnimationSpec>,
  report: ConversionReport
): Node {
  const hover = new Map<string, Style>();
  for (const h of page.hover) hover.set(h.key, { ...(hover.get(h.key) ?? {}), ...h.style });
  const variants: Variants = {};
  for (const bp of BREAKPOINTS) {
    const pruned = prune(page.trees[bp]);
    if (pruned) variants[bp] = pruned;
  }
  return mergeVariants(variants, { route: page.route, starts, hover, report });
}
