import { parse, serializeOuter } from 'parse5';
import TurndownService from 'turndown';
import type { Node, PageModel } from '../model.js';
import type { ImageNamer } from '../content.js';
import { contentRoot } from '../components.js';
import { isGenericName, toCamel, toSlug } from './names.js';

export interface CollectionField {
  key: string;
  kind: 'text' | 'date' | 'image' | 'tags';
  /** Node key of the field in every item page. */
  nodeKey: string;
}

export interface Collection {
  name: string;
  dir: string;
  indexRoute: string;
  itemRoutes: string[];
  templateRoot: Node;
  fields: CollectionField[];
  /** Node key of the rich-text body element, when one was found. */
  bodyKey?: string;
}

export interface MdxItem {
  slug: string;
  metadata: Record<string, unknown>;
  body: string;
  file: string;
}

const DATE_RE = /\b\d{1,2} [A-Za-z]+ \d{4}\b|\b[A-Za-z]+ \d{1,2}, \d{4}\b/;
const RICH_TAGS = new Set(['p', 'h2', 'h3', 'h4', 'li', 'blockquote']);

export function collectionDir(segment: string): string {
  if (segment === 'blog' || segment.endsWith('s')) return segment;
  if (/[^aeiou]y$/.test(segment)) return segment.slice(0, -1) + 'ies';
  return segment + 's';
}

export function toIsoDate(text: string): string | undefined {
  const match = text.match(DATE_RE)?.[0];
  if (!match) return undefined;
  const t = Date.parse(match + ' UTC');
  return Number.isNaN(t) ? undefined : new Date(t).toISOString().slice(0, 10);
}

/** Escapes characters MDX would treat as JSX expressions or tags. */
export function escapeMdx(text: string): string {
  return text.replace(/([{}<])/g, '\\$1');
}

function walk(node: Node, fn: (n: Node, depth: number) => void, depth = 0): void {
  fn(node, depth);
  node.children.forEach((c) => walk(c, fn, depth + 1));
}

function byKey(root: Node): Map<string, Node> {
  const map = new Map<string, Node>();
  walk(root, (n) => map.set(n.key, n));
  return map;
}

function signature(page: PageModel): string[] {
  return contentRoot(page.root).children.map((s) => `${s.tag}[${s.framerName ?? ''}]`);
}

function sameTemplate(a: string[], b: string[]): boolean {
  const len = Math.max(a.length, b.length);
  if (!len) return false;
  let same = 0;
  for (let i = 0; i < len; i++) if (a[i] && a[i] === b[i]) same++;
  return same / len >= 0.8;
}

function richCount(node: Node): number {
  let count = 0;
  walk(node, (n) => {
    if (RICH_TAGS.has(n.tag)) count++;
  });
  return count;
}

function findBody(root: Node): Node | undefined {
  const max = richCount(root);
  if (max < 2) return undefined;
  let best: { node: Node; depth: number } | undefined;
  for (const child of root.children) {
    walk(child, (n, depth) => {
      if (richCount(n) >= max * 0.6 && (!best || depth > best.depth)) best = { node: n, depth };
    });
  }
  return best?.node;
}

function fieldKey(node: Node, used: Set<string>): string {
  let base = node.framerName && !isGenericName(node.framerName) ? toCamel(node.framerName) : '';
  if (!base) base = /^h[1-6]$/.test(node.tag) ? 'title' : node.asset ? 'image' : 'text';
  let key = base;
  for (let i = 2; used.has(key); i++) key = `${base}${i}`;
  used.add(key);
  return key;
}

const fieldValue = (n: Node) => (n.asset?.kind === 'image' ? n.asset.src : (n.text ?? ''));

function detectFields(items: PageModel[], bodyKey: string | undefined): CollectionField[] {
  const maps = items.map((p) => byKey(p.root));
  const template = items[0].root;
  const bodyNode = bodyKey ? maps[0].get(bodyKey) : undefined;
  const inBody = new Set<Node>();
  if (bodyNode) walk(bodyNode, (n) => inBody.add(n));
  const used = new Set<string>();
  const fields: CollectionField[] = [];
  walk(template, (n) => {
    if (inBody.has(n) || (!n.text && n.asset?.kind !== 'image')) return;
    const nodes = maps.map((m) => m.get(n.key));
    if (nodes.some((x) => !x)) return;
    const values = nodes.map((x) => fieldValue(x!));
    if (values.every((v) => v === values[0])) return;
    const kind: CollectionField['kind'] =
      n.asset?.kind === 'image' ? 'image' : values.every((v) => toIsoDate(v)) ? 'date' : 'text';
    fields.push({ key: fieldKey(n, used), kind, nodeKey: n.key });
  });
  return fields;
}

/** Index route + ≥2 item routes under one segment sharing a page template. */
export function detectCollections(pages: PageModel[]): Collection[] {
  const routes = new Set(pages.map((p) => p.route));
  const groups = new Map<string, PageModel[]>();
  for (const page of pages) {
    const segs = page.route.split('/').filter(Boolean);
    if (segs.length !== 2) continue;
    groups.set(segs[0], [...(groups.get(segs[0]) ?? []), page]);
  }
  const out: Collection[] = [];
  for (const [segment, items] of groups) {
    if (items.length < 2 || !routes.has('/' + segment)) continue;
    const sig = signature(items[0]);
    if (!items.every((p) => sameTemplate(sig, signature(p)))) continue;
    const body = findBody(contentRoot(items[0].root));
    out.push({
      name: segment,
      dir: collectionDir(segment),
      indexRoute: '/' + segment,
      itemRoutes: items.map((p) => p.route),
      templateRoot: items[0].root,
      fields: detectFields(items, body?.key),
      ...(body ? { bodyKey: body.key } : {}),
    });
  }
  return out;
}

export function collectionRoutes(cs: Collection[]): Set<string> {
  return new Set(cs.flatMap((c) => c.itemRoutes));
}

type P5 = {
  nodeName: string;
  tagName?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: P5[];
};

const p5Children = (n: P5) => (n.childNodes ?? []).filter((c) => !!c.tagName);

/** Finds an element in export HTML by the same key scheme the capture uses. */
function findExportElement(html: string, key: string): P5 | undefined {
  const doc = parse(html) as unknown as P5;
  const htmlEl = p5Children(doc).find((n) => n.tagName === 'html');
  let node = htmlEl && p5Children(htmlEl).find((n) => n.tagName === 'body');
  const segments = key.split('/').slice(1);
  for (const seg of segments) {
    const index = Number(seg.slice(seg.lastIndexOf(':') + 1));
    node = node ? p5Children(node)[index] : undefined;
  }
  return node;
}

function collectImgs(n: P5, out: P5[] = []): P5[] {
  if (n.tagName === 'img') out.push(n);
  (n.childNodes ?? []).forEach((c) => collectImgs(c, out));
  return out;
}

function liveImages(n: Node): Node[] {
  const out: Node[] = [];
  walk(n, (x) => {
    if (x.asset?.kind === 'image') out.push(x);
  });
  return out;
}

function markdownFrom(html: string, origin: string): string {
  const td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced' });
  const md = td
    .turndown(html)
    .replace(/^(\s*)-\s+/gm, '$1- ')
    .split(origin + '/')
    .join('/');
  return md
    .split('\n')
    .map((line) => line.replace(/(!?\[[^\]]*\]\([^)]*\))|([{}<])/g, (m, link) => (link ? link : '\\' + m)))
    .join('\n')
    .trim();
}

/** One collection item → MDX metadata (fields) + markdown body. */
export function itemToMdx(
  page: PageModel,
  c: Collection,
  ctx: { exportHtml: string; images: ImageNamer; usedSlugs: Set<string> }
): MdxItem {
  const base = toSlug(page.route.split('/').filter(Boolean).pop() ?? 'item');
  let slug = base;
  for (let i = 2; ctx.usedSlugs.has(slug); i++) slug = `${base}-${i}`;
  ctx.usedSlugs.add(slug);

  const nodes = byKey(page.root);
  const title = c.fields.find((f) => f.key === 'title');
  const titleText = title ? nodes.get(title.nodeKey)?.text : undefined;
  const metadata: Record<string, unknown> = {};
  for (const f of c.fields) {
    const n = nodes.get(f.nodeKey);
    if (!n) continue;
    if (f.kind === 'image' && n.asset) {
      metadata[f.key] = ctx.images.publicPath(n.asset.src, n.attrs.alt || `${titleText ?? slug} ${f.key}`);
    } else if (f.kind === 'date') {
      metadata[f.key] = toIsoDate(n.text ?? '') ?? n.text;
    } else {
      metadata[f.key] = n.text ?? '';
    }
  }

  let body = '';
  const live = c.bodyKey ? nodes.get(c.bodyKey) : findBody(contentRoot(page.root));
  const exported = live ? findExportElement(ctx.exportHtml, live.key) : undefined;
  if (live && exported) {
    const liveImgs = liveImages(live);
    collectImgs(exported).forEach((img, i) => {
      const src = liveImgs[i];
      if (!src?.asset) return;
      const publicPath = ctx.images.publicPath(src.asset.src, src.attrs.alt || `${slug} image`);
      const attrs = (img.attrs ?? []).filter((a) => a.name !== 'src' && a.name !== 'srcset');
      img.attrs = [...attrs, { name: 'src', value: publicPath }];
    });
    const origin = new URL(page.sourceUrl).origin;
    const inner = (exported.childNodes ?? []).map((ch) => serializeOuter(ch as never)).join('');
    body = markdownFrom(inner, origin);
  }
  return { slug, metadata, body, file: `${c.dir}/${slug}.mdx` };
}
