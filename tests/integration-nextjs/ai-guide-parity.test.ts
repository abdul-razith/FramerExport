import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { serveFixture } from '../fixtures/nextjs/serve.js';
import { PARITY_MJS } from '../../src/ai-guide/templates/parity.js';
import { PARITY_LIB_MJS } from '../../src/ai-guide/templates/parity-lib.js';

// The original (Framer classes) and the rebuild (data-section) differ in exactly three ways:
// section 02 sits 40px lower, the 03 card does not fade in when scrolled to, and the button in 01
// has no hover colour.
const page = (rebuild: boolean) => {
  const sec = (id: string, cls: string, extra = '') => (rebuild ? `data-section="${id}"${extra}` : `class="${cls}"`);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font-family:sans-serif} section{height:700px}
.say{display:inline-block;padding:12px;background:#ddd} ${rebuild ? '' : '.say:hover{background:#36c5f0}'}
.card{width:300px;height:200px;background:#e01e5a;${rebuild ? '' : 'opacity:0;transform:translateY(40px);transition:opacity .4s,transform .4s'}}
.card.in{opacity:1;transform:none}
</style></head><body>
<section ${sec('01', 'framer-s1')}><a class="say" href="#">Say hi</a></section>
<section ${sec('02', 'framer-s2', ' style="margin-top:40px"')}>Second</section>
<section ${sec('03', 'framer-s3')}><div class="card">Card</div></section>
<div style="height:1200px"></div>
${rebuild ? '' : `<script>new IntersectionObserver((es)=>es.forEach((e)=>e.isIntersecting&&e.target.classList.add('in'))).observe(document.querySelector('.card'))</script>`}
</body></html>`;
};


// Review fixes: one page pair per case, each expected to produce no difference at all.
const doc = (body: string, head = '') => `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font-family:sans-serif} section{height:700px}</style>${head}</head><body>${body}<div style="height:1200px"></div></body></html>`;
const sec = (rebuild: boolean, id: string, cls: string, inner: string, style = '') => `<section ${rebuild ? `data-section="${id}"` : `class="${cls}"`} style="${style}">${inner}</section>`;
const PAIRS: Record<string, (rebuild: boolean) => string> = {
  // The rebuild runs its loop as a Web Animation built directly (new Animation(new KeyframeEffect())),
  // as motion does, without element.animate().
  kfx: (rb) =>
    doc(
      sec(rb, '01', 'framer-k1', '<div id="b" style="width:80px;height:40px;background:#ecb22e">Badge</div>') +
        "<script>const b=document.getElementById('b');const k=[{transform:'none'},{transform:'translateX(150px)'}];" +
        (rb ? "new Animation(new KeyframeEffect(b,k,{duration:2500,iterations:Infinity,direction:'alternate'}),document.timeline).play()" : "b.animate(k,{duration:2500,iterations:Infinity,direction:'alternate'})") +
        '</script>'
    ),
  // A badge without a class or a layer name (found by its captured place and size) and a class
  // shared by two elements (the right one has the captured size).
  cls: (rb) =>
    doc(
      sec(rb, '01', 'framer-c1', rb ? '' : '<div class="framer-sh" style="width:300px;height:300px;background:#eee"></div>') +
        // On the original the badge has no class and no layer name (a script adds it), and another
        // badge sits on the same spot.
        (rb ? '' : '<div style="position:absolute;right:16px;top:844px;width:150px;height:40px"><a href="#" data-framer-name="Light">Made with</a></div>') +
        (rb ? '<div data-section="S5"' : '<div') +
        ' style="position:fixed;right:16px;bottom:16px;width:150px;height:40px"><span class="pulse">BUY</span></div>' +
        (rb ? '<div data-section="S6"' : '<div class="framer-sh" data-framer-name="Default"') +
        ' style="position:fixed;left:-8px;top:-8px;width:16px;height:16px;background:#000"></div>',
      '<style>.pulse{display:inline-block;animation:p 1s infinite}@keyframes p{50%{opacity:.4}}</style>'
    ),
  // The original sets the start state soon after load and animates a second later; the rebuild
  // starts in that state (server-rendered) and animates at the same moment.
  setup: (rb) =>
    doc(
      sec(rb, '01', 'framer-u1', '<div id="a"' + (rb ? ' style="transform: translateY(40px)"' : '') + '>Hi there</div>') +
        "<script>const a=document.getElementById('a');document.addEventListener('DOMContentLoaded',()=>{" +
        (rb ? '' : "setTimeout(()=>{a.style.transform='translateY(40px)'},50);") +
        "setTimeout(()=>{const t0=performance.now();(function f(t){const p=Math.min(1,(t-t0)/300);a.style.transform='translateY('+(40-40*p)+'px)';if(p<1)requestAnimationFrame(f)})(t0)},1000)})</script>"
    ),
  // The original's DOMContentLoaded comes 600ms later (a slow script); both animate 300ms after it.
  t: (rb) => doc(sec(rb, '01', 'framer-t1', '<div id="a">Hello</div>') + `<script>document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>document.getElementById('a').animate([{opacity:0},{opacity:1}],{duration:300}),300))</script>`, rb ? '' : '<script>const e=Date.now()+600;while(Date.now()<e){}</script>'),
  // Ten links, the rebuild in reverse order; "Two" has the same hover colour on both.
  nav: (rb) => doc(sec(rb, '01', 'framer-n1', (rb ? ['Ten','Nine','Eight','Seven','Six','Five','Four','Three','Two','One'] : ['One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten']).map((t) => `<a href="#" class="${t === 'Two' ? 'h' : ''}" style="display:inline-block;padding:6px">${t}</a>`).join(' ')), '<style>a.h:hover{background:#36c5f0}</style>'),
  // A loader that fades: the original keeps it (opacity 0), the rebuild removes it.
  ld: (rb) => doc(sec(rb, 'S1', 'framer-ld', 'Hey there', 'position:fixed;inset:0;height:100vh;background:#fff;z-index:9') + sec(rb, '01', 'framer-l1', 'Body') + `<script>setTimeout(()=>{const l=document.querySelector('${rb ? '[data-section="S1"]' : '.framer-ld'}');l.animate([{opacity:1},{opacity:0}],{duration:200,fill:'forwards'}).finished.then(()=>{${rb ? 'l.remove()' : "l.style.opacity='0'"}})},200)</script>`),
  // The original animates letters wrapped per word; the rebuild animates the whole heading.
  words: (rb) => doc(sec(rb, '01', 'framer-w1', rb ? '<h2 id="h">FEATURED WORKS</h2>' : '<h2 id="h">' + ['FEATURED', 'WORKS'].map((w) => '<span style="display:inline-block">' + [...w].map((c) => `<span style="display:inline-block">${c}</span>`).join('') + '</span>').join(' ') + '</h2>') + `<script>setTimeout(()=>{${rb ? "document.getElementById('h').animate([{opacity:0},{opacity:1}],{duration:300})" : "document.querySelectorAll('#h span span').forEach((s,i)=>s.animate([{opacity:0,transform:'translateY(20px)'},{opacity:1,transform:'none'}],{duration:300,delay:i*20}))"}},200)</script>`),
};

let server: { url: string; close(): Promise<void> };
let root: string;

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aiguide-parity-'));
  const site = path.join(root, 'site');
  await fs.mkdir(site, { recursive: true });
  await fs.writeFile(path.join(site, 'index.html'), page(true));
  await fs.writeFile(path.join(site, 'orig.html'), page(false));
  for (const [name, make] of Object.entries(PAIRS)) {
    await fs.writeFile(path.join(site, name + '.html'), make(true));
    await fs.writeFile(path.join(site, name + '-orig.html'), make(false));
  }
  server = await serveFixture(site);
  const guide = path.join(root, 'ai-guide');
  await fs.mkdir(path.join(guide, 'scripts'), { recursive: true });
  await fs.mkdir(path.join(guide, 'parity'), { recursive: true });
  await fs.writeFile(path.join(guide, 'scripts', 'parity.mjs'), PARITY_MJS);
  await fs.writeFile(path.join(guide, 'scripts', 'parity-lib.mjs'), PARITY_LIB_MJS);
  const s = (id: string, cls: string) => ({ id, name: id, className: cls, boxes: {}, live: {}, motion: 0 });
  await fs.writeFile(
    path.join(guide, 'sections.json'),
    JSON.stringify({
      '/': { slug: 'index', url: server.url + '/orig', sections: [s('01', 'framer-s1'), s('02', 'framer-s2'), s('03', 'framer-s3')] },
      '/t': { slug: 't', url: server.url + '/t-orig', sections: [s('01', 'framer-t1')] },
      '/nav': { slug: 'nav', url: server.url + '/nav-orig', sections: [s('01', 'framer-n1')] },
      '/ld': { slug: 'ld', url: server.url + '/ld-orig', sections: [s('S1', 'framer-ld'), s('01', 'framer-l1')] },
      '/words': { slug: 'words', url: server.url + '/words-orig', sections: [s('01', 'framer-w1')] },
      '/cls': {
        slug: 'cls',
        url: server.url + '/cls-orig',
        sections: [
          s('01', 'framer-c1'),
          { id: 'S5', name: 'Section', boxes: { 1440: { x: 1274, y: 844, w: 150, h: 40 }, 1024: { x: 858, y: 844, w: 150, h: 40 }, 390: { x: 224, y: 844, w: 150, h: 40 } }, live: {}, motion: 1 },
          { id: 'S6', name: 'Default', className: 'framer-sh', boxes: { 1440: { x: -8, y: -8, w: 16, h: 16 }, 1024: { x: -8, y: -8, w: 16, h: 16 }, 390: { x: -8, y: -8, w: 16, h: 16 } }, live: {}, motion: 0 },
        ],
      },
      '/setup': { slug: 'setup', url: server.url + '/setup-orig', sections: [s('01', 'framer-u1')] },
      '/kfx': { slug: 'kfx', url: server.url + '/kfx-orig', sections: [s('01', 'framer-k1')] },
    })
  );
  const src = (id: string, extra = {}) => ({ folder: `ai-guide/pages/index/sections/${id}-x`, markup: `index.html:${id}0`, styles: `ai-guide/pages/index/sections/${id}-x/styles.css`, animations: [], hovers: [], ...extra });
  await fs.writeFile(
    path.join(guide, 'parity', 'sources.json'),
    JSON.stringify({
      '/': {
        '01': src('01', { hovers: [{ element: 'Say hi', at: 'ai-guide/pages/index/sections/01-x/styles.css (:hover)' }] }),
        '02': src('02'),
        '03': src('03', { animations: [{ label: 'Card', kind: 'enter', at: 'scripts/vendor/p.mjs @ 321' }] }),
      },
    })
  );
  await fs.mkdir(path.join(root, 'nextjs-app'));
  await fs.writeFile(path.join(root, 'nextjs-app', 'package.json'), '{"name":"app","private":true}');
});

after(async () => {
  await server?.close();
});

function parity(...args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(root, 'ai-guide', 'scripts', 'parity.mjs'), ...args, '--base', server.url, '--load-ms', '800'], {
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

test('parity lists exactly the gap, the missing animation and the missing hover, with pointers', { timeout: 600000 }, async () => {
  const run = await parity('/');
  assert.equal(run.status, 0, run.stderr);
  const md = await fs.readFile(path.join(root, 'ai-guide', 'parity', 'index.md'), 'utf8');
  const at1440 = md.slice(md.indexOf('## 1440'), md.indexOf('## 1024'));
  const lines = at1440.split('\n').filter((l) => l.startsWith('- ') && l !== '- none');
  assert.ok(lines.some((l) => l.startsWith('- 02: top +40px') && l.includes('02-x/styles.css') && l.includes('index.html:020')), at1440);
  assert.ok(lines.some((l) => l.startsWith('- 03 · Card: missing') && l.includes('scripts/vendor/p.mjs @ 321')), at1440);
  assert.ok(lines.some((l) => l.startsWith('- 01 · Say hi (hover)') && l.includes('background-color') && l.includes('changes nothing')), at1440);
  assert.equal(lines.filter((l) => /^- 01(:| ·)/.test(l)).length, 1, 'section 01 has only its hover difference');
  assert.ok(lines.some((l) => l.startsWith('- 03: top +40px') && l.includes('follows the section above')), at1440);
  assert.equal(lines.length, 4, at1440);
});

test('an unreachable original is reported, not a crash', { timeout: 300000 }, async () => {
  const run = await parity('/', '--original', 'http://127.0.0.1:9/');
  assert.equal(run.status, 0, run.stderr);
  const md = await fs.readFile(path.join(root, 'ai-guide', 'parity', 'index.md'), 'utf8');
  assert.match(md, /original not reachable/);
  assert.doesNotMatch(md, /matches the original/);
  assert.match(md, /Not compared at 1440/);
  assert.match(md, /rebuild measured: 3 sections/);
});

for (const [name, why] of [
  ['t', 'load timing is measured from each page’s own DOMContentLoaded'],
  ['nav', 'hover probes the same targets on both sites, whatever their order'],
  ['ld', 'a loader that fades is not a difference, kept or removed'],
  ['words', 'letters animated per word match the whole heading animated'],
  ['cls', 'a section without a class or name, or with a shared class, is found by its captured place and size'],
  ['setup', 'an animation is timed from when it moves, not from when its start state was set'],
  ['kfx', 'a Web Animation built without element.animate() still counts as motion'],
]) {
  test(why, { timeout: 300000 }, async () => {
    const run = await parity('/' + name);
    assert.equal(run.status, 0, run.stderr);
    const md = await fs.readFile(path.join(root, 'ai-guide', 'parity', name + '.md'), 'utf8');
    const items = md.split('\n').filter((l) => l.startsWith('- ') && l !== '- none' && !l.startsWith('- Generated'));
    assert.deepEqual(items, [], md);
  });
}
