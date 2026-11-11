import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildFixtureV2 } from '../fixtures/ai-guide/build-fixture.js';

test('ai-guide fixture v2 has the parts later tasks rely on', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aiguide-fixture-'));
  await buildFixtureV2(dir);
  const index = await fs.readFile(path.join(dir, 'export/index.html'), 'utf8');
  for (const s of ['ssr-variant hidden-d1', 'ssr-variant hidden-m1', 'framer-works', 'framer-faq-q']) assert.ok(index.includes(s), s);
  await fs.access(path.join(dir, 'export/subpages/services.html'));
  const mod = await fs.readFile(path.join(dir, 'export/scripts/vendor/page.Abc123.mjs'), 'utf8');
  assert.ok(mod.includes('__framer__enter: En'));
  assert.ok(mod.includes('GMT: 0'));
  const report = JSON.parse(await fs.readFile(path.join(dir, 'export/export-report.json'), 'utf8'));
  assert.equal(report.platform, 'framer');
});
