import { PLATFORM_REGISTRY } from '../../platforms/index.js';
import type { PlatformType } from '../../platforms/types.js';
import { uiSelect, formatShortcutHint } from '../ui/prompts.js';

export interface ProviderChoice {
  label: string;
  value: PlatformType | 'auto';
  hint?: string;
}

export function getProviderChoices(): ProviderChoice[] {
  const choices: ProviderChoice[] = [
    {
      label: 'Auto-detect from URL',
      value: 'auto',
      hint: 'Recommended · detects from domain or HTML signatures',
    },
  ];

  for (const p of PLATFORM_REGISTRY) {
    choices.push({
      label: p.displayName,
      value: p.name,
      hint: p.category,
    });
  }

  return choices;
}

export async function runScreenProvider(): Promise<PlatformType | 'auto'> {
  const choices = getProviderChoices();
  return await uiSelect<PlatformType | 'auto'>(
    `Step 1/5: Select Website Builder / Platform ${formatShortcutHint('Enter', 'select')}`,
    choices,
    'auto'
  );
}
