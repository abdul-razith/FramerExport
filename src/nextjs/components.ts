import crypto from 'node:crypto';
import type { Node, PageModel, Style } from './model.js';
import type { ConversionReport } from './report.js';
import { componentName, isGenericName, NameRegistry, toCamel, toPascal } from './framer/names.js';

export interface PropDef {
  name: string;
  kind: 'text' | 'image' | 'href';
  /** Child-index path from the component template root to the leaf. */
  path: number[];
}

export interface UiComponent {
  name: string;
  template: Node;
  props: PropDef[];
  instances: { node: Node; values: Record<string, unknown> }[];
}

export interface Section {
  name: string;
  node: Node;
}

export interface ComponentPlan {
  layout: { header?: Section; footer?: Section };
  pages: { route: string; sections: Section[] }[];
  ui: UiComponent[];
}

const sha = (s: string) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

const styleSig = (s: Style | undefined) =>
  s ? Object.entries(s).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}:${v}`).join(';') : '';

const hashCache = new WeakMap<Node, string>();

/** Structure + styles; ignores text, image sources, alt text and link targets. */
export function structuralHash(node: Node): string {
  const cached = hashCache.get(node);
  if (cached) return cached;
  const sig = [
    node.tag,
    node.framerName ?? '',
    node.asset?.kind ?? '',
    (node.visibility ?? []).join(','),
    styleSig(node.styles.base),
    styleSig(node.styles.tablet),
    styleSig(node.styles.mobile),
    styleSig(node.hover),
    node.children.map(structuralHash).join(','),
  ].join('|');
  const h = sha(sig);
  hashCache.set(node, h);
  return h;
}

/** Tags and layer names only, used to recognise shared header/footer across pages. */
function shapeHash(node: Node): string {
  return sha(`${node.tag}[${node.framerName ?? ''}](${node.children.map(shapeHash).join(',')})`);
}

function size(node: Node): number {
  return 1 + node.children.reduce((s, c) => s + size(c), 0);
}

/** The node whose children are the page sections: descend through single-child wrappers. */
export function contentRoot(root: Node): Node {
  let node = root;
  while (node.children.length === 1) node = node.children[0];
  return node;
}

function looksLike(node: Node, kind: 'header' | 'footer'): boolean {
  return node.tag === kind || new RegExp(kind === 'header' ? 'header|nav|menu' : 'footer', 'i').test(node.framerName ?? '');
}

function detectLayout(sectionsByPage: Node[][], which: 'first' | 'last'): Node[] | undefined {
  const pick = (s: Node[]) => (which === 'first' ? s[0] : s[s.length - 1]);
  const candidates = sectionsByPage.map(pick).filter((n): n is Node => !!n);
  if (!candidates.length) return undefined;
  const counts = new Map<string, Node[]>();
  for (const c of candidates) counts.set(shapeHash(c), [...(counts.get(shapeHash(c)) ?? []), c]);
  const [, best] = [...counts].sort((a, b) => b[1].length - a[1].length)[0];
  const shared = best.length >= 2 && best.length >= sectionsByPage.length / 2;
  const single = sectionsByPage.length === 1 && looksLike(best[0], which === 'first' ? 'header' : 'footer');
  return shared || single ? best : undefined;
}

interface Leaf {
  node: Node;
  path: number[];
}

function leaves(node: Node, path: number[] = []): Leaf[] {
  if (!node.children.length) return [{ node, path }];
  const own = node.text || node.attrs.href ? [{ node, path }] : [];
  return [...own, ...node.children.flatMap((c, i) => leaves(c, [...path, i]))];
}

const at = (root: Node, path: number[]) => path.reduce((n, i) => n.children[i], root);

function textPropName(node: Node): string {
  if (node.framerName && !isGenericName(node.framerName)) return toCamel(node.framerName);
  if (/^h[1-6]$/.test(node.tag)) return 'title';
  if (node.tag === 'p') return 'body';
  if (node.tag === 'a' || node.tag === 'button') return 'label';
  return 'text';
}

function imageValue(node: Node) {
  return {
    src: node.asset!.src,
    alt: node.attrs.alt ?? '',
    width: node.asset!.width,
    height: node.asset!.height,
  };
}

function buildProps(instances: Node[]): { props: PropDef[]; values: Record<string, unknown>[] } {
  const template = instances[0];
  const candidates: { kind: PropDef['kind']; base: string; path: number[]; get(n: Node): unknown }[] = [];
  for (const { node, path } of leaves(template)) {
    if (node.asset?.kind === 'image') {
      const name = node.framerName && !isGenericName(node.framerName) ? toCamel(node.framerName) : 'image';
      candidates.push({ kind: 'image', base: name, path, get: imageValue });
    }
    if (node.text) candidates.push({ kind: 'text', base: textPropName(node), path, get: (n) => n.text });
    if (node.attrs.href) candidates.push({ kind: 'href', base: 'href', path, get: (n) => n.attrs.href });
  }
  const differs = candidates.filter((c) => {
    const first = JSON.stringify(c.get(at(instances[0], c.path)));
    return instances.some((inst) => JSON.stringify(c.get(at(inst, c.path))) !== first);
  });
  const order: PropDef['kind'][] = ['text', 'image', 'href'];
  differs.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  const used = new NameRegistry();
  const props = differs.map((c) => ({ name: used.unique(c.base), kind: c.kind, path: c.path }));
  const values = instances.map((inst) =>
    Object.fromEntries(props.map((p, i) => [p.name, differs[i].get(at(inst, p.path))]))
  );
  return { props, values };
}

/** Sections per page, shared header/footer and repeated UI components with their props. */
export function planComponents(pages: PageModel[], report: ConversionReport): ComponentPlan {
  const registry = new NameRegistry();
  const sectionsByPage = pages.map((p) => contentRoot(p.root).children);
  const headers = detectLayout(sectionsByPage, 'first');
  const footers = detectLayout(sectionsByPage, 'last');
  const layoutNodes = new Set([...(headers ?? []), ...(footers ?? [])]);
  const plan: ComponentPlan = { layout: {}, pages: [], ui: [] };
  if (headers) plan.layout.header = { name: registry.unique('Header'), node: headers[0] };
  if (footers) plan.layout.footer = { name: registry.unique('Footer'), node: footers[0] };

  const sectionNameByHash = new Map<string, string>();
  const namePage = new Map<string, string>();
  const uniqueSections: { node: Node; sectionName: string }[] = [];
  for (const [i, page] of pages.entries()) {
    const sections: Section[] = [];
    for (const node of sectionsByPage[i]) {
      if (layoutNodes.has(node)) continue;
      const hash = structuralHash(node);
      const reused = sectionNameByHash.get(hash);
      if (reused) {
        sections.push({ name: reused, node });
        continue;
      }
      const { name: base, fallback } = componentName(node, '');
      let wanted = base;
      const owner = namePage.get(base);
      if (owner && owner !== page.route && !fallback) {
        const pageName = page.route === '/' ? 'Home' : toPascal(page.route.split('/').filter(Boolean).join(' '));
        wanted = base.startsWith(pageName) ? base : pageName + base;
      }
      const name = registry.unique(wanted);
      if (!namePage.has(base)) namePage.set(base, page.route);
      if (fallback) report.fallbackNames.push({ name, route: page.route });
      sectionNameByHash.set(hash, name);
      sections.push({ name, node });
      uniqueSections.push({ node, sectionName: name });
    }
    plan.pages.push({ route: page.route, sections });
  }

  // Repeated subtrees: count across unique sections + one copy of header/footer.
  const scanRoots = [
    ...uniqueSections,
    ...(plan.layout.header ? [{ node: plan.layout.header.node, sectionName: 'Header' }] : []),
    ...(plan.layout.footer ? [{ node: plan.layout.footer.node, sectionName: 'Footer' }] : []),
  ];
  const groups = new Map<string, { nodes: Node[]; sectionName: string }>();
  const collect = (node: Node, sectionName: string) => {
    if (size(node) >= 2) {
      const h = structuralHash(node);
      const g = groups.get(h) ?? { nodes: [], sectionName };
      g.nodes.push(node);
      groups.set(h, g);
    }
    node.children.forEach((c) => collect(c, sectionName));
  };
  for (const { node, sectionName } of scanRoots) node.children.forEach((c) => collect(c, sectionName));

  const claimed = new Set<Node>();
  const visit = (node: Node) => {
    const g = groups.get(structuralHash(node));
    if (g && g.nodes.length >= 2 && !claimed.has(node)) {
      const { name: base, fallback } = componentName(g.nodes[0], g.sectionName);
      const name = registry.unique(base);
      if (fallback) report.fallbackNames.push({ name, route: '(shared)' });
      const { props, values } = buildProps(g.nodes);
      plan.ui.push({
        name,
        template: g.nodes[0],
        props,
        instances: g.nodes.map((n, i) => ({ node: n, values: values[i] })),
      });
      g.nodes.forEach((n) => claimed.add(n));
      return;
    }
    if (!claimed.has(node)) node.children.forEach(visit);
  };
  for (const { node } of scanRoots) node.children.forEach(visit);
  return plan;
}
