import type { Box } from '../types.js';

export interface VisibleItem {
  section: string;
  key: string; /* tag path from the section root */
  text: string;
  box: Box;
}

export interface ScriptDrawn {
  id: string;
  route: string;
  section: string;
  box: Box;
  sample: string;
  count: number;
  ticking: boolean;
}

/**
 * Extracts the parent of a tag path key.
 * e.g. "div:nth-child(1) > span:nth-child(2)" -> "div:nth-child(1)"
 *      "ruler > tick1" -> "ruler"
 *      "span" -> ""
 */
export function getParentKey(key: string): string {
  if (!key) return '';
  const lastArrow = key.lastIndexOf(' > ');
  if (lastArrow !== -1) return key.slice(0, lastArrow).trim();
  const lastSlash = key.lastIndexOf('/');
  if (lastSlash !== -1) return key.slice(0, lastSlash).trim();
  const lastGt = key.lastIndexOf('>');
  if (lastGt !== -1) return key.slice(0, lastGt).trim();
  const lastDot = key.lastIndexOf('.');
  if (lastDot !== -1) return key.slice(0, lastDot).trim();
  return '';
}

interface Group {
  section: string;
  parentKey: string;
  items: VisibleItem[];
}

function checkTicking(
  group: Group,
  liveLater: VisibleItem[],
  stillTexts?: Set<string>,
): boolean {
  if (!liveLater || liveLater.length === 0) return false;

  const laterSectionItems = liveLater.filter((l) => l.section === group.section);
  if (laterSectionItems.length === 0) return false;

  const laterByKey = new Map<string, string>();
  for (const item of laterSectionItems) {
    laterByKey.set(item.key, item.text);
  }

  let matchedAnyKey = false;
  let textChangedByKey = false;
  for (const item of group.items) {
    if (laterByKey.has(item.key)) {
      matchedAnyKey = true;
      if (laterByKey.get(item.key) !== item.text) {
        textChangedByKey = true;
        break;
      }
    }
  }

  if (textChangedByKey) return true;
  if (matchedAnyKey) {
    let allKeysMatched = true;
    for (const item of group.items) {
      if (!laterByKey.has(item.key)) {
        allKeysMatched = false;
        break;
      }
    }
    if (!allKeysMatched) return true;
    return false;
  }

  // Fallback: match by parent key among candidates (not in still)
  const laterForParent = laterSectionItems.filter(
    (l) => getParentKey(l.key) === group.parentKey,
  );
  const laterCandidates = laterForParent.filter(
    (l) => !stillTexts || (!stillTexts.has(l.text) && !stillTexts.has(l.text.trim())),
  );

  if (laterCandidates.length === 0) return false;

  const liveTexts = group.items.map((i) => i.text);
  const laterTexts = laterCandidates.map((i) => i.text);

  if (liveTexts.length !== laterTexts.length) return true;
  for (let i = 0; i < liveTexts.length; i++) {
    if (liveTexts[i] !== laterTexts[i]) return true;
  }

  return false;
}

/**
 * Finds items whose text appears in `live` but not in `still` for the same section,
 * grouped by the parent of `key` (`count` = items in group, `sample` = joined texts truncated to 80 chars,
 * `box` = union); `ticking` when the group's texts differ in `liveLater`; ids `s1…` in document order.
 */
export function diffScriptDrawn(
  route: string,
  live: VisibleItem[],
  still: VisibleItem[],
  liveLater: VisibleItem[],
): ScriptDrawn[] {
  const stillTextsBySection = new Map<string, Set<string>>();
  for (const item of still) {
    let set = stillTextsBySection.get(item.section);
    if (!set) {
      set = new Set<string>();
      stillTextsBySection.set(item.section, set);
    }
    set.add(item.text);
    set.add(item.text.trim());
  }

  const candidates: VisibleItem[] = [];
  for (const item of live) {
    const stillTexts = stillTextsBySection.get(item.section);
    const inStill = stillTexts && (stillTexts.has(item.text) || stillTexts.has(item.text.trim()));
    if (!inStill) {
      candidates.push(item);
    }
  }

  if (candidates.length === 0) return [];

  const groups = new Map<string, Group>();
  for (const item of candidates) {
    const parentKey = getParentKey(item.key);
    const groupKey = `${item.section}::${parentKey}`;
    let group = groups.get(groupKey);
    if (!group) {
      group = { section: item.section, parentKey, items: [] };
      groups.set(groupKey, group);
    }
    group.items.push(item);
  }

  const result: ScriptDrawn[] = [];
  let idx = 0;

  for (const group of groups.values()) {
    idx++;
    const id = `s${idx}`;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const it of group.items) {
      const b = it.box;
      if (b.x < minX) minX = b.x;
      if (b.y < minY) minY = b.y;
      if (b.x + b.width > maxX) maxX = b.x + b.width;
      if (b.y + b.height > maxY) maxY = b.y + b.height;
    }

    const box: Box = {
      x: minX === Infinity ? 0 : minX,
      y: minY === Infinity ? 0 : minY,
      width: maxX === -Infinity ? 0 : Math.round((maxX - minX) * 100) / 100,
      height: maxY === -Infinity ? 0 : Math.round((maxY - minY) * 100) / 100,
    };

    const sample = group.items.map((i) => i.text).join(' ').slice(0, 80);
    const count = group.items.length;
    const ticking = checkTicking(group, liveLater, stillTextsBySection.get(group.section));

    result.push({
      id,
      route,
      section: group.section,
      box,
      sample,
      count,
      ticking,
    });
  }

  return result;
}

/**
 * Page-side function `(sections) => Array<VisibleItem>` for every element with its own
 * non-empty visible text node: `{ section: string; key: string; text: string; box: { x; y; width; height } }`
 */
export const VISIBLE_ITEMS_SRC = String.raw`(function () {
  return function getVisibleItems(sections) {
    var items = [];
    var doc = typeof document !== 'undefined' ? document : null;
    var win = typeof window !== 'undefined' ? window : null;
    if (!doc) return items;

    var resolvedSections = [];
    if (Array.isArray(sections) && sections.length > 0) {
      for (var s = 0; s < sections.length; s++) {
        var sec = sections[s];
        var secName = typeof sec === 'string' ? sec : (sec && sec.name) || '';
        var secEl = null;
        if (sec && sec.selector) {
          try { secEl = doc.querySelector(sec.selector); } catch (e) {}
        }
        if (!secEl && secName) {
          try { secEl = doc.querySelector('[data-section="' + secName + '"]'); } catch (e) {}
        }
        if (!secEl && typeof sec === 'string') {
          try { secEl = doc.querySelector(sec); } catch (e) {}
        }
        if (secEl) {
          resolvedSections.push({ name: secName || 'section-' + s, el: secEl });
        }
      }
    } else {
      var marked = doc.querySelectorAll ? doc.querySelectorAll('[data-section]') : [];
      for (var m = 0; m < marked.length; m++) {
        var mEl = marked[m];
        var mName = mEl.getAttribute('data-section') || 'section-' + m;
        resolvedSections.push({ name: mName, el: mEl });
      }
      if (resolvedSections.length === 0 && doc.body) {
        resolvedSections.push({ name: 'main', el: doc.getElementById('main') || doc.body });
      }
    }

    function isVisible(el) {
      if (!el || el.nodeType !== 1) return false;
      var tag = (el.tagName || '').toLowerCase();
      if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'template') return false;
      if (win && win.getComputedStyle) {
        var cs = win.getComputedStyle(el);
        if (cs && (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0')) return false;
      }
      if (typeof el.getBoundingClientRect === 'function') {
        var rect = el.getBoundingClientRect();
        if (rect && rect.width === 0 && rect.height === 0) return false;
      }
      return true;
    }

    function buildKey(el, sectionRoot) {
      var segments = [];
      var curr = el;
      while (curr && curr !== sectionRoot && curr.parentNode) {
        var parent = curr.parentNode;
        var tag = (curr.tagName || '').toLowerCase();
        var index = 1;
        if (parent.children) {
          var kids = parent.children;
          var matchIdx = 0;
          for (var k = 0; k < kids.length; k++) {
            if (kids[k] === curr) {
              matchIdx = k + 1;
              break;
            }
          }
          index = matchIdx || 1;
        }
        segments.unshift(tag + ':nth-child(' + index + ')');
        curr = parent;
      }
      return segments.join(' > ');
    }

    function getElementDirectText(el) {
      if (!el || !el.childNodes) return '';
      var parts = [];
      for (var i = 0; i < el.childNodes.length; i++) {
        var node = el.childNodes[i];
        if (node.nodeType === 3) {
          var txt = (node.nodeValue || node.textContent || '').trim();
          if (txt) parts.push(txt);
        }
      }
      return parts.join(' ');
    }

    for (var i = 0; i < resolvedSections.length; i++) {
      var secObj = resolvedSections[i];
      var sectionName = secObj.name;
      var root = secObj.el;
      if (!root) continue;

      var allElements = [];
      allElements.push(root);
      if (root.querySelectorAll) {
        var descendants = root.querySelectorAll('*');
        for (var d = 0; d < descendants.length; d++) {
          allElements.push(descendants[d]);
        }
      }

      for (var e = 0; e < allElements.length; e++) {
        var el = allElements[e];
        var text = getElementDirectText(el);
        if (!text) continue;
        if (!isVisible(el)) continue;

        var key = buildKey(el, root);
        var box = { x: 0, y: 0, width: 0, height: 0 };
        if (typeof el.getBoundingClientRect === 'function') {
          var r = el.getBoundingClientRect();
          if (r) {
            box = {
              x: Math.round(((r.x !== undefined ? r.x : r.left || 0) + ((typeof window !== 'undefined' && window.scrollX) || 0)) * 100) / 100,
              y: Math.round(((r.y !== undefined ? r.y : r.top || 0) + ((typeof window !== 'undefined' && window.scrollY) || 0)) * 100) / 100,
              width: Math.round((r.width || 0) * 100) / 100,
              height: Math.round((r.height || 0) * 100) / 100,
            };
          }
        }

        items.push({
          section: sectionName,
          key: key,
          text: text,
          box: box,
        });
      }
    }

    return items;
  };
})()`;
