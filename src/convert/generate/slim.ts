import { kebab } from '../stages/scaffold/files.js';

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
