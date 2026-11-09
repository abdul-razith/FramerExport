import { parse } from 'parse5';
import type { AnimationSpec, Transform } from '../model.js';

type P5Node = {
  nodeName: string;
  tagName?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: P5Node[];
};

const PX = /^(-?[\d.]+)px$/;

function px(value: string | undefined): number | undefined {
  const m = value?.trim().match(PX);
  return m ? Number(m[1]) : undefined;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Decodes a CSS transform into motion-friendly components; identity parts are omitted. */
export function parseTransform(t: string): Omit<Transform, 'opacity'> {
  const out: Omit<Transform, 'opacity'> = {};
  if (!t || t === 'none') return out;
  for (const [, fn, rawArgs] of t.matchAll(/([a-zA-Z0-9]+)\(([^)]*)\)/g)) {
    const args = rawArgs.split(',').map((a) => a.trim());
    switch (fn) {
      case 'translate':
      case 'translate3d': {
        const x = px(args[0]);
        const y = px(args[1]);
        if (x) out.x = x;
        if (y) out.y = y;
        break;
      }
      case 'translateX': {
        const x = px(args[0]);
        if (x) out.x = x;
        break;
      }
      case 'translateY': {
        const y = px(args[0]);
        if (y) out.y = y;
        break;
      }
      case 'scale': {
        const s = Number(args[0]);
        if (Number.isFinite(s) && s !== 1) out.scale = s;
        break;
      }
      case 'rotate': {
        const r = parseFloat(args[0]);
        if (Number.isFinite(r) && r !== 0) out.rotate = r;
        break;
      }
      case 'matrix': {
        const [a, b, , , e, f] = args.map(Number);
        const scale = round(Math.hypot(a, b));
        const rotate = round((Math.atan2(b, a) * 180) / Math.PI);
        if (e) out.x = e;
        if (f) out.y = f;
        if (scale !== 1) out.scale = scale;
        if (rotate) out.rotate = rotate;
        break;
      }
    }
  }
  return out;
}

function inlineStyle(node: P5Node): Record<string, string> {
  const raw = node.attrs?.find((a) => a.name === 'style')?.value ?? '';
  const style: Record<string, string> = {};
  for (const decl of raw.split(';')) {
    const idx = decl.indexOf(':');
    if (idx === -1) continue;
    style[decl.slice(0, idx).trim().toLowerCase()] = decl.slice(idx + 1).trim();
  }
  return style;
}

function startState(node: P5Node): Transform | undefined {
  const style = inlineStyle(node);
  const from: Transform = {};
  if (style.opacity !== undefined) {
    const o = Number(style.opacity);
    if (Number.isFinite(o) && o < 1) from.opacity = o <= 0.01 ? 0 : o;
  }
  Object.assign(from, parseTransform(style.transform ?? ''));
  return Object.keys(from).length ? from : undefined;
}

const elementChildren = (n: P5Node): P5Node[] => (n.childNodes ?? []).filter((c) => !!c.tagName);

function segment(node: P5Node, index: number): string {
  const name = node.attrs?.find((a) => a.name === 'data-framer-name')?.value;
  return `${node.tagName}${name ? `[${name}]` : ''}:${index}`;
}

function isLetter(node: P5Node): boolean {
  return (
    node.tagName === 'span' &&
    /display\s*:\s*inline-block/.test(node.attrs?.find((a) => a.name === 'style')?.value ?? '') &&
    !!startState(node)
  );
}

/** Animation start states from pre-hydration export HTML, keyed like the browser serializer. */
export function extractStartStates(exportHtml: string): Map<string, AnimationSpec> {
  const states = new Map<string, AnimationSpec>();
  const doc = parse(exportHtml) as unknown as P5Node;
  const html = elementChildren(doc).find((n) => n.tagName === 'html');
  const body = html && elementChildren(html).find((n) => n.tagName === 'body');
  if (!body) return states;

  const walk = (node: P5Node, key: string) => {
    const children = elementChildren(node);
    const letters = children.filter(isLetter);
    if (letters.length >= 3) {
      states.set(key, { kind: 'split-text', from: startState(letters[0])! });
    } else {
      const from = startState(node);
      if (from && key !== 'body:0') states.set(key, { kind: 'reveal', from });
    }
    children.forEach((child, i) => {
      if (letters.length >= 3 && letters.includes(child)) return;
      walk(child, `${key}/${segment(child, i)}`);
    });
  };
  walk(body, 'body:0');
  return states;
}
