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

/**
 * Page-side function `annotate(root: Element, plan: SnapshotPlan): { unmatchedMotion: string[] }`.
 * Applies `data-variant`, `data-motion`, `data-cms`, `data-script-drawn`.
 */
export const ANNOTATE_SRC = String.raw`(function () {
  return function annotate(root, plan) {
    if (!root || !plan) return { unmatchedMotion: [] };

    // 1. data-variant
    var hiddenMap = plan.hiddenMap || {};
    var hiddenKeys = Object.keys(hiddenMap);
    if (hiddenKeys.length > 0) {
      var elements = Array.prototype.slice.call(root.querySelectorAll('[class]'));
      if (root.hasAttribute && root.hasAttribute('class')) elements.unshift(root);
      var allBp = ['desktop', 'tablet', 'phone'];
      for (var e = 0; e < elements.length; e++) {
        var el = elements[e];
        var classAttr = el.getAttribute('class') || '';
        var classNames = classAttr.split(/\s+/);
        var hidden = {};
        var hasHiddenClass = false;
        for (var i = 0; i < classNames.length; i++) {
          var c = classNames[i].replace(/^\./, '');
          var bps = hiddenMap[c];
          if (bps && bps.length > 0) {
            hasHiddenClass = true;
            for (var b = 0; b < bps.length; b++) {
              hidden[bps[b]] = true;
            }
          }
        }
        if (hasHiddenClass) {
          var visible = [];
          for (var b = 0; b < allBp.length; b++) {
            if (!hidden[allBp[b]]) visible.push(allBp[b]);
          }
          el.setAttribute('data-variant', visible.join(' '));
        }
      }
    }

    // 2. data-motion
    var unmatchedMotion = [];
    var motionList = plan.motion || [];
    for (var m = 0; m < motionList.length; m++) {
      var item = motionList[m];
      if (!item || !item.id) continue;
      var el = null;
      if (item.selector) {
        try {
          if (root.matches && root.matches(item.selector)) {
            el = root;
          } else {
            el = root.querySelector(item.selector);
          }
        } catch (err) {}
        if (!el) {
          try {
            el = document.querySelector(item.selector);
          } catch (err) {}
        }
      }
      if (el) {
        var prevMotion = el.getAttribute('data-motion');
        el.setAttribute('data-motion', prevMotion ? prevMotion + ' ' + item.id : item.id);
      } else {
        unmatchedMotion.push(item.id);
      }
    }

    // 3. data-cms
    var cmsList = plan.cms || [];
    for (var c = 0; c < cmsList.length; c++) {
      var entry = cmsList[c];
      if (!entry || !entry.field || !entry.value) continue;
      var targetVal = entry.value.trim();
      if (!targetVal) continue;

      var allEls = Array.prototype.slice.call(root.querySelectorAll('*'));
      if (root.textContent && root.textContent.trim() === targetVal) allEls.unshift(root);

      for (var i = 0; i < allEls.length; i++) {
        var el = allEls[i];
        if ((el.textContent || '').trim() === targetVal) {
          var hasChildMatch = false;
          for (var k = 0; k < el.children.length; k++) {
            if ((el.children[k].textContent || '').trim() === targetVal) {
              hasChildMatch = true;
              break;
            }
          }
          if (!hasChildMatch) {
            var prevCms = el.getAttribute('data-cms');
            el.setAttribute('data-cms', prevCms ? prevCms + ' ' + entry.field : entry.field);
          }
        }
      }
    }

    // 4. data-script-drawn
    var sdList = plan.scriptDrawn || [];
    for (var s = 0; s < sdList.length; s++) {
      var sd = sdList[s];
      if (!sd || !sd.id) continue;
      var el = null;
      if (typeof document.elementFromPoint === 'function' && typeof sd.x === 'number' && typeof sd.y === 'number') {
        // sd.x / sd.y are document coordinates: scroll the point into view, then convert to viewport coordinates
        try {
          var vh = window.innerHeight || 0;
          var vw = window.innerWidth || 0;
          window.scrollTo(Math.max(0, sd.x - vw / 2), Math.max(0, sd.y - vh / 2));
          el = document.elementFromPoint(sd.x - (window.scrollX || 0), sd.y - (window.scrollY || 0));
        } catch (err) {}
      }
      if (el) {
        var prevSd = el.getAttribute('data-script-drawn');
        el.setAttribute('data-script-drawn', prevSd ? prevSd + ' ' + sd.id : sd.id);
      }
    }

    if (sdList.length > 0) {
      try { window.scrollTo(0, 0); } catch (err) {}
    }

    return { unmatchedMotion: unmatchedMotion };
  };
})()`;

