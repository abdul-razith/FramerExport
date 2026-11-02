import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PlatformAdapter, StageContext } from '../adapters/types.js';
import { saveState } from '../state.js';

export async function runAnalyze(
  ctx: StageContext,
  adapter: PlatformAdapter,
  opts?: { animations?: boolean }
): Promise<void> {
  const analysis = await adapter.analyze(ctx, opts);
  const dir = path.join(ctx.nextDir, '.convert', 'analysis');
  await mkdir(dir, { recursive: true });
  for (const key of ['pages', 'tokens', 'components', 'animations'] as const) {
    await writeFile(path.join(dir, `${key}.json`), JSON.stringify(analysis[key], null, 2) + '\n', 'utf8');
  }
  ctx.state.stages.analyze = 'done';
  await saveState(ctx.state);
  ctx.log('analyze complete');
}
