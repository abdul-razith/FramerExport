import path from 'node:path';
import type { Analysis, PageInfo, Tokens } from '../../types.js';
import { STACK_VERSIONS } from './versions.js';

const FALLBACK = 'ui-sans-serif, system-ui, sans-serif';
const q = (s: string): string => JSON.stringify(s);

export const kebab = (s: string): string =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'x';

export const fontUrl = (file: string): string => `/fonts/${path.posix.basename(file.replace(/\\/g, '/'))}`;

/** Route -> app-dir relative page path, e.g. `/a/[slug]` -> `src/app/a/[slug]/page.tsx`. */
export function pageFile(route: string): string {
  const seg = route.split('/').filter(Boolean).join('/');
  return seg ? `src/app/${seg}/page.tsx` : 'src/app/page.tsx';
}

export function globalsCss(tokens: Tokens): string {
  const out = ['@import "tailwindcss";', '', '@theme {', `  --breakpoint-md: ${tokens.breakpoints.md}px;`, `  --breakpoint-lg: ${tokens.breakpoints.lg}px;`];
  for (const [name, value] of Object.entries(tokens.colors)) out.push(`  --color-${kebab(name)}: ${value};`);
  for (const family of [...new Set(tokens.fonts.map((f) => f.family))]) {
    out.push(`  --font-${kebab(family)}: ${q(family)}, ${FALLBACK};`);
  }
  for (const t of tokens.typeScale) {
    const n = kebab(t.name);
    out.push(`  --text-${n}: ${t.size};`, `  --text-${n}--line-height: ${t.lineHeight};`);
    if (t.letterSpacing && t.letterSpacing !== 'normal' && !/^0(px|em|rem)?$/.test(t.letterSpacing)) {
      out.push(`  --text-${n}--letter-spacing: ${t.letterSpacing};`);
    }
  }
  out.push('}', '', 'html {', '  scroll-behavior: auto;', '}', '');
  return out.join('\n');
}

export function fontsCss(tokens: Tokens): string {
  const fmt: Record<string, string> = { '.woff2': 'woff2', '.woff': 'woff', '.ttf': 'truetype', '.otf': 'opentype' };
  const blocks: string[] = [];
  for (const f of tokens.fonts) {
    for (const file of f.files) {
      const format = fmt[path.posix.extname(file.path).toLowerCase()] ?? 'woff2';
      const lines = [
        '@font-face {',
        `  font-family: ${q(f.family)};`,
        `  font-weight: ${f.weight};`,
        `  font-style: ${f.style};`,
        '  font-display: swap;',
        `  src: url('${fontUrl(file.path)}') format('${format}');`,
      ];
      if (file.unicodeRange) lines.push(`  unicode-range: ${file.unicodeRange};`);
      lines.push('}');
      blocks.push(lines.join('\n'));
    }
  }
  return blocks.join('\n\n') + '\n';
}

function metadataBlock(
  page: PageInfo | undefined,
  imageManifest: Record<string, string>,
  withOg: boolean,
  origin?: string,
): string {
  const m = page?.meta ?? {};
  const fields: string[] = [];
  if (origin) fields.push(`  metadataBase: new URL(${q(origin)}),`);
  fields.push(`  title: ${q(page?.title ?? 'Site')},`);
  const description = m.description ?? m['og:description'];
  if (description) fields.push(`  description: ${q(description)},`);
  if (withOg) {
    const og: string[] = [];
    if (m['og:title']) og.push(`    title: ${q(m['og:title'])},`);
    if (m['og:description']) og.push(`    description: ${q(m['og:description'])},`);
    const img = m['og:image'] ? imageManifest[`assets/images/${path.posix.basename(m['og:image'].split('?')[0]!)}`] : undefined;
    if (img) og.push(`    images: [${q(img)}],`);
    if (og.length) fields.push('  openGraph: {', ...og, '  },');
  }
  return `export const metadata: Metadata = {\n${fields.join('\n')}\n};`;
}

function layoutTsx(home: PageInfo | undefined, imageManifest: Record<string, string>, origin?: string): string {
  return `import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './fonts.css';
import './globals.css';
import { LenisProvider } from '@/components/providers/LenisProvider';

${metadataBlock(home, imageManifest, true, origin)}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <LenisProvider>{children}</LenisProvider>
      </body>
    </html>
  );
}
`;
}

function staticPage(page: PageInfo): string {
  return `import type { Metadata } from 'next';

${metadataBlock(page, {}, false)}

export default function Page() {
  return <main data-page=${q(page.route)} />;
}
`;
}

function dynamicPage(page: PageInfo): string {
  const c = page.dynamic!.collection;
  if (!c) {
    throw new Error(
      `scaffold: dynamic route ${page.route} has no CMS collection; re-run extract-cms (it turns unlinked routes into static pages)`,
    );
  }
  return `import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ${c} } from '@/content/${c}';

${metadataBlock(page, {}, false)}

export function generateStaticParams(): { slug: string }[] {
  return ${c}.map((item) => ({ slug: item.slug }));
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const item = ${c}.find((entry) => entry.slug === slug);
  if (!item) notFound();
  return <main data-page=${q(page.route)} />;
}
`;
}

const PACKAGE_JSON = (): string => {
  const v = STACK_VERSIONS;
  return (
    JSON.stringify(
      {
        name: 'converted-site',
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts: { dev: 'next dev', build: 'next build', start: 'next start', lint: 'eslint .' },
        dependencies: {
          next: v.next,
          react: v.react,
          'react-dom': v['react-dom'],
          'framer-motion': v['framer-motion'],
          gsap: v.gsap,
          '@gsap/react': v['@gsap/react'],
          lenis: v.lenis,
        },
        devDependencies: {
          // TypeScript 7's documented side-by-side setup: tools that import `typescript` (typescript-eslint,
          // which throws on TS 7) get the TS 6 API, while `npx tsc` runs TS 7 from @typescript/native.
          typescript: `npm:@typescript/typescript6@${v['@typescript/typescript6']}`,
          '@typescript/native': `npm:typescript@${v.typescript}`,
          tailwindcss: v.tailwindcss,
          '@tailwindcss/postcss': v['@tailwindcss/postcss'],
          eslint: v.eslint,
          'eslint-config-next': v['eslint-config-next'],
          '@types/react': v['@types/react'],
          '@types/react-dom': v['@types/react-dom'],
          '@types/node': v['@types/node'],
        },
      },
      null,
      2,
    ) + '\n'
  );
};

const TSCONFIG = `${JSON.stringify(
  {
    compilerOptions: {
      target: 'ES2022',
      lib: ['dom', 'dom.iterable', 'esnext'],
      allowJs: false,
      skipLibCheck: true,
      strict: true,
      noEmit: true,
      esModuleInterop: true,
      module: 'esnext',
      moduleResolution: 'bundler',
      resolveJsonModule: true,
      isolatedModules: true,
      jsx: 'react-jsx',
      incremental: true,
      plugins: [{ name: 'next' }],
      paths: { '@/*': ['./src/*'] },
    },
    include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts', '.next/dev/types/**/*.ts'],
    exclude: ['node_modules'],
  },
  null,
  2,
)}\n`;

const LENIS = `'use client';

import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import { useEffect, type ReactNode } from 'react';

export function LenisProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const lenis = new Lenis({ autoRaf: true });
    return () => lenis.destroy();
  }, []);
  return <>{children}</>;
}
`;

const MOTION = `'use client';

import { MotionGlobalConfig, type Variants } from 'framer-motion';

if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('__verify')) {
  MotionGlobalConfig.skipAnimations = true;
}

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: 'easeOut' } },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.6, ease: 'easeOut' } },
};
`;

const GSAP = `'use client';

import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(useGSAP, ScrollTrigger);

if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('__verify')) {
  window.gsap = gsap;
}

declare global {
  interface Window {
    gsap?: typeof gsap;
  }
}

export { gsap, ScrollTrigger, useGSAP };
`;

const RICHTEXT = `export function RichText({ html, className }: { html: string; className?: string }) {
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
`;

export function generateFiles(
  analysis: Analysis,
  imageManifest: Record<string, string>,
  siteOrigin?: string,
): Map<string, string> {
  const files = new Map<string, string>();
  files.set('package.json', PACKAGE_JSON());
  files.set('tsconfig.json', TSCONFIG);
  files.set(
    'next.config.ts',
    `import type { NextConfig } from 'next';\n\nconst nextConfig: NextConfig = {\n  images: { unoptimized: false },\n  agentRules: false,\n  turbopack: { root: process.cwd() },\n};\n\nexport default nextConfig;\n`,
  );
  files.set('postcss.config.mjs', `const config = {\n  plugins: { '@tailwindcss/postcss': {} },\n};\n\nexport default config;\n`);
  files.set(
    'eslint.config.mjs',
    `import { defineConfig, globalIgnores } from 'eslint/config';\nimport nextVitals from 'eslint-config-next/core-web-vitals';\nimport nextTs from 'eslint-config-next/typescript';\n\nexport default defineConfig([\n  ...nextVitals,\n  ...nextTs,\n  globalIgnores(['.next/**', 'out/**', 'next-env.d.ts', '.convert/**']),\n]);\n`,
  );
  files.set('.gitignore', `node_modules\n.next\nout\nnext-env.d.ts\n*.tsbuildinfo\n.convert/*\n!.convert/tasks/\n`);
  files.set('src/app/globals.css', globalsCss(analysis.tokens));
  files.set('src/app/fonts.css', fontsCss(analysis.tokens));
  const home = analysis.pages.find((p) => p.route === '/');
  files.set('src/app/layout.tsx', layoutTsx(home, imageManifest, siteOrigin));
  files.set('src/components/providers/LenisProvider.tsx', LENIS);
  files.set('src/lib/motion.ts', MOTION);
  files.set('src/lib/gsap.ts', GSAP);
  files.set('src/components/RichText.tsx', RICHTEXT);
  for (const page of analysis.pages) {
    files.set(pageFile(page.route), page.dynamic ? dynamicPage(page) : staticPage(page));
  }
  return files;
}
