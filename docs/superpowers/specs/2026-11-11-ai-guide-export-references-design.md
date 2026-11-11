# AI guide v2: build from the export's own code — design

Date: 2026-11-11. Builds on `2026-11-10-ai-conversion-kit-design.md` (the AI guide v1).

## Why

The first AI build of nudge-folio (all 10 tasks done) kept the content but redesigned the look:
coloured zigzag panels became white cards, the mobile hero was used on desktop. Investigation found:

1. The guide gave text, images and screenshots, but no exact styles. The export holds them (about
   250 KB of Framer CSS per page), and the rules told the AI to use the export "for structure and
   text only".
2. The outline mixed the desktop, tablet and mobile copies Framer puts in the HTML
   (`ssr-variant hidden-*`) without saying which width shows what.
3. Sections were cut wrongly: a full-page wrapper as "Section 1", invisible 0×0 layers, the header
   and a 1440×900 overlay as page sections, an 1818px "Hero + About" as one step.
4. Text lists were noisy: ruler numbers 0–2800, clock readings, links repeated per copy.
5. `compare.mjs` took its screenshot without scrolling, so on-scroll animations stayed invisible
   and the AI build looked empty.
6. "Done" did not require any match: listing differences was enough.

## Goal

Paste a Framer URL → export → AI guide → the user runs the plan in Claude Code (or agy). The guide
points the AI at the exact export code (markup, CSS, animation settings) for every section, and the
AI must reach a measured match before a task is done. Generic for every Framer site.

## Decisions (from the user)

- References only: no converter draft. Each section maps to its export markup, CSS and animation code.
- Exact values: sizes, spacing and positions keep the export's values (`text-[52px]`); colours and
  fonts come from tokens.
- Gate: every section ≥ 90% pixel match at 1440, 1024 and 390, up to 3 fix rounds, leftovers reported.
- Setup with `npx create-next-app@latest` and a `src/` folder; all packages at latest at build time.
- Animations: both Framer's settings read from the export JS and the recorded timings/frames.
- Interactive parts: mapped from the export and recorded on the live site.
- Unchanged from v1: `--ai-guide` flag and `ai-guide <dir>` command, one plan task per page, superpowers
  plan format, normal exports and the rule-based converter untouched.

## Guide layout

```
AGENTS.md, CLAUDE.md                      rules (updated)
ai-guide/
  README.md site.md files.md content.md tokens.md checklist.md plan.md
  scripts/compare.mjs                     rewritten
  sections.json                           per page: section ids, boxes per width, live (masked) boxes
  pages/<slug>/
    desktop.png tablet.png mobile.png     full-page screenshots of the export at 1440/1024/390
    motion.md                             recorded timings (kept from v1), now per section
    frames/                               load, scroll, loop (kept from v1)
    sections/<NN>-<name>/
      ref.md                              the AI's entry point for this section
      markup.desktop.html  markup.tablet.html  markup.mobile.html   (only the copies that differ)
      styles.css
      shot-1440-1.png …  shot-1024-1.png …  shot-390-1.png …        900px-high slices
      states/<element>-<state>.png        interaction screenshots, when any
```

The shell (Task 1) gets the same folder per shared part under `ai-guide/shell/<NN>-<name>/`.

### `ref.md`

- **Where:** export file (`subpages/services.html`), the element (`data-framer-name`, class) and its
  line number in that file.
- **Widths:** for every element listed, `all`, `desktop`, `tablet`, `mobile` or a combination.
- **Content:** text, images (`assets/...` → `public/images/<readable>`), links; each once, cleaned
  (see Text cleaning). Generated values are marked `generated (clock)` with an example value.
- **Animations:** each Framer setting found for this section's classes, readable, e.g.
  `enter (in view, once): opacity 0→1, y 40→0, spring stiffness 200 damping 30, delay 0.2s`, with
  `source: scripts/vendor/<file>.mjs @ <offset>`. Under it the recorded timing for the same element
  from `motion.md`. When the JS could not be read: "not found in the export JS — use the recorded timing".
- **Interactive:** each element that reacts, its states, the classes or markup that differ per state,
  and `states/*.png`.
- **Build:** "Build from `markup.*.html` + `styles.css`: keep the element structure, convert the CSS to
  Tailwind with exact values, colours and fonts from tokens; put `data-section="NN"` on the root and
  `data-live` on generated elements."

### `markup.<width>.html`

The section element from the export HTML (parsed with `parse5`), for the Framer copy that width shows.
Removed: Framer runtime attributes (`data-framer-appear-id`, `data-framer-component-type`, hydration
comments, `style="transform:none"` and similar runtime inline styles). Kept: tag, `class`,
`data-framer-name`, `href`, `src`/`srcset`, `alt`, text. Pretty-printed with `prettier`. When all three
widths use the same markup, one `markup.html` is written.

### `styles.css`

Taken from the export's own stylesheets: the `<style>` blocks of the page's export HTML, read with a
small rule parser (no browser, no new dependency). Kept: rules whose selector uses a class of the
section's elements (including `framer-styles-preset-*` text presets and `:hover` rules). Grouped as
`/* all widths */`, `/* tablet ≤1199px */`, `/* mobile ≤809px */` by their media query; rules for
other media queries keep their own heading. Framer variables (`var(--token-…)`, font variables) are
replaced by the token names from `tokens.md`, with the raw value as a comment.

## Section split

From the merged capture tree:

1. Descend through wrappers: a node whose box is (nearly) the whole page and that has one or more
   section-like children is not a section; its children are.
2. Skip nodes that are 0×0 or `display:none` at all three widths.
3. Shared parts go to the shell, not the page: nodes found on every page (same `framer-name` +
   similar structure, existing `looseHash`), and `position: fixed` / full-viewport overlays
   (loader, menus, cursor, "buy" badges).
4. A section taller than 2 viewports (1800px at 1440) with 2+ large, similarly built children is split
   into those children (e.g. each project panel), named `<Parent> — <Child>`.

## Width labels

An element's widths come from the three captures: shown at a width when its box there is non-empty
and not `display:none`. Framer's copies (`ssr-variant` with `hidden-<id>` classes) are resolved by
reading which media query hides each `hidden-<id>` class in the export CSS. The markup file for a width
is the copy that width shows.

## Text cleaning

- Runs of 4+ numbers in arithmetic steps (rulers, scales) are dropped and noted once as
  "ruler 0–2800 (decoration)".
- Text that differs between captures or matches a time/date/counter pattern is `generated` with one
  example value; the element gets `data-live` in the build and is masked in comparisons.
- Text and links are listed once per element, not once per Framer copy.

## Animation extraction

The page's JS module is found in `scripts/vendor/` by the export's import map / the page's bundle
tag. For each section class (`framer-xxxx`), the extractor finds object literals in the module that
contain `className:"…framer-xxxx…"` (or reference it through a variant class map) and reads the
neighbouring `__framer__animate`, `__framer__animateOnce`, `__framer__enter`, `__framer__exit`,
`__framer__loop*`, `__framer__scrollTransform`/`__framer__transformTargets`, `initial`, `animate`,
`transition` objects by bracket matching on the source text (no new dependency). Values are turned
into readable lines (opacity, x/y, scale, rotate, delay, duration, spring stiffness/damping/mass,
easing, repeat). Anything it cannot parse is shown raw (max 300 characters) with its offset.

## Interaction recording

On the live site at 1440 (and 390 for menus): candidates are elements with a `:hover` rule in the
section's CSS, and elements with `cursor: pointer` that are not links and not inside a link. For each:
screenshot the section, hover (or click), wait 600 ms, screenshot; keep the pair when the pixels
differ by more than 0.5%. The page is reloaded before each click. Links are never followed. Limit:
20 candidates per page.

## Plan

- **Task 0 Setup:**
  `npx create-next-app@latest nextjs-app --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes`;
  then in `nextjs-app/`: `npm i motion gsap @gsap/react lenis @next/mdx @mdx-js/loader @mdx-js/react`,
  `npm i -D @types/mdx puppeteer pngjs pixelmatch`; tokens into `src/app/globals.css` (`@theme`) with
  `tablet` (max 1199px) and `mobile` (max 809px) variants; fonts; MDX in `next.config.ts`;
  `"compare": "node ../ai-guide/scripts/compare.mjs"`; `.gitignore`; commit.
- **Task 1 Shell:** one step per shared part from `ai-guide/shell/`.
- **One task per page**, one step per section. A section step: read `ref.md`, `markup.*.html`,
  `styles.css` and the slices → build `src/components/sections/<page>/<Name>.tsx` with content from
  `src/content/<page>.ts` → `npm run compare <route> --section NN` → fix and repeat, at most 3 rounds,
  until ≥ 90% at all three widths → tick the step and write the scores into it.
  Then: animations step (ref.md + motion.md), interactive states step, whole-page compare, commit.
- **One task per CMS collection**, then **Review**.
- Paths are under `src/`: `src/app`, `src/components/{layout,sections,ui,motion}`, `src/content`, `src/lib`.

## Rules (AGENTS.md / CLAUDE.md)

Changed from v1:
- Build each section from its `markup.*.html` + `styles.css`: same element structure, CSS converted to
  Tailwind with exact values, colours and fonts from tokens. Flex/grid and absolute positioning as the
  export uses them.
- Done means: build and lint pass, every section of the task ≥ 90% at 1440/1024/390 after at most
  3 fix rounds, sections still below are listed with their score and reason.
- Kept: no `framer-*` classes, Framer runtime scripts or inline style blobs in the result; content from
  `src/content`; animate only transform and opacity; respect reduced motion; superpowers execution
  and tracking; never edit the export or `ai-guide/` except ticking `plan.md` and `ai-guide/compare/`.

## compare.mjs

`npm run compare <route> [--section NN] [--base http://localhost:3000]` from `nextjs-app/`.

1. Open the route at 1440, 1024, 390 (viewport height 900). Scroll through the page in 400px steps
   (250 ms each), back to the top, wait for fonts and 1.5 s.
2. Hide `[data-live]` elements (`visibility:hidden`) on the build; paint the guide's live boxes from
   `sections.json` grey on both images.
3. Full-page screenshot. For each section: reference crop from the guide screenshot with the box in
   `sections.json`; build crop from the `[data-section="NN"]` element's box. Pad to the same size,
   `pixelmatch` (threshold 0.1), score = 1 − differing pixels / pixels.
4. Print a table `NN Name  1440: 93.1%  1024: 91.4%  390: 88.2% ✗` (✗ below 90%); missing
   `data-section` is reported as `not found`. Write `ai-guide/compare/<slug>-<NN>-<width>.png`
   (reference | build | diff) and the full-page side-by-side as before.
5. Exit code 0 always; the AI reads the table.

## Failure handling

- Each extractor runs per section inside try/catch; a failure writes "not available: <reason>" in
  that part of `ref.md`. One page failing writes a note in its folder; the guide is still written.
- Build into `.ai-guide-build/`, swap in on success; a failed run keeps the previous guide; `ERROR.md`
  on total failure; `plan.new.md` when `plan.md` has ticked boxes; the export is never modified (v1
  behaviour, kept).

## Testing

- Fixture site gains: a full-page wrapper, desktop/tablet/mobile `ssr-variant hidden-*` copies with
  their CSS, a page JS module with `__framer__animate`/`__framer__enter`/`__framer__loop` and a
  transition for a known class, an FAQ accordion (click changes state), a hover rule, a ruler and a
  clock, a fixed overlay, a tall section with 3 similar panels, a 0×0 layer.
- Unit tests: width labels and copy choice; CSS extraction keeps only matching rules and groups them
  by width; token replacement; animation lines for the fixture module (and raw fallback); text
  cleaning (ruler dropped, clock generated, no duplicates); splitter (wrapper descended, 0×0 skipped,
  overlay and header to shell, tall section split); plan text (create-next-app command, src paths,
  per-section compare loop); markup cleaning.
- Integration: guide for the fixture site has the expected section folders and files; the export is
  unchanged; `compare.mjs` against a small Next-free static build with on-scroll animations reports
  every section visible and scored, masks `data-live`.
- Real check: regenerate the nudge-folio guide from a fresh export and read home and services
  `ref.md`, `markup`, `styles.css` by eye.

## Out of scope

- Running the AI build itself (the user runs the plan).
- The rule-based converter (`--nextjs`), unchanged.
- Non-Framer platforms.

## Risks

- Framer's minified JS layout can change; the animation extractor falls back to raw text and the
  recorded timings.
- Pixel match punishes sub-pixel font differences; 90% leaves room, leftovers are reported, not hidden.
- Interaction recording can miss states that need typing or scrolling inside an element.
