import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CHECK_MJS } from '../../src/ai-guide/templates/check.js';

/** An export folder with a one-section guide and a nextjs-app built from `files` (paths under nextjs-app/). */
function project(files: Record<string, string>, texts = ['We’re getting married', 'Clara & Theo']): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'fe-check-'));
  const put = (rel: string, body: string) => {
    const p = path.join(root, ...rel.split('/'));
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, body);
  };
  put('ai-guide/scripts/check.mjs', CHECK_MJS);
  put('ai-guide/sections.json', JSON.stringify({ '/': { slug: 'index', sections: [{ id: '01', name: 'Hero' }] } }));
  put('ai-guide/pages/index/sections/01-hero/ref.md', ['# 01 Hero — /', '', '## Content', '', 'Text:', ...texts.map((t) => `- "${t}"`), '', '## Animations', ''].join('\n'));
  for (const [rel, body] of Object.entries(files)) put(`nextjs-app/${rel}`, body);
  return root;
}

function check(root: string) {
  const r = spawnSync(process.execPath, [path.join('..', 'ai-guide', 'scripts', 'check.mjs')], { cwd: path.join(root, 'nextjs-app'), encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
}

const clean = {
  'src/content/home.ts': 'export const hero = { eyebrow: "We’re getting married", title: "Clara & Theo" };',
  'src/components/sections/home/HomeHero.tsx': [
    'import Image from "next/image";',
    'import { Appear } from "@/components/motion/Appear";',
    'export function HomeHero({ content }) {',
    '  return (',
    '    <div data-section="01" className="relative h-[959px]">',
    '      <Image src={content.src} alt="Clara and Theo running into the sea" fill />',
    '      <Appear preset="hero-title"><h1 className="text-hero-title">{content.title}</h1></Appear>',
    '    </div>',
    '  );',
    '}',
  ].join('\n'),
  'src/components/motion/Appear.tsx': 'export function Appear(p) { const t = { duration: 1.4 }; return p.children; }',
};

test('a clean rebuild passes with exit 0', () => {
  const r = check(project(clean));
  assert.equal(r.code, 0, r.out);
});

test('no-framer-names flags hash class names in components', () => {
  const r = check(project({ ...clean, 'src/components/ui/Title.tsx': 'export const T = () => <p className="text-preset-1hdy2yg framer-abc">{1}</p>;' }));
  assert.equal(r.code, 1);
  assert.match(r.out, /Title\.tsx:1 no-framer-names/);
});

test('no-raw-img flags a JSX img element', () => {
  const r = check(project({ ...clean, 'src/components/ui/Pic.tsx': 'export const P = ({ s }) => (\n  <img src={s} alt="" />\n);' }));
  assert.equal(r.code, 1);
  assert.match(r.out, /Pic\.tsx:2 no-raw-img/);
});

test('content-in-content flags page text written into a component', () => {
  const r = check(project({ ...clean, 'src/components/sections/home/HomeFooter.tsx': 'export const F = () => (\n  <h2 data-x="1">\n    Clara <span>&amp;</span> Theo\n  </h2>\n);' }));
  assert.equal(r.code, 1);
  assert.match(r.out, /HomeFooter\.tsx:3 content-in-content/);
});

test('content-in-content allows page text in alt and aria-label attributes', () => {
  const r = check(project({ ...clean, 'src/components/ui/Logo.tsx': 'export const L = () => <a aria-label="Clara & Theo"><img2 alt="Clara & Theo" /></a>;' }));
  assert.equal(r.code, 0, r.out);
});

test('no-duplicate-components flags near-identical component files', () => {
  const body = (n: number) =>
    [
      `export function Print${n}({ content }) {`,
      '  return (',
      '    <div className="relative flex w-[280px] flex-col gap-[12px] rounded-[4px] bg-white p-[14px] shadow-lg">',
      '      <div className="relative aspect-square w-full overflow-hidden">',
      '        <Photo src={content.src} alt={content.alt} />',
      '      </div>',
      '      <p className="text-caption text-center">{content.caption}</p>',
      '      <span className="absolute -top-[10px] left-1/2 h-[24px] w-[90px] -translate-x-1/2 rotate-[-3deg] bg-tape" />',
      '    </div>',
      '  );',
      '}',
    ].join('\n');
  const r = check(project({ ...clean, 'src/components/sections/home/Print1.tsx': body(1), 'src/components/sections/home/Print2.tsx': body(2) }));
  assert.equal(r.code, 1);
  assert.match(r.out, /no-duplicate-components/);
  assert.match(r.out, /Print1\.tsx/);
});

test('data-section flags a section id missing from src', () => {
  const noId = { ...clean, 'src/components/sections/home/HomeHero.tsx': clean['src/components/sections/home/HomeHero.tsx'].replace(' data-section="01"', '') };
  const r = check(project(noId));
  assert.equal(r.code, 1);
  assert.match(r.out, /data-section .*01/);
});

test('data-section accepts an id passed through props to a data-section attribute', () => {
  const viaProps = {
    ...clean,
    'src/components/sections/home/HomeHero.tsx': clean['src/components/sections/home/HomeHero.tsx'].replace('data-section="01"', 'data-section={id}'),
    'src/app/page.tsx': 'export default () => <HomeHero id="01" />;',
  };
  assert.equal(check(project(viaProps)).code, 0);
});

test('no-typed-timing accepts an interaction timing marked check-allow with a reason', () => {
  const r = check(project({
    ...clean,
    'src/components/ui/Accordion.tsx': 'export const A = () => (\n  // check-allow no-typed-timing: accordion open/close, ref.md Interactive\n  <motion.div transition={{ duration: 0.4 }} />\n);',
  }));
  assert.equal(r.code, 0, r.out);
});

test('a check-allow without a reason does not count', () => {
  const r = check(project({ ...clean, 'src/components/ui/Accordion.tsx': 'export const A = () => (\n  // check-allow no-typed-timing\n  <motion.div transition={{ duration: 0.4 }} />\n);' }));
  assert.equal(r.code, 1);
});

test('no-typed-timing flags a duration typed in a section, not in components/motion', () => {
  const r = check(project({ ...clean, 'src/components/sections/home/Fade.tsx': 'export const F = () => (\n  <Appear duration={1.2} delay={0.15} />\n);' }));
  assert.equal(r.code, 1);
  assert.match(r.out, /Fade\.tsx:2 no-typed-timing/);
  assert.doesNotMatch(r.out, /Appear\.tsx/);
});
