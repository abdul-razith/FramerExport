import type { AgentId, RunOptions } from '../../convert/types.js';
import { uiConfirm, uiSelect, uiText } from '../ui/prompts.js';

export interface AskOptionsDeps {
  confirm?: (msg: string, initial?: boolean) => Promise<boolean>;
  select?: <T extends string | number | boolean>(
    msg: string,
    options: { label: string; value: T; hint?: string }[],
    initialValue?: T
  ) => Promise<T>;
  text?: (msg: string, opts?: { defaultValue?: string; placeholder?: string }) => Promise<string>;
}

export async function askRunOptions(
  defaults: RunOptions,
  agents: AgentId[] = ['agy', 'claude'],
  deps?: AskOptionsDeps
): Promise<RunOptions> {
  const confirmFn = deps?.confirm ?? uiConfirm;
  const selectFn = deps?.select ?? uiSelect;
  const textFn = deps?.text ?? uiText;

  if (agents.length === 0) {
    throw new Error('No supported AI agent found on PATH. Install agy or claude, then try again.');
  }
  // Asked every time: it decides whether the run stops for your review after each page.
  const pageMode = (await selectFn(
    'How should pages be completed?',
    [
      { label: 'Page by page, pause after each page', value: 'pause', hint: 'review each page in the browser, then continue' },
      { label: 'Page by page, automatic', value: 'auto', hint: 'go straight on to the next page' },
    ],
    defaults.pageMode ?? 'pause'
  )) as 'pause' | 'auto';

  const useDefaults = await confirmFn('Use default options?', true);
  if (useDefaults) {
    return { ...defaults, pageMode, agent: agents.includes(defaults.agent) ? defaults.agent : agents[0] };
  }

  const testing = await confirmFn('Enable visual testing?', defaults.testing);

  const agent = (await selectFn(
    'Select AI agent:',
    agents.map((a) => ({ label: a, value: a })),
    agents.includes(defaults.agent) ? defaults.agent : agents[0]
  )) as AgentId;

  const concurrencyStr = (await selectFn(
    'Worker concurrency:',
    [
      { label: '1 worker', value: '1' },
      { label: '2 workers', value: '2' },
      { label: '3 workers', value: '3' },
    ],
    String(defaults.concurrency)
  )) as string;
  const concurrency = parseInt(concurrencyStr, 10) as 1 | 2 | 3;

  const sectionTimeoutStr = await textFn('Section timeout (minutes):', {
    defaultValue: String(defaults.sectionTimeoutMin),
    placeholder: String(defaults.sectionTimeoutMin),
  });
  const sectionTimeoutMin = parseInt(sectionTimeoutStr, 10) || defaults.sectionTimeoutMin;

  const pageTimeoutStr = await textFn('Page timeout (minutes):', {
    defaultValue: String(defaults.pageTimeoutMin),
    placeholder: String(defaults.pageTimeoutMin),
  });
  const pageTimeoutMin = parseInt(pageTimeoutStr, 10) || defaults.pageTimeoutMin;

  const pixelToleranceStr = await textFn('Pixel tolerance (0–1):', {
    defaultValue: String(defaults.pixelTolerance),
    placeholder: String(defaults.pixelTolerance),
  });
  const parsedPixel = parseFloat(pixelToleranceStr);
  const pixelTolerance = Number.isFinite(parsedPixel) ? parsedPixel : defaults.pixelTolerance;

  const reportToleranceStr = await textFn('Report tolerance (0–1):', {
    defaultValue: String(defaults.reportTolerance),
    placeholder: String(defaults.reportTolerance),
  });
  const parsedReport = parseFloat(reportToleranceStr);
  const reportTolerance = Number.isFinite(parsedReport) ? parsedReport : defaults.reportTolerance;

  return {
    testing,
    agent,
    concurrency,
    pageMode,
    sectionTimeoutMin,
    pageTimeoutMin,
    pixelTolerance,
    reportTolerance,
  };
}
