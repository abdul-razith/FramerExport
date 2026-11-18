/**
 * Source of ai-guide/scripts/check.mjs. Runs from nextjs-app/ (`npm run check`) with Node built-ins
 * only, and turns the AGENTS.md rules a model tends to skip into failures it cannot skip.
 * Written as a raw string without `${` or backticks, so the script text is exactly what is below.
 */
export const CHECK_MJS = String.raw`// Usage (in nextjs-app/): npm run check
// Checks src/ against the rules in AGENTS.md. Prints one line per problem:
//   <file>:<line> <rule> <message>
// and exits 1 when there is any. Rules:
//   no-framer-names          Framer class names (framer-*, preset hashes) in components
//   no-raw-img               <img> instead of next/image
//   content-in-content       page text written into a component instead of src/content
//   no-duplicate-components  two component files that are (almost) the same
//   data-section             a section id from ai-guide/sections.json missing in src/
//   no-typed-timing          duration/delay typed in a component instead of a motion preset
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const guide = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = process.cwd();
const src = path.join(app, 'src');
const problems = [];
const report = (file, line, rule, message) => problems.push(path.relative(app, file).split(path.sep).join('/') + ':' + line + ' ' + rule + ' ' + message);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx|ts|jsx|js|mdx)$/.test(e.name)) out.push(p);
  }
  return out;
}
const lineOf = (text, index) => text.slice(0, index).split('\n').length;
const inside = (file, dir) => !path.relative(dir, file).startsWith('..');

const files = walk(src).map((file) => ({ file, text: fs.readFileSync(file, 'utf8') }));
const components = files.filter((f) => inside(f.file, path.join(src, 'components')) && /\.(tsx|jsx)$/.test(f.file));
const motionDir = path.join(src, 'components', 'motion');

// Page text, from the Content part of every ref.md ("Text:" lines).
function refFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) refFiles(p, out);
    else if (e.name === 'ref.md') out.push(p);
  }
  return out;
}
const texts = new Set();
for (const ref of [...refFiles(path.join(guide, 'pages')), ...refFiles(path.join(guide, 'shell'))]) {
  let on = false;
  for (const line of fs.readFileSync(ref, 'utf8').split(/\r?\n/)) {
    if (line === 'Text:') on = true;
    else if (!line.startsWith('- ')) on = false;
    else if (on) {
      const m = line.match(/^- "(.*)"/);
      if (m) texts.add(m[1]);
    }
  }
}
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&apos;|&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/[‘’]/g, "'");
const pageText = [...texts].map(decode);

for (const { file, text } of components) {
  for (const m of text.matchAll(/class(?:Name)?=["'{][^\n]*?\b(framer-[a-z0-9-]+|preset-[a-z0-9]{6,7})\b/g)) {
    report(file, lineOf(text, m.index), 'no-framer-names', m[1] + ': name the style after its role and use a token or text utility');
  }
  for (const m of text.matchAll(/<img[\s>/]/g)) report(file, lineOf(text, m.index), 'no-raw-img', 'use next/image');
  // JSX text: between a tag's ">" and the next "<", without braces (expressions are fine).
  for (const m of text.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)) {
    const words = decode(m[1]).replace(/\s+/g, ' ').trim();
    if (words.length < 3 || /^[\s\W\d]*$/.test(words)) continue;
    if (pageText.some((t) => t.includes(words))) {
      report(file, lineOf(text, m.index + 1 + m[1].search(/\S/)), 'content-in-content', '"' + words + '" is page text: take it from src/content through props');
    }
  }
  if (!inside(file, motionDir)) {
    const lines = text.split('\n');
    // An interaction timing with no preset (hover, menu, accordion) is allowed with a stated reason
    // on the line above: // check-allow no-typed-timing: <reason>
    const allowed = (n) => /check-allow no-typed-timing:\s*\S/.test(lines[n - 2] || '') || /check-allow no-typed-timing:\s*\S/.test(lines[n - 1] || '');
    for (const m of text.matchAll(/\b(duration|delay)\s*[:=]\s*\{?\s*\d/g)) {
      const n = lineOf(text, m.index);
      if (allowed(n)) continue;
      report(file, n, 'no-typed-timing', m[1] + ' typed by hand: use <Appear preset="..."> from src/components/motion (an interaction with no preset: add // check-allow no-typed-timing: <reason> above it)');
    }
  }
}

// Near-identical components: 4-token shingles, Jaccard similarity >= 0.9, files of 8+ lines.
const shingles = (text) => {
  const tokens = text.replace(/(["'])(?:\\.|(?!\1).)*\1/g, 'S').replace(/\b\d+(\.\d+)?\b/g, 'N').match(/[A-Za-z_]\w*|[^\s\w]/g) || [];
  const set = new Set();
  for (let i = 0; i + 4 <= tokens.length; i++) set.add(tokens.slice(i, i + 4).join(' '));
  return set;
};
const big = components.filter((c) => c.text.split('\n').length >= 8 && !inside(c.file, motionDir)).map((c) => ({ ...c, set: shingles(c.text) }));
for (let i = 0; i < big.length; i++) {
  for (let j = i + 1; j < big.length; j++) {
    const a = big[i].set, b = big[j].set;
    let same = 0;
    for (const s of a) if (b.has(s)) same++;
    const score = same / (a.size + b.size - same || 1);
    if (score >= 0.9) {
      report(big[i].file, 1, 'no-duplicate-components', 'same as ' + path.relative(app, big[j].file).split(path.sep).join('/') + ' (' + Math.round(score * 100) + '%): make one component in src/components/ui and pass what differs as props');
    }
  }
}

// Every section id is on the page: data-section="<id>", or the id passed as a prop to a data-section={...}.
const sectionsFile = path.join(guide, 'sections.json');
if (fs.existsSync(sectionsFile)) {
  const all = files.map((f) => f.text).join('\n');
  const dynamic = /data-section=\{/.test(all);
  const ids = new Set();
  for (const page of Object.values(JSON.parse(fs.readFileSync(sectionsFile, 'utf8')))) for (const s of page.sections || []) ids.add(s.id);
  for (const id of ids) {
    const literal = all.includes('data-section="' + id + '"') || all.includes("data-section='" + id + "'");
    const viaProp = dynamic && (all.includes('"' + id + '"') || all.includes("'" + id + "'"));
    if (!literal && !viaProp) problems.push('src:0 data-section section ' + id + ' has no element with data-section="' + id + '"');
  }
}

if (problems.length) {
  console.log(problems.join('\n'));
  console.log('\ncheck ✗ ' + problems.length + ' problem' + (problems.length === 1 ? '' : 's'));
  process.exit(1);
}
console.log('check ✓');
`;
