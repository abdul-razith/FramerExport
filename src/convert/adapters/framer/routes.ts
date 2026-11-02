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

/** Hash of the tag / data-framer-name skeleton of #main (text and other attributes ignored). */
export function structureSignature(html: string): string {
  let start = -1;
  rewriteHtmlTags(html, (tag) => {
    if (start < 0 && /\sid\s*=\s*["']?main["'\s>]/i.test(tag)) start = html.indexOf(tag);
    return tag;
  });
  const skeleton: string[] = [];
  rewriteHtmlTags(
    start < 0 ? html : html.slice(start),
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

interface Parsed extends PageInfo {
  signature: string;
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
  return { route, sourceFile, title, meta, signature: structureSignature(html) };
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

  const routes = new Set(parsed.map((p) => p.route));
  const groups = new Map<string, Parsed[]>();
  for (const p of parsed) {
    const segs = p.route.split('/').filter(Boolean);
    if (segs.length < 2) continue;
    const key = `${segs.slice(0, -1).join('/')}\u0000${p.signature}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(p);
  }

  const grouped = new Set<Parsed>();
  const dynamic = new Map<Parsed, PageInfo>();
  const usedDynamicRoutes = new Set<string>();
  for (const [key, members] of groups) {
    const parent = key.split('\u0000')[0]!;
    if (members.length < 2 && !routes.has('/' + parent)) continue;
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
        slugs: members.map((m) => m.route.split('/').pop()!)
      }
    });
  }

  const pages: PageInfo[] = [];
  for (const p of parsed) {
    const dyn = dynamic.get(p);
    if (dyn) pages.push(dyn);
    else if (!grouped.has(p)) {
      const { signature: _sig, ...info } = p;
      pages.push(info);
    }
  }
  return pages;
}
