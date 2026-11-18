# Model-Independent Rebuild — Design

**Date:** 2026-11-18
**Status:** Agreed (points 1, 2, 4 approved; 3, 5, 7 folded in; 6 deferred)
**Plan:** `docs/superpowers/plans/2026-11-18-model-independent-rebuild.md`

## Summary

No LLM gives byte-identical code, so the goal is that every model's rebuild passes the same automated
checks against the original site. Today the tool leaves key decisions (animation timing, naming,
reuse) to the model and lets the model grade itself, so Claude and Gemini produced visibly different
sites from the same Framer export.

The fix has three parts:

1. **The tool decides more.** Exact animation transitions are read from the export and emitted as
   generated code (points 2 and 3).
2. **The model decides less.** The rule-based `--nextjs` converter becomes the starting point; the LLM
   only renames and splits components (point 1).
3. **Scripts check the rest.** Lint-style checks and a score file written by the scripts decide "done", not the model's own
   notes (points 4 and 5).

## Why Claude and Gemini differed

Reference site: Clara & Theo (`framer-clara-theo-fresh-copy-1w5u-claude` vs
`wedding-web-3.8high-gemini`). Layout came through for both: the hero in each version has the same values
(`h-[959px] tablet:h-[880px] pt-[168px] gap-[20px]`). Every difference sits where the guide left a
decision to the model, or stated a rule that nothing checks.

| Area | What the guide gave | Claude | Gemini | Root cause |
| --- | --- | --- | --- | --- |
| Hero animation timing | Start state only (`appear: opacity 0.001, y 54`); `motion.md` gives timings measured on the live page | 1.2 s; 1.4 s with 0.15 s delay — matches Framer exactly | 1.96 s / 1.2 s / 2.96 s, all with 0.957 s delay — copied from `motion.md` | Exact values are in `index.html` (`__framer__appearAnimationsContent`); the tool never reads that block |
| Text style names | Hash class names in `text-styles.css` | Readable utilities (`text-hero-title`) | Kept hashes (`text-preset-1hdy2yg`) | Rule 5 is prose only |
| Content | "All text from `src/content`" | Followed | "Clara & Theo" hardcoded in `HomeHero.tsx`, `HomeFooter.tsx` | Rule 6 is prose only |
| Reuse | "Anything used twice becomes a ui component" | One `GalleryPrint` | `HomeGalleryPrint1…5.tsx`, 74–84 lines each | Plan lists one step per print; the model mirrors it |
| Images | Nothing stated | `next/image` | Raw `<img>` in 10 files | No rule, no check |
| Progress | 61-step plan, model writes its own scores | 60 of 61 ticked with scores | Not checkable: no `ai-guide/` beside the app | Model grades itself |

The exact hero settings in the export:

- Photo `framer-a4be70`: `delay 0.1, duration 2.6, ease [0.2,0.7,0.1,1]`, 4 breakpoint variants
- Eyebrow `framer-mcrxlu`: `delay 0, duration 1.2`
- Title `framer-4kv6xh`: `delay 0.15, duration 1.4`

`grep -rn "appearAnimationsContent" src` returns nothing: the tool never reads this block.

The parity report flags Claude's hero as starting ~530 ms early. That comes from the 957 ms page-load offset in
the live recording, not from a wrong value. Measured timings should be used to check, not to specify.

## Is the guide the same for the same site?

| Source | Files | Same every run? | Why |
| --- | --- | --- | --- |
| Read from export HTML/CSS/JS | `markup*.html`, `styles.css`, `tokens.md`, `text-styles.css`, `## Content`, start states, `sections.json`, `plan.md`, `files.md` | Yes | Pure parsing of fixed files |
| Measured on the live page | `motion.md` timings, `frames/` | No | `record.ts` uses `Date.now()` / `performance.now()`; slow runs truncate |
| Measured on the live page | Screenshots, compare baselines | No | Image load timing; live text such as the countdown |
| Measured on the live page | `## Interactive` | No | `interactions.ts` waits fixed 120 / 300 / 800 ms |
| Measured across captures | "Generated" text | No | `text-clean.ts` marks text that differs between captures |
| The site itself | Class hashes, bundle names, `@ offset` | Changes on republish | Framer rebuilds its bundle |

For a fair model comparison, export once and give every model a copy of the same folder.

## Decisions

| # | Suggestion | Decision | Reason | Plan task |
| --- | --- | --- | --- | --- |
| 2 | Exact animation values in the guide | In, first | Biggest visible difference; values already in `index.html` | Task 1 |
| 3 | Generated motion presets + `<Appear>` | Folded into 2 | It is the output format of point 2 | Task 2 |
| 1 | Rule-based `--nextjs` converter as main path | In | Same code every run; LLM only renames | Task 3 |
| 4 | Rules as failing checks | In | Models skip prose rules, not failing checks | Task 4 |
| 5 | Scripts write scores, not the model | With 4 | Same pass/fail for every model | Task 5 |
| 7 | Instruction files for each agent | Add-on | Helps models find rules; does not enforce | Task 6 |
| 6 | Smaller per-section prompts | Deferred | After 1 + 4 the LLM only cleans up; revisit if gate fails on some section types | — |

## Success criteria

| Check | How | Pass |
| --- | --- | --- |
| Same guide | Export Clara & Theo twice; diff `ai-guide/` excluding `frames/`, screenshots, `motion.md` | No differences |
| Exact timing | Hero `ref.md` and `presets.ts` | Photo shows `delay 0.1`, `duration 2.6`, `ease [0.2,0.7,0.1,1]` |
| Rules enforced | `check.mjs` on the current Gemini rebuild | Fails on framer names, raw `<img>`, hardcoded content, duplicate prints |
| Model-independent result | Rebuild with Claude and Gemini from one copy of the guide; `npm run gate` on each | Both exit 0 |
| Same motion | `parity` on both rebuilds | Hero motion items 0, apart from the page-load offset |

## Open questions and risks

- **Converter quality is unknown.** Task 3 Step 1 measures `to-nextjs` scores before any change. If most
  sections fall below 90%, Task 3 shrinks to the sections that pass.
- **In-view transitions.** Task 1 covers on-load (appear) animations from the HTML block. In-view
  (`enter`) transitions come from the JS bundle; some use variable references (`animate: ec`) the
  parser may not resolve. Check coverage during Task 1.
- **Scroll and code overrides** still need the model; candidates if point 6 is revived.
- **Task order.** Open: run Task 4 (checks) before Task 3 (converter) so the converter can be measured
  by the checks? Proposed order 1 → 2 → 4 → 5 → 3 → 6.
- **Gemini's original run** kept no `ai-guide/`; keep the guide with every rebuild from now on.
