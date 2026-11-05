import type { Browser } from 'puppeteer';
import type { GeneratedManifest, MotionAnchor } from '../generate/manifest.js';
import { motionIdsForTask } from '../tasks/assign.js';
import type { TaskRecord } from '../types.js';
import { checkMotion } from './motion-check.js';
import type { MotionResult } from './check.js';

/** Required motion ids, dropping anchors the generator could not match to a `data-motion` element. */
export function requiredMotionIds(
  manifest: GeneratedManifest | null,
  task: TaskRecord
): string[] {
  return motionIdsForTask(manifest, task);
}

/** Matched anchors the motion check should exercise for this task. */
export function taskMotionAnchors(
  manifest: GeneratedManifest | null,
  task: TaskRecord,
  sectionNames: string[],
  requiredMotion: string[]
): MotionAnchor[] {
  if (!manifest?.motion) return [];
  const matched = manifest.motion.filter((m) => m.matched);
  const candidates =
    task.kind === 'page'
      ? matched.filter((m) => m.route === task.route || (m.section && sectionNames.includes(m.section)))
      : matched.filter((m) => requiredMotion.includes(m.id));
  const seen = new Set<string>();
  const anchors: MotionAnchor[] = [];
  for (const a of candidates) {
    if (!seen.has(a.id)) {
      seen.add(a.id);
      anchors.push(a);
    }
  }
  return anchors;
}

/**
 * Runs the motion check on a fresh tab at 1440 px without `prepareCapture`: the capture page is left at
 * 390 px with reduced motion and a frozen `Date`, which would stall GSAP timelines.
 */
export async function runMotionOnFreshPage(
  browser: Browser,
  url: string,
  anchors: MotionAnchor[]
): Promise<MotionResult[]> {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1440, height: 900 });
    return await checkMotion(page, url, anchors);
  } finally {
    await page.close().catch(() => {});
  }
}
