import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { planComponents } from '../../src/nextjs/components.js';
import { extractContent, ImageNamer } from '../../src/nextjs/content.js';
import { detectCollections } from '../../src/nextjs/framer/collections.js';
import { attachMotion, motionUsage } from '../../src/nextjs/framer/motion-map.js';
import { writeProject, type ProjectModel } from '../../src/nextjs/emit/project.js';
import { emptyReport } from '../../src/nextjs/report.js';
import { collectTokens } from '../../src/nextjs/tokens.js';
import { NEXT_PROJECT_VERSIONS } from '../../src/nextjs/versions.js';
import { FIXTURE_ROOT } from '../fixtures/nextjs/serve.js';
import type { Node, PageModel, Style } from '../../src/nextjs/model.js';

let seq = 0;
function n(tag: string, extra: Partial<Node> = {}, children: Node[] = []): Node {
  const key = `${tag}:${seq++}`;
  return { id: key, key, tag, attrs: {}, styles: { base: {} as Style }, children, ...extra };
}
const text = (tag: string, name: string, value: string, base: Style = {}) =>
  n(tag, { framerName: name, text: value, styles: { base } });
const image = (src: string, alt: string) =>
  n('img', { framerName: 'Image', asset: { kind: 'image', src, width: 24, height: 12 }, attrs: { alt } });
const card = (t: string) =>
  n('div', { framerName: 'Card', styles: { base: { display: 'flex', 'background-color': 'rgb(255, 255, 255)' } } }, [
    image(`https://cdn.test/${t}/card-1.png`, `Card ${t}`),
    text('h3', 'Title', t),
    image('https://cdn.test/icon.png', 'Icon'),
  ]);
const header = () => n('header', { framerName: 'Logo + Menu' }, [text('span', 'Logo', 'Nudge')]);
const footer = () => n('footer', { framerName: 'Footer' }, [text('p', 'Copyright', '© Nudge')]);

function page(route: string, sections: Node[]): PageModel {
  const root = n('body', { styles: { base: { color: 'rgb(19, 51, 36)', 'font-family': '"Inter Display", sans-serif' } } }, [
    n('div', { attrs: { id: 'main' } }, [n('div', { framerName: 'Desktop', styles: { base: { display: 'flex', 'flex-direction': 'column' } } }, sections)]),
  ]);
  return { route, sourceUrl: 'https://nudge.test' + route, title: `${route} title`, meta: { description: `About ${route}` }, root, screenshots: { base: '', tablet: '', mobile: '' } };
}

let dir: string;

before(async () => {
  const pages = [
    page('/', [
      header(),
      n('section', { framerName: 'Hero Section' }, [
        text('h1', 'Heading', 'Hello {world}', { 'font-size': '72px', color: 'rgb(19, 51, 36)' }),
        image('https://cdn.test/a/hero.png', 'Hero'),
        image('https://cdn.test/b/hero.png', 'Hero'),
        n('div', { framerName: 'Mask', styles: { base: { 'mask-image': 'url("https://cdn.test/mask.png")' } } }),
      ]),
      n('section', { framerName: 'Projects' }, [card('A'), card('B'), card('C')]),
      footer(),
    ]),
    page('/about', [header(), n('section', { framerName: 'About Hero' }, [text('h1', 'Heading', 'About')]), footer()]),
    page('/blog', [
      header(),
      n('section', { framerName: 'Blog Hero' }, [text('h1', 'Heading', 'Blog')]),
      n('section', { framerName: 'Posts' }, ['post-a', 'post-b'].map((slug) =>
        n('a', { framerName: 'Post Card', attrs: { href: 'https://nudge.test/blog/' + slug } }, [
          image('https://cdn.test/covers/' + slug + '.png?scale-down-to=512', slug),
          text('h3', 'Title', slug),
          // A Framer variant: each post's badge has its own colour and icon.
          n('div', { framerName: 'Badge', styles: { base: { 'background-color': slug === 'post-a' ? 'rgb(234, 179, 8)' : 'rgb(236, 72, 153)' } } }, [
            n('svg', { asset: { kind: 'svg', src: '', width: 16, height: 16 }, attrs: { 'data-svg': `<svg viewBox="0 0 16 16"><path d="${slug === 'post-a' ? 'M1 1' : 'M2 2'}"/></svg>` } }),
          ]),
        ])
      )),
      footer(),
    ]),
  ];
  const itemPage = (slug: string) =>
    page('/blog/' + slug, [
      header(),
      n('section', { framerName: 'Post Header' }, [text('h1', 'Title', slug), text('p', 'Date', '12 March 2025'), image('https://cdn.test/covers/' + slug + '.png', slug)]),
      n('section', { framerName: 'Post Body' }, [text('p', 'P', 'a'), text('h2', 'H', 'b'), text('p', 'P', 'c')]),
      footer(),
    ]);
  // Real captures key nodes by position, so the same element has the same key on every item page.
  const rekey = (node: Node, key: string) => {
    node.key = key;
    node.children.forEach((c, i) => rekey(c, key + '/' + c.tag + ':' + i));
  };
  const items = [itemPage('post-a'), itemPage('post-b')];
  items.forEach((p) => rekey(p.root, 'body:0'));
  pages.forEach((p) => attachMotion(p.root));
  const report = emptyReport();
  const images = new ImageNamer();
  const plan = planComponents(pages, report);
  const { files, bindings } = extractContent(plan, report, images, 'https://nudge.test');
  const [blog] = detectCollections([...pages, ...items]);
  const model: ProjectModel = {
    siteName: 'Nudge',
    siteOrigin: 'https://nudge.test',
    exportDir: path.join(FIXTURE_ROOT, 'export'),
    tokens: collectTokens(pages.map((p) => p.root)),
    fonts: [{ family: 'Inter Display', weight: '400', style: 'normal', file: 'Inter-Regular.latin.woff2' }],
    plan,
    content: files,
    bindings,
    collections: [
      {
        c: blog,
        itemPage: items[0],
        items: [
          { slug: 'post-a', file: 'blog/post-a.mdx', metadata: { title: 'post-a', date: '2025-03-12', image: images.publicPath('https://cdn.test/covers/post-a.png', 'post-a') }, body: 'a\n\n## b\n\nc' },
          { slug: 'post-b', file: 'blog/post-b.mdx', metadata: { title: 'post-b', date: '2025-03-12', image: images.publicPath('https://cdn.test/covers/post-b.png', 'post-b') }, body: 'a' },
        ],
      },
    ],
    pages,
    motion: new Set(pages.flatMap((p) => [...motionUsage(p.root)])),
    images,
  };
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fexport-project-'));
  await writeProject(dir, model);
});

async function list(root: string, rel = ''): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await list(root, r)));
    else out.push(r);
  }
  return out;
}
const read = (rel: string) => fs.readFile(path.join(dir, rel), 'utf8');

test('the project has the expected files', async () => {
  const files = await list(dir);
  for (const f of [
    'package.json', 'next.config.ts', 'tsconfig.json', 'postcss.config.mjs', 'eslint.config.mjs', '.prettierrc',
    '.gitignore', 'README.md', 'mdx-components.tsx', 'app/layout.tsx', 'app/page.tsx', 'app/about/page.tsx',
    'app/blog/page.tsx', 'app/blog/[slug]/page.tsx', 'app/globals.css', 'app/fonts.css', 'content/home.ts',
    'content/layout.ts', 'content/blog/post-a.mdx', 'content/blog/post-b.mdx', 'lib/blog.ts',
    'components/sections/Hero.tsx', 'components/sections/Header.tsx', 'components/ui/Card.tsx',
    'components/motion/MotionProvider.tsx', 'public/fonts/Inter-Regular.latin.woff2',
  ]) {
    assert.ok(files.includes(f), `${f} written`);
  }
});

test('package.json pins the generated stack', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.deepEqual(pkg.dependencies, NEXT_PROJECT_VERSIONS.dependencies);
  assert.deepEqual(pkg.devDependencies, NEXT_PROJECT_VERSIONS.devDependencies);
  assert.equal(pkg.scripts.build, 'next build');
});

test('globals.css defines breakpoints and theme tokens without preflight', async () => {
  const css = await read('app/globals.css');
  assert.match(css, /@custom-variant tablet \(@media \(max-width: 1199px\)\);/);
  assert.match(css, /@custom-variant mobile \(@media \(max-width: 809px\)\);/);
  assert.match(css, /--color-green-900: #133324;/);
  assert.match(css, /--font-display: ['"]Inter Display['"]/);
  assert.match(css, /tailwindcss\/utilities\.css/);
  assert.doesNotMatch(css, /preflight\.css|@import ['"]tailwindcss['"]/);
});

test('components never contain hex colours; no framer- leftovers anywhere', async () => {
  for (const f of await list(dir)) {
    if (f.startsWith('components/')) assert.doesNotMatch(await read(f), /#[0-9a-f]{3,8}\b/i, f);
    if (/^(app|components|content)\//.test(f) && !f.endsWith('.woff2')) assert.doesNotMatch(await read(f), /framer-/, f);
  }
});

test('unused motion components are not written', async () => {
  const files = await list(dir);
  assert.equal(files.includes('components/motion/SmoothScroll.tsx'), false);
  assert.equal(files.includes('components/motion/Cursor.tsx'), false);
});

test('two images with the same name are both copied with unique names', async () => {
  const files = await list(dir);
  assert.ok(files.includes('public/images/hero.png'));
  assert.ok(files.includes('public/images/hero-2.png'));
  assert.match(await read('content/home.ts'), /['"]\/images\/hero-2\.png['"]/);
});

test('sections read from content, pages wire content to sections', async () => {
  const hero = await read('components/sections/Hero.tsx');
  assert.match(hero, /export function Hero\(\{ content \}: \{ content: HomeContent\['hero'\] \}\)/);
  assert.match(hero, /\{content\.heading\}/);
  const pageTsx = await read('app/page.tsx');
  assert.match(pageTsx, /<Hero content=\{home\.hero\} \/>/);
  assert.match(pageTsx, /export const metadata: Metadata = \{/);
  const card = await read('components/ui/Card.tsx');
  assert.match(card, /export interface CardProps/);
});

test('MDX entries export metadata and collection pages read them', async () => {
  const mdx = await read('content/blog/post-a.mdx');
  assert.match(mdx, /^export const metadata = \{/);
  assert.match(mdx, /## b/);
  const slugPage = await read('app/blog/[slug]/page.tsx');
  assert.match(slugPage, /generateStaticParams/);
  assert.match(slugPage, /getBlogEntry/);
});

test('font-size utilities do not carry Tailwind default line-heights', async () => {
  const css = await read('app/globals.css');
  assert.match(css, /--text-\*: initial;/);
  assert.match(css, /--text-xl: 1\.25rem;/);
  assert.doesNotMatch(css, /--text-xl--line-height/);
});

test('MDX paragraphs that only hold an image are not wrapped in <p>', async () => {
  const mdx = await read('components/mdx/BlogMdx.tsx');
  assert.match(mdx, /function onlyImage/);
  assert.match(mdx, /p: \(\{ children, \.\.\.props \}\) =>\s*onlyImage\(children\)/);
});

test('no generated file references remote Framer image URLs', async () => {
  for (const f of await list(dir)) {
    if (/\.(tsx?|mdx|css)$/.test(f)) assert.doesNotMatch(await read(f), /https:\/\/cdn\.test\/[^"']*\.png/, f);
  }
});

test('collection listings read cards from MDX metadata, including resized cover images', async () => {
  const blogPage = await read('app/blog/page.tsx');
  assert.match(blogPage, /e.metadata.image/);
  assert.match(blogPage, /e.metadata.title/);
});

test('Framer variants become a variants map, and listings store each entry variant in its MDX', async () => {
  const card = await read('components/ui/PostCard.tsx');
  assert.match(card, /const variants = \{/);
  assert.match(card, /yellow: \{/);
  assert.match(card, /pink: \{/);
  assert.match(card, /const v = variants\[variant as keyof typeof variants\] \?\? variants\.yellow;/);
  assert.match(card, /className=\{v\.badgeClass\}/);
  assert.match(card, /\{v\.icon\}/);
  // The variant colours live only in the variants map, never in a fixed className.
  assert.doesNotMatch(card, /className[^\n]*bg-(yellow|pink)/);
  assert.match(await read('content/blog/post-a.mdx'), /"variant": "yellow"/);
  assert.match(await read('content/blog/post-b.mdx'), /"variant": "pink"/);
  assert.match(await read('app/blog/page.tsx'), /variant: e\.metadata\.variant/);
  assert.match(await read('lib/blog.ts'), /variant: string;/);
});
