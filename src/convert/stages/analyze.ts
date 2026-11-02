import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PlatformAdapter, StageContext } from '../adapters/types.js';
import { saveState } from '../state.js';

export async function runAnalyze(
  ctx: StageContext,
  adapter: PlatformAdapter,
  opts?: { animations?: boolean }
): Promise<void> {
  const animations = process.env.FEXPORT_CONVERT_NO_ANIMATIONS === '1' ? false : (opts?.animations ?? true);
  const analysis = await adapter.analyze(ctx, { ...opts, animations });
  const dir = path.join(ctx.nextDir, '.convert', 'analysis');
  await mkdir(dir, { recursive: true });
  for (const key of ['pages', 'tokens', 'components', 'animations'] as const) {
    await writeFile(path.join(dir, `${key}.json`), JSON.stringify(analysis[key], null, 2) + '\n', 'utf8');
  }
  ctx.state.stages.analyze = 'done';
  await saveState(ctx.state);
  ctx.log('analyze complete');
}
