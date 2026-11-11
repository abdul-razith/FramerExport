import { pageStructure } from '../nextjs/components.js';
import type { ImageNamer } from '../nextjs/content.js';
import { fullText } from '../nextjs/framer/collections.js';
import { BREAKPOINTS, type Box, type Breakpoint, type Node, type RawNode } from '../nextjs/model.js';
import type { SplitPart } from './split.js';
import { cleanTexts, type TextItem } from './text-clean.js';
import { pageSlug, type GuideImage, type GuidePage, type GuideSection } from './types.js';

export interface BuildPageArgs {
  route: string;
  title: string;
  exportFile: string;
  root: Node;
  trees: Record<Breakpoint, RawNode>;
  images: ImageNamer;
  origin: string;
  /** Maps an image URL to its file in the export (`assets/images/...`); default: the URL itself. */
  localAsset?: (src: string) => string | undefined;
}

const TEXT_TAGS = /^(p|h[1-6]|span|label|li|blockquote)$/;
const GENERIC =/^(frame|section|stack|container|div|wrapper|group)\s*\d*$/i;

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section';
}

/** `01-hero-section`: the file stem of a section's screenshots and outline anchor. */
export function sectionStem(s: GuideSection): string {
  return `${String(s.index).padStart(2, '0')}-${slugify(s.name)}`;
}

function findBox(tree: RawNode, key: string): Box | undefined {
  if (tree.key === key) return tree.box;
  for (const c of tree.children) {
    const b = findBox(c, key);
    if (b) return b;
  }
  return undefined;
}

function siteRelative(href: string, origin: string): string {
  try {
    const u = new URL(href, origin);
    return u.origin === origin ? u.pathname.replace(/\/+$/, '') + u.search + u.hash || '/' : u.href;
  } catch {
    return href;
  }
}

/** Every raw node by key, per width (to see what each capture showed). */
function rawIndex(trees: Record<Breakpoint, RawNode>): Map<string, Partial<Record<Breakpoint, RawNode>>> {
  const out = new Map<string, Partial<Record<Breakpoint, RawNode>>>();
  for (const bp of BREAKPOINTS) {
    const walk = (r: RawNode) => {
      const e = out.get(r.key) ?? {};
      e[bp] = r;
      out.set(r.key, e);
      r.children.forEach(walk);
    };
    if (trees[bp]) walk(trees[bp]);
  }
  return out;
}

const norm = (t: string) => t.replace(/\s+/g, ' ').trim();

/** Text, images and links of one section, in reading order, with the widths that show them. Link text is listed under links only. */
function collect(node: Node, args: BuildPageArgs, raws: Map<string, Partial<Record<Breakpoint, RawNode>>>) {
  const items: TextItem[] = [];
  const images: GuideImage[] = [];
  const links: { text: string; href: string }[] = [];
  const widthsOf: Record<string, Breakpoint[]> = {};
  const addWidths = (key: string, widths: Breakpoint[]) => {
    widthsOf[key] = BREAKPOINTS.filter((bp) => widthsOf[key]?.includes(bp) || widths.includes(bp));
  };
  const walk = (n: Node, inherited: Breakpoint[]) => {
    const widths = n.visibility ? inherited.filter((bp) => n.visibility!.includes(bp)) : inherited;
    if (!widths.length) return;
    if (n.tag === 'a' && n.attrs.href) {
      const text = norm(fullText(n));
      const href = siteRelative(n.attrs.href, args.origin);
      if (text && !links.some((l) => l.text === text && l.href === href)) links.push({ text, href });
      if (text) addWidths(href, widths);
    }
    if (n.asset?.kind === 'image') {
      const alt = n.attrs.alt ?? '';
      const exportPath = args.localAsset?.(n.asset.src) ?? n.asset.src;
      addWidths(exportPath, widths);
      if (images.some((i) => i.exportPath === exportPath)) return;
      images.push({
        exportPath,
        suggested: args.images.publicPath(n.asset.src, n.framerName ?? alt ?? 'image'),
        width: n.asset.width,
        height: n.asset.height,
        alt,
      });
    }
    if (n.tag === 'a') return;
    n.children.forEach((c) => walk(c, widths));
  };
  walk(node, [...BREAKPOINTS]);

  // Texts come from each width's own capture: Framer's per-width copies can differ in text, and the
  // merged tree keeps only one of them.
  const variants = new Map<string, string[]>();
  for (const bp of BREAKPOINTS) {
    const raw = raws.get(node.key)?.[bp];
    if (raw) rawTexts(raw, bp, items, variants);
  }
  if (!raws.has(node.key)) mergedTexts(node, [...BREAKPOINTS], items);
  const clean = cleanTexts(items, variants);
  for (const t of clean.texts) addWidths(t.text, t.widths);
  return { texts: clean.texts.map((t) => t.text), images, links, widthsOf, generated: clean.generated, liveKeys: clean.liveKeys, decorations: clean.decorations };
}

/** A raw node's text in reading order (inline content keeps text and child order). */
function rawFullText(r: RawNode): string {
  if (r.inline) return r.inline.map((x) => (typeof x === 'string' ? x : r.children[x] ? rawFullText(r.children[x]) : '')).join('');
  return (r.text ?? '') + r.children.map(rawFullText).join('');
}

/**
 * Visible texts of one capture, in reading order. Text Framer split into one span per letter or word
 * is one value; numbers are kept apart (rulers and scales are recognised later). Link text is
 * listed under links only.
 */
function rawTexts(r: RawNode, bp: Breakpoint, items: TextItem[], variants: Map<string, string[]>): void {
  if (r.visible === false || r.tag === 'a') return;
  const add = (t: string) => {
    const v = norm(t);
    if (!v) return;
    items.push({ text: v, widths: [bp], key: r.key });
    variants.set(r.key, [...(variants.get(r.key) ?? []), v]);
  };
  const kids = r.children.filter((c) => c.visible !== false);
  const leaf = (c: RawNode) => !c.children.length && c.tag !== 'img' && c.tag !== 'svg';
  const numeric = kids.length > 0 && kids.every((c) => /^\s*-?\d+(\.\d+)?\s*$/.test(c.text ?? ''));
  const letters = kids.length >= 3 && kids.every((c) => leaf(c) && (c.text ?? '').trim().length <= 2);
  const split = !numeric && (letters || (r.inline && (TEXT_TAGS.test(r.tag) || (kids.length > 0 && kids.every((c) => c.tag === 'span' && leaf(c))))));
  if (split && !kids.some((c) => c.tag === 'a')) return add(rawFullText(r));
  if (r.text) add(r.text);
  for (const c of kids) rawTexts(c, bp, items, variants);
}

/** Fallback when a node is not in the captures: texts of the merged tree, with its visibility as widths. */
function mergedTexts(n: Node, inherited: Breakpoint[], items: TextItem[]): void {
  const widths = n.visibility ? inherited.filter((bp) => n.visibility!.includes(bp)) : inherited;
  if (!widths.length || n.tag === 'a') return;
  if (n.text && norm(n.text)) items.push({ text: norm(n.text), widths, key: n.key });
  for (const c of n.children) mergedTexts(c, widths, items);
}

/** The element's own Framer class: the first `framer-*` that is not a text, preset or variant class. */
function ownClass(n: Node): string | undefined {
  return (n.attrs.class ?? '').split(/\s+/).find((c) => /^framer-[a-z0-9]+(-container)?$/i.test(c) && c !== 'framer-text' && !/^framer-v-/.test(c));
}

export function buildGuidePage(args: BuildPageArgs & { parts?: SplitPart[]; shellParts?: SplitPart[] }): GuidePage {
  const raws = rawIndex(args.trees);
  const toSection = (part: SplitPart, i: number, shell: boolean): GuideSection => {
    const node = part.node;
    const name = part.name.trim() || `Section ${i + 1}`;
    const boxes: Partial<Record<Breakpoint, Box>> = {};
    for (const bp of BREAKPOINTS) {
      const b = args.trees[bp] && findBox(args.trees[bp], node.key);
      if (b) boxes[bp] = b;
    }
    return {
      index: i + 1,
      id: shell ? `S${i + 1}` : String(i + 1).padStart(2, '0'),
      name,
      generic: !node.framerName || GENERIC.test(node.framerName.trim()),
      key: node.key,
      className: ownClass(node),
      framerName: node.framerName?.trim() || undefined,
      ...(part.parent ? { parent: part.parent } : {}),
      ...(shell ? { shell: true } : {}),
      boxes,
      ...collect(node, args, raws),
      motionKeys: [],
    };
  };
  let parts = args.parts;
  if (!parts) {
    const nodes = pageStructure(args.root).sections;
    parts = (nodes.length ? nodes : [args.root]).map((node, i) => ({ node, name: node.framerName?.trim() || `Section ${i + 1}` }));
  }
  const page: GuidePage = {
    route: args.route,
    slug: pageSlug(args.route),
    title: args.title,
    exportFile: args.exportFile,
    sections: parts.map((p, i) => toSection(p, i, false)),
  };
  if (args.shellParts) page.shell = args.shellParts.map((p, i) => toSection(p, i, true));
  return page;
}

const size = (b?: Box) => (b ? `${Math.round(b.w)}×${Math.round(b.h)}` : '?');

export function renderOutline(page: GuidePage): string {
  const out = [
    `# ${page.title} — ${page.route}`,
    '',
    `Export file: ${page.exportFile}. Full-page screenshots: desktop.png, tablet.png, mobile.png. Animations: motion.md.`,
    '',
  ];
  for (const s of page.sections) {
    out.push(`## ${sectionStem(s).slice(0, 2)} ${s.name} — ${size(s.boxes.base)} (tablet ${size(s.boxes.tablet)}, mobile ${size(s.boxes.mobile)})`);
    if (s.generic) out.push('name: the Framer layer name is generic — choose a meaningful component name');
    out.push(`screenshot: sections/${sectionStem(s)}-{desktop,tablet,mobile}.png`);
    if (s.texts.length) out.push(`text: ${s.texts.map((t) => `"${t}"`).join(' · ')}`);
    if (s.images.length) out.push(`images: ${s.images.map((i) => `${i.exportPath} → ${i.suggested} (${i.width}×${i.height}${i.alt ? `, alt "${i.alt}"` : ''})`).join(' · ')}`);
    if (s.links.length) out.push(`links: ${s.links.map((l) => `"${l.text}" → ${l.href}`).join(' · ')}`);
    out.push(`export markup: ${page.exportFile}${s.generic ? '' : `, element data-framer-name="${s.name}"`}`);
    out.push('');
  }
  return out.join('\n');
}
