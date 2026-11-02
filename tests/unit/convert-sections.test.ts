import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseNodes } from '../../src/convert/adapters/framer/components.js';
import { pageSections } from '../../src/convert/adapters/framer/sections.js';

const home = readFileSync('tests/fixtures/framer-nudge-mini/index.html', 'utf8');

/** Resolve a `#main > tag:nth-child(n) > ...` path; returns every matching node (should be one). */
function resolve(html: string, selector: string) {
  const nodes = parseNodes(html);
  let level = nodes.filter((n) => n.id === 'main');
  for (const seg of selector.split(' > ').slice(1)) {
    const m = /^([a-z0-9]+):nth-child\((\d+)\)$/.exec(seg)!;
    level = nodes.filter((n) => n.parent && level.includes(n.parent) && n.tag === m[1] && n.index === Number(m[2]));
  }
  return level;
}

test('fixture home sections', () => {
  const s = pageSections(home);
  const names = s.map((x) => x.name);
  assert.ok(s.length >= 5, names.join('|'));
  const at = ['Hero + About', 'Feature Works', 'CTA'].map((n) => names.indexOf(n));
  assert.ok(at.every((i) => i >= 0), names.join('|'));
  assert.deepEqual(at, [...at].sort((a, b) => a - b));
  for (const x of s) assert.equal(resolve(home, x.selector).length, 1, x.selector);
  assert.equal(new Set(names).size, names.length);
});

test('synthetic: descend, expand, fallback, dedupe', () => {
  const html = `<div id="main"><style></style><div><div><div>
    <div><div data-framer-name="A"></div><div data-framer-name="A"></div></div>
    <section></section>
    <div data-framer-name="Named"><i data-framer-name="inner"></i><i></i></div>
    <div><p></p><p></p></div>
  </div></div></div></div>`;
  const s = pageSections(html);
  assert.deepEqual(s.map((x) => x.name), ['A', 'A-2', 'section-3', 'Named', 'section-5']);
  assert.match(s[0]!.selector, /^#main > div:nth-child\(2\) > div:nth-child\(1\) > div:nth-child\(1\) > div:nth-child\(1\) > div:nth-child\(1\)$/);
  for (const x of s) assert.equal(resolve(html, x.selector).length, 1);
  assert.deepEqual(pageSections('<div></div>'), []);
});
