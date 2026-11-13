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

let server: { url: string; close(): Promise<void> };
let root: string;

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aiguide-parity-'));
  const site = path.join(root, 'site');
  await fs.mkdir(site, { recursive: true });
  await fs.writeFile(path.join(site, 'index.html'), page(true));
  await fs.writeFile(path.join(site, 'orig.html'), page(false));
  server = await serveFixture(site);
  const guide = path.join(root, 'ai-guide');
  await fs.mkdir(path.join(guide, 'scripts'), { recursive: true });
  await fs.mkdir(path.join(guide, 'parity'), { recursive: true });
  await fs.writeFile(path.join(guide, 'scripts', 'parity.mjs'), PARITY_MJS);
  await fs.writeFile(path.join(guide, 'scripts', 'parity-lib.mjs'), PARITY_LIB_MJS);
  const s = (id: string, cls: string) => ({ id, name: id, className: cls, boxes: {}, live: {}, motion: 0 });
  await fs.writeFile(
    path.join(guide, 'sections.json'),
    JSON.stringify({ '/': { slug: 'index', url: server.url + '/orig', sections: [s('01', 'framer-s1'), s('02', 'framer-s2'), s('03', 'framer-s3')] } })
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
});
