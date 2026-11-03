import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PlatformAdapter, StageContext } from '../adapters/types.js';
import { saveState } from '../state.js';

export async function runAnalyze(
  ctx: StageContext,
  adapter: PlatformAdapter,
  opts?: { animations?: boolean }
): Promise<void> {
  const animations = process.env.FEXPORT_CONVERT_NO_ANIMATIONS === '1' ? false : (opts?.animations ?? true);
  const dir = path.join(ctx.nextDir, '.convert', 'analysis');
  // Slices are rewritten from scratch: a component renamed or dropped since the last run must not leave its file behind.
  await rm(path.join(dir, 'slices'), { recursive: true, force: true });
  const analysis = await adapter.analyze(ctx, { ...opts, animations });
  await mkdir(dir, { recursive: true });
  for (const key of ['pages', 'tokens', 'components', 'animations'] as const) {
    await writeFile(path.join(dir, `${key}.json`), JSON.stringify(analysis[key], null, 2) + '\n', 'utf8');
  }
  ctx.state.stages.analyze = 'done';
  await saveState(ctx.state);
  ctx.log('analyze complete');
}
