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
    updatedContext: string;
  }
> = {
  'react-vite': {
    name: 'React 19 + Vite 8 (TypeScript)',
    stack: 'React 19 (v19.3.1), TypeScript, Vite 8 (v8.3.5), framer-motion (v14), CSS modules or stylesheet',
    defaultDir: 'converted-react-vite',
    staticDir: 'public',
    entryFiles: 'src/main.tsx, src/App.tsx, src/components/*',
    updatedContext: `
- **React 19 Native Ref**: \`ref\` is now a standard prop on function components; \`forwardRef\` is deprecated and no longer needed.
- **Action State Hooks**: Utilize \`useActionState\` and \`useOptimistic\` for asynchronous actions, forms, and optimistic UI transitions.
- **Asset Hoisting**: React 19 natively hoists and deduplicates \`<link rel="stylesheet">\`, scripts, and style tags placed within components.
- **Vite 8 Engine**: Fast modern ES module bundling with lightning-fast HMR and optimized asset serving.`,
  },
  nextjs: {
    name: 'Next.js 16 App Router (React 19, TypeScript)',
    stack: 'Next.js 16 (v16.4.3), React 19 (v19.3.1), TypeScript, framer-motion (v14), App Router with Turbopack',
    defaultDir: 'converted-nextjs',
    staticDir: 'public',
    entryFiles: 'app/layout.tsx, app/page.tsx, components/*',
    updatedContext: `
- **App Router & Turbopack**: Built on Next.js 16 with Turbopack as the default bundler for development and production builds.
- **Async Request APIs**: In Next.js 16, dynamic APIs such as \`params\` and \`searchParams\` in page and layout components, as well as \`cookies()\` and \`headers()\`, are asynchronous Promises. Always await them: \`const { slug } = await params;\`.
- **Server Actions & Directives**: Explicit \`'use client'\` directive at the top of interactive components (using hooks, \`framer-motion\`, or \`lenis\`), while keeping layout wrappers and static data fetchers as React Server Components.
- **Partial Prerendering (PPR) & 'use cache'**: Supports modern declarative caching and dynamic streaming boundaries.`,
  },
  'vue-vite': {
    name: 'Vue 3.5 + Vite 8 (TypeScript)',
    stack: 'Vue 3.5 (v3.5.44), TypeScript, Vite 8 (v8.3.5), Single-File Components',
    defaultDir: 'converted-vue-vite',
    staticDir: 'public',
    entryFiles: 'src/main.ts, src/App.vue, src/components/*',
    updatedContext: `
- **Reactive Props Destructuring**: In Vue 3.5+, destructuring \`defineProps<{ title?: string }>()\` is fully reactive and preserves reactivity automatically without needing \`toRefs\`.
- **useTemplateRef()**: Replaces string template refs with type-safe \`useTemplateRef('myEl')\`.
- **SSR & Teleport Enhancements**: Built-in \`useId()\` for hydration-safe identifiers and \`<Teleport defer>\` to resolve target elements rendered later in the tree.
- **Memory & Reactivity Optimization**: 56% lower memory overhead and 10x faster tracking algorithms.`,
  },
  sveltekit: {
    name: 'SvelteKit (Svelte 5, TypeScript)',
    stack: 'SvelteKit (v3.1.1), Svelte 5 (v5.57.3), TypeScript, Vite 8',
    defaultDir: 'converted-sveltekit',
    staticDir: 'static',
    entryFiles: 'src/routes/+layout.svelte, src/routes/+page.svelte',
    updatedContext: `
- **Svelte 5 Runes**: Complete shift from reactive labels (\`$:\`) to explicit Runes (\`$state()\`, \`$derived()\`, \`$effect()\`, \`$props()\`).
- **Modern Event Handling**: Standard attribute syntax (\`onclick={handleClick}\` instead of legacy \`on:click\`).
- **Snippets over Slots**: Uses \`{#snippet header()}\` and \`{@render header()}\` replacing the deprecated \`<slot>\` mechanism.
- **Universal Fine-Grained Reactivity**: Works seamlessly across \`.svelte\` components and \`.svelte.ts\` utility scripts.`,
  },
  astro: {
    name: 'Astro 7 (TypeScript)',
    stack: 'Astro 7 (v7.4.4), TypeScript, Content Layer API, component islands',
    defaultDir: 'converted-astro',
    staticDir: 'public',
    entryFiles: 'src/pages/index.astro, src/components/*',
    updatedContext: `
- **Content Layer API**: Universal \`src/content.config.ts\` data schema using loaders (\`glob()\`, \`file()\`, or API endpoints) replacing legacy content collections.
- **Server Islands**: \`server:defer\` allows deferred on-demand rendering of dynamic content without blocking static page delivery.
- **astro:env & astro:actions**: Built-in type-safe schema validation for environment variables and type-safe backend RPC actions.`,
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

## USER STANDING INSTRUCTION: FULL AUTONOMOUS OVERRIDE (DO NOT ASK QUESTIONS)
Your human partner has explicitly given the following standing instructions, which take absolute precedence over all Superpowers skills (per SKILL.md "User instructions take precedence over skills"):
1. **STRICT NON-INTERACTIVE MODE**: This is an unattended automated batch conversion. Never ask interactive questions, brainstorm interviews, clarifying questions, design preferences, or pause for user confirmation.
2. **EXECUTION MODE PRE-APPROVED**:
   - The execution mode is ALREADY EXPLICITLY CHOSEN: Native execution (\`superpowers:executing-plans\`).
   - Do NOT ask "Which execution approach would you prefer? Native or Subagent-driven?" or "Does the plan capture what you want?".
   - Immediately implement tasks sequentially in Native mode using \`superpowers:executing-plans\`.
3. **NO BRAINSTORMING INTERVIEWS**: Do not invoke \`superpowers:brainstorming\` or conduct interactive interviews. All technical and design requirements are locked in \`./CONVERSION_SPEC.md\`.
4. **NO POST-COMPLETION MENUS**: Do not ask "What would you like to do next? (1. Push commits 2. Launch dev preview 3. Keep as-is)". When the build passes (\`npm run build\` inside \`./${ctx.projectDirName}\`), conclude with a brief summary and exit immediately.

## 1:1 FAITHFUL FIDELITY & DOM PRESERVATION RULES
1. **Never Reinvent or Hallucinate Styles**:
   - DO NOT write simplified inline styles (\`style={{ display: 'flex', ... }}\`) or guess layout dimensions.
   - The exported \`index.html\` contains the complete, pixel-perfect DOM inside \`<div id="main">\`.
   - The exported \`styles/\` directory and embedded \`<style>\` tags in \`index.html\` contain all compiled CSS rules (\`framer-...\`, media queries, tokens).
   - Transfer all CSS rules from the exported markup into the project stylesheet (e.g. \`globals.css\`).
   - Preserve the exact HTML elements and class names in JSX (\`className="framer-..."\`) so that the CSS rules bind directly to the elements.

2. **CRITICAL: Preserving Root Container Class Hierarchy (CSS Descendant Scoping)**:
   - In no-code platforms (especially Framer), almost all layout, flexbox, dimension, and section positioning rules in the CSS are **descendant selectors** scoped under the root page component classes (e.g. \`.framer-2yJbE .framer-15n2sit\`, \`.framer-Ub91r ...\`).
   - In \`index.html\`, inside \`<div id="main">\`, observe the exact outer wrapper divs enclosing the sections (e.g. \`<div className="framer-Ub91r ...">\` and \`<div data-framer-root="" className="framer-2yJbE ...">\`).
   - **WARNING**: NEVER strip or omit these root container divs when building \`app/page.tsx\` or \`App.tsx\`!
   - If you omit the root container class (e.g. \`.framer-2yJbE\`), hundreds of CSS rules will fail to match. Consequently, sections will collapse from \`display: flex; height: 100vh\` to \`display: block; position: static\`, causing lower sections and banners to float up and overlap the hero section, creating overlapping ribbons and jumbled text.
   - **REQUIRED ACTION**: Wrap the page sections in the exact root container div hierarchy found in \`index.html\`.

3. **CRITICAL: Resolving Framer SSR Zero-Opacity & Animation Initial States**:
   - In Framer's exported SSR HTML, elements designed for entrance animations (such as the Hero title letters, avatar speech bubbles, availability badges, and section headers) have inline \`style\` attributes set to their initial animation keyframes:
     * \`opacity: 0.001; transform: translateX(40px) scale(0.9)...\`
     * \`opacity: 0; transform: translate(-50%, -50%)...\`
     * \`opacity: 0\`
   - **WARNING**: If you transcribe these elements into static JSX with hardcoded \`opacity: 0\` or \`opacity: 0.001\`, **THEY WILL BE PERMANENTLY INVISIBLE TO USERS!**
   - **REQUIRED ACTION**:
     * Either wrap them with \`framer-motion\` (\`<motion.span initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.6 }}>\`) so they animate into view.
     * OR reset the inline style to visible (\`opacity: 1\`, natural transform) so all typography (like the Hero name 'BENJAMIN', bio text, and avatars) renders visibly and beautifully!

4. **CRITICAL: SVG Template Definitions (\`<div id="svg-templates">\`)**:
   - Framer sites place shared SVG icons, cursor pointers, and badge arrows inside \`<div id="svg-templates" ...><svg id="svg1378496346_348">...</svg></div>\` at the end of \`index.html\`.
   - Elements throughout the page reference these via \`<use href="#svg1378496346_348"></use>\`.
   - You MUST include the \`<div id="svg-templates">...</div>\` block in the root layout shell (\`app/layout.tsx\` or \`src/App.tsx\`), or use the pre-scaffolded \`SvgTemplates\` component, so that all pointer arrows, cursors, and icons render properly.

5. **Dynamic CMS & Handover Content Extraction**:
   - Inspect \`__framer__handoverData\` or \`./data/\` JSON files to extract any dynamic content strings (such as "Available for thoughtful projects", case study details, or blog posts) so no text slots are left blank.

6. **Animation & Interactivity Fidelity**:
   - Use \`framer-motion\` (\`motion.div\`, \`AnimatePresence\`, spring physics) for hover states, card lifting, and page transitions.
   - Wire up smooth scrolling with \`lenis\` if detected in \`scripts/vendor/\`.
   - Preserve CSS keyframe animations, transforms, and hover transitions defined in the exported stylesheet.

7. **100% Page & Subpage Coverage**:
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
     * Construct responsive navigation, footer CTA, and background grid shells. Include \`<SvgTemplates />\`.
   - Task 4: Main Page Sections (DOM Preservation & Zero-Opacity Resolution):
     * Convert 100% of the sections from \`./index.html\` into clean JSX components, preserving the original \`className="framer-..."\` attributes and ensuring no elements are left at \`opacity: 0\` or \`opacity: 0.001\`.
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

## 3. Modern Tech Stack Architectural Context (${cfg.name})
${cfg.updatedContext}

---

## 4. Pre-Conversion Source & Dependency Analysis Guidelines
1. **Vendor Script & Dependency Analysis (Task 1)**:
   - Examine \`./scripts/vendor/\` to identify the runtime libraries used by the site (e.g. \`Lenis.*.mjs\` -> \`lenis\`, \`ScrollTrigger.*.mjs\` -> \`gsap\`, \`motion.*.mjs\` -> \`framer-motion\`, etc.).
   - Dynamically install all detected libraries into \`./${ctx.projectDirName}\` via \`npm install <packages>\`.
2. **DOM Structure & CSS Classes**:
   - Inspect the real DOM inside \`<div id="main">\` in \`./index.html\`.
   - Do NOT rewrite or approximate layouts with hand-written inline styles (\`style={{ ... }}\`).
   - Extract the real DOM elements, convert them to clean JSX components, and retain their exact CSS classes (\`className="framer-..."\`).
3. **Resolving Framer SSR Zero-Opacity & Animation Initial States**:
   - In Framer's exported SSR HTML, elements designed for entrance animations have inline \`opacity: 0.001\` or \`opacity: 0\`.
   - You MUST either bind them with \`framer-motion\` (\`animate={{ opacity: 1 }}\`) or reset default visibility to \`opacity: 1\` so that Hero titles, avatars, and badges are fully visible.
4. **SVG Templates Definition**:
   - Include the \`<div id="svg-templates">\` symbol block in the root layout shell so all \`<use href="#svg...">\` pointers render correctly.
5. **Typography & Styling**:
   - Transfer all \`<style>\` tag rules and CSS variables (\`--token-...\`) from \`./index.html\` into the global stylesheet.
   - Retain font definitions from \`./assets/fonts/\` and responsive media query breakpoint classes.
6. **Animations & Interactivity with framer-motion & lenis**:
   - Use \`framer-motion\` and detected animation libraries to reproduce spring physics, smooth reveals, and hover states.
7. **Complete Coverage**:
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
