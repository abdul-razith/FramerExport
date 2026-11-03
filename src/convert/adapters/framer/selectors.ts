/**
 * Hydration-stable `:nth-child()` steps. Framer hydration removes non-visual children (style, script, ...)
 * of `#main` and of the page root, so plain sibling indices computed on the static export shift. Counting
 * only the visual siblings (`:nth-child(k of :not(...))`) gives the same index before and after hydration.
 */

export const NON_VISUAL_TAGS = ['script', 'style', 'link', 'meta', 'template', 'noscript'] as const;
export const NON_VISUAL: ReadonlySet<string> = new Set(NON_VISUAL_TAGS);
/** The `of S` filter used by every generated `:nth-child()` step. */
export const STABLE_OF = `:not(${NON_VISUAL_TAGS.join(', ')})`;

export interface IndexedNode {
  tag: string;
  /** 1-based position among all sibling elements. */
  index: number;
  /** 1-based position among sibling elements that are not NON_VISUAL; 0 for a non-visual node. */
  visualIndex: number;
}

/** `tag:nth-child(k of :not(script, style, ...))`; a non-visual node keeps its plain index (the of-form never matches it). */
export function stableNthChild(node: IndexedNode, prefix = node.tag): string {
  return node.visualIndex > 0 ? `${prefix}:nth-child(${node.visualIndex} of ${STABLE_OF})` : `${prefix}:nth-child(${node.index})`;
}

/** `#main > step > step ...` from just below `main` down to `node`. */
export function stablePathFromMain<T extends IndexedNode & { parent?: T }>(node: T, main: T): string {
  const parts: string[] = [];
  for (let c: T | undefined = node; c && c !== main; c = c.parent) parts.unshift(stableNthChild(c));
  return ['#main', ...parts].join(' > ');
}
