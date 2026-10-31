import assert from 'node:assert/strict';
import test from 'node:test';
import { buildConversionSpec, buildSuperpowersInstructions } from '../../src/cli-v2/utils/superpowers-template.js';

test('buildSuperpowersInstructions generates CLAUDE.md and AGENTS.md with Superpowers rules', () => {
  const { claudeMd, agentsMd } = buildSuperpowersInstructions({
    framework: 'nextjs',
    projectDirName: 'converted-nextjs',
    sourceUrl: 'https://example.framer.app',
    platform: 'framer',
    outDir: 'C:\\test-export',
    counts: { 'index.html': 1, 'styles': 3, 'assets/images': 15, 'subpages': 2 }
  });

  assert.ok(claudeMd.includes('superpowers:writing-plans'));
  assert.ok(claudeMd.includes('superpowers:verification-before-completion'));
  assert.ok(claudeMd.includes('converted-nextjs'));
  assert.ok(agentsMd.includes('CONVERSION_SPEC.md'));
  assert.ok(agentsMd.includes('npm run build'));
});

test('buildConversionSpec details directory structure and files to convert', () => {
  const spec = buildConversionSpec({
    framework: 'react-vite',
    projectDirName: 'converted-react-vite',
    sourceUrl: 'https://example.framer.app',
    platform: 'framer',
    outDir: 'C:\\test-export',
    counts: { 'index.html': 1, 'styles': 2, 'assets/images': 5, 'subpages': 0 }
  });

  assert.ok(spec.includes('converted-react-vite'));
  assert.ok(spec.includes('React 18/19, TypeScript, Vite'));
  assert.ok(spec.includes('index.html'));
  assert.ok(spec.includes('public/assets'));
});
