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
    name: 'React + Vite + TypeScript',
    stack: 'React 18/19, TypeScript, Vite, CSS modules or plain CSS',
    defaultDir: 'converted-react-vite',
    staticDir: 'public',
    entryFiles: 'src/main.tsx, src/App.tsx, src/components/*',
  },
  nextjs: {
    name: 'Next.js App Router (TypeScript)',
    stack: 'Next.js App Router, TypeScript, React Server & Client Components',
    defaultDir: 'converted-nextjs',
    staticDir: 'public',
    entryFiles: 'app/layout.tsx, app/page.tsx, components/*',
  },
  'vue-vite': {
    name: 'Vue 3 + Vite + TypeScript',
    stack: 'Vue 3, TypeScript, Vite, Single-File Components',
    defaultDir: 'converted-vue-vite',
    staticDir: 'public',
    entryFiles: 'src/main.ts, src/App.vue, src/components/*',
  },
  sveltekit: {
    name: 'SvelteKit (TypeScript)',
    stack: 'SvelteKit, TypeScript, Svelte components',
    defaultDir: 'converted-sveltekit',
    staticDir: 'static',
    entryFiles: 'src/routes/+layout.svelte, src/routes/+page.svelte',
  },
  astro: {
    name: 'Astro (TypeScript)',
    stack: 'Astro, TypeScript, component islands',
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

## MANDATORY SUPERPOWERS WORKFLOW
1. **Plan First**: You MUST invoke \`superpowers:writing-plans\` before writing product code. Read \`./CONVERSION_SPEC.md\` and inspect the source files (\`./index.html\`, \`./styles/\`, \`./subpages/\`).
2. **Decompose into Modular Tasks**:
   - Task 1: Scaffolding validation & dependency installation (\`npm install\` inside \`./${ctx.projectDirName}\`).
   - Task 2: Design tokens, global CSS, and font imports.
   - Task 3: Layout primitives (Navbar, Footer, base shell).
   - Task 4: Main page sections (Hero, Features, Content blocks, etc.).
   - Task 5: Interactive components (modals, drawers, stateful toggles).
   - Task 6: Subpages & routing (if subpages exist).
3. **Execute Task-by-Task**: Use \`superpowers:subagent-driven-development\` or \`superpowers:executing-plans\` to implement each component with isolated context.
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
- **Images & Media:** \`./assets/\` (${counts['assets/images'] || 0} images/videos/fonts)
- **Dynamic Data/CMS:** \`./data/\` (${counts['data'] || 0} JSON files)
- **Subpages:** \`./subpages/\` (${counts['subpages'] || 0} HTML subpages)

---

## 2. Target Workspace Layout
The framework starter is initialized in \`./${ctx.projectDirName}\`:
- Static assets transferred to: \`./${ctx.projectDirName}/${cfg.staticDir}/assets\`
- Expected primary code files: \`${cfg.entryFiles}\`

---

## 3. Component Extraction Guidelines
1. **Typography & Styling**: Inspect CSS files in \`./styles/\`. Extract recurring color variables, typography sizes, and container widths.
2. **SVGs & Graphics**: Transfer embedded inline SVGs into reusable icons or JSX/Vue components.
3. **Responsive Breakpoints**: Check responsive styles in \`./styles/\` and ensure mobile/tablet media queries are preserved.
4. **Interactivity**: Identify client-side interactive elements (accordions, sliders, navigation menus) and implement appropriate reactive state.
`;
}
