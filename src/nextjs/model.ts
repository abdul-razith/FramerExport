import type { NextjsOptions } from './options.js';
import type { ConversionReport } from './report.js';

export type Breakpoint = 'base' | 'tablet' | 'mobile';

export const BREAKPOINTS: readonly Breakpoint[] = ['base', 'tablet', 'mobile'];

export const CAPTURE_WIDTHS = { base: 1440, tablet: 1024, mobile: 390 } as const;

/** Kebab-case CSS property → computed value. */
export type Style = Record<string, string>;

export interface Transform {
  opacity?: number;
  x?: number;
  y?: number;
  scale?: number;
  rotate?: number;
}

export interface AnimationSpec {
  kind: 'reveal' | 'split-text';
  from: Transform;
}

export interface MotionSpec {
  kind: 'reveal' | 'split-text' | 'smooth-scroll' | 'cursor' | 'loader' | 'scroll';
  from?: Transform;
  scroll?: { property: string; values: string[] }[];
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Framer draws borders with an absolutely positioned ::after overlay. */
export interface AfterBorder {
  widths: string[];
  style: string;
  color: string;
}

/** Ordered inline content: text segments and child indexes, e.g. ['Read the ', 0, ' today.']. */
export type InlineContent = (string | number)[];

export interface RawNode {
  key: string;
  inline?: InlineContent;
  afterBorder?: AfterBorder;
  tag: string;
  attrs: Record<string, string>;
  framerName?: string;
  text?: string;
  box: Box;
  styles: Style;
  visible: boolean;
  scrollSamples?: Style[];
  children: RawNode[];
}

export interface Asset {
  kind: 'image' | 'video' | 'svg';
  src: string;
  width: number;
  height: number;
}

export interface Node {
  inline?: InlineContent;
  afterBorder?: AfterBorder;
  id: string;
  key: string;
  tag: string;
  framerName?: string;
  text?: string;
  attrs: Record<string, string>;
  styles: { base: Style; tablet?: Style; mobile?: Style };
  hover?: Style;
  animation?: AnimationSpec;
  motion?: MotionSpec;
  asset?: Asset;
  visibility?: Breakpoint[];
  children: Node[];
}

export interface PageModel {
  route: string;
  sourceUrl: string;
  title: string;
  meta: Record<string, string>;
  root: Node;
  screenshots: Record<Breakpoint, string>;
}

export interface ConversionContext {
  exportDir: string;
  sourceUrl: string;
  outDir: string;
  cacheDir: string;
  options: NextjsOptions;
  report: ConversionReport;
  log(msg: string): void;
}

export interface KeySegment {
  tag: string;
  framerName?: string;
  index: number;
}

/**
 * Stable element key shared by the Node-side parser and the in-browser serializer:
 * `tag[framerName]:index` segments joined by `/`, index = element-sibling index.
 */
export function nodeKey(ancestors: KeySegment[]): string {
  return ancestors
    .map((s) => `${s.tag}${s.framerName ? `[${s.framerName}]` : ''}:${s.index}`)
    .join('/');
}
