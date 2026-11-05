import assert from 'node:assert/strict';
import test from 'node:test';
import {
  diffScriptDrawn,
  getParentKey,
  VISIBLE_ITEMS_SRC,
  type ScriptDrawn,
  type VisibleItem,
} from '../../src/convert/generate/script-drawn.js';

test('ruler (0, 100, 200 live only, same parent) -> one entry count 3, sample 0 100 200, ticking false', () => {
  const live: VisibleItem[] = [
    {
      section: 'Hero',
      key: 'div.ruler > span:nth-child(1)',
      text: '0',
      box: { x: 0, y: 10, width: 20, height: 15 },
    },
    {
      section: 'Hero',
      key: 'div.ruler > span:nth-child(2)',
      text: '100',
      box: { x: 100, y: 10, width: 30, height: 15 },
    },
    {
      section: 'Hero',
      key: 'div.ruler > span:nth-child(3)',
      text: '200',
      box: { x: 200, y: 10, width: 30, height: 15 },
    },
  ];

  const still: VisibleItem[] = [];
  const liveLater: VisibleItem[] = [
    {
      section: 'Hero',
      key: 'div.ruler > span:nth-child(1)',
      text: '0',
      box: { x: 0, y: 10, width: 20, height: 15 },
    },
    {
      section: 'Hero',
      key: 'div.ruler > span:nth-child(2)',
      text: '100',
      box: { x: 100, y: 10, width: 30, height: 15 },
    },
    {
      section: 'Hero',
      key: 'div.ruler > span:nth-child(3)',
      text: '200',
      box: { x: 200, y: 10, width: 30, height: 15 },
    },
  ];

  const res = diffScriptDrawn('/', live, still, liveLater);
  assert.equal(res.length, 1);
  assert.deepEqual(res[0], {
    id: 's1',
    route: '/',
    section: 'Hero',
    box: { x: 0, y: 10, width: 230, height: 15 },
    sample: '0 100 200',
    count: 3,
    ticking: false,
  });
});

test('clock 4:09:56 AM live, 4:09:58 AM later -> ticking true', () => {
  const live: VisibleItem[] = [
    {
      section: 'Header',
      key: 'header > div.clock > span',
      text: '4:09:56 AM',
      box: { x: 50, y: 20, width: 80, height: 24 },
    },
  ];

  const still: VisibleItem[] = [];
  const liveLater: VisibleItem[] = [
    {
      section: 'Header',
      key: 'header > div.clock > span',
      text: '4:09:58 AM',
      box: { x: 50, y: 20, width: 80, height: 24 },
    },
  ];

  const res = diffScriptDrawn('/dashboard', live, still, liveLater);
  assert.equal(res.length, 1);
  assert.deepEqual(res[0], {
    id: 's1',
    route: '/dashboard',
    section: 'Header',
    box: { x: 50, y: 20, width: 80, height: 24 },
    sample: '4:09:56 AM',
    count: 1,
    ticking: true,
  });
});

test('text present in both live and still -> no entry', () => {
  const live: VisibleItem[] = [
    {
      section: 'Hero',
      key: 'div > h1',
      text: 'Welcome to our platform',
      box: { x: 10, y: 20, width: 300, height: 40 },
    },
    {
      section: 'Hero',
      key: 'div > p',
      text: 'Get started now',
      box: { x: 10, y: 70, width: 200, height: 20 },
    },
  ];

  const still: VisibleItem[] = [
    {
      section: 'Hero',
      key: 'div > h1',
      text: 'Welcome to our platform',
      box: { x: 10, y: 20, width: 300, height: 40 },
    },
    {
      section: 'Hero',
      key: 'div > p',
      text: 'Get started now',
      box: { x: 10, y: 70, width: 200, height: 20 },
    },
  ];

  const liveLater: VisibleItem[] = live;

  const res = diffScriptDrawn('/', live, still, liveLater);
  assert.deepEqual(res, []);
});

test('multiple groups across parents and sections assign sequential ids s1, s2 in document order', () => {
  const live: VisibleItem[] = [
    // Group 1: Section Hero, parent div.canvas-a
    {
      section: 'Hero',
      key: 'div.canvas-a > span:nth-child(1)',
      text: 'Point A',
      box: { x: 10, y: 10, width: 40, height: 20 },
    },
    {
      section: 'Hero',
      key: 'div.canvas-a > span:nth-child(2)',
      text: 'Point B',
      box: { x: 60, y: 10, width: 40, height: 20 },
    },
    // Static item in Hero (present in still)
    {
      section: 'Hero',
      key: 'div.static > p',
      text: 'Static description',
      box: { x: 0, y: 100, width: 100, height: 20 },
    },
    // Group 2: Section Hero, parent div.canvas-b
    {
      section: 'Hero',
      key: 'div.canvas-b > span:nth-child(1)',
      text: 'Chart 1',
      box: { x: 0, y: 200, width: 50, height: 30 },
    },
    // Group 3: Section Footer, parent footer.stats
    {
      section: 'Footer',
      key: 'footer.stats > div.online > span',
      text: 'Users online: 42',
      box: { x: 10, y: 500, width: 120, height: 20 },
    },
  ];

  const still: VisibleItem[] = [
    {
      section: 'Hero',
      key: 'div.static > p',
      text: 'Static description',
      box: { x: 0, y: 100, width: 100, height: 20 },
    },
  ];

  const liveLater: VisibleItem[] = [
    {
      section: 'Hero',
      key: 'div.canvas-a > span:nth-child(1)',
      text: 'Point A',
      box: { x: 10, y: 10, width: 40, height: 20 },
    },
    {
      section: 'Hero',
      key: 'div.canvas-a > span:nth-child(2)',
      text: 'Point B',
      box: { x: 60, y: 10, width: 40, height: 20 },
    },
    {
      section: 'Hero',
      key: 'div.canvas-b > span:nth-child(1)',
      text: 'Chart 1',
      box: { x: 0, y: 200, width: 50, height: 30 },
    },
    {
      section: 'Footer',
      key: 'footer.stats > div.online > span',
      text: 'Users online: 45', // changed!
      box: { x: 10, y: 500, width: 120, height: 20 },
    },
  ];

  const res = diffScriptDrawn('/', live, still, liveLater);
  assert.equal(res.length, 3);

  assert.equal(res[0].id, 's1');
  assert.equal(res[0].section, 'Hero');
  assert.equal(res[0].sample, 'Point A Point B');
  assert.equal(res[0].count, 2);
  assert.equal(res[0].ticking, false);
  assert.deepEqual(res[0].box, { x: 10, y: 10, width: 90, height: 20 });

  assert.equal(res[1].id, 's2');
  assert.equal(res[1].section, 'Hero');
  assert.equal(res[1].sample, 'Chart 1');
  assert.equal(res[1].count, 1);
  assert.equal(res[1].ticking, false);

  assert.equal(res[2].id, 's3');
  assert.equal(res[2].section, 'Footer');
  assert.equal(res[2].sample, 'Users online: 42');
  assert.equal(res[2].count, 1);
  assert.equal(res[2].ticking, true);
});

test('sample is truncated to exactly 80 characters', () => {
  const live: VisibleItem[] = [
    {
      section: 'Section1',
      key: 'div.long > item1',
      text: 'A very long textual representation that repeats multiple times across many elements',
      box: { x: 0, y: 0, width: 10, height: 10 },
    },
    {
      section: 'Section1',
      key: 'div.long > item2',
      text: 'and continues with additional details to exceed 80 chars easily',
      box: { x: 10, y: 0, width: 10, height: 10 },
    },
  ];

  const res = diffScriptDrawn('/', live, [], live);
  assert.equal(res.length, 1);
  assert.equal(res[0].sample.length, 80);
  assert.equal(
    res[0].sample,
    'A very long textual representation that repeats multiple times across many eleme',
  );
});

test('section isolation: text present in still for Section A does not suppress script-drawn in Section B', () => {
  const live: VisibleItem[] = [
    {
      section: 'SectionB',
      key: 'div.counter > span',
      text: 'Shared Label',
      box: { x: 0, y: 0, width: 50, height: 20 },
    },
  ];

  const still: VisibleItem[] = [
    {
      section: 'SectionA',
      key: 'header > h2',
      text: 'Shared Label',
      box: { x: 0, y: 0, width: 50, height: 20 },
    },
  ];

  const res = diffScriptDrawn('/', live, still, live);
  assert.equal(res.length, 1);
  assert.equal(res[0].section, 'SectionB');
  assert.equal(res[0].sample, 'Shared Label');
});

test('getParentKey extracts parent for various tag path formats', () => {
  assert.equal(getParentKey('div:nth-child(1) > span:nth-child(2)'), 'div:nth-child(1)');
  assert.equal(getParentKey('div > div > p'), 'div > div');
  assert.equal(getParentKey('span'), '');
  assert.equal(getParentKey(''), '');
  assert.equal(getParentKey('ruler > tick1'), 'ruler');
  assert.equal(getParentKey('div/span[0]'), 'div');
});

test('VISIBLE_ITEMS_SRC evaluates to a function and extracts visible items with direct text nodes', () => {
  assert.equal(typeof VISIBLE_ITEMS_SRC, 'string');
  assert.ok(VISIBLE_ITEMS_SRC.length > 50);

  // Evaluate the source in a mock DOM environment
  const getVisibleItems = eval(VISIBLE_ITEMS_SRC);
  assert.equal(typeof getVisibleItems, 'function');

  // Test with mock section and DOM elements
  const mockChildSpan1 = {
    nodeType: 1,
    tagName: 'SPAN',
    childNodes: [{ nodeType: 3, nodeValue: '0' }],
    getBoundingClientRect: () => ({ x: 0, y: 10, width: 20, height: 15 }),
    parentNode: null as any,
  };
  const mockChildSpan2 = {
    nodeType: 1,
    tagName: 'SPAN',
    childNodes: [{ nodeType: 3, nodeValue: '100' }],
    getBoundingClientRect: () => ({ x: 100, y: 10, width: 30, height: 15 }),
    parentNode: null as any,
  };
  const mockRulerDiv = {
    nodeType: 1,
    tagName: 'DIV',
    childNodes: [mockChildSpan1, mockChildSpan2], // Div itself has no direct text node
    children: [mockChildSpan1, mockChildSpan2],
    querySelectorAll: () => [mockChildSpan1, mockChildSpan2],
    getBoundingClientRect: () => ({ x: 0, y: 10, width: 130, height: 15 }),
    parentNode: null as any,
  };
  mockChildSpan1.parentNode = mockRulerDiv;
  mockChildSpan2.parentNode = mockRulerDiv;

  const mockSectionRoot = {
    nodeType: 1,
    tagName: 'SECTION',
    childNodes: [mockRulerDiv],
    children: [mockRulerDiv],
    querySelectorAll: () => [mockRulerDiv, mockChildSpan1, mockChildSpan2],
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 200, height: 200 }),
    parentNode: null as any,
  };
  mockRulerDiv.parentNode = mockSectionRoot;

  // Mock global document
  const originalDoc = (globalThis as any).document;
  (globalThis as any).document = {
    querySelector: (sel: string) => (sel === '#hero' ? mockSectionRoot : null),
  };

  try {
    const items = getVisibleItems([{ name: 'Hero', selector: '#hero' }]);
    assert.equal(items.length, 2);
    assert.equal(items[0].section, 'Hero');
    assert.equal(items[0].text, '0');
    assert.equal(items[0].key, 'div:nth-child(1) > span:nth-child(1)');
    assert.deepEqual(items[0].box, { x: 0, y: 10, width: 20, height: 15 });

    assert.equal(items[1].section, 'Hero');
    assert.equal(items[1].text, '100');
    assert.equal(items[1].key, 'div:nth-child(1) > span:nth-child(2)');
    assert.deepEqual(items[1].box, { x: 100, y: 10, width: 30, height: 15 });
  } finally {
    if (originalDoc !== undefined) {
      (globalThis as any).document = originalDoc;
    } else {
      delete (globalThis as any).document;
    }
  }
});
