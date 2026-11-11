import { existsSync, readdirSync, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { warn } from '../logger/index.js';
import { capturePages, listExportPages } from '../nextjs/capture.js';
import { looseHash, pageStructure } from '../nextjs/components.js';
import { ImageNamer } from '../nextjs/content.js';
import { extractStartStates } from '../nextjs/framer/animations.js';
import { mergeBreakpoints } from '../nextjs/framer/breakpoints.js';
import {
  detectCollections,
  fullText,
  toIsoDate,
  type Collection,
} from '../nextjs/framer/collections.js';
import { attachMotion } from '../nextjs/framer/motion-map.js';
import { extractFontFaces } from '../nextjs/fonts.js';
import {
  BREAKPOINTS,
  type Box,
  type Breakpoint,
  type ConversionContext,
  type Node,
  type PageModel,
  type RawNode,
} from '../nextjs/model.js';
import { emptyReport } from '../nextjs/report.js';
import { collectTokens, type ThemeTokens } from '../nextjs/tokens.js';
import { sliceSection } from './crops.js';
import {
  hiddenClassWidths,
  parseExportCss,
  stylesForClasses,
  textStyles,
  type CssRule,
} from './export-css.js';
import { classesIn, presetClassesIn, sectionMarkup, type MarkupCopy } from './export-markup.js';
import { findAnimations, loadVendorModules, type ExportAnimation } from './export-motion.js';
import { recordInteractions, type InteractionState } from './interactions.js';
import { motionFromNodes, renderMotionMd, summarizeLoad } from './motion.js';
import { buildGuidePage } from './outline.js';
import { markupFileNames, renderSectionRef, sectionDirName } from './section-ref.js';
import { sectionsJson, WIDTH_KEY, type WidthKey } from './sections-json.js';
import { splitPage } from './split.js';
import { assignShellIds, shellKey } from './shell-ids.js';
import { swapIn } from './swap.js';
import { renderPlan, writePlanFile } from './plan.js';
import { recordPage } from './record.js';
import { renderContentMd, renderFilesMd, renderSiteMd, renderTokensMd } from './site-docs.js';
import { AGENTS_MD } from './templates/agents.js';
import { CHECKLIST_MD } from './templates/checklist.js';
import { COMPARE_MJS } from './templates/compare.js';
import { renderReadme } from './templates/readme.js';
import {
  pageSlug,
  type GuideCollection,
  type GuideLink,
  type GuidePage,
  type GuideSection,
  type GuideSite,
  type MotionEntry,
} from './types.js';

export { takeAiGuideFlag } from './flag.js';

const SHOT_NAMES: Record<Breakpoint, string> = {
  base: 'desktop',
  tablet: 'tablet',
  mobile: 'mobile',
};
const FRAME_EVERY_MS = 200;

/** Maps a captured image URL to its file in the export: Framer keeps the file ID in the name. */
function assetLookup(exportDir: string): (src: string) => string | undefined {
  const dir = path.join(exportDir, 'assets', 'images');
  const files = existsSync(dir) ? readdirSync(dir) : [];
  return (src) => {
    let stem = '';
    try {
      stem = path.posix.basename(new URL(src, 'http://local').pathname);
    } catch {
      return undefined;
    }
    const base = stem.replace(/\.[a-z0-9]+$/i, '');
    const hit =
      files.find((f) => f === stem) ??
      files.find((f) => f.startsWith(base + '-') || f.startsWith(base + '.'));
    return hit ? `assets/images/${hit}` : undefined;
  };
}

/** Which export file holds each route (`index.html` or `subpages/<file>.html`). */
function exportFiles(
  exportDir: string,
  pages: { route: string; exportHtml: string }[]
): Map<string, string> {
  const out = new Map<string, string>([['/', 'index.html']]);
  const sub = path.join(exportDir, 'subpages');
  const files = existsSync(sub) ? readdirSync(sub).filter((f) => f.endsWith('.html')) : [];
  const byContent = new Map(files.map((f) => [readFileSync(path.join(sub, f), 'utf8'), f]));
  for (const p of pages)
    if (p.route !== '/')
      out.set(
        p.route,
        `subpages/${byContent.get(p.exportHtml) ?? p.route.slice(1).replace(/\//g, '_') + '.html'}`
      );
  return out;
}

function linksIn(node: Node, origin: string): GuideLink[] {
  const out: GuideLink[] = [];
  const walk = (n: Node) => {
    if (n.tag === 'a' && n.attrs.href) {
      const text = fullText(n).replace(/\s+/g, ' ').trim();
      let href = n.attrs.href;
      try {
        const u = new URL(href, origin);
        if (u.origin === origin) href = u.pathname.replace(/\/+$/, '') || '/';
      } catch {}
      if (text && !out.some((l) => l.text === text && l.href === href)) out.push({ text, href });
      return;
    }
    n.children.forEach(walk);
  };
  walk(node);
  return out;
}

/** First element matching `test` (depth-first), for finding the navigation and the footer. */
function find(node: Node, test: (n: Node) => boolean): Node | undefined {
  if (test(node)) return node;
  for (const c of node.children) {
    const hit = find(c, test);
    if (hit) return hit;
  }
  return undefined;
}

function guideCollection(
  c: Collection,
  byRoute: Map<string, PageModel>,
  lookup: (src: string) => string | undefined,
  files: Map<string, string>
): GuideCollection {
  const fieldNode = (page: PageModel, nodeKey: string) => find(page.root, (n) => n.key === nodeKey);
  const dateField = c.fields.find((f) => f.kind === 'date');
  const coverField = c.fields.find((f) => f.kind === 'image');
  return {
    name: c.name,
    indexRoute: c.indexRoute,
    itemPattern: `${c.indexRoute}/[slug]`,
    items: c.itemRoutes.map((route) => {
      const page = byRoute.get(route)!;
      const dateNode = dateField && fieldNode(page, dateField.nodeKey);
      const cover = coverField && fieldNode(page, coverField.nodeKey)?.asset?.src;
      return {
        slug: route.split('/').pop()!,
        route,
        title: page.title.split(/\s[-|–]\s/)[0],
        date: dateNode ? toIsoDate(fullText(dateNode)) : undefined,
        cover: cover ? (lookup(cover) ?? cover) : undefined,
        exportFile: files.get(route) ?? '',
      };
    }),
    fields: c.fields.map((f) => ({ key: f.key, kind: f.kind })),
  };
}

/** Box of a node (by key) at each width, from the three captures. */
function boxLookup(
  trees: Record<Breakpoint, RawNode>
): (n: Node) => Partial<Record<Breakpoint, Box>> {
  const index = new Map<string, Partial<Record<Breakpoint, Box>>>();
  for (const bp of BREAKPOINTS) {
    const walk = (r: RawNode) => {
      const e = index.get(r.key) ?? {};
      if (r.visible !== false) e[bp] = r.box;
      index.set(r.key, e);
      r.children.forEach(walk);
    };
    if (trees[bp]) walk(trees[bp]);
  }
  return (n) => index.get(n.key) ?? {};
}

/** Structure hashes of parts found on two or more pages (top-level sections and their children). */
function sharedPartHashes(pages: PageModel[]): Set<string> {
  const seenOn = new Map<string, Set<string>>();
  for (const p of pages) {
    for (const s of pageStructure(p.root).sections) {
      for (const n of [s, ...s.children]) {
        const h = looseHash(n);
        if (!seenOn.has(h)) seenOn.set(h, new Set());
        seenOn.get(h)!.add(p.route);
      }
    }
  }
  return new Set([...seenOn].filter(([, routes]) => routes.size > 1).map(([h]) => h));
}

/** Test hook: FRAMER_AIGUIDE_TEST_FAIL is a comma-separated list such as `record:/about,section:/`. */
const failHook = (name: string) =>
  (process.env.FRAMER_AIGUIDE_TEST_FAIL ?? '').split(',').includes(name);

/** Everything the export says about one section; each part fails on its own. */
async function sectionReference(
  s: GuideSection,
  html: string,
  rules: CssRule[],
  tokens: ThemeTokens,
  modules: { file: string; text: string }[],
  entries: MotionEntry[]
) {
  const hidden = hiddenClassWidths(rules);
  let markup: MarkupCopy[] | Error;
  try {
    markup = await sectionMarkup(
      html,
      { framerName: s.framerName, className: s.className },
      hidden
    );
    if (!markup.length) markup = new Error('the element was not found in the export file');
  } catch (e) {
    markup = e as Error;
  }
  const copies = markup instanceof Error ? [] : markup;
  const classes = [
    ...new Set([
      ...(s.className ? [s.className] : []),
      ...copies.flatMap((c) => classesIn(c.html)),
    ]),
  ];
  const presets = [...new Set(copies.flatMap((c) => presetClassesIn(c.html)))];
  let css: string | Error;
  try {
    css = stylesForClasses(rules, classes, tokens);
  } catch (e) {
    css = e as Error;
  }
  let animations: ExportAnimation[] | Error;
  try {
    animations = findAnimations(modules, classes);
  } catch (e) {
    animations = e as Error;
  }
  const hoverClasses = classes.filter((c) =>
    rules.some(
      (r) => r.selector.includes(':hover') && new RegExp(`\\.${c}(?![\\w-])`).test(r.selector)
    )
  );
  const recorded = entries.filter((e) => e.key === s.key || e.key.startsWith(s.key + '/'));
  return {
    markup,
    css,
    presets,
    animations,
    recorded,
    hoverClasses,
    selectorClasses: s.className ? [s.className] : [],
  };
}

/** Writes the guide into `guideDir` (a build folder) and returns the plan's text. */
async function build(
  exportDir: string,
  sourceUrl: string,
  guideDir: string,
  log: (m: string) => void
): Promise<string> {
  await fs.rm(guideDir, { recursive: true, force: true });
  await fs.mkdir(guideDir, { recursive: true });
  const list = listExportPages(exportDir, sourceUrl);
  if (process.env.FRAMER_AIGUIDE_TEST_FAIL === '1')
    throw new Error('Simulated failure (FRAMER_AIGUIDE_TEST_FAIL)');
  const report = emptyReport();
  const ctx: ConversionContext = {
    exportDir,
    sourceUrl,
    outDir: guideDir,
    cacheDir: path.join(guideDir, '.capture'),
    options: { aiRefine: false, verify: false, cliSkipPermissions: true },
    report,
    log,
  };
  const { captured, failed } = await capturePages(list, ctx);
  for (const f of failed) log(`AI guide: could not capture ${f.route} (${f.error})`);
  if (!captured.length) throw new Error('No page could be captured.');

  const exportHtml = new Map(list.map((p) => [p.route, p.exportHtml]));
  const files = exportFiles(exportDir, list);
  const pages: PageModel[] = captured.map((c) => {
    const root = attachMotion(
      mergeBreakpoints(c, extractStartStates(exportHtml.get(c.route) ?? ''), report)
    );
    return {
      route: c.route,
      sourceUrl: c.url,
      title: c.title,
      meta: c.meta,
      root,
      screenshots: c.screenshots,
    };
  });
  const byRoute = new Map(pages.map((p) => [p.route, p]));
  const capturedBy = new Map(captured.map((c) => [c.route, c]));
  const collections = detectCollections(pages);
  const itemOf = new Map(collections.flatMap((c) => c.itemRoutes.map((r) => [r, c.name] as const)));
  const origin = new URL(sourceUrl).origin;
  const images = new ImageNamer();
  const lookup = assetLookup(exportDir);

  // Parts shared by several pages (header, footer, CTA…) belong to the shell, built once.
  const sharedHashes = sharedPartHashes(pages.filter((p) => !itemOf.has(p.route)));
  const tokens = collectTokens(pages.map((p) => p.root));
  const built: { page: GuidePage; shellHashes: string[] }[] = [];
  for (const p of pages) {
    const c = capturedBy.get(p.route)!;
    try {
      const boxes = boxLookup(c.trees);
      const { sections: parts, shell: shellParts } = splitPage(
        p.root,
        boxes,
        sharedHashes,
        c.trees.base.box.h || 1
      );
      const page = buildGuidePage({
        route: p.route,
        title: p.title,
        exportFile: files.get(p.route) ?? '',
        root: p.root,
        trees: c.trees,
        images,
        origin,
        localAsset: lookup,
        parts,
        shellParts,
      });
      const collection = itemOf.get(p.route);
      built.push({
        page: collection ? { ...page, collection } : page,
        shellHashes: shellParts.map((s) => shellKey(s.node)),
      });
    } catch (e) {
      // One page whose structure cannot be read must not cost the whole guide.
      log(`AI guide: ${p.route} skipped (${(e as Error).message})`);
      await fs.mkdir(path.join(guideDir, 'pages', pageSlug(p.route)), { recursive: true });
      await fs.writeFile(
        path.join(guideDir, 'pages', pageSlug(p.route), 'ERROR.md'),
        `# ${p.route} could not be analysed\n\n${(e as Error).message}\n\nUse the export file and the live site for this page.\n`
      );
    }
  }
  if (!built.length) throw new Error('No page could be analysed.');
  // Shell ids by Framer class (else structure), home page first; each part is built once, on the
  // first page it appears on. Only pages that get section folders own shell parts (CMS items other
  // than the first share their collection's template); the others keep only parts already known.
  const firstItems = new Set(collections.map((c) => c.itemRoutes[0]));
  const owning = (route: string) => !itemOf.has(route) || firstItems.has(route);
  const order = built.filter((b) => owning(b.page.route)).sort((a, b) => (a.page.route === '/' ? -1 : b.page.route === '/' ? 1 : 0));
  const { ids, owners } = assignShellIds(order.map((b) => ({ route: b.page.route, hashes: b.shellHashes })));
  order.forEach((b, i) => (b.page.shell ?? []).forEach((s, k) => (s.id = ids[i][k])));
  const siteShell: GuideSection[] = owners.map((o) => {
    const s = order.find((b) => b.page.route === o.route)!.page.shell![o.index];
    s.ownerRoute = o.route;
    return s;
  });
  const idByKey = new Map<string, string>();
  order.forEach((b, i) => b.shellHashes.forEach((h, k) => idByKey.set(h, ids[i][k])));
  for (const b of built) {
    if (!owning(b.page.route) && b.page.shell) {
      b.page.shell = b.page.shell.filter((s, k) => {
        const id = idByKey.get(b.shellHashes[k]);
        if (id) s.id = id;
        return !!id;
      });
    }
    for (const s of b.page.shell ?? []) s.ownerRoute = siteShell.find((x) => x.id === s.id)?.ownerRoute;
  }
  const guidePages: GuidePage[] = built.map((b) => b.page);

  // Screenshots, recordings, motion notes and the per-section references, page by page.
  const modules = loadVendorModules(exportDir);
  const allRules: CssRule[] = [];
  const presets = new Set<string>();
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    for (const page of guidePages) {
      const dir = path.join(guideDir, 'pages', page.slug);
      try {
        if (failHook(`page:${page.route}`))
          throw new Error('Simulated page failure (FRAMER_AIGUIDE_TEST_FAIL)');
        const c = capturedBy.get(page.route)!;
        await fs.mkdir(dir, { recursive: true });
        for (const [bp, name] of Object.entries(SHOT_NAMES) as [Breakpoint, string][]) {
          await fs.copyFile(c.screenshots[bp], path.join(dir, `${name}.png`));
        }
        const entries: MotionEntry[] = motionFromNodes(byRoute.get(page.route)!.root, c.hover);
        let recordingNote = '';
        const recorded = !page.collection || firstItems.has(page.route);
        if (recorded) {
          log(`AI guide: recording ${page.route}`);
          try {
            if (failHook(`record:${page.route}`)) throw new Error('Simulated recording failure');
            const rec = await recordPage(browser, c.url, dir, { frameEveryMs: FRAME_EVERY_MS });
            entries.push(...summarizeLoad(rec.samples, FRAME_EVERY_MS));
            entries.push(
              ...summarizeLoad(rec.midSamples, FRAME_EVERY_MS, 'loop').filter(
                (e) => e.trigger === 'loop'
              )
            );
          } catch (e) {
            // One slow or broken page must not cost the whole guide.
            log(`AI guide: recording ${page.route} failed (${(e as Error).message})`);
            recordingNote = `\n> The recording failed for this page (${(e as Error).message}), so its load and loop animations are not listed here; only what the page's CSS and markup show is. Check the live site for the rest.\n`;
          }
        }
        await fs.writeFile(
          path.join(dir, 'motion.md'),
          renderMotionMd(page, entries) + recordingNote
        );

        const html = exportHtml.get(page.route) ?? '';
        const rules = parseExportCss(html);
        allRules.push(...rules);
        // Shell parts are written once, from the page that owns them.
        const ownedShell = (page.shell ?? []).filter((s) => s.ownerRoute === page.route);
        // CMS item pages share one template: only the first item of each collection gets section folders.
        const targets: { section: GuideSection; dir: string }[] = [
          ...(recorded ? page.sections : []).map((s) => ({
            section: s,
            dir: path.join(dir, 'sections', sectionDirName(s)),
          })),
          ...ownedShell.map((s) => ({
            section: s,
            dir: path.join(guideDir, 'shell', sectionDirName(s)),
          })),
        ];
        log(`AI guide: section references for ${page.route} (${targets.length})`);
        const refs = await Promise.all(
          targets.map((t) => sectionReference(t.section, html, rules, tokens, modules, entries))
        );
        let states: InteractionState[] = [];
        if (recorded) {
          try {
            const interactionTargets = refs
              .map((r, i) => ({
                id: targets[i].section.id,
                selectorClasses: r.selectorClasses,
                hoverClasses: r.hoverClasses,
              }))
              .filter((t) => t.selectorClasses.length);
            const tmp = path.join(dir, '.states');
            states = await recordInteractions(browser, c.url, interactionTargets, tmp, 1440);
            if (ownedShell.length) {
              const shellIds = new Set(ownedShell.map((s) => s.id));
              states.push(
                ...(
                  await recordInteractions(
                    browser,
                    c.url,
                    interactionTargets.filter((t) => shellIds.has(t.id)),
                    path.join(tmp, '390'),
                    390
                  )
                ).map((s) => ({ ...s, before: `390/${s.before}`, after: `390/${s.after}` }))
              );
            }
            for (const st of states) {
              const t = targets.find((x) => x.section.id === st.section)!;
              for (const f of [st.before, st.after]) {
                const target = path.join(
                  t.dir,
                  'states',
                  path.basename(f).replace(/^/, f.startsWith('390/') ? 'mobile-' : '')
                );
                await fs.mkdir(path.dirname(target), { recursive: true });
                await fs.rename(path.join(tmp, f), target);
              }
              const prefix = st.before.startsWith('390/') ? 'mobile-' : '';
              st.before = `states/${prefix}${path.basename(st.before)}`;
              st.after = `states/${prefix}${path.basename(st.after)}`;
            }
            await fs.rm(tmp, { recursive: true, force: true });
          } catch (e) {
            log(`AI guide: interaction states for ${page.route} failed (${(e as Error).message})`);
            states = [];
          }
        }
        for (const [i, t] of targets.entries()) {
          try {
            if (failHook(`section:${page.route}`) && i === targets.length - 1)
              throw new Error('Simulated section failure (FRAMER_AIGUIDE_TEST_FAIL)');
            const r = refs[i];
            for (const p of r.presets) presets.add(p);
            await fs.mkdir(t.dir, { recursive: true });
            if (!(r.markup instanceof Error)) {
              const names = markupFileNames(r.markup);
              for (const [k, copy] of r.markup.entries())
                await fs.writeFile(path.join(t.dir, names[k]), copy.html);
            }
            if (!(r.css instanceof Error))
              await fs.writeFile(
                path.join(t.dir, 'styles.css'),
                r.css || '/* no rules of its own */\n'
              );
            const slices: Partial<Record<WidthKey, string[]>> = {};
            for (const bp of BREAKPOINTS) {
              const box = t.section.boxes[bp];
              if (box && box.w > 0 && box.h > 0)
                slices[WIDTH_KEY[bp]] = (
                  await sliceSection(c.screenshots[bp], box, t.dir, `shot-${WIDTH_KEY[bp]}`)
                ).map((f) => path.basename(f));
            }
            await fs.writeFile(
              path.join(t.dir, 'ref.md'),
              renderSectionRef({
                page,
                section: t.section,
                exportFile: page.exportFile,
                markup: r.markup,
                css: r.css,
                presets: r.presets,
                animations: r.animations,
                recorded: r.recorded,
                states: states.filter((s) => s.section === t.section.id),
                slices,
              })
            );
          } catch (e) {
            // One section that cannot be written must not cost the page.
            log(
              `AI guide: section ${t.section.id} of ${page.route} failed (${(e as Error).message})`
            );
            await fs.mkdir(t.dir, { recursive: true }).catch(() => undefined);
            await fs
              .writeFile(
                path.join(t.dir, 'ref.md'),
                `# ${t.section.id} ${t.section.name} — ${page.route}

This section's references could not be written (${(e as Error).message}). Build it from the page screenshots and the export file \`${page.exportFile}\`.
`
              )
              .catch(() => undefined);
          }
        }
      } catch (e) {
        // One page that fails must not cost the whole guide.
        log(`AI guide: ${page.route} failed (${(e as Error).message})`);
        await fs.mkdir(dir, { recursive: true }).catch(() => undefined);
        await fs
          .writeFile(
            path.join(dir, 'ERROR.md'),
            `# ${page.route}: part of the guide is missing

${(e as Error).message}

Use the export file \`${page.exportFile}\` and the live site for this page.
`
          )
          .catch(() => undefined);
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
  await fs.writeFile(
    path.join(guideDir, 'text-styles.css'),
    textStyles(allRules, [...presets], tokens) ||
      '/* This site has no Framer text style presets. */\n'
  );
  await fs.writeFile(
    path.join(guideDir, 'sections.json'),
    JSON.stringify(
      sectionsJson(guidePages, (route, id) => {
        const page = guidePages.find((p) => p.route === route)!;
        const s = [...(page.shell ?? []), ...page.sections].find((x) => x.id === id);
        const boxes = boxLookup(capturedBy.get(route)!.trees);
        const out: Partial<Record<WidthKey, Box[]>> = {};
        for (const key of s?.liveKeys ?? []) {
          const b = boxes({ key } as Node);
          for (const bp of BREAKPOINTS)
            if (b[bp] && b[bp]!.w > 0) (out[WIDTH_KEY[bp]] ??= []).push(b[bp]!);
        }
        return out;
      }),
      null,
      1
    )
  );

  const home = byRoute.get('/') ?? pages[0];
  const navNode = find(
    home.root,
    (n) =>
      n.tag === 'nav' ||
      /^(nav|navigation|menu|header)/i.test(n.framerName ?? '') ||
      n.tag === 'header'
  );
  const footerNode = find(
    home.root,
    (n) => n.tag === 'footer' || /footer/i.test(n.framerName ?? '')
  );
  const shared = new Map<string, { name: string; routes: string[] }>();
  for (const p of pages.filter((x) => !itemOf.has(x.route))) {
    for (const s of pageStructure(p.root).sections) {
      const h = looseHash(s);
      const entry = shared.get(h) ?? { name: s.framerName ?? s.tag, routes: [] };
      if (!entry.routes.includes(p.route)) entry.routes.push(p.route);
      shared.set(h, entry);
    }
  }
  const usedImages = new Set(
    guidePages.flatMap((p) => p.sections.flatMap((s) => s.images.map((i) => i.exportPath)))
  );
  const listDir = (d: string) =>
    existsSync(path.join(exportDir, d))
      ? readdirSync(path.join(exportDir, d)).map((f) => `${d}/${f}`)
      : [];
  const site: GuideSite = {
    name: pages[0].title.split(/\s[-|–]\s/)[0] || new URL(sourceUrl).hostname,
    sourceUrl,
    pages: guidePages,
    shell: siteShell,
    collections: collections.map((c) => guideCollection(c, byRoute, lookup, files)),
    nav: navNode ? linksIn(navNode, origin) : [],
    footer: footerNode ? linksIn(footerNode, origin) : [],
    sharedSections: [...shared.values()].filter((s) => s.routes.length > 1),
    tokens,
    fonts: extractFontFaces(
      exportDir,
      list.map((p) => p.exportHtml)
    ),
    exportFiles: {
      images: listDir('assets/images')
        .filter((f) => !usedImages.has(f))
        .map((f) => ({
          exportPath: f,
          suggested: `/images/${path.basename(f)}`,
          width: 0,
          height: 0,
          alt: '',
        })),
      videos: listDir('assets/videos'),
      data: listDir('data'),
    },
  };

  await fs.writeFile(path.join(guideDir, 'site.md'), renderSiteMd(site));
  await fs.writeFile(path.join(guideDir, 'files.md'), renderFilesMd(site));
  await fs.writeFile(path.join(guideDir, 'content.md'), renderContentMd(site));
  await fs.writeFile(path.join(guideDir, 'tokens.md'), renderTokensMd(site));
  await fs.writeFile(path.join(guideDir, 'README.md'), renderReadme(site));
  await fs.writeFile(path.join(guideDir, 'checklist.md'), CHECKLIST_MD);
  await fs.mkdir(path.join(guideDir, 'scripts'), { recursive: true });
  await fs.writeFile(path.join(guideDir, 'scripts', 'compare.mjs'), COMPARE_MJS);
  await fs.rm(path.join(guideDir, '.capture'), { recursive: true, force: true });
  return renderPlan(site);
}

/** Writes AGENTS.md, CLAUDE.md and ai-guide/ into a Framer export. Never throws. */
export async function runAiGuide(
  exportDir: string,
  sourceUrl: string,
  log: (m: string) => void
): Promise<{ ok: boolean; guideDir: string }> {
  const guideDir = path.join(exportDir, 'ai-guide');
  const buildDir = path.join(exportDir, '.ai-guide-build');
  let built = false;
  try {
    log('Writing the AI guide...');
    const plan = await build(exportDir, sourceUrl, buildDir, log);
    built = true;
    await swapIn(buildDir, guideDir);
    built = false;
    await fs.rm(path.join(guideDir, 'ERROR.md'), { force: true });
    const planFile = await writePlanFile(guideDir, plan);
    if (planFile === 'plan.new.md')
      log(
        'AI guide: plan.md has ticked steps, so the new plan was written to ai-guide/plan.new.md'
      );
    await fs.writeFile(path.join(exportDir, 'AGENTS.md'), AGENTS_MD);
    await fs.writeFile(path.join(exportDir, 'CLAUDE.md'), AGENTS_MD);
    log(
      `AI guide written to ${guideDir} — open the export folder in Claude Code or agy (see ai-guide/README.md)`
    );
    return { ok: true, guideDir };
  } catch (e) {
    const err = e as Error;
    await fs.mkdir(guideDir, { recursive: true }).catch(() => undefined);
    await fs
      .writeFile(
        path.join(guideDir, 'ERROR.md'),
        `# The AI guide could not be written\n\n${err.message}\n\n\`\`\`\n${err.stack ?? ''}\n\`\`\`\n\nThe HTML export itself is complete and usable.\n`
      )
      .catch(() => undefined);
    warn(`AI guide failed: ${err.message} (see ai-guide/ERROR.md)`);
    return { ok: false, guideDir };
  } finally {
    // A guide that was built but could not be moved in is kept, so nothing is lost.
    if (!built) await fs.rm(buildDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** `framer-export ai-guide <export-dir>`. Returns the process exit code. */
export async function runAiGuideCommand(exportDir: string): Promise<number> {
  let report: { source?: string; platform?: string } | null = null;
  try {
    report = JSON.parse(await fs.readFile(path.join(exportDir, 'export-report.json'), 'utf8'));
  } catch {}
  if (!report?.source) {
    warn(
      `${exportDir} is not a framer-export output folder (export-report.json missing or invalid)`
    );
    return 1;
  }
  if (report.platform !== 'framer') {
    warn(
      `The AI guide supports Framer exports only; this export is "${report.platform ?? 'unknown'}"`
    );
    return 1;
  }
  const { ok } = await runAiGuide(exportDir, report.source, (m) => console.log(`  ${m}`));
  return ok ? 0 : 1;
}
