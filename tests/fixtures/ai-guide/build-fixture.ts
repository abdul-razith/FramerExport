/**
 * Framer-like fixture for the AI guide v2 tests.
 *   site/    what the live site serves (after hydration)
 *   export/  what framer-export writes (Framer's desktop/tablet/mobile copies, scripts/vendor module)
 * Run: npx tsx tests/fixtures/ai-guide/build-fixture.ts
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const FIXTURE_V2 = path.resolve(import.meta.dirname);
type Variant = 'site' | 'export';

const css = (fontPrefix: string) => `
:root{--token-ink:rgb(20,20,20);--token-paper:rgb(250,247,240);--token-accent:rgb(54,197,240)}
@font-face{font-family:"Inter Display";src:url(${fontPrefix}fonts/Inter-Regular.latin.woff2);font-weight:400;font-style:normal}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:"Inter Display",sans-serif;background-color:var(--token-paper,#faf7f0);color:var(--token-ink,#141414)}
.framer-wrap{display:flex;flex-direction:column;width:100%}
.framer-header{display:flex;justify-content:space-between;align-items:center;height:56px;padding:0 24px;background-color:var(--token-ink,#141414);color:#ffffff}
.framer-header a{color:#ffffff;margin-left:16px;text-decoration:none}
.framer-loader{position:fixed;top:0;left:0;width:100%;height:100vh;background-color:var(--token-accent,#36c5f0);z-index:20;pointer-events:none;transition:opacity .2s}
.framer-ghost{width:0;height:0;overflow:hidden}
.framer-hero{display:flex;flex-direction:column;align-items:center;gap:24px;padding:80px 24px;height:640px}
.framer-ruler{display:flex;gap:40px;font-size:11px;color:#999999}
.framer-clock{font-size:14px;margin:0}
.framer-hero-title{color:var(--token-ink,#141414);font-size:72px;margin:0;transform:rotate(-2deg)}
.framer-works{display:flex;flex-direction:column;gap:0}
.framer-panel{display:flex;align-items:center;justify-content:center;height:700px;background-color:var(--token-accent,#36c5f0);border-radius:24px}
.framer-panel h2{font-size:48px;margin:0}
.framer-faq{padding:48px 24px}
.framer-faq-q{cursor:pointer;font-size:20px;padding:12px;border:1px solid #141414;background:none}
.framer-faq-a{display:none;padding:12px}
.framer-faq.open .framer-faq-a{display:block}
.framer-cta{display:flex;gap:24px;padding:48px 24px}
.framer-cta-btn{padding:16px 24px;background-color:#ffffff;border-radius:12px}
.framer-cta-btn:hover{background-color:var(--token-accent,#36c5f0)}
.framer-services-hero{padding:80px 24px}
@media (max-width:1199px){.hidden-m1{display:none!important}.framer-hero-title{font-size:56px}.framer-panel{height:600px}}
@media (max-width:809px){.framer-hero-title{font-size:40px}.framer-ruler{gap:12px}}
@media (min-width:1200px){.hidden-d1{display:none!important}}
`;

const header = (link: string) => `
<header class="framer-header" data-framer-name="Header"><span data-framer-name="Logo">Nudge</span><nav data-framer-name="Nav"><a href="${link || './'}">Home</a><a href="${link}services">Services</a></nav></header>`;

const loader = (v: Variant) =>
  `<div class="framer-loader" data-framer-name="Loader"><p>Welcome!</p></div>${
    v === 'site' ? `<script>setTimeout(()=>{document.querySelector('.framer-loader').style.opacity='0'},300)</script>` : ''
  }`;

const ruler = () => `<div class="framer-ruler" data-framer-name="Ruler">${Array.from({ length: 15 }, (_, i) => `<span>${i * 100}</span>`).join('')}</div>`;

const clock = (v: Variant) =>
  `<p class="framer-clock" data-framer-name="Clock" id="clock">9:06:10 AM</p>${
    v === 'site'
      ? `<script>(()=>{const el=document.getElementById('clock');let s=10;setInterval(()=>{s=(s+1)%60;el.textContent='9:06:'+String(s).padStart(2,'0')+' AM'},1000)})()</script>`
      : ''
  }`;

const runtime = (v: Variant) => (v === 'export' ? ' data-framer-appear-id="a1" style="transform:none"' : '');

const home = (v: Variant, link: string) => `
${loader(v)}
<div class="framer-ghost" data-framer-name="Ghost"></div>
<section class="framer-hero" data-framer-name="Hero">
  ${ruler()}
  ${clock(v)}
  <!--$--><div class="ssr-variant hidden-m1"><h1 class="framer-hero-title" data-framer-name="Title"${runtime(v)}>Big desktop title</h1></div><!--/$-->
  <!--$--><div class="ssr-variant hidden-d1"><h1 class="framer-hero-title" data-framer-name="Title"${runtime(v)}>Small title</h1></div><!--/$-->
</section>
<section class="framer-works" data-framer-name="Works">
  <div class="framer-panel" data-framer-name="Panel"><h2>Project One</h2></div>
  <div class="framer-panel" data-framer-name="Panel"><h2>Project Two</h2></div>
  <div class="framer-panel" data-framer-name="Panel"><h2>Project Three</h2></div>
</section>
<section class="framer-faq" data-framer-name="FAQ" id="faq">
  <button class="framer-faq-q" data-framer-name="Question" type="button">What do you do?</button>
  <div class="framer-faq-a" data-framer-name="Answer">Design and build.</div>
</section>${
  v === 'site'
    ? `<script>document.querySelector('.framer-faq-q').addEventListener('click',()=>document.getElementById('faq').classList.toggle('open'))</script>`
    : ''
}
<section class="framer-cta" data-framer-name="CTA">
  <div class="framer-cta-btn" data-framer-name="Say Hi">Say hi</div>
  <a class="framer-cta-link" data-framer-name="Contact" href="${link}services">Contact</a>
</section>`;

const services = () => `
<section class="framer-services-hero" data-framer-name="Services Hero"><h1>Services</h1><p>Design, build and care.</p></section>`;

const PAGES = [
  { route: '/', title: 'Nudge Lab', body: home },
  { route: '/services', title: 'Services - Nudge Lab', body: (_v: Variant, _l: string) => services() },
];

/** Prettier-formatted like the real export's page module (Framer's compiled page). */
export const PAGE_MODULE = `function decoy() {
  var Tn = {
    UT: 0,
    GMT: 0,
  };
  return Tn;
}
var En, Tn, Ln, Rn;
(En = { opacity: 0, x: 0, y: 40, scale: 1 }),
  (Tn = { delay: 0.2, damping: 30, stiffness: 200, type: \`spring\` }),
  (Ln = { opacity: 1, rotate: 0, scale: 1, x: 150, y: -130 }),
  (Rn = { delay: 0, duration: 4, ease: [0.44, 0, 0.56, 1], type: \`tween\` });
export function Page() {
  return m(\`section\`, {
    className: \`framer-hero\`,
    "data-framer-name": \`Hero\`,
    children: [
      m(rn, {
        __framer__animate: { transition: Tn },
        __framer__animateOnce: !0,
        __framer__enter: En,
        className: \`framer-hero-title\`,
        "data-framer-name": \`Title\`,
      }),
      m(rn, {
        __framer__loop: Ln,
        __framer__loopEffectEnabled: !0,
        __framer__loopRepeatType: \`mirror\`,
        __framer__loopTransition: Rn,
        className: \`framer-ruler\`,
        "data-framer-name": \`Ruler\`,
      }),
      m(\`section\`, { className: \`framer-faq\`, "data-framer-name": \`FAQ\` }),
    ],
  });
}
`;

function render(page: (typeof PAGES)[number], v: Variant): string {
  const root = page.route === '/';
  const link = v === 'site' ? '/' : root ? '' : '../';
  const prefix = v === 'site' ? '/' : (root ? '' : '../') + 'assets/';
  const script = v === 'export' ? `<script type="module" data-framer-bundle="main" src="${root ? '' : '../'}scripts/vendor/page.Abc123.mjs"></script>` : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${page.title}</title>
<link rel="canonical" href="${page.route}">
<style data-framer-css-ssr-minified>${css(prefix)}</style>
${script}
</head><body><div id="main"><div class="framer-wrap" data-framer-name="Desktop">
${header(link)}
${page.body(v, link)}
</div></div></body></html>
`;
}

async function write(file: string, data: string | Buffer): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data);
}

export async function buildFixtureV2(outDir: string = FIXTURE_V2): Promise<void> {
  const font = await fs.readFile(path.join(FIXTURE_V2, '..', 'fonts', 'Inter-Regular.latin.woff2'));
  for (const v of ['site', 'export'] as const) {
    const base = path.join(outDir, v);
    await fs.rm(base, { recursive: true, force: true });
    for (const page of PAGES) {
      const file = page.route === '/' ? 'index.html' : v === 'site' ? page.route.slice(1) + '.html' : 'subpages/' + page.route.slice(1) + '.html';
      await write(path.join(base, file), render(page, v));
    }
    await write(path.join(base, v === 'site' ? 'fonts' : 'assets/fonts', 'Inter-Regular.latin.woff2'), font);
  }
  await write(path.join(outDir, 'export', 'scripts', 'vendor', 'page.Abc123.mjs'), PAGE_MODULE);
  await write(
    path.join(outDir, 'export', 'export-report.json'),
    JSON.stringify({ source: 'http://127.0.0.1:0/', platform: 'framer', captureMode: 'html-with-runtime', assets: 1, failedAssets: [], subpages: 1 }, null, 2) + '\n'
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await buildFixtureV2();
