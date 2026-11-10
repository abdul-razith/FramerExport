import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { planTasks, renderPlan, writePlanFile } from '../../src/ai-guide/plan.js';
import { renderSiteMd } from '../../src/ai-guide/site-docs.js';
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

test('plan.md is a superpowers plan with one checkbox step per section', () => {
  const md = renderPlan(fixtureSite());
  assert.match(md, /^> \*\*For agentic workers:\*\* REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development \(recommended\) or superpowers:executing-plans/m);
  assert.match(md, /^### Task 2: Home page \(\/\)$/m);
  assert.match(md, /- \[ \] \*\*Step 2: Hero Section\*\* — build `components\/sections\/home\/HomeHeroSection\.tsx` from `ai-guide\/pages\/index\/outline\.md#01`/);
  assert.match(md, /- \[ \] \*\*Step \d+: Verify\*\* — Use superpowers:verification-before-completion/);
  assert.match(md, /npm run compare \//);
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
    'Next.js 16',
    'Tailwind 4',
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

test('setup installs what the compare script needs', () => {
  assert.match(renderPlan(fixtureSite()), /npm install -D [^`]*puppeteer@[^`]* pngjs@[^`]* pixelmatch@/);
});
