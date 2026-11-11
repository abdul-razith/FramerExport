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
   (FadeIn, Reveal, TypingText…), \`src/content/<page>.ts\`, \`src/content/<collection>/<slug>.mdx\`,
   \`src/lib/\`.
4. **Build from the export's code.** Each section has a folder (\`ai-guide/pages/<page>/sections/<id>-<name>/\`,
   shell parts in \`ai-guide/shell/\`) with \`ref.md\`, \`markup*.html\` (the export's markup for the
   widths named in the file) and \`styles.css\` (only the export's CSS rules for that section, by
   width). Keep the element structure of the markup and convert its CSS to Tailwind classes with
   **exact values** (\`text-[52px]\`, \`gap-[18px]\`, \`rotate-[-4deg]\`): flex, grid and absolute
   positioning exactly where the export uses them. Colours and fonts only through the tokens; the
   text styles from \`ai-guide/text-styles.css\` through the utilities made in Task 0. Desktop first:
   rules under "all widths" (and "desktop ≥1200px") are the plain classes; "tablet 810–1199px" rules
   become \`tablet:\` classes; "mobile ≤809px" rules become \`mobile:\` classes; "tablet + mobile
   ≤1199px" rules apply to both, so write them with both \`tablet:\` and \`mobile:\`. Where a
   section has different markup per width (\`markup.desktop.html\`, \`markup.tablet-mobile.html\`), show
   the right one per width.
5. **Clean code.** Meaningful component and prop names; anything used twice becomes a
   \`src/components/ui\` component; files under about 200 lines. Never copy Framer runtime scripts,
   framer-* class names, \`ssr-variant\`/\`hidden-*\` wrappers or inline style blobs into the project.
6. **Content.** All text, images and links come from \`src/content/*.ts\` or MDX, copied exactly from
   the \`## Content\` part of each \`ref.md\`; components get content through props. Copy images from
   \`assets/\` to \`public/images/\` with the readable names in \`ai-guide/files.md\`. Text marked
   "generated" (clocks, counters) is built as a small component, not content.
7. **Animation.** Use the Framer settings in each \`ref.md\` \`## Animations\` part (exact values and
   timing) and check them against the page's \`motion.md\` and frames. Animate only transform and
   opacity. Respect \`prefers-reduced-motion\` (no movement, content visible). Rebuild every state in
   \`## Interactive\` (hover, open/closed) to match its screenshots.
8. **Measure.** Put \`data-section="<id>"\` on each section's root element and \`data-live\` on
   generated elements, then run \`npm run compare -- <route> --section <id>\` (with \`npm run dev\`
   running). A section is done at **90% or more at 1440, 1024 and 390**. Fix and compare again, at
   most 3 fix rounds; if it is still below, write down its scores and the reason and move on.
9. **Done means.** In \`nextjs-app/\`: \`npm run build\` and \`npm run lint\` pass; every section of the
   task reached the 90% gate or is listed with its scores and reason; only the files the task names
   were changed.
10. **Never.** Add a dependency the task does not name without saying why; edit the export or
   \`ai-guide/\` (except ticking boxes in \`plan.md\`, and the images \`npm run compare\` writes to
   \`ai-guide/compare/\`); invent content; leave placeholder text or TODOs.
`;
