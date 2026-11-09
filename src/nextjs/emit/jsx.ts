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
  reveal: "import { Reveal } from '@/components/motion/Reveal';",
  split: "import { SplitText } from '@/components/motion/SplitText';",
  scroll: "import { ScrollEffect } from '@/components/motion/ScrollEffect';",
};

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
  const { classes } = toTailwind(node.styles, node.hover, ctx.tokens, node.visibility);
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

function textExpr(node: Node, ctx: JsxContext): string | undefined {
  const bound = ctx.bindings?.text.get(node.id);
  if (bound) return `{${ctx.contentVar}.${bound}}`;
  const prop = ctx.props?.get(node.id);
  if (prop?.kind === 'text') return `{${prop.name}}`;
  return node.text ? escapeJsxText(node.text) : undefined;
}

function renderImage(node: Node, ctx: JsxContext): string {
  ctx.imports.add(IMPORTS.image);
  const bound = ctx.bindings?.image.get(node.id);
  const prop = ctx.props?.get(node.id);
  const base = bound ? `${ctx.contentVar}.${bound}` : prop?.kind === 'image' ? prop.name : undefined;
  const cls = classNameAttr(node, ctx);
  if (base) {
    return `<Image src={${base}.src} alt={${base}.alt} width={${base}.width} height={${base}.height}${cls} />`;
  }
  const a = node.asset!;
  return `<Image src=${attrValue(a.src)} alt=${attrValue(node.attrs.alt ?? '')} width={${a.width}} height={${a.height}}${cls} />`;
}

interface RenderState {
  arrayCounts: Map<string, number>;
}

function renderChildren(node: Node, ctx: JsxContext, state: RenderState): string {
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
      if (inst.index === 0 && run === state.arrayCounts.get(inst.array)) {
        out.push(`{${arr}.map((item, i) => <${comp} key={i} {...item} />)}`);
      } else {
        for (let k = 0; k < run; k++) out.push(`<${comp} {...${arr}[${inst.index + k}]} />`);
      }
      i = j - 1;
      continue;
    }
    if (comp) {
      ctx.imports.add(`import { ${comp} } from '@/components/ui/${comp}';`);
      out.push(`<${comp} />`);
      continue;
    }
    out.push(render(child, ctx, state));
  }
  return out.join('');
}

function render(node: Node, ctx: JsxContext, state: RenderState): string {
  const kind = node.motion?.kind;
  if (kind === 'smooth-scroll' || kind === 'loader') return '';

  if (kind === 'split-text') {
    ctx.imports.add(IMPORTS.split);
    const expr = textExpr(node, ctx);
    const text = expr && expr.startsWith('{') ? expr.slice(1, -1) : JSON.stringify(textOf(node));
    const cls = classNameAttr(node, ctx);
    return `<SplitText as="${node.tag}" text={${text}} from=${fromLiteral(node.motion!.from)}${cls} />`;
  }

  let element: string;
  if (node.asset?.kind === 'image') {
    element = renderImage(node, ctx);
  } else if (node.asset?.kind === 'svg' && node.attrs['data-svg']) {
    element = svgToJsx(node.attrs['data-svg']);
  } else {
    let tag = node.tag;
    const attrs: string[] = [];
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
        tag = 'Link';
        ctx.imports.add(IMPORTS.link);
      }
      attrs.push(`href=${hrefExpr}`);
    }
    for (const [name, value] of Object.entries(node.attrs)) {
      if (name.startsWith('aria-')) attrs.push(`${name}=${attrValue(value)}`);
      else if (KEEP_ATTRS[name] && !(name === 'alt' && node.tag !== 'img')) {
        attrs.push(`${KEEP_ATTRS[name]}=${attrValue(value)}`);
      }
    }
    const open = `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}${classNameAttr(node, ctx)}`;
    const inner = (textExpr(node, ctx) ?? '') + renderChildren(node, ctx, state);
    element = VOID.has(node.tag) || !inner ? `${open} />` : `${open}>${inner}</${tag}>`;
  }

  if (kind === 'reveal') {
    ctx.imports.add(IMPORTS.reveal);
    return `<Reveal from=${fromLiteral(node.motion!.from)}>${element}</Reveal>`;
  }
  if (kind === 'scroll' && node.motion!.scroll) {
    ctx.imports.add(IMPORTS.scroll);
    return `<ScrollEffect values={${JSON.stringify(node.motion!.scroll)}}>${element}</ScrollEffect>`;
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
