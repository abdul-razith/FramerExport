import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  collectionIdFromFile,
  decodeChunk,
  type CmsItem,
  type CmsValue,
} from '../adapters/framer/framercms.js';
import type { StageContext } from '../adapters/types.js';
import { saveState } from '../state.js';
import type { PageInfo } from '../types.js';

const SYSTEM_FIELDS = new Set(['id', 'createdAt', 'updatedAt', 'nextItemId', 'previousItemId']);
const GENERIC_NAMES =
  /^(content|default|frame|container|contain|text|image|img|border|desktop|tablet|mobile|desktop \+ tablet|tablet \+ mobile|variant \d+|all content|smooth scroll|main|wrapper|section)$/i;
const VOID_TAGS = new Set(['br', 'img', 'hr', 'meta', 'link', 'input', 'source', 'wbr', 'col']);

// ---------------------------------------------------------------- rich text

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;');
}

export function richTextToHtml(node: unknown): string {
  if (typeof node === 'string') return escapeText(node);
  if (!Array.isArray(node)) return '';
  const [kind, ...rest] = node as unknown[];
  if (kind === 1) return rest.map(richTextToHtml).join('');
  if (kind === 5) return escapeText(String(rest[0] ?? ''));
  if (kind === 4) {
    const tag = String(rest[0] ?? '');
    if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(tag)) return '';
    const attrsRaw = rest[1];
    let attrs = '';
    if (attrsRaw && typeof attrsRaw === 'object' && !Array.isArray(attrsRaw)) {
      for (const [k, v] of Object.entries(attrsRaw as Record<string, unknown>)) {
        if (v === undefined || v === null || v === false) continue;
        const name = k === 'className' ? 'class' : k === 'htmlFor' ? 'for' : k;
        if (!/^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/.test(name)) continue;
        attrs += v === true ? ` ${name}` : ` ${name}="${escapeAttr(String(v))}"`;
      }
    }
    if (VOID_TAGS.has(tag)) return `<${tag}${attrs}>`;
    return `<${tag}${attrs}>${rest.slice(2).map(richTextToHtml).join('')}</${tag}>`;
  }
  return '';
}

function richTextLeaves(node: unknown, out: string[] = []): string[] {
  if (!Array.isArray(node)) return out;
  const [kind, ...rest] = node as unknown[];
  if (kind === 5) {
    const t = String(rest[0] ?? '');
    if (t.trim()) out.push(t);
  } else if (kind === 1) {
    for (const c of rest) richTextLeaves(c, out);
  } else if (kind === 4) {
    for (const c of rest.slice(2)) richTextLeaves(c, out);
  }
  return out;
}

// ------------------------------------------------------------ rendered page

interface PageEl {
  tag: string;
  name?: string;
  parent: PageEl | null;
  text: string;
  hasMatchingChild?: boolean;
}
interface ParsedPage {
  els: PageEl[];
  h1: string;
  titleTag: string;
  text: string;
}

function norm(s: string): string {
  return s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function parsePage(html: string): ParsedPage {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const titleTag = titleMatch ? norm(decodeEntities(titleMatch[1] ?? '')) : '';
  let body = html.slice(Math.max(0, html.search(/<body/i)));
  body = body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  const els: PageEl[] = [];
  const stack: PageEl[] = [];
  let all = '';
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    if (m[4] !== undefined) {
      const t = decodeEntities(m[4]);
      all += t;
      for (const el of stack) el.text += t;
      continue;
    }
    const closing = m[1] === '/';
    const tag = (m[2] ?? '').toLowerCase();
    if (closing) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i]!.tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    if (VOID_TAGS.has(tag) || (m[3] ?? '').trimEnd().endsWith('/')) continue;
    const nm = /data-framer-name\s*=\s*"([^"]*)"/.exec(m[3] ?? '');
    const el: PageEl = {
      tag,
      name: nm ? decodeEntities(nm[1] ?? '') : undefined,
      parent: stack[stack.length - 1] ?? null,
      text: '',
    };
    els.push(el);
    stack.push(el);
  }
  const h1 = els.find((e) => e.tag === 'h1');
  return { els, h1: h1 ? norm(h1.text) : '', titleTag, text: norm(all) };
}

export function camelCase(s: string): string {
  const words = s.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!words.length) return '';
  return words
    .map((w, i) => (i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1)))
    .join('');
}
function pascalCase(s: string): string {
  const c = camelCase(s);
  return c.charAt(0).toUpperCase() + c.slice(1);
}
function safeIdent(s: string): string {
  let id = s.replace(/[^A-Za-z0-9_$]/g, '_');
  if (!id) id = '_';
  if (/^[0-9]/.test(id)) id = `f_${id}`;
  return id;
}

function dateCandidates(ms: number): string[] {
  const out = new Set<string>();
  const d = new Date(ms);
  for (const timeZone of ['UTC', undefined]) {
    for (const month of ['short', 'long'] as const) {
      for (const day of ['numeric', '2-digit'] as const) {
        out.add(
          norm(d.toLocaleDateString('en-US', { month, day, year: 'numeric', ...(timeZone ? { timeZone } : {}) })),
        );
      }
    }
  }
  return [...out];
}

function isImage(v: CmsValue): v is Extract<CmsValue, { type: 'json' }> {
  return (
    v.type === 'json' &&
    !!v.value &&
    typeof v.value === 'object' &&
    typeof (v.value as { src?: unknown }).src === 'string'
  );
}

export function findSlugField(items: CmsItem[], slugs: string[]): string | null {
  if (!slugs.length) return null;
  const counts = new Map<string, Set<string>>();
  for (const item of items) {
    for (const [key, v] of Object.entries(item.fields)) {
      if (SYSTEM_FIELDS.has(key) || v.type !== 'string') continue;
      if (slugs.includes(v.value)) {
        if (!counts.has(key)) counts.set(key, new Set());
        counts.get(key)!.add(v.value);
      }
    }
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [key, set] of counts) {
    if (set.size > bestN) {
      best = key;
      bestN = set.size;
    }
  }
  return bestN === slugs.length ? best : null;
}

// ------------------------------------------------------------------ naming

export function nameFields(
  items: CmsItem[],
  renderedBySlug: Map<string, string>,
): { names: Record<string, string>; unmatched: string[] } {
  const names: Record<string, string> = {};
  const taken = new Set<string>();
  const assign = (id: string, base: string): void => {
    if (names[id]) return;
    let name = safeIdent(base);
    for (let n = 2; taken.has(name); n++) name = `${safeIdent(base)}${n}`;
    taken.add(name);
    names[id] = name;
  };

  const fieldOrder: string[] = [];
  for (const item of items) {
    for (const k of Object.keys(item.fields)) {
      if (!SYSTEM_FIELDS.has(k) && !fieldOrder.includes(k)) fieldOrder.push(k);
    }
  }

  const slugField = findSlugField(items, [...renderedBySlug.keys()]);
  if (slugField) assign(slugField, 'slug');

  // images do not need a rendered page
  let imageN = 0;
  for (const k of fieldOrder) {
    if (names[k]) continue;
    if (items.some((it) => it.fields[k] && isImage(it.fields[k]!))) {
      imageN++;
      assign(k, imageN === 1 ? 'cover' : `image${imageN}`);
    }
  }

  const pages: Array<{ item: CmsItem; page: ParsedPage }> = [];
  if (slugField) {
    for (const item of items) {
      const sv = item.fields[slugField];
      const html = sv?.type === 'string' ? renderedBySlug.get(sv.value) : undefined;
      if (html !== undefined) pages.push({ item, page: parsePage(html) });
    }
  }

  let titleAssigned = false;
  for (const k of fieldOrder) {
    if (names[k]) continue;
    for (const { item, page } of pages) {
      const v = item.fields[k];
      if (!v) continue;
      if (v.type === 'string') {
        const val = norm(v.value);
        if (!val) continue;
        if (!titleAssigned && (val === page.h1 || (!page.h1 && (page.titleTag === val || page.titleTag.startsWith(`${val} - `))))) {
          assign(k, 'title');
          titleAssigned = true;
          break;
        }
        const matches = page.els.filter((e) => norm(e.text) === val);
        const leaf = matches.find((e) => !matches.some((o) => o.parent === e || isAncestor(e, o)));
        const start = leaf ?? matches[0];
        let cur: PageEl | null = start ?? null;
        let found = '';
        while (cur) {
          if (cur.name && !GENERIC_NAMES.test(cur.name.trim())) {
            found = camelCase(cur.name);
            break;
          }
          cur = cur.parent;
        }
        if (found) {
          assign(k, found);
          break;
        }
      } else if (v.type === 'date') {
        if (dateCandidates(v.value).some((c) => page.text.includes(c))) {
          assign(k, 'date');
          break;
        }
      } else if (v.type === 'richtext') {
        const leaves = richTextLeaves(v.value).map(norm);
        if (leaves.length) {
          const hit = leaves.filter((l) => page.text.includes(l)).length;
          if (hit / leaves.length >= 0.5) {
            assign(k, 'body');
            break;
          }
        }
      }
    }
  }

  const unmatched = fieldOrder.filter((k) => !names[k]);
  return { names, unmatched };
}

function isAncestor(anc: PageEl, el: PageEl): boolean {
  for (let p = el.parent; p; p = p.parent) if (p === anc) return true;
  return false;
}

// -------------------------------------------------------------------- stage

async function writeAtomic(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  try {
    await writeFile(tmp, content, 'utf8');
    await rename(tmp, file);
  } finally {
    await rm(tmp, { force: true });
  }
}

async function readIfExists(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}

interface Collection {
  id: string;
  items: CmsItem[];
}

async function loadCollections(ctx: StageContext): Promise<Collection[]> {
  const dataDir = path.join(ctx.exportDir, 'data');
  let files: string[] = [];
  try {
    files = (await readdir(dataDir)).filter((f) => /-chunk-.*\.framercms$/.test(f));
  } catch {
    return [];
  }
  const isBase = (f: string): boolean => /-chunk-[^-]+-\d+\.framercms$/.test(f);
  files.sort((a, b) => Number(isBase(b)) - Number(isBase(a)) || (a < b ? -1 : a > b ? 1 : 0));
  const byId = new Map<string, Collection>();
  for (const f of files) {
    const id = collectionIdFromFile(f);
    const col = byId.get(id) ?? { id, items: [] };
    byId.set(id, col);
    let decoded;
    try {
      decoded = decodeChunk(await readFile(path.join(dataDir, f)));
    } catch (err) {
      ctx.state.warnings.push(`extract-cms: could not read ${f}: ${(err as Error).message}`);
      continue;
    }
    for (const e of decoded.errors) {
      ctx.state.warnings.push(
        `extract-cms: ${f}: ${e.reason} at offset ${e.offset}${e.key ? ` (field ${e.key})` : ''}`,
      );
    }
    for (const item of decoded.items) {
      if (item.id && col.items.some((o) => o.id === item.id)) continue;
      col.items.push(item);
    }
  }
  return [...byId.values()];
}

function emitValue(v: unknown, indent: string): string {
  const nl = String.fromCharCode(10);
  const inner = indent + '  ';
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    return '[' + nl + v.map((x) => inner + emitValue(x, inner)).join(',' + nl) + nl + indent + ']';
  }
  if (v && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
    if (!entries.length) return '{}';
    const lines = entries.map(([k, x]) => {
      const key = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : JSON.stringify(k);
      return inner + key + ': ' + emitValue(x, inner);
    });
    return '{' + nl + lines.join(',' + nl) + nl + indent + '}';
  }
  return JSON.stringify(v) ?? 'null';
}

export async function runExtractCms(ctx: StageContext): Promise<void> {
  const warnings = ctx.state.warnings;
  const pagesFile = path.join(ctx.nextDir, '.convert', 'analysis', 'pages.json');
  let pages: PageInfo[] = [];
  try {
    pages = JSON.parse((await readIfExists(pagesFile)) ?? '[]') as PageInfo[];
  } catch {
    warnings.push('extract-cms: could not parse pages.json');
  }

  let imageFiles: string[] = [];
  try {
    imageFiles = await readdir(path.join(ctx.exportDir, 'assets', 'images'));
  } catch {}
  const imageSet = new Set(imageFiles);
  const warnedImages = new Set<string>();
  const mapImage = (url: string): string => {
    let base = '';
    try {
      base = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
    } catch {
      base = url.split('?')[0]!.split('/').pop() ?? '';
    }
    if (base && imageSet.has(base)) return `/images/${base}`;
    if (!warnedImages.has(url)) {
      warnedImages.add(url);
      warnings.push(`extract-cms: no local asset for image ${url}; kept original URL`);
    }
    return url;
  };

  const usedNames = new Set<string>();
  const collections = await loadCollections(ctx);
  for (const col of collections) {
    if (!col.items.length) continue;

    // link to a dynamic route
    let page: PageInfo | undefined;
    let slugField: string | null = null;
    for (const p of pages) {
      if (!p.dynamic || p.dynamic.collection) continue;
      const f = findSlugField(col.items, p.dynamic.slugs);
      if (f) {
        page = p;
        slugField = f;
        break;
      }
    }
    const parent = page ? page.route.replace(/\/\[[^\]]+\]$/, '').replace(/^\//, '') : '';
    let name = parent ? camelCase(parent) : '';
    if (!name || usedNames.has(name)) name = safeIdent(col.id.replace(/^([0-9])/, 'c$1'));
    if (/^[0-9]/.test(name)) name = `c${name}`;
    usedNames.add(name);
    if (page?.dynamic) page.dynamic.collection = name;

    const rendered = new Map<string, string>();
    if (page?.dynamic) {
      for (const slug of page.dynamic.slugs) {
        const candidates = [path.join('subpages', `${parent.split('/').join('_')}_${slug}.html`)];
        if (slug === page.dynamic.slugs[0]) candidates.push(page.sourceFile);
        for (const rel of candidates) {
          const html = await readIfExists(path.join(ctx.exportDir, rel));
          if (html !== undefined) {
            rendered.set(slug, html);
            break;
          }
        }
      }
    }

    const { names, unmatched } = nameFields(col.items, rendered);

    // items lost to decode errors: recover slug/title from rendered pages
    if (page?.dynamic && slugField) {
      const have = new Set(
        col.items.map((i) => i.fields[slugField!]).filter((v) => v?.type === 'string').map((v) => (v as { value: string }).value),
      );
      const titleId = Object.keys(names).find((k) => names[k] === 'title');
      for (const slug of page.dynamic.slugs) {
        if (have.has(slug)) continue;
        const fields: Record<string, CmsValue> = { [slugField]: { type: 'string', value: slug } };
        const html = rendered.get(slug);
        if (html && titleId) {
          const p = parsePage(html);
          const t = p.h1 || p.titleTag.split(' - ')[0] || '';
          if (t) fields[titleId] = { type: 'string', value: t };
        }
        col.items.push({ id: '', fields });
        warnings.push(`extract-cms: item "${slug}" missing from decoded data; scraped from rendered page`);
      }
    }

    // final keys
    const fieldOrder: string[] = [];
    for (const item of col.items) {
      for (const k of Object.keys(item.fields)) {
        if (!SYSTEM_FIELDS.has(k) && !fieldOrder.includes(k)) fieldOrder.push(k);
      }
    }
    const keyOf: Record<string, string> = {};
    const takenKeys = new Set(Object.values(names));
    for (const k of fieldOrder) {
      if (names[k]) {
        keyOf[k] = names[k]!;
        continue;
      }
      const base = safeIdent(k);
      let key = base;
      for (let n = 2; takenKeys.has(key); n++) key = `${base}${n}`;
      takenKeys.add(key);
      keyOf[k] = key;
    }

    const typeNames = new Map<string, Set<string>>();
    let usesImage = false;
    const rows = col.items.map((item) => {
      const row: Record<string, unknown> = {};
      for (const k of fieldOrder) {
        const v = item.fields[k];
        if (!v) continue;
        let out: unknown;
        let t: string;
        switch (v.type) {
          case 'string':
            out = v.value;
            t = 'string';
            break;
          case 'date':
            out = new Date(v.value).toISOString();
            t = 'string';
            break;
          case 'richtext':
            out = richTextToHtml(v.value);
            t = 'string';
            break;
          case 'boolean':
            out = v.value;
            t = 'boolean';
            break;
          case 'number':
            out = v.value;
            t = 'number';
            break;
          default:
            if (isImage(v)) {
              const j = v.value as { src: string; alt?: unknown; pixelWidth?: unknown; pixelHeight?: unknown };
              const img: Record<string, unknown> = { src: mapImage(j.src) };
              if (typeof j.alt === 'string') img.alt = j.alt;
              if (typeof j.pixelWidth === 'number') img.width = j.pixelWidth;
              if (typeof j.pixelHeight === 'number') img.height = j.pixelHeight;
              out = img;
              t = 'CmsImage';
              usesImage = true;
            } else {
              out = (v as { value: unknown }).value;
              t = 'unknown';
            }
        }
        row[keyOf[k]!] = out;
        if (!typeNames.has(k)) typeNames.set(k, new Set());
        typeNames.get(k)!.add(t);
      }
      return row;
    });

    const typeName = pascalCase(name);
    const lines: string[] = [];
    if (usesImage) {
      lines.push(
        'export interface CmsImage {',
        '  src: string;',
        '  alt?: string;',
        '  width?: number;',
        '  height?: number;',
        '}',
        '',
      );
    }
    lines.push(`export interface ${typeName} {`);
    for (const k of fieldOrder) {
      const optional = col.items.some((i) => !i.fields[k]);
      lines.push(`  ${keyOf[k]}${optional ? '?' : ''}: ${[...(typeNames.get(k) ?? ['unknown'])].join(' | ')};`);
    }
    lines.push('}', '', `export const ${name}: ${typeName}[] = ${emitValue(rows, '')};`, '');
    await writeAtomic(path.join(ctx.nextDir, 'src', 'content', `${name}.ts`), lines.join('\n'));

    if (unmatched.length) {
      warnings.push(`extract-cms: ${name}: unmatched fields kept as Framer ids: ${unmatched.join(', ')}`);
    }
    ctx.log(`extract-cms: ${name}: ${rows.length} items`);
  }

  await writeAtomic(pagesFile, JSON.stringify(pages, null, 2) + '\n');
  ctx.state.stages['extract-cms'] = 'done';
  await saveState(ctx.state);
  ctx.log('extract-cms complete');
}
