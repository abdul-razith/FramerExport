export type FrameworkTarget = 'react-vite' | 'nextjs' | 'vue-vite' | 'sveltekit' | 'astro';

export interface ConversionContext {
  framework: FrameworkTarget;
  projectDirName: string;
  sourceUrl: string;
  platform: string;
  outDir: string;
  counts?: Record<string, number>;
}

export const FRAMEWORK_CONFIGS: Record<
  FrameworkTarget,
  {
    name: string;
    stack: string;
    defaultDir: string;
    staticDir: string;
    entryFiles: string;
  }
> = {
  'react-vite': {
    name: 'React 19 + Vite 6 (TypeScript)',
    stack: 'React 19, TypeScript, Vite 6, framer-motion, CSS modules or stylesheet',
    defaultDir: 'converted-react-vite',
    staticDir: 'public',
    entryFiles: 'src/main.tsx, src/App.tsx, src/components/*',
  },
  nextjs: {
    name: 'Next.js 15 App Router (React 19, TypeScript)',
    stack: 'Next.js 15, React 19, TypeScript, framer-motion, React Server & Client Components',
    defaultDir: 'converted-nextjs',
    staticDir: 'public',
    entryFiles: 'app/layout.tsx, app/page.tsx, components/*',
  },
  'vue-vite': {
    name: 'Vue 3.5 + Vite 6 (TypeScript)',
    stack: 'Vue 3.5, TypeScript, Vite 6, Single-File Components',
    defaultDir: 'converted-vue-vite',
    staticDir: 'public',
    entryFiles: 'src/main.ts, src/App.vue, src/components/*',
  },
  sveltekit: {
    name: 'SvelteKit (Svelte 5, TypeScript)',
    stack: 'SvelteKit, Svelte 5, TypeScript, Vite 6',
    defaultDir: 'converted-sveltekit',
    staticDir: 'static',
    entryFiles: 'src/routes/+layout.svelte, src/routes/+page.svelte',
  },
  astro: {
    name: 'Astro 5 (TypeScript)',
    stack: 'Astro 5, TypeScript, component islands',
    defaultDir: 'converted-astro',
    staticDir: 'public',
    entryFiles: 'src/pages/index.astro, src/components/*',
  },
};

export function buildSuperpowersInstructions(ctx: ConversionContext): {
  claudeMd: string;
  agentsMd: string;
} {
  const cfg = FRAMEWORK_CONFIGS[ctx.framework];
  const commonInstructions = `
# Superpowers Project Migration Directives

You are performing a verified, production-grade website conversion from the exported static mirror in this directory into **${cfg.name}** located in \`./${ctx.projectDirName}\`.

## AUTONOMOUS UNATTENDED EXECUTION DIRECTIVE (DO NOT ASK QUESTIONS)
- **STRICT NON-INTERACTIVE MODE**: This is an unattended automated batch conversion.
- **DO NOT PROMPT THE USER**: Never ask interactive questions, brainstorm interviews, design questions, or pause for user confirmation.
- **LOCK TO NATIVE EXECUTION**: Immediately implement tasks sequentially in Native mode without asking "Native or Subagent-driven".
- **AUTOMATIC COMPLETION**: When the build passes (\`npm run build\` inside \`./${ctx.projectDirName}\`), conclude the task and exit. Do NOT present post-completion menus or ask what to do next.

## 1:1 FAITHFUL FIDELITY & DOM PRESERVATION RULES
1. **Never Reinvent or Hallucinate Styles**:
   - DO NOT write simplified inline styles (\`style={{ display: 'flex', ... }}\`) or guess layout dimensions.
   - The exported \`index.html\` contains the complete, pixel-perfect DOM inside \`<div id="main">\`.
   - The exported \`styles/\` directory or embedded \`<style>\` tags in \`index.html\` contain all compiled CSS rules (\`framer-...\`, media queries, tokens).
   - Transfer all CSS rules from the exported markup into the project stylesheet (e.g. \`globals.css\`).
   - Preserve the exact HTML elements and class names in JSX (\`className="framer-..."\`) so that the CSS rules bind directly to the elements.
2. **Animation Fidelity with framer-motion**:
   - \`framer-motion\` is pre-configured in \`package.json\`.
   - Use \`framer-motion\` (\`motion.div\`, \`AnimatePresence\`, spring transitions) to replicate all hover effects, spring physics, scroll entrance reveals, and transitions.
   - Preserve CSS keyframe animations, transforms, and hover transitions defined in the exported stylesheet.
3. **100% Page Coverage**:
   - Convert every single section present in the exported markup (Hero, Features, Testimonials, FAQ, Timeline, Portfolio, Footer, etc.). Do not stop after just 2 or 3 sections.
   - Ensure all subpages in \`./subpages/\` are properly mapped to framework routes.

## MANDATORY SUPERPOWERS WORKFLOW
1. **Plan First**: You MUST invoke \`superpowers:writing-plans\` before writing product code. Read \`./CONVERSION_SPEC.md\` and inspect the source files (\`./index.html\`, \`./scripts/vendor/\`, \`./styles/\`, \`./subpages/\`).
2. **Decompose into Modular Tasks**:
   - Task 1: Pre-Conversion Source & Dependency Analysis:
     * Inspect \`./scripts/vendor/\` and \`<script>\`/\`<style>\` tags in \`./index.html\`.
     * Identify third-party libraries and runtime features (e.g. \`lenis\` smooth scrolling, \`gsap\` ScrollTrigger, \`framer-motion\`, \`lucide-react\`, \`canvas-confetti\`, etc.).
     * Dynamically install the detected packages via \`npm install <packages>\` inside \`./${ctx.projectDirName}\`.
     * Audit and map the full DOM hierarchy of \`<div id="main">\` in \`./index.html\`.
   - Task 2: Design Tokens, Global CSS & Font Imports:
     * Transfer all CSS rules, \`--token-*\` custom properties, and \`@font-face\` definitions into the global stylesheet.
   - Task 3: Layout Primitives (Navbar, Footer, Base Shell):
     * Construct responsive navigation, footer CTA, and background grid shells.
   - Task 4: Main Page Sections (DOM Preservation):
     * Convert 100% of the sections from \`./index.html\` into clean JSX components, preserving the original \`className="framer-..."\` attributes.
   - Task 5: Animation & Interactivity Restoration:
     * Wire up dynamic interaction using the installed libraries (Framer Motion, Lenis smooth scroll, GSAP ScrollTrigger, modals, filter tabs).
   - Task 6: Subpages & Routing:
     * Map all subpages in \`./subpages/\` to framework routes.
   - Task 7: Verification Gate:
     * Execute \`superpowers:verification-before-completion\`. Run \`npm run build\` inside \`./${ctx.projectDirName}\` and ensure 0 TypeScript and 0 packaging errors.
3. **Execute Task-by-Task in Native Mode**: Execute each task directly and verify progress.
4. **Verification Gate**: You MUST invoke \`superpowers:verification-before-completion\`. The conversion is NOT complete until \`npm run build\` passes with zero TypeScript or packaging errors inside \`./${ctx.projectDirName}\`.
`;

  const claudeMd = `${commonInstructions}
## Claude Code Specifics
- Work from this project root.
- Place all new components and framework source code in \`./${ctx.projectDirName}\`.
- Static media has already been placed in \`./${ctx.projectDirName}/${cfg.staticDir}/assets\`.
- Never invent placeholder content; extract copy and SVG assets directly from \`./index.html\`.
`;

  const agentsMd = `${commonInstructions}
## AGY / Agent Specifics
- Target Framework: ${cfg.stack}
- Project Directory: \`./${ctx.projectDirName}\`
- Spec Reference: \`./CONVERSION_SPEC.md\`
`;

  return { claudeMd, agentsMd };
}

export function buildConversionSpec(ctx: ConversionContext): string {
  const cfg = FRAMEWORK_CONFIGS[ctx.framework];
  const counts = ctx.counts || {};

  return `# Technical Conversion Specification

**Source URL:** ${ctx.sourceUrl}  
**Source Platform:** ${ctx.platform}  
**Target Framework:** ${cfg.name}  
**Target Directory:** \`./${ctx.projectDirName}\`  
**Target Tech Stack:** ${cfg.stack}  

---

## 1. Inventory of Exported Source Files
- **Markup:** \`./index.html\` (${counts['index.html'] || 1} file)
- **Styles:** \`./styles/\` (${counts['styles'] || 0} CSS files)
- **Vendor Scripts:** \`./scripts/vendor/\`
- **Images & Media:** \`./assets/\` (${counts['assets/images'] || 0} images/videos/fonts)
- **Dynamic Data/CMS:** \`./data/\` (${counts['data'] || 0} JSON files)
- **Subpages:** \`./subpages/\` (${counts['subpages'] || 0} HTML subpages)

---

## 2. Target Workspace Layout
The framework starter is initialized in \`./${ctx.projectDirName}\`:
- Static assets transferred to: \`./${ctx.projectDirName}/${cfg.staticDir}/assets\`
- Expected primary code files: \`${cfg.entryFiles}\`
- Pre-installed animation dependencies: \`framer-motion\`, \`clsx\`

---

## 3. Pre-Conversion Source & Dependency Analysis Guidelines
1. **Vendor Script & Dependency Analysis (Task 1)**:
   - Examine \`./scripts/vendor/\` to identify the runtime libraries used by the site (e.g. \`Lenis.*.mjs\` -> \`lenis\`, \`ScrollTrigger.*.mjs\` -> \`gsap\`, \`motion.*.mjs\` -> \`framer-motion\`, etc.).
   - Dynamically install all detected libraries into \`./${ctx.projectDirName}\` via \`npm install <packages>\`.
2. **DOM Structure & CSS Classes**:
   - Inspect the real DOM inside \`<div id="main">\` in \`./index.html\`.
   - Do NOT rewrite or approximate layouts with hand-written inline styles (\`style={{ ... }}\`).
   - Extract the real DOM elements, convert them to clean JSX components, and retain their exact CSS classes (\`className="framer-..."\`).
3. **Typography & Styling**:
   - Transfer all \`<style>\` tag rules and CSS variables (\`--token-...\`) from \`./index.html\` into the global stylesheet.
   - Retain font definitions from \`./assets/fonts/\` and responsive media query breakpoint classes.
4. **Animations & Interactivity with framer-motion & lenis**:
   - Use \`framer-motion\` and detected animation libraries to reproduce spring physics, smooth reveals, and hover states.
5. **Complete Coverage**:
   - Replicate 100% of the sections in \`./index.html\`. Do not stop after just 2 or 3 sections.
   - For all subpages in \`./subpages/\`, create matching routes in \`./${ctx.projectDirName}\`.
`;
}

export function buildLauncherScripts(
  agentCommand: string,
  agentId: string,
  frameworkName: string
): { cmdScript: string; shScript: string } {
  const cmdScript = `@echo off
title NoCodeXport AI Conversion
cd /d "%~dp0"
echo ========================================================
echo   NoCodeXport AI Tech Stack Conversion
echo   Agent:            ${agentId}
echo   Target Framework: ${frameworkName}
echo   Working Dir:      %CD%
echo ========================================================
echo.
echo Launching conversion agent...
echo ${agentCommand}
echo.
${agentCommand}
echo.
echo Agent process ended.
cmd.exe /k
`;

  const shScript = `#!/usr/bin/env bash
cd "$(dirname "$0")"
echo "========================================================"
echo "  NoCodeXport AI Tech Stack Conversion"
echo "  Agent:            ${agentId}"
echo "  Target Framework: ${frameworkName}"
echo "  Working Dir:      $(pwd)"
echo "========================================================"
echo ""
echo "Launching conversion agent..."
echo "${agentCommand}"
echo ""
${agentCommand}
echo ""
echo "Agent process ended. Press Enter to exit."
read -r
`;

  return { cmdScript, shScript };
}
