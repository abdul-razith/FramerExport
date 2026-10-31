import path from 'node:path';
import { deriveOutputName } from '../../exporter/index.js';
import { detectPlatform } from '../../platforms/index.js';
import type { PlatformType } from '../../platforms/types.js';
import { uiText, formatShortcutHint } from '../ui/prompts.js';

export function validateUrlInput(input?: string): string | undefined {
  if (!input || !input.trim()) {
    return 'URL cannot be empty.';
  }

  try {
    const parsed = new URL(input.trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return 'URL must start with http:// or https://';
    }
    if (parsed.username || parsed.password) {
      return 'URLs with embedded credentials are not supported.';
    }
    return undefined;
  } catch {
    return 'Invalid URL format (expected e.g. https://example.framer.app)';
  }
}

export function deriveInitialOutDir(url: string, provider: PlatformType | 'auto' = 'auto'): string {
  try {
    const platform = provider === 'auto' ? detectPlatform(url).name : provider;
    return `./${deriveOutputName(url, platform)}`;
  } catch {
    return './export-site';
  }
}

export async function runScreenDetails(
  defaultProvider: PlatformType | 'auto' = 'auto',
  presetUrl?: string
): Promise<{ url: string; outDir: string }> {
  const url = presetUrl
    ? presetUrl
    : await uiText(`Step 2/5: Website Public URL ${formatShortcutHint('Enter', 'confirm')}`, {
        placeholder: 'https://mysite.framer.app',
        validate: validateUrlInput,
      });

  const defaultDir = deriveInitialOutDir(url, defaultProvider);

  const outDirInput = await uiText(
    `Output Directory ${formatShortcutHint('Enter', 'confirm default')}`,
    {
      defaultValue: defaultDir,
      placeholder: defaultDir,
      validate: (val) => (!val || !val.trim() ? 'Output directory cannot be empty.' : undefined),
    }
  );

  return {
    url,
    outDir: path.resolve(outDirInput),
  };
}
