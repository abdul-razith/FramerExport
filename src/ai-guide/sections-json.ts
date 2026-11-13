import type { Box, Breakpoint } from '../nextjs/model.js';
import type { GuidePage } from './types.js';

export type WidthKey = '1440' | '1024' | '390';
export const WIDTH_KEY: Record<Breakpoint, WidthKey> = { base: '1440', tablet: '1024', mobile: '390' };

/** `ai-guide/sections.json`: what compare.mjs and parity.mjs need to find and score each section of each page. */
export interface SectionsJson {
  [route: string]: {
    slug: string;
    /** The original page, which parity.mjs compares the rebuild with. */
    url: string;
    /** `className`: the section's root class in the export, to find it on the original site. */
    sections: { id: string; name: string; className?: string; boxes: Partial<Record<WidthKey, Box>>; live: Partial<Record<WidthKey, Box[]>>; motion: number }[];
  };
}

/** Per route: the page's shell parts, then its sections, with their boxes and live (masked) boxes per width. */
export function sectionsJson(
  pages: GuidePage[],
  liveBoxes: (route: string, sectionId: string) => Partial<Record<WidthKey, Box[]>>,
  urlOf: (route: string) => string
): SectionsJson {
  const out: SectionsJson = {};
  for (const page of pages) {
    out[page.route] = {
      slug: page.slug,
      url: urlOf(page.route),
      sections: [...(page.shell ?? []), ...page.sections].map((s) => {
        const boxes: Partial<Record<WidthKey, Box>> = {};
        for (const [bp, key] of Object.entries(WIDTH_KEY) as [Breakpoint, WidthKey][]) if (s.boxes[bp]) boxes[key] = s.boxes[bp];
        return { id: s.id, name: s.name, ...(s.className ? { className: s.className } : {}), boxes, live: liveBoxes(page.route, s.id), motion: s.motion?.length ?? 0 };
      }),
    };
  }
  return out;
}
