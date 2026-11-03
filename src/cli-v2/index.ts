import path from 'node:path';
import type { PlatformType } from '../platforms/types.js';
import { runScreenProvider } from './screens/provider.js';
import { runScreenDetails, deriveInitialOutDir } from './screens/details.js';
import { runScreenOptions } from './screens/options.js';
import { runScreenExport } from './screens/export.js';
import { runAiPromptAssistant } from '../ai/prompt-assistant.js';
import { uiIntro, uiOutro, uiCancelAndExit, uiConfirm } from './ui/prompts.js';

export interface CliV2ParsedArgs {
  url?: string;
  outDir?: string;
  provider?: PlatformType | 'auto';
  subpages: boolean;
  help: boolean;
  version: boolean;
}

export function parseCliV2Args(args: string[]): CliV2ParsedArgs {
  const result: CliV2ParsedArgs = {
    subpages: false,
    help: false,
    version: false,
  };

  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--version' || arg === '-v') {
      result.version = true;
    } else if (arg === '--subpages') {
      result.subpages = true;
    } else if (arg === '--platform' || arg === '--provider') {
      if (i + 1 < args.length) {
        result.provider = args[++i] as PlatformType;
      }
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  if (positional.length > 0) result.url = positional[0];
  if (positional.length > 1) result.outDir = positional[1];

  return result;
}

export function showCliV2Help(): string {
  return `
  fexport-v2 - Modern Interactive Website Exporter

  USAGE
    $ fexport-v2 [url] [output-dir] [options]
    $ npm run cli:v2 -- [url] [output-dir]

  WORKFLOW
    1. Select Website Platform (Auto-detect or category filter)
    2. Enter Website URL & Destination Directory
    3. Choose Options (JS formatting, sub-pages crawl, concurrency)
    4. Review & Live Export (Asset download with real-time spinner)
    5. Optional AI Conversion Prompt (Generate prompt brief for React, Next.js, Vue, SvelteKit, Astro)

  OPTIONS
    --subpages             Crawl and export internal sub-pages
    --platform <name>      Force website platform by id
    --help, -h             Show this help guide
    --version, -v          Show version number
`;
}

export async function runCliV2Workflow(argv: string[] = process.argv.slice(2)): Promise<void> {
  const args = parseCliV2Args(argv);

  if (args.help) {
    console.log(showCliV2Help());
    return;
  }

  if (args.version) {
    console.log('fexport-v2 v5.1.0');
    return;
  }

  uiIntro('FramerExport v2 · Modern Interactive CLI');

  try {
    // Step 1: Provider selection
    const provider = args.provider || (await runScreenProvider());

    // Step 2: Site details
    let url = args.url;
    let outDir = args.outDir;

    if (!url || !outDir) {
      const details = await runScreenDetails(provider, url);
      url = details.url;
      outDir = details.outDir;
    } else {
      outDir = path.resolve(outDir);
    }

    // Step 3: Options
    const options = await runScreenOptions();
    if (args.subpages) {
      options.includeSubpages = true;
    }

    // Step 4: Live Export
    const exportSummary = await runScreenExport({
      url,
      outDir,
      provider,
      options,
    });

    // Step 5: Optional AI conversion prompt assistant (same as direct CLI export command)
    await runAiPromptAssistant(exportSummary.exporter);

    // Step 6: Offer Framer -> Next.js conversion (interactive terminals only)
    await offerConversion(exportSummary.outDir);

    uiOutro(`Export completed successfully in ${exportSummary.outDir}!`);
  } catch (err) {
    if ((err as Error).name === 'ExitPromptError' || (err as Error).message?.includes('cancelled')) {
      uiCancelAndExit();
    }
    console.error('\n' + (err as Error).message);
    process.exit(1);
  }
}

// Auto-run if executed directly
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('src/cli-v2/index.ts')) {
  void runCliV2Workflow();
}

async function offerConversion(exportDir: string): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return;
  try {
    const { readFile } = await import('node:fs/promises');
    const report = JSON.parse(await readFile(path.join(exportDir, 'export-report.json'), 'utf8')) as {
      platform?: string;
    };
    if (report.platform !== 'framer') return;
  } catch {
    return;
  }
  if (!(await uiConfirm('Convert to a Next.js project now?'))) return;
  const { runPipeline } = await import('../convert/pipeline.js');
  await runPipeline(exportDir, exportDir + '-next', {
    confirm: (msg) => uiConfirm(msg, false),
    log: (msg) => console.log(msg),
  });
}
