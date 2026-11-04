export type StageName = 'analyze' | 'extract-cms' | 'scaffold' | 'tasks' | 'verify';
export type StageStatus = 'pending' | 'done' | 'needs-ai' | 'failed';
export type TaskStatus = 'pending' | 'in-progress' | 'done' | 'needs-human';

export interface TaskRecord {
  id: string;
  kind: 'shell' | 'component' | 'page' | 'motion' | 'fix';
  route?: string;
  file: string;
  status: TaskStatus;
  attempts: number;
  targets: string[];
  /** Page tasks: ordered section names (the checklist). */
  sections?: string[];
  /** Page tasks: sections that passed at every width in the last verify. */
  passedSections?: string[];
}

/** Active working time (never idle time between sessions). Optional: older projects have none. */
export interface ConvertTiming {
  startedAt: string;
  /** Milliseconds of active work per task id; `setup` holds analyze, CMS, scaffold and task writing; `build` the shared build. */
  byTask: Record<string, number>;
}

export interface ConvertState {
  version: 1;
  exportDir: string;
  nextDir: string;
  stages: Record<StageName, StageStatus>;
  tasks: Record<string, TaskRecord>;
  fileHashes: Record<string, string>;
  warnings: string[];
  timing?: ConvertTiming;
}

export interface PageInfo {
  route: string;
  sourceFile: string;
  title: string;
  meta: Record<string, string>;
  dynamic?: {
    param: 'slug';
    collection: string;
    slugs: string[];
    /** One entry per detail page folded into this route (same order as `slugs`). */
    members: Array<{ slug: string; sourceFile: string }>;
  };
}

export interface Tokens {
  colors: Record<string, string>;
  tokenMap: Record<string, string>;
  fonts: Array<{
    family: string;
    weight: string;
    style: string;
    files: Array<{ path: string; unicodeRange?: string }>;
  }>;
  typeScale: Array<{ name: string; size: string; lineHeight: string; letterSpacing: string }>;
  breakpoints: { md: 810; lg: 1200 };
}

export interface ComponentInfo {
  name: string;
  selector: string;
  pages: string[];
  variants: string[];
  slice: string;
}

export interface AnimationEntry {
  route: string;
  selector: string;
  framerName?: string;
  trigger: 'appear' | 'scroll' | 'hover' | 'loop';
  from: Record<string, string>;
  to: Record<string, string>;
  durationMs?: number;
  delayMs?: number;
  confidence: 'high' | 'low';
}

export interface Analysis {
  pages: PageInfo[];
  tokens: Tokens;
  components: ComponentInfo[];
  animations: AnimationEntry[];
}
