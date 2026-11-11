import { BREAKPOINTS, type Breakpoint } from '../nextjs/model.js';

export interface TextItem {
  text: string;
  widths: Breakpoint[];
  /** Node key of the element holding the text. */
  key: string;
}

export interface Generated {
  text: string;
  kind: 'clock' | 'date' | 'counter' | 'changing';
}

const NUMBER = /^-?\d+(\.\d+)?$/;
const CLOCK = /^\d{1,2}:\d{2}(:\d{2})?\s?(AM|PM|am|pm)?$/;
const RULER_MIN = 4;

/** Indexes of runs of ≥ 4 consecutive numbers in arithmetic steps (rulers, scales). */
function rulerRuns(items: TextItem[]): [number, number][] {
  const runs: [number, number][] = [];
  let i = 0;
  while (i < items.length) {
    if (!NUMBER.test(items[i].text)) {
      i++;
      continue;
    }
    let j = i + 1;
    const step = j < items.length && NUMBER.test(items[j].text) ? Number(items[j].text) - Number(items[i].text) : NaN;
    while (j < items.length && NUMBER.test(items[j].text) && step !== 0 && Number(items[j].text) - Number(items[j - 1].text) === step) j++;
    if (j - i >= RULER_MIN) runs.push([i, j - 1]);
    i = Math.max(j, i + 1);
  }
  return runs;
}

/**
 * Cleans a section's texts for the guide: rulers become one decoration line, clocks and values that
 * differ between captures become `generated` (their elements are live), and the same text at several
 * widths is listed once. `variants` maps a node key to the texts it had in the other captures.
 */
export function cleanTexts(
  items: TextItem[],
  variants: Map<string, string[]>
): { texts: { text: string; widths: Breakpoint[] }[]; generated: Generated[]; liveKeys: string[]; decorations: string[] } {
  const decorations: string[] = [];
  const drop = new Set<number>();
  for (const [a, b] of rulerRuns(items)) {
    decorations.push(`ruler ${items[a].text}–${items[b].text}`);
    for (let k = a; k <= b; k++) drop.add(k);
  }
  const generated: Generated[] = [];
  const liveKeys: string[] = [];
  const merged = new Map<string, Set<Breakpoint>>();
  items.forEach((it, idx) => {
    if (drop.has(idx)) return;
    const others = variants.get(it.key) ?? [];
    const changes = others.some((o) => o !== it.text);
    if (CLOCK.test(it.text) || changes) {
      if (!liveKeys.includes(it.key)) liveKeys.push(it.key);
      if (!generated.some((g) => g.text === it.text)) generated.push({ text: it.text, kind: CLOCK.test(it.text) ? 'clock' : 'changing' });
      return;
    }
    const set = merged.get(it.text) ?? new Set<Breakpoint>();
    for (const w of it.widths) set.add(w);
    merged.set(it.text, set);
  });
  const texts = [...merged].map(([text, set]) => ({ text, widths: BREAKPOINTS.filter((bp) => set.has(bp)) }));
  return { texts, generated, liveKeys, decorations };
}
