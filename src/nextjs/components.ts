import crypto from 'node:crypto';
import type { Node, PageModel, Style } from './model.js';
import type { ConversionReport } from './report.js';
import { componentName, isGenericName, NameRegistry, toCamel, toPascal } from './framer/names.js';
import { nameColor } from './tokens.js';

export interface PropDef {
  name: string;
  kind: 'text' | 'image' | 'href' | 'variant';
  /** Child-index path from the component template root to the leaf. */
  path: number[];
}

/**
 * Copies of one Framer component that differ only in colours or icons (Framer "variants").
 * `paths` are the template nodes that change; `representative[v]` is an instance showing variant v.
 */
export interface VariantSet {
  names: string[];
  paths: number[][];
  representative: number[];
}

export interface UiComponent {
  name: string;
  template: Node;
  props: PropDef[];
  instances: { node: Node; values: Record<string, unknown> }[];
  variants?: VariantSet;
}

export interface Section {
  name: string;
  node: Node;
}

export interface ComponentPlan {
  layout: { header?: Section; footer?: Section; overlays?: Section[] };
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
    node.attrs['data-svg'] ? sha(node.attrs['data-svg']) : '',
    node.afterBorder ? JSON.stringify(node.afterBorder) : '',
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

/** Style properties a Framer variant typically changes; ignored when grouping repeats. */
export const VARIANT_PROPS = new Set([
  'color', 'background-color', 'fill', 'stroke', 'outline-color', 'text-decoration-color',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
]);

const looseStyleSig = (s: Style | undefined) =>
  styleSig(s ? Object.fromEntries(Object.entries(s).filter(([k]) => !VARIANT_PROPS.has(k))) : undefined);

const looseCache = new WeakMap<Node, string>();

/** Like structuralHash, but colours and icon markup may differ: copies of one component in different variants. */
export function looseHash(node: Node): string {
  const cached = looseCache.get(node);
  if (cached) return cached;
  const sig = [
    node.tag,
    node.framerName ?? '',
    node.asset?.kind ?? '',
    node.afterBorder ? `${node.afterBorder.widths.join(' ')} ${node.afterBorder.style}` : '',
    (node.visibility ?? []).join(','),
    looseStyleSig(node.styles.base),
    looseStyleSig(node.styles.tablet),
    looseStyleSig(node.styles.mobile),
    styleSig(node.hover),
    node.children.map(looseHash).join(','),
  ].join('|');
  const h = sha(sig);
  looseCache.set(node, h);
  return h;
}

/** The variant-relevant part of one node: its colours and icon markup. */
function variantSig(node: Node): string {
  const pick = (s: Style | undefined) =>
    Object.entries(s ?? {}).filter(([k]) => VARIANT_PROPS.has(k)).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify([
    pick(node.styles.base), pick(node.styles.tablet), pick(node.styles.mobile),
    node.attrs['data-svg'] ?? '', node.afterBorder?.color ?? '',
  ]);
}

/** Tags and layer names only, used to recognise shared header/footer across pages. */
export function shapeHash(node: Node): string {
  return sha(`${node.tag}[${node.framerName ?? ''}](${node.children.map(shapeHash).join(',')})`);
}

function size(node: Node): number {
  return 1 + node.children.reduce((s, c) => s + size(c), 0);
}

/** The node whose children are the page sections: descend through single-child wrappers. */
/** Framer's own page furniture: never part of the converted site. */
const FRAMER_CHROME_IDS = new Set(['__framer-badge-container', '__framer-editorbar', 'svg-templates', 'template-overlay']);

export function isFramerChrome(node: Node): boolean {
  return FRAMER_CHROME_IDS.has(node.attrs.id ?? '') || node.tag === 'iframe';
}

const isEmptyNode = (n: Node) => !n.children.length && !n.text && !n.asset && !n.inline;
/** Fixed elements belong to the viewport (overlays); absolute ones belong to their container's content. */
const isOverlay = (n: Node) => n.styles.base.position === 'fixed';
const isInFlow = (n: Node) => !/^(fixed|absolute)$/.test(n.styles.base.position ?? '');

/**
 * Walks from <body> to the element that holds the page sections, through wrappers that have a
 * single in-flow child. Fixed/absolute elements met on the way (cursors, floating buttons) are
 * overlays; Framer's badge and editor furniture are dropped.
 */
export function pageStructure(root: Node): { content: Node; path: Node[]; overlays: Node[]; sections: Node[] } {
  let node = root;
  const path: Node[] = [];
  const overlays: Node[] = [];
  for (;;) {
    const kids = node.children.filter((c) => !isFramerChrome(c) && !isEmptyNode(c));
    const content = kids.filter((c) => !isOverlay(c));
    if (content.length !== 1 || !isInFlow(content[0]) || !content[0].children.length) break;
    overlays.push(...kids.filter(isOverlay));
    node = content[0];
    path.push(node);
  }
  return { content: node, path, overlays, sections: expandContents(node.children.filter((c) => !isFramerChrome(c))) };
}

/**
 * Framer wraps a page's own sections in a `display: contents` element (the page component).
 * It has no box, so its children are laid out as if they were direct children: they are the sections.
 */
function expandContents(nodes: Node[]): Node[] {
  return nodes.flatMap((c) =>
    c.styles.base.display === 'contents' && !c.styles.tablet?.display && !c.styles.mobile?.display && c.children.length
      ? expandContents(c.children.filter((x) => !isFramerChrome(x)))
      : [c]
  );
}

/** The node whose children are the page sections. */
export function contentRoot(root: Node): Node {
  return pageStructure(root).content;
}

/** The page's sections, in order (see pageStructure). */
export function pageSections(root: Node): Node[] {
  return pageStructure(root).sections;
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

const COLOR_ORDER = ['background-color', 'color', 'fill', 'stroke', 'border-top-color'];

/** Readable variant names from their main colour ("yellow", "pink"), else variant1, variant2… */
function nameVariants(reps: Node[], paths: number[][]): string[] {
  const names = reps.map((rep) => {
    for (const p of paths) {
      const base = at(rep, p).styles.base;
      for (const k of COLOR_ORDER) {
        if (!base[k]) continue;
        try {
          return toCamel(nameColor(base[k]).replace(/-\d+.*$/, ''));
        } catch {
          // Not a plain colour (gradient, variable): try the next one.
        }
      }
    }
    return '';
  });
  const ok = names.every((n, i) => n && names.indexOf(n) === i);
  return ok ? names : reps.map((_, i) => `variant${i + 1}`);
}

function detectVariants(instances: Node[]): { set: VariantSet; byInstance: number[] } | undefined {
  const paths: number[][] = [];
  const all = (n: Node, p: number[]) => {
    paths.push(p);
    n.children.forEach((c, i) => all(c, [...p, i]));
  };
  all(instances[0], []);
  const differing = paths.filter((p) => {
    const first = variantSig(at(instances[0], p));
    return instances.some((x) => variantSig(at(x, p)) !== first);
  });
  if (!differing.length) return undefined;
  const keys = instances.map((x) => differing.map((p) => variantSig(at(x, p))).join('\n'));
  const unique = [...new Set(keys)];
  const representative = unique.map((k) => keys.indexOf(k));
  const names = nameVariants(representative.map((i) => instances[i]), differing);
  return { set: { names, paths: differing, representative }, byInstance: keys.map((k) => unique.indexOf(k)) };
}

function buildProps(instances: Node[]): {
  props: PropDef[];
  values: Record<string, unknown>[];
  variants?: VariantSet;
} {
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
  const props: PropDef[] = differs.map((c) => ({ name: used.unique(c.base), kind: c.kind, path: c.path }));
  const values = instances.map((inst) =>
    Object.fromEntries(props.map((p, i) => [p.name, differs[i].get(at(inst, p.path))]))
  );
  const v = detectVariants(instances);
  if (!v) return { props, values };
  const name = used.unique('variant');
  props.push({ name, kind: 'variant', path: [] });
  values.forEach((vals, i) => (vals[name] = v.set.names[v.byInstance[i]]));
  return { props, values, variants: v.set };
}

/** Sections per page, shared header/footer and repeated UI components with their props. */
export function planComponents(pages: PageModel[], report: ConversionReport): ComponentPlan {
  const registry = new NameRegistry();
  const structures = pages.map((p) => pageStructure(p.root));
  const sectionsByPage = structures.map((s) => [...s.sections]);
  const headers = detectLayout(sectionsByPage, 'first');
  const footers = detectLayout(sectionsByPage, 'last');
  const layoutNodes = new Set([...(headers ?? []), ...(footers ?? [])]);
  const plan: ComponentPlan = { layout: {}, pages: [], ui: [] };
  if (headers) plan.layout.header = { name: registry.unique('Header'), node: headers[0] };
  if (footers) plan.layout.footer = { name: registry.unique('Footer'), node: footers[0] };

  // Fixed/absolute elements outside the page flow (cursors, floating buttons): shared ones belong to the layout.
  const overlayPages = new Map<string, Node[]>();
  structures.forEach((s) => s.overlays.forEach((o) => overlayPages.set(shapeHash(o), [...(overlayPages.get(shapeHash(o)) ?? []), o])));
  const sharedOverlay = new Set<Node>();
  for (const nodes of overlayPages.values()) {
    if (nodes.length >= 2 && nodes.length >= pages.length / 2) {
      const { name, fallback } = componentName(nodes[0], '');
      const overlayName = registry.unique(fallback ? 'Overlay' : name);
      (plan.layout.overlays ??= []).push({ name: overlayName, node: nodes[0] });
      nodes.forEach((n) => sharedOverlay.add(n));
    }
  }
  structures.forEach((s, i) => sectionsByPage[i].push(...s.overlays.filter((o) => !sharedOverlay.has(o))));

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
      const marker = node.motion?.kind === 'smooth-scroll' || node.motion?.kind === 'loader';
      const { name: base, fallback } = marker
        ? { name: toPascal(node.framerName ?? node.motion!.kind) + 'Anchor', fallback: false }
        : componentName(node, '');
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
    ...(plan.layout.overlays ?? []).map((o) => ({ node: o.node, sectionName: o.name })),
  ];
  const groups = new Map<string, { nodes: Node[]; sectionName: string }>();
  const collect = (node: Node, sectionName: string) => {
    if (size(node) >= 2) {
      const h = looseHash(node);
      const g = groups.get(h) ?? { nodes: [], sectionName };
      g.nodes.push(node);
      groups.set(h, g);
    }
    node.children.forEach((c) => collect(c, sectionName));
  };
  for (const { node, sectionName } of scanRoots) node.children.forEach((c) => collect(c, sectionName));

  const parentOf = new Map<Node, Node>();
  const index = (n: Node) => n.children.forEach((c) => (parentOf.set(c, n), index(c)));
  scanRoots.forEach((r) => index(r.node));
  /** A repeat is worth a component when its layer has a real name, or when copies sit side by side (a list). */
  const meaningful = (nodes: Node[]) => {
    if (!isGenericName(nodes[0].framerName)) return true;
    const parents = nodes.map((x) => parentOf.get(x));
    return parents.some((p, i) => p && parents.indexOf(p) !== i);
  };
  const claimed = new Set<Node>();
  const visit = (node: Node) => {
    const g = groups.get(looseHash(node));
    if (g && g.nodes.length >= 2 && !claimed.has(node) && meaningful(g.nodes)) {
      const { name: base, fallback } = componentName(g.nodes[0], g.sectionName);
      const name = registry.unique(base);
      if (fallback) report.fallbackNames.push({ name, route: '(shared)' });
      const { props, values, variants } = buildProps(g.nodes);
      plan.ui.push({
        name,
        template: g.nodes[0],
        props,
        instances: g.nodes.map((n, i) => ({ node: n, values: values[i] })),
        ...(variants ? { variants } : {}),
      });
      g.nodes.forEach((n) => claimed.add(n));
      return;
    }
    if (!claimed.has(node)) node.children.forEach(visit);
  };
  for (const { node } of scanRoots) node.children.forEach(visit);
  return plan;
}
