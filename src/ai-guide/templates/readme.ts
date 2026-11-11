import { planTasks } from '../plan.js';
import type { GuideSite } from '../types.js';

/** ai-guide/README.md: how the user runs the conversion. */
export function renderReadme(site: GuideSite): string {
  const tasks = planTasks(site);
  return `# Rebuild ${site.name} as a Next.js project with an AI agent

This export contains the Framer site as HTML **and** a guide that lets an AI coding agent
(Claude Code or agy) rebuild it as a clean, editable Next.js project in \`nextjs-app/\`,
one page per task. You run each task and check it.

## What is where

| Path | What it is |
| --- | --- |
| \`index.html\`, \`subpages/\` | The exported pages: the markup each section is built from. |
| \`assets/\` | Images, fonts and videos. |
| \`data/\`, \`scripts/\` | Framer CMS data and runtime — never copied into the project (\`scripts/vendor/\` holds the animation settings the guide reads). |
| \`AGENTS.md\`, \`CLAUDE.md\` | The rules the agent follows (same text; Claude Code reads CLAUDE.md, agy reads AGENTS.md). |
| \`ai-guide/site.md\` | Pages, sections, navigation, footer, shell parts, shared sections, CMS pages, task list. |
| \`ai-guide/files.md\` | Which export file holds what; image names for the project. |
| \`ai-guide/content.md\` | CMS collections, their items and fields. |
| \`ai-guide/tokens.md\` | Colours, fonts, radii and shadows with token names. |
| \`ai-guide/text-styles.css\` | Framer's text styles (presets), once for the whole site. |
| \`ai-guide/pages/<page>/\` | Per page: screenshots at 1440/1024/390, \`motion.md\`, recorded frames, and \`sections/<id>-<name>/\`. |
| \`ai-guide/pages/<page>/sections/<id>-<name>/\` | Per section: \`ref.md\` (where it is in the export, widths, content, Framer animation settings, interactive states), \`markup*.html\` (its export markup per width), \`styles.css\` (its export CSS by width), 900px screenshot slices, \`states/\`. |
| \`ai-guide/shell/\` | The same, for parts shared by every page (header, footer, loader, page background). |
| \`ai-guide/sections.json\` | Section boxes per width, used by the compare script. |
| \`ai-guide/plan.md\` | The tasks, as a superpowers plan with checkboxes. |
| \`ai-guide/checklist.md\` | What to check after each task. |
| \`ai-guide/scripts/compare.mjs\` | Scores each section of your page against the original (90% gate) and saves side-by-side images. |
| \`nextjs-app/\` | The Next.js project — created by the agent in task 0. |

## The tasks

${tasks.map((t) => `${t.number}. ${t.title}`).join('\n')}

## Before you start

1. Make the export folder a git repository so every task can be committed and undone:
   \`git init && git add -A && git commit -m "Framer export + AI guide"\`.
2. Install the superpowers plugin:
   - **Claude Code:** run \`/plugin\`, find **superpowers** in the marketplace and install it.
   - **agy:** follow the superpowers README's Antigravity instructions.
3. Node.js 20 or newer must be installed (puppeteer, used by the compare script, downloads its own browser).

## Run it

Open this folder in Claude Code (\`claude\`) or agy and say:

> Execute ai-guide/plan.md with superpowers, next task.

The agent does one task, ticks its steps in \`plan.md\`, and reports. Then you check it.

**Without the superpowers plugin:** ask the agent to follow \`ai-guide/plan.md\` by hand —
the same tasks, in the same order, with the same checks.

## Check each task

Follow \`ai-guide/checklist.md\`: run \`npm run dev\` in \`nextjs-app/\`, then
\`npm run compare -- <route>\`: every section should score 90% or more at 1440, 1024 and 390 (the agent
lists any that do not, with the reason). Look at the images in \`ai-guide/compare/\`, then
\`git commit\` and ask for the next task.

## If a task goes wrong

Tell the agent what is wrong, or discard the task: \`git checkout .\` (and \`git clean -fd\` for new
files), untick its steps in \`ai-guide/plan.md\`, and run it again with a note about what to fix.

## Re-running the guide

\`framer-export ai-guide <this folder>\` regenerates \`ai-guide/\`. If \`plan.md\` already has ticked
steps it is kept, and the new plan is written to \`plan.new.md\`. \`nextjs-app/\` is never touched.
`;
}
