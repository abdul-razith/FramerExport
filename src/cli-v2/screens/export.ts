import path from 'node:path';
import fs from 'node:fs/promises';
import { FramerExporter } from '../../exporter/index.js';
import { CFG } from '../../config/index.js';
import type { PlatformType } from '../../platforms/types.js';
import type { CliV2Options } from './options.js';
import { uiNote, uiConfirm, uiSpinner, uiCancelAndExit } from '../ui/prompts.js';

export interface ExportRunConfig {
  url: string;
  outDir: string;
  provider: PlatformType | 'auto';
  options: CliV2Options;
}

export interface ExportSummary {
  outDir: string;
  sourceUrl: string;
  platformName: string;
  assetCount: number;
  subpageCount: number;
  counts: Record<string, number>;
}

export async function countDirItems(dirPath: string): Promise<number> {
  try {
    const entries = await fs.readdir(dirPath);
    return entries.length;
  } catch {
    return 0;
  }
}

export async function runScreenExport(config: ExportRunConfig): Promise<ExportSummary> {
  const summaryText = [
    `URL:         ${config.url}`,
    `Provider:    ${config.provider}`,
    `Destination: ${config.outDir}`,
    `Subpages:    ${config.options.includeSubpages ? 'Yes' : 'No'}`,
    `Pretty JS:   ${config.options.prettyPrint ? 'Yes' : 'No'}`,
    `Concurrency: ${config.options.concurrency}`,
  ].join('\n');

  uiNote(summaryText, 'Step 4/5: Review Export Configuration');

  const proceed = await uiConfirm('Ready to start export?');
  if (!proceed) {
    uiCancelAndExit('Export cancelled by user.');
  }

  CFG.concurrency = config.options.concurrency;

  const spinner = uiSpinner();
  spinner.start('Initializing headless browser and analyzing page...');

  const exporter = new FramerExporter(
    config.url,
    config.outDir,
    config.provider === 'auto' ? undefined : config.provider
  );

  exporter.interactive = false;
  exporter.terminalPresentation = false;
  exporter.prettyPrint = config.options.prettyPrint;

  // Track progress with spinner message
  exporter.cooking = {
    update: (phase: string) => {
      spinner.message(phase);
    },
    stop: () => {},
  } as any;

  try {
    await exporter.run(config.options.includeSubpages);
    spinner.stop('Export and asset localization complete!');
  } catch (err) {
    spinner.stop('Export failed.');
    throw err;
  }

  const counts: Record<string, number> = {
    'index.html': 1,
    styles: await countDirItems(path.join(config.outDir, 'styles')),
    'assets/images': await countDirItems(path.join(config.outDir, 'assets', 'images')),
    'scripts/modules': await countDirItems(path.join(config.outDir, 'scripts', 'modules')),
    data: await countDirItems(path.join(config.outDir, 'data')),
    subpages: await countDirItems(path.join(config.outDir, 'subpages')),
  };

  return {
    outDir: config.outDir,
    sourceUrl: config.url,
    platformName: exporter.platform.displayName,
    assetCount: exporter.assets.entries.size,
    subpageCount: exporter.subpages.size,
    counts,
  };
}
