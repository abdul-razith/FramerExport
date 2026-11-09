/** Static files of the generated Next.js project. */

export const NEXT_CONFIG = `import createMDX from '@next/mdx';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  pageExtensions: ['js', 'jsx', 'md', 'mdx', 'ts', 'tsx'],
};

const withMDX = createMDX({});

export default withMDX(nextConfig);
`;

export const TSCONFIG = {
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
    paths: { '@/*': ['./*'] },
  },
  include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '**/*.mdx', '.next/types/**/*.ts'],
  exclude: ['node_modules'],
};

export const POSTCSS_CONFIG = `export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
`;

export const ESLINT_CONFIG = `import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']),
]);
`;

export const PRETTIERRC = { singleQuote: true, printWidth: 100, plugins: ['prettier-plugin-tailwindcss'] };

export const GITIGNORE = `node_modules
.next
out
build
.env*.local
*.tsbuildinfo
next-env.d.ts
`;

export const MDX_COMPONENTS = `import type { MDXComponents } from 'mdx/types';

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return { ...components };
}
`;

export const LIB_TYPES = `export interface ImageData {
  src: string;
  alt: string;
  width: number;
  height: number;
}
`;

export const LIB_FORMAT = `/** Formats an ISO date the way the original site displayed it. */
export function formatDate(iso: string, locale: 'en-GB' | 'en-US' = 'en-GB'): string {
  return new Date(iso).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
`;

export const MOTION_CONFIG = `import type { Transition } from 'motion/react';

/** Animation timing for the whole site. Tune these to change every animation at once. */
export const motionConfig = {
  duration: 0.6,
  ease: 'easeOut',
  letterStagger: 0.03,
} as const;

export const reveal: Transition = {
  duration: motionConfig.duration,
  ease: motionConfig.ease,
};
`;

export const MOTION_PROVIDER = `'use client';

import { MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';

/** Respects the visitor's "reduce motion" setting for every motion component. */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
`;

export const MOTION_IMAGE = `'use client';

import Image from 'next/image';
import { motion } from 'motion/react';

export const MotionImage = motion.create(Image);
`;

export const MOTION_LINK = `'use client';

import Link from 'next/link';
import { motion } from 'motion/react';

export const MotionLink = motion.create(Link);
`;

export const SPLIT_TEXT = `'use client';

import { motion, type TargetAndTransition } from 'motion/react';
import { motionConfig } from './config';

type Tag = 'p' | 'span' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'div';
type From = { opacity?: number; x?: number; y?: number; scale?: number; rotate?: number };

const REST = { opacity: 1, x: 0, y: 0, scale: 1, rotate: 0 };

/** Animates text letter by letter when it scrolls into view. */
export function SplitText({
  text,
  from,
  as = 'p',
  className,
}: {
  text: string;
  from: From;
  as?: Tag;
  className?: string;
}) {
  const Component = motion[as];
  const to = Object.fromEntries(
    Object.keys(from).map((k) => [k, REST[k as keyof typeof REST]])
  ) as TargetAndTransition;
  return (
    <Component
      className={className}
      aria-label={text}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true }}
      transition={{ staggerChildren: motionConfig.letterStagger }}
    >
      {Array.from(text).map((char, i) => (
        <motion.span
          key={i}
          aria-hidden
          style={{ display: 'inline-block', whiteSpace: 'pre' }}
          variants={{ hidden: from, visible: to }}
          transition={{ duration: motionConfig.duration, ease: motionConfig.ease }}
        >
          {char}
        </motion.span>
      ))}
    </Component>
  );
}
`;

export const USE_SCROLL_ANIMATION = `'use client';

import { useLayoutEffect, type RefObject } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

export interface ScrollValue {
  property: string;
  values: string[];
}

/**
 * Plays CSS values along the page scroll (GSAP ScrollTrigger, scrubbed).
 * values[0] applies at the top of the page, the last value at the bottom.
 */
export function useScrollAnimation(ref: RefObject<HTMLElement | null>, values: ScrollValue[]) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        scrollTrigger: { trigger: document.documentElement, start: 'top top', end: 'bottom bottom', scrub: true },
      });
      for (const { property, values: steps } of values) {
        gsap.set(el, { [property]: steps[0] });
        steps.slice(1).forEach((value, i) => {
          tl.to(el, { [property]: value, ease: 'none', duration: 1 }, i);
        });
      }
    });
    return () => ctx.revert();
  }, [ref, values]);
}
`;

export const SCROLL_EFFECT = `'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useScrollAnimation, type ScrollValue } from './useScrollAnimation';

/** Applies a scroll-linked effect to its only child without adding a layout box. */
export function ScrollEffect({ values, children }: { values: ScrollValue[]; children: ReactNode }) {
  const wrapper = useRef<HTMLDivElement>(null);
  const target = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    target.current = wrapper.current?.firstElementChild as HTMLElement | null;
  }, []);
  useScrollAnimation(target, values);
  return (
    <div ref={wrapper} style={{ display: 'contents' }}>
      {children}
    </div>
  );
}
`;

export const SMOOTH_SCROLL = `'use client';

import { useEffect, type ReactNode } from 'react';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

/** Smooth scrolling (Lenis) kept in sync with GSAP ScrollTrigger. */
export function SmoothScroll({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    gsap.registerPlugin(ScrollTrigger);
    const lenis = new Lenis();
    lenis.on('scroll', ScrollTrigger.update);
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    return () => {
      gsap.ticker.remove(tick);
      lenis.destroy();
    };
  }, []);
  return <>{children}</>;
}
`;

export const CURSOR = `'use client';

import { useEffect, useState } from 'react';
import { motion, useMotionValue, useSpring } from 'motion/react';

/** A small dot that follows the pointer. Hidden on touch devices. */
export function Cursor({ size = 16, className = 'bg-current' }: { size?: number; className?: string }) {
  const [enabled, setEnabled] = useState(false);
  const x = useMotionValue(-100);
  const y = useMotionValue(-100);
  const sx = useSpring(x, { stiffness: 500, damping: 40 });
  const sy = useSpring(y, { stiffness: 500, damping: 40 });

  useEffect(() => {
    if (!window.matchMedia('(pointer: fine)').matches) return;
    setEnabled(true);
    const move = (e: PointerEvent) => {
      x.set(e.clientX - size / 2);
      y.set(e.clientY - size / 2);
    };
    window.addEventListener('pointermove', move);
    return () => window.removeEventListener('pointermove', move);
  }, [x, y, size]);

  if (!enabled) return null;
  return (
    <motion.div
      aria-hidden
      className={\`pointer-events-none fixed top-0 left-0 z-50 rounded-full \${className}\`}
      style={{ x: sx, y: sy, width: size, height: size }}
    />
  );
}
`;

export const LOADER = `'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

/** Full-screen cover that fades out once the page has loaded. */
export function Loader({ className = 'bg-white' }: { className?: string }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const hide = () => setVisible(false);
    if (document.readyState === 'complete') hide();
    else window.addEventListener('load', hide, { once: true });
    return () => window.removeEventListener('load', hide);
  }, []);
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          aria-hidden
          className={\`fixed inset-0 z-50 \${className}\`}
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
        />
      )}
    </AnimatePresence>
  );
}
`;

export function readme(siteName: string, collections: string[]): string {
  return `# ${siteName}

Converted from a Framer site by framer-export. This is a regular Next.js project:
edit it like any other.

## Run it

\`\`\`bash
npm install
npm run dev
\`\`\`

## Where things live

| To change | Edit |
| --- | --- |
| Page text, links and images | \`content/*.ts\` (one file per page, \`layout.ts\` for header and footer) |
${collections.map((c) => `| ${c} entries | \`content/${c}/*.mdx\` (add a file to add an entry) |`).join('\n')}
| Colours, fonts, radii, shadows | the \`@theme\` block in \`app/globals.css\` |
| Font files | \`app/fonts.css\` and \`public/fonts/\` |
| Breakpoints | \`@custom-variant tablet\` / \`mobile\` in \`app/globals.css\` |
| Animation timing | \`components/motion/config.ts\` |
| Section layout | \`components/sections/*.tsx\` |
| Repeated pieces (cards, tags…) | \`components/ui/*.tsx\` |

Styles use Tailwind CSS. Breakpoints are desktop-first: \`tablet:\` applies below
1200px and \`mobile:\` below 810px. Anything Tailwind cannot express sits in a
\`*.module.css\` file next to its component.

See \`CONVERSION-REPORT.md\` for what was approximated or left out.
`;
}
