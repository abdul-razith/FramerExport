/** Written as AGENTS.md (agy and other agents) and CLAUDE.md (Claude Code) at the export root. */
export const AGENTS_MD = `# Rules for building this site's Next.js project

This folder is an HTML export of a Framer site plus a guide (\`ai-guide/\`) for rebuilding it as a
clean, editable Next.js project. You build that project in \`nextjs-app/\`.

## Start here

1. Read \`ai-guide/README.md\` (section "What is where") and \`ai-guide/site.md\`.
2. Execute \`ai-guide/plan.md\` — one task at a time, in order.

## Rules

1. **Work order and tracking (superpowers).** \`ai-guide/plan.md\` is a superpowers implementation
   plan. Execute it with \`superpowers:executing-plans\` (or \`superpowers:subagent-driven-development\`
   when you can run subagents): one task at a time, in order. Read the files a task lists before
   writing code. Tick each step's checkbox in \`plan.md\` when it is done. Use
   \`superpowers:verification-before-completion\` before you call a task complete, and
   \`superpowers:systematic-debugging\` when a build, lint or visual check fails. Stop after each
   task and report, unless the user asked you to continue.
2. **Stack.** The project lives in \`nextjs-app/\`: Next.js 16 App Router, React 19, TypeScript.
   Server components by default; \`'use client'\` only where there is animation or interaction.
   Tailwind 4 with the tokens from \`ai-guide/tokens.md\`. motion for load, hover and in-view
   animation; GSAP ScrollTrigger only for animation linked to scroll position; Lenis for smooth
   scroll; \`@next/mdx\` for CMS content. Task 0 pins the exact versions.
3. **Structure.** \`components/layout\` (Navbar, Footer, Loader), \`components/sections/<page>\`
   (e.g. \`HomeHeroSection\`), \`components/ui\` (Button, Tag, Card…), \`components/motion\` (FadeIn,
   Reveal, TypingText…), \`content/<page>.ts\`, \`content/<collection>/<slug>.mdx\`, \`lib/\`.
4. **Clean code.** Lay out with flex and grid, the spacing scale and \`max-w-*\` containers. Use
   absolute positioning only for decoration that really overlaps (stickers, tags around a
   heading). Desktop-first with \`tablet:\` (max 1199px) and \`mobile:\` (max 809px) variants; the
   layout must stay fluid between the reference widths 1440, 1024 and 390. Colours only from
   tokens, never raw hex. Meaningful names. Anything used twice becomes a \`components/ui\`
   component. Keep files under about 200 lines.
5. **Content.** All text, images and links come from \`content/*.ts\` or MDX, copied exactly from
   the outline or the export; components get content through props. Copy images from
   \`assets/\` to \`public/images/\` with the readable names in \`ai-guide/files.md\`.
6. **Framer leftovers.** Never copy Framer runtime scripts, framer-* class names, generated CSS or
   inline style blobs from the export. The export HTML is a reference for structure and text only.
7. **Animation.** Follow the page's \`motion.md\` and look at its frames. Animate only transform
   and opacity. Respect \`prefers-reduced-motion\` (no movement, content visible).
8. **Done means.** In \`nextjs-app/\`: \`npm run build\` and \`npm run lint\` pass; \`npm run compare
   <route>\` was run for the task's routes and you list the visible differences that remain;
   only the files the task names were changed.
9. **Never.** Add a dependency the task does not name without saying why; edit the export or
   \`ai-guide/\` (except ticking boxes in \`plan.md\`, and the images \`npm run compare\` writes to
   \`ai-guide/compare/\`); invent content; leave placeholder text or
   TODOs.
`;
