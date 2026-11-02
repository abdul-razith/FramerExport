// Builds tests/fixtures/framer-nudge-mini from a Framer export directory.
// Usage: npx tsx scripts/make-convert-fixture.ts out/framer-nudge
import fs from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_INDEX_IMAGES = 40;

const srcDir = path.resolve(process.argv[2] ?? 'out/framer-nudge');
const destDir = path.resolve('tests/fixtures/framer-nudge-mini');

const htmlFiles = [
  'index.html',
  'subpages/about.html',
  'subpages/blog.html',
  'subpages/blog_the-power-of-focus.html',
  'subpages/case-study_meridian-health.html',
  'subpages/case-study.html',
];
const plainFiles = ['export-report.json', 'serve.js', 'package.json'];

function assetRefs(html: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/(?:\.\.\/)?assets\/[^"'\s)]+/g)) {
    const rel = decodeURIComponent(m[0].replace(/^\.\.\//, '').split(/[?#]/)[0]!);
    if (!seen.has(rel)) {
      seen.add(rel);
      out.push(rel);
    }
  }
  return out;
}

function copy(rel: string): number {
  const from = path.join(srcDir, rel);
  if (!fs.existsSync(from) || !fs.statSync(from).isFile()) return 0;
  const to = path.join(destDir, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  return fs.statSync(to).size;
}

function build(limitIndexImages: boolean): number {
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  let total = 0;
  for (const f of plainFiles) total += copy(f);
  for (const f of fs.readdirSync(path.join(srcDir, 'data'))) {
    if (f.endsWith('.framercms')) total += copy(`data/${f}`);
  }
  const assets = new Set<string>();
  for (const f of htmlFiles) {
    total += copy(f);
    const html = fs.readFileSync(path.join(srcDir, f), 'utf8');
    let refs = assetRefs(html);
    if (limitIndexImages && f === 'index.html') {
      let images = 0;
      refs = refs.filter((r) => !/^assets\/images\//.test(r) || ++images <= MAX_INDEX_IMAGES);
    }
    refs.forEach((r) => assets.add(r));
  }
  for (const a of assets) total += copy(a);
  return total;
}

let total = build(false);
let limited = false;
if (total > MAX_BYTES) {
  limited = true;
  total = build(true);
}
const note = limited
  ? `\nThe full copy exceeded 25 MB, so only assets referenced by the subpages plus the first ${MAX_INDEX_IMAGES} images referenced by index.html were copied.\n`
  : '';
fs.writeFileSync(
  path.join(destDir, 'README.md'),
  `# framer-nudge-mini fixture\n\nGenerated with \`npx tsx scripts/make-convert-fixture.ts out/framer-nudge\`.\n\nContains a subset of a Framer export (selected pages, CMS chunks and the assets they reference) used by the convert tests.\n${note}`,
);
console.log(`Fixture written to ${destDir}: ${(total / 1048576).toFixed(1)} MB${limited ? ' (limited)' : ''}`);
