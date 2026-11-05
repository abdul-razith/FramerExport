import assert from 'node:assert/strict';
import test from 'node:test';
import { findShellSections, type ShellCandidate } from '../../src/convert/generate/shell.js';

test('findShellSections: identical Navigation on / and /about -> candidate with differences: []', () => {
  const pages = [
    {
      route: '/',
      sections: [{ name: 'Navigation', jsx: '<nav><a href="/">Home</a><a href="/about">About</a></nav>' }],
    },
    {
      route: '/about',
      sections: [{ name: 'Navigation', jsx: '<nav><a href="/">Home</a><a href="/about">About</a></nav>' }],
    },
  ];

  const candidates = findShellSections(pages);
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0], {
    name: 'Navigation',
    pages: ['/', '/about'],
    differences: [],
  });
});

test('findShellSections: nav differing only in an href -> candidate with one difference line', () => {
  const pages = [
    {
      route: '/',
      sections: [{ name: 'Navigation', jsx: '<nav><a href="/">Home</a></nav>' }],
    },
    {
      route: '/about',
      sections: [{ name: 'Navigation', jsx: '<nav><a href="/about">Home</a></nav>' }],
    },
  ];

  const candidates = findShellSections(pages);
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0], {
    name: 'Navigation',
    pages: ['/', '/about'],
    differences: ['/about: /about'],
  });
});

test('findShellSections: structurally different Footer -> none', () => {
  const pages = [
    {
      route: '/',
      sections: [{ name: 'Footer', jsx: '<footer><p>© 2026 Acme Corp</p></footer>' }],
    },
    {
      route: '/about',
      sections: [{ name: 'Footer', jsx: '<footer><div><a href="/privacy">Privacy Policy</a></div></footer>' }],
    },
  ];

  const candidates = findShellSections(pages);
  assert.equal(candidates.length, 0);
});

test('findShellSections: section-2 on two pages -> none (excludes section-<n>)', () => {
  const pages = [
    {
      route: '/',
      sections: [{ name: 'section-2', jsx: '<div><p>Identical Section 2</p></div>' }],
    },
    {
      route: '/about',
      sections: [{ name: 'section-2', jsx: '<div><p>Identical Section 2</p></div>' }],
    },
  ];

  const candidates = findShellSections(pages);
  assert.equal(candidates.length, 0);
});

test('findShellSections: page on two pages -> none (excludes page)', () => {
  const pages = [
    {
      route: '/',
      sections: [{ name: 'page', jsx: '<main><h1>Page 1</h1></main>' }],
    },
    {
      route: '/about',
      sections: [{ name: 'page', jsx: '<main><h1>Page 2</h1></main>' }],
    },
  ];

  assert.equal(findShellSections(pages).length, 0);

  const pagesWithUpper = [
    {
      route: '/',
      sections: [{ name: 'Page', jsx: '<main><h1>Page 1</h1></main>' }],
    },
    {
      route: '/about',
      sections: [{ name: 'Page', jsx: '<main><h1>Page 2</h1></main>' }],
    },
  ];

  assert.equal(findShellSections(pagesWithUpper).length, 0);
});

test('findShellSections: nav differing in text node -> candidate with changed text difference', () => {
  const pages = [
    {
      route: '/',
      sections: [{ name: 'Header', jsx: '<header><h1>Home Title</h1></header>' }],
    },
    {
      route: '/about',
      sections: [{ name: 'Header', jsx: '<header><h1>About Title</h1></header>' }],
    },
  ];

  const candidates = findShellSections(pages);
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0], {
    name: 'Header',
    pages: ['/', '/about'],
    differences: ['/about: About Title'],
  });
});

test('findShellSections: differences in src and alt attributes', () => {
  const pages = [
    {
      route: '/',
      sections: [{ name: 'Brand', jsx: '<div><img src="/logo-dark.png" alt="Dark Logo" /></div>' }],
    },
    {
      route: '/about',
      sections: [{ name: 'Brand', jsx: '<div><img src="/logo-light.png" alt="Light Logo" /></div>' }],
    },
  ];

  const candidates = findShellSections(pages);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.name, 'Brand');
  assert.deepEqual(candidates[0]?.pages, ['/', '/about']);
  assert.deepEqual(candidates[0]?.differences, ['/about: Light Logo', '/about: /logo-light.png']);
});

test('findShellSections: multiple shared sections in document order', () => {
  const pages = [
    {
      route: '/',
      sections: [
        { name: 'Navigation', jsx: '<nav><a href="/">Home</a></nav>' },
        { name: 'Hero', jsx: '<section><h1>Hero 1</h1></section>' },
        { name: 'Footer', jsx: '<footer><p>Footer content</p></footer>' },
      ],
    },
    {
      route: '/about',
      sections: [
        { name: 'Navigation', jsx: '<nav><a href="/about">Home</a></nav>' },
        { name: 'AboutHero', jsx: '<section><h1>About Hero</h1></section>' },
        { name: 'Footer', jsx: '<footer><p>Footer content</p></footer>' },
      ],
    },
  ];

  const candidates = findShellSections(pages);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0]?.name, 'Navigation');
  assert.deepEqual(candidates[0]?.differences, ['/about: /about']);
  assert.equal(candidates[1]?.name, 'Footer');
  assert.deepEqual(candidates[1]?.differences, []);
});

test('findShellSections: differences capped at max 10', () => {
  const linksBase = Array.from({ length: 15 }, (_, i) => `<a href="/base-${i}">Base ${i}</a>`).join('');
  const linksDiff = Array.from({ length: 15 }, (_, i) => `<a href="/diff-${i}">Diff ${i}</a>`).join('');

  const pages = [
    {
      route: '/',
      sections: [{ name: 'Nav', jsx: `<nav>${linksBase}</nav>` }],
    },
    {
      route: '/about',
      sections: [{ name: 'Nav', jsx: `<nav>${linksDiff}</nav>` }],
    },
  ];

  const candidates = findShellSections(pages);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.differences.length, 10);
});

test('findShellSections: section on only 1 page is not a candidate', () => {
  const pages = [
    {
      route: '/',
      sections: [{ name: 'Navigation', jsx: '<nav><a href="/">Home</a></nav>' }],
    },
    {
      route: '/about',
      sections: [{ name: 'Sidebar', jsx: '<aside>Links</aside>' }],
    },
  ];

  const candidates = findShellSections(pages);
  assert.equal(candidates.length, 0);
});

test('findShellSections: empty pages or empty sections returns empty array', () => {
  assert.deepEqual(findShellSections([]), []);
  assert.deepEqual(findShellSections([{ route: '/', sections: [] }]), []);
});

test('findShellSections: differing non-target attributes rejects candidate as structurally different', () => {
  const pages = [
    {
      route: '/',
      sections: [{ name: 'Header', jsx: '<header className="header-home"><nav>Nav</nav></header>' }],
    },
    {
      route: '/about',
      sections: [{ name: 'Header', jsx: '<header className="header-about"><nav>Nav</nav></header>' }],
    },
  ];

  const candidates = findShellSections(pages);
  assert.equal(candidates.length, 0);
});

test('findShellSections: multi-line formatted JSX matches single-line JSX', () => {
  const pages = [
    {
      route: '/',
      sections: [
        {
          name: 'Navigation',
          jsx: `<nav className="navbar">
  <a href="/" className="nav-link">
    Home
  </a>
</nav>`,
        },
      ],
    },
    {
      route: '/about',
      sections: [
        {
          name: 'Navigation',
          jsx: '<nav className="navbar"><a href="/about" className="nav-link">Home</a></nav>',
        },
      ],
    },
  ];

  const candidates = findShellSections(pages);
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0], {
    name: 'Navigation',
    pages: ['/', '/about'],
    differences: ['/about: /about'],
  });
});
