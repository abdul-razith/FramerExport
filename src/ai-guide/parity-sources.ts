import type { ExportAnimation } from './export-motion.js';
import type { MarkupCopy } from './export-markup.js';
import type { InteractionState } from './interactions.js';

/** Where in the export each part of a section comes from: parity.mjs points every difference here. */
export interface SectionSources {
  /** The section's guide folder (`ai-guide/pages/<page>/sections/<id>-<name>`). */
  folder: string;
  /** `<export file>:<line>` of the section element. */
  markup?: string;
  styles: string;
  animations: { label: string; kind: string; at: string }[];
  hovers: { element: string; at: string }[];
}

/** `ai-guide/parity/sources.json`: per route, per section id. */
export type ParitySources = Record<string, Record<string, SectionSources>>;

export function parityEntry(input: {
  folder: string;
  exportFile: string;
  markup: MarkupCopy[] | Error;
  animations: ExportAnimation[] | Error;
  states: InteractionState[];
  hoverClasses: string[];
}): SectionSources {
  const { folder } = input;
  const first = input.markup instanceof Error ? undefined : input.markup[0];
  return {
    folder,
    ...(first ? { markup: `${input.exportFile}:${first.line}` } : {}),
    styles: `${folder}/styles.css`,
    animations:
      input.animations instanceof Error
        ? []
        : input.animations.map((a) => ({
            label: a.layer || a.className,
            kind: a.kind === 'override' && a.override ? `override ${a.override.name}` : a.kind,
            at: `${a.file} @ ${a.offset}`,
          })),
    hovers: [
      ...input.hoverClasses.map((c) => ({ element: c, at: `${folder}/styles.css (:hover)` })),
      ...input.states.map((s) => ({ element: s.element, at: `${folder}/${s.before}` })),
    ],
  };
}
