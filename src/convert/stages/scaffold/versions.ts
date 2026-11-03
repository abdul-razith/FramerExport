export type StackPackage =
  | 'next'
  | 'react'
  | 'react-dom'
  | 'typescript'
  | '@typescript/typescript6'
  | 'tailwindcss'
  | '@tailwindcss/postcss'
  | 'framer-motion'
  | 'gsap'
  | '@gsap/react'
  | 'lenis'
  | 'eslint'
  | 'eslint-config-next'
  | '@types/react'
  | '@types/react-dom'
  | '@types/node';

/** Exact versions pinned from `npm view <pkg> version` on 2026-11-02. */
export const STACK_VERSIONS: Record<StackPackage, string> = {
  next: '16.4.4',
  react: '19.3.1',
  'react-dom': '19.3.1',
  typescript: '7.0.2',
  /** Installed under the `typescript` name: typescript-eslint (via eslint-config-next) refuses TS 7. */
  '@typescript/typescript6': '6.0.2',
  tailwindcss: '4.3.3',
  '@tailwindcss/postcss': '4.3.3',
  'framer-motion': '14.9.0',
  gsap: '3.15.0',
  '@gsap/react': '2.1.2',
  lenis: '1.3.27',
  eslint: '10.14.0',
  'eslint-config-next': '16.4.4',
  '@types/react': '19.3.0',
  '@types/react-dom': '19.3.0',
  '@types/node': '26.6.6',
};
