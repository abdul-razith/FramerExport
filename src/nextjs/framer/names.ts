import type { Node } from '../model.js';

export type Role = 'Image' | 'Heading' | 'Text' | 'Button' | 'List' | 'Card' | 'Group';

export const GENERIC_NAMES = [
  'Content', 'Frame', 'Text', 'Image', 'IMG', 'Container', 'Contain', 'Stack', 'Default',
  'Variant 1', 'Wrapper', 'Desktop', 'Tablet', 'Mobile',
];

const GENERIC = new Set(GENERIC_NAMES.map((n) => n.toLowerCase()));

export function isGenericName(name: string | undefined): boolean {
  return !name || GENERIC.has(name.trim().toLowerCase()) || /^(frame|variant|group|stack)\s*\d*$/i.test(name.trim());
}

function words(s: string): string[] {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

export function toPascal(s: string): string {
  const out = words(s)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('');
  if (!out) return 'X';
  return /^\d/.test(out) ? 'X' + out : out;
}

export function toCamel(s: string): string {
  const p = toPascal(s);
  return p.startsWith('X') && /^X\d/.test(p) ? 'x' + p.slice(1) : p[0].toLowerCase() + p.slice(1);
}

export function toSlug(s: string): string {
  return (
    s
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'item'
  );
}

function subtree(node: Node): Node[] {
  return [node, ...node.children.flatMap(subtree)];
}

export function roleOf(node: Node): Role {
  if (node.asset?.kind === 'image' || node.tag === 'img' || node.tag === 'picture') return 'Image';
  if (/^h[1-6]$/.test(node.tag)) return 'Heading';
  if (node.tag === 'ul' || node.tag === 'ol') return 'List';
  if ((node.tag === 'a' || node.tag === 'button') && node.children.length <= 1) return 'Button';
  if (node.text && node.children.length === 0) return 'Text';
  const all = subtree(node).slice(1);
  if (all.some((n) => n.asset?.kind === 'image') && all.some((n) => /^h[1-6]$/.test(n.tag) || n.text)) {
    return 'Card';
  }
  return 'Group';
}

/** Component name from the Framer layer name, or `<Section><Role>` when the layer name is generic. */
export function componentName(node: Node, sectionName: string): { name: string; fallback: boolean } {
  if (node.framerName && !isGenericName(node.framerName)) {
    const trimmed = node.framerName.replace(/\s+(section|container|wrapper)$/i, '');
    return { name: toPascal(trimmed || node.framerName), fallback: false };
  }
  if (!sectionName) {
    return { name: node.framerName ? toPascal(node.framerName) : 'Section', fallback: true };
  }
  return { name: sectionName + roleOf(node), fallback: true };
}

export class NameRegistry {
  private used = new Set<string>();

  has(name: string): boolean {
    return this.used.has(name);
  }

  unique(name: string): string {
    let candidate = name;
    for (let n = 2; this.used.has(candidate); n++) candidate = `${name}${n}`;
    this.used.add(candidate);
    return candidate;
  }
}
