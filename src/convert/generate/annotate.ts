export type Breakpoint = 'desktop' | 'tablet' | 'phone';

export const ALL_BREAKPOINTS: readonly Breakpoint[] = ['desktop', 'tablet', 'phone'] as const;

function classifyQuery(query: string, md: number, lg: number): Breakpoint[] {
  const minMatch = /min-width:\s*([\d.]+)px/i.exec(query);
  const maxMatch = /max-width:\s*([\d.]+)px/i.exec(query);
  const minW = minMatch ? parseFloat(minMatch[1]) : null;
  const maxW = maxMatch ? parseFloat(maxMatch[1]) : null;

  const bps = new Set<Breakpoint>();

  if (minW !== null && maxW !== null) {
    if (minW >= md && maxW < lg) {
      bps.add('tablet');
    } else {
      if (maxW < md) bps.add('phone');
      if (minW >= lg) bps.add('desktop');
      if (minW < lg && maxW >= md) bps.add('tablet');
    }
  } else if (minW !== null) {
    if (minW >= lg) {
      bps.add('desktop');
    } else if (minW >= md) {
      bps.add('desktop');
      bps.add('tablet');
    } else {
      bps.add('desktop');
      bps.add('tablet');
      bps.add('phone');
    }
  } else if (maxW !== null) {
    if (maxW < md) {
      bps.add('phone');
    } else if (maxW < lg) {
      bps.add('tablet');
      bps.add('phone');
    } else {
      bps.add('desktop');
      bps.add('tablet');
      bps.add('phone');
    }
  }

  return ALL_BREAKPOINTS.filter((b) => bps.has(b));
}

/**
 * Parses CSS text for breakpoint media queries and extracts hidden classes
 * mapped to the breakpoints at which they are hidden.
 */
export function hiddenClassMap(
  css: string,
  bp?: { md: number; lg: number },
): Record<string, Breakpoint[]> {
  const md = bp?.md ?? 810;
  const lg = bp?.lg ?? 1200;
  const classBreakpoints = new Map<string, Set<Breakpoint>>();

  let i = 0;
  while (i < css.length) {
    const mediaIdx = css.indexOf('@media', i);
    if (mediaIdx === -1) break;

    const openBrace = css.indexOf('{', mediaIdx);
    if (openBrace === -1) break;

    const query = css.slice(mediaIdx + '@media'.length, openBrace).trim();

    // Find matching closing brace for this @media block
    let depth = 1;
    let j = openBrace + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
      j++;
    }

    if (depth !== 0) break; // malformed CSS

    const mediaBody = css.slice(openBrace + 1, j - 1);
    i = j;

    // Determine breakpoints for this media query
    const subQueries = query.split(',');
    const bps = new Set<Breakpoint>();
    for (const sq of subQueries) {
      for (const b of classifyQuery(sq, md, lg)) {
        bps.add(b);
      }
    }

    if (bps.size === 0) continue;

    // Parse rules inside mediaBody
    const ruleRe = /([^{}]+)\{([^{}]+)\}/g;
    let ruleMatch: RegExpExecArray | null;
    while ((ruleMatch = ruleRe.exec(mediaBody)) !== null) {
      const sel = ruleMatch[1];
      const decls = ruleMatch[2];
      if (!/display\s*:\s*none/i.test(decls)) continue;

      const classes = sel.match(/\.hidden-[\w-]+/g);
      if (!classes) continue;

      for (const cls of classes) {
        const name = cls.slice(1);
        let set = classBreakpoints.get(name);
        if (!set) {
          set = new Set<Breakpoint>();
          classBreakpoints.set(name, set);
        }
        for (const b of bps) set.add(b);
      }
    }
  }

  const result: Record<string, Breakpoint[]> = {};
  for (const [name, set] of classBreakpoints.entries()) {
    result[name] = ALL_BREAKPOINTS.filter((b) => set.has(b));
  }
  return result;
}

/**
 * Computes the visible breakpoint label from an element's class list and the hidden class map.
 * Returns space-joined visible breakpoints in order 'desktop', 'tablet', 'phone',
 * or null when no class is present in the map.
 */
export function variantLabel(
  classes: readonly string[] | string[],
  map: Record<string, readonly Breakpoint[]>,
): string | null {
  const hidden = new Set<Breakpoint>();
  let hasHiddenClass = false;

  for (const c of classes) {
    const name = c.replace(/^\./, '');
    const bps = map[name];
    if (bps && bps.length > 0) {
      hasHiddenClass = true;
      for (const b of bps) {
        hidden.add(b);
      }
    }
  }

  if (!hasHiddenClass) return null;

  const visible = ALL_BREAKPOINTS.filter((b) => !hidden.has(b));
  return visible.join(' ');
}
