import type { ConvertState, TaskKind, TaskRecord } from '../types.js';

const KIND_ORDER: Record<TaskKind, number> = {
  fix: 0,
  shell: 1,
  section: 2,
  page: 3,
};

/**
 * Returns pending tasks whose dependencies are all done or needs-review.
 * Ordered: fix tasks first, then shell, section, page, and id within kind.
 * While any shell task is in `running`, no other shell task is ready.
 */
export function readyTasks(state: ConvertState, running: ReadonlySet<string>): TaskRecord[] {
  const runningHasShell = Array.from(running).some((id) => state.tasks[id]?.kind === 'shell');

  const ready: TaskRecord[] = [];

  for (const task of Object.values(state.tasks)) {
    if (task.status !== 'pending') {
      continue;
    }

    if (running.has(task.id)) {
      continue;
    }

    if (task.kind === 'shell' && runningHasShell) {
      continue;
    }

    if (task.dependsOn && task.dependsOn.length > 0) {
      const allDepsMet = task.dependsOn.every((depId) => {
        const dep = state.tasks[depId];
        return dep && (dep.status === 'done' || dep.status === 'needs-review');
      });
      if (!allDepsMet) {
        continue;
      }
    }

    ready.push(task);
  }

  ready.sort((a, b) => {
    const orderDiff = (KIND_ORDER[a.kind] ?? 99) - (KIND_ORDER[b.kind] ?? 99);
    if (orderDiff !== 0) return orderDiff;
    return a.id.localeCompare(b.id);
  });

  return ready;
}
