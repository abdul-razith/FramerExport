import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { buildSlice, findComponents } from '../../src/convert/adapters/framer/components.js';
import { routeFromSubpageFile } from '../../src/convert/adapters/framer/routes.js';

const fixture = path.resolve('tests/fixtures/framer-nudge-mini');
const files = ['index.html', ...readdirSync(path.join(fixture, 'subpages')).sort().map((f) => `subpages/${f}`)];
const pages = files.map((f) => ({
  route: routeFromSubpageFile(f),
  html: readFileSync(path.join(fixture, f), 'utf8')
}));

function cssSize(html: string): number {
  let n = 0;
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) n += m[1]!.length;
  return n;
}

test('findComponents detects buttons and returns well-formed infos', () => {
  const comps = findComponents(pages);
  assert.ok(comps.some((c) => /Button/.test(c.name)), comps.map((c) => c.name).join(', '));
  assert.equal(new Set(comps.map((c) => c.name)).size, comps.length);
  for (const c of comps) {
    assert.ok(c.pages.length >= 1);
    assert.match(c.name, /^[A-Za-z][A-Za-z0-9]*$/);
    assert.equal(c.slice, `.convert/analysis/slices/${c.name}.html`);
  }
});

test('findComponents works on a tiny synthetic page', () => {
  const html =
    '<style data-framer-components="framer-AbCd1">.framer-AbCd1{color:red}</style>' +
    '<div id="main"><div class="framer-AbCd1" data-framer-name="Desktop"><p>Hi</p></div>' +
    '<div class="framer-AbCd1" data-framer-name="Mobile"><p>Yo</p></div></div>';
  const comps = findComponents([{ route: '/', html }]);
  assert.equal(comps.length, 1);
  assert.deepEqual(comps[0]!.variants, ['Desktop', 'Mobile']);
  assert.deepEqual(comps[0]!.pages, ['/']);
});

test('buildSlice returns the element with only its CSS, smaller than half the page CSS', () => {
  const comps = findComponents(pages);
  const button = comps.find((c) => /Button/.test(c.name))!;
  const page = pages.find((p) => p.route === button.pages[0])!;
  const slice = buildSlice(page.html, button.selector);
  assert.ok(slice.includes('<style>'));
  assert.ok(/\{[^}]+\}/.test(slice.slice(slice.indexOf('<style>'))));
  assert.ok(cssSize(slice) < cssSize(page.html) / 2);
  const text = />([^<>]*[A-Za-z][^<>]*)</.exec(slice.slice(0, slice.indexOf('<style>')) || slice);
  if (text) assert.ok(slice.includes(text[1]!.trim()));
});

test('buildSlice returns empty string when selector matches nothing', () => {
  assert.equal(buildSlice('<div></div>', '.nope'), '');
});
