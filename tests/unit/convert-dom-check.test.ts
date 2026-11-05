import assert from 'node:assert/strict';
import test from 'node:test';
import { compareDom, normalizeLink, type SectionDom } from '../../src/convert/verify/dom-check.js';

test('normalizeLink drops origin, query, fragment, ./ prefixes, .html and trailing slashes', () => {
  assert.equal(normalizeLink('./'), '/');
  assert.equal(normalizeLink('./case-study/x'), '/case-study/x');
  assert.equal(normalizeLink('http://127.0.0.1:5/about.html?a#b'), '/about');
  assert.equal(normalizeLink(''), '/');
  assert.equal(normalizeLink('/'), '/');
  assert.equal(normalizeLink('/about'), '/about');
  assert.equal(normalizeLink('/about/'), '/about');
  assert.equal(normalizeLink('./about/'), '/about');
  assert.equal(normalizeLink('http://127.0.0.1:5'), '/');
  assert.equal(normalizeLink('http://127.0.0.1:5/'), '/');
  assert.equal(normalizeLink('http://localhost:3000/contact.html'), '/contact');
});

test('compareDom normalizes links on both sides before comparing', () => {
  const maps = { routes: {}, images: {} };
  const sec = (links: string[]): SectionDom[] => [{ name: 'Hero', text: 'hi', links, images: [] }];

  // Links that differ in relative prefix, origin, query or .html match after normalizeLink
  const ok = compareDom(
    sec(['./case-study/x', 'http://127.0.0.1:5/about.html?a#b', './']),
    sec(['/case-study/x', '/about', '/']),
    maps
  );
  assert.deepEqual(ok, []);

  // Truly differing links still produce a mismatch
  const bad = compareDom(sec(['/about']), sec(['/contact']), maps);
  assert.equal(bad.length, 1);
  assert.equal(bad[0].kind, 'link');
  assert.equal(bad[0].expected, '/about');
  assert.equal(bad[0].actual, '/contact');
});
