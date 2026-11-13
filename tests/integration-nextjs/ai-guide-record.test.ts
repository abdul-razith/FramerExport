import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import puppeteer, { type Browser } from 'puppeteer';
import { serveFixture } from '../fixtures/nextjs/serve.js';
import { recordPage } from '../../src/ai-guide/record.js';

// A page where nothing moves at the top, a card far below animates only when scrolled to (as Framer
// "in view" effects do), and a heading's letters (split into spans) rise in the same way.
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font-family:sans-serif} .gap{height:2400px} .card{width:300px;height:200px;background:#36c5f0;opacity:0;transform:translateY(40px);transition:opacity .4s,transform .4s}
.card.in{opacity:1;transform:none} h2 span{display:inline-block}
</style></head><body>
<div class="gap" data-framer-name="Top">Static top</div>
<div class="card" data-framer-name="Card">Meridian</div>
<h2 data-framer-name="Heading"><span>F</span><span>E</span><span>A</span></h2>
<div class="gap"></div>
<script>
const io=new IntersectionObserver((es)=>es.forEach((e)=>{if(!e.isIntersecting)return;
  if(e.target.classList.contains('card'))e.target.classList.add('in');
  else e.target.querySelectorAll('span').forEach((s,i)=>s.animate([{opacity:0,transform:'translateY(40px)'},{opacity:1,transform:'none'}],{duration:300,delay:i*30,fill:'both'}));
  io.unobserve(e.target);}));
io.observe(document.querySelector('.card'));io.observe(document.querySelector('h2'));
</script></body></html>`;

let server: { url: string; close(): Promise<void> };
let browser: Browser;
let out: string;

before(async () => {
  const site = await fs.mkdtemp(path.join(os.tmpdir(), 'aiguide-record-site-'));
  await fs.writeFile(path.join(site, 'index.html'), PAGE);
  server = await serveFixture(site);
  out = await fs.mkdtemp(path.join(os.tmpdir(), 'aiguide-record-out-'));
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

test('the recording lists what moves only when scrolled to, with its key and the scroll position', { timeout: 180000 }, async () => {
  const rec = await recordPage(browser, server.url + '/', out, { loadMs: 1500, maxLoadMs: 1500 });
  const card = rec.movers.find((m) => m.name === 'Card');
  assert.ok(card, JSON.stringify(rec.movers, null, 1));
  assert.match(card.key, /^body:0\/div\[Card\]:1$/);
  assert.ok(card.scrollY > 0, 'it moved after scrolling');
  assert.ok(card.kinds.includes('css-transition') || card.kinds.includes('opacity'), card.kinds.join());
  const letters = rec.movers.filter((m) => m.key.startsWith('body:0/h2[Heading]:2/span'));
  assert.equal(letters.length, 3, JSON.stringify(rec.movers.map((m) => m.key)));
  assert.equal(letters[0].parentText, 'FEA');
  assert.ok(!rec.movers.some((m) => m.name === 'Top'), 'the static block is not listed');
});
