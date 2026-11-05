import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDomToJsx, rewriteAssets, rewriteLinks } from '../../src/convert/generate/dom-to-jsx.js';
import { patchPage } from '../../src/convert/generate/index.js';
import { readManifest, writeManifest, type GeneratedManifest } from '../../src/convert/generate/manifest.js';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

interface FakeNode {
  nodeType: number;
  localName?: string;
  attributes?: Array<{ name: string; value: string }>;
  childNodes: FakeNode[];
  nodeValue?: string;
  textContent?: string;
}
const el = (tag: string, attrs: Record<string, string> = {}, ...kids: FakeNode[]): FakeNode => ({
  nodeType: 1,
  localName: tag,
  attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
  childNodes: kids,
  textContent: kids.map((k) => k.nodeValue ?? k.textContent ?? '').join(''),
});
const txt = (value: string): FakeNode => ({ nodeType: 3, nodeValue: value, childNodes: [] });

const jsx = createDomToJsx();

test('renames class/for and svg attributes to their JSX names', () => {
  const out = jsx.element(el('svg', { viewBox: '0 0 1 1', class: 'a', 'stroke-width': '2', 'xlink:href': '#x' }));
  assert.equal(out, '<svg viewBox="0 0 1 1" className="a" strokeWidth="2" xlinkHref="#x"></svg>');
});

test('converts inline style to an object, keeping custom properties and vendor prefixes', () => {
  const out = jsx.element(el('div', { style: 'opacity:0;--x:1px;-webkit-line-clamp:2;background:url("a;b.png")' }));
  assert.equal(
    out,
    '<div style={{"opacity":"0","--x":"1px","WebkitLineClamp":"2","background":"url(\\"a;b.png\\")"}}></div>',
  );
});

test('void elements self-close and empty boolean attributes become true', () => {
  assert.equal(jsx.element(el('img', { src: '/a.png', alt: '' })), '<img src="/a.png" alt="" />');
  assert.equal(jsx.element(el('video', { muted: '', loop: '' })), '<video muted={true} loop={true}></video>');
});

test('text with JSX-special characters becomes an expression; plain text stays plain', () => {
  const out = jsx.element(el('p', {}, txt('Hello'), el('b', {}, txt('a { b } & <c>'))));
  assert.equal(out, '<p>\nHello\n<b>\n{"a { b } & <c>"}\n</b>\n</p>');
});

test('attribute values with quotes or ampersands use an expression', () => {
  assert.equal(jsx.element(el('a', { href: '/x?a=1&b=2' })), '<a href={"/x?a=1&b=2"}></a>');
});

test('drops scripts, event handlers and Framer hydration attributes', () => {
  const out = jsx.element(
    el('div', { onclick: 'x()', 'data-framer-hydrate-v2': '{}', 'data-framer-name': 'Hero' }, el('script', {}, txt('boom'))),
  );
  assert.equal(out, '<div data-framer-name="Hero"></div>');
});

test('style elements keep their CSS through dangerouslySetInnerHTML', () => {
  const out = jsx.element(el('style', {}, txt('.a{color:red}')));
  assert.equal(out, '<style dangerouslySetInnerHTML={{ __html: ".a{color:red}" }} />');
});

test('whitespace between inline siblings is kept as a space, between block siblings dropped', () => {
  const inline = jsx.element(el('p', {}, el('span', {}, txt('a')), txt(' '), el('span', {}, txt('b'))));
  assert.match(inline, /\{" "\}/);
  const block = jsx.element(el('div', {}, el('div'), txt('\n  '), el('div')));
  assert.doesNotMatch(block, /\{" "\}/);
});

test('input value/checked become uncontrolled defaults', () => {
  assert.equal(jsx.element(el('input', { value: 'x', checked: '' })), '<input defaultValue="x" defaultChecked={true} />');
});

test('rewriteAssets maps export asset paths to public paths', () => {
  const map = { 'assets/images/a.avif': '/images/a-new.avif' };
  assert.equal(
    rewriteAssets('<img src="assets/images/a.avif"><video src="../assets/videos/v.mp4">url(assets/misc/m.svg)', map),
    '<img src="/images/a-new.avif"><video src="/videos/v.mp4">url(/misc/m.svg)',
  );
});

const SCAFFOLD = `import type { Metadata } from 'next';

export const metadata: Metadata = { title: "T" };

export default function Page() {
  return <main data-page="/" />;
}
`;

const SCAFFOLD_DYNAMIC = `import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const item = items.find((entry) => entry.slug === slug);
  if (!item) notFound();
  return <main data-page="/blog/[slug]" />;
}
`;

test('patchPage replaces the scaffold placeholder and keeps metadata', () => {
  const out = patchPage(SCAFFOLD, `import View from '@/views/home';`, 'return <View />;');
  assert.match(out, /import type \{ Metadata \} from 'next';\n\/\/ fexport:imports-start\nimport View from '@\/views\/home';/);
  assert.match(out, /export const metadata: Metadata = \{ title: "T" \};/);
  assert.match(out, /return <View \/>;/);
  assert.doesNotMatch(out, /data-page/);
});

test('patchPage dynamic body becomes return <View item={item} />', () => {
  const out = patchPage(
    SCAFFOLD_DYNAMIC,
    `import View from '@/views/blog-slug';`,
    'return <View item={item} />;',
  );
  assert.match(out, /import View from '@\/views\/blog-slug';/);
  assert.match(out, /return <View item=\{item\} \/>;/);
  assert.doesNotMatch(out, /data-page/);
});

test('patchPage can run twice and replaces its own previous output', () => {
  const once = patchPage(SCAFFOLD, `import A from '@/views/a';`, 'return <A />;');
  const twice = patchPage(once, `import B from '@/views/b';`, 'return <B />;');
  assert.doesNotMatch(twice, /views\/a/);
  assert.equal((twice.match(/fexport:imports-start/g) ?? []).length, 1);
  assert.match(twice, /return <B \/>;/);
});

test('rewriteLinks turns exported page files into routes and keeps hashes', () => {
  const map = { 'subpages/contact.html': '/contact', 'index.html': '/' };
  assert.equal(
    rewriteLinks('<a href="subpages/contact.html">x</a><a href="../index.html#top">y</a><a href="https://a.b/c.html">z</a>', map),
    '<a href="/contact">x</a><a href="/#top">y</a><a href="https://a.b/c.html">z</a>',
  );
});

test('patchPage refuses a file it does not recognise', () => {
  assert.throws(() => patchPage('export default function Page() { return null; }', '', 'x'), /placeholder/);
});

test('readManifest and writeManifest write and read .convert/analysis/generated.json', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'manifest-test-'));
  try {
    const manifest: GeneratedManifest = {
      version: 1,
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
              motion: ['m1'],
              scriptDrawn: [],
              hasVariants: false,
              repeated: [],
              cmsFields: [],
            },
          ],
          inline: [],
          shell: ['Navigation'],
        },
      ],
      shell: [
        {
          name: 'Navigation',
          component: 'Navigation',
          file: 'src/components/shell/Navigation.tsx',
          pages: ['/'],
          differences: [],
        },
      ],
      motion: [
        {
          id: 'm1',
          route: '/',
          section: 'Hero',
          entry: {
            route: '/',
            trigger: 'appear',
            selector: '.hero-fade',
            to: { opacity: '1' },
          },
          matched: true,
        },
      ],
      scriptDrawn: [],
      stubs: ['/ · Hero · iframe'],
      warnings: [],
    };

    assert.equal(await readManifest(tmpDir), null);
    await writeManifest(tmpDir, manifest);
    const loaded = await readManifest(tmpDir);
    assert.deepEqual(loaded, manifest);
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});
