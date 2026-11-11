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
  const variants = new Map<string, string[]>();
  const addText = (t: string, n: Node, widths: Breakpoint[]) => {
    const v = norm(t);
    if (!v) return;
    items.push({ text: v, widths, key: n.key });
    const seen = Object.values(raws.get(n.key) ?? {}).map((r) => norm(r?.text ?? '')).filter(Boolean);
    if (seen.length) variants.set(n.key, seen);
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
    // Split text (words/letters as spans) is one value; block containers can carry `inline` too.
    // A word Framer split into one element per letter (spans or divs): at least 3 leaf children of ≤ 2 characters.
    const letters = n.children.length >= 3 && n.children.every((c) => !c.children.length && !c.asset && (c.text ?? '').trim().length <= 2);
    const splitText = letters || (n.inline && (TEXT_TAGS.test(n.tag) || (n.children.length > 0 && n.children.every((c) => c.tag === 'span' && !c.children.length))));
    if (splitText && !n.children.some((c) => c.tag === 'a')) return addText(fullText(n), n, widths);
    if (n.text) addText(n.text, n, widths);
    n.children.forEach((c) => walk(c, widths));
  };
  walk(node, [...BREAKPOINTS]);
  const clean = cleanTexts(items, variants);
  for (const t of clean.texts) addWidths(t.text, t.widths);
  return { texts: clean.texts.map((t) => t.text), images, links, widthsOf, generated: clean.generated, liveKeys: clean.liveKeys, decorations: clean.decorations };
}

/** The element's own Framer class: the first `framer-*` that is not a text, preset or variant class. */
function ownClass(n: Node): string | undefined {
  return (n.attrs.class ?? '').split(/\s+/).find((c) => /^framer-[a-z0-9]+$/i.test(c) && c !== 'framer-text' && !/^framer-v-/.test(c));
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
