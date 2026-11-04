import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

// Templates are embedded as string constants so tsup's TS-only bundle needs no asset copying.
// `{{var}}` placeholders are filled by renderTemplate (src/convert/stages/tasks.ts).

const NPX_INVOCATION = 'npx -p framer-export fexport convert';

/** Nearest ancestor directory of `file` whose package.json is named framer-export, or null. */
function findPackageRoot(file: string): string | null {
  let dir = path.dirname(file);
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as { name?: string };
      if (pkg.name === 'framer-export') return dir;
    } catch {}
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * How generated task files, AGENTS.md and fix files tell the user to run the CLI.
 * - FEXPORT_CLI_INVOCATION overrides everything.
 * - Running from a local checkout (the package root is not inside node_modules) runs that checkout's own bin
 *   with node: the published npm package may be older and have no `convert` command.
 * - Otherwise `-p framer-export` pins the package: a bare `npx fexport` could resolve an unrelated registry
 *   package named `fexport`.
 */
export function resolveCliInvocation(opts: { argv1?: string; env?: NodeJS.ProcessEnv } = {}): string {
  const override = opts.env?.FEXPORT_CLI_INVOCATION;
  if (override) return override;
  if (!opts.argv1) return NPX_INVOCATION;
  let real = opts.argv1;
  try {
    real = realpathSync(opts.argv1);
  } catch {}
  const root = findPackageRoot(real);
  if (!root || root.split(path.sep).includes('node_modules')) return NPX_INVOCATION;
  // Only the CLI's own entry files count: tests and scripts inside a checkout are not "running the CLI".
  const rel = path.relative(root, real).split(path.sep).join('/');
  if (!/^(bin\/(fexport|fexport-v2|framer-export|framerexport)\.js|(src|dist)\/cli(-v2)?\/index\.(ts|js))$/.test(rel)) {
    return NPX_INVOCATION;
  }
  // bin/fexport.js only imports ../dist/cli/index.js: an unbuilt checkout cannot run it.
  if (!existsSync(path.join(root, 'dist', 'cli', 'index.js'))) return NPX_INVOCATION;
  return 'node "' + path.join(root, 'bin', 'fexport.js') + '" convert';
}

export const CLI_INVOCATION = resolveCliInvocation({ argv1: process.argv[1], env: process.env });

export const SHARED_RULES = [
  '- Edit only the files listed under "Edit only".',
  '- Tailwind classes only; arbitrary values (e.g. `w-[342px]`) are allowed.',
  '- No inline `style` attributes, except for motion values.',
  '- Server components by default; add `"use client"` only for motion or interaction.',
  "- Never import from or copy the original export's scripts.",
].join('\n');

export const TEMPLATES = {
  component: `# Task {{taskId}}: rebuild component {{name}}

## Goal
Rebuild the Framer component \`{{name}}\` as a React component that is visually identical to the original at 1440, 1000 and 390 px wide.

## Edit only
{{targets}}

## Inputs
{{inputs}}

## Requirements
- Export a named React component \`{{name}}\` from the target file.
- Match layout, spacing, typography, colors and borders of the slice and the reference crops at every width.
- Props (one value per Framer variant):
{{props}}
- Used on pages: {{pages}}.
- Replace Framer's generated class names with Tailwind utilities; use the design tokens from \`src/app/globals.css\`.

## Rules
{{rules}}

## Done when
Run \`${CLI_INVOCATION} verify {{taskId}}\` and confirm it passes: the target file exists and the app builds. Pixel parity is checked through the page tasks that use this component (the reference crops above are your visual target).
`,

  shell: `# Task {{taskId}}: site shell

## Goal
Build once the parts that every page shares (navigation, footer, loader, cursor, smooth scroll) so the page tasks can reuse them instead of rebuilding them.

## Edit only
{{targets}}

## Inputs
{{inputs}}

## Requirements
- Export each shared part below as a named React component from the target file, visually identical to the original at 1440, 1000 and 390 px wide.
- Shared sections (they appear on two or more pages):
{{shared}}
- Keep the root element of each part stable so the page tasks can wrap it in its \`data-section\`.

## Rules
{{rules}}

## Done when
Run \`${CLI_INVOCATION} verify {{taskId}}\` and confirm it passes: the target file exists and the app builds.
`,

  page: `# Task {{taskId}}: rebuild page {{route}}

## Goal
Rebuild the page for route \`{{route}}\` so it is visually identical to the original at 1440, 1000 and 390 px wide.

## Edit only
{{targets}}

## Inputs
{{inputs}}

## Requirements
- Fill in the default export of the target file; keep the existing \`metadata\` export.
- Render these top-level sections in order, each root element carrying its \`data-section\` attribute:
{{sections}}
{{components}}
{{dynamic}}
- Match layout, spacing, typography and colors of the reference screenshots at every width.

## Rules
{{rules}}

## Done when
Run \`${CLI_INVOCATION} verify {{taskId}}\` and confirm it passes.
`,

  motion: `# Task {{taskId}}: motion for {{route}}

## Goal
Recreate the observed animations of route \`{{route}}\` so they play the same way as in the original.

## Edit only
{{targets}}

## Inputs
{{inputs}}

## Requirements
Implement each animation below (framer-motion is available); entries marked low confidence need a visual check against the original.
{{checklist}}

## Rules
{{rules}}

## Done when
Tick every item in the checklist above, then run \`${CLI_INVOCATION} done {{taskId}}\`.
`,

  fix: `# Fix {{taskId}} (attempt {{attempt}})

## Goal
Fix the failed verification below so the original task passes.

## Edit only
{{targets}}

## Inputs
Failures from the last verify run:

{{failures}}

## Requirements
- Resolve every failure listed above without regressing what already passes.
- Compare against the reference screenshots named in the original task file.

## Rules
{{rules}}

## Done when
{{doneWhen}}
`,

  agents: `# Agent guide

This project is a Next.js rebuild of a Framer export, generated by \`fexport convert\`. The converter scaffolded the app; you rebuild components, pages and animations by working through numbered task files.

Original export: \`{{exportDir}}\`

## Stack
- Next.js (App Router) with React server components, TypeScript
- Tailwind CSS v4 (tokens in \`src/app/globals.css\`)
- framer-motion / gsap / lenis for motion

## Workflow
Task files live in \`.convert/tasks/\`. Components come first (001+), then pages (101+), then motion (201+).

Install dependencies once before the first verify: \`npm install\`.

- \`${CLI_INVOCATION} status\` shows every task and its state.
- \`${CLI_INVOCATION} next\` prints the next task to do.
- \`${CLI_INVOCATION} verify <taskId>\` checks your work against the original; failed attempts produce \`fix-*.md\` task files.

Do one task at a time: open the task file, edit only the files it lists, then run its verify command.

## Rules
{{rules}}
`,
} as const;

export type TemplateName = keyof typeof TEMPLATES;
