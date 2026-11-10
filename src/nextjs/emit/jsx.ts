import type { Node, Transform } from '../model.js';
import type { ContentBindings } from '../content.js';
import type { ThemeTokens } from '../tokens.js';
import { toTailwind } from '../tailwind.js';

export interface JsxContext {
  tokens: ThemeTokens;
  /** Variable holding the section's content object. */
  contentVar: string;
  /** Section mode: where each node's values live in the content object. */
  bindings?: ContentBindings;
  /** UI component template mode: node id → prop. */
  props?: Map<string, { kind: 'text' | 'image' | 'href'; name: string }>;
  /** Node id → UI component name for instances rendered as components. */
  components: Map<string, string>;
  cssModule?: { importName: string; classFor(node: Node): string | undefined };
  /** Full import lines collected while rendering. */
  imports: Set<string>;
  siteOrigin: string;
  /** Collection templates: replace a node's text, image source or whole content with an expression. */
  overrides?: Map<string, { text?: string; image?: string; alt?: string; children?: string }>;
  /** Maps an image without a content binding to its local /images path (never ship remote Framer URLs). */
  localImage?: (src: string, alt: string) => string;
  /** Component arrays rendered from an `items` prop (collection listings) instead of content. */
  listingArrays?: Set<string>;
}

const VOID = new Set(['img', 'br', 'hr', 'input', 'source', 'wbr', 'meta', 'link']);
const KEEP_ATTRS: Record<string, string> = {
  alt: 'alt', target: 'target', rel: 'rel', role: 'role', title: 'title', type: 'type',
  tabindex: 'tabIndex', for: 'htmlFor', name: 'name', placeholder: 'placeholder',
  disabled: 'disabled', loading: 'loading', download: 'download',
};

const IMPORTS = {
  image: "import Image from 'next/image';",
  link: "import Link from 'next/link';",
  motion: "import * as motion from 'motion/react-client';",
  revealConfig: "import { reveal } from '@/components/motion/config';",
  motionImage: "import { MotionImage } from '@/components/motion/MotionImage';",
  motionLink: "import { MotionLink } from '@/components/motion/MotionLink';",
  split: "import { SplitText } from '@/components/motion/SplitText';",
  scroll: "import { ScrollEffect } from '@/components/motion/ScrollEffect';",
};

const REST: Record<string, number> = { opacity: 1, x: 0, y: 0, scale: 1, rotate: 0 };

/** `initial/whileInView/viewport/transition` attributes for an appear animation. */
function revealAttrs(from: Transform | undefined, ctx: JsxContext): string {
  ctx.imports.add(IMPORTS.revealConfig);
  const to = Object.fromEntries(Object.keys(from ?? {}).map((k) => [k, REST[k]]));
  return `initial=${fromLiteral(from)} whileInView=${fromLiteral(to)} viewport={{ once: true }} transition={reveal}`;
}

/** JSX text: plain when safe, otherwise a JSON string literal expression. */
export function escapeJsxText(s: string): string {
  return /[{}<>`]/.test(s) ? `{${JSON.stringify(s)}}` : s;
}

const attrValue = (v: string) => (v.includes('"') ? `{${JSON.stringify(v)}}` : `"${v}"`);

function fromLiteral(from: Transform | undefined): string {
  const entries = Object.entries(from ?? {}).map(([k, v]) => `${k}: ${v}`);
  return `{{ ${entries.join(', ')} }}`;
}

function textOf(node: Node): string {
  return (node.text ?? '') + node.children.map(textOf).join('');
}

function svgToJsx(svg: string): string {
  return svg
    .replace(/\s(?:style|class|data-[\w-]+)="[^"]*"/g, '')
    .replace(/\sxlink:href=/g, ' xlinkHref=')
    .replace(/\s([a-z]+(?:-[a-z]+)+)=/g, (m, name: string) =>
      name.startsWith('aria-') ? m : ' ' + name.replace(/-([a-z])/g, (_x, c: string) => c.toUpperCase()) + '='
    );
}

function classNameAttr(node: Node, ctx: JsxContext): string {
  const { classes } = toTailwind(node.styles, node.hover, ctx.tokens, node.visibility, node.afterBorder);
  const moduleClass = ctx.cssModule?.classFor(node);
  if (moduleClass) {
    const rest = classes.length ? ' ' + classes.join(' ') : '';
    return ` className={\`\${${ctx.cssModule!.importName}.${moduleClass}}${rest}\`}`;
  }
  return classes.length ? ` className="${classes.join(' ')}"` : '';
}

function isInternal(href: string, ctx: JsxContext): boolean {
  return href.startsWith('/') || href.startsWith(ctx.siteOrigin);
}

function localPath(href: string, ctx: JsxContext): string {
  if (!href.startsWith(ctx.siteOrigin)) return href;
  const u = new URL(href);
  return (u.pathname.replace(/\/+$/, '') || '/') + u.search + u.hash;
}

/** Text and inline elements in their original order; spaces at segment edges are kept explicitly. */
function renderInline(node: Node, ctx: JsxContext, state: RenderState, inText: boolean): string {
  return node
    .inline!.map((x, i) => {
      if (typeof x === 'number') {
        const child = node.children[x];
        return child ? render(child, ctx, state, inText) : '';
      }
      const bound = ctx.bindings?.text.get(`${node.id}~${i}`);
      if (bound) {
        const lead = /^\s/.test(x) ? '{" "}' : '';
        const trail = /\s$/.test(x) ? '{" "}' : '';
        return `${lead}{${ctx.contentVar}.${bound}}${trail}`;
      }
      return /^\s|\s$|[{}<>`]/.test(x) ? `{${JSON.stringify(x)}}` : x;
    })
    .join('');
}

function textExpr(node: Node, ctx: JsxContext): string | undefined {
  const override = ctx.overrides?.get(node.id)?.text;
  if (override) return `{${override}}`;
  const bound = ctx.bindings?.text.get(node.id);
  if (bound) return `{${ctx.contentVar}.${bound}}`;
  const prop = ctx.props?.get(node.id);
  if (prop?.kind === 'text') return `{${prop.name}}`;
  return node.text ? escapeJsxText(node.text) : undefined;
}

function renderImage(node: Node, ctx: JsxContext, motionAttrs: string): string {
  let tag = 'Image';
  if (motionAttrs) {
    tag = 'MotionImage';
    ctx.imports.add(IMPORTS.motionImage);
  } else ctx.imports.add(IMPORTS.image);
  const lead = motionAttrs ? ' ' + motionAttrs : '';
  const bound = ctx.bindings?.image.get(node.id);
  const prop = ctx.props?.get(node.id);
  const base = bound ? `${ctx.contentVar}.${bound}` : prop?.kind === 'image' ? prop.name : undefined;
  const cls = classNameAttr(node, ctx);
  const override = ctx.overrides?.get(node.id)?.image;
  if (override) {
    const a = node.asset!;
    const altOverride = ctx.overrides?.get(node.id)?.alt;
    const alt = altOverride ? `{${altOverride}}` : attrValue(node.attrs.alt ?? '');
    return `<${tag}${lead} src={${override}} alt=${alt} width={${a.width}} height={${a.height}}${cls} />`;
  }
  if (base) {
    return `<${tag}${lead} src={${base}.src} alt={${base}.alt} width={${base}.width} height={${base}.height}${cls} />`;
  }
  const a = node.asset!;
  const src = ctx.localImage ? ctx.localImage(a.src, node.attrs.alt || 'image') : a.src;
  return `<${tag}${lead} src=${attrValue(src)} alt=${attrValue(node.attrs.alt ?? '')} width={${a.width}} height={${a.height}}${cls} />`;
}

interface RenderState {
  arrayCounts: Map<string, number>;
}

function renderChildren(node: Node, ctx: JsxContext, state: RenderState, inText: boolean): string {
  const out: string[] = [];
  const kids = node.children;
  for (let i = 0; i < kids.length; i++) {
    const child = kids[i];
    const comp = ctx.components.get(child.id);
    const inst = ctx.bindings?.instance.get(child.id);
    if (comp && inst) {
      ctx.imports.add(`import { ${comp} } from '@/components/ui/${comp}';`);
      let j = i + 1;
      while (
        j < kids.length &&
        ctx.components.get(kids[j].id) === comp &&
        ctx.bindings!.instance.get(kids[j].id)?.array === inst.array &&
        ctx.bindings!.instance.get(kids[j].id)?.index === inst.index + (j - i)
      ) {
        j++;
      }
      const run = j - i;
      const arr = `${ctx.contentVar}.${inst.array}`;
      if (ctx.listingArrays?.has(inst.array)) {
        if (inst.index === 0) out.push(`{items.map((item, i) => <${comp} key={i} {...item} />)}`);
      } else if (inst.index === 0 && run === state.arrayCounts.get(inst.array)) {
        out.push(`{${arr}.map((item, i) => <${comp} key={i} {...item} />)}`);
      } else {
        for (let k = 0; k < run; k++) out.push(`<${comp} {...${arr}[${inst.index + k}]} />`);
      }
      i = j - 1;
      continue;
    }
    // An instance without content (e.g. nested in another component's template) renders inline.
    out.push(render(child, ctx, state, inText));
  }
  return out.join('');
}

/** Elements whose content must be phrasing content in HTML. */
const TEXT_TAGS = new Set(['p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'button', 'label', 'strong', 'em', 'small']);
/** Block elements that are invalid inside TEXT_TAGS; rendered as display:block spans there. */
const BLOCK_TAGS = new Set(['div', 'section', 'article', 'header', 'footer', 'nav', 'aside', 'main', 'figure']);

function render(original: Node, ctx: JsxContext, state: RenderState, inText = false): string {
  // HTML parsers close a <p> at the first <div>, so React hydration would fail; a block span renders the same.
  const node: Node =
    inText && BLOCK_TAGS.has(original.tag)
      ? { ...original, tag: 'span', styles: { ...original.styles, base: { display: 'block', ...original.styles.base } } }
      : original;
  const childInText = inText || TEXT_TAGS.has(node.tag);
  const kind = node.motion?.kind;
  // Behaviour markers live in layout.tsx; keep an empty element so stack gaps stay identical.
  if (kind === 'smooth-scroll' || kind === 'loader') return `<div aria-hidden="true"${classNameAttr(node, ctx)} />`;

  if (kind === 'split-text') {
    ctx.imports.add(IMPORTS.split);
    const expr = textExpr(node, ctx);
    const text = expr && expr.startsWith('{') ? expr.slice(1, -1) : JSON.stringify(textOf(node));
    const cls = classNameAttr(node, ctx);
    return `<SplitText as="${node.tag}" text={${text}} from=${fromLiteral(node.motion!.from)}${cls} />`;
  }

  const motionAttrs = kind === 'reveal' ? revealAttrs(node.motion!.from, ctx) : '';
  let element: string;
  if (node.asset?.kind === 'image') {
    element = renderImage(node, ctx, motionAttrs);
  } else if (node.asset?.kind === 'svg' && node.attrs['data-svg'] && !motionAttrs) {
    element = svgToJsx(node.attrs['data-svg']);
  } else {
    let tag = node.tag;
    const attrs: string[] = motionAttrs ? [motionAttrs] : [];
    const href = node.attrs.href;
    if (tag === 'a' && href !== undefined) {
      const boundHref = ctx.bindings?.href.get(node.id);
      const prop = ctx.props?.get(node.id);
      const hrefExpr = boundHref
        ? `{${ctx.contentVar}.${boundHref}}`
        : prop?.kind === 'href'
          ? `{${prop.name}}`
          : attrValue(localPath(href, ctx));
      if (isInternal(href, ctx)) {
        tag = motionAttrs ? 'MotionLink' : 'Link';
        ctx.imports.add(motionAttrs ? IMPORTS.motionLink : IMPORTS.link);
      }
      attrs.push(`href=${hrefExpr}`);
    }
    if (motionAttrs && tag === node.tag) {
      tag = `motion.${node.tag}`;
      ctx.imports.add(IMPORTS.motion);
    }
    for (const [name, value] of Object.entries(node.attrs)) {
      if (name.startsWith('aria-')) attrs.push(`${name}=${attrValue(value)}`);
      else if (name === 'tabindex' && /^-?\d+$/.test(value)) attrs.push(`tabIndex={${value}}`);
      else if (KEEP_ATTRS[name] && !(name === 'alt' && node.tag !== 'img')) {
        attrs.push(`${KEEP_ATTRS[name]}=${attrValue(value)}`);
      }
    }
    const open = `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}${classNameAttr(node, ctx)}`;
    const childrenOverride = ctx.overrides?.get(node.id)?.children;
    const inner = childrenOverride
      ? `{${childrenOverride}}`
      : node.inline
        ? renderInline(node, ctx, state, childInText)
        : (textExpr(node, ctx) ?? '') + renderChildren(node, ctx, state, childInText);
    element = VOID.has(node.tag) || !inner ? `${open} />` : `${open}>${inner}</${tag}>`;
  }

  if (kind === 'scroll' && node.motion!.scroll) {
    ctx.imports.add(IMPORTS.scroll);
    // Inside text elements the wrapper must be a span to keep the HTML valid.
    const as = inText ? ' as="span"' : '';
    return `<ScrollEffect${as} values={${JSON.stringify(node.motion!.scroll)}}>${element}</ScrollEffect>`;
  }
  return element;
}

/** Node subtree → JSX string; collects imports into `ctx.imports`. */
export function renderNode(node: Node, ctx: JsxContext): string {
  const arrayCounts = new Map<string, number>();
  const count = (n: Node) => {
    const inst = ctx.bindings?.instance.get(n.id);
    if (inst) arrayCounts.set(inst.array, (arrayCounts.get(inst.array) ?? 0) + 1);
    else n.children.forEach(count);
  };
  count(node);
  return render(node, ctx, { arrayCounts });
}
