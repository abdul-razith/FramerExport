import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { framerAdapter } from '../../convert/adapters/framer/index.js';
import { markTaskDone, readAnimations, readTaskGoal } from '../../convert/index.js';
import { formatStatus, pickNextTask } from '../../convert/pipeline.js';
import { addTime, formatProgressLine, formatTimeSummary } from '../../convert/progress.js';
import { findProjectRoot, loadState, saveState } from '../../convert/state.js';
import { runVerify } from '../../convert/stages/verify.js';
import type { PageInfo } from '../../convert/types.js';
import { uiIntro, uiNote, uiOutro, uiSelect, uiSpinner, uiText } from '../ui/prompts.js';
import {
  STAGE_LABELS,
  formatVerifyError,
  formatVerifyResult,
  getDashboardChoices,
  getMotionChoices,
  getVerifyTargetChoices,
  tickingMessage,
  type DashboardAction,
} from './convert-helpers.js';
import { runAgentFlow } from './convert-agent.js';
import { runGenerate } from '../../convert/generate/index.js';
import { runScreenConvertRun } from './convert-run.js';

export interface ConvertDashboardOptions {
  /** Print the intro and the closing outro (default true). Callers that own both pass false. */
  intro?: boolean;
}

const exists = (p: string): Promise<boolean> => stat(p).then(() => true, () => false);

async function readPages(root: string): Promise<PageInfo[]> {
  try {
    return JSON.parse(await readFile(path.join(root, '.convert', 'analysis', 'pages.json'), 'utf8')) as PageInfo[];
  } catch {
    return [];
  }
}

/** Runs `npm install` in the project, returning the exit code and the last stderr lines. */
function npmInstall(root: string): Promise<{ code: number; tail: string }> {
  return new Promise((resolve) => {
    const win = process.platform === 'win32';
    const child = spawn(win ? 'npm.cmd' : 'npm', ['install'], { cwd: root, shell: win, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr?.on('data', (d: Buffer) => {
      err += d.toString();
    });
    child.on('error', (e) => resolve({ code: 1, tail: e.message }));
    child.on('close', (code) => resolve({ code: code ?? 1, tail: err.split(/\r?\n/).filter(Boolean).slice(-20).join('\n') }));
  });
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
    const hasModules = await exists(path.join(root, 'node_modules'));
    const choices = getDashboardChoices(state, hasModules);
    const action = await uiSelect<DashboardAction>(
      `What next?
${formatProgressLine(state)}`,
      choices,
      initial ?? (!hasModules ? 'install' : (await exists(path.join(root, 'src', 'views'))) ? 'next' : 'generate')
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
            '',
            'Give this file to your AI agent, then choose "Run verification" here.',
          ].join('\n'),
          'Next task'
        );
      }
    } else if (action === 'install') {
      const spinner = uiSpinner();
      spinner.start('Installing dependencies…');
      const live = tickingMessage(spinner, 'Installing dependencies…');
      const installStart = Date.now();
      const { code, tail } = await npmInstall(root);
      live.stop();
      addTime(state, 'setup', Date.now() - installStart);
      await saveState(state);
      if (code === 0) spinner.stop('Dependencies installed');
      else {
        spinner.stop(`npm install failed (exit ${code})`);
        if (tail) uiNote(tail, 'npm install');
      }
    } else if (action === 'generate') {
      const spinner = uiSpinner();
      spinner.start('Generating pages and components…');
      const live = tickingMessage(spinner, 'Generating pages and components…');
      try {
        const r = await runGenerate({ state, exportDir: state.exportDir, nextDir: root, log: (m) => live.update(m.slice(0, 80)) });
        live.stop();
        spinner.stop('Generation finished');
        uiNote(
          `Pages: ${r.pages.length}
Components: ${r.components.length}
Left alone (already done): ${r.skipped.length}

Now choose "Run verification" to see which pages still need work.`,
          'Generated'
        );
      } catch (error) {
        live.stop();
        spinner.stop('Generation failed');
        uiNote((error as Error).message, 'Generate');
      }
    } else if (action === 'verify') {
      const target = await uiSelect('Verify which target?', getVerifyTargetChoices(state, await readPages(root)) as any);
      const spinner = uiSpinner();
      spinner.start(STAGE_LABELS.verify);
      const live = tickingMessage(spinner, STAGE_LABELS.verify);
      try {
        const result = await runVerify(
          { state, exportDir: state.exportDir, nextDir: root, log: (m) => live.update(m.slice(0, 80)) },
          framerAdapter,
          target as string | undefined
        );
        live.stop();
        spinner.stop('Verification finished');
        uiNote(formatVerifyResult(result, root), 'Verification result');
      } catch (error) {
        live.stop();
        spinner.stop('Verification failed');
        uiNote(formatVerifyError(error), 'Verification error');
      }
      await saveState(state);
    } else if (action === 'agent') {
      try {
        await runAgentFlow(root);
      } catch (error) {
        uiNote((error as Error).message, 'AI agent');
      }
    } else if (action === 'done') {
      const id = await uiSelect('Which motion task is finished?', getMotionChoices(state));
      const result = markTaskDone(state, id);
      if (result.ok) {
        await saveState(state);
        uiNote(`Marked ${result.task.id} done.`, 'Motion task');
      } else uiNote(result.error, 'Motion task');
    }
    // 'refresh' falls through: the next pass reloads the state.
  }
  if (standalone) uiOutro('Dashboard closed.');
}
