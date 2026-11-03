import type { Page } from 'puppeteer';
import type { Analysis, ConvertState } from '../types.js';

export interface StageContext {
  state: ConvertState;
  exportDir: string;
  nextDir: string;
  log(msg: string): void;
}

export interface PlatformAdapter {
  id: 'framer';
  canHandle(exportDir: string): Promise<boolean>;
  analyze(ctx: StageContext, opts?: { animations?: boolean }): Promise<Analysis>;
  /** Sections of a page, derived from its exported HTML: display name plus a selector matching exactly one element. */
  sections(html: string): Array<{ name: string; selector: string }>;
  settle(page: Page): Promise<void>;
}
