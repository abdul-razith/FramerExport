import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { rewriteHtmlTags } from '../../../assets/html-tags.js';
import type { PageInfo } from '../../types.js';

export function routeFromSubpageFile(file: string): string {
  const base = path.posix.basename(file.split('\\').join('/')).replace(/\.html?$/i, '');
  if (base === 'index') return '/';
  return '/' + base.split('_').join('/');
}

function attr(tag: string, name: string): string | undefined {
  const re = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = re.exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
}

function decode(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Hash of the tag / data-framer-name skeleton of a whole fragment (text and other attributes ignored). */
export function skeletonSignature(fragmentHtml: string): string {
  const skeleton: string[] = [];
  rewriteHtmlTags(
    fragmentHtml,
    (tag, name) => {
      if (name === 'script' || name === 'style' || name === 'noscript') return tag;
      const fn = attr(tag, 'data-framer-name');
      skeleton.push(fn === undefined ? name : `${name}[${fn}]`);
      return tag;
    },
    (body) => body
  );
  return createHash('sha1').update(skeleton.join('|')).digest('hex');
}

/** Fragment of `html` starting at the #main element (the whole document when there is none). */
function mainFragment(html: string): string {
  let start = -1;
  rewriteHtmlTags(html, (tag) => {
    if (start < 0 && /\sid\s*=\s*["']?main["'\s>]/i.test(tag)) start = html.indexOf(tag);
    return tag;
  });
  return start < 0 ? html : html.slice(start);
}

/** Hash of the tag / data-framer-name skeleton of #main. */
export function structureSignature(html: string): string {
  return skeletonSignature(mainFragment(html));
}

/**
 * The named Framer layers (`tag[data-framer-name]`) of #main. Names of component variant roots
 * (`framer-v-*`) are left out: CMS fields pick the variant, so detail pages of one collection differ there.
 */
export function namedLayers(html: string): string[] {
  const layers: string[] = [];
  rewriteHtmlTags(
    mainFragment(html),
    (tag, name) => {
      const fn = attr(tag, 'data-framer-name');
      if (fn !== undefined && !/(^|\s)framer-v-/.test(attr(tag, 'class') ?? '')) layers.push(`${name}[${fn}]`);
      return tag;
    },
    (body) => body
  );
  return layers;
}

/** Dice similarity of two layer multisets: 1 = same layers, 0 = nothing shared. */
export function templateSimilarity(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 1;
  const counts = new Map<string, number>();
  for (const x of a) counts.set(x, (counts.get(x) ?? 0) + 1);
  let shared = 0;
  for (const x of b) {
    const n = counts.get(x) ?? 0;
    if (n > 0) {
      shared++;
      counts.set(x, n - 1);
    }
  }
  return (2 * shared) / (a.length + b.length);
}

/**
 * Sibling pages at or above this similarity share a template. CMS detail pages differ in rich text,
 * variants and conditional sections (nudge's last case study lacks "Next Case Study" and scores 0.87
 * against the others), while different templates score lower (nudge's blog listing vs a post: 0.82).
 */
const SAME_TEMPLATE = 0.85;

interface Parsed extends PageInfo {
  layers: string[];
}

function parsePage(html: string, route: string, sourceFile: string): Parsed {
  let title = '';
  const meta: Record<string, string> = {};
  rewriteHtmlTags(
    html,
    (tag, name) => {
      if (name === 'meta') {
        const key = attr(tag, 'name') ?? attr(tag, 'property');
        const content = attr(tag, 'content');
        if (key && content !== undefined && !(key in meta)) meta[key] = decode(content);
      }
      return tag;
    },
    (body, name) => {
      if (name === 'title' && !title) title = decode(body).trim();
      return body;
    }
  );
  return { route, sourceFile, title, meta, layers: namedLayers(html) };
}

/** Static PageInfo (route, title, meta) of one exported page. */
export function pageInfoFromHtml(html: string, route: string, sourceFile: string): PageInfo {
  const { layers: _layers, ...info } = parsePage(html, route, sourceFile);
  return info;
}

export async function derivePages(exportDir: string): Promise<PageInfo[]> {
  const files = ['index.html'];
  const subDir = path.join(exportDir, 'subpages');
  const entries = await readdir(subDir).catch(() => [] as string[]);
  for (const e of entries.filter((f) => f.endsWith('.html')).sort()) files.push(`subpages/${e}`);

  const parsed: Parsed[] = [];
  for (const file of files) {
    const html = await readFile(path.join(exportDir, file), 'utf8');
    const route = routeFromSubpageFile(file);
    parsed.push(parsePage(html, route, file));
  }

  // Cluster sibling pages (same parent route) by template similarity to each cluster's first member.
  const groups: Array<{ parent: string; members: Parsed[] }> = [];
  for (const p of parsed) {
    const segs = p.route.split('/').filter(Boolean);
    if (segs.length < 2) continue;
    const parent = segs.slice(0, -1).join('/');
    const g = groups.find(
      (c) => c.parent === parent && templateSimilarity(c.members[0]!.layers, p.layers) >= SAME_TEMPLATE
    );
    if (g) g.members.push(p);
    else groups.push({ parent, members: [p] });
  }
  // The largest cluster under a parent claims `/<parent>/[slug]`; the stable sort keeps file order on ties.
  // A lone page is never dynamic: one page gives no evidence of a template, and without a CMS collection
  // to link it would scaffold an unbuildable route.
  groups.sort((x, y) => y.members.length - x.members.length);

  const grouped = new Set<Parsed>();
  const dynamic = new Map<Parsed, PageInfo>();
  const usedDynamicRoutes = new Set<string>();
  for (const { parent, members } of groups) {
    if (members.length < 2) continue;
    const route = `/${parent}/[slug]`;
    if (usedDynamicRoutes.has(route)) continue;
    usedDynamicRoutes.add(route);
    const first = members[0]!;
    members.forEach((m) => grouped.add(m));
    dynamic.set(first, {
      route,
      sourceFile: first.sourceFile,
      title: first.title,
      meta: first.meta,
      dynamic: {
        param: 'slug',
        collection: '',
        slugs: members.map((m) => m.route.split('/').pop()!),
        members: members.map((m) => ({ slug: m.route.split('/').pop()!, sourceFile: m.sourceFile }))
      }
    });
  }

  const pages: PageInfo[] = [];
  for (const p of parsed) {
    const dyn = dynamic.get(p);
    if (dyn) pages.push(dyn);
    else if (!grouped.has(p)) {
      const { layers: _layers, ...info } = p;
      pages.push(info);
    }
  }
  return pages;
}
