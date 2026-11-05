import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { PNG } from 'pngjs';
import puppeteer, { type Browser } from 'puppeteer';
import type { StageContext } from '../../src/convert/adapters/types.js';
import { initState, loadState, saveState } from '../../src/convert/state.js';
import type { ConvertState, TaskRecord } from '../../src/convert/types.js';
import { capturePageSections } from '../../src/convert/verify/capture-sections.js';
import { baselineDir, runBaseline, BASELINE_WIDTHS } from '../../src/convert/verify/baseline.js';

const tmps: string[] = [];
let browser: Browser | undefined;
let server: http.Server;
let serverUrl: string;

async function tmp(prefix = 'convert baseline '): Promise<string> {
  const d = await mkdtemp(path.join(os.tmpdir(), prefix));
  tmps.push(d);
  return d;
}

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (url.pathname === '/contact') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<!doctype html>
<html>
  <head>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      .contact-banner { height: 120px; background: #e0e0e0; }
    </style>
  </head>
  <body>
    <div data-section="contact-banner" class="contact-banner">
      <h2>Contact Us Today</h2>
      <a href="mailto:info@example.com">Email Us</a>
    </div>
  </body>
</html>`);
      return;
    }

    // Default route "/"
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html>
<html>
  <head>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      .hero { height: 400px; background: #ff4444; }
      .footer { height: 200px; background: #4444ff; }
      @media (max-width: 1000px) {
        .hero { height: 320px; }
        .footer { height: 180px; }
      }
      @media (max-width: 390px) {
        .hero { height: 240px; }
        .footer { height: 150px; }
      }
    </style>
  </head>
  <body>
    <header data-section="hero" class="hero">
      <h1>Hero Headline</h1>
      <a href="/explore">Explore More</a>
    </header>
    <footer data-section="footer" class="footer">
      <p>Footer Copyright 2026</p>
      <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="pixel" />
    </footer>
    <div data-section="empty-section" style="height: 0px; display: none;"></div>
  </body>
</html>`);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      serverUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

after(async () => {
  await browser?.close().catch(() => {});
  await new Promise<void>((resolve) => server.close(() => resolve())).catch(() => {});
  for (const d of tmps) {
    await rm(d, { recursive: true, force: true }).catch(() => {});
  }
});

test('baselineDir constructs correct paths for section and shell tasks', () => {
  const nextDir = path.join(os.tmpdir(), 'test next dir with spaces');

  const secHero: TaskRecord = {
    id: 'sec-home-hero',
    kind: 'section',
    route: '/',
    section: 'hero',
    file: '.convert/tasks/sec-home-hero.md',
    status: 'pending',
    attempts: 0,
    targets: []
  };
  assert.equal(
    baselineDir(nextDir, secHero),
    path.join(nextDir, '.convert', 'baseline', 'home', 'hero')
  );

  const secNested: TaskRecord = {
    id: 'sec-about-team-members',
    kind: 'section',
    route: '/about',
    section: 'Team/Members',
    file: '.convert/tasks/sec-about-team-members.md',
    status: 'pending',
    attempts: 0,
    targets: []
  };
  assert.equal(
    baselineDir(nextDir, secNested),
    path.join(nextDir, '.convert', 'baseline', 'about', 'team-members')
  );

  const secDynamic: TaskRecord = {
    id: 'sec-blog-slug-content',
    kind: 'section',
    route: '/blog/[slug]',
    section: 'Content',
    file: '.convert/tasks/sec-blog-slug-content.md',
    status: 'pending',
    attempts: 0,
    targets: []
  };
  assert.equal(
    baselineDir(nextDir, secDynamic),
    path.join(nextDir, '.convert', 'baseline', 'blog-slug', 'content')
  );

  const secNoRoute: TaskRecord = {
    id: 'sec-pricing-tier-card',
    kind: 'section',
    section: 'TierCard',
    file: '.convert/tasks/sec-pricing-tier-card.md',
    status: 'pending',
    attempts: 0,
    targets: []
  };
  assert.equal(
    baselineDir(nextDir, secNoRoute),
    path.join(nextDir, '.convert', 'baseline', 'pricing', 'tier-card')
  );

  const shellNav: TaskRecord = {
    id: 'shell-navbar',
    kind: 'shell',
    section: 'Navbar',
    file: '.convert/tasks/shell-navbar.md',
    status: 'pending',
    attempts: 0,
    targets: []
  };
  assert.equal(
    baselineDir(nextDir, shellNav),
    path.join(nextDir, '.convert', 'baseline', 'shell', 'navbar')
  );

  const shellFooter: TaskRecord = {
    id: 'shell-site-footer',
    kind: 'shell',
    file: '.convert/tasks/shell-site-footer.md',
    status: 'pending',
    attempts: 0,
    targets: []
  };
  assert.equal(
    baselineDir(nextDir, shellFooter),
    path.join(nextDir, '.convert', 'baseline', 'shell', 'site-footer')
  );
});

test('capturePageSections captures and crops visible sections, omitting missing/zero-size', { timeout: 60_000 }, async () => {
  browser ??= await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();

  try {
    const results = await capturePageSections(
      page,
      serverUrl + '/',
      1000,
      ['hero', 'footer', 'empty-section', 'nonexistent']
    );

    // Verify __verify=1 parameter was added
    assert.ok(page.url().includes('__verify=1'), 'URL must contain __verify=1');

    // Missing and empty-sized sections are omitted
    assert.equal(results.has('hero'), true);
    assert.equal(results.has('footer'), true);
    assert.equal(results.has('empty-section'), false, 'empty section must be omitted');
    assert.equal(results.has('nonexistent'), false, 'nonexistent section must be omitted');

    const hero = results.get('hero')!;
    assert.equal(hero.png.width, 1000);
    assert.equal(hero.png.height, 320);
    assert.equal(hero.box.height, 320);
    assert.ok(hero.dom.text.includes('Hero Headline'));
    assert.deepEqual(hero.dom.links, ['/explore']);

    const footer = results.get('footer')!;
    assert.equal(footer.png.width, 1000);
    assert.equal(footer.png.height, 180);
    assert.equal(footer.box.height, 180);
    assert.ok(footer.dom.text.includes('Footer Copyright 2026'));
    assert.equal(footer.dom.images.length, 1);
  } finally {
    await page.close().catch(() => {});
  }
});

test('runBaseline captures baseline PNGs and DOM JSONs for shell and section tasks at all widths', { timeout: 90_000 }, async () => {
  const nextDir = path.join(await tmp(), 'next stand-in project');
  const exportDir = path.join(await tmp(), 'export stand-in');

  const state = initState(exportDir, nextDir);

  const heroTask: TaskRecord = {
    id: 'sec-home-hero',
    kind: 'section',
    route: '/',
    section: 'hero',
    file: '.convert/tasks/sec-home-hero.md',
    status: 'pending',
    attempts: 0,
    targets: ['src/components/page/home/Hero.tsx']
  };

  const footerTask: TaskRecord = {
    id: 'shell-footer',
    kind: 'shell',
    section: 'footer',
    file: '.convert/tasks/shell-footer.md',
    status: 'pending',
    attempts: 0,
    targets: ['src/components/shell/Footer.tsx']
  };

  const contactShellTask: TaskRecord = {
    id: 'shell-contact-banner',
    kind: 'shell',
    section: 'contact-banner',
    file: '.convert/tasks/shell-contact-banner.md',
    status: 'pending',
    attempts: 0,
    targets: ['src/components/shell/ContactBanner.tsx']
  };

  state.tasks[heroTask.id] = heroTask;
  state.tasks[footerTask.id] = footerTask;
  state.tasks[contactShellTask.id] = contactShellTask;

  // Write manifest with shell routing
  const manifestDir = path.join(nextDir, '.convert', 'analysis');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(manifestDir, { recursive: true });
  await writeFile(
    path.join(manifestDir, 'generated.json'),
    JSON.stringify(
      {
        version: 1,
        pages: [{ route: '/', slug: 'home', view: 'src/app/page.tsx', sections: [], inline: [], shell: [] }],
        shell: [
          { name: 'footer', component: 'Footer', file: 'src/components/shell/Footer.tsx', pages: ['/'], differences: [] },
          { name: 'contact-banner', component: 'ContactBanner', file: 'src/components/shell/ContactBanner.tsx', pages: ['/contact'], differences: [] }
        ],
        motion: [],
        scriptDrawn: [],
        stubs: [],
        warnings: []
      },
      null,
      2
    )
  );

  await saveState(state);

  const logs: string[] = [];
  const ctx: StageContext = {
    state,
    exportDir,
    nextDir,
    log: (msg) => logs.push(msg)
  };

  await runBaseline(ctx, serverUrl);

  assert.equal(ctx.state.stages.baseline, 'done');

  // Verify saved state on disk has baseline: 'done'
  const diskState = await loadState(nextDir);
  assert.equal(diskState?.stages.baseline, 'done');

  // Verify baseline files exist and have correct heights for all widths
  const expectedHeights = {
    hero: { 1440: 400, 1000: 320, 390: 240 },
    footer: { 1440: 200, 1000: 180, 390: 150 },
    'contact-banner': { 1440: 120, 1000: 120, 390: 120 }
  };

  for (const [task, exp] of [
    [heroTask, expectedHeights.hero],
    [footerTask, expectedHeights.footer],
    [contactShellTask, expectedHeights['contact-banner']]
  ] as const) {
    const dir = baselineDir(nextDir, task);

    for (const width of BASELINE_WIDTHS) {
      const pngPath = path.join(dir, `${width}.png`);
      const jsonPath = path.join(dir, `${width}.json`);

      const pngStat = await stat(pngPath);
      assert.ok(pngStat.isFile(), `${pngPath} must exist`);

      const pngBuffer = await readFile(pngPath);
      const decoded = PNG.sync.read(pngBuffer);
      assert.equal(decoded.width, width, `${task.id} width ${width} png width mismatch`);
      assert.equal(
        decoded.height,
        exp[width as 1440 | 1000 | 390],
        `${task.id} width ${width} png height should equal box height`
      );

      const jsonStat = await stat(jsonPath);
      assert.ok(jsonStat.isFile(), `${jsonPath} must exist`);

      const jsonContent = JSON.parse(await readFile(jsonPath, 'utf8'));
      assert.equal(jsonContent.name, task.section);
      assert.ok(typeof jsonContent.text === 'string');
      assert.ok(Array.isArray(jsonContent.links));
      assert.ok(Array.isArray(jsonContent.images));
    }
  }
});
