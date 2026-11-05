import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { AnimationEntry } from '../types.js';
import type { ScriptDrawn } from './script-drawn.js';

export interface GeneratedPart {
  name: string;
  component: string;
  file: string; /* posix, project-relative */
}

export interface GeneratedSection {
  name: string;
  component: string;
  file: string; /* posix, project-relative */
  parts: GeneratedPart[];
  motion: string[];
  scriptDrawn: string[];
  hasVariants: boolean;
  repeated: string[];
  cmsFields: string[];
}

export interface GeneratedPage {
  route: string;
  slug: string;
  view: string;
  dynamic?: {
    collection: string;
    firstSlug: string;
  };
  sections: GeneratedSection[];
  inline: string[];
  shell: string[];
}

export interface GeneratedShell {
  name: string;
  component: string;
  file: string;
  pages: string[];
  differences: string[];
}

export interface MotionAnchor {
  id: string;
  route: string;
  section: string | null;
  entry: AnimationEntry;
  matched: boolean;
}

export interface GeneratedManifest {
  version: 1;
  pages: GeneratedPage[];
  shell: GeneratedShell[];
  motion: MotionAnchor[];
  scriptDrawn: ScriptDrawn[];
  stubs: string[];
  warnings: string[];
}

export async function readManifest(nextDir: string): Promise<GeneratedManifest | null> {
  const file = path.join(nextDir, '.convert', 'analysis', 'generated.json');
  try {
    const text = await readFile(file, 'utf8');
    return JSON.parse(text) as GeneratedManifest;
  } catch {
    return null;
  }
}

export async function writeManifest(nextDir: string, m: GeneratedManifest): Promise<void> {
  const file = path.join(nextDir, '.convert', 'analysis', 'generated.json');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(m, null, 2) + '\n', 'utf8');
}
