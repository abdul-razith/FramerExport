import assert from 'node:assert/strict';
import test from 'node:test';
import { PNG } from 'pngjs';
import { captureFilmstrip } from '../../src/convert/verify/filmstrip.js';
import { renderReportHtml } from '../../src/convert/verify/report-html.js';
import { dynamicMask, maskedRatio, type ReportData } from '../../src/convert/verify/report.js';

function createSolidPng(width: number, height: number, r = 255, g = 255, b = 255, a = 255): PNG {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = a;
    }
  }
  return png;
}

function fillBlock(png: PNG, x0: number, y0: number, w: number, h: number, r = 0, g = 0, b = 0): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const idx = (y * png.width + x) * 4;
      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
    }
  }
}

test('dynamicMask of two PNGs differing in one 10x10 block masks exactly 100 pixels', () => {
  const a = createSolidPng(50, 50, 255, 255, 255);
  const b = createSolidPng(50, 50, 255, 255, 255);
  // Differ in a 10x10 block at (10, 10)
  fillBlock(b, 10, 10, 10, 10, 0, 0, 0);

  const mask = dynamicMask(a, b);
  assert.equal(mask.length, 50 * 50);

  let ones = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 1) ones++;
  }
  assert.equal(ones, 100);

  // Check that the masked pixels are at the block coordinates
  for (let y = 0; y < 50; y++) {
    for (let x = 0; x < 50; x++) {
      const inBlock = x >= 10 && x < 20 && y >= 10 && y < 20;
      assert.equal(mask[y * 50 + x], inBlock ? 1 : 0);
    }
  }
});

test('dynamicMask handles differing dimensions with padding', () => {
  const a = createSolidPng(30, 40, 255, 255, 255);
  const b = createSolidPng(50, 60, 255, 255, 255);
  const mask = dynamicMask(a, b);
  assert.equal(mask.length, 50 * 60);

  // Pixels within (30x40) are identical (white) -> mask 0
  // Pixels outside (x >= 30 or y >= 40) are out of bounds for a -> mask 1
  for (let y = 0; y < 60; y++) {
    for (let x = 0; x < 50; x++) {
      const insideBoth = x < 30 && y < 40;
      assert.equal(mask[y * 50 + x], insideBoth ? 0 : 1);
    }
  }
});

test('maskedRatio ignores masked pixels and reports zero diff', () => {
  const expected = createSolidPng(50, 50, 255, 255, 255);
  const actual = createSolidPng(50, 50, 255, 255, 255);
  fillBlock(actual, 10, 10, 10, 10, 0, 0, 0);

  const mask = dynamicMask(expected, actual);
  const ratio = maskedRatio(expected, actual, mask);
  assert.equal(ratio, 0);
});

test('maskedRatio counts unmasked diff pixels excluding masked from numerator and denominator', () => {
  const expected = createSolidPng(50, 50, 255, 255, 255);
  const actual = createSolidPng(50, 50, 255, 255, 255);
  // 10x10 masked block
  fillBlock(actual, 10, 10, 10, 10, 0, 0, 0);
  const mask = dynamicMask(expected, actual);

  // Add 20 differing pixels outside the mask (spaced apart to avoid AA detection)
  for (let i = 0; i < 20; i++) {
    const x = 30 + (i % 10);
    const y = 30 + Math.floor(i / 10) * 5;
    const idx = (y * 50 + x) * 4;
    actual.data[idx] = 10;
    actual.data[idx + 1] = 10;
    actual.data[idx + 2] = 10;
  }

  const ratio = maskedRatio(expected, actual, mask);
  // Denominator is 2500 - 100 = 2400
  // Numerator is 20
  const expectedRatio = 20 / 2400;
  assert.ok(Math.abs(ratio - expectedRatio) < 1e-6, `ratio ${ratio} should match ${expectedRatio}`);
});

test('maskedRatio accurately handles mask stride when expected and actual sizes differ', () => {
  const expected = createSolidPng(40, 40, 255, 255, 255);
  const expected2 = createSolidPng(40, 40, 255, 255, 255);
  // In expected2, 10x10 block at (10, 10) is dynamic
  fillBlock(expected2, 10, 10, 10, 10, 0, 0, 0);

  const mask = dynamicMask(expected, expected2);
  assert.equal(mask.width, 40);
  assert.equal(mask.height, 40);

  // actual is 50x50 white, with the same dynamic 10x10 block at (10, 10)
  const actual = createSolidPng(50, 50, 255, 255, 255);
  fillBlock(actual, 10, 10, 10, 10, 0, 0, 0);

  // When comparing expected (padded to 50x50 white) with actual (50x50 white with block at 10, 10):
  // The block at (10, 10) must be masked out by the re-strided mask!
  const ratio = maskedRatio(expected, actual, mask);
  assert.equal(ratio, 0);
});

test('renderReportHtml escapes <b> in section name and lists needsReview ids', () => {
  const data: ReportData = {
    generatedAt: '2026-11-05T12:00:00.000Z',
    totalMs: 4200,
    pages: [
      {
        route: '/about',
        sections: [
          {
            name: '<b>Header & Hero</b>',
            widths: [
              {
                width: 1440,
                ratio: 0.002,
                pass: true,
                images: {
                  original: 'images/about-header-1440-original.png',
                  next: 'images/about-header-1440-next.png',
                  diff: 'images/about-header-1440-diff.png'
                }
              }
            ]
          }
        ],
        filmstrip: {
          original: ['images/about-filmstrip-orig-0.png'],
          next: ['images/about-filmstrip-next-0.png']
        }
      }
    ],
    needsReview: ['sec-pricing-cards', '102-page-contact'],
    stubs: ['CustomMapStub', 'VideoPlayerStub']
  };

  const html = renderReportHtml(data);
  // Section name must be escaped, not rendered as raw HTML
  assert.match(html, /&lt;b&gt;Header &amp; Hero&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>Header & Hero<\/b>/);

  // Must list needsReview ids
  assert.match(html, /sec-pricing-cards/);
  assert.match(html, /102-page-contact/);

  // Must list stubs
  assert.match(html, /CustomMapStub/);
  assert.match(html, /VideoPlayerStub/);

  // Must include route and images
  assert.match(html, /\/about/);
  assert.match(html, /images\/about-header-1440-original\.png/);
  assert.match(html, /images\/about-header-1440-next\.png/);
  assert.match(html, /images\/about-header-1440-diff\.png/);
  assert.match(html, /images\/about-filmstrip-orig-0\.png/);
  assert.match(html, /images\/about-filmstrip-next-0\.png/);
});
