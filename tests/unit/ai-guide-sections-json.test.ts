import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sectionsJson } from '../../src/ai-guide/sections-json.js';
import type { GuidePage, GuideSection } from '../../src/ai-guide/types.js';

const box = (y: number, h: number) => ({ x: 0, y, w: 1440, h });
function section(id: string, name: string, y: number): GuideSection {
  return {
    index: 1, id, name, generic: false, key: 'k' + id, boxes: { base: box(y, 100), tablet: box(y, 120), mobile: box(y, 150) },
    texts: [], images: [], links: [], motionKeys: [], widthsOf: {}, generated: [], liveKeys: [], decorations: [],
  };
}

test('sections.json lists shell and page sections per width, with live boxes', () => {
  const page: GuidePage = {
    route: '/', slug: 'index', title: 'Home', exportFile: 'index.html',
    sections: [section('01', 'Hero', 56), section('02', 'Works', 900)],
    shell: [{ ...section('S1', 'Header', 0), shell: true }],
  };
  const json = sectionsJson([page], (route, id) => (id === '01' ? { '1440': [{ x: 10, y: 60, w: 80, h: 20 }] } : {}));
  assert.deepEqual(json['/'].sections.map((s) => s.id), ['S1', '01', '02']);
  assert.equal(json['/'].slug, 'index');
  assert.deepEqual(Object.keys(json['/'].sections[1].boxes).sort(), ['1024', '1440', '390']);
  assert.deepEqual(json['/'].sections[1].boxes['1024'], box(56, 120));
  assert.deepEqual(json['/'].sections[1].live['1440'], [{ x: 10, y: 60, w: 80, h: 20 }]);
  assert.deepEqual(json['/'].sections[2].live, {});
});

test('sections.json says how many animations each section is expected to have', () => {
  const page: GuidePage = {
    route: '/', slug: 'index', title: 'Home', exportFile: 'index.html',
    sections: [{ ...section('01', 'Hero', 56), motion: ['Name enter', 'Badge loop'] }, section('02', 'Works', 900)],
  };
  const json = sectionsJson([page], () => ({}));
  assert.equal(json['/'].sections[0].motion, 2);
  assert.equal(json['/'].sections[1].motion, 0);
});
