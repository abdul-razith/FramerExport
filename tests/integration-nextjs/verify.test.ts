import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { serveFixture, FIXTURE_ROOT } from '../fixtures/nextjs/serve.js';
import { settlePage } from '../../src/nextjs/capture.js';
import { verifyProject } from '../../src/nextjs/verify.js';
import { emptyReport } from '../../src/nextjs/report.js';
import { CAPTURE_WIDTHS, type Breakpoint, type ConversionContext } from '../../src/nextjs/model.js';

test('verifyProject builds a Next project and scores it against reference screenshots', { skip: !!process.env.CI_OFFLINE, timeout: 600000 }, async () => {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'fexport-verify-'));
  const nextDir = path.join(work, 'next');
  await fs.cp(path.join(FIXTURE_ROOT, 'mini-next'), nextDir, { recursive: true });

  const server = await serveFixture(nextDir);
  const screenshots = {} as Record<Breakpoint, string>;
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument('globalThis.__name = (fn) => fn;');
    for (const bp of ['base', 'tablet', 'mobile'] as const) {
      await page.setViewport({ width: CAPTURE_WIDTHS[bp], height: 900 });
      await page.goto(server.url + '/static.html', { waitUntil: 'networkidle2' });
      await settlePage(page);
      screenshots[bp] = path.join(work, `ref-${bp}.png`);
      await page.screenshot({ path: screenshots[bp] as `${string}.png`, fullPage: true });
    }
  } finally {
    await browser.close();
    await server.close();
  }

  const ctx: ConversionContext = {
    exportDir: work,
    sourceUrl: 'http://example.test/',
    outDir: nextDir,
    cacheDir: path.join(work, 'cache'),
    options: { aiRefine: false, verify: true, cliSkipPermissions: true },
    report: emptyReport(),
    log: () => {},
  };
  await verifyProject(nextDir, [{ route: '/', screenshots }], ctx);
  assert.equal(ctx.report.build?.ok, true, ctx.report.build?.output);
  assert.equal(ctx.report.similarity.length, 3);
  for (const s of ctx.report.similarity) assert.ok(s.score >= 0.97, `${s.width}px scored ${s.score}`);
});
