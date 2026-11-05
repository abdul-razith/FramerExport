import path from 'node:path';
import type { StageContext } from '../adapters/types.js';
import { writeFileAtomic } from '../state.js';
import { renderTemplate } from '../stages/tasks.js';
import { checkCommand, SHARED_RULES } from '../tasks/templates/index.js';
import type { CheckResult } from '../verify/check.js';
import type { TaskRecord } from '../types.js';

/**
 * Formats only the failures from a CheckResult (visual mismatches, DOM mismatches,
 * code violations, motion failures, and errors).
 */
export function formatFailures(result: CheckResult): string {
  const lines: string[] = [];

  for (const w of result.widths) {
    if (!w.pass) {
      const pct = (w.ratio * 100).toFixed(2);
      lines.push(
        `- ${w.width}px: visual mismatch (ratio ${pct}%, delta ${w.heightDelta}px, ${w.clusters.length} clusters)`
      );
      if (w.images) {
        lines.push(`  - diff: \`${w.images.diff}\``);
        lines.push(`  - expected: \`${w.images.expected}\``);
        lines.push(`  - actual: \`${w.images.actual}\``);
      }
    }
  }

  for (const d of result.dom) {
    lines.push(
      `- DOM mismatch [${d.kind}]: expected "${d.expected}" vs actual "${d.actual}" (section ${d.section})`
    );
  }

  for (const c of result.code) {
    lines.push(`- Code violation: ${c}`);
  }

  for (const m of result.motion) {
    if (!m.pass) {
      const conf = m.lowConfidence ? ' [low-confidence]' : '';
      lines.push(`- Motion failure: ${m.id}${conf} - ${m.detail}`);
    }
  }

  for (const e of result.errors) {
    lines.push(`- Error: ${e}`);
  }

  if (lines.length === 0) {
    lines.push('- Check failed without specific failure details.');
  }

  return lines.join('\n');
}

/**
 * Writes a fix task file at `.convert/tasks/fix-<id>.md` and adds the fix task record to `ctx.state.tasks`.
 */
export async function writeFixTask(
  ctx: StageContext,
  task: TaskRecord,
  result: CheckResult
): Promise<TaskRecord> {
  const fixId = `fix-${task.id}`;
  const relFile = `.convert/tasks/${fixId}.md`;
  const failures = formatFailures(result);

  const targetsFormatted =
    task.targets && task.targets.length > 0
      ? task.targets.map((t) => `- \`${t}\``).join('\n')
      : '- (none)';

  const testing = ctx.state.options?.testing ?? true;
  const content = renderTemplate('fix', {
    taskId: task.id,
    attempt: String(task.attempts || 1),
    targets: targetsFormatted,
    failures,
    rules: SHARED_RULES,
    doneWhen: `Run \`${checkCommand(fixId, testing)}\` and stop when it passes or reports the limit.`,
  });

  const fullPath = path.join(ctx.nextDir, relFile);
  await writeFileAtomic(fullPath, content);

  const fixRecord: TaskRecord = {
    id: fixId,
    kind: 'fix',
    fixOf: task.id,
    route: task.route,
    section: task.section,
    file: relFile,
    status: 'pending',
    attempts: 0,
    targets: [...task.targets],
    dependsOn: [],
  };

  ctx.state.tasks[fixId] = fixRecord;
  return fixRecord;
}
