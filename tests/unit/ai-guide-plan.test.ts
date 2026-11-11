import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { planTasks, renderPlan, writePlanFile } from '../../src/ai-guide/plan.js';
import { renderContentMd, renderSiteMd } from '../../src/ai-guide/site-docs.js';
import { AGENTS_MD } from '../../src/ai-guide/templates/agents.js';
import { CHECKLIST_MD } from '../../src/ai-guide/templates/checklist.js';
import { renderReadme } from '../../src/ai-guide/templates/readme.js';
import { fixtureSite } from './ai-guide-fixture.js';

test('one task per page: setup, shell, each regular page, each collection, review', () => {
  assert.deepEqual(
    planTasks(fixtureSite()).map((t) => t.title),
    ['Create the Next.js project', 'Site shell', 'Home page (/)', 'About page (/about)', 'Blog collection (/blog)', 'Review and cleanup']
  );
});

test('plan.md is a superpowers plan with one checkbox step per section, each with the compare loop', () => {
  const md = renderPlan(fixtureSite());
  assert.match(md, /^> \*\*For agentic workers:\*\* REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development \(recommended\) or superpowers:executing-plans/m);
  assert.match(md, /^### Task 2: Home page \(\/\)$/m);
  assert.match(md, /- \[ \] \*\*Step 2: 01 Hero Section\*\* — read `ai-guide\/pages\/index\/sections\/01-hero-section\/` \(ref\.md, markup, styles\.css, shot slices\)/);
  assert.ok(md.includes('`src/components/sections/home/HomeHeroSection.tsx`'));
  assert.ok(md.includes('`npm run compare -- / --section 01`'));
  assert.ok(md.includes('≥ 90% at 1440, 1024 and 390'));
  assert.ok(md.includes('at most 3 fix rounds'));
  assert.match(md, /- \[ \] \*\*Step \d+: Verify\*\* — Use superpowers:verification-before-completion/);
  assert.doesNotMatch(md, /outline\.md/);
});

test('the shell task has one step per shell part', () => {
  const md = renderPlan(fixtureSite());
  assert.match(md, /- \[ \] \*\*Step \d+: S1 Header\*\* — read `ai-guide\/shell\/S1-header\/`/);
  assert.ok(md.includes('`npm run compare -- / --section S1`'));
});

test('setup uses create-next-app with a src folder and installs packages at latest', () => {
  const md = renderPlan(fixtureSite());
  assert.ok(md.includes('npx create-next-app@latest nextjs-app --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes'));
  assert.ok(md.includes('npm i motion gsap @gsap/react lenis @next/mdx @mdx-js/loader @mdx-js/react'));
  assert.ok(md.includes('npm i -D @types/mdx puppeteer pngjs pixelmatch'));
  assert.ok(md.includes('src/app/globals.css'));
  assert.ok(md.includes('ai-guide/text-styles.css'));
  assert.doesNotMatch(md, /@\^?\d+\.\d+/, 'no pinned versions');
});

test('collection item pages are not page tasks', () => {
  assert.doesNotMatch(renderPlan(fixtureSite()), /Task \d+: .*\/blog\/post-a/);
});

test('re-running keeps ticked progress: a plan with [x] is not overwritten', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-guide-plan-'));
  await fs.writeFile(path.join(dir, 'plan.md'), '- [x] **Step 1: done**');
  assert.equal(await writePlanFile(dir, 'new plan'), 'plan.new.md');
  assert.equal(await fs.readFile(path.join(dir, 'plan.md'), 'utf8'), '- [x] **Step 1: done**');
  assert.equal(await fs.readFile(path.join(dir, 'plan.new.md'), 'utf8'), 'new plan');
});

test('an untouched plan is replaced', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-guide-plan-'));
  await fs.writeFile(path.join(dir, 'plan.md'), '- [ ] **Step 1: todo**');
  assert.equal(await writePlanFile(dir, 'new plan'), 'plan.md');
  assert.equal(await fs.readFile(path.join(dir, 'plan.md'), 'utf8'), 'new plan');
});

test('AGENTS.md tells the agent to use the superpowers skills and the stack', () => {
  for (const s of [
    'superpowers:executing-plans',
    'superpowers:subagent-driven-development',
    'superpowers:verification-before-completion',
    'superpowers:systematic-debugging',
    'nextjs-app/',
    'create-next-app@latest',
    'Tailwind CSS',
    'prefers-reduced-motion',
    'Never copy Framer runtime',
  ]) {
    assert.ok(AGENTS_MD.includes(s), s);
  }
});

test('README explains how to run with Claude Code, agy and without the plugin', () => {
  const md = renderReadme(fixtureSite());
  assert.match(md, /Claude Code/);
  assert.match(md, /agy/);
  assert.match(md, /without the superpowers plugin/i);
});

test('site.md ends with the task list', () => {
  assert.match(renderSiteMd(fixtureSite()), /## Tasks \(ai-guide\/plan\.md\)\n\n1\. Task 0: Create the Next\.js project/);
});

test('the checklist covers looks, mobile, links, animation and code', () => {
  for (const s of ['1440', '390', 'links', 'animation', 'raw hex']) assert.ok(CHECKLIST_MD.includes(s), s);
});

test('setup adds the compare script', () => {
  assert.match(renderPlan(fixtureSite()), /"compare": "node \.\.\/ai-guide\/scripts\/compare\.mjs"/);
});

test('route stubs name one real folder per collection, none when there is no collection', () => {
  const site = fixtureSite();
  const two = { ...site, collections: [...site.collections, { ...site.collections[0], name: 'work', indexRoute: '/work', itemPattern: '/work/[slug]' }] };
  const md = renderPlan(two);
  assert.match(md, /`src\/app\/blog\/\[slug\]\/page\.tsx`, `src\/app\/work\/\[slug\]\/page\.tsx`/);
  assert.doesNotMatch(renderPlan({ ...site, collections: [] }), /<collection>|\[slug\]\/page\.tsx` stubs/);
});

test('the agent rules allow the compare output folder', () => {
  assert.match(AGENTS_MD, /ai-guide\/compare\//);
});

test('the agent rules say to build from the export markup and CSS and reach the gate', () => {
  for (const s of ['markup', 'styles.css', 'data-section', 'data-live', '90%', 'exact values', 'src/components']) assert.ok(AGENTS_MD.includes(s), s);
  assert.doesNotMatch(AGENTS_MD, /structure and text only/);
});

test('README describes the v2 guide layout', () => {
  const md = renderReadme(fixtureSite());
  for (const s of ['sections/<id>-<name>/', 'ref.md', 'markup', 'styles.css', 'ai-guide/shell/', 'ai-guide/text-styles.css', 'ai-guide/sections.json', '90%']) assert.ok(md.includes(s), s);
  assert.doesNotMatch(md, /outline\.md|Chrome must be installed/);
});

test('the checklist asks for the compare scores', () => {
  assert.ok(CHECKLIST_MD.includes('npm run compare'));
  assert.ok(CHECKLIST_MD.includes('90%'));
});

test('site docs no longer point at outline.md', () => {
  const site = fixtureSite();
  assert.doesNotMatch(renderSiteMd(site), /outline\.md/);
  assert.doesNotMatch(renderContentMd({ ...site, collections: [] }), /outline\.md/);
});

test('the tablet variant is the 810–1199 range and the rules explain the CSS width groups', () => {
  assert.ok(renderPlan(fixtureSite()).includes('`tablet` = `@media (min-width: 810px) and (max-width: 1199px)`'));
  for (const s of ['tablet 810–1199px', 'tablet + mobile ≤1199px', 'both `tablet:` and `mobile:`']) assert.ok(AGENTS_MD.includes(s), s);
});

test('the shell task covers shell parts of every page, compared on the page that owns them', () => {
  const site = fixtureSite();
  const header = site.pages[0].shell![0];
  const menu = { ...header, id: 'S2', name: 'About Menu', key: 'k:menu', ownerRoute: '/about' };
  const md = renderPlan({ ...site, shell: [{ ...header, ownerRoute: '/' }, menu] });
  assert.match(md, /- \[ \] \*\*Step \d+: S2 About Menu\*\* — read `ai-guide\/shell\/S2-about-menu\/`/);
  assert.ok(md.includes('`npm run compare -- /about --section S2`'));
});
