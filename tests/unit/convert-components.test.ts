import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { buildSlice, countMatches, findComponents } from '../../src/convert/adapters/framer/components.js';
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

test('component names are meaningful, not variant labels', () => {
  const names = findComponents(pages).map((c) => c.name);
  const bad = names.filter((n) => /^(Default|Desktop|Tablet|Mobile|Variant|Active|Current|Name|Number)\d*$/.test(n));
  assert.deepEqual(bad, []);
  assert.ok(names.some((n) => /DarkButton/.test(n)), names.join(', '));
});

test('each selector matches exactly one element in the first page and slices stay small', () => {
  const comps = findComponents(pages);
  assert.ok(comps.length > 0);
  for (const c of comps) {
    const page = pages.find((p) => p.route === c.pages[0])!;
    assert.equal(countMatches(page.html, c.selector), 1, `${c.name}: ${c.selector}`);
    const slice = buildSlice(page.html, c.selector);
    assert.ok(slice.length > 0, c.name);
    assert.ok(slice.length <= 30 * 1024, `${c.name} slice is ${slice.length} bytes`);
  }
});

test('buildSlice keeps the element text and only its CSS', () => {
  const comps = findComponents(pages);
  const button = comps.find((c) => /DarkButton/.test(c.name))!;
  const page = pages.find((p) => p.route === button.pages[0])!;
  const slice = buildSlice(page.html, button.selector);
  const markup = slice.slice(0, slice.indexOf('<style>'));
  const text = [...markup.matchAll(/>([^<>]*[A-Za-z][^<>]*)</g)].map((m) => m[1]!.trim())[0];
  assert.ok(text, 'DarkButton slice has text');
  assert.ok(slice.includes(text));
  const css = slice.slice(slice.indexOf('<style>'));
  assert.ok(/\{[^}]+\}/.test(css));
  assert.ok(cssSize(slice) < cssSize(page.html) / 2);
});

const synth = (body: string) =>
  '<style data-framer-components="framer-AbCd1">.framer-AbCd1{color:red}</style><div id="main">' + body + '</div>';

test('variants sharing a base class form one component', () => {
  const html = synth(
    '<div class="framer-AbCd1 framer-v-aaa" data-framer-name="Desktop"><p>Hi</p></div>' +
      '<div class="framer-AbCd1 framer-v-bbb" data-framer-name="Mobile"><p>Yo</p></div>'
  );
  const comps = findComponents([{ route: '/', html }]);
  assert.equal(comps.length, 1);
  assert.deepEqual(comps[0]!.variants, ['Desktop', 'Mobile']);
  assert.equal(countMatches(html, comps[0]!.selector), 1);
});

test('a variant-labelled root is named after its parent', () => {
  const html = synth(
    '<section data-framer-name="Pricing Card"><div class="framer-AbCd1" data-framer-name="Default"><p>Hi</p></div></section>'
  );
  assert.equal(findComponents([{ route: '/', html }])[0]!.name, 'PricingCard');
});

test('a root with no meaningful ancestor is named after a descendant', () => {
  const html = synth('<div class="framer-AbCd1" data-framer-name="Default"><p data-framer-name="Price">$5</p></div>');
  assert.equal(findComponents([{ route: '/', html }])[0]!.name, 'Price');
});

test('buildSlice returns empty string when selector matches nothing', () => {
  assert.equal(buildSlice('<div></div>', '.nope'), '');
});
