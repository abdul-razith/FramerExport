import type { ComponentInfo } from '../../types.js';
import { skeletonSignature } from './routes.js';

export interface Node {
  tag: string;
  start: number; // offset of '<'
  end: number; // offset after closing tag (or after open tag for void/unclosed)
  classes: string[];
  name?: string;
  id?: string;
  attrs: Record<string, string>;
  parent?: Node;
  size: number; // element count in subtree, including self
  index: number; // 1-based position among sibling elements
  kids: number;
}

const VOID = new Set(
  'area base br col embed hr img input link meta param source track wbr'.split(' ')
);
const RAW = new Set(['script', 'style', 'textarea', 'title']);
const TAG_RE = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/gi;
const ATTR_RE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
const COMPONENT_CLASS = /^framer-[A-Za-z0-9]{5}$/;
const MAX_SLICE = 30 * 1024; // larger first instances are page sections, not components
const VARIANT_RE = /^(?:Desktop|Tablet|Mobile|Variant \d+)$/;

function decode(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Tolerant tag-soup tree builder: enough structure for subtree ranges and selector matching. */
export function parseNodes(html: string): Node[] {
  const nodes: Node[] = [];
  const stack: Node[] = [];
  let topLevel = 0;
  const close = (n: Node, end: number) => {
    n.end = end;
    if (n.parent) n.parent.size += n.size;
  };
  TAG_RE.lastIndex = 0;
  for (let m = TAG_RE.exec(html); m; m = TAG_RE.exec(html)) {
    if (!m[2]) continue;
    const tag = m[2].toLowerCase();
    if (m[1]) {
      let i = stack.length - 1;
      while (i >= 0 && stack[i]!.tag !== tag) i--;
      if (i < 0) continue;
      while (stack.length > i + 1) close(stack.pop()!, m.index);
      close(stack.pop()!, TAG_RE.lastIndex);
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of m[3]!.matchAll(ATTR_RE)) {
      attrs[a[1]!.toLowerCase()] = decode(a[2] ?? a[3] ?? a[4] ?? '');
    }
    const node: Node = {
      tag,
      start: m.index,
      end: TAG_RE.lastIndex,
      classes: (attrs.class ?? '').split(/\s+/).filter(Boolean),
      name: attrs['data-framer-name'],
      id: attrs.id,
      attrs,
      parent: stack[stack.length - 1],
      size: 1,
      index: 0,
      kids: 0
    };
    node.index = node.parent ? ++node.parent.kids : ++topLevel;
    nodes.push(node);
    if (RAW.has(tag)) {
      const closing = new RegExp(`</${tag}\\s*>`, 'gi');
      closing.lastIndex = TAG_RE.lastIndex;
      const e = closing.exec(html);
      node.end = e ? closing.lastIndex : html.length;
      if (node.parent) node.parent.size += 1;
      TAG_RE.lastIndex = node.end;
    } else if (VOID.has(tag) || /\/\s*$/.test(m[3]!)) {
      if (node.parent) node.parent.size += 1;
    } else {
      stack.push(node);
    }
  }
  while (stack.length) close(stack.pop()!, html.length);
  return nodes;
}

function componentClasses(html: string): Set<string> {
  const set = new Set<string>();
  for (const m of html.matchAll(/<style\b[^>]*\sdata-framer-components\s*=\s*"([^"]*)"/gi)) {
    for (const c of m[1]!.split(/\s+/)) if (COMPONENT_CLASS.test(c)) set.add(c);
  }
  return set;
}

function pascal(s: string): string {
  const out = s
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join('');
  return /^[A-Za-z]/.test(out) ? out : '';
}

function cssAttr(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function selectorFor(n: Node): string {
  const cls = n.classes.filter((c) => /^framer-/.test(c)).map((c) => '.' + c);
  const name = n.name !== undefined ? `[data-framer-name="${cssAttr(n.name)}"]` : '';
  return (cls.length || name ? '' : n.tag) + cls.join('') + name;
}

const VARIANT_WORDS = new Set('desktop tablet mobile variant default active inactive current hover pressed'.split(' '));
const GENERIC_WORDS = new Set([
  ...VARIANT_WORDS,
  ...'name number component frame content text image container wrapper stack'.split(' ')
]);

const wordsOf = (name: string) => name.toLowerCase().split(/[^a-z]+/).filter(Boolean);

/** PascalCase of a data-framer-name unless it is only a variant/state/generic label. */
function meaningfulName(n?: Node): string {
  if (n?.name === undefined) return '';
  const w = wordsOf(n.name);
  return w.length && !w.every((x) => GENERIC_WORDS.has(x)) ? pascal(n.name) : '';
}

function nameFor(root: Node, nodes: Node[]): string {
  for (let a: Node | undefined = root; a && a.id !== 'main'; a = a.parent) {
    const m = meaningfulName(a);
    if (m) return m;
  }
  for (const d of nodes) if (d.start > root.start && d.start < root.end && meaningfulName(d)) return meaningfulName(d);
  return '';
}

/** Selector for `n` that matches exactly one element of `nodes`: a compound, else an anchored child path. */
function uniqueSelector(n: Node, nodes: Node[]): string {
  const compound = selectorFor(n);
  if (nodes.filter((x) => matchesSelector(x, compound)).length === 1) return compound;
  const path: string[] = [];
  for (let a: Node | undefined = n; a; a = a.parent) {
    path.unshift((a === n ? compound : a.tag) + `:nth-child(${a.index})`);
  }
  return path.join(' > ');
}

interface Group {
  kind: 'class' | 'skeleton';
  instances: Array<{ page: number; node: Node }>;
}

export function findComponents(pages: Array<{ route: string; html: string }>): ComponentInfo[] {
  const parsed = pages.map((p) => {
    const nodes = parseNodes(p.html);
    return { ...p, nodes, comps: componentClasses(p.html) };
  });

  const groups: Group[] = [];
  const byClass = new Map<string, Group>();
  const claimed = new Set<Node>();

  parsed.forEach((pg, pi) => {
    const tooBig = (n: Node) => n.size > pg.nodes.length * 0.6;
    for (const n of pg.nodes) {
      if (n.id === 'main' || tooBig(n)) continue;
      const cls = n.classes.find((c) => pg.comps.has(c));
      if (!cls) continue;
      let g = byClass.get(cls);
      if (!g) groups.push((g = { kind: 'class', instances: [] })), byClass.set(cls, g);
      g.instances.push({ page: pi, node: n });
      claimed.add(n);
    }
  });

  const sigGroups = new Map<string, Group>();
  parsed.forEach((pg, pi) => {
    for (const n of pg.nodes) {
      if (n.name === undefined || n.id === 'main' || claimed.has(n) || n.size < 2) continue;
      if (n.size > pg.nodes.length * 0.6) continue;
      const sig = skeletonSignature(pg.html.slice(n.start, n.end));
      let g = sigGroups.get(sig);
      if (!g) sigGroups.set(sig, (g = { kind: 'skeleton', instances: [] }));
      g.instances.push({ page: pi, node: n });
    }
  });
  const repeating = [...sigGroups.values()].filter((g) => g.instances.length >= 2);
  // Anchors: every instance of a class group or repeating skeleton group. A skeleton group whose
  // instances all sit inside another anchor is a part of that component, not a component itself.
  const anchors = new Set<Node>([...groups, ...repeating].flatMap((g) => g.instances.map((i) => i.node)));
  const inside = (n: Node) => {
    for (let a = n.parent; a; a = a.parent) if (anchors.has(a)) return true;
    return false;
  };
  const seenSelectors = new Set(groups.map((g) => selectorFor(g.instances[0]!.node)));
  for (const g of repeating) {
    const sel = selectorFor(g.instances[0]!.node);
    if (g.instances.every((i) => inside(i.node)) || seenSelectors.has(sel)) continue;
    seenSelectors.add(sel);
    groups.push(g);
  }

  const used = new Set<string>();
  const out: ComponentInfo[] = [];
  let counter = 0;
  for (const g of groups) {
    const first = g.instances[0]!.node;
    if (first.end - first.start > MAX_SLICE) continue;
    const firstPage = parsed[g.instances[0]!.page]!;
    const selector = uniqueSelector(first, firstPage.nodes);
    if (buildSlice(firstPage.html, selector).length > MAX_SLICE) continue;
    counter++;
    const base = nameFor(first, firstPage.nodes) || `Component${counter}`;
    let name = base;
    for (let i = 2; used.has(name); i++) name = `${base}${i}`;
    used.add(name);

    const variants = new Set<string>();
    const note = (n?: Node) => {
      if (n?.name !== undefined && VARIANT_RE.test(n.name)) variants.add(n.name);
    };
    for (const { page, node } of g.instances) {
      if (node.name !== undefined && wordsOf(node.name).every((w) => VARIANT_WORDS.has(w))) variants.add(node.name);
      for (let a: Node | undefined = node; a; a = a.parent) note(a);
      for (const d of parsed[page]!.nodes) if (d.start > node.start && d.start < node.end) note(d);
    }

    out.push({
      name,
      selector,
      pages: [...new Set(g.instances.map((i) => pages[i.page]!.route))],
      variants: [...variants],
      slice: `.convert/analysis/slices/${name}.html`
    });
  }
  return out;
}

/** Match a single compound selector (tag, #id, .class, [attr], [attr="v"]) against a node. */
function matchesCompound(n: Node, sel: string): boolean {
  const re = /^([a-z][\w-]*)|#((?:\\.|[\w-])+)|\.((?:\\.|[\w-])+)|\[([\w-]+)(?:=(?:"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)'|([^\]]*)))?\]/gi;
  let pos = 0;
  for (let m = re.exec(sel); m; m = re.exec(sel)) {
    if (m.index !== pos) return false;
    pos = re.lastIndex;
    if (m[1] !== undefined) {
      if (m[1].toLowerCase() !== n.tag) return false;
    } else if (m[2] !== undefined) {
      if (n.id !== m[2].replace(/\\(.)/g, '$1')) return false;
    } else if (m[3] !== undefined) {
      if (!n.classes.includes(m[3].replace(/\\(.)/g, '$1'))) return false;
    } else {
      const v = n.attrs[m[4]!.toLowerCase()];
      if (v === undefined) return false;
      const want = m[5] ?? m[6] ?? m[7];
      if (want !== undefined && v !== want.replace(/\\(.)/g, '$1')) return false;
    }
  }
  return pos === sel.length && sel.length > 0;
}

/** Compound selectors, optionally `:nth-child(k)`, joined by ` > `; a multi-segment path is anchored at the top level. */
function matchesSelector(n: Node, selector: string): boolean {
  const segs = selector.trim().split(/\s>\s(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  let cur: Node | undefined = n;
  for (let i = segs.length - 1; i >= 0; i--) {
    if (!cur) return false;
    const m = /^(.*?)(?::nth-child\((\d+)\))?$/.exec(segs[i]!)!;
    if (m[2] !== undefined && cur.index !== Number(m[2])) return false;
    if (m[1] !== '' && !matchesCompound(cur, m[1]!)) return false;
    cur = cur.parent;
  }
  return segs.length === 1 || cur === undefined;
}

interface CssRule {
  prelude: string;
  body: string;
}

function splitCss(css: string): CssRule[] {
  const rules: CssRule[] = [];
  let i = 0;
  while (i < css.length) {
    let j = i;
    let quote = '';
    while (j < css.length && (quote || (css[j] !== '{' && css[j] !== ';'))) {
      if (quote) {
        if (css[j] === '\\') j++;
        else if (css[j] === quote) quote = '';
      } else if (css[j] === '"' || css[j] === "'") quote = css[j]!;
      j++;
    }
    if (j >= css.length || css[j] === ';') {
      i = j + 1;
      continue;
    }
    let depth = 1;
    let k = j + 1;
    quote = '';
    while (k < css.length && depth > 0) {
      const c = css[k]!;
      if (quote) {
        if (c === '\\') k++;
        else if (c === quote) quote = '';
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      k++;
    }
    rules.push({ prelude: css.slice(i, j).trim(), body: css.slice(j + 1, depth ? k : k - 1) });
    i = k;
  }
  return rules;
}

// Framer's shared typography/image resets apply to every page; they are not part of a component's own CSS.
export const GLOBAL_CLASS = /^framer-(?:text|image|link-text|lib-.*)$/;

function ruleMatches(prelude: string, classes: Set<string>): boolean {
  return prelude.split(',').some((sel) => {
    const used = [...sel.matchAll(/\.((?:\\.|[\w-])+)/g)].map((m) => m[1]!.replace(/\\(.)/g, '$1'));
    return used.some((c) => !GLOBAL_CLASS.test(c)) && used.every((c) => classes.has(c));
  });
}

function filterCss(css: string, classes: Set<string>): string {
  const kept: string[] = [];
  for (const r of splitCss(css)) {
    if (r.prelude.startsWith('@')) {
      if (/^@(?:media|supports|container|layer)\b/i.test(r.prelude)) {
        const inner = filterCss(r.body, classes);
        if (inner) kept.push(`${r.prelude}{${inner}}`);
      }
    } else if (ruleMatches(r.prelude, classes)) {
      kept.push(`${r.prelude}{${r.body}}`);
    }
  }
  return kept.join('\n');
}

/** Outer HTML of the first element matching `selector` plus a <style> with only the CSS rules that target it. */
export function buildSlice(html: string, selector: string): string {
  const nodes = parseNodes(html);
  const sel = selector.trim();
  const target = nodes.find((n) => matchesSelector(n, sel));
  if (!target) return '';
  const fragment = html.slice(target.start, target.end);
  const classes = new Set<string>();
  for (const n of nodes) if (n.start >= target.start && n.start < target.end) n.classes.forEach((c) => classes.add(c));
  const css: string[] = [];
  for (const n of nodes) {
    if (n.tag !== 'style') continue;
    const body = html.slice(n.start, n.end).replace(/^<style\b[^>]*>/i, '').replace(/<\/style\s*>$/i, '');
    const kept = filterCss(body, classes);
    if (kept) css.push(kept);
  }
  return `${fragment}\n<style>\n${css.join('\n')}\n</style>\n`;
}

/** Number of elements in `html` matched by `selector` (same selector dialect as buildSlice). */
export function countMatches(html: string, selector: string): number {
  return parseNodes(html).filter((n) => matchesSelector(n, selector.trim())).length;
}
