import type { Box, Breakpoint } from '../nextjs/model.js';

/** `/` → `index`, `/blog/a-post` → `blog_a-post` (the export's subpage file naming). */
export function pageSlug(route: string): string {
  return route === '/' ? 'index' : route.replace(/^\/+|\/+$/g, '').replace(/\//g, '_');
}

export interface GuideImage {
  /** Where the file is in the export (`assets/images/...`), or its original URL. */
  exportPath: string;
  /** Readable path for the Next.js project's `public/` folder. */
  suggested: string;
  width: number;
  height: number;
  alt: string;
}

export interface GuideSection {
  index: number;
  name: string;
  /** The Framer layer name says nothing (missing, "Frame 12"): the AI must name the component. */
  generic: boolean;
  key: string;
  boxes: Partial<Record<Breakpoint, Box>>;
  texts: string[];
  images: GuideImage[];
  links: { text: string; href: string }[];
  motionKeys: string[];
}

export interface GuidePage {
  route: string;
  slug: string;
  title: string;
  exportFile: string;
  sections: GuideSection[];
  /** Set on the detail pages of a CMS collection. */
  collection?: string;
}
