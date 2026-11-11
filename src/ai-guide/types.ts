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
  /** `01`, `02`… for page sections; `S1`, `S2`… for shell parts. */
  id: string;
  /** The section element's own Framer class (`framer-19ielic`), used to find it in the export. */
  className?: string;
  framerName?: string;
  /** Set when a tall section was split: the section's own name. */
  parent?: string;
  /** A shared part (header, footer, loader, overlay, page background): built once in the shell. */
  shell?: boolean;
  /** For shell parts: the route of the first page they appear on (where they are built and compared). */
  ownerRoute?: string;
  /** The widths showing each text, link href or image exportPath (absent = all widths). */
  widthsOf: Record<string, Breakpoint[]>;
  /** Text the page generates (clock, changing values): not content, masked in comparisons. */
  generated: { text: string; kind: 'clock' | 'date' | 'counter' | 'changing' }[];
  /** Node keys of the generated elements. */
  liveKeys: string[];
  /** Decoration noted once instead of listed (e.g. `ruler 0–2800`). */
  decorations: string[];
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
  /** Shell parts found on this page (header, loader, page background…). */
  shell?: GuideSection[];
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
  /** Every shell part of the site, once, in id order (each with its ownerRoute). */
  shell?: GuideSection[];
  /** Sections that look the same on several pages (shared header, footer, CTA…). */
  sharedSections: { name: string; routes: string[] }[];
  tokens: ThemeTokens;
  fonts: FontFace[];
  /** Export files not tied to one section: unused images, videos, CMS data chunks. */
  exportFiles: { images: GuideImage[]; videos: string[]; data: string[] };
}

/** Opacity, transform and own text of every sampled element at one moment (ms after navigation). */
export interface TimelineSample {
  t: number;
  values: Record<string, { opacity: string; transform: string; text: string }>;
}

export interface MotionEntry {
  /** Node key (same scheme as the capture's RawNode.key). */
  key: string;
  label: string;
  /** Section name; empty means "find it from the key". */
  section: string;
  trigger: 'load' | 'in-view' | 'scroll' | 'hover' | 'loop' | 'custom';
  from?: string;
  to?: string;
  startMs?: number;
  durationMs?: number;
  easing?: string;
  frames?: string;
  note?: string;
}
