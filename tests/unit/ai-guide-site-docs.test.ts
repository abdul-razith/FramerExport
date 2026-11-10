import assert from 'node:assert/strict';
import test from 'node:test';
import { renderContentMd, renderFilesMd, renderSiteMd, renderTokensMd } from '../../src/ai-guide/site-docs.js';
import { fixtureSite } from './ai-guide-fixture.js';

test('site.md lists every route with its export file, nav, footer and the collection pages', () => {
  const md = renderSiteMd(fixtureSite());
  assert.match(md, /\| \/about \| About - Nudge \| subpages\/about\.html \|/);
  assert.match(md, /## Navigation\n- Home → \/\n- About → \/about/);
  assert.match(md, /\/blog \| list page of collection "blog"/);
  assert.match(md, /Breakpoints: desktop ≥ 1200px, tablet 810–1199px, mobile ≤ 809px/);
});

test('files.md maps images to the sections that use them and marks the Framer runtime as do-not-copy', () => {
  const md = renderFilesMd(fixtureSite());
  assert.match(md, /assets\/images\/hero\.png → \/images\/hero-image\.png .*used in: \/ › Hero Section/);
  assert.match(md, /`scripts\/`.*Framer runtime — do not copy/);
  assert.match(md, /Inter-Regular\.latin\.woff2 \| Inter Display \| 400 \| normal/);
});

test('content.md describes each collection with items and a front matter shape', () => {
  const md = renderContentMd(fixtureSite());
  assert.match(md, /## Collection "blog"\nList page: \/blog · Detail pages: \/blog\/\[slug\]/);
  assert.match(md, /\| post-a \| The Power of Focus \| 2025-03-12 \|/);
  assert.match(md, /```yaml\ntitle: string\ndate: string\ncover: string\n```/);
});

test('content.md says so when the site has no collections', () => {
  assert.match(renderContentMd({ ...fixtureSite(), collections: [] }), /No CMS collections were detected/);
});

test('tokens.md lists colours with names and values', () => {
  assert.match(renderTokensMd(fixtureSite()), /\| green-900 \| #133324 \|/);
});
