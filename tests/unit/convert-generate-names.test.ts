import assert from 'node:assert/strict';
import test from 'node:test';
import { componentName, kebabName } from '../../src/convert/generate/names.js';

test('componentName makes unique PascalCase identifiers', () => {
  const t = new Set<string>();
  assert.equal(componentName('Hero + About', t), 'HeroAbout');
  assert.equal(componentName('section-1', t), 'Section1');
  assert.equal(componentName('Chicago ', t), 'Chicago');
  assert.equal(componentName('404 block', t), 'Section404Block');
  assert.equal(componentName('Hero + About', t), 'HeroAbout2');
  assert.equal(componentName('***', t), 'Section');
});

test('componentName handles collisions and successive duplicates', () => {
  const t = new Set<string>();
  assert.equal(componentName('Hero', t), 'Hero');
  assert.equal(componentName('Hero', t), 'Hero2');
  assert.equal(componentName('Hero', t), 'Hero3');
  assert.equal(componentName('***', t), 'Section');
  assert.equal(componentName('***', t), 'Section2');
  assert.equal(componentName('', t), 'Section3');
});

test('Review Focus 2: Section names that are not identifiers produce valid unique identifiers and file slugs', () => {
  const t = new Set<string>();
  const messyNames = [
    'Hero + About',
    'Chicago ',
    'section-1',
    '404 block',
    '1st Section',
    'header & nav/main',
    '  trailing and leading  ',
    '#@!$',
  ];

  for (const name of messyNames) {
    const comp = componentName(name, t);
    const kebab = kebabName(name);

    // Must be a valid JavaScript/TypeScript identifier starting with a letter or underscore
    assert.match(comp, /^[A-Z][a-zA-Z0-9]*$/, `componentName("${name}") -> "${comp}" is not a valid PascalCase identifier`);
    // Must be a valid kebab-case slug for filenames and task ids
    assert.match(kebab, /^[a-z0-9]+(-[a-z0-9]+)*$/, `kebabName("${name}") -> "${kebab}" is not a valid kebab-case slug`);
  }

  // Duplicate names produce unique component names
  const dup1 = componentName('Hero + About', t);
  const dup2 = componentName('Hero + About', t);
  assert.notEqual(dup1, dup2);
  assert.equal(t.has(dup1), true);
  assert.equal(t.has(dup2), true);
});

test('kebabName', () => {
  assert.equal(kebabName('Hero + About'), 'hero-about');
  assert.equal(kebabName('Chicago '), 'chicago');
  assert.equal(kebabName('section-1'), 'section-1');
  assert.equal(kebabName('404 block'), '404-block');
  assert.equal(kebabName('***'), 'section');
  assert.equal(kebabName(''), 'section');
});
