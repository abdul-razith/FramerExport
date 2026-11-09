/**
 * Refreshes src/nextjs/versions.ts from the npm registry.
 * Run: npx tsx scripts/update-nextjs-versions.ts
 * Exact pins stay exact (next, react, @next/mdx, eslint-config-next); others get a caret.
 * typescript is kept on the 6.x line because Next's type-check uses the TypeScript JS API.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { NEXT_PROJECT_VERSIONS } from '../src/nextjs/versions.js';

const EXACT = new Set(['next', 'react', 'react-dom', '@next/mdx', 'eslint-config-next']);
const RANGE: Record<string, string> = { typescript: '6' };

function latest(pkg: string): string {
  const spec = RANGE[pkg] ? `${pkg}@${RANGE[pkg]}` : pkg;
  const out = execFileSync('npm', ['view', spec, 'version', '--json'], { encoding: 'utf8', shell: true });
  const parsed = JSON.parse(out) as string | string[];
  return Array.isArray(parsed) ? parsed[parsed.length - 1] : parsed;
}

function section(deps: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.keys(deps).map((pkg) => {
      const v = latest(pkg);
      return [pkg, EXACT.has(pkg) ? v : `^${v}`];
    })
  );
}

const next = {
  dependencies: section(NEXT_PROJECT_VERSIONS.dependencies),
  devDependencies: section(NEXT_PROJECT_VERSIONS.devDependencies),
};
const file = path.resolve(import.meta.dirname, '../src/nextjs/versions.ts');
const header = fs.readFileSync(file, 'utf8').split('export const')[0];
fs.writeFileSync(file, `${header}export const NEXT_PROJECT_VERSIONS = ${JSON.stringify(next, null, 2)} as const;\n`);
console.log('Updated', path.relative(process.cwd(), file));
