import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import puppeteer, { type Browser } from 'puppeteer';
import type { MotionAnchor } from '../../src/convert/generate/manifest.js';
import { writeManifest } from '../../src/convert/generate/manifest.js';
import { initState, saveState } from '../../src/convert/state.js';
import type { TaskRecord } from '../../src/convert/types.js';
import { runBaseline } from '../../src/convert/verify/baseline.js';
import { runCheck } from '../../src/convert/verify/check.js';
import { checkMotion } from '../../src/convert/verify/motion-check.js';

const tmps: string[] = [];
let browser: Browser;
let server: http.Server;
let serverUrl: string;

async function tmp(prefix = 'convert motion int '): Promise<string> {
  const d = await mkdtemp(path.join(os.tmpdir(), prefix));
  tmps.push(d);
  return d;
}

before(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html>
<html>
  <head>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { min-height: 3000px; }
      .hero { height: 200px; width: 100%; }

      /* Appear fade-in */
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .fade-in {
        opacity: 0;
        animation: fadeIn 0.4s ease forwards;
      }

      /* Static box */
      .static-box {
        opacity: 1;
      }

      /* Hover box */
      .hover-box {
        opacity: 0.2;
        transition: opacity 0.2s ease;
      }
      .hover-box:hover {
        opacity: 1;
      }

      /* Loop animation */
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      .spin-box {
        width: 50px;
        height: 50px;
        animation: spin 1s linear infinite;
      }

      /* Scroll box */
      .scroll-target {
        margin-top: 1500px;
        height: 100px;
        opacity: 0;
        transition: opacity 0.3s ease;
      }
      .scroll-target.in-view {
        opacity: 1;
      }
    </style>
  </head>
  <body>
    <div data-section="hero" class="hero">
      <div id="fade-elem" data-motion="hero-fade" class="fade-in">Fade in item</div>
      <div id="static-elem" data-motion="hero-static" class="static-box">Static item</div>
      <div id="hover-elem" data-motion="hero-hover" class="hover-box">Hover item</div>
      <div id="loop-elem" data-motion="hero-loop" class="spin-box">Spinning item</div>
      <div id="static-loop-elem" data-motion="hero-static-loop" class="static-box">Not spinning</div>
      <div id="multi-elem" data-motion="hero-multi-1 hero-multi-2" class="fade-in">Multi motion item</div>
    </div>
    <div id="scroll-elem" data-motion="scroll-item" class="scroll-target">Scrolled item</div>

    <script>
      const obs = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in-view');
          }
        });
      }, { threshold: 0.1 });
      const target = document.getElementById('scroll-elem');
      if (target) obs.observe(target);
    </script>
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

  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
});

after(async () => {
  await browser?.close().catch(() => {});
  await new Promise<void>((resolve) => server.close(() => resolve())).catch(() => {});
  for (const d of tmps) {
    await rm(d, { recursive: true, force: true }).catch(() => {});
  }
});

test('checkMotion: appear animation passes, static element fails', async () => {
  const page = await browser.newPage();
  try {
    const anchors: MotionAnchor[] = [
      {
        id: 'hero-fade',
        route: '/',
        section: 'hero',
        entry: {
          route: '/',
          selector: '#fade-elem',
          trigger: 'appear',
          from: { opacity: '0' },
          to: { opacity: '1' },
          confidence: 'high'
        },
        matched: true
      },
      {
        id: 'hero-static',
        route: '/',
        section: 'hero',
        entry: {
          route: '/',
          selector: '#static-elem',
          trigger: 'appear',
          from: { opacity: '0' },
          to: { opacity: '1' },
          confidence: 'high'
        },
        matched: true
      }
    ];

    const results = await checkMotion(page, serverUrl, anchors);
    assert.equal(results.length, 2);

    const fadeRes = results.find((r) => r.id === 'hero-fade');
    assert(fadeRes, 'hero-fade result must exist');
    assert.equal(fadeRes.pass, true, 'Fade-in element should pass appear check');
    assert.equal(fadeRes.lowConfidence, false);

    const staticRes = results.find((r) => r.id === 'hero-static');
    assert(staticRes, 'hero-static result must exist');
    assert.equal(staticRes.pass, false, 'Static element should fail appear check');
    assert.equal(staticRes.lowConfidence, false);
  } finally {
    await page.close();
  }
});

test('checkMotion: low-confidence failure reports lowConfidence: true', async () => {
  const page = await browser.newPage();
  try {
    const anchors: MotionAnchor[] = [
      {
        id: 'hero-static',
        route: '/',
        section: 'hero',
        entry: {
          route: '/',
          selector: '#static-elem',
          trigger: 'appear',
          from: { opacity: '0' },
          to: { opacity: '1' },
          confidence: 'low'
        },
        matched: true
      }
    ];

    const results = await checkMotion(page, serverUrl, anchors);
    assert.equal(results.length, 1);
    assert.equal(results[0].pass, false);
    assert.equal(results[0].lowConfidence, true);
  } finally {
    await page.close();
  }
});

test('checkMotion: scroll trigger passes after scrollIntoView', async () => {
  const page = await browser.newPage();
  try {
    const anchors: MotionAnchor[] = [
      {
        id: 'scroll-item',
        route: '/',
        section: null,
        entry: {
          route: '/',
          selector: '#scroll-elem',
          trigger: 'scroll',
          from: { opacity: '0' },
          to: { opacity: '1' },
          confidence: 'high'
        },
        matched: true
      }
    ];

    const results = await checkMotion(page, serverUrl, anchors);
    assert.equal(results.length, 1);
    assert.equal(results[0].pass, true, 'Scroll item should pass after scrollIntoView');
  } finally {
    await page.close();
  }
});

test('checkMotion: hover trigger passes after page.hover', async () => {
  const page = await browser.newPage();
  try {
    const anchors: MotionAnchor[] = [
      {
        id: 'hero-hover',
        route: '/',
        section: 'hero',
        entry: {
          route: '/',
          selector: '#hover-elem',
          trigger: 'hover',
          from: { opacity: '0.2' },
          to: { opacity: '1' },
          confidence: 'high'
        },
        matched: true
      }
    ];

    const results = await checkMotion(page, serverUrl, anchors);
    assert.equal(results.length, 1);
    assert.equal(results[0].pass, true, 'Hover item should pass hover check');
  } finally {
    await page.close();
  }
});

test('checkMotion: loop trigger passes on moving element and fails on static element', async () => {
  const page = await browser.newPage();
  try {
    const anchors: MotionAnchor[] = [
      {
        id: 'hero-loop',
        route: '/',
        section: 'hero',
        entry: {
          route: '/',
          selector: '#loop-elem',
          trigger: 'loop',
          from: {},
          to: {},
          confidence: 'high'
        },
        matched: true
      },
      {
        id: 'hero-static-loop',
        route: '/',
        section: 'hero',
        entry: {
          route: '/',
          selector: '#static-loop-elem',
          trigger: 'loop',
          from: {},
          to: {},
          confidence: 'high'
        },
        matched: true
      }
    ];

    const results = await checkMotion(page, serverUrl, anchors);
    assert.equal(results.length, 2);

    const spinRes = results.find((r) => r.id === 'hero-loop');
    assert(spinRes);
    assert.equal(spinRes.pass, true, 'Spinning loop element should pass');

    const staticRes = results.find((r) => r.id === 'hero-static-loop');
    assert(staticRes);
    assert.equal(staticRes.pass, false, 'Static element with loop trigger should fail');
  } finally {
    await page.close();
  }
});

test('runCheck full mode: motion failures fail check, but lowConfidence failures do not fail check', async () => {
  const root = await tmp('convert motion full check ');
  const state = initState(path.join(root, 'export'), root);
  const task: TaskRecord = {
    id: 'sec-hero',
    kind: 'section',
    section: 'hero',
    route: '/',
    file: 'src/components/Hero.tsx',
    targets: ['src/components/Hero.tsx'],
    status: 'pending',
    attempts: 0
  };
  state.tasks['sec-hero'] = task;
  await saveState(state);

  const heroFile = path.join(root, 'src', 'components', 'Hero.tsx');
  await mkdir(path.dirname(heroFile), { recursive: true });
  await writeFile(
    heroFile,
    `export function Hero() { return <div data-section="hero" className="hero">Hero</div>; }`
  );

  // Capture baseline so width diff passes
  await runBaseline({
    exportDir: state.exportDir,
    nextDir: root,
    state,
    log: () => {},
    warn: () => {}
  }, serverUrl);

  // Case 1: manifest with passing motion anchor
  await writeFile(
    heroFile,
    `export function Hero() { return <div data-section="hero" data-motion="hero-fade" className="hero">Hero</div>; }`
  );
  await writeManifest(root, {
    version: 1,
    pages: [{
      route: '/',
      slug: 'index',
      view: 'page.tsx',
      sections: [{
        name: 'hero',
        component: 'Hero',
        file: 'src/components/Hero.tsx',
        parts: [],
        motion: ['hero-fade'],
        scriptDrawn: [],
        hasVariants: false,
        repeated: [],
        cmsFields: []
      }],
      inline: [],
      shell: []
    }],
    shell: [],
    motion: [{
      id: 'hero-fade',
      route: '/',
      section: 'hero',
      entry: {
        route: '/',
        selector: '#fade-elem',
        trigger: 'appear',
        from: { opacity: '0' },
        to: { opacity: '1' },
        confidence: 'high'
      },
      matched: true
    }],
    scriptDrawn: [],
    stubs: [],
    warnings: []
  });

  const res1 = await runCheck(root, 'sec-hero', { devUrl: serverUrl, countCall: false, browser });
  assert.equal(res1.motion.length, 1);
  assert.equal(res1.motion[0].id, 'hero-fade');
  assert.equal(res1.motion[0].pass, true);
  assert.equal(res1.pass, true, 'Passing motion should result in pass: true');

  // Case 2: manifest with failing high-confidence motion anchor
  await writeFile(
    heroFile,
    `export function Hero() { return <div data-section="hero" data-motion="hero-static" className="hero">Hero</div>; }`
  );
  await writeManifest(root, {
    version: 1,
    pages: [{
      route: '/',
      slug: 'index',
      view: 'page.tsx',
      sections: [{
        name: 'hero',
        component: 'Hero',
        file: 'src/components/Hero.tsx',
        parts: [],
        motion: ['hero-static'],
        scriptDrawn: [],
        hasVariants: false,
        repeated: [],
        cmsFields: []
      }],
      inline: [],
      shell: []
    }],
    shell: [],
    motion: [{
      id: 'hero-static',
      route: '/',
      section: 'hero',
      entry: {
        route: '/',
        selector: '#static-elem',
        trigger: 'appear',
        from: { opacity: '0' },
        to: { opacity: '1' },
        confidence: 'high'
      },
      matched: true
    }],
    scriptDrawn: [],
    stubs: [],
    warnings: []
  });

  const res2 = await runCheck(root, 'sec-hero', { devUrl: serverUrl, countCall: false, browser });
  assert.equal(res2.motion.length, 1);
  assert.equal(res2.motion[0].id, 'hero-static');
  assert.equal(res2.motion[0].pass, false);
  assert.equal(res2.pass, false, 'Failing high-confidence motion must fail CheckResult.pass');

  // Case 3: manifest with failing low-confidence motion anchor -> does NOT fail CheckResult.pass
  await writeManifest(root, {
    version: 1,
    pages: [{
      route: '/',
      slug: 'index',
      view: 'page.tsx',
      sections: [{
        name: 'hero',
        component: 'Hero',
        file: 'src/components/Hero.tsx',
        parts: [],
        motion: ['hero-static'],
        scriptDrawn: [],
        hasVariants: false,
        repeated: [],
        cmsFields: []
      }],
      inline: [],
      shell: []
    }],
    shell: [],
    motion: [{
      id: 'hero-static',
      route: '/',
      section: 'hero',
      entry: {
        route: '/',
        selector: '#static-elem',
        trigger: 'appear',
        from: { opacity: '0' },
        to: { opacity: '1' },
        confidence: 'low'
      },
      matched: true
    }],
    scriptDrawn: [],
    stubs: [],
    warnings: []
  });

  const res3 = await runCheck(root, 'sec-hero', { devUrl: serverUrl, countCall: false, browser });
  assert.equal(res3.motion.length, 1);
  assert.equal(res3.motion[0].id, 'hero-static');
  assert.equal(res3.motion[0].pass, false);
  assert.equal(res3.motion[0].lowConfidence, true);
  assert.equal(res3.pass, true, 'Failing low-confidence motion must NOT fail CheckResult.pass');
});

test('checkMotion: multi-token data-motion="m1 m2" matches both m1 and m2', async () => {
  const page = await browser.newPage();
  try {
    const anchors: MotionAnchor[] = [
      {
        id: 'hero-multi-1',
        route: '/',
        section: 'hero',
        entry: {
          route: '/',
          selector: '#multi-elem',
          trigger: 'appear',
          from: { opacity: '0' },
          to: { opacity: '1' },
          confidence: 'high'
        },
        matched: true
      },
      {
        id: 'hero-multi-2',
        route: '/',
        section: 'hero',
        entry: {
          route: '/',
          selector: '#multi-elem',
          trigger: 'appear',
          from: { opacity: '0' },
          to: { opacity: '1' },
          confidence: 'high'
        },
        matched: true
      }
    ];

    const results = await checkMotion(page, serverUrl, anchors);
    assert.equal(results.length, 2);
    assert.equal(results[0].id, 'hero-multi-1');
    assert.equal(results[0].pass, true, 'hero-multi-1 should match and pass');
    assert.equal(results[1].id, 'hero-multi-2');
    assert.equal(results[1].pass, true, 'hero-multi-2 should match and pass');
  } finally {
    await page.close().catch(() => {});
  }
});
