import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { framerAdapter } from '../../src/convert/adapters/framer/index.js';
import { runGenerate } from '../../src/convert/generate/index.js';
import { readManifest } from '../../src/convert/generate/manifest.js';
import { runAnalyze } from '../../src/convert/stages/analyze.js';
import { runExtractCms } from '../../src/convert/stages/extract-cms.js';
import { runScaffold } from '../../src/convert/stages/scaffold/index.js';
import { initState } from '../../src/convert/state.js';
import { stopAllManaged } from '../../src/convert/verify/proc.js';

const fixture = path.resolve('tests/fixtures/framer-nudge-mini');
const tmps: string[] = [];

after(async () => {
  await stopAllManaged();
  for (const d of tmps) {
    await rm(d, { recursive: true, force: true }).catch(() => {});
  }
});

const exists = (p: string): Promise<boolean> => stat(p).then(() => true, () => false);

async function findTsxFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await findTsxFiles(full)));
    } else if (entry.name.endsWith('.tsx')) {
      results.push(full);
    }
  }
  return results;
}

test('generate stage writes sections, views, shell and manifest end-to-end', { timeout: 300_000 }, async () => {
  // Temp directory with a space
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'fexport generate '));
  tmps.push(tmp);
  const exportDir = path.join(tmp, 'nudge export');
  const nextDir = path.join(tmp, 'nudge next');

  await cp(fixture, exportDir, { recursive: true });

  // Add an empty <iframe> inside #main in index.html to verify stub detection (Assertion 7)
  // Also add an empty section in index.html to verify inline classification (Assertion 4)
  // Also inject client-script-rendered content inside Hero + About section to verify script-drawn detection (Pre-Flight Ruling #2)
  const indexFile = path.join(exportDir, 'index.html');
  let indexHtml = await readFile(indexFile, 'utf8');
  indexHtml = indexHtml.replace(
    'id="main"',
    'id="main"><div data-framer-name="Empty Section"></div><iframe id="test-empty-frame"></iframe>',
  );
  indexHtml = indexHtml.replace(
    'data-framer-name="Hero + About">',
    'data-framer-name="Hero + About"><script>document.write(\'<span class="ruler-mark" style="display:inline-block;width:50px;height:20px">100</span>\')</script>',
  );
  await writeFile(indexFile, indexHtml, 'utf8');

  // Pipeline execution: analyze -> extract-cms -> scaffold -> generate (no npm install)
  const state = initState(exportDir, nextDir);
  const logs: string[] = [];
  const ctx = {
    exportDir,
    nextDir,
    state,
    log: (msg: string) => logs.push(msg),
  };

  await runAnalyze(ctx, framerAdapter);
  await runExtractCms(ctx);
  await runScaffold(ctx, { confirmOverwrite: async () => true });

  // Inject an unmatched motion entry into animations.json before runGenerate (Assertion 5)
  const animationsPath = path.join(nextDir, '.convert', 'analysis', 'animations.json');
  const animations = JSON.parse(await readFile(animationsPath, 'utf8'));
  animations.push({
    route: '/',
    trigger: 'appear',
    selector: '#nonexistent-motion-anchor-xyz',
    to: { opacity: '1' },
  });
  await writeFile(animationsPath, JSON.stringify(animations, null, 2), 'utf8');

  // Run generate
  const manifest = await runGenerate(ctx);

  assert.equal(state.stages.generate, 'done', 'state.stages.generate should be marked done');

  // Manifest file exists on disk and matches returned manifest
  const diskManifest = await readManifest(nextDir);
  assert.ok(diskManifest, '.convert/analysis/generated.json should exist');
  assert.deepEqual(diskManifest, manifest);

  // Assertion 1: every manifest section `file` exists and contains `data-section="<name>"`
  const allSections = manifest.pages.flatMap((p) => p.sections);
  assert.ok(allSections.length > 0, 'manifest should have generated sections');
  for (const sec of allSections) {
    const secPath = path.join(nextDir, sec.file);
    assert.ok(await exists(secPath), `Section file ${sec.file} should exist`);
    const content = await readFile(secPath, 'utf8');
    assert.ok(
      content.includes(`data-section="${sec.name}"`),
      `Section file ${sec.file} should contain data-section="${sec.name}"`,
    );
  }

  // Assertion 2: the view imports its section components in manifest order and contains no `<fexport-section>`
  for (const page of manifest.pages) {
    const viewPath = path.join(nextDir, page.view);
    assert.ok(await exists(viewPath), `View file ${page.view} should exist`);
    const viewContent = await readFile(viewPath, 'utf8');
    assert.doesNotMatch(viewContent, /<fexport-section/i, `View ${page.view} should contain no <fexport-section>`);

    // Verify imports appear in manifest order
    let lastIdx = -1;
    for (const sec of page.sections) {
      const importRe = new RegExp(`import\\s+${sec.component}\\s+from\\s+`);
      const match = viewContent.match(importRe);
      assert.ok(match, `View ${page.view} should import section ${sec.component}`);
      const idx = match.index!;
      assert.ok(idx > lastIdx, `Section ${sec.component} in ${page.view} should be imported in manifest order`);
      lastIdx = idx;
    }
  }

  // Assertion 3: dynamic route (`/blog/[slug]`) has exactly one view and its page file contains `<View item={item} />`
  const blogPages = manifest.pages.filter((p) => p.route === '/blog/[slug]');
  assert.equal(blogPages.length, 1, 'Dynamic route /blog/[slug] should have exactly one manifest page');
  const blogPage = blogPages[0];
  assert.ok(await exists(path.join(nextDir, blogPage.view)), `Dynamic view ${blogPage.view} should exist`);

  const blogPageFile = path.join(nextDir, 'src', 'app', 'blog', '[slug]', 'page.tsx');
  assert.ok(await exists(blogPageFile), 'Dynamic page file should exist');
  const blogPageContent = await readFile(blogPageFile, 'utf8');
  assert.match(blogPageContent, /<View\s+item=\{item\}\s*\/>/, 'Dynamic page should contain <View item={item} />');

  // Assertion 4: `inline` lists empty sections and no file exists for them
  const homePage = manifest.pages.find((p) => p.route === '/');
  assert.ok(homePage, 'Home page should exist in manifest');
  assert.ok(
    homePage.inline.includes('Empty Section'),
    `homePage.inline should list 'Empty Section', got ${JSON.stringify(homePage.inline)}`,
  );
  const emptySecFile = path.join(nextDir, 'src', 'sections', 'home', 'EmptySection.tsx');
  assert.equal(await exists(emptySecFile), false, 'Empty section file should not exist on disk');

  // Assertion 5: manifest `motion` entries have ids `m1…` and `matched` booleans; unmatched ones produce a `generate: motion anchor not found` warning
  assert.ok(manifest.motion.length > 0, 'manifest should have motion entries');
  for (let i = 0; i < manifest.motion.length; i++) {
    const m = manifest.motion[i];
    assert.equal(m.id, `m${i + 1}`, `Motion entry at index ${i} should have id m${i + 1}`);
    assert.equal(typeof m.matched, 'boolean', `Motion entry ${m.id} should have matched boolean`);
  }
  const unmatched = manifest.motion.find((m) => m.entry.selector === '#nonexistent-motion-anchor-xyz');
  assert.ok(unmatched, 'Injected motion entry should be in manifest');
  assert.equal(unmatched.matched, false, 'Injected motion entry should have matched=false');
  assert.ok(
    manifest.warnings.some((w) => w.includes('generate: motion anchor not found')),
    'manifest.warnings should contain "generate: motion anchor not found"',
  );

  // Assertion 6: generated JSX contains no `var(--token-`
  const tsxFiles = await findTsxFiles(path.join(nextDir, 'src'));
  assert.ok(tsxFiles.length > 0, 'Next.js src should contain .tsx files');
  for (const file of tsxFiles) {
    // Only check generated files (sections, views, shell)
    const rel = path.relative(nextDir, file).replace(/\\/g, '/');
    if (rel.startsWith('src/sections/') || rel.startsWith('src/views/') || rel.startsWith('src/components/shell/')) {
      const code = await readFile(file, 'utf8');
      assert.doesNotMatch(
        code,
        /var\(--token-/,
        `Generated file ${rel} should not contain var(--token-`,
      );
    }
  }

  // Assertion 7: a fixture page with an added empty `<iframe>` (or form or code component) lists it in `stubs`
  assert.ok(manifest.stubs.length > 0, 'manifest should have stubs');
  const iframeStub = manifest.stubs.find((s) => s.includes('iframe'));
  assert.ok(iframeStub, `manifest.stubs should list the added empty iframe, got: ${JSON.stringify(manifest.stubs)}`);
  assert.match(iframeStub, /^.+ · .+ · iframe$/, 'stub format should match "<route> · <section> · iframe"');

  // Assertion 8 (Pre-Flight Ruling #2): script-drawn detection end-to-end
  assert.ok(manifest.scriptDrawn.length > 0, 'manifest.scriptDrawn should contain detected entries');
  const sdIds = manifest.scriptDrawn.map((sd) => sd.id);
  assert.equal(new Set(sdIds).size, sdIds.length, 'script-drawn ids are unique across the whole site');
  const s1Entry = manifest.scriptDrawn.find((sd) => sd.id === 's1');
  assert.ok(s1Entry, 'manifest.scriptDrawn should contain entry with id s1');
  assert.equal(s1Entry.route, '/', 's1 entry should match route /');
  assert.equal(s1Entry.section, 'Hero + About', 's1 entry should match section "Hero + About"');

  const heroSection = homePage.sections.find((s) => s.name === 'Hero + About');
  assert.ok(heroSection, 'home page should have "Hero + About" section');
  assert.ok(
    heroSection.scriptDrawn.includes('s1'),
    `Hero + About section.scriptDrawn should contain 's1', got: ${JSON.stringify(heroSection.scriptDrawn)}`,
  );
});
