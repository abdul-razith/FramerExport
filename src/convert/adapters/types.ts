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
  sectionRootsSelector: string;
  settle(page: Page): Promise<void>;
}
