/**
 * Source of ai-guide/scripts/compare.mjs. Runs from nextjs-app/ (`npm run compare <route>`), so
 * puppeteer, pngjs and pixelmatch are resolved from that project (task 0 installs them).
 */
export const COMPARE_MJS = `// Usage (in nextjs-app/, with the site running): npm run compare <route> [-- --base http://localhost:3000]
// Screenshots <route> at 1440, 1024 and 390 and writes ai-guide/compare/<page>-<width>.png:
// the original on the left, your page on the right, plus a similarity score per width.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { pathToFileURL } from 'node:url';

const require = createRequire(path.join(process.cwd(), 'package.json'));
const puppeteer = require('puppeteer');
const { PNG } = require('pngjs');
// pixelmatch is an ES module: import() works on every Node version, require() does not.
const { default: pixelmatch } = await import(pathToFileURL(require.resolve('pixelmatch')).href);

const args = process.argv.slice(2);
let base = 'http://localhost:3000';
let route;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--base') base = args[++i];
  else if (args[i].startsWith('--')) {
    console.error(\`Unknown argument: \${args[i]}. Usage: npm run compare <route> [-- --base http://localhost:3000]\`);
    process.exit(1);
  } else if (route === undefined) route = args[i];
}
// Git Bash on Windows rewrites "/about" into "C:/Program Files/Git/about": undo that.
route = '/' + (route ?? '/').replace(/^[A-Za-z]:[\\\\/].*?[\\\\/]Git[\\\\/]/, '').replace(/^\\/+/, '');
const guideDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const slug = route === '/' ? 'index' : route.replace(/^\\/+|\\/+$/g, '').replace(/\\//g, '_');
const WIDTHS = { desktop: 1440, tablet: 1024, mobile: 390 };

try {
  await fetch(base + route);
} catch {
  console.error(\`Nothing answers at \${base}\${route}. Start the site first (npm run dev), then run the comparison again.\`);
  process.exit(1);
}

const pad = (img, width, height) => {
  if (img.width === width && img.height === height) return img;
  const out = new PNG({ width, height });
  out.data.fill(255);
  PNG.bitblt(img, out, 0, 0, Math.min(img.width, width), Math.min(img.height, height), 0, 0);
  return out;
};

const outDir = path.join(guideDir, 'compare');
fs.mkdirSync(outDir, { recursive: true });
const browser = await puppeteer.launch({ headless: true });
try {
  for (const [name, width] of Object.entries(WIDTHS)) {
    const refFile = path.join(guideDir, 'pages', slug, name + '.png');
    if (!fs.existsSync(refFile)) {
      console.log(\`\${width}: no reference screenshot (\${path.relative(process.cwd(), refFile)})\`);
      continue;
    }
    const page = await browser.newPage();
    await page.setViewport({ width, height: 900 });
    await page.goto(base + route, { waitUntil: 'networkidle2', timeout: 120000 });
    await new Promise((r) => setTimeout(r, 2500));
    const shot = PNG.sync.read(await page.screenshot({ fullPage: true }));
    await page.close();
    const ref = PNG.sync.read(fs.readFileSync(refFile));
    const w = Math.max(ref.width, shot.width);
    const h = Math.max(ref.height, shot.height);
    const a = pad(ref, w, h);
    const b = pad(shot, w, h);
    const diff = pixelmatch(a.data, b.data, undefined, w, h, { threshold: 0.1 });
    const side = new PNG({ width: w * 2 + 20, height: h });
    side.data.fill(255);
    PNG.bitblt(a, side, 0, 0, w, h, 0, 0);
    PNG.bitblt(b, side, 0, 0, w, h, w + 20, 0);
    const file = path.join(outDir, \`\${slug}-\${width}.png\`);
    fs.writeFileSync(file, PNG.sync.write(side));
    console.log(\`\${width}: \${((1 - diff / (w * h)) * 100).toFixed(1)}% similar → \${path.relative(process.cwd(), file)} (left: original, right: yours)\`);
  }
} finally {
  await browser.close();
}
`;
