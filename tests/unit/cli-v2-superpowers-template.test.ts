import assert from 'node:assert/strict';
import test from 'node:test';
import { buildConversionSpec, buildSuperpowersInstructions, buildLauncherScripts } from '../../src/cli-v2/utils/superpowers-template.js';

test('buildLauncherScripts generates .cmd and .sh with agent commands and directory resolution', () => {
  const { cmdScript, shScript } = buildLauncherScripts('agy -i "Read CONVERSION_SPEC.md"', 'agy', 'Next.js 16 App Router');
  assert.ok(cmdScript.includes('@echo off'));
  assert.ok(cmdScript.includes('%~dp0'));
  assert.ok(cmdScript.includes('agy -i "Read CONVERSION_SPEC.md"'));
  assert.ok(cmdScript.includes('cmd.exe /k'));

  assert.ok(shScript.includes('#!/usr/bin/env bash'));
  assert.ok(shScript.includes('dirname "$0"'));
  assert.ok(shScript.includes('agy -i "Read CONVERSION_SPEC.md"'));
});

test('buildSuperpowersInstructions mandates Task 1 Analysis, SSR zero-opacity clean-up, and autonomous directives', () => {
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
  assert.ok(claudeMd.includes('unattended') || claudeMd.includes('autonomous'));
  assert.ok(claudeMd.includes('Native') || claudeMd.includes('native'));
  assert.ok(claudeMd.includes('DOM') || claudeMd.includes('framer-motion'));

  // Must mandate Task 1 as Pre-Conversion Source & Dependency Analysis
  assert.ok(claudeMd.includes('Task 1: Pre-Conversion Source & Dependency Analysis'));
  assert.ok(claudeMd.includes('scripts/vendor'));
  assert.ok(claudeMd.includes('npm install'));

  // Must mandate SSR zero-opacity keyframe resolution & SVG templates
  assert.ok(claudeMd.includes('opacity: 0.001'));
  assert.ok(claudeMd.includes('svg-templates'));

  assert.ok(agentsMd.includes('CONVERSION_SPEC.md'));
  assert.ok(agentsMd.includes('npm run build'));
  assert.ok(agentsMd.includes('Task 1: Pre-Conversion Source & Dependency Analysis'));
  assert.ok(agentsMd.includes('opacity: 0.001'));
  assert.ok(agentsMd.includes('svg-templates'));
});

test('buildConversionSpec details directory structure, architectural context, and DOM preservation', () => {
  const spec = buildConversionSpec({
    framework: 'nextjs',
    projectDirName: 'converted-nextjs',
    sourceUrl: 'https://example.framer.app',
    platform: 'framer',
    outDir: 'C:\\test-export',
    counts: { 'index.html': 1, 'styles': 2, 'assets/images': 5, 'subpages': 0 }
  });

  assert.ok(spec.includes('converted-nextjs'));
  assert.ok(spec.includes('index.html'));
  assert.ok(spec.includes('public/assets'));
  assert.ok(spec.includes('DOM') || spec.includes('framer-motion'));
  assert.ok(spec.includes('scripts/vendor'));
  assert.ok(spec.includes('Dependency Analysis'));

  // Must include modern Next.js 16 context
  assert.ok(spec.includes('Next.js 16'));
  assert.ok(spec.includes('Turbopack'));
  assert.ok(spec.includes('Async Request APIs') || spec.includes('await params'));
});
