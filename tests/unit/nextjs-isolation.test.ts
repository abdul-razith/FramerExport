import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runNextConversion, runToNextjs } from '../../src/nextjs/index.js';
import { parseNextjsFlags } from '../../src/nextjs/options.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OPTIONS = parseNextjsFlags(['u', '--nextjs']).options;

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'fexport-nextjs-'));
}

test('no existing module statically imports src/nextjs or src/ai-guide', async () => {
  // Both are opt-in features (--nextjs, --ai-guide): the exporter and CLI load them with import().
  const featureDirs = ['nextjs', 'ai-guide'].map((d) => path.join(ROOT, 'src', d));
  const files = (await walk(path.join(ROOT, 'src'))).filter((f) => !featureDirs.some((d) => f.startsWith(d)));
  for (const file of files) {
    const text = await fs.readFile(file, 'utf8');
    assert.doesNotMatch(
      text,
      /^\s*(import|export)\s[^;]*from\s+['"][^'"]*(nextjs|ai-guide)\//m,
      `${path.relative(ROOT, file)} must not statically import src/nextjs or src/ai-guide`
    );
  }
});

test('runNextConversion skips non-framer platforms without throwing', async () => {
  const outDir = await tempDir();
  await runNextConversion(
    { outDir, siteUrl: 'https://example.webflow.io', platform: { name: 'webflow' }, subpages: new Map() },
    OPTIONS
  );
  await assert.rejects(fs.stat(path.join(outDir, 'nextjs')));
});

test('runToNextjs returns 1 and writes nothing when export-report.json is missing', async () => {
  const dir = await tempDir();
  assert.equal(await runToNextjs(dir, OPTIONS), 1);
  assert.deepEqual(await fs.readdir(dir), []);
});

test('runToNextjs returns 1 when export-report.json platform is not framer', async () => {
  const dir = await tempDir();
  await fs.writeFile(
    path.join(dir, 'export-report.json'),
    JSON.stringify({ source: 'https://example.webflow.io', platform: 'webflow' })
  );
  assert.equal(await runToNextjs(dir, OPTIONS), 1);
  assert.deepEqual(await fs.readdir(dir), ['export-report.json']);
});
