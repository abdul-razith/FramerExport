// Generated project dependency versions. Refresh with: npx tsx scripts/update-nextjs-versions.ts
// typescript stays on the 6.x line: Next's build type-check uses the TypeScript JS API.
export const NEXT_PROJECT_VERSIONS = {
  dependencies: {
    next: '16.4.5',
    react: '19.3.1',
    'react-dom': '19.3.1',
    motion: '^14.10.1',
    gsap: '^3.15.1',
    lenis: '^1.3.27',
    '@next/mdx': '16.4.5',
    '@mdx-js/loader': '^3.1.1',
    '@mdx-js/react': '^3.1.1',
  },
  devDependencies: {
    typescript: '^6.0.3',
    '@types/node': '^26.6.6',
    '@types/react': '^19.3.0',
    '@types/react-dom': '^19.3.0',
    '@types/mdx': '^2.0.14',
    tailwindcss: '^4.3.5',
    '@tailwindcss/postcss': '^4.3.5',
    eslint: '^10.14.0',
    'eslint-config-next': '16.4.5',
    prettier: '^3.9.10',
    'prettier-plugin-tailwindcss': '^0.8.1',
  },
} as const;
