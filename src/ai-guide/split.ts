import { looseHash, pageStructure } from '../nextjs/components.js';
import { BREAKPOINTS, type Box, type Breakpoint, type Node } from '../nextjs/model.js';

/** A page section, or a shell part (header, loader, page background…), for the guide. */
export interface SplitPart {
  node: Node;
  name: string;
  /** Set when a tall section was split: the section's own name. */
  parent?: string;
}

const VIEWPORT = { w: 1440, h: 900 };
/** Sections taller than this (two viewports) are split when they hold similar panels. */
const TALL = 1800;
const PANEL_MIN = 300;

type Boxes = (n: Node) => Partial<Record<Breakpoint, Box>>;

const nameOf = (n: Node) => n.framerName?.trim() || 'Section';

function isEmpty(n: Node, boxes: Boxes): boolean {
  if (n.visibility && !n.visibility.length) return true;
  const all = Object.values(boxes(n));
  return !all.length || all.every((b) => !b || b.w < 1 || b.h < 1);
}

function hasContent(n: Node): boolean {
  return !!(n.text?.trim() || n.asset || n.inline) || n.children.some(hasContent);
}

const positions = (n: Node) => BREAKPOINTS.map((bp) => n.styles[bp]?.position).filter(Boolean);

/** Fixed at any width, or an absolute layer the size of the viewport (loader, menu, cursor…). */
function isOverlay(n: Node, boxes: Boxes): boolean {
  if (positions(n).includes('fixed')) return true;
  const b = boxes(n).base;
  return n.styles.base.position === 'absolute' && !!b && b.w >= VIEWPORT.w * 0.95 && Math.abs(b.h - VIEWPORT.h) <= VIEWPORT.h * 0.05;
}

const height = (n: Node, boxes: Boxes) => boxes(n).base?.h ?? 0;

/** The shallowest node (≤ 3 levels down) holding 2+ similar children at least PANEL_MIN tall, with the path to it. */
function panelHolder(section: Node, boxes: Boxes): Node[] | undefined {
  const queue: Node[][] = [[section]];
  while (queue.length) {
    const path = queue.shift()!;
    const node = path[path.length - 1];
    const big = node.children.filter((c) => height(c, boxes) >= PANEL_MIN);
    const sig = (c: Node) => `${c.tag}|${c.framerName ?? ''}`;
    if (big.length >= 2 && big.some((c, i) => big.findIndex((d) => sig(d) === sig(c) || looseHash(d) === looseHash(c)) !== i)) return path;
    if (path.length <= 3) for (const c of node.children) queue.push([...path, c]);
  }
  return undefined;
}

/**
 * The node (through single-child wrappers, ≤ 3 levels down) whose 2+ parts are full width and
 * stacked one under another, each at least 150px tall: Framer's "All Content" wrapper.
 */
function stackHolder(section: Node, boxes: Boxes): Node[] | undefined {
  const path = [section];
  for (let depth = 0; depth <= 3; depth++) {
    const node = path[path.length - 1];
    const width = boxes(node).base?.w ?? 0;
    const kids = node.children.filter((c) => !isEmpty(c, boxes) && !/^(absolute|fixed)$/.test(c.styles.base.position ?? ''));
    if (kids.length === 1) {
      path.push(kids[0]);
      continue;
    }
    if (kids.length < 2) return undefined;
    const bs = kids.map((c) => boxes(c).base);
    const stacked = bs.every((b, i) => !!b && b.w >= width * 0.9 && b.h >= 150 && (i === 0 || b.y >= bs[i - 1]!.y + bs[i - 1]!.h - 2));
    return stacked ? path : undefined;
  }
  return undefined;
}

/** A tall section becomes its parts, in order: similar panels, or the stacked parts of a wrapper. */
function explode(section: Node, boxes: Boxes): SplitPart[] | undefined {
  if (height(section, boxes) <= TALL) return undefined;
  const path = panelHolder(section, boxes) ?? stackHolder(section, boxes);
  if (!path || path.length < 1) return undefined;
  const onPath = new Set(path);
  const holder = path[path.length - 1];
  const expand = (n: Node): Node[] =>
    n === holder ? n.children.filter((c) => !isEmpty(c, boxes)) : onPath.has(n) ? n.children.filter((c) => !isEmpty(c, boxes)).flatMap(expand) : [n];
  const nodes = expand(section);
  const parent = nameOf(section);
  const counts = new Map<string, number>();
  for (const n of nodes) counts.set(nameOf(n), (counts.get(nameOf(n)) ?? 0) + 1);
  const seen = new Map<string, number>();
  return nodes.map((n) => {
    const base = nameOf(n);
    const i = (seen.get(base) ?? 0) + 1;
    seen.set(base, i);
    return { node: n, name: `${parent} — ${base}${counts.get(base)! > 1 ? ` ${i}` : ''}`, parent };
  });
}

/**
 * The page's real sections and its shell parts. Full-page wrappers are opened, 0×0 layers skipped,
 * overlays, full-page decorations and parts shared with other pages go to the shell, and very tall
 * sections made of similar panels are split into those panels.
 */
export function splitPage(root: Node, boxes: Boxes, sharedHashes: Set<string>, pageHeight: number): { sections: SplitPart[]; shell: SplitPart[] } {
  const sections: SplitPart[] = [];
  const shell: SplitPart[] = [];
  const visit = (list: Node[]) => {
    for (const n of list) {
      if (isEmpty(n, boxes)) continue;
      if (isOverlay(n, boxes) || sharedHashes.has(looseHash(n))) {
        shell.push({ node: n, name: nameOf(n) });
        continue;
      }
      if (height(n, boxes) >= pageHeight * 0.9) {
        const inFlow = !/^(absolute|fixed)$/.test(n.styles.base.position ?? '');
        const kids = n.children.filter((c) => !isEmpty(c, boxes));
        if (inFlow && hasContent(n) && kids.length) {
          visit(kids);
          continue;
        }
        if (!inFlow || !hasContent(n)) {
          shell.push({ node: n, name: nameOf(n) }); // page background, grid or decoration layer
          continue;
        }
      }
      const parts = explode(n, boxes);
      if (parts) sections.push(...parts);
      else sections.push({ node: n, name: nameOf(n) });
    }
  };
  const ps = pageStructure(root);
  visit(ps.sections.length ? ps.sections : [ps.content]);
  for (const o of ps.overlays) if (!shell.some((s) => s.node === o) && !isEmpty(o, boxes)) shell.push({ node: o, name: nameOf(o) });
  return { sections, shell };
}
