import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { format } from 'prettier';
import type { ComponentPlan, UiComponent } from '../components.js';
import { contentRoot, pageStructure, shapeHash } from '../components.js';
import type { ContentBindings, ContentFile, ImageNamer } from '../content.js';
import type { FontFace } from '../fonts.js';
import { renderFontsCss } from '../fonts.js';
import type { Collection, MdxItem } from '../framer/collections.js';
import { toIsoDate } from '../framer/collections.js';
import { NameRegistry, toCamel, toPascal, toSlug } from '../framer/names.js';
import type { MotionSpec, Node, PageModel, Style } from '../model.js';
import { toTailwind } from '../tailwind.js';
import { nameColor, normalizeColor, type ThemeTokens } from '../tokens.js';
import { NEXT_PROJECT_VERSIONS } from '../versions.js';
import { renderNode, type JsxContext } from './jsx.js';
import * as T from './templates.js';

export interface ProjectModel {
  siteName: string;
  siteOrigin: string;
  exportDir: string;
  tokens: ThemeTokens;
  fonts: FontFace[];
  plan: ComponentPlan;
  content: ContentFile[];
  bindings: ContentBindings;
  collections: { c: Collection; items: MdxItem[]; itemPage: PageModel }[];
  pages: PageModel[];
  motion: Set<MotionSpec['kind']>;
  images: ImageNamer;
}

type Files = Map<string, string>;

const MEDIA: Record<string, string> = {
  tablet: '@media (max-width: 1199px)',
  mobile: '@media (max-width: 809px)',
};

/** Rewrites colours inside free-form CSS values to theme variables, creating tokens as needed. */
function tokenizeColors(value: string, tokens: ThemeTokens): string {
  return value.replace(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g, (raw) => {
    const hex = normalizeColor(raw);
    if (!hex.startsWith('#')) return raw;
    let name = tokens.colorByValue.get(hex);
    if (!name) {
      const base = nameColor(hex);
      name = base;
      for (let i = 2; tokens.colors[name]; i++) name = `${base}-${i}`;
      tokens.colors[name] = hex;
      tokens.colorByValue.set(hex, name);
    }
    return `var(--color-${name})`;
  });
}

/** Remote url(...) references (masks, backgrounds) → local /images files. */
function localizeUrls(value: string, images: ImageNamer): string {
  return value.replace(/url\(\s*["']?(https?:\/\/[^"')]+)["']?\s*\)/g, (_m, url: string) => {
    return `url('${images.publicPath(url, 'background')}')`;
  });
}

function cssModule(tokens: ThemeTokens, images: ImageNamer) {
  const rules: string[] = [];
  const names = new NameRegistry();
  const decls = (style: Style) =>
    Object.entries(style)
      .map(([k, v]) => `  ${k}: ${localizeUrls(tokenizeColors(v, tokens), images)};`)
      .join('\n');
  return {
    importName: 'styles',
    classFor(node: Node): string | undefined {
      const { leftover } = toTailwind(node.styles, node.hover, tokens, node.visibility, node.afterBorder);
      if (!Object.keys(leftover).length) return undefined;
      const cls = names.unique(toCamel(node.framerName ?? node.tag));
      if (leftover.base) rules.push(`.${cls} {\n${decls(leftover.base)}\n}`);
      for (const bp of ['tablet', 'mobile'] as const) {
        if (leftover[bp]) rules.push(`${MEDIA[bp]} {\n  .${cls} {\n${decls(leftover[bp]!)}\n  }\n}`);
      }
      if (leftover.hover) rules.push(`.${cls}:hover {\n${decls(leftover.hover)}\n}`);
      if (leftover.after) {
        // Framer's border overlay: drawn on top, does not change the element's size.
        rules.push(
          `.${cls}::after {\n  content: '';\n  position: absolute;\n  inset: 0;\n  pointer-events: none;\n  border-radius: inherit;\n${decls(leftover.after)}\n}`
        );
      }
      return cls;
    },
    css: () => rules.join('\n\n'),
  };
}

function importBlock(imports: Set<string>, extra: string[] = []): string {
  return [...extra, ...[...imports].sort()].join('\n');
}

interface Rendered {
  jsx: string;
  imports: Set<string>;
  css: string;
}

function renderWith(node: Node, model: ProjectModel, extra: Partial<JsxContext>, components: Map<string, string>): Rendered {
  const mod = cssModule(model.tokens, model.images);
  const ctx: JsxContext = {
    tokens: model.tokens,
    contentVar: 'content',
    components,
    imports: new Set(),
    siteOrigin: model.siteOrigin,
    cssModule: mod,
    localImage: (src, alt) => model.images.publicPath(src, alt),
    ...extra,
  };
  const jsx = renderNode(node, ctx);
  return { jsx, imports: ctx.imports, css: mod.css() };
}

function componentFile(
  dir: string,
  name: string,
  r: Rendered,
  signature: string,
  files: Files,
  typeImports: string[],
  preamble = ''
): void {
  const extra = [...typeImports];
  if (r.css) {
    extra.push(`import styles from './${name}.module.css';`);
    files.set(`${dir}/${name}.module.css`, r.css + '\n');
  }
  files.set(
    `${dir}/${name}.tsx`,
    `${importBlock(r.imports, extra)}\n\n${preamble ? preamble + '\n\n' : ''}export function ${name}(${signature}) {\n  return (${r.jsx || 'null'});\n}\n`
  );
}

function instanceComponents(plan: ComponentPlan): Map<string, string> {
  const map = new Map<string, string>();
  for (const comp of plan.ui) for (const inst of comp.instances) map.set(inst.node.id, comp.name);
  return map;
}

function propType(kind: 'text' | 'image' | 'href'): string {
  return kind === 'image' ? 'ImageData' : 'string';
}

function writeUiComponent(comp: UiComponent, model: ProjectModel, files: Files, components: Map<string, string>): void {
  const at = (root: Node, p: number[]) => p.reduce((n, i) => n.children[i], root);
  const props = new Map(comp.props.map((p) => [at(comp.template, p.path).id, { kind: p.kind, name: p.name }]));
  const inner = new Map(components);
  inner.delete(comp.template.id);
  const r = renderWith(comp.template, model, { props, bindings: undefined }, inner);
  const typeImports = comp.props.some((p) => p.kind === 'image') ? ["import type { ImageData } from '@/lib/types';"] : [];
  const iface = `export interface ${comp.name}Props {\n${comp.props.map((p) => `  ${p.name}: ${propType(p.kind)};`).join('\n')}\n}`;
  const args = comp.props.length ? `{ ${comp.props.map((p) => p.name).join(', ')} }: ${comp.name}Props` : '';
  componentFile('components/ui', comp.name, r, args, files, typeImports, iface);
}

interface Listing {
  section: string;
  array: string;
  comp: UiComponent;
  collection: Collection;
  itemsExpr: string;
}

function detectListings(model: ProjectModel): Listing[] {
  const out: Listing[] = [];
  for (const { c, items } of model.collections) {
    const page = model.plan.pages.find((p) => p.route === c.indexRoute);
    if (!page) continue;
    for (const comp of model.plan.ui) {
      const hrefProp = comp.props.find((p) => p.kind === 'href');
      if (!hrefProp) continue;
      const insts = comp.instances.filter((i) => page.sections.some((s) => contains(s.node, i.node)));
      if (!insts.length) continue;
      const toPath = (h: string) => (h.startsWith(model.siteOrigin) ? new URL(h).pathname : h).replace(/\/+$/, '');
      const itemFor = (inst: (typeof insts)[number]) =>
        items.find((it) => `${c.indexRoute}/${it.slug}` === toPath(String(inst.values[hrefProp.name])));
      if (!insts.every(itemFor)) continue;
      const parts = comp.props.map((p) => {
        if (p === hrefProp) return `${p.name}: \`${c.indexRoute}/\${e.slug}\``;
        for (const f of c.fields) {
          const ok = insts.every((inst) => {
            const meta = itemFor(inst)!.metadata[f.key];
            const v = inst.values[p.name];
            if (p.kind === 'image') {
              const img = v as { src: string; alt: string };
              return model.images.publicPath(img.src, img.alt || 'image') === meta;
            }
            if (f.kind === 'date') return toIsoDate(String(v)) === meta;
            return v === meta;
          });
          if (!ok) continue;
          if (p.kind === 'image') {
            const { src: _src, ...rest } = insts[0].values[p.name] as { src: string };
            return `${p.name}: { ...${JSON.stringify(rest)}, src: e.metadata.${f.key} }`;
          }
          if (f.kind === 'date') {
            const locale = /^\d/.test(String(insts[0].values[p.name])) ? 'en-GB' : 'en-US';
            return `${p.name}: formatDate(e.metadata.${f.key}, '${locale}')`;
          }
          return `${p.name}: e.metadata.${f.key}`;
        }
        const constant = insts[0].values[p.name];
        if (p.kind === 'image') {
          const img = constant as { src: string; alt: string };
          return `${p.name}: ${JSON.stringify({ ...img, src: model.images.publicPath(img.src, img.alt || 'image') })}`;
        }
        return `${p.name}: ${JSON.stringify(constant)}`;
      });
      const section = page.sections.find((s) => contains(s.node, insts[0].node))!;
      const array = model.bindings.instance.get(insts[0].node.id)?.array;
      if (!array) continue;
      out.push({
        section: section.name,
        array,
        comp,
        collection: c,
        itemsExpr: `(await get${toPascal(c.name)}()).map((e) => ({ ${parts.join(', ')} }))`,
      });
    }
  }
  return out;
}

function contains(root: Node, target: Node): boolean {
  return root === target || root.children.some((c) => contains(c, target));
}

function writeSections(model: ProjectModel, files: Files, listings: Listing[]): void {
  const components = instanceComponents(model.plan);
  const done = new Set<string>();
  const all = [
    ...(model.plan.layout.header ? [model.plan.layout.header] : []),
    ...(model.plan.layout.footer ? [model.plan.layout.footer] : []),
    ...(model.plan.layout.overlays ?? []),
    ...model.plan.pages.flatMap((p) => p.sections),
  ];
  for (const section of all) {
    if (done.has(section.name)) continue;
    done.add(section.name);
    const binding = model.bindings.section.get(section.node.id);
    const data = binding
      ? (model.content.find((f) => f.module === binding.module)?.data[binding.key] as Record<string, unknown>)
      : undefined;
    const hasContent = !!data && Object.keys(data).length > 0;
    const listing = listings.find((l) => l.section === section.name);
    const r = renderWith(
      section.node,
      model,
      { bindings: model.bindings, listingArrays: listing ? new Set([listing.array]) : undefined },
      components
    );
    const typeImports: string[] = [];
    const params: string[] = [];
    const types: string[] = [];
    if (hasContent) {
      const typeName = toPascal(binding!.module) + 'Content';
      typeImports.push(`import type { ${typeName} } from '@/content/${binding!.module}';`);
      params.push('content');
      types.push(`content: ${typeName}['${binding!.key}']`);
    }
    if (listing) {
      typeImports.push(`import type { ${listing.comp.name}Props } from '@/components/ui/${listing.comp.name}';`);
      params.push('items');
      types.push(`items: ${listing.comp.name}Props[]`);
    }
    const signature = params.length ? `{ ${params.join(', ')} }: { ${types.join('; ')} }` : '';
    componentFile('components/sections', section.name, r, signature, files, typeImports);
  }
}

function pageMetadata(page: PageModel | undefined): string {
  if (!page) return '';
  const meta: Record<string, unknown> = { title: page.title };
  if (page.meta.description) meta.description = page.meta.description;
  const og: Record<string, string> = {};
  if (page.meta['og:title']) og.title = page.meta['og:title'];
  if (page.meta['og:description']) og.description = page.meta['og:description'];
  if (Object.keys(og).length) meta.openGraph = og;
  return `export const metadata: Metadata = ${JSON.stringify(meta, null, 2)};`;
}

function routeDir(route: string): string {
  return route === '/' ? 'app' : `app${route}`;
}

function writePages(model: ProjectModel, files: Files, listings: Listing[]): void {
  for (const page of model.plan.pages) {
    const imports = new Set<string>(["import type { Metadata } from 'next';"]);
    const calls: string[] = [];
    const lets: string[] = [];
    for (const s of page.sections) {
      imports.add(`import { ${s.name} } from '@/components/sections/${s.name}';`);
      const binding = model.bindings.section.get(s.node.id);
      const data = binding ? model.content.find((f) => f.module === binding.module)?.data[binding.key] : undefined;
      const props: string[] = [];
      if (binding && data && Object.keys(data as object).length) {
        imports.add(`import { ${binding.module} } from '@/content/${binding.module}';`);
        props.push(`content={${binding.module}.${binding.key}}`);
      }
      const listing = listings.find((l) => l.section === s.name);
      if (listing) {
        const fn = `get${toPascal(listing.collection.name)}`;
        imports.add(`import { ${fn} } from '@/lib/${listing.collection.dir}';`);
        if (listing.itemsExpr.includes('formatDate(')) imports.add("import { formatDate } from '@/lib/format';");
        const v = `${toCamel(listing.collection.name)}Items`;
        lets.push(`  const ${v} = ${listing.itemsExpr};`);
        props.push(`items={${v}}`);
      }
      calls.push(`<${s.name}${props.length ? ' ' + props.join(' ') : ''} />`);
    }
    const asyncKw = lets.length ? 'async ' : '';
    const body = `${lets.join('\n')}${lets.length ? '\n' : ''}  return (\n    <>\n      ${calls.join('\n      ')}\n    </>\n  );`;
    files.set(
      `${routeDir(page.route)}/page.tsx`,
      `${[...imports].join('\n')}\n\n${pageMetadata(model.pages.find((p) => p.route === page.route))}\n\nexport default ${asyncKw}function Page() {\n${body}\n}\n`
    );
  }
}

function classesFor(node: Node, tokens: ThemeTokens): string {
  return toTailwind(node.styles, node.hover, tokens, node.visibility, node.afterBorder).classes.join(' ');
}

function colorClass(prefix: string, value: string | undefined, tokens: ThemeTokens): string | undefined {
  if (!value) return undefined;
  const name = tokens.colorByValue.get(normalizeColor(value));
  return name ? `${prefix}-${name}` : undefined;
}

function writeLayout(model: ProjectModel, files: Files): void {
  const first = model.pages[0];
  const { header, footer } = model.plan.layout;
  const imports = new Set<string>([
    "import type { Metadata } from 'next';",
    "import type { ReactNode } from 'react';",
    "import './globals.css';",
    "import { MotionProvider } from '@/components/motion/MotionProvider';",
  ]);
  const sectionCall = (s: { name: string; node: Node } | undefined) => {
    if (!s) return '';
    imports.add(`import { ${s.name} } from '@/components/sections/${s.name}';`);
    const binding = model.bindings.section.get(s.node.id);
    const data = binding ? model.content.find((f) => f.module === binding.module)?.data[binding.key] : undefined;
    if (!binding || !data || !Object.keys(data as object).length) return `<${s.name} />`;
    imports.add("import { layout } from '@/content/layout';");
    return `<${s.name} content={layout.${binding.key}} />`;
  };
  // wrapper chain between <body> and the node that holds the sections
  const chain: Node[] = first ? pageStructure(first.root).path : [];
  let inner = `${sectionCall(header)}{children}${sectionCall(footer)}`;
  for (const wrapper of [...chain].reverse()) {
    const cls = classesFor(wrapper, model.tokens);
    inner = `<${wrapper.tag}${cls ? ` className="${cls}"` : ''}>${inner}</${wrapper.tag}>`;
  }
  // Fixed overlays shared by every page (cursor labels, floating buttons) sit outside the page flow.
  inner += (model.plan.layout.overlays ?? []).map(sectionCall).join('');
  const bodyCls = first ? classesFor(first.root, model.tokens) : '';
  const bg = colorClass('bg', first?.root.styles.base['background-color'], model.tokens) ?? 'bg-white';
  const fg = colorClass('bg', first?.root.styles.base.color, model.tokens) ?? 'bg-current';
  if (model.motion.has('loader')) {
    imports.add("import { Loader } from '@/components/motion/Loader';");
    inner = `<Loader className="${bg}" />${inner}`;
  }
  if (model.motion.has('smooth-scroll')) {
    imports.add("import { SmoothScroll } from '@/components/motion/SmoothScroll';");
    inner = `<SmoothScroll>${inner}</SmoothScroll>`;
  }
  if (model.motion.has('cursor')) {
    imports.add("import { Cursor } from '@/components/motion/Cursor';");
    inner = `${inner}<Cursor className="${fg}" />`;
  }
  const meta: Record<string, unknown> = { title: first?.title ?? model.siteName };
  if (first?.meta.description) meta.description = first.meta.description;
  files.set(
    'app/layout.tsx',
    `${[...imports].join('\n')}\n\nexport const metadata: Metadata = ${JSON.stringify(meta, null, 2)};\n\n` +
      `export default function RootLayout({ children }: { children: ReactNode }) {\n  return (\n    <html lang="en">\n      <body${bodyCls ? ` className="${bodyCls}"` : ''}>\n        <MotionProvider>${inner}</MotionProvider>\n      </body>\n    </html>\n  );\n}\n`
  );
}

function walk(node: Node, fn: (n: Node) => void): void {
  fn(node);
  node.children.forEach((c) => walk(c, fn));
}

function writeCollections(model: ProjectModel, files: Files): void {
  const layoutShapes = new Set(
    [model.plan.layout.header, model.plan.layout.footer].filter(Boolean).map((s) => shapeHash(s!.node))
  );
  for (const { c, items, itemPage } of model.collections) {
    const Name = toPascal(c.name);
    const metaType = `${Name}Meta`;
    for (const item of items) {
      files.set(
        `content/${item.file}`,
        `export const metadata = ${JSON.stringify(item.metadata, null, 2)};\n\n${item.body}\n`
      );
    }
    const metaFields = c.fields.map((f) => `  ${f.key}: string;`).join('\n');
    files.set(
      `lib/${c.dir}.ts`,
      `import fs from 'node:fs';
import path from 'node:path';
import type { ComponentType } from 'react';
import type { MDXComponents } from 'mdx/types';

export interface ${metaType} {
${metaFields}
}

const DIR = path.join(process.cwd(), 'content', '${c.dir}');

export function get${Name}Slugs(): string[] {
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.mdx'))
    .map((f) => f.replace(/\\.mdx$/, ''))
    .sort();
}

export async function get${Name}Entry(slug: string) {
  const mod = (await import(\`@/content/${c.dir}/\${slug}.mdx\`)) as {
    default: ComponentType<{ components?: MDXComponents }>;
    metadata: ${metaType};
  };
  return { slug, metadata: mod.metadata, Content: mod.default };
}

export async function get${Name}() {
  return Promise.all(get${Name}Slugs().map(get${Name}Entry));
}
`
    );

    // Article template: the item page sections without the shared header/footer.
    const sections = contentRoot(itemPage.root).children.filter((s) => !layoutShapes.has(shapeHash(s)));
    const byKey = new Map<string, Node>();
    sections.forEach((s) => walk(s, (n) => byKey.set(n.key, n)));
    const overrides = new Map<string, { text?: string; image?: string; alt?: string; children?: string }>();
    const titleKey = (c.fields.find((f) => f.key === 'title') ?? c.fields.find((f) => f.kind === 'text'))?.key;
    let needsFormat = false;
    for (const f of c.fields) {
      const n = byKey.get(f.nodeKey);
      if (!n) continue;
      if (f.kind === 'image') {
        overrides.set(n.id, { image: `metadata.${f.key}`, ...(titleKey ? { alt: `metadata.${titleKey}` } : {}) });
      }
      else if (f.kind === 'date') {
        needsFormat = true;
        overrides.set(n.id, { text: `formatDate(metadata.${f.key}, '${/^\d/.test(n.text ?? '') ? 'en-GB' : 'en-US'}')` });
      } else overrides.set(n.id, { text: `metadata.${f.key}` });
    }
    const body = c.bodyKey ? byKey.get(c.bodyKey) : undefined;
    if (body) overrides.set(body.id, { children: 'children' });
    sections.forEach((s) =>
      walk(s, (n) => {
        if (n.asset?.kind === 'image' && !overrides.has(n.id)) {
          overrides.set(n.id, { image: JSON.stringify(model.images.publicPath(n.asset.src, n.attrs.alt || `${c.name} image`)) });
        }
      })
    );
    const mod = cssModule(model.tokens, model.images);
    const ctx: JsxContext = {
      tokens: model.tokens,
      contentVar: 'metadata',
      components: new Map(),
      imports: new Set(),
      siteOrigin: model.siteOrigin,
      cssModule: mod,
      overrides,
      localImage: (src, alt) => model.images.publicPath(src, alt),
    };
    const jsx = sections.map((s) => renderNode(s, ctx)).join('\n');
    const extra = [
      "import type { ReactNode } from 'react';",
      `import type { ${metaType} } from '@/lib/${c.dir}';`,
      ...(needsFormat ? ["import { formatDate } from '@/lib/format';"] : []),
    ];
    const css = mod.css();
    if (css) {
      extra.push(`import styles from './${Name}Article.module.css';`);
      files.set(`components/sections/${Name}Article.module.css`, css + '\n');
    }
    files.set(
      `components/sections/${Name}Article.tsx`,
      `${importBlock(ctx.imports, extra)}\n\nexport function ${Name}Article({ metadata, children }: { metadata: ${metaType}; children: ReactNode }) {\n  return (\n    <>\n${jsx}\n    </>\n  );\n}\n`
    );

    // MDX element styles taken from the first element of each tag in the original body.
    const tagClasses = new Map<string, string>();
    if (body) {
      walk(body, (n) => {
        if (n !== body && !tagClasses.has(n.tag)) tagClasses.set(n.tag, classesFor(n, model.tokens));
      });
    }
    const mdxTags = ['p', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'a', 'blockquote', 'img'];
    const cls = (t: string) => (tagClasses.get(t) ? ` className="${tagClasses.get(t)}"` : '');
    const entries = mdxTags
      .filter((t) => tagClasses.has(t) || t === 'p' || t === 'img')
      .map((t) => {
        if (t === 'img') {
          return `  // eslint-disable-next-line @next/next/no-img-element\n  img: ({ alt, ...props }) => <img alt={alt ?? ''}${cls(t)} {...props} />,`;
        }
        if (t === 'p') {
          // Markdown wraps a standalone image in <p>; the original page had the image on its own.
          return `  p: ({ children, ...props }) =>\n    onlyImage(children) ? <>{children}</> : <p${cls(t)} {...props}>{children}</p>,`;
        }
        return `  ${t}: (props) => <${t}${cls(t)} {...props} />,`;
      });
    files.set(
      `components/mdx/${Name}Mdx.tsx`,
      `import { Children, isValidElement, type ReactNode } from 'react';
import type { MDXComponents } from 'mdx/types';

function onlyImage(children: ReactNode): boolean {
  const items = Children.toArray(children);
  return items.length === 1 && isValidElement<{ src?: string }>(items[0]) && !!items[0].props.src;
}

/** Styles for elements inside ${c.name} entries. */
export const ${toCamel(c.name)}Mdx: MDXComponents = {
${entries.join('\n')}
};
`
    );

    const titleField = c.fields.find((f) => f.key === 'title') ?? c.fields.find((f) => f.kind === 'text');
    files.set(
      `app${c.indexRoute}/[slug]/page.tsx`,
      `import type { Metadata } from 'next';
import { ${Name}Article } from '@/components/sections/${Name}Article';
import { ${toCamel(c.name)}Mdx } from '@/components/mdx/${Name}Mdx';
import { get${Name}Entry, get${Name}Slugs } from '@/lib/${c.dir}';

type Params = { params: Promise<{ slug: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return get${Name}Slugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const { metadata } = await get${Name}Entry(slug);
  return { title: ${titleField ? `metadata.${titleField.key}` : 'slug'} };
}

export default async function Page({ params }: Params) {
  const { slug } = await params;
  const { metadata, Content } = await get${Name}Entry(slug);
  return (
    <${Name}Article metadata={metadata}>
      <Content components={${toCamel(c.name)}Mdx} />
    </${Name}Article>
  );
}
`
    );
  }
}

/** Tailwind's size scale without its built-in line-heights: line-height stays inherited like the original. */
const FONT_SCALE: Record<string, string> = {
  xs: '0.75rem', sm: '0.875rem', base: '1rem', lg: '1.125rem', xl: '1.25rem', '2xl': '1.5rem', '3xl': '1.875rem',
  '4xl': '2.25rem', '5xl': '3rem', '6xl': '3.75rem', '7xl': '4.5rem', '8xl': '6rem', '9xl': '8rem',
};

function globalsCss(tokens: ThemeTokens): string {
  const theme = [
    '  --color-*: initial;',
    '  --text-*: initial;',
    ...Object.entries(FONT_SCALE).map(([k, v]) => `  --text-${k}: ${v};`),
    ...Object.entries(tokens.colors).map(([k, v]) => `  --color-${k}: ${v};`),
    ...Object.entries(tokens.fonts).map(([k, v]) => `  --font-${k}: ${v}, sans-serif;`),
    ...Object.entries(tokens.radii).map(([k, v]) => `  --radius-${k.replace(/^radius-/, '')}: ${v};`),
    ...Object.entries(tokens.shadows).map(([k, v]) => `  --${k}: ${tokenizeColors(v, tokens)};`),
  ];
  return `/* Tailwind without preflight: the original site's browser defaults stay in effect. */
@layer theme, base, components, utilities;
@import 'tailwindcss/theme.css' layer(theme);
@import 'tailwindcss/utilities.css' layer(utilities);
@import './fonts.css';

/* Desktop-first breakpoints matching the original Framer site. */
@custom-variant tablet (@media (max-width: 1199px));
@custom-variant mobile (@media (max-width: 809px));

@theme {
${theme.join('\n')}
}
`;
}

function motionFiles(files: Files, used: Set<MotionSpec['kind']>, allSource: string): void {
  files.set('components/motion/MotionProvider.tsx', T.MOTION_PROVIDER);
  files.set('components/motion/config.ts', T.MOTION_CONFIG);
  if (allSource.includes('@/components/motion/MotionImage')) files.set('components/motion/MotionImage.tsx', T.MOTION_IMAGE);
  if (allSource.includes('@/components/motion/MotionLink')) files.set('components/motion/MotionLink.tsx', T.MOTION_LINK);
  if (used.has('split-text')) files.set('components/motion/SplitText.tsx', T.SPLIT_TEXT);
  if (used.has('scroll')) {
    files.set('components/motion/ScrollEffect.tsx', T.SCROLL_EFFECT);
    files.set('components/motion/useScrollAnimation.ts', T.USE_SCROLL_ANIMATION);
  }
  if (used.has('smooth-scroll')) files.set('components/motion/SmoothScroll.tsx', T.SMOOTH_SCROLL);
  if (used.has('cursor')) files.set('components/motion/Cursor.tsx', T.CURSOR);
  if (used.has('loader')) files.set('components/motion/Loader.tsx', T.LOADER);
}

async function copyImages(dir: string, model: ProjectModel, warn: (m: string) => void): Promise<void> {
  for (const [src, publicPath] of model.images.entries()) {
    const target = path.join(dir, 'public', publicPath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    let base = '';
    try {
      base = path.posix.basename(new URL(src, 'http://local').pathname);
    } catch {}
    const local = base && path.join(model.exportDir, 'assets', 'images', base);
    if (local && existsSync(local)) {
      await fs.copyFile(local, target);
      continue;
    }
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fs.writeFile(target, Buffer.from(await res.arrayBuffer()));
    } catch (e) {
      warn(`Image not copied: ${src} (${(e as Error).message})`);
    }
  }
}

const PARSER: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mjs': 'babel',
  '.css': 'css',
  '.json': 'json',
  '.md': 'markdown',
};

/** Writes the complete Next.js project into `dir`. */
export async function writeProject(
  dir: string,
  model: ProjectModel,
  warn: (message: string) => void = () => {}
): Promise<void> {
  const files: Files = new Map();
  const listings = detectListings(model);

  for (const comp of model.plan.ui) writeUiComponent(comp, model, files, instanceComponents(model.plan));
  writeSections(model, files, listings);
  writeCollections(model, files);
  writeLayout(model, files);
  writePages(model, files, listings);
  for (const f of model.content) {
    files.set(
      `content/${f.module}.ts`,
      `export const ${f.module} = ${JSON.stringify(f.data, null, 2)};\n\nexport type ${f.typeName} = typeof ${f.module};\n`
    );
  }
  const allSource = [...files.values()].join('\n');
  motionFiles(files, model.motion, allSource);
  if (allSource.includes('@/lib/types')) files.set('lib/types.ts', T.LIB_TYPES);
  if (allSource.includes('@/lib/format')) files.set('lib/format.ts', T.LIB_FORMAT);

  files.set('app/globals.css', globalsCss(model.tokens));
  files.set('app/fonts.css', renderFontsCss(model.fonts));
  files.set(
    'package.json',
    JSON.stringify(
      {
        name: toSlug(model.siteName),
        version: '0.1.0',
        private: true,
        scripts: { dev: 'next dev', build: 'next build', start: 'next start', lint: 'eslint', format: 'prettier --write .' },
        dependencies: { ...NEXT_PROJECT_VERSIONS.dependencies },
        devDependencies: { ...NEXT_PROJECT_VERSIONS.devDependencies },
      },
      null,
      2
    ) + '\n'
  );
  files.set('next.config.ts', T.NEXT_CONFIG);
  files.set('tsconfig.json', JSON.stringify(T.TSCONFIG, null, 2) + '\n');
  files.set('postcss.config.mjs', T.POSTCSS_CONFIG);
  files.set('eslint.config.mjs', T.ESLINT_CONFIG);
  files.set('.prettierrc', JSON.stringify(T.PRETTIERRC, null, 2) + '\n');
  files.set('.gitignore', T.GITIGNORE);
  files.set('mdx-components.tsx', T.MDX_COMPONENTS);
  files.set('README.md', T.readme(model.siteName, model.collections.map((x) => x.c.dir)));

  for (const [rel, raw] of files) {
    const parser = PARSER[path.extname(rel)];
    let text = raw;
    if (parser) {
      try {
        text = await format(raw, { parser, singleQuote: true, printWidth: 100 });
      } catch (e) {
        warn(`Could not format ${rel}: ${(e as Error).message.split('\n')[0]}`);
      }
    }
    const target = path.join(dir, rel);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, text);
  }

  const fontsDir = path.join(dir, 'public', 'fonts');
  await fs.mkdir(fontsDir, { recursive: true });
  for (const face of model.fonts) {
    const from = path.join(model.exportDir, 'assets', 'fonts', face.file);
    if (existsSync(from)) await fs.copyFile(from, path.join(fontsDir, face.file));
  }
  await copyImages(dir, model, warn);
}
