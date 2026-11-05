export interface ShellCandidate {
  name: string;
  pages: string[];
  differences: string[];
}

export interface Slot {
  type: 'text' | 'href' | 'src' | 'alt';
  value: string;
}

export interface MaskResult {
  template: string;
  slots: Slot[];
}

const TARGET_ATTRS = new Set(['href', 'src', 'alt']);

/**
 * Normalizes and extracts placeholders from JSX. Replaces text nodes and
 * `href`, `src`, `alt` attribute values with consistent placeholders while
 * recording their values in document order.
 */
export function maskJsx(jsx: string): MaskResult {
  const slots: Slot[] = [];
  let template = '';
  let i = 0;

  while (i < jsx.length) {
    const tagStart = jsx.indexOf('<', i);
    if (tagStart === -1) {
      const raw = jsx.slice(i);
      const text = cleanText(raw);
      if (text !== '') {
        template += '__SHELL_TEXT__';
        slots.push({ type: 'text', value: text });
      }
      break;
    }

    if (tagStart > i) {
      const raw = jsx.slice(i, tagStart);
      const text = cleanText(raw);
      if (text !== '') {
        template += '__SHELL_TEXT__';
        slots.push({ type: 'text', value: text });
      }
    }

    // HTML comments <!-- ... -->
    if (jsx.startsWith('<!--', tagStart)) {
      const commentEnd = jsx.indexOf('-->', tagStart + 4);
      i = commentEnd === -1 ? jsx.length : commentEnd + 3;
      continue;
    }

    // React fragment <> or </>
    if (jsx.startsWith('<>', tagStart)) {
      template += '<>';
      i = tagStart + 2;
      continue;
    }
    if (jsx.startsWith('</>', tagStart)) {
      template += '</>';
      i = tagStart + 3;
      continue;
    }

    // Scan until end of tag
    let j = tagStart + 1;
    let inQuote: '"' | "'" | null = null;
    let braceDepth = 0;
    while (j < jsx.length) {
      const c = jsx[j];
      if (inQuote) {
        if (c === '\\') {
          j += 2;
          continue;
        }
        if (c === inQuote) {
          inQuote = null;
        }
      } else {
        if (c === '"' || c === "'") {
          inQuote = c;
        } else if (c === '{') {
          braceDepth++;
        } else if (c === '}') {
          braceDepth = Math.max(0, braceDepth - 1);
        } else if (braceDepth === 0 && c === '>') {
          break;
        }
      }
      j++;
    }

    const tagStr = jsx.slice(tagStart, j + 1);
    i = j + 1;

    // Closing tag </tag>
    if (tagStr.startsWith('</')) {
      const tagName = tagStr.slice(2, -1).trim().toLowerCase();
      template += `</${tagName}>`;
      continue;
    }

    // Opening or self-closing tag
    const isSelfClosing = tagStr.endsWith('/>');
    const inner = tagStr.slice(1, isSelfClosing ? -2 : -1).trim();
    const nameMatch = inner.match(/^[a-zA-Z0-9_.:$-]+/);
    if (!nameMatch) {
      template += tagStr;
      continue;
    }

    const tagName = nameMatch[0].toLowerCase();
    const attrsStr = inner.slice(nameMatch[0].length).trim();
    const { templateAttrs, tagSlots } = parseAndMaskAttrs(attrsStr);
    for (const s of tagSlots) {
      slots.push(s);
    }

    template += `<${tagName}${templateAttrs ? ' ' + templateAttrs : ''}${isSelfClosing ? ' />' : '>'}`;
  }

  return { template, slots };
}

function cleanText(raw: string): string {
  let s = raw.trim();
  if (!s) return '';
  // Unwrap JSX comments {/* ... */}
  if (s.startsWith('{/*') && s.endsWith('*/}')) return '';
  // Unwrap JSX string expressions: {"text"} or {'text'}
  if (s.startsWith('{"') && s.endsWith('"}') && s.length >= 4) {
    try {
      s = JSON.parse(s.slice(1, -1));
    } catch {
      s = s.slice(2, -2).replace(/\\"/g, '"');
    }
  } else if (s.startsWith("{'") && s.endsWith("'}") && s.length >= 4) {
    s = s.slice(2, -2).replace(/\\'/g, "'");
  } else if (s.startsWith('{') && s.endsWith('}') && s.length >= 2) {
    s = s.slice(1, -1).trim();
  }
  return s.replace(/\s+/g, ' ').trim();
}

interface AttrItem {
  name: string;
  templateStr: string;
  slot?: Slot;
}

function parseAndMaskAttrs(attrsStr: string): { templateAttrs: string; tagSlots: Slot[] } {
  if (!attrsStr) return { templateAttrs: '', tagSlots: [] };

  const items: AttrItem[] = [];
  let k = 0;

  while (k < attrsStr.length) {
    while (k < attrsStr.length && /\s/.test(attrsStr[k]!)) k++;
    if (k >= attrsStr.length) break;

    const nameMatch = attrsStr.slice(k).match(/^[a-zA-Z0-9_.:$-]+/);
    if (!nameMatch) {
      k++;
      continue;
    }

    const attrName = nameMatch[0];
    k += attrName.length;

    while (k < attrsStr.length && /\s/.test(attrsStr[k]!)) k++;

    if (k >= attrsStr.length || attrsStr[k] !== '=') {
      items.push({
        name: attrName.toLowerCase(),
        templateStr: `${attrName}={true}`,
      });
      continue;
    }

    k++; // skip '='
    while (k < attrsStr.length && /\s/.test(attrsStr[k]!)) k++;
    if (k >= attrsStr.length) {
      items.push({
        name: attrName.toLowerCase(),
        templateStr: `${attrName}={true}`,
      });
      break;
    }

    const first = attrsStr[k];
    let rawVal = '';
    let innerVal = '';

    if (first === '"' || first === "'") {
      let end = k + 1;
      while (end < attrsStr.length) {
        if (attrsStr[end] === '\\') {
          end += 2;
          continue;
        }
        if (attrsStr[end] === first) break;
        end++;
      }
      rawVal = attrsStr.slice(k, end + 1);
      innerVal = attrsStr.slice(k + 1, end);
      k = end + 1;
    } else if (first === '{') {
      let depth = 0;
      let inQ: '"' | "'" | null = null;
      let end = k;
      while (end < attrsStr.length) {
        const c = attrsStr[end];
        if (inQ) {
          if (c === '\\') {
            end += 2;
            continue;
          }
          if (c === inQ) inQ = null;
        } else {
          if (c === '"' || c === "'") inQ = c;
          else if (c === '{') depth++;
          else if (c === '}') {
            depth--;
            if (depth === 0) break;
          }
        }
        end++;
      }
      rawVal = attrsStr.slice(k, end + 1);
      const content = attrsStr.slice(k + 1, end).trim();
      if ((content.startsWith('"') && content.endsWith('"')) || (content.startsWith("'") && content.endsWith("'"))) {
        innerVal = content.slice(1, -1);
      } else {
        innerVal = content;
      }
      k = end + 1;
    } else {
      let end = k;
      while (end < attrsStr.length && !/\s/.test(attrsStr[end]!)) end++;
      rawVal = attrsStr.slice(k, end);
      innerVal = rawVal;
      k = end;
    }

    const lower = attrName.toLowerCase();
    if (TARGET_ATTRS.has(lower)) {
      items.push({
        name: lower,
        templateStr: `${attrName}="__SHELL_ATTR__"`,
        slot: { type: lower as 'href' | 'src' | 'alt', value: innerVal },
      });
    } else {
      items.push({
        name: lower,
        templateStr: `${attrName}=${rawVal}`,
      });
    }
  }

  items.sort((a, b) => a.name.localeCompare(b.name));

  const tagSlots: Slot[] = [];
  for (const it of items) {
    if (it.slot) tagSlots.push(it.slot);
  }

  const templateAttrs = items.map((it) => it.templateStr).join(' ');
  return { templateAttrs, tagSlots };
}

/**
 * Finds sections that appear on 2 or more pages whose JSX is identical,
 * or identical after replacing text nodes and `href` / `src` / `alt` values
 * with placeholders. Excludes `section-<n>` and `page` names.
 */
export function findShellSections(
  pages: Array<{
    route: string;
    sections: Array<{ name: string; jsx: string }>;
  }>
): ShellCandidate[] {
  const namesSeen = new Set<string>();
  const candidateNames: string[] = [];

  for (const page of pages) {
    for (const sec of page.sections) {
      if (!namesSeen.has(sec.name)) {
        namesSeen.add(sec.name);
        candidateNames.push(sec.name);
      }
    }
  }

  const results: ShellCandidate[] = [];

  for (const name of candidateNames) {
    const trimmed = name.trim();
    if (!trimmed || trimmed.toLowerCase() === 'page' || /^section-\d+$/i.test(trimmed)) {
      continue;
    }

    const matchingPages: Array<{ route: string; jsx: string }> = [];
    for (const page of pages) {
      const match = page.sections.find((s) => s.name === name);
      if (match) {
        matchingPages.push({ route: page.route, jsx: match.jsx });
      }
    }

    if (matchingPages.length < 2) {
      continue;
    }

    const baseJsx = matchingPages[0]!.jsx;
    const allStrictlyIdentical = matchingPages.every((p) => p.jsx === baseJsx);

    if (allStrictlyIdentical) {
      results.push({
        name,
        pages: matchingPages.map((p) => p.route),
        differences: [],
      });
      continue;
    }

    const baseMask = maskJsx(baseJsx);
    let matchesStructure = true;
    const differences: string[] = [];

    for (let idx = 1; idx < matchingPages.length; idx++) {
      const inst = matchingPages[idx]!;
      const instMask = maskJsx(inst.jsx);

      if (instMask.template !== baseMask.template) {
        matchesStructure = false;
        break;
      }

      for (let s = 0; s < baseMask.slots.length; s++) {
        const baseVal = baseMask.slots[s]!.value;
        const instVal = instMask.slots[s]!.value;
        if (instVal !== baseVal) {
          differences.push(`${inst.route}: ${instVal}`);
          if (differences.length >= 10) {
            break;
          }
        }
      }
      if (differences.length >= 10) {
        break;
      }
    }

    if (!matchesStructure) {
      continue;
    }

    results.push({
      name,
      pages: matchingPages.map((p) => p.route),
      differences: differences.slice(0, 10),
    });
  }

  return results;
}
