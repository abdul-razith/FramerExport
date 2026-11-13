# AI guide v3: parity report — design

Date: 2026-11-13. Builds on `2026-11-11-ai-guide-export-references-design.md` (the AI guide v2).

## Why

After the v2 guide and today's animation fixes, the nudge-folio rebuild matches about 90%. The rest is
spacing between sections, micro animations and interactive (hover/press) animations. Investigation
found why the tools could not close that gap:

1. `compare.mjs` scores each section cropped to its own box. A section can match perfectly while it
   sits 40px too low, so gaps between sections are never measured.
2. `motion ✓` only proves that something in a section moves, not that everything the original moves
   does (a hero with 2 of its 15 animations passes).
3. The converter knows a fixed set of animation patterns (Framer effects, code overrides, text
   effects) plus a recording at 1440 that never hovers or clicks. Hover/press variants of Framer
   components, custom code components and width-only animations go unseen.

Every one of these can be measured automatically, by visiting the original and the rebuild with the
same headless browser and listing the differences, each pointing to the export's own source.

## Goal

One command, `npm run parity -- <route>`, run in `nextjs-app/` like `compare`, writes
`ai-guide/parity/<page>.md`: every layout, motion and interaction difference between the original
site and the rebuild, at 1440, 1024 and 390, each with a pointer into the export. A page is done when
its report is empty (apart from items marked "cannot match"). Generic for every Framer site.

## Decisions (from the user)

- Option A (parity report) over teaching the converter every pattern (B) or shipping Framer's
  runtime (C). Fully automated with a headless browser; nothing is compared by eye.
- Each difference points into the export: section folder, markup line, `styles.css` rule, animation
  setting `file @ offset`, code override source, `:hover` rule or component variant.
- The report lives in `ai-guide/`; the plan gets a final parity step per page that is only done when
  the report is empty.
- Not covered: random or clock-driven things (listed as "cannot match"), and exact timing (only
  differences over about 100 ms are flagged).

## Design

### Inputs

- The original URL (`sourceUrl` from `ai-guide/site.md`; the guide writes it into `sections.json`).
- `sections.json`, extended per section with `className` (the export root class) so original elements
  can be mapped to a section; the rebuild uses `data-section`.
- Per section, from the guide build: a source index (export markup file + line, the section's
  `styles.css`, animation settings and override sources with `file @ offset`), written to
  `ai-guide/parity/sources.json` by the converter, so the script needs no parsing at run time.

### Three checks (each at 1440, 1024, 390)

1. **Layout.** For every section on both sites: page top and height. Flag a section whose top or
   height differs by more than 4px, with both values and the delta. The first section whose top
   differs is the cause; the rest inherit it, so the report names the first and says the rest
   follow. Pointer: the section's `styles.css` padding/margin/gap rules and markup line.
2. **Motion.** The watcher already used by `compare.mjs` and the recorder, run during load, a slow
   scroll to the bottom and a 2 s rest, on both sites. Elements are matched by section, then by
   layer name and text (split letters grouped into their text). Flag: moves on the original but not
   on the rebuild; moves on the rebuild but not on the original; start differs by more than 100 ms.
   Pointer: the matching animation setting, text effect or code override in `sources.json`.
3. **Interaction.** In each section, every link, button and element the guide lists in `## Interactive`
   or that has a `:hover` rule or variant: hover it (and press, for buttons and cards) on both sites;
   compare the element's box, colours, transform and a cropped screenshot before and after. Flag
   changes on the original that do not happen (or differ) on the rebuild. Pointer: the `:hover` rule
   in `styles.css` or the variant in the export JS. Images: `ai-guide/parity/<page>/<id>-<n>.png`
   (original | rebuild).

### Output

`ai-guide/parity/<page>.md`: a summary line, then per section the three lists, each item one line
with what differs, the values, and the pointer. Ends with "cannot match" items (random positions,
clocks, live data). Exit code 0 always; the console prints the counts per section.

### Converter changes

- Write `sources.json` and `className` in `sections.json`; write `scripts/parity.mjs` next to
  `compare.mjs` and a `parity` script in the plan's setup step.
- Plan: each page task ends with a "Parity" step: run it, fix each item from its pointer, run again,
  done when empty; AGENTS.md and the checklist say the same.

### Testing

- Unit: layout diff (first cause, tolerance), motion matching (letters grouped, timing tolerance),
  report rendering with pointers.
- Integration: two local fixture pages (original / rebuild) that differ in one gap, one in-view
  animation and one hover; the report lists exactly those three with their pointers.
- Real run: nudge-folio, all 9 pages; the report must list the known gaps from today's audit.

## Left to the builder

Matching heuristics beyond layer name and text, the exact report wording, and how many interaction
targets to try per section (cap to keep a page under about 2 minutes).
