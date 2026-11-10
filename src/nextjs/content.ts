import path from 'node:path';
import type { ComponentPlan, UiComponent } from './components.js';
import type { Node } from './model.js';
import type { ConversionReport } from './report.js';
import { isGenericName, NameRegistry, toCamel, toPascal, toSlug } from './framer/names.js';

export interface ContentFile {
  module: string;
  typeName: string;
  data: Record<string, unknown>;
}

export interface ContentBindings {
  /** Section node id → content module + top-level key. */
  section: Map<string, { module: string; key: string }>;
  /** Node id → dotted path relative to the section's content object. */
  text: Map<string, string>;
  image: Map<string, string>;
  href: Map<string, string>;
  /** UI component instance node id → array key in the section content + index. */
  instance: Map<string, { array: string; index: number }>;
}

export interface ImageValue {
  src: string;
  alt: string;
  width: number;
  height: number;
}

/** Assigns readable, unique `/images/<name><ext>` paths and remembers source → public path. */
export class ImageNamer {
  private bySource = new Map<string, string>();
  private names = new Set<string>();

  /** Same image, different resize query (?scale-down-to=…) → one key. */
  static canonical(src: string): string {
    return /^https?:\/\//.test(src) ? src.replace(/[?#].*$/, '') : src;
  }

  publicPath(src: string, hint: string): string {
    src = ImageNamer.canonical(src);
    const existing = this.bySource.get(src);
    if (existing) return existing;
    let ext = '.png';
    try {
      ext = path.posix.extname(new URL(src, 'http://local').pathname).toLowerCase() || '.png';
    } catch {}
    if (!/^\.(png|jpe?g|gif|webp|avif|svg)$/.test(ext)) ext = '.png';
    const base = toSlug(hint).slice(0, 60).replace(/-+$/, '') || 'image';
    let name = base;
    for (let n = 2; this.names.has(name + ext); n++) name = `${base}-${n}`;
    this.names.add(name + ext);
    const publicPath = `/images/${name}${ext}`;
    this.bySource.set(src, publicPath);
    return publicPath;
  }

  entries(): IterableIterator<[string, string]> {
    return this.bySource.entries();
  }
}

export function moduleName(route: string): string {
  return route === '/' ? 'home' : toCamel(route.split('/').filter(Boolean).join(' '));
}

const isDecorative = (text: string) => !/[\p{L}\p{N}]/u.test(text);

function leafKey(node: Node): string {
  if (node.framerName && !isGenericName(node.framerName)) return toCamel(node.framerName);
  if (/^h[1-6]$/.test(node.tag)) return 'heading';
  if (node.tag === 'a' || node.tag === 'button') return 'link';
  if (node.asset?.kind === 'image') return 'image';
  return 'text';
}

interface Ctx {
  route: string;
  report: ConversionReport;
  images: ImageNamer;
  bindings: ContentBindings;
  instanceOf: Map<Node, { comp: UiComponent; index: number }>;
  siteOrigin?: string;
}

function normalizeHref(href: string, origin?: string): string {
  if (origin && href.startsWith(origin)) {
    const u = new URL(href);
    return (u.pathname.replace(/\/+$/, '') || '/') + u.search + u.hash;
  }
  return href;
}

function imageValue(node: Node, ctx: Ctx, hint: string): ImageValue {
  const alt = node.attrs.alt ?? '';
  return {
    src: ctx.images.publicPath(node.asset!.src, alt || hint),
    alt,
    width: node.asset!.width,
    height: node.asset!.height,
  };
}

function instanceValues(comp: UiComponent, values: Record<string, unknown>, ctx: Ctx): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const prop of comp.props) {
    const v = values[prop.name];
    if (prop.kind === 'image') {
      const img = v as ImageValue;
      out[prop.name] = { ...img, src: ctx.images.publicPath(img.src, img.alt || `${comp.name} ${prop.name}`) };
    } else if (prop.kind === 'href') out[prop.name] = normalizeHref(String(v), ctx.siteOrigin);
    else out[prop.name] = v;
  }
  return out;
}

function sectionContent(section: Node, sectionName: string, ctx: Ctx): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const keys = new NameRegistry();
  const arrays = new Map<UiComponent, string>();

  const walk = (node: Node) => {
    const inst = ctx.instanceOf.get(node);
    if (inst) {
      let array = arrays.get(inst.comp);
      if (!array) {
        const base = toCamel(inst.comp.name);
        array = keys.unique(base.endsWith('s') ? base + 'es' : base + 's');
        arrays.set(inst.comp, array);
        data[array] = [];
      }
      const list = data[array] as unknown[];
      ctx.bindings.instance.set(node.id, { array, index: list.length });
      list.push(instanceValues(inst.comp, inst.comp.instances[inst.index].values, ctx));
      return;
    }
    if (node.animation?.kind === 'split-text') {
      const text = (function joined(n: Node): string {
        if (n.inline) return n.inline.map((x) => (typeof x === 'number' ? joined(n.children[x]) : x)).join('');
        return (n.text ?? '') + n.children.map(joined).join('');
      })(node).trim();
      const key = keys.unique(leafKey(node));
      data[key] = text;
      ctx.bindings.text.set(node.id, key);
      return;
    }
    if (node.asset?.kind === 'image') {
      const key = keys.unique(leafKey(node));
      data[key] = imageValue(node, ctx, `${sectionName} ${key}`);
      ctx.bindings.image.set(node.id, key);
    }
    const href = node.attrs.href;
    if (node.inline) {
      // Text interleaved with inline elements: one content value per text segment.
      node.inline.forEach((segment, i) => {
        if (typeof segment !== 'string' || !segment.trim()) return;
        if (isDecorative(segment)) {
          ctx.report.textExceptions.push({ route: ctx.route, text: segment.trim() });
          return;
        }
        const key = keys.unique(leafKey(node));
        data[key] = segment.trim();
        ctx.bindings.text.set(`${node.id}~${i}`, key);
      });
      if (href) {
        const key = keys.unique(leafKey(node) + 'Href');
        data[key] = normalizeHref(href, ctx.siteOrigin);
        ctx.bindings.href.set(node.id, key);
      }
    } else if (node.text !== undefined) {
      if (isDecorative(node.text)) {
        ctx.report.textExceptions.push({ route: ctx.route, text: node.text });
      } else if (href) {
        const key = keys.unique(leafKey(node));
        data[key] = { label: node.text, href: normalizeHref(href, ctx.siteOrigin) };
        ctx.bindings.text.set(node.id, `${key}.label`);
        ctx.bindings.href.set(node.id, `${key}.href`);
      } else {
        const key = keys.unique(leafKey(node));
        data[key] = node.text;
        ctx.bindings.text.set(node.id, key);
      }
    } else if (href) {
      const key = keys.unique(leafKey(node) + 'Href');
      data[key] = normalizeHref(href, ctx.siteOrigin);
      ctx.bindings.href.set(node.id, key);
    }
    node.children.forEach(walk);
  };
  walk(section);
  return data;
}

/** Page text, links and images → typed content modules; bindings tell the JSX renderer where each value lives. */
export function extractContent(
  plan: ComponentPlan,
  report: ConversionReport,
  images: ImageNamer,
  siteOrigin?: string
): { files: ContentFile[]; bindings: ContentBindings } {
  const bindings: ContentBindings = {
    section: new Map(),
    text: new Map(),
    image: new Map(),
    href: new Map(),
    instance: new Map(),
  };
  const instanceOf = new Map<Node, { comp: UiComponent; index: number }>();
  for (const comp of plan.ui) comp.instances.forEach((inst, index) => instanceOf.set(inst.node, { comp, index }));
  const files: ContentFile[] = [];

  const build = (module: string, route: string, sections: { name: string; node: Node }[]) => {
    const data: Record<string, unknown> = {};
    const keys = new NameRegistry();
    for (const section of sections) {
      const key = keys.unique(toCamel(section.name));
      const ctx: Ctx = { route, report, images, bindings, instanceOf, siteOrigin };
      data[key] = sectionContent(section.node, section.name, ctx);
      bindings.section.set(section.node.id, { module, key });
    }
    files.push({ module, typeName: toPascal(module) + 'Content', data });
  };

  for (const page of plan.pages) build(moduleName(page.route), page.route, page.sections);
  const layout = [plan.layout.header, plan.layout.footer].filter((s): s is NonNullable<typeof s> => !!s);
  if (layout.length) {
    build(
      'layout',
      '(layout)',
      layout.map((s) => ({ name: s === plan.layout.header ? 'header' : 'footer', node: s.node }))
    );
  }
  return { files, bindings };
}
