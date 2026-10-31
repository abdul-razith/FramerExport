import { uiConfirm, uiSelect, formatShortcutHint } from '../ui/prompts.js';

export interface CliV2Options {
  prettyPrint: boolean;
  includeSubpages: boolean;
  concurrency: number;
}

export function parseConcurrencyOption(val: unknown): number {
  const num = Number(val);
  if (Number.isFinite(num) && num > 0) return num;
  return 12;
}

export async function runScreenOptions(): Promise<CliV2Options> {
  const prettyPrint = await uiConfirm(
    `Format & Beautify Downloaded JavaScript? ${formatShortcutHint('Y/n', 'toggle')}`,
    true
  );

  const includeSubpages = await uiConfirm(
    `Crawl and Export Linked Sub-pages? ${formatShortcutHint('y/N', 'toggle')}`,
    false
  );

  const concurrency = await uiSelect<number>(
    `Parallel Download Concurrency ${formatShortcutHint('Enter', 'select')}`,
    [
      { label: '6 · Low bandwidth / gentle', value: 6 },
      { label: '12 · Balanced (recommended)', value: 12 },
      { label: '20 · Fast connection', value: 20 },
    ],
    12
  );

  return {
    prettyPrint,
    includeSubpages,
    concurrency,
  };
}
