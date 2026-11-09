import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { extractFontFaces, renderFontsCss } from '../../src/nextjs/fonts.js';
import { FIXTURE_ROOT } from '../fixtures/nextjs/serve.js';

const EXPORT = path.join(FIXTURE_ROOT, 'export');
const read = (rel: string) => fs.readFileSync(path.join(EXPORT, rel), 'utf8');

test('extractFontFaces reads @font-face rules from export HTML', () => {
  assert.deepEqual(extractFontFaces(EXPORT, [read('index.html')]), [
    {
      family: 'Inter Display',
      weight: '400',
      style: 'normal',
      unicodeRange: 'U+0000-00FF',
      file: 'Inter-Regular.latin.woff2',
    },
  ]);
});

test('the same face in several pages is returned once', () => {
  assert.equal(extractFontFaces(EXPORT, [read('index.html'), read('subpages/about.html')]).length, 1);
});

test('faces whose file is not in assets/fonts are ignored', () => {
  const html = `<style>@font-face{font-family:"Ghost";src:url(assets/fonts/missing.woff2)}</style>`;
  assert.deepEqual(extractFontFaces(EXPORT, [html]), []);
});

test('renderFontsCss writes grouped local @font-face rules', () => {
  const css = renderFontsCss([
    { family: 'Inter Display', weight: '400', style: 'normal', unicodeRange: 'U+0000-00FF', file: 'Inter-Regular.latin.woff2' },
    { family: 'DM Mono', weight: '500', style: 'italic', file: 'mono.woff' },
  ]);
  assert.match(css, /\/\* Inter Display \*\//);
  assert.match(css, /src: url\('\/fonts\/Inter-Regular\.latin\.woff2'\) format\('woff2'\);/);
  assert.match(css, /unicode-range: U\+0000-00FF;/);
  assert.match(css, /font-display: swap;/);
  assert.match(css, /src: url\('\/fonts\/mono\.woff'\) format\('woff'\);[\s\S]*font-style: italic;/);
  assert.doesNotMatch(css, /framerusercontent/);
});
