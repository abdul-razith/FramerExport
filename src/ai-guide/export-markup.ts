import { parse } from 'parse5';
import prettier from 'prettier';
import { BREAKPOINTS, type Breakpoint } from '../nextjs/model.js';

/** One version of a section's export markup and the widths that show it. */
export interface MarkupCopy {
  widths: Breakpoint[];
  /** Line of the section element in the export file. */
  line: number;
  /** Cleaned, pretty-printed HTML. */
  html: string;
}

interface P5Node {
  nodeName: string;
  tagName?: string;
  value?: string;
  data?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: P5Node[];
  content?: P5Node;
  parentNode?: P5Node | null;
  sourceCodeLocation?: { startLine: number } | null;
}

/** Framer runtime attributes that say nothing about structure or style. */
const RUNTIME_ATTRS = new Set(['data-framer-appear-id', 'data-framer-component-type', 'data-framer-hydrate-v2', 'data-projection-id', 'data-framer-generated', 'data-framer-page-optimized-at']);
const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

const attr = (n: P5Node, name: string) => n.attrs?.find((a) => a.name === name)?.value;
const classList = (n: P5Node) => (attr(n, 'class') ?? '').split(/\s+/).filter(Boolean);

/** Widths at which this element itself is hidden by one of its `hidden-*` classes. */
function ownHidden(n: P5Node, hidden: Map<string, Breakpoint[]>): Set<Breakpoint> {
  return new Set(classList(n).flatMap((c) => hidden.get(c) ?? []));
}

function hiddenAt(n: P5Node, bp: Breakpoint, hidden: Map<string, Breakpoint[]>): boolean {
  for (let p: P5Node | null | undefined = n; p; p = p.parentNode) if (ownHidden(p, hidden).has(bp)) return true;
  return false;
}

/** Inline animation start states (opacity, transform, will-change) are dropped: motion is documented separately. */
function cleanStyle(style: string): string {
  return style
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d && !/^(transform|opacity|will-change)\s*:/i.test(d))
    .join(';');
}

const textOf = (n: P5Node): string => (n.nodeName === '#text' ? (n.value ?? '') : (n.childNodes ?? []).map(textOf).join(''));

/**
 * Framer splits animated text into one span per letter or word. Three or more leaf spans (only
 * whitespace between them) are one text: `letters` when every piece is ≤ 2 characters, else `words`.
 */
function splitKind(children: P5Node[]): 'letters' | 'words' | undefined {
  const els = children.filter((c) => c.tagName);
  if (els.length < 3) return undefined;
  if (children.some((c) => c.nodeName === '#text' && (c.value ?? '').trim())) return undefined;
  if (!els.every((c) => c.tagName === 'span' && !(c.childNodes ?? []).some((g) => g.tagName))) return undefined;
  const pieces = els.map((c) => textOf(c).trim());
  if (pieces.some((p) => /\s/.test(p))) return undefined;
  return pieces.every((p) => p.length <= 2) ? 'letters' : 'words';
}

const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/** The element's HTML as shown at `bp`: copies hidden there are left out, `ssr-variant` wrappers unwrapped. */
function serialize(n: P5Node, bp: Breakpoint, hidden: Map<string, Breakpoint[]>): string {
  if (n.nodeName === '#text') return escText(n.value ?? '');
  if (!n.tagName || n.nodeName === '#comment' || SKIP_TAGS.has(n.tagName)) return '';
  if (ownHidden(n, hidden).has(bp)) return '';
  const children = (n.tagName === 'template' ? n.content?.childNodes : n.childNodes) ?? [];
  const split = splitKind(children);
  const inner = split ? escText(children.map((c) => textOf(c)).join('').replace(/\s+/g, ' ').trim()) : children.map((c) => serialize(c, bp, hidden)).join('');
  if (classList(n).includes('ssr-variant')) return inner;
  const attrs = (n.attrs ?? [])
    .filter((a) => !RUNTIME_ATTRS.has(a.name))
    .map((a) => (a.name === 'style' ? { ...a, value: cleanStyle(a.value) } : a))
    .filter((a) => a.name !== 'style' || a.value)
    .map((a) => ` ${a.name}="${escAttr(a.value)}"`)
    .join('') + (split ? ` data-split="${split}"` : '');
  return VOID.has(n.tagName) ? `<${n.tagName}${attrs}>` : `<${n.tagName}${attrs}>${inner}</${n.tagName}>`;
}

function findAll(root: P5Node, test: (n: P5Node) => boolean): P5Node[] {
  const out: P5Node[] = [];
  const walk = (n: P5Node) => {
    if (n.tagName && test(n)) {
      out.push(n);
      return; // the outermost match is the section; nested matches are part of it
    }
    for (const c of (n.tagName === 'template' ? n.content?.childNodes : n.childNodes) ?? []) walk(c);
  };
  walk(root);
  return out;
}

async function pretty(html: string): Promise<string> {
  try {
    return await prettier.format(html, { parser: 'html', printWidth: 100, useTabs: true, htmlWhitespaceSensitivity: 'ignore' });
  } catch {
    return html + '\n';
  }
}

/**
 * The section's markup from the export HTML, per width. Elements are found by class (else by
 * `data-framer-name`); for each width the copy that width shows is taken (Framer writes one copy
 * per breakpoint, hidden with `hidden-*` classes) and copies that come out the same are merged.
 */
export async function sectionMarkup(
  html: string,
  target: { framerName?: string; className?: string },
  hidden: Map<string, Breakpoint[]>
): Promise<MarkupCopy[]> {
  const doc = parse(html, { sourceCodeLocationInfo: true }) as unknown as P5Node;
  let matches = target.className ? findAll(doc, (n) => classList(n).includes(target.className!)) : [];
  if (!matches.length && target.framerName) matches = findAll(doc, (n) => attr(n, 'data-framer-name') === target.framerName);
  if (!matches.length) return [];
  const byHtml = new Map<string, { widths: Breakpoint[]; line: number }>();
  for (const bp of BREAKPOINTS) {
    const el = matches.find((m) => !hiddenAt(m, bp, hidden));
    if (!el) continue;
    const out = serialize(el, bp, hidden);
    const entry = byHtml.get(out) ?? { widths: [], line: el.sourceCodeLocation?.startLine ?? 0 };
    entry.widths.push(bp);
    byHtml.set(out, entry);
  }
  const copies: MarkupCopy[] = [];
  for (const [raw, { widths, line }] of byHtml) copies.push({ widths, line, html: await pretty(raw) });
  return copies;
}

function framerClasses(html: string, test: (c: string) => boolean): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/\bclass="([^"]*)"/g)) {
    for (const c of m[1].split(/\s+/)) if (c.startsWith('framer-') && test(c) && !out.includes(c)) out.push(c);
  }
  return out;
}

/** The `framer-*` classes of a markup copy, once, in document order; `framer-text` and text presets excluded. */
export function classesIn(html: string): string[] {
  return framerClasses(html, (c) => c !== 'framer-text' && !c.startsWith('framer-styles-preset-'));
}

/** The text style presets (`framer-styles-preset-*`) a markup copy uses. */
export function presetClassesIn(html: string): string[] {
  return framerClasses(html, (c) => c.startsWith('framer-styles-preset-'));
}
