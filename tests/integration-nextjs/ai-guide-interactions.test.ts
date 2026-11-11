import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer, { type Browser } from 'puppeteer';
import { serveFixture } from '../fixtures/nextjs/serve.js';
import { FIXTURE_V2 } from '../fixtures/ai-guide/build-fixture.js';
import { recordInteractions } from '../../src/ai-guide/interactions.js';

let server: { url: string; close(): Promise<void> };
let browser: Browser;

before(async () => {
  server = await serveFixture(path.join(FIXTURE_V2, 'site'));
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

test('records the FAQ click and the CTA hover without following links', { timeout: 120000 }, async () => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'aiguide-states-'));
  const states = await recordInteractions(
    browser,
    server.url + '/',
    [
      { id: '03', selectorClasses: ['framer-faq'], hoverClasses: [] },
      { id: '04', selectorClasses: ['framer-cta'], hoverClasses: ['framer-cta-btn'] },
      { id: '05', selectorClasses: ['framer-form'], hoverClasses: [] },
    ],
    out,
    1440
  );
  const click = states.find((s) => s.action === 'click');
  const hover = states.find((s) => s.action === 'hover');
  assert.equal(click?.section, '03');
  assert.equal(click?.element, 'question');
  assert.equal(hover?.section, '04');
  assert.equal(hover?.element, 'say-hi');
  for (const s of states) {
    assert.ok(existsSync(path.join(out, s.before)) && existsSync(path.join(out, s.after)));
    assert.match(s.before, /^states\//);
  }
  assert.ok(!states.some((s) => s.element === 'contact' && s.action === 'click'), 'links are never clicked');
  assert.ok(states.some((s) => s.element === 'contact' && s.action === 'hover'), 'hover effects on links are recorded');
  assert.ok(!states.some((s) => s.section === '05'), 'form submit buttons are never clicked');
});
