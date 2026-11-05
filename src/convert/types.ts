export type StageName =
  | 'analyze'
  | 'extract-cms'
  | 'scaffold'
  | 'install'
  | 'generate'
  | 'tasks'
  | 'baseline'
  | 'finalize'
  | 'verify';

export type StageStatus = 'pending' | 'done' | 'needs-ai' | 'failed' | 'skipped';

export type TaskKind = 'shell' | 'section' | 'page' | 'fix' | 'component' | 'motion';

export type TaskStatus = 'pending' | 'in-progress' | 'awaiting-fix' | 'done' | 'needs-review' | 'needs-human';

export interface TaskRecord {
  id: string;
  kind: TaskKind;
  route?: string;
  section?: string;
  dependsOn?: string[];
  fixOf?: string;
  file: string;
  status: TaskStatus;
  attempts: number;
  targets: string[];
  /** Page tasks: ordered section names (the checklist). */
  sections?: string[];
  /** Page tasks: sections that passed at every width in the last verify. */
  passedSections?: string[];
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type AgentId = 'agy' | 'claude';

export interface RunOptions {
  testing: boolean;
  agent: AgentId;
  concurrency: 1 | 2 | 3;
  sectionTimeoutMin: number;
  pageTimeoutMin: number;
  pixelTolerance: number;
  reportTolerance: number;
}

export interface RunState {
  status: 'idle' | 'running' | 'paused' | 'done';
  reason?: 'user' | 'quota' | 'crash';
  quotaResetHint?: string;
  pausedAt?: string;
}

/** Active working time (never idle time between sessions). Optional: older projects have none. */
export interface ConvertTiming {
  startedAt: string;
  /** Milliseconds of active work per task id; `setup` holds analyze, CMS, scaffold and task writing; `build` the shared build. */
  byTask: Record<string, number>;
}

export interface ConvertState {
  version: 1 | 2;
  exportDir: string;
  nextDir: string;
  stages: Record<StageName, StageStatus>;
  tasks: Record<string, TaskRecord>;
  fileHashes: Record<string, string>;
  warnings: string[];
  timing?: ConvertTiming;
  options: RunOptions | null;
  run: RunState;
  /** In-memory only: set when loaded from a v1 state that had tasks. */
  legacyTasks?: boolean;
  /** In-memory only: set when exportDir cannot be resolved to an existing directory on disk. */
  exportMissing?: boolean;
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
