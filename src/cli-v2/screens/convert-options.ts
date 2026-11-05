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

  const useDefaults = await confirmFn('Use default options?', true);
  if (useDefaults) {
    return { ...defaults };
  }

  const testing = await confirmFn('Enable visual testing?', defaults.testing);

  const agent = (await selectFn(
    'Select AI agent:',
    agents.map((a) => ({ label: a, value: a })),
    defaults.agent
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
  const pixelTolerance = parseFloat(pixelToleranceStr) || defaults.pixelTolerance;

  const reportToleranceStr = await textFn('Report tolerance (0–1):', {
    defaultValue: String(defaults.reportTolerance),
    placeholder: String(defaults.reportTolerance),
  });
  const reportTolerance = parseFloat(reportToleranceStr) || defaults.reportTolerance;

  return {
    testing,
    agent,
    concurrency,
    sectionTimeoutMin,
    pageTimeoutMin,
    pixelTolerance,
    reportTolerance,
  };
}
