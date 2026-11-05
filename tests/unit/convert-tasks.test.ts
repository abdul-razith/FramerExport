import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { initState, loadState, DEFAULT_OPTIONS } from '../../src/convert/state.js';
import { renderTemplate, renderTaskFiles, runTasks, checkCommand } from '../../src/convert/stages/tasks.js';
import { SHARED_RULES, TEMPLATES, CLI_INVOCATION } from '../../src/convert/tasks/templates/index.js';
import type { GeneratedManifest } from '../../src/convert/generate/manifest.js';
import type { StageContext } from '../../src/convert/adapters/types.js';

const tmps: string[] = [];
after(async () => {
  for (const d of tmps) await rm(d, { recursive: true, force: true });
});

async function makeContext(): Promise<StageContext> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fexport tasks '));
  tmps.push(root);
  const nextDir = path.join(root, 'next');
  const exportDir = path.join(root, 'export');
  return {
    state: initState(exportDir, nextDir),
    exportDir,
    nextDir,
    log: () => {},
  };
}

const sampleManifest: GeneratedManifest = {
  version: 1,
  shell: [
    {
      name: 'Navigation',
      component: 'Navigation',
      file: 'src/components/shell/Navigation.tsx',
      pages: ['/'],
      differences: [],
    },
  ],
  pages: [
    {
      route: '/',
      slug: 'home',
      view: 'src/views/home.tsx',
      sections: [
        {
          name: 'Hero',
          component: 'Hero',
          file: 'src/sections/home/Hero.tsx',
          parts: [],
          motion: ['m2'],
          scriptDrawn: ['sd-1'],
          hasVariants: true,
          repeated: ['ProjectCard'],
          cmsFields: [],
        },
        {
          name: 'About',
          component: 'About',
          file: 'src/sections/home/About.tsx',
          parts: [],
          motion: [],
          scriptDrawn: [],
          hasVariants: false,
          repeated: [],
          cmsFields: [],
        },
      ],
      inline: ['empty-sec'],
      shell: ['Navigation'],
    },
    {
      route: '/blog/[slug]',
      slug: 'blog-slug',
      view: 'src/views/blog-slug.tsx',
      dynamic: {
        collection: 'blog',
        firstSlug: 'first-post',
      },
      sections: [
        {
          name: 'Detail',
          component: 'Detail',
          file: 'src/sections/blog-slug/Detail.tsx',
          parts: [],
          motion: [],
          scriptDrawn: [],
          hasVariants: false,
          repeated: [],
          cmsFields: ['title', 'body'],
        },
      ],
      inline: [],
      shell: [],
    },
  ],
  motion: [
    {
      id: 'm2',
      route: '/',
      section: 'Hero',
      matched: true,
      entry: {
        route: '/',
        selector: '.comment-box',
        framerName: 'Comment',
        trigger: 'scroll',
        durationMs: 1300,
        from: { opacity: '0' },
        to: { opacity: '1' },
        confidence: 'high',
      },
    },
    {
      id: 'm3',
      route: '/',
      section: null,
      matched: false,
      entry: {
        route: '/',
        selector: '.missing-anchor',
        framerName: 'UnanchoredFloatingCard',
        trigger: 'appear',
        from: { opacity: '0' },
        to: { opacity: '1' },
        confidence: 'low',
      },
    },
  ],
  scriptDrawn: [
    {
      id: 'sd-1',
      route: '/',
      section: 'Hero',
      box: { x: 0, y: 0, width: 100, height: 20 },
      sample: '12:00:00',
      count: 1,
      ticking: true,
    },
  ],
  stubs: [],
  warnings: [],
};

const read = (ctx: { nextDir: string }, rel: string) => readFile(path.join(ctx.nextDir, rel), 'utf8');

test('TEMPLATES keys are exactly shell, section, page, fix, agents (component and motion removed)', () => {
  const keys = Object.keys(TEMPLATES).sort();
  assert.deepEqual(keys, ['agents', 'fix', 'page', 'section', 'shell']);
});

test('checkCommand produces CLI check command with --smoke when testing is false', () => {
  assert.equal(checkCommand('sec-home-hero', true), `${CLI_INVOCATION} check sec-home-hero`);
  assert.equal(checkCommand('sec-home-hero', false), `${CLI_INVOCATION} check sec-home-hero --smoke`);
});

test('renderTemplate substitutes and throws on unreplaced', () => {
  assert.throws(() => renderTemplate('fix', {}), /unreplaced/);
  const out = renderTemplate('fix', {
    taskId: 'fix-001',
    attempt: '2',
    targets: '- `a.tsx`',
    failures: 'boom',
    doneWhen: 'run it',
    rules: 'R',
  });
  assert.match(out, /fix-001/);
  assert.doesNotMatch(out, /\{\{/);
});

test('SHARED_RULES contains spec 6.3 verbatim bullets', () => {
  assert.match(SHARED_RULES, /Edit only the listed targets \(a target ending in `\/` allows new files inside that directory\)\./);
  assert.match(SHARED_RULES, /Tailwind utilities \(arbitrary values allowed\); no `framer-` class names; no inline `style` except motion values and CSS custom properties\./);
  assert.match(SHARED_RULES, /Keep the root `data-section` attribute and every `data-motion` attribute\./);
  assert.match(SHARED_RULES, /Keep `img` elements' `src`, `srcSet`, `sizes` and `alt` \(plain `img`, not `next\/image`\)\./);
  assert.match(SHARED_RULES, /Use `src\/lib\/motion\.ts` \/ `src\/lib\/gsap\.ts`; framer-motion for appear and hover, GSAP ScrollTrigger for scroll-linked motion\. Under `\?__verify=1` everything renders in its finished state\./);
  assert.match(SHARED_RULES, /\*\*Never run `npm run build`, `next dev`, `next start` or `npm install`\.\*\*/);
  assert.match(SHARED_RULES, /Testing on: check with `fexport convert check <taskId>`; testing off: `fexport convert check <taskId> --smoke`\. Stop when it passes or when it says the limit is reached\./);
});

test('runTasks creates records with correct ids, kinds, targets, dependsOn, no task for inline section', async () => {
  const ctx = await makeContext();
  const records = await runTasks(ctx, sampleManifest);

  const ids = records.map((r) => r.id);
  assert.deepEqual(ids, [
    'shell-navigation',
    'sec-home-hero',
    'sec-home-about',
    'sec-blog-slug-detail',
    'page-home',
    'page-blog-slug',
  ]);

  // No task for empty inline section
  assert.equal(ids.includes('empty-sec'), false);
  assert.equal(ids.some((id) => id.includes('empty')), false);

  // Shell task
  const nav = records.find((r) => r.id === 'shell-navigation')!;
  assert.equal(nav.kind, 'shell');
  assert.deepEqual(nav.targets, ['src/components/shell/Navigation.tsx', 'src/components/shell/Navigation/']);
  assert.deepEqual(nav.dependsOn, []);

  // Section tasks depend on all shell task ids
  const hero = records.find((r) => r.id === 'sec-home-hero')!;
  assert.equal(hero.kind, 'section');
  assert.deepEqual(hero.targets, ['src/sections/home/Hero.tsx', 'src/sections/home/Hero/']);
  assert.deepEqual(hero.dependsOn, ['shell-navigation']);

  const about = records.find((r) => r.id === 'sec-home-about')!;
  assert.equal(about.kind, 'section');
  assert.deepEqual(about.targets, ['src/sections/home/About.tsx', 'src/sections/home/About/']);
  assert.deepEqual(about.dependsOn, ['shell-navigation']);

  // Page task depends on its section ids and used shell ids
  const pageHome = records.find((r) => r.id === 'page-home')!;
  assert.equal(pageHome.kind, 'page');
  assert.deepEqual(pageHome.targets, ['src/views/home.tsx', 'src/components/page/home/']);
  assert.deepEqual(pageHome.dependsOn, ['sec-home-hero', 'sec-home-about', 'shell-navigation']);

  const pageBlog = records.find((r) => r.id === 'page-blog-slug')!;
  assert.equal(pageBlog.kind, 'page');
  assert.deepEqual(pageBlog.targets, ['src/views/blog-slug.tsx', 'src/components/page/blog-slug/']);
  assert.deepEqual(pageBlog.dependsOn, ['sec-blog-slug-detail']);

  // State stage updated to 'done'
  assert.equal(ctx.state.stages.tasks, 'done');
});

test('section file contains ## Edit only, decomposed motion, script-drawn, variants, repeated components, cms fields', async () => {
  const ctx = await makeContext();
  await runTasks(ctx, sampleManifest);

  const heroText = await read(ctx, '.convert/tasks/sec-home-hero.md');
  assert.match(heroText, /## Edit only/);
  // Decomposed motion line
  assert.match(heroText, /`m2` "Comment" \(scroll, 1\.3 s\): opacity 0→1/);
  // Script-drawn line with ticking every second
  assert.match(heroText, /`sd-1`.*ticking every second/);
  // Variants instruction with md: and lg:
  assert.match(heroText, /md:.*lg:/);
  // Repeated components
  assert.match(heroText, /ProjectCard/);

  // Dynamic route section has cms: fields
  const detailText = await read(ctx, '.convert/tasks/sec-blog-slug-detail.md');
  assert.match(detailText, /cms:/);
  assert.match(detailText, /title/);
  assert.match(detailText, /body/);
});

test('every task file and AGENTS.md contain "Never run `npm run build`"', async () => {
  const ctx = await makeContext();
  const records = await runTasks(ctx, sampleManifest);

  for (const r of records) {
    const text = await read(ctx, r.file);
    assert.match(text, /Never run `npm run build`/, `File ${r.file} missing Never run npm run build`);
  }

  const agents = await read(ctx, 'AGENTS.md');
  assert.match(agents, /Never run `npm run build`/);

  const claude = await read(ctx, 'CLAUDE.md');
  assert.match(claude, /Never run `npm run build`/);
});

test('Done when contains check <id> and after testing=false re-rendering check <id> --smoke', async () => {
  const ctx = await makeContext();
  await runTasks(ctx, sampleManifest);

  const heroBefore = await read(ctx, '.convert/tasks/sec-home-hero.md');
  assert.match(heroBefore, /check sec-home-hero/);
  assert.doesNotMatch(heroBefore, /check sec-home-hero --smoke/);

  // Toggle testing off and re-render
  ctx.state.options = { ...DEFAULT_OPTIONS, agent: 'agy', testing: false };
  await renderTaskFiles(ctx, sampleManifest);

  const heroAfter = await read(ctx, '.convert/tasks/sec-home-hero.md');
  assert.match(heroAfter, /check sec-home-hero --smoke/);
});

test('unmatched motion anchors are listed by Framer name under Unanchored animations', async () => {
  const ctx = await makeContext();
  await runTasks(ctx, sampleManifest);

  // Check in page-home or sec-home-hero
  const pageHome = await read(ctx, '.convert/tasks/page-home.md');
  const heroText = await read(ctx, '.convert/tasks/sec-home-hero.md');
  const hasUnanchored = pageHome.includes('UnanchoredFloatingCard') || heroText.includes('UnanchoredFloatingCard');
  assert.ok(hasUnanchored, 'UnanchoredFloatingCard should be present in task files');

  if (pageHome.includes('UnanchoredFloatingCard')) {
    assert.match(pageHome, /Unanchored animations[\s\S]*UnanchoredFloatingCard/);
  }
  if (heroText.includes('UnanchoredFloatingCard')) {
    assert.match(heroText, /Unanchored animations[\s\S]*UnanchoredFloatingCard/);
  }
});

test('part tasks for oversized sections: part files, part dirs, and wrapper in page targets', async () => {
  const ctx = await makeContext();
  const manifestWithParts: GeneratedManifest = {
    ...sampleManifest,
    pages: [
      {
        route: '/',
        slug: 'home',
        view: 'src/views/home.tsx',
        sections: [
          {
            name: 'Oversized',
            component: 'Oversized',
            file: 'src/sections/home/Oversized.tsx',
            parts: [
              {
                name: 'TopHeader',
                component: 'TopHeader',
                file: 'src/sections/home/Oversized/TopHeader.tsx',
              },
              {
                name: 'BottomGrid',
                component: 'BottomGrid',
                file: 'src/sections/home/Oversized/BottomGrid.tsx',
              },
            ],
            motion: [],
            scriptDrawn: [],
            hasVariants: false,
            repeated: [],
            cmsFields: [],
          },
        ],
        inline: [],
        shell: [],
      },
    ],
  };

  const records = await runTasks(ctx, manifestWithParts);
  const partTaskA = records.find((r) => r.id === 'sec-home-oversized-top-header');
  assert.ok(partTaskA);
  assert.equal(partTaskA.kind, 'section');
  assert.deepEqual(partTaskA.targets, [
    'src/sections/home/Oversized/TopHeader.tsx',
    'src/sections/home/Oversized/TopHeader/',
  ]);

  const partTaskB = records.find((r) => r.id === 'sec-home-oversized-bottom-grid');
  assert.ok(partTaskB);
  assert.equal(partTaskB.kind, 'section');

  const page = records.find((r) => r.id === 'page-home')!;
  assert.ok(page.targets.includes('src/sections/home/Oversized.tsx'));
  assert.deepEqual(page.dependsOn, [
    'sec-home-oversized-top-header',
    'sec-home-oversized-bottom-grid',
  ]);
});

test('re-run keeps status and attempts of existing tasks', async () => {
  const ctx = await makeContext();
  await runTasks(ctx, sampleManifest);

  ctx.state.tasks['sec-home-hero']!.status = 'in-progress';
  ctx.state.tasks['sec-home-hero']!.attempts = 2;

  await runTasks(ctx, sampleManifest);
  assert.equal(ctx.state.tasks['sec-home-hero']!.status, 'in-progress');
  assert.equal(ctx.state.tasks['sec-home-hero']!.attempts, 2);

  const loaded = await loadState(ctx.nextDir);
  assert.equal(loaded!.tasks['sec-home-hero']!.status, 'in-progress');
  assert.equal(loaded!.tasks['sec-home-hero']!.attempts, 2);
});
