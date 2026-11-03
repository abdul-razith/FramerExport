import type { Page } from 'puppeteer';
import { pairByName } from './diff.js';

export interface SectionDom {
  name: string;
  text: string;
  links: string[];
  images: string[];
}

export interface DomMismatch {
  section: string;
  kind: 'text' | 'link' | 'image';
  expected: string;
  actual: string;
}

/** Name + selector pairs for every `[data-section]` element on a Next page (names are CSS-string-escaped). */
export async function nextSections(page: Page): Promise<Array<{ name: string; selector: string }>> {
  const names = (await page.evaluate(
    `Array.from(document.querySelectorAll('[data-section]')).map((el) => el.getAttribute('data-section') || '')`
  )) as string[];
  return names.map((name) => ({
    name,
    selector: `[data-section="${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`
  }));
}

/** Rendered text (innerText), `a[href]` hrefs and `img` currentSrc/src per section. Missing sections yield empty entries. */
export async function extractSectionDom(
  page: Page,
  sections: Array<{ name: string; selector: string }>
): Promise<SectionDom[]> {
  return (await page.evaluate(
    `((sections) => sections.map((s) => {
      let el = null;
      try { el = document.querySelector(s.selector); } catch (e) {}
      if (!el) return { name: s.name, text: '', links: [], images: [] };
      return {
        name: s.name,
        text: el.innerText || '',
        links: Array.from(el.querySelectorAll('a[href]')).map((a) => a.getAttribute('href') || ''),
        images: Array.from(el.querySelectorAll('img')).map((i) => i.currentSrc || i.src || '')
      };
    }))(${JSON.stringify(sections)})`
  )) as SectionDom[];
}

const normText = (s: string): string => s.replace(/\s+/g, ' ').trim();
const basename = (p: string): string => p.slice(p.lastIndexOf('/') + 1);
const isAbsolute = (u: string): boolean => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(u);

/** Strip http(s) origin, query/hash, leading `./`, `../` and `/` from an export-side URL. */
function exportRelative(url: string): string {
  const p = url.replace(/^https?:\/\/[^/]+/i, '').split(/[?#]/)[0];
  return p.replace(/^(?:\.{1,2}\/)+/, '').replace(/^\/+/, '');
}

function normalizeExportLink(url: string, routes: Record<string, string>): string {
  if (url.startsWith('#')) return url;
  // Only http(s) URLs on the live export origin are internal; other absolute URLs compare as-is.
  if (isAbsolute(url) && !/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//i.test(url)) return url;
  const hash = url.includes('#') ? url.slice(url.indexOf('#')) : '';
  const rel = exportRelative(url);
  if (rel in routes) return routes[rel] + hash;
  // After hydration the Framer runtime rewrites page links to extensionless form (`./about`, `./`).
  const route = rel ? '/' + rel.replace(/\.html$/, '') : '/';
  return Object.values(routes).includes(route) ? route + hash : url;
}

function normalizeExportImage(url: string, images: Record<string, string>): string {
  if (!url) return '';
  const rel = exportRelative(url);
  return basename(images[rel] ?? rel);
}

function normalizeNextImage(url: string): string {
  if (!url) return '';
  let p = url;
  const m = /\/_next\/image\?(?:.*&)?url=([^&]+)/.exec(url);
  if (m) {
    try {
      p = decodeURIComponent(m[1]);
    } catch {
      p = m[1];
    }
  }
  return basename(p.replace(/^https?:\/\/[^/]+/i, '').split(/[?#]/)[0]);
}

/** Multiset difference: items only in `a`, and items only in `b`. */
function diffMultiset(a: string[], b: string[]): { onlyA: string[]; onlyB: string[] } {
  const rest = [...b];
  const onlyA: string[] = [];
  for (const x of a) {
    const i = rest.indexOf(x);
    if (i >= 0) rest.splice(i, 1);
    else onlyA.push(x);
  }
  return { onlyA, onlyB: rest };
}

export function compareDom(
  expected: SectionDom[],
  actual: SectionDom[],
  maps: { routes: Record<string, string>; images: Record<string, string> }
): DomMismatch[] {
  const out: DomMismatch[] = [];
  for (const [i, j] of pairByName(expected, actual)) {
    if (i === null || j === null) continue; // missing/unexpected sections are reported by compareSections
    const e = expected[i];
    const a = actual[j];
    const section = e.name;
    const et = normText(e.text);
    const at = normText(a.text);
    if (et !== at) out.push({ section, kind: 'text', expected: et, actual: at });
    const lists: Array<['link' | 'image', string[], string[]]> = [
      ['link', e.links.map((l) => normalizeExportLink(l, maps.routes)), a.links],
      ['image', e.images.map((s) => normalizeExportImage(s, maps.images)), a.images.map(normalizeNextImage)]
    ];
    for (const [kind, el, al] of lists) {
      const { onlyA, onlyB } = diffMultiset(el, al);
      const n = Math.max(onlyA.length, onlyB.length);
      for (let k = 0; k < n; k++) out.push({ section, kind, expected: onlyA[k] ?? '', actual: onlyB[k] ?? '' });
    }
  }
  return out;
}
