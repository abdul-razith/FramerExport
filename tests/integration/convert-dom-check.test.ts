import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { extractSectionDom, nextSections } from '../../src/convert/verify/dom-check.js';

let browser: Browser;
let page: Page;
before(async () => {
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  page = await browser.newPage();
});
after(async () => {
  await browser?.close();
});

test('nextSections and extractSectionDom read text, links and images', async () => {
  await page.setContent(`<body>
    <div data-section='Hero "A"'><h1>Hi   there</h1><a href="/about">x</a><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></div>
    <div data-section="Footer"><p>Bye</p><a href="#top">t</a></div>`);
  const sections = await nextSections(page);
  assert.deepEqual(sections.map((s) => s.name), ['Hero "A"', 'Footer']);
  const dom = await extractSectionDom(page, sections);
  assert.equal(dom.length, 2);
  assert.equal(dom[0].text.replace(/\s+/g, ' ').trim(), 'Hi there x');
  assert.deepEqual(dom[0].links, ['/about']);
  assert.equal(dom[0].images.length, 1);
  assert.deepEqual(dom[1].links, ['#top']);
});
