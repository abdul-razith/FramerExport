import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { serveFixture } from '../fixtures/nextjs/serve.js';
import { COMPARE_MJS } from '../../src/ai-guide/templates/compare.js';

const page = (build: boolean) => `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font-family:sans-serif} section{height:700px;display:flex;align-items:center;justify-content:center;font-size:48px}
#a{background:#f5c542;height:1400px} #b{background:#36c5f0} .fade{display:block;width:80%;height:500px;background:#141414;color:#fff;opacity:${build ? 0 : 1};transition:opacity .3s} .fade.in{opacity:1}
</style></head><body>
<section id="a"${build ? ' data-section="01"' : ''}>First <span id="clock"${build ? ' data-live' : ''}>${build ? '11:11:11' : '9:00:00'}</span></section>
<section id="b"${build ? ' data-section="02"' : ''}><div class="fade">Second</div></section>
${build ? `<script>new IntersectionObserver((es)=>es.forEach(e=>e.isIntersecting&&e.target.classList.add('in'))).observe(document.querySelector('.fade'))</script>` : ''}
</body></html>`;

let server: { url: string; close(): Promise<void> };
let root: string;

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aiguide-compare-'));
  const site = path.join(root, 'site');
  await fs.mkdir(path.join(site, 'ref'), { recursive: true });
  await fs.writeFile(path.join(site, 'index.html'), page(true));
  await fs.writeFile(path.join(site, 'ref.html'), page(false));
  server = await serveFixture(site);

  // The guide: reference screenshots and section boxes taken from the reference page.
  const guide = path.join(root, 'ai-guide');
  await fs.mkdir(path.join(guide, 'pages', 'index'), { recursive: true });
  await fs.mkdir(path.join(guide, 'scripts'), { recursive: true });
  await fs.writeFile(path.join(guide, 'scripts', 'compare.mjs'), COMPARE_MJS);
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const sections: { id: string; name: string; boxes: Record<string, unknown>; live: Record<string, unknown> }[] = [
    { id: '01', name: 'First', boxes: {}, live: {} },
    { id: '02', name: 'Second', boxes: {}, live: {} },
  ];
  for (const [name, width] of [['desktop', 1440], ['tablet', 1024], ['mobile', 390]] as const) {
    const p = await browser.newPage();
    await p.setViewport({ width, height: 900 });
    await p.goto(server.url + '/ref', { waitUntil: 'networkidle2' });
    const boxes = await p.evaluate(() =>
      ['#a', '#b', '#clock'].map((s) => {
        const r = document.querySelector(s)!.getBoundingClientRect();
        return { x: r.x, y: r.y + scrollY, w: r.width, h: r.height };
      })
    );
    sections[0].boxes[width] = boxes[0];
    sections[1].boxes[width] = boxes[1];
    sections[0].live[width] = [boxes[2]];
    await p.screenshot({ path: path.join(guide, 'pages', 'index', `${name}.png`) as `${string}.png`, fullPage: true });
    await p.close();
  }
  await browser.close();
  await fs.writeFile(path.join(guide, 'sections.json'), JSON.stringify({ '/': { slug: 'index', sections } }));
  await fs.mkdir(path.join(root, 'nextjs-app'));
  await fs.writeFile(path.join(root, 'nextjs-app', 'package.json'), '{"name":"app","private":true}');
});

after(async () => {
  await server?.close();
});

/** Runs compare.mjs without blocking this process, which also serves the site it fetches. */
function compare(...args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(root, 'ai-guide', 'scripts', 'compare.mjs'), ...args, '--base', server.url], {
      cwd: path.join(root, 'nextjs-app'),
      env: { ...process.env, NODE_PATH: path.resolve('node_modules') },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

test('compare scores every section after scrolling and masks live parts', { timeout: 300000 }, async () => {
  const run = await compare('/');
  assert.equal(run.status, 0, run.stderr);
  const line = (id: string) => run.stdout.split('\n').find((l) => l.startsWith(id + ' '))!;
  for (const id of ['01', '02']) assert.match(line(id), /1440: [\d.]+%\s+1024: [\d.]+%\s+390: [\d.]+%/, run.stdout);
  const score = (id: string, w: string) => Number(line(id).match(new RegExp(w + ': ([0-9.]+)%'))![1]);
  assert.ok(score('02', '1440') >= 90, line('02'));
  assert.ok(score('01', '1440') >= 90, line('01'));
});

test('a missing section is reported as not found and the run still succeeds', { timeout: 300000 }, async () => {
  const run = await compare('/', '--section', '99');
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /99 .*not found/);
});
