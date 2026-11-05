import { existsSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { readAnimations, readTaskGoal } from '../../convert/index.js';
import { formatStatus, pickNextTask } from '../../convert/pipeline.js';
import { formatProgressLine, formatRunBanner, formatTimeSummary } from '../../convert/progress.js';
import { DEFAULT_OPTIONS, findProjectRoot, loadState, saveState } from '../../convert/state.js';
import { detectAgents } from '../../convert/runner/agent-process.js';
import { runReport } from '../../convert/verify/report.js';
import { type RunOptions } from '../../convert/types.js';
import { uiIntro, uiNote, uiOutro, uiSelect, uiSpinner, uiText } from '../ui/prompts.js';
import {
  STAGE_LABELS,
  getDashboardChoices,
  type DashboardAction,
} from './convert-helpers.js';
import { runScreenConvertAgents } from './convert-agents.js';
import { askRunOptions } from './convert-options.js';
import { runScreenConvertRun } from './convert-run.js';

export interface ConvertDashboardOptions {
  /** Print the intro and the closing outro (default true). Callers that own both pass false. */
  intro?: boolean;
}

/** Finds a converted project, or lets the user open one / convert an export folder. Null means the user exited. */
async function chooseProject(start: string): Promise<string | null> {
  const found = await findProjectRoot(start);
  if (found) return found;
  const choice = await uiSelect('No converted project found here. What do you want to do?', [
    { label: 'Open an existing converted project', value: 'open' as const },
    { label: 'Convert an export folder', value: 'convert' as const },
    { label: 'Exit', value: 'exit' as const },
  ]);
  if (choice === 'exit') return null;
  if (choice === 'open') {
    const dir = await uiText('Path to the converted project (contains .convert/state.json)', {
      validate: (v) =>
        v && existsSync(path.join(path.resolve(v), '.convert', 'state.json')) ? undefined : 'No .convert/state.json in that folder',
    });
    return path.resolve(dir);
  }
  const exportDir = await uiText('Path to the Framer export folder', {
    validate: (v) => (v && existsSync(path.resolve(v)) ? undefined : 'Folder not found'),
  });
  return runScreenConvertRun(exportDir, path.resolve(exportDir) + '-next', { intro: false });
}

export async function runScreenConvertDashboard(
  projectDir: string = process.cwd(),
  opts: ConvertDashboardOptions = {}
): Promise<void> {
  const standalone = opts.intro !== false;
  if (standalone) uiIntro('FramerExport v2 · Next.js Converter');
  const root = await chooseProject(projectDir);
  if (!root) {
    if (standalone) uiOutro('Dashboard closed.');
    return;
  }

  let initial: DashboardAction | undefined;
  for (;;) {
    const state = await loadState(root);
    if (!state) {
      uiNote(`No .convert/state.json in ${root}`, 'Conversion Dashboard');
      break;
    }
    const choices = getDashboardChoices(state);
    const banner = formatRunBanner(state);
    const message = [
      'What next?',
      ...(banner ? [banner] : []),
      formatProgressLine(state),
    ].join('\n');

    const action = await uiSelect<DashboardAction>(
      message,
      choices,
      initial ?? choices.find((c) => c.selected)?.value ?? choices[0]?.value
    );
    initial = undefined;
    if (action === 'exit') {
      if (state.timing) uiNote(formatTimeSummary(state), 'Time spent');
      break;
    }

    if (action === 'status') {
      uiNote(formatStatus(state, await readAnimations(root)), 'Conversion status');
    } else if (action === 'next') {
      const task = pickNextTask(state);
      if (!task) uiNote('No pending tasks', 'Next task');
      else {
        const file = path.join(root, task.file);
        const goal = await readTaskGoal(file);
        uiNote(
          [
            `${task.id} (${task.status})`,
            `File: ${file}`,
            ...(goal ? ['', 'Goal', goal] : []),
          ].join('\n'),
          'Next task'
        );
      }
    } else if (action === 'resume' || action === 'agent') {
      try {
        await runScreenConvertAgents(root);
      } catch (error) {
        uiNote((error as Error).message, 'Agent Execution');
      }
    } else if (action === 'report') {
      const spinner = uiSpinner();
      spinner.start('Generating visual comparison report…');
      try {
        const res = await runReport(
          { state, exportDir: state.exportDir, nextDir: root, log: () => {} },
          { tolerance: state.options?.reportTolerance ?? 0.03 }
        );
        spinner.stop('Report generated');
        uiNote(
          `Report generated: ${res.file}\nSections over threshold: ${res.over}`,
          'Visual Report'
        );
      } catch (err: any) {
        spinner.stop('Report failed');
        uiNote(err.message || String(err), 'Report Error');
      }
    } else if (action === 'open-report') {
      const reportPath = path.join(root, '.convert', 'report', 'index.html');
      if (existsSync(reportPath)) {
        try {
          if (process.platform === 'win32') {
            spawn('cmd.exe', ['/c', 'start', '""', reportPath], { detached: true, stdio: 'ignore' });
          } else if (process.platform === 'darwin') {
            spawn('open', [reportPath], { detached: true, stdio: 'ignore' });
          } else {
            spawn('xdg-open', [reportPath], { detached: true, stdio: 'ignore' });
          }
          uiNote(`Opened report: ${reportPath}`, 'Open Report');
        } catch {
          uiNote(`Report located at: ${reportPath}`, 'Open Report');
        }
      } else {
        uiNote('No report found. Run "Generate visual report" first.', 'Open Report');
      }
    } else if (action === 'review') {
      const reviewTasks = Object.values(state.tasks).filter((t) => t.status === 'needs-review');
      if (reviewTasks.length === 0) {
        uiNote('No tasks needing review.', 'Review');
      } else {
        const id = await uiSelect(
          'Which task do you want to mark done?',
          reviewTasks.map((t) => ({ label: `${t.id} (${t.kind})`, value: t.id }))
        );
        const task = state.tasks[id];
        if (task) {
          task.status = 'done';
          await saveState(state);
          uiNote(`Marked ${id} done.`, 'Review');
        }
      }
    } else if (action === 'options') {
      const agents = await detectAgents();
      const defaults: RunOptions = state.options ?? { ...DEFAULT_OPTIONS, agent: agents[0] ?? 'agy' };
      const updated = await askRunOptions(defaults, agents);
      state.options = updated;
      await saveState(state);
      uiNote('Run options saved.', 'Run Options');
    } else if (action === 'reconvert') {
      const baseName = path.basename(root);
      const parentDir = path.dirname(root);
      let targetName = `${baseName}.old`;
      let suffix = 2;
      while (existsSync(path.join(parentDir, targetName))) {
        targetName = `${baseName}.old-${suffix}`;
        suffix++;
      }
      const oldPath = path.join(parentDir, targetName);
      await rename(root, oldPath);
      uiNote(`Renamed existing project to ${targetName}`, 'Reconvert');
      await runScreenConvertRun(state.exportDir, root, { intro: false });
    }
    // 'refresh' falls through: next pass reloads state.
  }
  if (standalone) uiOutro('Dashboard closed.');
}
