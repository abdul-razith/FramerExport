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

test('findShellSections: identical section-2 on two pages -> shell (generic names merge only on equal markup, Fix5 item 2)', () => {
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
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0], { name: 'section-2', pages: ['/', '/about'], differences: [] });
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

test('findShellSections: nav differing only in data-motion / data-script-drawn / data-cms ids is still shell', () => {
  const pages = [
    {
      route: '/',
      sections: [{ name: 'Navigation', jsx: '<nav data-motion="m1"><a href="/" data-cms="title" data-script-drawn="s1">Home</a></nav>' }],
    },
    {
      route: '/about',
      sections: [{ name: 'Navigation', jsx: '<nav data-motion="m7 m8"><a href="/" data-cms="name" data-script-drawn="s9">Home</a></nav>' }],
    },
    {
      route: '/contact',
      sections: [{ name: 'Navigation', jsx: '<nav><a href="/">Home</a></nav>' }],
    },
  ];
  const candidates = findShellSections(pages);
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0], { name: 'Navigation', pages: ['/', '/about', '/contact'], differences: [] });
});

// ---- Fix 5 item 1: normalized comparison ----

const navJsx = (o: { v: string; name: string; current: boolean; bg: string; sd: string; href: string }): string =>
  `<header className="framer-hdr" data-framer-name="Header + Line" data-script-drawn="${o.sd}">` +
  `<a className="framer-yadmh framer-v-${o.v} framer-1szvw3r" data-framer-name="${o.name}" href="${o.href}"` +
  `${o.current ? ' data-framer-page-link-current="true" aria-current="page"' : ''}` +
  ` style={{"backgroundColor":"${o.bg}"}}>Blog</a></header>`;

test('Fix5 item 1: active nav link (variant class, data-framer-name, page-link-current, style) is still one shell, with readable differences', () => {
  const pages = [
    { route: '/', sections: [{ name: 'Header + Line', jsx: navJsx({ v: '1lelg4r', name: 'desktop--active', current: true, bg: 'var(--color-surface-2)', sd: 's1 s2', href: '/blog' }) }] },
    { route: '/blog', sections: [{ name: 'Header + Line', jsx: navJsx({ v: 'pwe3fj', name: 'desktop--inactive', current: false, bg: 'var(--color-surface-4)', sd: 's9', href: '/blog' }) }] },
  ];
  const candidates = findShellSections(pages);
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0]!.pages, ['/', '/blog']);
  const diffs = candidates[0]!.differences;
  assert.ok(diffs.length >= 1 && diffs.length <= 10);
  const joined = diffs.join('\n');
  assert.match(joined, /\/blog/);
  assert.match(joined, /desktop--inactive/);
  assert.match(joined, /desktop--active/);
  assert.match(joined, /framer-v-pwe3fj/);
});

test('Fix5 item 1: randomly generated svg ids and their url(#...) / href="#..." / aria references are masked', () => {
  const svg = (id: string, clip: string): string =>
    `<svg><defs><pattern id="${id}" width="100"><path d="M0 0" /></pattern><clipPath id="${clip}"><rect width="1" /></clipPath></defs>` +
    `<rect fill="url(#${id})" clipPath="url(#${clip})" /><use xlinkHref="#${id}" /><a href="#${clip}" aria-labelledby="${id} ${clip}">x</a></svg>`;
  const candidates = findShellSections([
    { route: '/', sections: [{ name: 'Grid', jsx: svg('paper-pattern-grid-q2qacvrfj', 'clip-aaa') }] },
    { route: '/about', sections: [{ name: 'Grid', jsx: svg('paper-pattern-grid-afdh306n0', 'clip-bbb') }] },
  ]);
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0]!.differences, []);
});

test('Fix5 item 1: random framer container class hash is masked', () => {
  const pages = [
    { route: '/', sections: [{ name: 'Smooth Scroll', jsx: '<div className="framer-e4j7mq-container" data-framer-name="Smooth Scroll"><i /></div>' }] },
    { route: '/about', sections: [{ name: 'Smooth Scroll', jsx: '<div className="framer-1tvkrgo-container" data-framer-name="Smooth Scroll"><i /></div>' }] },
  ];
  assert.equal(findShellSections(pages).length, 1);
});

test('Fix5 item 1: a structurally different instance (tag, attribute name, order) is not merged', () => {
  const base = '<header><a href="/" id="a1">x</a><b>y</b></header>';
  const variants = [
    '<header><a href="/" id="a1">x</a><i>y</i></header>',
    '<header><a href="/" id="a1" title="t">x</a><b>y</b></header>',
    '<header><b>y</b><a href="/" id="a1">x</a></header>',
    '<header><a href="/">x</a><b>y</b></header>',
  ];
  for (const v of variants) {
    const r = findShellSections([
      { route: '/', sections: [{ name: 'Header', jsx: base }] },
      { route: '/b', sections: [{ name: 'Header', jsx: v }] },
    ]);
    assert.equal(r.length, 0, v);
  }
});

test('Fix5 item 1: a different non-masked className value is still rejected', () => {
  const r = findShellSections([
    { route: '/', sections: [{ name: 'Header', jsx: '<a className="framer-v-abc one">x</a>' }] },
    { route: '/b', sections: [{ name: 'Header', jsx: '<a className="framer-v-def two">x</a>' }] },
  ]);
  assert.equal(r.length, 0);
});

test('Fix5 item 1: differences are capped at 10 lines per shell across many pages', () => {
  const pages = Array.from({ length: 9 }, (_, i) => ({
    route: `/p${i}`,
    sections: [{ name: 'Header + Line', jsx: navJsx({ v: `v${i}`, name: `n${i}`, current: i % 2 === 0, bg: `c${i}`, sd: `s${i}`, href: `/h${i}` }) }],
  }));
  const c = findShellSections(pages);
  assert.equal(c.length, 1);
  assert.ok(c[0]!.differences.length > 0 && c[0]!.differences.length <= 10);
});

// ---- Fix 5 item 2: generic names ----

test('Fix5 item 2: section-<n> becomes a shell only when the normalized markup is equal (random id only)', () => {
  const grid = (id: string): string => `<svg><pattern id="${id}"></pattern><rect fill="url(#${id})" /></svg>`;
  const c = findShellSections([
    { route: '/', sections: [{ name: 'section-1', jsx: grid('p-aaa') }] },
    { route: '/about', sections: [{ name: 'section-1', jsx: grid('p-bbb') }] },
  ]);
  assert.equal(c.length, 1);
  assert.equal(c[0]!.name, 'section-1');
  assert.deepEqual(c[0]!.differences, []);
});

test('Fix5 item 2: section-<n> that differs in text only is never a shell', () => {
  const c = findShellSections([
    { route: '/', sections: [{ name: 'section-2', jsx: '<div><p>One</p></div>' }] },
    { route: '/about', sections: [{ name: 'section-2', jsx: '<div><p>Two</p></div>' }] },
  ]);
  assert.equal(c.length, 0);
});

test('Fix5 item 2: unrelated sections at the same index never merge; page never does', () => {
  assert.equal(
    findShellSections([
      { route: '/', sections: [{ name: 'section-1', jsx: '<div><h1>a</h1></div>' }] },
      { route: '/b', sections: [{ name: 'section-1', jsx: '<section><img src="/x.png" /></section>' }] },
    ]).length,
    0,
  );
  assert.equal(
    findShellSections([
      { route: '/', sections: [{ name: 'page', jsx: '<main id="a"></main>' }] },
      { route: '/b', sections: [{ name: 'page', jsx: '<main id="b"></main>' }] },
    ]).length,
    0,
  );
});
