import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNodes } from '../../src/convert/adapters/framer/components.js';
import { STABLE_OF, stableNthChild } from '../../src/convert/adapters/framer/selectors.js';
import { isIdentityTransform, ssrAppearCandidates } from '../../src/convert/adapters/framer/ssr-appear.js';
import { referenceKey } from '../../src/convert/stages/verify.js';

test('STABLE_OF excludes exactly the non-visual tags', () => {
  assert.equal(STABLE_OF, ':not(script, style, link, meta, template, noscript)');
});

test('stableNthChild counts only visual element siblings', () => {
  const html =
    '<div id="p"><style></style><script>x<y</script><span></span><link rel="a"><meta name="b">' +
    '<template><b></b></template><noscript><img></noscript><p></p><em></em></div>';
  const nodes = parseNodes(html);
  const by = (tag: string) => nodes.find((n) => n.tag === tag)!;
  assert.equal(stableNthChild(by('span')), `span:nth-child(1 of ${STABLE_OF})`);
  assert.equal(stableNthChild(by('p')), `p:nth-child(2 of ${STABLE_OF})`);
  assert.equal(stableNthChild(by('em')), `em:nth-child(3 of ${STABLE_OF})`);
  // A non-visual node itself can never match the `of` form; it keeps its plain index.
  assert.equal(stableNthChild(by('style')), 'style:nth-child(1)');
});

test('ssrAppearCandidates: inline initial opacity/transform inside #main only', () => {
  const html =
    '<div style="opacity:0"></div>' + // outside #main
    '<div id="main"><style></style><div class="root">' +
    '<div data-framer-name="Hero" style="opacity: 0; transform: translateY(40px)">a</div>' +
    '<div style="opacity:1;transform:none">b</div>' +
    '<div style="opacity:0.001">c</div>' +
    '<div style="transform:translateX(0px) scale(1)">d</div>' +
    '<div style="--x:1;transform:scale(0.9)">e</div>' +
    '<div>f</div>' +
    '</div></div>';
  const c = ssrAppearCandidates(html);
  assert.deepEqual(
    c.map((x) => x.from),
    [{ opacity: '0', transform: 'translateY(40px)' }, { opacity: '0.001' }, { transform: 'scale(0.9)' }]
  );
  assert.equal(c[0]!.name, 'Hero');
  assert.equal(c[0]!.selector, `#main > div:nth-child(1 of ${STABLE_OF}) > div:nth-child(1 of ${STABLE_OF})`);
  assert.equal(c[2]!.selector, `#main > div:nth-child(1 of ${STABLE_OF}) > div:nth-child(5 of ${STABLE_OF})`);
  assert.deepEqual(ssrAppearCandidates('<div style="opacity:0"></div>'), []);
});

test('isIdentityTransform', () => {
  for (const v of ['none', '', 'translateX(0)', 'translate(0px, 0px) scale(1) rotate(0deg)', 'matrix(1, 0, 0, 1, 0, 0)']) {
    assert.equal(isIdentityTransform(v), true, v);
  }
  for (const v of ['translateY(40px)', 'scale(0.9)', 'rotate(5deg)', 'translateX(-50%)', 'perspective(1200px)', 'weird']) {
    assert.equal(isIdentityTransform(v), false, v);
  }
});

test('referenceKey changes when only a section selector changes', () => {
  const a = referenceKey('<html></html>', [{ name: 'Hero', selector: '#main > div:nth-child(2)' }]);
  const b = referenceKey('<html></html>', [{ name: 'Hero', selector: `#main > div:nth-child(1 of ${STABLE_OF})` }]);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b);
  assert.equal(a, referenceKey('<html></html>', [{ name: 'Hero', selector: '#main > div:nth-child(2)' }]));
});
