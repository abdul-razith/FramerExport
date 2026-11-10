import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { applyStealth } from '../exporter/capture.js';
import {
  BREAKPOINTS,
  CAPTURE_WIDTHS,
  type Breakpoint,
  type ConversionContext,
  type RawNode,
  type Style,
} from './model.js';

export interface ExportPage {
  route: string;
  url: string;
  exportHtml: string;
}

export interface CapturedPage {
  route: string;
  url: string;
  title: string;
  meta: Record<string, string>;
  trees: Record<Breakpoint, RawNode>;
  hover: { key: string; style: Style }[];
  screenshots: Record<Breakpoint, string>;
}

export const STYLE_PROPS: readonly string[] = [
  'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index',
  'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis',
  'justify-content', 'align-items', 'align-self',
  'gap', 'row-gap', 'column-gap', 'grid-template-columns', 'grid-template-rows',
  'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
  'text-align', 'text-transform', 'text-decoration-line', 'white-space', 'color',
  'background-color', 'background-image',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-top-left-radius', 'border-top-right-radius',
  'border-bottom-right-radius', 'border-bottom-left-radius',
  'box-shadow', 'opacity', 'transform', 'overflow-x', 'overflow-y',
  'object-fit', 'object-position', 'aspect-ratio',
  'filter', 'backdrop-filter', 'mix-blend-mode', 'clip-path', 'mask-image',
];

/** Inherited properties are dropped when equal to the parent's value instead of the tag default. */
const INHERITED = [
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
  'text-align', 'text-transform', 'white-space', 'color',
];

const VIEWPORT_HEIGHT = 900;
/** Half a screen per step, paused long enough for in-view (JavaScript-driven) animations to play. */
const SCROLL_STEP_FRACTION = 0.5;
const SCROLL_DELAY = 350;

function routeSlug(route: string): string {
  return route === '/' ? 'index' : route.slice(1).replace(/\//g, '_');
}

/** Index + subpages of an export folder, with the original URL of each page. */
export function listExportPages(exportDir: string, sourceUrl: string): ExportPage[] {
  const pages: ExportPage[] = [
    {
      route: '/',
      url: new URL('/', sourceUrl).href,
      exportHtml: fs.readFileSync(path.join(exportDir, 'index.html'), 'utf8'),
    },
  ];
  const subDir = path.join(exportDir, 'subpages');
  const files = fs.existsSync(subDir)
    ? fs.readdirSync(subDir).filter((f) => f.endsWith('.html')).sort()
    : [];
  for (const file of files) {
    const html = fs.readFileSync(path.join(subDir, file), 'utf8');
    const canonical =
      html.match(/<link\b[^>]*\brel=["']canonical["'][^>]*\bhref=["']([^"']+)["']/i)?.[1] ??
      html.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']canonical["']/i)?.[1];
    let pathname = '/' + file.replace(/\.html$/, '').replace(/_/g, '/');
    if (canonical) {
      try {
        pathname = new URL(canonical, sourceUrl).pathname;
      } catch {}
    }
    pathname = pathname.replace(/\/+$/, '') || '/';
    if (pathname === '/') continue;
    pages.push({ route: pathname, url: new URL(pathname, sourceUrl).href, exportHtml: html });
  }
  return pages.sort((a, b) => (a.route === '/' ? -1 : b.route === '/' ? 1 : a.route.localeCompare(b.route)));
}

/** Wait for content, trigger lazy loading by scrolling, then let finite animations settle. */
export async function settlePage(page: Page): Promise<void> {
  try {
    await page.waitForFunction(
      () => {
        const root = document.querySelector('#main') || document.body;
        return !!root && root.children.length > 0;
      },
      { timeout: 10000, polling: 200 }
    );
  } catch {}
  await page.evaluate(
    async ({ step, delay }) => {
      const started = Date.now();
      let y = 0;
      while (Date.now() - started < 20000) {
        const max = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
        y += Math.max(200, Math.round(window.innerHeight * step));
        window.scrollTo({ top: y, behavior: 'instant' });
        await new Promise((r) => setTimeout(r, delay));
        if (y >= max) break;
      }
      window.scrollTo({ top: 0, behavior: 'instant' });
    },
    { step: SCROLL_STEP_FRACTION, delay: SCROLL_DELAY }
  );
  await page.evaluate(async () => {
    const finite = document
      .getAnimations()
      .filter((a) => a.effect?.getTiming().iterations !== Infinity);
    await Promise.race([
      Promise.all(finite.map((a) => a.finished.catch(() => undefined))),
      new Promise((r) => setTimeout(r, 5000)),
    ]);
    // Framer animates with JavaScript, which getAnimations() cannot see: give it time to finish.
    await new Promise((r) => setTimeout(r, 1500));
  });
}

interface BrowserCapture {
  tree: RawNode;
  hover: { key: string; style: Style }[];
  title: string;
  meta: Record<string, string>;
}

/** Runs inside the page. Must be self-contained (serialized by Puppeteer). */
function serializeInPage(args: { props: string[]; inherited: string[]; withHover: boolean }) {
  const { props, inherited, withHover } = args;
  const inheritedSet = new Set(inherited);
  const rootStyle = getComputedStyle(document.documentElement);
  const resolveVars = (value: string): string =>
    value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, (_m, name: string, fallback?: string) => {
      const v = rootStyle.getPropertyValue(name).trim();
      return v || (fallback ?? '').trim();
    });

  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(frame);
  const frameDoc = frame.contentDocument!;
  const defaults = new Map<string, Record<string, string>>();
  const defaultsFor = (tag: string): Record<string, string> => {
    let d = defaults.get(tag);
    if (!d) {
      const el = frameDoc.createElement(tag);
      if (tag === 'a' || tag === 'area') el.setAttribute('href', '#');
      frameDoc.body.appendChild(el);
      const cs = frame.contentWindow!.getComputedStyle(el);
      d = {};
      for (const p of props) d[p] = cs.getPropertyValue(p);
      el.remove();
      defaults.set(tag, d);
    }
    return d;
  };

  // Which inherited properties does each tag really inherit? (<a> resets color, <h1> font-weight…)
  const probe = frameDoc.createElement('div');
  probe.style.cssText =
    'color: rgb(1, 2, 3); font-family: probefont; font-size: 13px; font-weight: 300; font-style: oblique;' +
    ' line-height: 17px; letter-spacing: 3px; text-align: right; text-transform: lowercase; white-space: pre;';
  frameDoc.body.appendChild(probe);
  const inheritance = new Map<string, Record<string, boolean>>();
  const inheritsFor = (tag: string): Record<string, boolean> => {
    let r = inheritance.get(tag);
    if (!r) {
      const el = frameDoc.createElement(tag);
      if (tag === 'a' || tag === 'area') el.setAttribute('href', '#');
      probe.appendChild(el);
      const cs = frame.contentWindow!.getComputedStyle(el);
      const ps = frame.contentWindow!.getComputedStyle(probe);
      r = {};
      for (const p of inherited) r[p] = cs.getPropertyValue(p) === ps.getPropertyValue(p);
      el.remove();
      inheritance.set(tag, r);
    }
    return r;
  };

  const keys = new WeakMap<Element, string>();
  const isAuto = (el: HTMLElement, prop: 'width' | 'height'): boolean => {
    const before = prop === 'width' ? el.offsetWidth : el.offsetHeight;
    const prev = el.style.getPropertyValue(prop);
    const prevPriority = el.style.getPropertyPriority(prop);
    el.style.setProperty(prop, 'auto', 'important');
    const after = prop === 'width' ? el.offsetWidth : el.offsetHeight;
    if (prev) el.style.setProperty(prop, prev, prevPriority);
    else el.style.removeProperty(prop);
    return before === after;
  };

  const walk = (el: Element, parentKey: string, index: number, parentStyle: CSSStyleDeclaration | null): any => {
    const tag = el.tagName.toLowerCase();
    const framerName = el.getAttribute('data-framer-name') || undefined;
    const segment = `${tag}${framerName ? `[${framerName}]` : ''}:${index}`;
    const key = parentKey ? `${parentKey}/${segment}` : segment;
    keys.set(el, key);
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const visible = cs.display !== 'none' && cs.visibility !== 'hidden';
    const attrs: Record<string, string> = {};
    for (const a of Array.from(el.attributes)) {
      if (a.name === 'style') continue;
      attrs[a.name] = a.value;
    }
    if (el instanceof HTMLImageElement) {
      attrs.src = el.currentSrc || el.src;
      attrs['data-natural-width'] = String(el.naturalWidth);
      attrs['data-natural-height'] = String(el.naturalHeight);
    }
    if (el instanceof HTMLAnchorElement && el.getAttribute('href')) attrs.href = el.href;
    const node: any = {
      key,
      tag,
      attrs,
      framerName,
      box: { x: rect.x + window.scrollX, y: rect.y + window.scrollY, w: rect.width, h: rect.height },
      styles: {},
      visible,
      children: [],
    };
    if (!visible) return node;

    const defs = defaultsFor(tag);
    const inherits = inheritsFor(tag);
    const parentDisplay = parentStyle?.getPropertyValue('display') ?? '';
    for (const p of props) {
      const v = cs.getPropertyValue(p);
      if (!v) continue;
      if (inheritedSet.has(p) && parentStyle && inherits[p]) {
        if (parentStyle.getPropertyValue(p) === v) continue;
      } else if (defs[p] === v) continue;
      // Flex/grid items are "blockified": display:block there is not an authored value.
      // Chrome resolves top/right/bottom/left:auto to 0px on relative elements; both render the same.
      if (v === '0px' && (p === 'top' || p === 'right' || p === 'bottom' || p === 'left') && cs.position === 'relative') continue;
      if (p === 'display' && v === 'block' && /flex|grid/.test(parentDisplay) && defs.display.startsWith('inline')) continue;
      node.styles[p] = v;
    }
    // Elements with no in-flow content cannot size themselves: their explicit size is authored.
    const hasFlowContent =
      Array.from(el.childNodes).some((c) => c.nodeType === Node.TEXT_NODE && (c.textContent ?? '').trim()) ||
      Array.from(el.children).some((c) => {
        const s = getComputedStyle(c);
        return s.display !== 'none' && s.position !== 'absolute' && s.position !== 'fixed';
      });
    if (el instanceof HTMLElement && !(el instanceof HTMLImageElement) && hasFlowContent) {
      if (node.styles.width && isAuto(el, 'width')) delete node.styles.width;
      if (node.styles.height && isAuto(el, 'height')) delete node.styles.height;
    }
    const after = getComputedStyle(el, '::after');
    if (after.content && after.content !== 'none' && after.content !== 'normal') {
      const widths = ['top', 'right', 'bottom', 'left'].map((s) => after.getPropertyValue(`border-${s}-width`));
      const style = after.getPropertyValue('border-top-style');
      if (widths.some((w) => parseFloat(w) > 0) && style !== 'none') {
        node.afterBorder = { widths, style, color: after.getPropertyValue('border-top-color') };
      }
    }

    if (tag === 'svg') {
      attrs['data-svg'] = el.outerHTML;
      return node;
    }
    let text = '';
    const inline: (string | number)[] = [];
    let hasText = false;
    const skip = ['script', 'style', 'link', 'meta', 'noscript', 'template'];
    const elements = Array.from(el.children);
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const t = (child.textContent ?? '').replace(/\s+/g, ' ');
        text += child.textContent ?? '';
        if (t.trim()) hasText = true;
        if (!t) continue;
        if (typeof inline[inline.length - 1] === 'string') inline[inline.length - 1] += t;
        else inline.push(t);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const c = child as Element;
        if (c === frame || skip.includes(c.tagName.toLowerCase())) continue;
        inline.push(node.children.length);
        node.children.push(walk(c, key, elements.indexOf(c), cs));
      }
    }
    const trimmed = text.replace(/\s+/g, ' ').trim();
    if (trimmed) node.text = trimmed;
    // Keep the ordered form only where text and inline elements share a line.
    const INLINE_TAGS = ['span', 'a', 'img', 'strong', 'em', 'b', 'i', 'br', 'svg', 'code', 'small'];
    const inlineChildren = node.children.some(
      (c: any) => c.visible && /^inline/.test(c.styles.display ?? (INLINE_TAGS.includes(c.tag) ? 'inline' : ''))
    );
    if (node.children.length && (hasText || inlineChildren)) {
      if (typeof inline[0] === 'string') inline[0] = inline[0].replace(/^ /, '');
      const last = inline.length - 1;
      if (typeof inline[last] === 'string') inline[last] = (inline[last] as string).replace(/ $/, '');
      node.inline = inline.filter((x) => x !== '');
    }
    return node;
  };

  const tree = walk(document.body, '', 0, null);

  const hover: { key: string; style: Record<string, string> }[] = [];
  if (withHover) {
    const collect = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSStyleRule && rule.selectorText.includes(':hover')) {
          for (const sel of rule.selectorText.split(',')) {
            if (!sel.includes(':hover')) continue;
            const base = sel.replace(/:hover/g, '').trim() || '*';
            let matches: Element[] = [];
            try {
              matches = Array.from(document.querySelectorAll(base));
            } catch {
              continue;
            }
            const style: Record<string, string> = {};
            for (let i = 0; i < rule.style.length; i++) {
              const name = rule.style.item(i);
              style[name] = resolveVars(rule.style.getPropertyValue(name).trim());
            }
            for (const m of matches) {
              const k = keys.get(m);
              if (k) hover.push({ key: k, style });
            }
          }
        } else if ('cssRules' in rule && (rule as CSSGroupingRule).cssRules) {
          collect((rule as CSSGroupingRule).cssRules);
        }
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        collect(sheet.cssRules);
      } catch {}
    }
  }
  frame.remove();

  const meta: Record<string, string> = {};
  for (const m of Array.from(document.querySelectorAll('meta[name], meta[property]'))) {
    const name = m.getAttribute('name') || m.getAttribute('property')!;
    const content = m.getAttribute('content');
    if (content !== null && !['viewport', 'robots', 'generator'].includes(name)) meta[name] = content;
  }
  return { tree, hover, title: document.title, meta };
}

/** Records transform/opacity per key at three scroll positions. Runs in the page. */
function sampleScrollInPage(fraction: number) {
  const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  window.scrollTo({ top: max * fraction, behavior: 'instant' });
  const out: Record<string, { transform: string; opacity: string }> = {};
  const walk = (el: Element, parentKey: string, index: number) => {
    const tag = el.tagName.toLowerCase();
    if (['script', 'style', 'link', 'meta', 'noscript', 'template', 'iframe'].includes(tag)) return;
    const framerName = el.getAttribute('data-framer-name');
    const segment = `${tag}${framerName ? `[${framerName}]` : ''}:${index}`;
    const key = parentKey ? `${parentKey}/${segment}` : segment;
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return;
    out[key] = { transform: cs.transform, opacity: cs.opacity };
    if (tag === 'svg') return;
    Array.from(el.children).forEach((c, i) => walk(c, key, i));
  };
  walk(document.body, '', 0);
  return out;
}

function attachScrollSamples(
  node: RawNode,
  samples: Record<string, { transform: string; opacity: string }>[]
): void {
  const values = samples.map((s) => s[node.key]).filter(Boolean);
  if (
    values.length === samples.length &&
    values.some((v) => v.transform !== values[0].transform || v.opacity !== values[0].opacity)
  ) {
    node.scrollSamples = values.map((v) => ({ transform: v.transform, opacity: v.opacity }));
  }
  node.children.forEach((c) => attachScrollSamples(c, samples));
}

async function captureOne(
  browser: Browser,
  target: ExportPage,
  ctx: ConversionContext
): Promise<CapturedPage> {
  const page = await browser.newPage();
  try {
    await applyStealth(page, browser);
    // Bundlers (tsx/esbuild keepNames) wrap named functions in __name(); page.evaluate
    // serializes those functions into the page, where the helper must exist.
    await page.evaluateOnNewDocument('globalThis.__name = (fn) => fn;');
    const trees = {} as Record<Breakpoint, RawNode>;
    const screenshots = {} as Record<Breakpoint, string>;
    let first: BrowserCapture | undefined;
    const shotDir = path.join(ctx.cacheDir, 'screens');
    await fsp.mkdir(shotDir, { recursive: true });
    for (const bp of BREAKPOINTS) {
      await page.setViewport({ width: CAPTURE_WIDTHS[bp], height: VIEWPORT_HEIGHT });
      const response = await page.goto(target.url, { waitUntil: 'networkidle2', timeout: 30000 });
      if (response && response.status() >= 400) {
        throw new Error(`HTTP ${response.status()} for ${target.url}`);
      }
      await settlePage(page);
      let samples: Record<string, { transform: string; opacity: string }>[] = [];
      if (bp === 'base') {
        for (const fraction of [0, 0.5, 1]) {
          samples.push(await page.evaluate(sampleScrollInPage, fraction));
        }
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      }
      const result = (await page.evaluate(serializeInPage, {
        props: [...STYLE_PROPS],
        inherited: INHERITED,
        withHover: bp === 'base',
      })) as BrowserCapture;
      if (samples.length) attachScrollSamples(result.tree, samples);
      trees[bp] = result.tree;
      if (bp === 'base') first = result;
      const shot = path.join(shotDir, `${routeSlug(target.route)}-${bp}.png`);
      await page.screenshot({ path: shot as `${string}.png`, fullPage: true });
      screenshots[bp] = shot;
    }
    return {
      route: target.route,
      url: target.url,
      title: first!.title,
      meta: first!.meta,
      trees,
      hover: first!.hover,
      screenshots,
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Captures every page at the three widths. A page that fails twice is reported, not thrown. */
export async function capturePages(
  pages: ExportPage[],
  ctx: ConversionContext
): Promise<{ captured: CapturedPage[]; failed: { route: string; error: string }[] }> {
  const captured: CapturedPage[] = [];
  const failed: { route: string; error: string }[] = [];
  const browser = await puppeteer.launch({
    headless: true,
    protocolTimeout: 120000,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  try {
    for (const target of pages) {
      ctx.log(`Capturing ${target.route}`);
      let lastError: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          captured.push(await captureOne(browser, target, ctx));
          lastError = undefined;
          break;
        } catch (e) {
          lastError = e;
        }
      }
      if (lastError) failed.push({ route: target.route, error: (lastError as Error).message });
    }
  } finally {
    await browser.close();
  }
  await fsp.mkdir(ctx.cacheDir, { recursive: true });
  await fsp.writeFile(path.join(ctx.cacheDir, 'capture.json'), JSON.stringify(captured));
  return { captured, failed };
}
