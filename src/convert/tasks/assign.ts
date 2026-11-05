import type { GeneratedManifest, MotionAnchor } from '../generate/manifest.js';
import type { ScriptDrawn } from '../generate/script-drawn.js';
import { describeMotion } from './motion-values.js';

/**
 * Which task owns each matched motion anchor and script-drawn item, so that every
 * one appears in exactly one task:
 * - inside a section file (a section without parts, or a part) -> that section / part task, via its recorded ids
 * - inside a shell section -> the shell task (deduplicated across the shell's pages)
 * - anywhere else (inline or empty section, section root of an oversized section, no section) -> the page task of its route
 * Unmatched anchors are listed separately; they belong to the page task of their route.
 */
export interface TaskAssignment {
  shellMotion: Map<string, MotionAnchor[]>;
  shellScriptDrawn: Map<string, ScriptDrawn[]>;
  pageMotion: Map<string, MotionAnchor[]>;
  pageScriptDrawn: Map<string, ScriptDrawn[]>;
  unanchored: Map<string, MotionAnchor[]>;
}

const push = <T>(map: Map<string, T[]>, key: string, value: T): void => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

export function assignTaskContent(manifest: GeneratedManifest): TaskAssignment {
  const out: TaskAssignment = {
    shellMotion: new Map(),
    shellScriptDrawn: new Map(),
    pageMotion: new Map(),
    pageScriptDrawn: new Map(),
    unanchored: new Map(),
  };

  // Ids that live in a section file of their page (key: route + id).
  const inSectionFile = new Set<string>();
  const inSectionFileSd = new Set<string>();
  for (const page of manifest.pages) {
    for (const sec of page.sections) {
      if (sec.parts && sec.parts.length > 0) {
        for (const part of sec.parts) {
          for (const id of part.motion ?? []) inSectionFile.add(`${page.route}\0${id}`);
          for (const id of part.scriptDrawn ?? []) inSectionFileSd.add(`${page.route}\0${id}`);
        }
      } else {
        for (const id of sec.motion ?? []) inSectionFile.add(`${page.route}\0${id}`);
        for (const id of sec.scriptDrawn ?? []) inSectionFileSd.add(`${page.route}\0${id}`);
      }
    }
  }

  const shellFor = (name: string | null, route: string) =>
    name ? manifest.shell.find((sh) => sh.name === name && sh.pages.includes(route)) : undefined;

  const motionKey = (a: MotionAnchor): string => `${a.entry.framerName ?? ''}|${describeMotion(a.entry)}`;
  const sdKey = (sd: ScriptDrawn): string => `${sd.sample}|${sd.ticking}`;

  const seenShellMotion = new Map<string, Set<string>>();
  for (const a of manifest.motion ?? []) {
    if (!a.matched) {
      push(out.unanchored, a.route, a);
      continue;
    }
    const sh = shellFor(a.section, a.route);
    if (sh) {
      // Shell JSX comes from the first page: its anchors are the ones present in it;
      // anchors of other pages are kept only when they differ in name or values.
      const seen = seenShellMotion.get(sh.name) ?? new Set<string>();
      seenShellMotion.set(sh.name, seen);
      if (a.route === sh.pages[0]) {
        push(out.shellMotion, sh.name, a);
        seen.add(motionKey(a));
      }
      continue;
    }
    if (inSectionFile.has(`${a.route}\0${a.id}`)) continue;
    push(out.pageMotion, a.route, a);
  }
  // Second pass for the shell: other pages' anchors that differ from every first-page anchor.
  for (const a of manifest.motion ?? []) {
    if (!a.matched) continue;
    const sh = shellFor(a.section, a.route);
    if (!sh || a.route === sh.pages[0]) continue;
    const seen = seenShellMotion.get(sh.name)!;
    if (seen.has(motionKey(a))) continue;
    seen.add(motionKey(a));
    push(out.shellMotion, sh.name, a);
  }

  const seenShellSd = new Map<string, Set<string>>();
  for (const sd of manifest.scriptDrawn ?? []) {
    const sh = shellFor(sd.section, sd.route);
    if (sh && sd.route === sh.pages[0]) {
      push(out.shellScriptDrawn, sh.name, sd);
      const seen = seenShellSd.get(sh.name) ?? new Set<string>();
      seen.add(sdKey(sd));
      seenShellSd.set(sh.name, seen);
    }
  }
  for (const sd of manifest.scriptDrawn ?? []) {
    const sh = shellFor(sd.section, sd.route);
    if (sh) {
      if (sd.route === sh.pages[0]) continue;
      const seen = seenShellSd.get(sh.name) ?? new Set<string>();
      seenShellSd.set(sh.name, seen);
      if (seen.has(sdKey(sd))) continue;
      seen.add(sdKey(sd));
      push(out.shellScriptDrawn, sh.name, sd);
      continue;
    }
    if (inSectionFileSd.has(`${sd.route}\0${sd.id}`)) continue;
    push(out.pageScriptDrawn, sd.route, sd);
  }

  return out;
}
