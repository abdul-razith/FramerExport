import { parseNodes, type Node } from './components.js';
import { NON_VISUAL, stablePathFromMain } from './selectors.js';

export interface PageSection {
  name: string;
  /** Unique hydration-stable `:nth-child(k of :not(script, style, ...))` path from `#main`. */
  selector: string;
}

/**
 * Sections of a Framer page: descend from `#main` through single-rendered-child chains, then take the
 * rendered children, expanding unnamed wrappers that hold >=2 children of which one is named.
 */
export function pageSections(html: string): PageSection[] {
  const nodes = parseNodes(html);
  const main = nodes.find((n) => n.id === 'main');
  if (!main) return [];
  const kids = new Map<Node, Node[]>();
  for (const n of nodes) {
    if (!n.parent || NON_VISUAL.has(n.tag)) continue;
    const list = kids.get(n.parent);
    if (list) list.push(n);
    else kids.set(n.parent, [n]);
  }
  const children = (n: Node): Node[] => kids.get(n) ?? [];

  let current = main;
  while (children(current).length === 1) current = children(current)[0]!;

  const expand = (list: Node[]): Node[] =>
    list.flatMap((c) => {
      const sub = children(c);
      return !c.name && sub.length >= 2 && sub.some((s) => s.name) ? expand(sub) : [c];
    });

  const used = new Map<string, number>();
  return expand(children(current)).map((n, i) => {
    const base = n.name?.trim() || `section-${i + 1}`;
    const seen = (used.get(base) ?? 0) + 1;
    used.set(base, seen);
    return { name: seen === 1 ? base : `${base}-${seen}`, selector: stablePathFromMain(n, main) };
  });
}
