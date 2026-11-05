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

export function checkCommand(taskId: string, testing: boolean): string {
  return `${CLI_INVOCATION} check ${taskId}${testing ? '' : ' --smoke'}`;
}

export const SHARED_RULES = [
  '- Edit only the listed targets (a target ending in `/` allows new files inside that directory).',
  '- Tailwind utilities (arbitrary values allowed); no `framer-` class names; no inline `style` except motion values and CSS custom properties.',
  '- Keep the root `data-section` attribute and every `data-motion` attribute.',
  "- Keep `img` elements' `src`, `srcSet`, `sizes` and `alt` (plain `img`, not `next/image`).",
  '- Use `src/lib/motion.ts` / `src/lib/gsap.ts`; framer-motion for appear and hover, GSAP ScrollTrigger for scroll-linked motion. Under `?__verify=1` everything renders in its finished state.',
  '- **Never run `npm run build`, `next dev`, `next start` or `npm install`.**',
  '- Testing on: check with `fexport convert check <taskId>`; testing off: `fexport convert check <taskId> --smoke`. Stop when it passes or when it says the limit is reached.',
].join('\n');

export const TEMPLATES = {
  shell: `# Task {{taskId}}: shell component {{name}}

## Goal
Rebuild the shared shell component \`{{name}}\` as a clean, responsive Tailwind React component, visually identical to the original at 1440, 1000 and 390 px wide.

## Edit only
{{targets}}

## Inputs
{{inputs}}

## Requirements
{{requirements}}

## Rules
{{rules}}

## Done when
{{doneWhen}}
`,

  section: `# Task {{taskId}}: section {{name}}

## Goal
Refactor this section to clean Tailwind utilities with the same look at 1440, 1000 and 390 px wide, plus its animations and script-drawn parts.

## Edit only
{{targets}}

## Inputs
{{inputs}}

## Requirements
{{requirements}}

## Rules
{{rules}}

## Done when
{{doneWhen}}
`,

  page: `# Task {{taskId}}: page {{route}}

## Goal
Rebuild the view and page-level layout for route \`{{route}}\` so it renders its sections in order using clean Tailwind wrappers, matching the original at 1440, 1000 and 390 px wide.

## Edit only
{{targets}}

## Inputs
{{inputs}}

## Requirements
{{requirements}}

## Rules
{{rules}}

## Done when
{{doneWhen}}
`,

  fix: `# Fix {{taskId}} (attempt {{attempt}})

## Goal
Fix the failed verification below so the original task passes.

## Edit only
{{targets}}

## Inputs
Failures from the last check run:

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

This project is a Next.js rebuild of a Framer export, generated by \`fexport convert\`.

Original export: \`{{exportDir}}\`

## Stack
- Next.js (App Router) with React server components, TypeScript
- Tailwind CSS v4 (tokens in \`src/app/globals.css\`)
- framer-motion / GSAP ScrollTrigger for motion

## Workflow
Task files live in \`.convert/tasks/\`.
- Shell tasks run first (\`shell-*\`).
- Section tasks run in parallel (\`sec-*\`).
- Page tasks run once their sections are complete (\`page-*\`).

- \`${CLI_INVOCATION} status\` shows every task and its state.
- \`${CLI_INVOCATION} next\` prints the next task to do.
- \`${CLI_INVOCATION} check <taskId>\` checks your work.

Do one task at a time: open the task file, edit only the files listed under "Edit only", then run its check command.

## Rules
{{rules}}
`,
} as const;

export type TemplateName = keyof typeof TEMPLATES;
