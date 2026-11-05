import path from 'node:path';
import { runPipeline } from '../../convert/pipeline.js';
import { DEFAULT_OPTIONS, loadState, nextStage } from '../../convert/state.js';
import { detectAgents } from '../../convert/runner/agent-process.js';
import type { RunOptions } from '../../convert/types.js';
import { uiCancelAndExit, uiConfirm, uiIntro, uiNote, uiSpinner } from '../ui/prompts.js';
import { STAGE_LABELS, stageFromLog, stripNextSteps } from './convert-helpers.js';
import { askRunOptions } from './convert-options.js';

export interface ConvertRunOptions {
  /** Print the v2 intro banner (default true). The v2 export flow already printed one. */
  intro?: boolean;
  options?: RunOptions;
}

/** Stages 1-4 of the conversion with the v2 look: summary, confirm, one spinner walking through the stages. */
export async function runScreenConvertRun(
  exportDir: string,
  nextDir: string,
  opts: ConvertRunOptions = {}
): Promise<string> {
  exportDir = path.resolve(exportDir);
  nextDir = path.resolve(nextDir);
  if (opts.intro !== false) uiIntro('FramerExport v2 · Next.js Converter');

  const existing = await loadState(nextDir);
  const resume = existing ? nextStage(existing) : null;
  uiNote(
    [`Export:       ${exportDir}`, `Project:      ${nextDir}`, `Resume from:  ${resume ?? (existing ? 'complete' : 'start')}`].join(
      '\n'
    ),
    'Convert to Next.js'
  );
  if (!(await uiConfirm('Start conversion?'))) uiCancelAndExit('Conversion cancelled by user.');

  const agents = await detectAgents();
  const defaults: RunOptions = opts.options ?? existing?.options ?? { ...DEFAULT_OPTIONS, agent: 'agy' };
  const options = opts.options ?? (await askRunOptions(defaults, agents));

  let spinner = uiSpinner();
  let label: string = STAGE_LABELS.analyze;
  spinner.start(label);
  const collected: string[] = [];
  try {
    await runPipeline(
      exportDir,
      nextDir,
      {
        log: (msg) => {
          const stage = stageFromLog(msg);
          if (stage) {
            label = STAGE_LABELS[stage];
            spinner.message(label);
          } else collected.push(msg);
        },
        // A prompt cannot share the terminal with a running spinner.
        confirm: async (msg) => {
          spinner.stop('Waiting for your answer');
          const answer = await uiConfirm(msg, false);
          spinner = uiSpinner();
          spinner.start(label);
          return answer;
        },
      },
      options
    );
  } catch (error) {
    spinner.stop('Conversion failed');
    throw error;
  }
  spinner.stop('Stages 1–4 complete: project scaffolded, AI tasks written');

  const state = await loadState(nextDir);
  const counts: Record<string, number> = {};
  for (const t of Object.values(state?.tasks ?? {})) counts[t.kind] = (counts[t.kind] ?? 0) + 1;
  const taskLine = Object.entries(counts)
    .map(([kind, n]) => `${kind} ${n}`)
    .join(', ');
  const details = stripNextSteps(collected).filter((l) => l.trim() !== '');
  uiNote(
    [`Project:  ${nextDir}`, `Tasks:    ${taskLine || 'none'}`, ...(details.length ? ['', ...details.slice(-12)] : [])].join('\n'),
    'Project ready'
  );
  return nextDir;
}
