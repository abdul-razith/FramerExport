import { GLOBAL_CLASS } from './components.js';

/** Split `text` into top-level `prelude { body }` blocks (and stray statements). */
function blocks(text: string): Array<{ prelude: string; body: string | null }> {
  const out: Array<{ prelude: string; body: string | null }> = [];
  let i = 0;
  let start = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === ';') {
      out.push({ prelude: text.slice(start, i).trim(), body: null });
      start = i + 1;
    } else if (c === '{') {
      let depth = 1;
      let j = i + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      out.push({ prelude: text.slice(start, i).trim(), body: text.slice(i + 1, j - 1) });
      i = j - 1;
      start = j;
    }
    i++;
  }
  return out;
}

function splitSelectors(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of list) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function onlyGlobalClasses(selector: string): boolean {
  if (selector.includes('#')) return false;
  const classes = [...selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]!);
  return classes.length > 0 && classes.every((c) => GLOBAL_CLASS.test(c));
}

function filter(css: string): string {
  const out: string[] = [];
  for (const { prelude, body } of blocks(css)) {
    if (body === null || !prelude) continue;
    if (prelude.startsWith('@')) {
      if (/^@(media|supports)\b/i.test(prelude)) {
        const inner = filter(body);
        if (inner) out.push(`${prelude} {\n${inner}\n}`);
      }
      continue;
    }
    const keep = splitSelectors(prelude).filter(onlyGlobalClasses);
    if (keep.length) out.push(`${keep.join(', ')} {${body}}`);
  }
  return out.join('\n');
}

/** CSS rules from the page's <style> blocks whose selectors use only Framer global classes. */
export function extractBaseCss(html: string): string {
  const parts: string[] = [];
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    const css = m[1]!.replace(/\/\*[\s\S]*?\*\//g, '');
    const kept = filter(css);
    if (kept) parts.push(kept);
  }
  return parts.join('\n');
}
