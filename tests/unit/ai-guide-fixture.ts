import type { GuidePage, GuideSection, GuideSite } from '../../src/ai-guide/types.js';
import { collectTokens } from '../../src/nextjs/tokens.js';
import type { Node } from '../../src/nextjs/model.js';

const section = (index: number, name: string, extra: Partial<GuideSection> = {}): GuideSection => ({
  index,
  id: String(index).padStart(2, '0'),
  name,
  widthsOf: {},
  generated: [],
  liveKeys: [],
  decorations: [],
  generic: false,
  key: `k:${name}`,
  boxes: { base: { x: 0, y: 0, w: 1440, h: 900 } },
  texts: [],
  images: [],
  links: [],
  motionKeys: [],
  ...extra,
});

const hero = section(1, 'Hero Section', {
  texts: ['Build calm products'],
  images: [{ exportPath: 'assets/images/hero.png', suggested: '/images/hero-image.png', width: 240, height: 120, alt: 'Studio desk' }],
});

export function guidePage(): GuidePage {
  return {
    route: '/',
    slug: 'index',
    title: 'Nudge',
    exportFile: 'index.html',
    sections: [hero, section(2, 'Projects')],
    shell: [section(1, 'Header', { id: 'S1', shell: true, links: [{ text: 'Home', href: '/' }] })],
  };
}

function tokens() {
  const node: Node = {
    id: 'a',
    key: 'a',
    tag: 'div',
    attrs: {},
    styles: { base: { color: 'rgb(19, 51, 36)', 'font-family': '"Inter Display", sans-serif' } },
    children: [],
  };
  return collectTokens([node]);
}

/** A small site: home, about, a blog list and two posts. */
export function fixtureSite(): GuideSite {
  const pages: GuidePage[] = [
    guidePage(),
    { route: '/about', slug: 'about', title: 'About - Nudge', exportFile: 'subpages/about.html', sections: [section(1, 'About Hero')] },
    { route: '/blog', slug: 'blog', title: 'Blog - Nudge', exportFile: 'subpages/blog.html', sections: [section(1, 'Posts')] },
    { route: '/blog/post-a', slug: 'blog_post-a', title: 'The Power of Focus', exportFile: 'subpages/blog_post-a.html', sections: [section(1, 'Post Header')], collection: 'blog' },
    { route: '/blog/post-b', slug: 'blog_post-b', title: 'Ideas Need Silence', exportFile: 'subpages/blog_post-b.html', sections: [section(1, 'Post Header')], collection: 'blog' },
  ];
  return {
    name: 'Nudge',
    sourceUrl: 'https://nudge.framer.website/',
    pages,
    collections: [
      {
        name: 'blog',
        indexRoute: '/blog',
        itemPattern: '/blog/[slug]',
        items: [
          { slug: 'post-a', route: '/blog/post-a', title: 'The Power of Focus', date: '2025-03-12', cover: 'assets/images/cover-a.png', exportFile: 'subpages/blog_post-a.html' },
          { slug: 'post-b', route: '/blog/post-b', title: 'Ideas Need Silence', date: '2025-04-03', cover: 'assets/images/cover-b.png', exportFile: 'subpages/blog_post-b.html' },
        ],
        fields: [
          { key: 'title', kind: 'text' },
          { key: 'date', kind: 'date' },
          { key: 'cover', kind: 'image' },
        ],
      },
    ],
    nav: [
      { text: 'Home', href: '/' },
      { text: 'About', href: '/about' },
      { text: 'Blog', href: '/blog' },
    ],
    footer: [{ text: 'About the studio', href: '/about' }],
    sharedSections: [{ name: 'Footer', routes: ['/', '/about'] }],
    tokens: tokens(),
    fonts: [{ family: 'Inter Display', weight: '400', style: 'normal', file: 'Inter-Regular.latin.woff2' }],
    exportFiles: { images: [], videos: [], data: ['data/abc-chunk-default-0.framercms'] },
  };
}
