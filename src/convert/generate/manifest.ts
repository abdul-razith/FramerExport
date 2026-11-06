import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { AnimationEntry } from '../types.js';
import type { ScriptDrawn } from './script-drawn.js';

export interface GeneratedPart {
  name: string;
  component: string;
  file: string; /* posix, project-relative */
  /** Information about the elements inside this part only. */
  motion?: string[];
  scriptDrawn?: string[];
  hasVariants?: boolean;
  repeated?: string[];
  cmsFields?: string[];
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

/** One page's own copy of a shell section (written by generate; the shell task consolidates them). */
export interface GeneratedShellCopy {
  route: string;
  component: string;
  file: string;
  /** The view that imports this copy. */
  view: string;
}

export interface GeneratedShell {
  name: string;
  component: string;
  file: string;
  pages: string[];
  differences: string[];
  /** Per-page copies the views import until the shell task runs. Absent in manifests from older runs. */
  copies?: GeneratedShellCopy[];
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
