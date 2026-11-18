/** Written as AGENTS.md (agy and other agents) and CLAUDE.md (Claude Code) at the export root. */
export const AGENTS_MD = `# Rules for building this site's Next.js project

This folder is an HTML export of a Framer site plus a guide (\`ai-guide/\`) for rebuilding it as a
clean, editable Next.js project that looks and moves like the original. You build that project in
\`nextjs-app/\`.

## Start here

1. Read \`ai-guide/README.md\` (section "What is where") and \`ai-guide/site.md\`.
2. Execute \`ai-guide/plan.md\` — one task at a time, in order.

## Rules

1. **Work order and tracking (superpowers).** \`ai-guide/plan.md\` is a superpowers implementation
   plan. Execute it with \`superpowers:executing-plans\` (or \`superpowers:subagent-driven-development\`
   when you can run subagents): one task at a time, in order. Read the files a step lists before
   writing code. Tick each step's checkbox in \`plan.md\` when it is done. Use
   \`superpowers:verification-before-completion\` before you call a task complete, and
   \`superpowers:systematic-debugging\` when a build, lint or visual check fails. Stop after each
   task and report, unless the user asked you to continue.
2. **Stack.** The project lives in \`nextjs-app/\`, created with \`create-next-app@latest\` (Task 0):
   Next.js App Router with a \`src/\` folder, React, TypeScript. Server components by default;
   \`'use client'\` only where there is animation or interaction. Tailwind CSS with the tokens from
   \`ai-guide/tokens.md\`. motion for load, hover and in-view animation; GSAP ScrollTrigger only for
   animation linked to scroll position; Lenis for smooth scroll; \`@next/mdx\` for CMS content.
3. **Structure.** \`src/components/layout\` (Navbar, Footer, Loader…), \`src/components/sections/<page>\`
   (e.g. \`HomeHeroSection\`), \`src/components/ui\` (Button, Tag, Card…), \`src/components/motion\`
   (\`Appear.tsx\` and \`presets.ts\` copied unchanged from \`ai-guide/motion/\`, plus motion components
   that use them), \`src/content/<page>.ts\`, \`src/content/<collection>/<slug>.mdx\`,
   \`src/lib/\`.
4. **Build from the export's code.** Each section has a folder (\`ai-guide/pages/<page>/sections/<id>-<name>/\`,
   shell parts in \`ai-guide/shell/\`) with \`ref.md\`, \`markup*.html\` (the export's markup for the
   widths named in the file) and \`styles.css\` (only the export's CSS rules for that section, by
   width). Keep the element structure of the markup and convert its CSS to Tailwind classes with
   **exact values** (\`text-[52px]\`, \`gap-[18px]\`, \`rotate-[-4deg]\`): flex, grid and absolute
   positioning exactly where the export uses them. Colours and fonts only through the tokens; the
   text styles from \`ai-guide/text-styles.css\` through the utilities made in Task 0. Desktop first:
   rules under "all widths" (and "desktop ≥1200px") are the plain classes; "tablet 810–1199px" rules
   become \`tablet:\` classes; "mobile ≤809px" rules become \`mobile:\` classes;
   "tablet + mobile ≤1199px" rules apply to both, so write them with both \`tablet:\` and \`mobile:\`. Where a
   section has different markup per width (\`markup.desktop.html\`, \`markup.tablet-mobile.html\`), show
   the right one per width.
5. **Clean code.** Meaningful component and prop names; anything used twice becomes a
   \`src/components/ui\` component; files under about 200 lines. Never copy Framer runtime scripts,
   framer-* class names, \`ssr-variant\`/\`hidden-*\` wrappers or inline style blobs into the project.
6. **Content.** All text, images and links come from \`src/content/*.ts\` or MDX, copied exactly from
   the \`## Content\` part of each \`ref.md\`; components get content through props. Copy images from
   \`assets/\` to \`public/images/\` with the readable names in \`ai-guide/files.md\`. Text marked
   "generated" (clocks, counters) is built as a small component, not content.
7. **Animation.** An animation whose \`ref.md\` line ends with \`preset: <key>\` is built with
   \`<Appear preset="<key>">\` from \`src/components/motion/\`: never type a duration, delay or ease
   for it, the preset holds Framer's exact values. For the others (no preset, hover, open/closed),
   use the Framer settings in each \`ref.md\` \`## Animations\` or \`## Interactive\` part and check
   them against the page's \`motion.md\` and frames; mark each timing you type with
   \`// check-allow no-typed-timing: <reason>\` on the line above, naming the ref.md it comes from
   (\`npm run gate\` lists them). Animate only transform and
   opacity. Respect \`prefers-reduced-motion\` (no movement, content visible). Rebuild every state in
   \`## Interactive\` (hover, open/closed) to match its screenshots. Build a section's animations in
   the same step as the section, not later: a section whose ref.md lists animations is only done
   when \`npm run compare\` prints \`motion ✓\` for it (\`motion ✗\` = nothing in it moved).
8. **Measure.** Put \`data-section="<id>"\` on each section's root element and \`data-live\` on
   generated elements, then run \`npm run compare -- <route> --section <id>\` (with \`npm run dev\`
   running). A section is done at **90% or more at 1440, 1024 and 390**. Fix and compare again, at
   most 3 fix rounds; if it is still below, add it to \`ai-guide/results/accepted.json\` with the
   reason and move on (accepted only at 80% or more at every width). Then
   \`npm run parity -- <route>\` compares the whole page with the original site (section spacing,
   everything that moves, hover changes) and writes \`ai-guide/parity/<page>.md\`, each item
   pointing into the export. Layout and interaction items must be fixed (the gate fails on them);
   motion items are advisory: fix those that point at your code, a constant start offset is the
   original's load time.
9. **Done means.** In \`nextjs-app/\`: \`npm run build\` and \`npm run lint\` pass, then \`npm run gate\`
   exits 0. The gate reads the numbers \`npm run compare\` and \`npm run parity\` recorded in
   \`ai-guide/results/\` (scores you type into \`plan.md\` do not count) and runs \`npm run check\`,
   which turns rules 5–7 into failures: Framer class names, \`<img>\`, page text in components,
   duplicate components, missing \`data-section\`, timing typed by hand. A section still below 90%
   after 3 fix rounds goes in \`ai-guide/results/accepted.json\` as \`{ "<route>#<id>": "<reason>" }\`.
   Only the files the task names were changed.
10. **Never.** Add a dependency the task does not name without saying why; edit the export or
   \`ai-guide/\` (except ticking boxes in \`plan.md\`, \`ai-guide/results/accepted.json\`, and what
   \`npm run compare\` and \`npm run parity\` write themselves to \`ai-guide/compare/\`,
   \`ai-guide/parity/\` and \`ai-guide/results/\`); edit \`ai-guide/results/<page>.json\` by
   hand; invent content; leave placeholder text or TODOs.
`;
