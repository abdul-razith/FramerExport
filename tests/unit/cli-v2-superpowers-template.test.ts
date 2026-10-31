import assert from 'node:assert/strict';
import test from 'node:test';
import { buildConversionSpec, buildSuperpowersInstructions, buildLauncherScripts } from '../../src/cli-v2/utils/superpowers-template.js';

test('buildLauncherScripts generates .cmd and .sh with agent commands and directory resolution', () => {
  const { cmdScript, shScript } = buildLauncherScripts('agy -i "Read CONVERSION_SPEC.md"', 'agy', 'Next.js App Router');
  assert.ok(cmdScript.includes('@echo off'));
  assert.ok(cmdScript.includes('%~dp0'));
  assert.ok(cmdScript.includes('agy -i "Read CONVERSION_SPEC.md"'));
  assert.ok(cmdScript.includes('cmd.exe /k'));

  assert.ok(shScript.includes('#!/usr/bin/env bash'));
  assert.ok(shScript.includes('dirname "$0"'));
  assert.ok(shScript.includes('agy -i "Read CONVERSION_SPEC.md"'));
});

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
