import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { framerAdapter } from '../../src/convert/adapters/framer/index.js';
import { initState, loadState } from '../../src/convert/state.js';
import { runAnalyze } from '../../src/convert/stages/analyze.js';
import { runExtractCms } from '../../src/convert/stages/extract-cms.js';
import { runScaffold } from '../../src/convert/stages/scaffold/index.js';
import { STACK_VERSIONS } from '../../src/convert/stages/scaffold/versions.js';
import type { Tokens } from '../../src/convert/types.js';

const fixture = path.resolve('tests/fixtures/framer-nudge-mini');
const tmps: string[] = [];
after(async () => {
  for (const d of tmps) await rm(d, { recursive: true, force: true });
});

async function prepare() {
  const nextDir = await mkdtemp(path.join(os.tmpdir(), 'fexport scaffold '));
  tmps.push(nextDir);
  const ctx = { state: initState(fixture, nextDir), exportDir: fixture, nextDir, log: () => {} };
  await runAnalyze(ctx, framerAdapter, { animations: false });
  await runExtractCms(ctx);
  return ctx;
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

let shared: Awaited<ReturnType<typeof prepare>> | undefined;
async function ran() {
  if (!shared) {
    shared = await prepare();
    await runScaffold(shared);
  }
  return shared;
}
const read = (ctx: { nextDir: string }, rel: string) => readFile(path.join(ctx.nextDir, rel), 'utf8');

test('STACK_VERSIONS are exact semver', () => {
  for (const [k, v] of Object.entries(STACK_VERSIONS)) assert.match(v, /^\d+\.\d+\.\d+$/, k);
  assert.equal(Object.keys(STACK_VERSIONS).length, 16);
});

test('fixture: globals.css, dynamic page, fonts, state', async () => {
  const ctx = await ran();
  const css = await read(ctx, 'src/app/globals.css');
  assert.match(css, /@import "tailwindcss";/);
  assert.match(css, /@theme \{/);
  assert.match(css, /--breakpoint-md: 810px/);
  assert.match(css, /--breakpoint-lg: 1200px/);
  assert.match(css, /--color-/);
  assert.match(css, /--font-/);
  assert.match(css, /--text-/);

  const dyn = await read(ctx, 'src/app/case-study/[slug]/page.tsx');
  assert.match(dyn, /generateStaticParams/);
  assert.match(dyn, /from '@\/content\/caseStudy'/);
  assert.match(dyn, /params: Promise<\{ slug: string \}>/);
  assert.match(dyn, /await params/);
  assert.match(dyn, /notFound\(\)/);
  assert.match(dyn, /data-page="\/case-study\/\[slug\]"/);

  const layout = await read(ctx, 'src/app/layout.tsx');
  assert.ok(layout.indexOf("import './fonts.css'") < layout.indexOf("import './globals.css'"));
  assert.match(layout, /export const metadata/);
  assert.match(layout, /LenisProvider/);

  const tokens = JSON.parse(await read(ctx, '.convert/analysis/tokens.json')) as Tokens;
  const expected = tokens.fonts.reduce((n, f) => n + f.files.length, 0);
  const fontFiles = await readdir(path.join(ctx.nextDir, 'public', 'fonts'));
  assert.equal(fontFiles.length, expected);
  const fontsCss = await read(ctx, 'src/app/fonts.css');
  assert.match(fontsCss, /unicode-range:/);
  assert.match(fontsCss, /font-display: swap/);
  const urls = [...fontsCss.matchAll(/url\('\/fonts\/([^']+)'\)/g)].map((m) => m[1]!);
  assert.ok(urls.length > 0);
  for (const u of urls) assert.ok((await stat(path.join(ctx.nextDir, 'public', 'fonts', u))).isFile(), u);

  assert.match(await read(ctx, 'src/lib/motion.ts'), /MotionGlobalConfig\.skipAnimations = true/);
  assert.match(await read(ctx, 'src/lib/gsap.ts'), /window\.gsap = gsap/);
  assert.match(await read(ctx, '.gitignore'), /!\.convert\/tasks\//);
  assert.equal(JSON.parse(await read(ctx, 'package.json')).dependencies.next, STACK_VERSIONS.next);
});

test('fixture: images copied, manifest written, no vendor/CDN references', async () => {
  const ctx = await ran();
  const manifest = JSON.parse(await read(ctx, '.convert/analysis/images.json')) as Record<string, string>;
  assert.ok(Object.keys(manifest).length > 0);
  for (const [k, v] of Object.entries(manifest)) {
    assert.match(k, /^assets\/images\//);
    assert.equal(v, `/images/${path.posix.basename(k)}`);
    assert.ok((await stat(path.join(ctx.nextDir, 'public', v))).isFile());
  }
  const cms = await read(ctx, 'src/content/caseStudy.ts');
  for (const m of cms.matchAll(/"\/images\/([^"]+)"/g)) assert.ok(manifest[`assets/images/${m[1]}`], m[1]);

  const generated = (await walk(ctx.nextDir)).filter(
    (f) => !f.includes(`${path.sep}.convert${path.sep}`) && !f.includes(`${path.sep}public${path.sep}`),
  );
  for (const f of generated) {
    const text = await readFile(f, 'utf8');
    assert.ok(!text.includes('scripts/vendor'), f);
    assert.ok(!text.includes('framerusercontent.com'), f);
  }
  assert.equal((await loadState(ctx.nextDir))?.stages.scaffold, 'done');
  assert.ok(ctx.state.fileHashes['src/app/layout.tsx']);
  assert.equal(ctx.state.fileHashes['public/fonts'], undefined);
});

test('layout sets metadataBase and LenisProvider imports lenis css', async () => {
  const ctx = await ran();
  assert.match(await read(ctx, 'src/app/layout.tsx'), /metadataBase: new URL\("https:\/\/nudge-folio\.framer\.website"\)/);
  assert.match(await read(ctx, 'src/components/providers/LenisProvider.tsx'), /import 'lenis\/dist\/lenis\.css'/);
});

test('scaffold without analysis rejects and does not mark done', async () => {
  const nextDir = await mkdtemp(path.join(os.tmpdir(), 'fexport scaffold '));
  tmps.push(nextDir);
  const ctx = { state: initState(fixture, nextDir), exportDir: fixture, nextDir, log: () => {} };
  await assert.rejects(runScaffold(ctx), /run analyze first/);
  assert.notEqual(ctx.state.stages.scaffold, 'done');
});

test('edited files are skipped unless confirmOverwrite approves', async () => {
  const ctx = await prepare();
  await runScaffold(ctx);
  const layout = path.join(ctx.nextDir, 'src', 'app', 'layout.tsx');
  await writeFile(layout, '// edited by AI\n', 'utf8');
  const hashBefore = ctx.state.fileHashes['src/app/layout.tsx'];
  const r1 = await runScaffold(ctx);
  assert.equal(await readFile(layout, 'utf8'), '// edited by AI\n');
  assert.ok(r1.skipped.includes('src/app/layout.tsx'));
  const kept = 'scaffold: kept edited file src/app/layout.tsx';
  assert.equal(ctx.state.fileHashes['src/app/layout.tsx'], hashBefore);
  assert.equal(ctx.state.warnings.filter((w) => w === kept).length, 1);
  await runScaffold(ctx);
  assert.equal(ctx.state.warnings.filter((w) => w === kept).length, 1);
  const r2 = await runScaffold(ctx, { confirmOverwrite: async () => true });
  assert.ok(r2.written.includes('src/app/layout.tsx'));
  assert.match(await readFile(layout, 'utf8'), /LenisProvider/);
});

test('package.json installs TS 6 under the typescript name for typescript-eslint, TS 7 as @typescript/native', async () => {
  // typescript-eslint (pulled in by eslint-config-next) throws "does not support TS 7.0" when `typescript` is TS 7.
  const ctx = await ran();
  const pkg = JSON.parse(await read(ctx, 'package.json')) as { devDependencies: Record<string, string> };
  assert.equal(pkg.devDependencies.typescript, `npm:@typescript/typescript6@${STACK_VERSIONS['@typescript/typescript6']}`);
  assert.equal(pkg.devDependencies['@typescript/native'], `npm:typescript@${STACK_VERSIONS.typescript}`);
  assert.match(STACK_VERSIONS['@typescript/typescript6'], /^6\./);
});

test('tsconfig matches what next build would rewrite it to', async () => {
  // `next build` rewrites jsx to react-jsx and adds .next/dev/types, which would mark the file as user-edited.
  const ctx = await ran();
  const ts = JSON.parse(await read(ctx, 'tsconfig.json')) as { compilerOptions: { jsx: string }; include: string[] };
  assert.equal(ts.compilerOptions.jsx, 'react-jsx');
  assert.ok(ts.include.includes('.next/types/**/*.ts'));
  assert.ok(ts.include.includes('.next/dev/types/**/*.ts'));
});


test('generated next.config.ts contains agentRules: false', async () => {
  const ctx = await ran();
  const nextConfig = await read(ctx, 'next.config.ts');
  assert.match(nextConfig, /agentRules:\s*false/);
});
