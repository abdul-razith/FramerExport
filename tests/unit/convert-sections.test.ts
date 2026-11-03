import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseNodes } from '../../src/convert/adapters/framer/components.js';
import { STABLE_OF } from '../../src/convert/adapters/framer/selectors.js';
import { pageSections } from '../../src/convert/adapters/framer/sections.js';

const home = readFileSync('tests/fixtures/framer-nudge-mini/index.html', 'utf8');

const NON_VISUAL = ['script', 'style', 'link', 'meta', 'template', 'noscript'];

/**
 * Resolve a `#main > tag:nth-child(k of :not(script, style, ...)) > ...` path, counting k independently of
 * the parser's indices; returns every matching node (should be one).
 */
function resolve(html: string, selector: string) {
  const nodes = parseNodes(html);
  let level = nodes.filter((n) => n.id === 'main');
  for (const seg of selector.split(' > ').slice(1)) {
    const m = /^([a-z0-9]+):nth-child\((\d+) of (.+)\)$/.exec(seg);
    assert.ok(m, `segment uses the stable of-form: ${seg}`);
    assert.equal(m[3], STABLE_OF);
    level = nodes.filter((n) => {
      if (!n.parent || !level.includes(n.parent) || n.tag !== m[1]) return false;
      const visual = nodes.filter((s) => s.parent === n.parent && !NON_VISUAL.includes(s.tag));
      return visual.indexOf(n) + 1 === Number(m[2]);
    });
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
  const k = (n: number) => `div:nth-child(${n} of ${STABLE_OF})`;
  // The leading <style> of #main is not counted: hydration removes it.
  assert.equal(s[0]!.selector, ['#main', k(1), k(1), k(1), k(1), k(1)].join(' > '));
  assert.equal(s[3]!.selector, ['#main', k(1), k(1), k(1), k(3)].join(' > '));
  for (const x of s) assert.equal(resolve(html, x.selector).length, 1);
  assert.deepEqual(pageSections('<div></div>'), []);
});
