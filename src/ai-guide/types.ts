import type { Box, Breakpoint } from '../nextjs/model.js';
import type { FontFace } from '../nextjs/fonts.js';
import type { ThemeTokens } from '../nextjs/tokens.js';

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

export interface GuideLink {
  text: string;
  href: string;
}

export interface GuideCollection {
  name: string;
  indexRoute: string;
  /** e.g. `/blog/[slug]` */
  itemPattern: string;
  items: { slug: string; route: string; title: string; date?: string; cover?: string; exportFile: string }[];
  fields: { key: string; kind: string }[];
}

export interface GuideSite {
  name: string;
  sourceUrl: string;
  pages: GuidePage[];
  collections: GuideCollection[];
  nav: GuideLink[];
  footer: GuideLink[];
  /** Sections that look the same on several pages (shared header, footer, CTA…). */
  sharedSections: { name: string; routes: string[] }[];
  tokens: ThemeTokens;
  fonts: FontFace[];
  /** Export files not tied to one section: unused images, videos, CMS data chunks. */
  exportFiles: { images: GuideImage[]; videos: string[]; data: string[] };
}
