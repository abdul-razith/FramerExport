/**
 * Generates the Framer-like fixture used by the Next.js conversion tests.
 *   site/    what the live site serves after hydration (final animation states)
 *   export/  what framer-export writes (pre-hydration start states, relative asset paths)
 * Run: npx tsx tests/fixtures/nextjs/build-fixture.ts
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';

const ROOT = path.resolve(import.meta.dirname);
type Variant = 'site' | 'export';

interface PageDef {
  route: string;
  title: string;
  description: string;
  sections: (v: Variant, prefix: string) => string;
}

const css = (prefix: string) => `
:root{--token-a1:#133324;--token-b2:#a1dfc5;--token-c3:#ffffff1a}
@font-face{font-family:"Inter Display";src:url(${prefix}fonts/Inter-Regular.latin.woff2);font-weight:400;font-style:normal;unicode-range:U+0000-00FF}
html,body{margin:0;padding:0}
body{font-family:"Inter Display",sans-serif;background-color:var(--token-b2);color:var(--token-a1)}
.page{display:flex;flex-direction:column;gap:48px;padding:24px}
.header{display:flex;justify-content:space-between;align-items:center;padding:16px 24px;background-color:var(--token-a1);color:#ffffff;border-radius:16px}
.header a{color:#ffffff;text-decoration:none;margin-left:16px}
.hero{display:flex;flex-direction:column;gap:24px;padding:64px 24px}
.hero-title{font-size:72px;line-height:1.1;margin:0;font-weight:400}
.intro,.tagline{font-size:20px;margin:0}
.cards{display:flex;gap:24px}
.card{position:relative;display:flex;flex-direction:column;gap:12px;padding:16px;border-radius:16px;background-color:#ffffff;flex:1}
.card:hover{background-color:var(--token-c3)}
.card img{width:100%;height:120px;object-fit:cover;border-radius:16px}
.card h3{margin:0;font-size:24px}
.card p{margin:0;font-size:16px}
.status{margin:0;font-size:14px}
[data-border="true"]::after{content:"";position:absolute;top:0;right:0;bottom:0;left:0;pointer-events:none;border-radius:inherit;border-width:var(--border-top-width,0) var(--border-right-width,0) var(--border-bottom-width,0) var(--border-left-width,0);border-color:var(--border-color,none);border-style:var(--border-style,none)}
.bordered{position:relative;padding:8px;width:120px}
.avatar-wrap{width:40px}
.avatar{position:relative;width:40px;height:40px}
.avatar-inner{position:absolute;top:0;right:0;bottom:0;left:0;border-radius:40px;background-color:#a1dfc5}
.content{padding:24px;font-size:18px}
.footer{padding:24px;border-radius:16px;background-color:var(--token-a1);color:#ffffff}
.footer a{color:var(--token-b2)}
.post-body h2{font-size:30px}
.post-body img{width:240px;height:120px}
@media (max-width:809px){.hidden-abc{display:none!important}.hero-title{font-size:48px}.cards{flex-direction:column}}
@media (min-width:810px){.hidden-def{display:none!important}}
`;

const header = (prefix: string) => `
<header data-framer-name="Logo + Menu" class="header">
  <span data-framer-name="Logo">Nudge</span>
  <div class="hidden-abc"><nav data-framer-name="Nav"><a href="${prefix || './'}">Home</a><a href="${prefix}about">About</a><a href="${prefix}blog">Blog</a></nav></div>
  <div class="hidden-def"><button data-framer-name="Burger" type="button">Menu</button></div>
</header>`;

const footer = (prefix: string) => `
<footer data-framer-name="Footer" class="footer"><p data-framer-name="Copyright">© Nudge Studio</p><a data-framer-name="Footer Link" href="${prefix}about">About the studio</a></footer>`;

const img = (v: Variant, prefix: string, file: string, alt: string, name = 'Image') =>
  `<img data-framer-name="${name}" src="${v === 'site' ? '/images/' : prefix + 'assets/images/'}${file}" alt="${alt}" width="240" height="120">`;

const letters = (v: Variant, word: string) =>
  [...word]
    .map(
      (ch) =>
        `<span style="display:inline-block${v === 'export' ? ';opacity:0.001;transform:translateX(40px) scale(0.9)' : ''}">${ch}</span>`
    )
    .join('');

const card = (v: Variant, prefix: string, n: number, title: string, body: string) => `
<div data-framer-name="Card" class="card">${img(v, prefix, `card-${n}.png`, title)}<h3 data-framer-name="Title">${title}</h3><p data-framer-name="Body">${body}</p></div>`;

const PAGES: PageDef[] = [
  {
    route: '/',
    title: 'Nudge Fixture',
    description: 'Fixture home page',
    sections: (v, p) => `
<section data-framer-name="Hero Section" class="hero">
  <h1 data-framer-name="Heading" class="hero-title">Build {curly} &lt;tag&gt; "quotes" &amp; emoji 🚀</h1>
  <p data-framer-name="Intro" class="intro"${v === 'export' ? ' style="opacity:0;transform:translateY(40px)"' : ''}>We design calm, useful products.</p>
  <p data-framer-name="Tagline" class="tagline">${letters(v, 'Hello')}</p>
  <span data-framer-name="Arrow">→</span>
  <p data-framer-name="Status" class="status"><span style="display:inline-block">AVAILABLE</span> <span style="display:inline-block">FOR</span> <span style="display:inline-block">WORK</span></p>
  <p data-framer-name="Read More" class="status">Read the <a href="https://example.com/x">full story</a> today.</p>
  <div data-framer-name="Bordered" data-border="true" class="bordered" style="--border-top-width:2px;--border-right-width:2px;--border-bottom-width:2px;--border-left-width:2px;--border-color:#133324;--border-style:solid">Box</div>
  <div class="avatar-wrap"><div data-framer-name="Avatar" class="avatar"><div class="avatar-inner"></div></div></div>
  ${img(v, p, 'hero.png', 'Studio desk', 'Hero Image')}
</section>
<section data-framer-name="Projects" class="cards">
  ${card(v, p, 1, 'North Light', 'A calm banking app.')}
  ${card(v, p, 2, 'Stylebook', 'A fashion catalogue.')}
  ${card(v, p, 3, 'Homestead', 'A real estate site.')}
</section>
<section data-framer-name="Content" class="content"><p data-framer-name="Text">First content block.</p></section>
<section data-framer-name="Content" class="content"><p data-framer-name="Text">Second content block.</p></section>
<div data-framer-name="Smooth Scroll"></div>
<div data-framer-cursor="cursor-1" data-framer-name="Cursor Area" class="content"><p>Hover area</p></div>`,
  },
  {
    route: '/about',
    title: 'About - Nudge Fixture',
    description: 'About the studio',
    sections: () => `
<section data-framer-name="About Hero" class="hero"><h1 data-framer-name="Heading" class="hero-title">About us</h1><p data-framer-name="Intro" class="intro">A small studio.</p></section>`,
  },
  {
    route: '/blog',
    title: 'Blog - Nudge Fixture',
    description: 'Writing from the studio',
    sections: (v, p) => `
<section data-framer-name="Blog Hero" class="hero"><h1 data-framer-name="Heading" class="hero-title">Blog</h1></section>
<section data-framer-name="Posts" class="cards">
  <a data-framer-name="Post Card" class="card" href="${p}blog/post-a"><h3 data-framer-name="Title">The Power of Focus</h3></a>
  <a data-framer-name="Post Card" class="card" href="${p}blog/post-b"><h3 data-framer-name="Title">Ideas Need Silence</h3></a>
</section>`,
  },
  ...(
    [
      ['post-a', 'The Power of Focus', '12 March 2025', 'cover-a.png', 'Deep Work'],
      ['post-b', 'Ideas Need Silence', '3 April 2025', 'cover-b.png', 'Quiet Time'],
    ] as const
  ).map(
    ([slug, title, date, cover, heading]): PageDef => ({
      route: `/blog/${slug}`,
      title: `${title} - Nudge Fixture`,
      description: `${title} article`,
      sections: (v, p) => `
<section data-framer-name="Post Header" class="hero"><h1 data-framer-name="Title" class="hero-title">${title}</h1><p data-framer-name="Date">${date}</p>${img(v, p, cover, title, 'Cover')}</section>
<section data-framer-name="Post Body" class="content post-body">
  <p>Focus is a skill that improves with practice for ${title}.</p>
  <h2>${heading}</h2>
  <p>Protect a clear period of time and pause every notification.</p>
  <ul><li>Define the outcome</li><li>Prepare the space</li><li>Rest afterwards</li></ul>
  <p>Read more <a href="https://example.com/focus">about focus</a>.</p>
  ${img(v, p, 'inline.png', 'Desk detail', 'Inline Image')}
</section>`,
    })
  ),
];

function exportFileFor(route: string): string {
  return route === '/' ? 'index.html' : 'subpages/' + route.slice(1).replace(/\//g, '_') + '.html';
}

function siteFileFor(route: string): string {
  return route === '/' ? 'index.html' : route.slice(1) + '.html';
}

function render(page: PageDef, v: Variant): string {
  const isRoot = page.route === '/';
  const linkPrefix = v === 'site' ? '/' : isRoot ? '' : '../';
  const assetPrefix = v === 'site' ? '' : isRoot ? '' : '../';
  const fontPrefix = v === 'site' ? '/' : assetPrefix + 'assets/';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${page.title}</title>
<meta name="description" content="${page.description}">
<meta property="og:title" content="${page.title}">
<link rel="canonical" href="${page.route}">
<style data-framer-css-ssr-minified>${css(fontPrefix)}</style>
</head><body><div id="main"><div data-framer-name="Desktop" class="page">
${header(linkPrefix)}
${page.sections(v, v === 'site' ? '/' : assetPrefix)}
${footer(linkPrefix)}
</div></div></body></html>
`;
}

function png(r: number, g: number, b: number): Buffer {
  const image = new PNG({ width: 24, height: 12 });
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = r;
    image.data[i + 1] = g;
    image.data[i + 2] = b;
    image.data[i + 3] = 255;
  }
  return PNG.sync.write(image);
}

async function write(file: string, data: string | Buffer): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data);
}

async function main(): Promise<void> {
  const images: Record<string, Buffer> = {
    'hero.png': png(19, 51, 36),
    'card-1.png': png(161, 223, 197),
    'card-2.png': png(255, 115, 115),
    'card-3.png': png(54, 197, 240),
    'cover-a.png': png(250, 190, 209),
    'cover-b.png': png(177, 150, 255),
    'inline.png': png(236, 178, 46),
  };
  const font = await fs.readFile(path.join(ROOT, '..', 'fonts', 'Inter-Regular.latin.woff2'));
  for (const v of ['site', 'export'] as const) {
    const base = path.join(ROOT, v);
    await fs.rm(base, { recursive: true, force: true });
    for (const page of PAGES) {
      await write(path.join(base, v === 'site' ? siteFileFor(page.route) : exportFileFor(page.route)), render(page, v));
    }
    for (const [name, data] of Object.entries(images)) {
      await write(path.join(base, v === 'site' ? 'images' : 'assets/images', name), data);
    }
    await write(path.join(base, v === 'site' ? 'fonts' : 'assets/fonts', 'Inter-Regular.latin.woff2'), font);
  }
  await write(
    path.join(ROOT, 'export', 'export-report.json'),
    JSON.stringify(
      {
        source: 'http://127.0.0.1:0/',
        platform: 'framer',
        captureMode: 'html-with-runtime',
        assets: Object.keys(images).length + 1,
        failedAssets: [],
        subpages: PAGES.length - 1,
      },
      null,
      2
    ) + '\n'
  );
}

await main();
