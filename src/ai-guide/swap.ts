import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';

/**
 * Replaces `guideDir` with the finished build in three renames, so the old guide is never half
 * deleted: the old guide moves aside, the build moves in, then the old one is removed. If the
 * build cannot move in (a file locked on Windows), the old guide is moved back and the error is
 * thrown; the build folder is left where it is. `plan.md` comes over from the old guide (the
 * caller decides whether to overwrite it, so ticked progress survives).
 */
export async function swapIn(buildDir: string, guideDir: string): Promise<void> {
  const backup = `${guideDir}.old`;
  await fs.rm(backup, { recursive: true, force: true });
  const hadGuide = existsSync(guideDir);
  if (hadGuide) await fs.rename(guideDir, backup);
  try {
    await fs.rename(buildDir, guideDir);
  } catch (e) {
    if (hadGuide && !existsSync(guideDir)) await fs.rename(backup, guideDir);
    throw e;
  }
  if (hadGuide) {
    await fs.copyFile(`${backup}/plan.md`, `${guideDir}/plan.md`).catch(() => undefined);
    await fs.rm(backup, { recursive: true, force: true }).catch(() => undefined);
  }
}
