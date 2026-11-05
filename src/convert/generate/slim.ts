import { kebab } from '../stages/scaffold/files.js';

/**
 * Page-side function `slim(root: Element): number` (count of removed properties).
 * For each element with inline style, removes each property; keeps the removal only if
 * every computed property of that element is unchanged; otherwise restores it.
 */
export const SLIM_SRC = String.raw`(function () {
  return function slim(root) {
    if (!root) return 0;
    var elements = [];
    if (root.getAttribute && root.getAttribute('style')) elements.push(root);
    var styled = root.querySelectorAll ? root.querySelectorAll('[style]') : [];
    for (var k = 0; k < styled.length; k++) elements.push(styled[k]);

    var removed = 0;
    for (var e = 0; e < elements.length; e++) {
      var el = elements[e];
      var style = el.style;
      if (!style || !style.length) continue;

      var props = [];
      for (var i = 0; i < style.length; i++) {
        props.push(style[i]);
      }

      for (var i = 0; i < props.length; i++) {
        var prop = props[i];
        var cs = window.getComputedStyle(el);
        var beforeValues = [];
        for (var j = 0; j < cs.length; j++) {
          beforeValues.push(cs.getPropertyValue(cs[j]));
        }
        var beforeVar = prop.indexOf('--') === 0 ? cs.getPropertyValue(prop) : null;
        var val = style.getPropertyValue(prop);
        var priority = style.getPropertyPriority(prop);

        style.removeProperty(prop);

        var changed = false;
        var csAfter = window.getComputedStyle(el);
        if (beforeVar !== null && csAfter.getPropertyValue(prop) !== beforeVar) {
          changed = true;
        } else {
          for (var j = 0; j < csAfter.length; j++) {
            if (csAfter.getPropertyValue(csAfter[j]) !== beforeValues[j]) {
              changed = true;
              break;
            }
          }
        }

        if (changed) {
          style.setProperty(prop, val, priority);
        } else {
          removed++;
        }
      }

      if (style.length === 0) {
        el.removeAttribute('style');
      }
    }
    return removed;
  };
})()`;

/**
 * Rewrites Framer color token variables (e.g. `var(--token-4f4e-12, rgb(17, 18, 18))`)
 * in generated JSX to Tailwind v4 theme color variables (`var(--color-<kebab-name>)`).
 *
 * Tokens not present in `tokenMap` are left unchanged.
 */
export function rewriteTokens(jsx: string, tokenMap: Record<string, string>): string {
  if (!jsx || !tokenMap || Object.keys(tokenMap).length === 0) return jsx;

  const VAR_PREFIX = 'var(';
  let result = '';
  let i = 0;

  while (i < jsx.length) {
    const idx = jsx.indexOf(VAR_PREFIX, i);
    if (idx === -1) {
      result += jsx.slice(i);
      break;
    }

    result += jsx.slice(i, idx);

    // Find balanced closing ')' for this var(...)
    let depth = 1;
    let j = idx + VAR_PREFIX.length;
    while (j < jsx.length && depth > 0) {
      if (jsx[j] === '(') depth++;
      else if (jsx[j] === ')') depth--;
      j++;
    }

    if (depth !== 0) {
      result += jsx.slice(idx, idx + VAR_PREFIX.length);
      i = idx + VAR_PREFIX.length;
      continue;
    }

    const fullVar = jsx.slice(idx, j);
    const inside = jsx.slice(idx + VAR_PREFIX.length, j - 1).trim();
    const commaIdx = inside.indexOf(',');
    const token = (commaIdx === -1 ? inside : inside.slice(0, commaIdx)).trim();

    const name =
      tokenMap[token] ??
      (token.startsWith('--') ? tokenMap[token.slice(2)] : tokenMap[`--${token}`]);

    if (name) {
      result += `var(--color-${kebab(name)})`;
    } else {
      result += fullVar;
    }

    i = j;
  }

  return result;
}
