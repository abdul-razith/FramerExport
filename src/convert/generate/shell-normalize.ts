/**
 * Masking helpers for shell detection: per-instance noise (random ids and the references to them, Framer
 * variant / container hashes) is replaced by stable placeholders so two instances of the same section compare equal.
 */

/** Per-element noise attributes that are masked (or dropped) when comparing instances; values are reported as differences. */
export interface ElementNoise {
  ordinal: number;
  tag: string;
  href?: string;
  attrs: Record<string, string>;
}

const ID_ATTR = /(?<![\w-])id\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*"([^"]*)"\s*\}|\{\s*'([^']*)'\s*\})/g;

/** `id` attribute values in order of first appearance, mapped to `__ID_<n>__`. */
export function collectIdMap(jsx: string): Map<string, string> {
  const ids = new Map<string, string>();
  for (const m of jsx.matchAll(ID_ATTR)) {
    const id = m[1] ?? m[2] ?? m[3] ?? m[4] ?? '';
    if (id && !ids.has(id)) ids.set(id, `__ID_${ids.size + 1}__`);
  }
  return ids;
}

/** Rewrites `url(#id)` references and a whole-value `#id` (also inside quotes) to the placeholder of a known id. */
export function maskIdRefs(raw: string, ids: Map<string, string>): string {
  if (ids.size === 0) return raw;
  let out = raw.replace(/url\(\s*(['"\\]*)#([^)'"\\\s]+)/g, (m, q: string, id: string) =>
    ids.has(id) ? `url(${q}#${ids.get(id)}` : m,
  );
  out = out.replace(/(^|["'{\s])#([^"'}\s]+)(?=["'}\s]|$)/g, (m, pre: string, id: string) =>
    ids.has(id) ? `${pre}#${ids.get(id)}` : m,
  );
  return out;
}

/** Rewrites whitespace separated id references (`aria-labelledby`, `htmlFor`, ...) to the placeholders of known ids. */
export function maskIdTokens(raw: string, ids: Map<string, string>): string {
  if (ids.size === 0) return raw;
  return raw.replace(/[^\s"'{}]+/g, (t) => ids.get(t) ?? t);
}

const VARIANT_CLASS = /\bframer-v-[A-Za-z0-9_-]+/g;
const CONTAINER_CLASS = /\bframer-(?!v-)[a-z0-9]+-container\b/g;

/** Masks Framer variant (`framer-v-<hash>`) and component container (`framer-<hash>-container`) class tokens. */
export function maskFramerClasses(raw: string): { masked: string; tokens: string[] } {
  const tokens = [...(raw.match(VARIANT_CLASS) ?? []), ...(raw.match(CONTAINER_CLASS) ?? [])];
  const masked = raw.replace(VARIANT_CLASS, 'framer-v-__V__').replace(CONTAINER_CLASS, 'framer-__C__-container');
  return { masked, tokens };
}

const short = (s: string): string => (s.length > 48 ? `${s.slice(0, 45)}...` : s);

/** One readable line per element whose noise attributes differ from the first page's instance. */
export function describeNoiseDiffs(route: string, base: ElementNoise[], inst: ElementNoise[]): string[] {
  const baseBy = new Map(base.map((n) => [n.ordinal, n]));
  const instBy = new Map(inst.map((n) => [n.ordinal, n]));
  const ordinals = [...new Set([...baseBy.keys(), ...instBy.keys()])].sort((a, b) => a - b);
  const lines: string[] = [];
  for (const ord of ordinals) {
    const b = baseBy.get(ord);
    const i = instBy.get(ord);
    const parts: string[] = [];
    for (const attr of new Set([...Object.keys(b?.attrs ?? {}), ...Object.keys(i?.attrs ?? {})])) {
      const bv = b?.attrs[attr];
      const iv = i?.attrs[attr];
      if (bv === iv) continue;
      parts.push(`${attr} ${iv === undefined ? 'absent' : `"${short(iv)}"`} (first page: ${bv === undefined ? 'absent' : `"${short(bv)}"`})`);
    }
    if (parts.length === 0) continue;
    const el = i ?? b!;
    lines.push(`${route}: <${el.tag}${el.href ? ` href="${short(el.href)}"` : ''}> ${parts.join('; ')}`);
  }
  return lines;
}
