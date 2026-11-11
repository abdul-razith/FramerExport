/**
 * Source of ai-guide/scripts/compare.mjs. Runs from nextjs-app/ (`npm run compare <route>`), so
 * puppeteer, pngjs and pixelmatch are resolved from that project (task 0 installs them).
 * Written as a raw string without `${` or backticks, so the script text is exactly what is below.
 */
export const COMPARE_MJS = String.raw`// Usage (in nextjs-app/, with the site running):
//   npm run compare <route> [-- --section <id>] [-- --base http://localhost:3000]
// Scrolls through <route> at 1440, 1024 and 390 (so on-scroll animations play), then scores every
// section against the original: the element with data-section="<id>" against the box in
// ai-guide/sections.json. Live parts (data-live, and the original's live boxes) are greyed out on
// both sides. Writes ai-guide/compare/<page>-<id>-<width>.png (original | yours | differences).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(path.join(process.cwd(), 'package.json'));
const puppeteer = require('puppeteer');
const { PNG } = require('pngjs');
// pixelmatch is an ES module: import() works on every Node version, require() does not.
const { default: pixelmatch } = await import(pathToFileURL(require.resolve('pixelmatch')).href);

const USAGE = 'Usage: npm run compare <route> [-- --section <id>] [-- --base http://localhost:3000]';
const args = process.argv.slice(2);
let base = 'http://localhost:3000';
let only;
let route;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--base') base = args[++i];
  else if (args[i] === '--section') only = args[++i];
  else if (args[i].startsWith('--')) {
    console.error('Unknown argument: ' + args[i] + '. ' + USAGE);
    process.exit(1);
  } else if (route === undefined) route = args[i];
}
// Git Bash on Windows rewrites "/about" into "C:/Program Files/Git/about": undo that.
route = '/' + (route ?? '/').replace(/^[A-Za-z]:[\\/].*?[\\/]Git[\\/]/, '').replace(/^\/+/, '');
if (route.length > 1) route = route.replace(/\/+$/, '');
const guideDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const slug = route === '/' ? 'index' : route.replace(/^\/+|\/+$/g, '').replace(/\//g, '_');
const WIDTHS = [['desktop', 1440], ['tablet', 1024], ['mobile', 390]];
const PASS = 90;

try {
  await fetch(base + route);
} catch {
  console.error('Nothing answers at ' + base + route + '. Start the site first (npm run dev), then run the comparison again.');
  process.exit(1);
}

let sections = [];
try {
  const json = JSON.parse(fs.readFileSync(path.join(guideDir, 'sections.json'), 'utf8'));
  sections = (json[route] && json[route].sections) || [];
} catch {
  console.log('No ai-guide/sections.json: comparing whole pages only.');
}
if (only) sections = sections.filter((s) => s.id === only).concat(sections.some((s) => s.id === only) ? [] : [{ id: only, name: '', boxes: {}, live: {} }]);

const blank = (width, height) => {
  const out = new PNG({ width: Math.max(1, width), height: Math.max(1, height) });
  out.data.fill(255);
  return out;
};
const pad = (img, width, height) => {
  if (img.width === width && img.height === height) return img;
  const out = blank(width, height);
  PNG.bitblt(img, out, 0, 0, Math.min(img.width, width), Math.min(img.height, height), 0, 0);
  return out;
};
const crop = (img, box) => {
  const x = Math.max(0, Math.round(box.x));
  const y = Math.max(0, Math.round(box.y));
  const w = Math.min(img.width, Math.round(box.x + box.w)) - x;
  const h = Math.min(img.height, Math.round(box.y + box.h)) - y;
  if (w <= 0 || h <= 0) return blank(1, 1);
  const out = new PNG({ width: w, height: h });
  PNG.bitblt(img, out, x, y, w, h, 0, 0);
  return out;
};
const grey = (img, boxes) => {
  for (const b of boxes || []) {
    for (let y = Math.max(0, Math.round(b.y)); y < Math.min(img.height, Math.round(b.y + b.h)); y++) {
      for (let x = Math.max(0, Math.round(b.x)); x < Math.min(img.width, Math.round(b.x + b.w)); x++) {
        const i = (y * img.width + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 128;
        img.data[i + 3] = 255;
      }
    }
  }
};
const panels = (list) => {
  const w = list.reduce((s, p) => s + p.width, 0) + 20 * (list.length - 1);
  const h = Math.max(...list.map((p) => p.height));
  const out = blank(w, h);
  let x = 0;
  for (const p of list) {
    PNG.bitblt(p, out, 0, 0, p.width, p.height, x, 0);
    x += p.width + 20;
  }
  return out;
};
const score = (a, b) => {
  const w = Math.max(a.width, b.width);
  const h = Math.max(a.height, b.height);
  const pa = pad(a, w, h);
  const pb = pad(b, w, h);
  const diff = new PNG({ width: w, height: h });
  const bad = pixelmatch(pa.data, pb.data, diff.data, w, h, { threshold: 0.1 });
  return { pct: (1 - bad / (w * h)) * 100, pa, pb, diff };
};

const outDir = path.join(guideDir, 'compare');
fs.mkdirSync(outDir, { recursive: true });
const results = new Map(sections.map((s) => [s.id, { name: s.name, scores: {} }]));
const browser = await puppeteer.launch({ headless: true });
try {
  for (const [name, width] of WIDTHS) {
    const refFile = path.join(guideDir, 'pages', slug, name + '.png');
    if (!fs.existsSync(refFile)) {
      console.log(width + ': no reference screenshot (' + path.relative(process.cwd(), refFile) + ')');
      continue;
    }
    const page = await browser.newPage();
    await page.setViewport({ width, height: 900 });
    await page.goto(base + route, { waitUntil: 'networkidle2', timeout: 120000 });
    await page.evaluate(async () => {
      for (let y = 0; y < document.documentElement.scrollHeight; y += 400) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 250));
      }
      window.scrollTo(0, 0);
      await document.fonts.ready;
    });
    await new Promise((r) => setTimeout(r, 1500));
    const found = await page.evaluate(() => {
      const box = (el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height };
      };
      const sections = {};
      for (const el of document.querySelectorAll('[data-section]')) sections[el.getAttribute('data-section')] = box(el);
      return { sections, live: Array.from(document.querySelectorAll('[data-live]')).map(box) };
    });
    const shot = PNG.sync.read(await page.screenshot({ fullPage: true }));
    await page.close();
    const ref = PNG.sync.read(fs.readFileSync(refFile));
    grey(shot, found.live);
    for (const s of sections) grey(ref, s.live && s.live[width]);

    for (const s of sections) {
      const r = results.get(s.id);
      const refBox = s.boxes && s.boxes[width];
      const mine = found.sections[s.id];
      if (!mine || !refBox) {
        r.scores[width] = 'not found';
        continue;
      }
      const res = score(crop(ref, refBox), crop(shot, mine));
      r.scores[width] = res.pct;
      fs.writeFileSync(path.join(outDir, slug + '-' + s.id + '-' + width + '.png'), PNG.sync.write(panels([res.pa, res.pb, res.diff])));
    }
    if (!only) {
      const whole = score(ref, shot);
      fs.writeFileSync(path.join(outDir, slug + '-' + width + '.png'), PNG.sync.write(panels([whole.pa, whole.pb])));
      console.log('page ' + width + ': ' + whole.pct.toFixed(1) + '% (ai-guide/compare/' + slug + '-' + width + '.png, left: original, right: yours)');
    }
  }
} finally {
  await browser.close();
}

for (const [id, r] of results) {
  const cells = WIDTHS.map(([, w]) => {
    const v = r.scores[w];
    return w + ': ' + (typeof v === 'number' ? v.toFixed(1) + '%' : v ?? 'skipped');
  });
  const ok = WIDTHS.every(([, w]) => typeof r.scores[w] === 'number' && r.scores[w] >= PASS);
  console.log(id + ' ' + (r.name || '') + '  ' + cells.join('  ') + (ok ? '' : ' ✗'));
}
if (results.size) console.log('✗ = below ' + PASS + '% at some width. Images: ai-guide/compare/' + slug + '-<id>-<width>.png (original | yours | differences)');
`;
