import { pageStructure } from '../nextjs/components.js';
import type { ImageNamer } from '../nextjs/content.js';
import { fullText } from '../nextjs/framer/collections.js';
import { BREAKPOINTS, type Box, type Breakpoint, type Node, type RawNode } from '../nextjs/model.js';
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

/** Text, images and links of one section, in reading order. Link text is listed under links only. */
function collect(node: Node, args: BuildPageArgs) {
  const texts: string[] = [];
  const images: GuideImage[] = [];
  const links: { text: string; href: string }[] = [];
  const seen = new Set<string>();
  const addText = (t: string) => {
    const v = t.replace(/\s+/g, ' ').trim();
    if (v && !seen.has(v)) {
      seen.add(v);
      texts.push(v);
    }
  };
  const walk = (n: Node) => {
    if (n.tag === 'a' && n.attrs.href) {
      const text = fullText(n).replace(/\s+/g, ' ').trim();
      if (text) links.push({ text, href: siteRelative(n.attrs.href, args.origin) });
    }
    if (n.asset?.kind === 'image') {
      const alt = n.attrs.alt ?? '';
      images.push({
        exportPath: args.localAsset?.(n.asset.src) ?? n.asset.src,
        suggested: args.images.publicPath(n.asset.src, n.framerName ?? alt ?? 'image'),
        width: n.asset.width,
        height: n.asset.height,
        alt,
      });
    }
    if (n.tag === 'a') return;
    // Split text (words/letters as spans) is one value; block containers can carry `inline` too.
    if (n.inline && TEXT_TAGS.test(n.tag) && !n.children.some((c) => c.tag === 'a')) return addText(fullText(n));
    if (n.text) addText(n.text);
    n.children.forEach(walk);
  };
  walk(node);
  return { texts, images, links };
}

export function buildGuidePage(args: BuildPageArgs): GuidePage {
  let nodes = pageStructure(args.root).sections;
  if (!nodes.length) nodes = [args.root];
  const sections: GuideSection[] = nodes.map((node, i) => {
    const name = node.framerName?.trim() || `Section ${i + 1}`;
    const boxes: Partial<Record<Breakpoint, Box>> = {};
    for (const bp of BREAKPOINTS) {
      const b = args.trees[bp] && findBox(args.trees[bp], node.key);
      if (b) boxes[bp] = b;
    }
    return {
      index: i + 1,
      name,
      generic: !node.framerName || GENERIC.test(name),
      key: node.key,
      boxes,
      ...collect(node, args),
      motionKeys: [],
    };
  });
  return { route: args.route, slug: pageSlug(args.route), title: args.title, exportFile: args.exportFile, sections };
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
