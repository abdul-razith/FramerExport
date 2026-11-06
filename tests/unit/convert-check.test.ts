import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { PNG } from 'pngjs';
import { initState, saveState } from '../../src/convert/state.js';
import type { TaskRecord } from '../../src/convert/types.js';
import { diffClusters } from '../../src/convert/verify/clusters.js';
import {
  codeViolations,
  formatCheck,
  resetCheckCalls,
  runCheck,
  type CheckResult
} from '../../src/convert/verify/check.js';

const tmps: string[] = [];
let server: http.Server;
let serverUrl: string;

async function tmp(prefix = 'convert check unit '): Promise<string> {
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
      .hero { height: 200px; width: 100%; background: #00ff00; }
    </style>
  </head>
  <body>
    <div data-section="hero" class="hero">
      <h1>Hero</h1>
    </div>
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
  await new Promise<void>((resolve) => server.close(() => resolve())).catch(() => {});
  for (const d of tmps) {
    await rm(d, { recursive: true, force: true }).catch(() => {});
  }
});

test('diffClusters on a synthetic PNG with two red blocks returns 2 boxes, larger first', () => {
  const png = new PNG({ width: 120, height: 120 });
  // Fill with white
  png.data.fill(255);

  // Helper to draw a red block (r=255, g=0, b=0, a=255)
  function drawRedBlock(x0: number, y0: number, w: number, h: number) {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const idx = (png.width * y + x) << 2;
        png.data[idx] = 255;
        png.data[idx + 1] = 0;
        png.data[idx + 2] = 0;
        png.data[idx + 3] = 255;
      }
    }
  }

  // Smaller block: 16x16 at (16, 16)
  drawRedBlock(16, 16, 16, 16);
  // Larger block: 32x32 at (64, 64)
  drawRedBlock(64, 64, 32, 32);

  const boxes = diffClusters(png);
  assert.equal(boxes.length, 2);

  const [box1, box2] = boxes;
  // Larger box should be first
  assert(box1.width * box1.height > box2.width * box2.height, 'Larger cluster must come first');

  // Box 1 should cover the 32x32 block around (64, 64)
  assert.equal(box1.x, 64);
  assert.equal(box1.y, 64);
  assert.equal(box1.width, 32);
  assert.equal(box1.height, 32);

  // Box 2 should cover the 16x16 block around (16, 16)
  assert.equal(box2.x, 16);
  assert.equal(box2.y, 16);
  assert.equal(box2.width, 16);
  assert.equal(box2.height, 16);
});

test('diffClusters respects max parameter and handles empty diff', () => {
  const blank = new PNG({ width: 64, height: 64 });
  blank.data.fill(255);
  assert.deepEqual(diffClusters(blank), []);

  const multi = new PNG({ width: 120, height: 120 });
  multi.data.fill(255);
  const draw = (x0: number, y0: number, size: number) => {
    for (let y = y0; y < y0 + size; y++) {
      for (let x = x0; x < x0 + size; x++) {
        const idx = (multi.width * y + x) << 2;
        multi.data[idx] = 255;
        multi.data[idx + 1] = 0;
        multi.data[idx + 2] = 0;
        multi.data[idx + 3] = 255;
      }
    }
  };
  draw(0, 0, 16);
  draw(32, 0, 16);
  draw(64, 0, 16);
  draw(96, 0, 16);

  const limited = diffClusters(multi, 2);
  assert.equal(limited.length, 2);
});

test('codeViolations flags className="framer-1x" and a missing m4', () => {
  const sources = [
    {
      file: 'src/components/Hero.tsx',
      text: `import { motion } from 'framer-motion';
export function Hero() {
  return (
    <div className="framer-1x p-4" data-motion="m1">
      <h1>Title</h1>
    </div>
  );
}`
    }
  ];

  const violations = codeViolations(sources, ['m1', 'm4']);
  assert.equal(violations.length, 2);
  assert.equal(violations[0], 'src/components/Hero.tsx: framer- class name');
  assert.equal(violations[1], 'missing data-motion="m4"');

  // Verify that framer-motion is NOT flagged
  const cleanSources = [
    {
      file: 'src/components/Hero.tsx',
      text: `import { motion } from 'framer-motion';
export function Hero() {
  return (
    <motion.div className="flex bg-blue-500" data-motion="m1" data-motion="m4">
      <h1>Title</h1>
    </motion.div>
  );
}`
    }
  ];
  assert.deepEqual(codeViolations(cleanSources, ['m1', 'm4']), []);
});

test('codeViolations accepts multi-token data-motion attributes (data-motion="m1 m2")', () => {
  const sources = [
    {
      file: 'src/components/Hero.tsx',
      text: '<div data-motion="m1 m2">Hero</div>'
    }
  ];
  assert.deepEqual(codeViolations(sources, ['m1']), []);
  assert.deepEqual(codeViolations(sources, ['m2']), []);
  assert.deepEqual(codeViolations(sources, ['m1', 'm2']), []);
  assert.deepEqual(codeViolations(sources, ['m1', 'm3']), ['missing data-motion="m3"']);
});

test('call counter: 3 calls limitReached: false, 4th true and formatCheck equals the limit message', async () => {
  const root = await tmp('convert check counter ');
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

  // Call 1
  const r1 = await runCheck(root, 'sec-hero', { smoke: true, countCall: true, devUrl: serverUrl });
  assert.equal(r1.limitReached, false);

  // Call 2
  const r2 = await runCheck(root, 'sec-hero', { smoke: true, countCall: true, devUrl: serverUrl });
  assert.equal(r2.limitReached, false);

  // Call 3
  const r3 = await runCheck(root, 'sec-hero', { smoke: true, countCall: true, devUrl: serverUrl });
  assert.equal(r3.limitReached, false);

  // Call 4
  const r4 = await runCheck(root, 'sec-hero', { smoke: true, countCall: true, devUrl: serverUrl });
  assert.equal(r4.limitReached, true);
  assert.equal(
    formatCheck(r4),
    'Limit reached: stop and finish; the pipeline will review this section.'
  );

  // Verify counter file content
  const counterFile = path.join(root, '.convert', 'checks', 'sec-hero.json');
  const counterData = JSON.parse(await readFile(counterFile, 'utf8'));
  assert.equal(counterData.calls, 4);

  // resetCheckCalls resets calls
  await resetCheckCalls(root, 'sec-hero');
  const resetData = JSON.parse(await readFile(counterFile, 'utf8'));
  assert.equal(resetData.calls, 0);

  // Call 5 after reset should NOT be limit reached
  const r5 = await runCheck(root, 'sec-hero', { smoke: true, countCall: true, devUrl: serverUrl });
  assert.equal(r5.limitReached, false);
});

test('two concurrent counted calls end with { calls: 2 } and leave state.json byte-identical (Review Focus 4)', async () => {
  const root = await tmp('convert check concurrent ');
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

  const statePath = path.join(root, '.convert', 'state.json');
  const beforeBytes = await readFile(statePath, 'utf8');

  // Run two concurrent counted calls
  await Promise.all([
    runCheck(root, 'sec-hero', { smoke: true, countCall: true, devUrl: serverUrl }),
    runCheck(root, 'sec-hero', { smoke: true, countCall: true, devUrl: serverUrl })
  ]);

  const counterFile = path.join(root, '.convert', 'checks', 'sec-hero.json');
  const checkData = JSON.parse(await readFile(counterFile, 'utf8'));
  assert.equal(checkData.calls, 2);

  const afterBytes = await readFile(statePath, 'utf8');
  assert.equal(afterBytes, beforeBytes, 'state.json must remain byte-identical');
});

test('I12: codeViolations inspects class attributes only', () => {
  const ok = (text: string) => codeViolations([{ file: 'a.tsx', text }], []);
  assert.deepEqual(ok(`<section data-framer-name="Hero" className="hero" />`), []);
  assert.deepEqual(ok(`import { motion } from 'framer-motion';`), []);
  assert.deepEqual(ok(`<div data-section="Hero" id="framer-ish" />`), []);
  assert.equal(ok(`<div className="framer-1x y" />`).length, 1);
  assert.equal(ok('<div className={`a framer-1x`} />').length, 1);
  assert.equal(ok(`<div className={cn("a", "framer-xyz")} />`).length, 1);
  assert.equal(ok(`<div class="framer-1x" />`).length, 1);
});

// ---- fix wave 3 round 2: required motion ids come from the same ownership as the task files ----
import { requiredMotionIds, taskMotionAnchors } from '../../src/convert/verify/check-motion.js';
import type { GeneratedManifest } from '../../src/convert/generate/manifest.js';

const motionEntry = (route: string) => ({
  route,
  selector: '.nav',
  framerName: 'NavFade',
  trigger: 'appear' as const,
  from: { opacity: '0' },
  to: { opacity: '1' },
  confidence: 'high' as const,
});

function shellMotionManifest(): GeneratedManifest {
  const sec = (name: string, extra: Record<string, unknown> = {}) => ({
    name, component: name, file: `src/sections/x/${name}.tsx`, parts: [], motion: [] as string[],
    scriptDrawn: [], hasVariants: false, repeated: [], cmsFields: [], ...extra,
  });
  return {
    version: 1,
    shell: [{ name: 'Navigation', component: 'Navigation', file: 'src/components/shell/Navigation.tsx', pages: ['/', '/about'], differences: [] }],
    pages: [
      {
        route: '/', slug: 'home', view: 'src/views/home.tsx', inline: [], shell: ['Navigation'],
        sections: [
          sec('Hero', {
            motion: ['m3'],
            parts: [
              { name: 'Left', component: 'Left', file: 'src/sections/home/Hero/Left.tsx', motion: ['m3'] },
              { name: 'Right', component: 'Right', file: 'src/sections/home/Hero/Right.tsx', motion: [] },
            ],
          }),
        ],
      },
      { route: '/about', slug: 'about', view: 'src/views/about.tsx', inline: [], shell: ['Navigation'], sections: [] },
    ],
    motion: [
      { id: 'm1', route: '/', section: 'Navigation', matched: true, entry: motionEntry('/') },
      { id: 'm2', route: '/about', section: 'Navigation', matched: true, entry: motionEntry('/about') },
      { id: 'm3', route: '/', section: 'Hero', matched: true, entry: { ...motionEntry('/'), framerName: 'Title' } },
    ],
    scriptDrawn: [], stubs: [], warnings: [],
  };
}

test('shell task requires only the first page ids; check passes with only m1 present', () => {
  const m = shellMotionManifest();
  const task = { id: 'shell-navigation', kind: 'shell', section: 'Navigation', file: '', targets: [], dependsOn: [], status: 'pending', attempts: 0 } as TaskRecord;
  const required = requiredMotionIds(m, task);
  assert.deepEqual(required, ['m1']);
  assert.deepEqual(codeViolations([{ file: 'Navigation.tsx', text: '<nav data-motion="m1">x</nav>' }], required), []);
  assert.deepEqual(taskMotionAnchors(m, task, [], required).map((a) => a.id), ['m1']);
});

test('part task requires its own motion ids and not the sibling part or the section', () => {
  const m = shellMotionManifest();
  const mk = (section: string) => ({ id: 'x', kind: 'section', route: '/', section, file: '', targets: [], dependsOn: [], status: 'pending', attempts: 0 }) as TaskRecord;
  assert.deepEqual(requiredMotionIds(m, mk('Hero/Left')), ['m3']);
  assert.deepEqual(requiredMotionIds(m, mk('Hero/Right')), []);
});

// ---- Fix 5 item 4: shell check ----

test('Fix5 item 4: baselineDir of a shell task on a page is its own directory per route', async () => {
  const { baselineDir } = await import('../../src/convert/verify/baseline.js');
  const task = { id: 'shell-nav', kind: 'shell', section: 'Nav', file: '', targets: [], dependsOn: [], status: 'pending', attempts: 0 } as TaskRecord;
  const posix = (p: string): string => p.split(path.sep).join('/');
  assert.equal(posix(baselineDir('/p', task)), posix(path.join('/p', '.convert/baseline/shell/nav')));
  assert.equal(posix(baselineDir('/p', task, '/')), posix(path.join('/p', '.convert/baseline/shell/nav/home')));
  assert.equal(posix(baselineDir('/p', task, '/blog/[slug]')), posix(path.join('/p', '.convert/baseline/shell/nav/blog-slug')));
  const sec = { id: 'sec-home-hero', kind: 'section', section: 'Hero', route: '/', file: '', targets: [], dependsOn: [], status: 'pending', attempts: 0 } as TaskRecord;
  assert.equal(posix(baselineDir('/p', sec, '/about')), posix(path.join('/p', '.convert/baseline/home/hero')), 'route only matters for shell tasks');
});

test('Fix5 item 4: the shell code check reads only the shell component, not the per-page copies or views', async () => {
  const { codeTargetsFor } = await import('../../src/convert/verify/check.js');
  const m = shellMotionManifest();
  m.shell[0]!.copies = [
    { route: '/', component: 'Navigation', file: 'src/sections/home/Navigation.tsx', view: 'src/views/home.tsx' },
    { route: '/about', component: 'Navigation', file: 'src/sections/about/Navigation.tsx', view: 'src/views/about.tsx' },
  ];
  const task = {
    id: 'shell-navigation',
    kind: 'shell',
    section: 'Navigation',
    file: '',
    targets: ['src/components/shell/Navigation.tsx', 'src/components/shell/Navigation/', 'src/sections/home/Navigation.tsx', 'src/views/home.tsx'],
    dependsOn: [],
    status: 'pending',
    attempts: 0,
  } as TaskRecord;
  assert.deepEqual(codeTargetsFor(task, m), ['src/components/shell/Navigation.tsx', 'src/components/shell/Navigation/']);
  const sec = { id: 'sec-home-hero', kind: 'section', section: 'Hero', route: '/', file: '', targets: ['a.tsx'], dependsOn: [], status: 'pending', attempts: 0 } as TaskRecord;
  assert.deepEqual(codeTargetsFor(sec, m), ['a.tsx']);
});
