import { planTasks } from './plan.js';
import type { GuideImage, GuideSite } from './types.js';

const row = (cells: (string | number | undefined)[]) => `| ${cells.map((c) => c ?? '').join(' | ')} |`;

function collectionOf(site: GuideSite, route: string): string | undefined {
  const c = site.collections.find((x) => x.indexRoute === route);
  if (c) return `list page of collection "${c.name}"`;
  const item = site.pages.find((p) => p.route === route)?.collection;
  return item ? `detail page of collection "${item}"` : undefined;
}

export function renderSiteMd(site: GuideSite): string {
  const out = [
    `# ${site.name} — site overview`,
    '',
    `Source: ${site.sourceUrl}`,
    'Breakpoints: desktop ≥ 1200px, tablet 810–1199px, mobile ≤ 809px (reference screenshots at 1440, 1024 and 390).',
    `Fonts: ${[...new Set(site.fonts.map((f) => f.family))].join(', ') || 'none found'}`,
    '',
    '## Pages',
    '',
    row(['Route', 'Title', 'Export file', 'Sections']),
    row(['---', '---', '---', '---']),
    ...site.pages.map((p) => row([p.route, p.title, p.exportFile, p.sections.map((s) => s.name).join(', ')])),
    '',
    '## CMS pages',
    '',
  ];
  const cms = site.pages.map((p) => [p.route, collectionOf(site, p.route)] as const).filter(([, c]) => c);
  out.push(...(cms.length ? cms.map(([r, c]) => row([r, c])) : ['None.']), '');
  out.push('## Navigation', ...(site.nav.length ? site.nav.map((l) => `- ${l.text} → ${l.href}`) : ['None found.']), '');
  out.push('## Footer links', ...(site.footer.length ? site.footer.map((l) => `- ${l.text} → ${l.href}`) : ['None found.']), '');
  const home = site.pages.find((p) => p.route === '/') ?? site.pages[0];
  const shell = site.shell ?? home?.shell ?? [];
  out.push('## Shell parts (ai-guide/shell/)', ...(shell.length ? shell.map((s) => `- ${s.id} ${s.name}${s.ownerRoute && s.ownerRoute !== '/' ? ` (first on ${s.ownerRoute})` : ''}`) : ['None found.']), '');
  out.push(
    '## Sections shared between pages',
    ...(site.sharedSections.length ? site.sharedSections.map((s) => `- ${s.name}: ${s.routes.join(', ')}`) : ['None.']),
    ''
  );
  out.push('## Tasks (ai-guide/plan.md)', '', ...planTasks(site).map((t, i) => `${i + 1}. Task ${t.number}: ${t.title}`), '');
  return out.join('\n');
}

export function renderFilesMd(site: GuideSite): string {
  const uses = new Map<string, { image: GuideImage; where: string[] }>();
  for (const p of site.pages) {
    for (const s of p.sections) {
      for (const image of s.images) {
        const entry = uses.get(image.exportPath) ?? { image, where: [] };
        const where = `${p.route} › ${s.name}`;
        if (!entry.where.includes(where)) entry.where.push(where);
        uses.set(image.exportPath, entry);
      }
    }
  }
  for (const image of site.exportFiles.images) if (!uses.has(image.exportPath)) uses.set(image.exportPath, { image, where: [] });

  return [
    '# What is where in this export',
    '',
    'The export is a reference. Copy text, images, videos and fonts from it; never copy its scripts, styles or `framer-*` class names.',
    '',
    '## Folders',
    '',
    '- `index.html`, `subpages/*.html` — one HTML file per page (see site.md for the route of each).',
    '- `assets/images/` — images (list below).',
    '- `assets/fonts/` — font files (list below).',
    '- `assets/videos/` — videos.',
    '- `data/*.framercms` — Framer CMS data chunks (content.md describes the collections).',
    '- `styles/` — Framer generated CSS — do not copy; use tokens.md instead.',
    '- `scripts/` — Framer runtime — do not copy.',
    '',
    '## Images',
    '',
    ...(uses.size
      ? [...uses.values()].map(
          ({ image, where }) =>
            `- ${image.exportPath} → ${image.suggested} (${image.width}×${image.height})${where.length ? ` · used in: ${where.join('; ')}` : ' · not placed on a page'}`
        )
      : ['None.']),
    '',
    '## Fonts',
    '',
    row(['File', 'Family', 'Weight', 'Style']),
    row(['---', '---', '---', '---']),
    ...site.fonts.map((f) => row([f.file, f.family, f.weight, f.style])),
    '',
    '## Videos',
    '',
    ...(site.exportFiles.videos.length ? site.exportFiles.videos.map((v) => `- ${v}`) : ['None.']),
    '',
    '## CMS data',
    '',
    ...(site.exportFiles.data.length ? site.exportFiles.data.map((d) => `- ${d}`) : ['None.']),
    '',
  ].join('\n');
}

const FIELD_TYPE: Record<string, string> = { text: 'string', date: 'string', image: 'string', tags: 'string[]' };

export function renderContentMd(site: GuideSite): string {
  const out = ['# CMS content', ''];
  if (!site.collections.length) {
    out.push('No CMS collections were detected. All content is on the pages (see the Content part of each section ref.md).', '');
    return out.join('\n');
  }
  for (const c of site.collections) {
    out.push(
      `## Collection "${c.name}"`,
      `List page: ${c.indexRoute} · Detail pages: ${c.itemPattern}`,
      '',
      row(['Slug', 'Title', 'Date', 'Cover', 'Export file']),
      row(['---', '---', '---', '---', '---']),
      ...c.items.map((i) => row([i.slug, i.title, i.date, i.cover, i.exportFile])),
      '',
      'Suggested MDX front matter (one file per item, `content/' + c.name + '/<slug>.mdx`; the body is the article text of the detail page):',
      '',
      '```yaml',
      ...c.fields.map((f) => `${f.key}: ${FIELD_TYPE[f.kind] ?? 'string'}`),
      '```',
      ''
    );
  }
  return out.join('\n');
}

export function renderTokensMd(site: GuideSite): string {
  const t = site.tokens;
  const table = (title: string, entries: [string, string][]) => [
    `## ${title}`,
    '',
    ...(entries.length ? [row(['Name', 'Value']), row(['---', '---']), ...entries.map(([k, v]) => row([k, v]))] : ['None found.']),
    '',
  ];
  return [
    '# Design tokens',
    '',
    'Every colour, font, radius and shadow found on the site, with a proposed token name. Put them in `@theme` in `globals.css`; components use the token names only.',
    '',
    ...table('Colours', Object.entries(t.colors)),
    ...table('Fonts', Object.entries(t.fonts)),
    ...table('Radii', Object.entries(t.radii)),
    ...table('Shadows', Object.entries(t.shadows)),
  ].join('\n');
}
