import type { AgentId, ConvertState, TaskStatus } from './types.js';

/** `45s`, `4m 12s`, `1h 02m`. Negative values count as zero. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

export function progressBar(done: number, total: number, width = 10): string {
  const filled = total > 0 ? Math.min(width, Math.round((done / total) * width)) : 0;
  return '▓'.repeat(filled) + '░'.repeat(width - filled);
}

/** The id time is booked on: a fix task counts toward the task it fixes. */
export function timeTaskId(state: ConvertState, id: string): string {
  const task = state.tasks[id];
  if (task?.kind !== 'fix' && id !== 'build') return id;
  const original = id.replace(/^fix-/, '').replace(/-\d+$/, '');
  return state.tasks[original] || original === 'build' ? original : id;
}

/** Adds active working time to `id` (`setup` and `build` are reserved ids). The start is stamped once. */
export function addTime(state: ConvertState, id: string, ms: number, now: Date = new Date()): void {
  if (!(ms > 0)) return;
  state.timing ??= { startedAt: now.toISOString(), byTask: {} };
  state.timing.byTask[id] = (state.timing.byTask[id] ?? 0) + Math.round(ms);
}

export interface PageProgress {
  id: string;
  route: string;
  status: TaskStatus;
  attempts: number;
  ms: number;
  sectionsDone: number;
  sectionsTotal: number;
}

export interface Progress {
  pagesDone: number;
  pagesTotal: number;
  sectionsDone: number;
  sectionsTotal: number;
  shellDone: boolean | undefined;
  overallMs: number;
  setupMs: number;
  buildMs: number;
  startedAt?: string;
  pages: PageProgress[];
}

export function summarizeProgress(state: ConvertState): Progress {
  const tasks = Object.values(state.tasks);
  const by = state.timing?.byTask ?? {};
  const pages: PageProgress[] = tasks
    .filter((t) => t.kind === 'page')
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((t) => {
      const sections = t.sections ?? [];
      const passed = (t.passedSections ?? []).filter((s) => sections.includes(s));
      return {
        id: t.id,
        route: t.route ?? t.id,
        status: t.status,
        attempts: t.attempts,
        ms: by[t.id] ?? 0,
        sectionsDone: t.status === 'done' && sections.length ? sections.length : passed.length,
        sectionsTotal: sections.length,
      };
    });
  const shell = tasks.find((t) => t.kind === 'shell');
  return {
    pagesDone: pages.filter((p) => p.status === 'done').length,
    pagesTotal: pages.length,
    sectionsDone: pages.reduce((n, p) => n + p.sectionsDone, 0),
    sectionsTotal: pages.reduce((n, p) => n + p.sectionsTotal, 0),
    shellDone: shell ? shell.status === 'done' : undefined,
    overallMs: Object.values(by).reduce((n, v) => n + v, 0),
    setupMs: by.setup ?? 0,
    buildMs: by.build ?? 0,
    startedAt: state.timing?.startedAt,
    pages,
  };
}

/** One compact line for the dashboard header and menus. */
export function formatProgressLine(state: ConvertState): string {
  const p = summarizeProgress(state);
  const parts = [`${progressBar(p.pagesDone, p.pagesTotal)} Pages ${p.pagesDone}/${p.pagesTotal}`];
  if (p.sectionsTotal) parts.push(`Sections ${p.sectionsDone}/${p.sectionsTotal}`);
  const reviewCount = Object.values(state.tasks).filter((t) => t.status === 'needs-review').length;
  if (reviewCount > 0) parts.push(`Review ${reviewCount}`);
  parts.push(`Overall ${formatDuration(p.overallMs)}`);
  return parts.join(' · ');
}

/** Formats a banner when a run is paused, or returns null if not paused. */
export function formatRunBanner(state: ConvertState): string | null {
  if (state.run?.status !== 'paused') {
    return null;
  }
  const p = summarizeProgress(state);
  const location =
    p.sectionsTotal > 0
      ? `Sections ${p.sectionsDone}/${p.sectionsTotal}`
      : p.pagesTotal > 0
      ? `Pages ${p.pagesDone}/${p.pagesTotal}`
      : '';
  const prefix = location ? `Paused at ${location}` : 'Paused';

  let reasonStr = '';
  if (state.run.reason === 'quota') {
    const agent = state.options?.agent ? `${state.options.agent} ` : '';
    const reset = state.run.quotaResetHint ? ` (resets in ${state.run.quotaResetHint})` : '';
    reasonStr = `${agent}quota${reset}`;
  } else if (state.run.reason) {
    reasonStr = state.run.reason;
  }

  return reasonStr ? `${prefix} · reason: ${reasonStr}` : prefix;
}

/** One line describing the current activity of an agent worker. */
export function formatWorkerLine(w: {
  worker: number;
  route: string;
  section: string;
  agent: AgentId;
  ms: number;
  lastLine: string;
}): string {
  const parts = [
    `W${w.worker}`,
    w.route,
    w.section,
    w.agent,
    formatDuration(w.ms),
  ];
  if (w.lastLine?.trim()) {
    parts.push(w.lastLine.trim());
  }
  return parts.join(' · ');
}

const MARK: Record<TaskStatus, string> = {
  done: '✓',
  'in-progress': '…',
  pending: '–',
  'awaiting-fix': '!',
  'needs-review': '?',
};

/** Multi-line time report: overall, setup, time per page and the slowest page. */
export function formatTimeSummary(state: ConvertState): string {
  const p = summarizeProgress(state);
  const lines = [`Overall   ${formatDuration(p.overallMs)}`];
  if (p.startedAt) lines.push(`Started   ${p.startedAt.slice(0, 16).replace('T', ' ')} UTC`);
  if (p.setupMs) lines.push(`Setup     ${formatDuration(p.setupMs)}`);
  if (p.buildMs) lines.push(`Builds    ${formatDuration(p.buildMs)} (shared by all pages)`);
  if (p.pages.length) lines.push('');
  const width = Math.max(0, ...p.pages.map((x) => x.route.length));
  for (const x of p.pages) {
    const sections = x.sectionsTotal ? `  ${x.sectionsDone}/${x.sectionsTotal} sections` : '';
    lines.push(`${x.route.padEnd(width)}  ${formatDuration(x.ms).padStart(7)}  ${MARK[x.status]}${sections}`);
  }
  const timed = p.pages.filter((x) => x.ms > 0).sort((a, b) => b.ms - a.ms);
  if (timed.length > 1) lines.push('', `Slowest: ${timed[0]!.route} (${formatDuration(timed[0]!.ms)})`);
  return lines.join('\n');
}

/**
 * One line for the spinner while a task runs:
 * `Page 3/9 · /blog · agy · this run 4m 12s · page 11m 40s · overall 1h 02m · <last agent line>`.
 * `state` holds the time booked before this run started; `runMs` is the running time of the current run.
 */
export function formatLiveLine(
  state: ConvertState,
  taskId: string,
  opts: { agent?: string; runMs: number; lastLine?: string }
): string {
  const id = timeTaskId(state, taskId);
  const p = summarizeProgress(state);
  const index = p.pages.findIndex((x) => x.id === id);
  const page = index >= 0 ? p.pages[index]! : undefined;
  const parts: string[] = [];
  if (page) parts.push(`Page ${index + 1}/${p.pagesTotal}`, page.route);
  else parts.push(id);
  if (opts.agent) parts.push(opts.agent);
  parts.push(`this run ${formatDuration(opts.runMs)}`);
  if (page) parts.push(`page ${formatDuration(page.ms + opts.runMs)}`);
  parts.push(`overall ${formatDuration(p.overallMs + opts.runMs)}`);
  const line = parts.join(' · ');
  const last = opts.lastLine?.trim();
  return last ? `${line} · ${last}` : line;
}

/** Calls `update(elapsedMs)` every `everyMs` until the returned stop function is called. */
export function startTicker(update: (elapsedMs: number) => void, everyMs = 1000): () => void {
  const start = Date.now();
  const timer = setInterval(() => update(Date.now() - start), everyMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

/** What to show while a finished page waits for review in the browser. */
export function formatPageReviewMessage(
  state: ConvertState,
  info: { route: string; url: string; taskId: string }
): string {
  const t = state.tasks[info.taskId];
  const p = summarizeProgress(state);
  const ms = state.timing?.byTask[info.taskId] ?? 0;
  const flag = t?.status === 'needs-review' ? ' (needs review: it did not pass every check)' : '';
  return [
    `Page ${info.route} is done${flag} in ${formatDuration(ms)}.`,
    `Open it in the browser: ${info.url}`,
    `Pages ${p.pagesDone}/${p.pagesTotal} · Overall ${formatDuration(p.overallMs)}`,
  ].join('\n');
}
