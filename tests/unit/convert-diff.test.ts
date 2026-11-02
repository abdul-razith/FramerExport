import assert from 'node:assert/strict';
import test from 'node:test';
import { PNG } from 'pngjs';
import { compareSections } from '../../src/convert/verify/diff.js';
import { compareDom } from '../../src/convert/verify/dom-check.js';
import type { CaptureResult } from '../../src/convert/verify/capture.js';

function solid(w: number, h: number, changed = 0): Buffer {
  const png = new PNG({ width: w, height: h });
  png.data.fill(255);
  // spread changed pixels one per row-stride so they are not treated as anti-aliasing
  for (let i = 0; i < changed; i++) {
    const idx = (i * 97) % (w * h);
    png.data[idx * 4] = 0;
    png.data[idx * 4 + 1] = 0;
    png.data[idx * 4 + 2] = 0;
  }
  return PNG.sync.write(png);
}
function cap(name: string, w: number, h: number, changed = 0): CaptureResult {
  return { png: solid(w, h, changed), sections: [{ name, box: { x: 0, y: 0, width: w, height: h } }] };
}

test('identical sections pass with ratio 0 and no images', () => {
  const [r] = compareSections(cap('Hero', 100, 100), cap('Hero', 100, 100), 100);
  assert.equal(r.ratio, 0);
  assert.equal(r.pass, true);
  assert.equal(r.diffPng, undefined);
});

test('ratio threshold 0.5%', () => {
  const bad = compareSections(cap('Hero', 100, 100), cap('Hero', 100, 100, 60), 100)[0];
  assert.equal(bad.pass, false);
  assert.ok(bad.diffPng && bad.expectedPng && bad.actualPng);
  assert.equal(compareSections(cap('Hero', 100, 100), cap('Hero', 100, 100, 40), 100)[0].pass, true);
});

test('height delta tolerance 2px', () => {
  const bad = compareSections(cap('Hero', 100, 100), cap('Hero', 100, 103), 100)[0];
  assert.equal(bad.heightDelta, 3);
  assert.equal(bad.pass, false);
  assert.equal(compareSections(cap('Hero', 100, 100), cap('Hero', 100, 102), 100)[0].pass, true);
});

test('missing and unexpected sections', () => {
  const empty: CaptureResult = { png: solid(10, 10), sections: [] };
  const missing = compareSections(cap('Hero', 100, 100), empty, 100);
  assert.equal(missing[0].pass, false);
  assert.equal(missing[0].reason, 'missing section Hero');
  const extra = compareSections(empty, cap('Footer', 100, 100), 100);
  assert.equal(extra[0].pass, false);
  assert.equal(extra[0].reason, 'unexpected section Footer');
});

test('unnamed section-<n> entries pair by order among leftovers', () => {
  const r = compareSections(cap('section-1', 50, 50), cap('section-3', 50, 50), 50);
  assert.equal(r.length, 1);
  assert.equal(r[0].pass, true);
});

const maps = {
  routes: { 'subpages/about.html': '/about', 'index.html': '/' },
  images: { 'assets/images/x.avif': '/images/x.avif' }
};
const sec = (o: Partial<{ text: string; links: string[]; images: string[] }>) => [
  { name: 'Hero', text: '', links: [], images: [], ...o }
];

test('compareDom normalises whitespace', () => {
  assert.deepEqual(compareDom(sec({ text: '  Hello\n world ' }), sec({ text: 'Hello world' }), maps), []);
  assert.equal(compareDom(sec({ text: 'Hello' }), sec({ text: 'Bye' }), maps)[0].kind, 'text');
});

test('compareDom maps links', () => {
  const ok = compareDom(
    sec({ links: ['./subpages/about.html', '../index.html', 'https://a.com/', '#x'] }),
    sec({ links: ['/about', '/', 'https://a.com/', '#x'] }),
    maps
  );
  assert.deepEqual(ok, []);
  assert.equal(compareDom(sec({ links: ['subpages/about.html'] }), sec({ links: ['/blog'] }), maps)[0].kind, 'link');
});

test('compareDom maps images', () => {
  assert.deepEqual(
    compareDom(
      sec({ images: ['http://127.0.0.1:1234/assets/images/x.avif'] }),
      sec({ images: ['/_next/image?url=%2Fimages%2Fx.avif&w=640&q=75'] }),
      maps
    ),
    []
  );
  const bad = compareDom(sec({ images: ['assets/images/x.avif'] }), sec({ images: ['/images/y.avif'] }), maps);
  assert.equal(bad.length, 1);
  assert.equal(bad[0].kind, 'image');
});
