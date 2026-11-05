import { DOM_TO_JSX_SRC } from './dom-to-jsx.js';
import { SLIM_SRC } from './slim.js';
import { ANNOTATE_SRC, type Breakpoint } from './annotate.js';

export interface SnapshotPlan {
  sections: Array<{ name: string; selector: string }>;
  appear: Array<{ selector: string; opacity: string; transform: string }>;
  hiddenMap: Record<string, Breakpoint[]>;
  motion: Array<{ id: string; selector: string }>;
  cms: Array<{ field: string; value: string }>;
  components: Array<{ name: string; selector: string }>;
  scriptDrawn: Array<{ id: string; section: string; x: number; y: number }>;
  emptyBytes: number;
  oversizedBytes: number;
}

export interface SnapshotPart {
  /** Unique within its section. */
  name: string;
  jsx: string;
  motion: string[];
  scriptDrawn: string[];
  repeated: string[];
  cmsFields: string[];
  hasVariants: boolean;
}

export interface SnapshotSection {
  name: string;
  jsx: string;
  empty: boolean;
  parts: SnapshotPart[];
  /** For a section with parts: only what sits on the section root outside every part. */
  motion: string[];
  scriptDrawn: string[];
  repeated: string[];
  cmsFields: string[];
  hasVariants: boolean;
}

export interface SnapshotOut {
  css: string[];
  viewJsx: string;
  sections: SnapshotSection[];
  unmatchedMotion: string[];
  slimmed: number;
  stubs: Array<{ section: string | null; kind: string }>;
}

/**
 * Runs inside the page with JavaScript disabled:
 * 1. applies settled appear states
 * 2. marks data-section
 * 3. annotates (variants, motion, cms, script-drawn)
 * 4. slims #main
 * 5. converts each non-empty section separately and replaces it in #main with <fexport-section data-name="<name>">
 * 6. converts #main to viewJsx
 */
export function snapshotScript(plan: SnapshotPlan): string {
  const planJson = JSON.stringify(plan);
  return String.raw`(function (plan) {
    var conv = ${DOM_TO_JSX_SRC};
    var slim = ${SLIM_SRC};
    var annotate = ${ANNOTATE_SRC};

    var main = document.querySelector('#main');
    if (!main) return null;

    // 1. apply appear states
    (plan.appear || []).forEach(function (a) {
      var el = null;
      try { el = document.querySelector(a.selector); } catch (e) {}
      if (!el) return;
      if (a.opacity !== undefined && a.opacity !== null) el.style.opacity = a.opacity;
      if (a.transform === 'none') el.style.removeProperty('transform');
      else if (a.transform) el.style.transform = a.transform;
    });

    // 2. mark data-section
    (plan.sections || []).forEach(function (s) {
      var el = null;
      try { el = document.querySelector(s.selector); } catch (e) {}
      if (el) el.setAttribute('data-section', s.name);
    });

    // 3. annotate
    var annotateRes = annotate(main, plan);
    var unmatchedMotion = (annotateRes && annotateRes.unmatchedMotion) || [];

    // Remove editorbar styles if present inside main
    Array.prototype.slice.call(main.querySelectorAll('style')).forEach(function (s) {
      if ((s.textContent || '').indexOf('#__framer-editorbar') === 0) s.remove();
    });

    // 4. slim #main
    var slimmedCount = slim(main);

    // 4b. collect stubs (iframe, form, data-code-component-plugin-id with no visible content)
    var stubsOut = [];
    var stubCandidates = Array.prototype.slice.call(
      main.querySelectorAll('iframe, form, [data-code-component-plugin-id]')
    );
    if (main.matches && main.matches('iframe, form, [data-code-component-plugin-id]')) {
      stubCandidates.unshift(main);
    }
    stubCandidates.forEach(function (el) {
      var text = (el.textContent || '').trim();
      var hasVisible = text.length > 0 || Boolean(el.querySelector('img, svg, video, canvas, input, select, textarea, button'));
      if (!hasVisible) {
        var tag = (el.tagName || '').toLowerCase();
        var kind = tag === 'iframe' ? 'iframe' : tag === 'form' ? 'form' : (el.getAttribute('data-framer-name') || 'code component');
        var secEl = el.closest ? el.closest('[data-section]') : null;
        var secName = secEl ? secEl.getAttribute('data-section') : null;
        stubsOut.push({ section: secName, kind: kind });
      }
    });

    // Collects annotation info of an element subtree (the element itself included).
    function collect(rootEl) {
      var hasVariants = Boolean(
        rootEl.hasAttribute('data-variant') ||
        rootEl.querySelector('[data-variant]')
      );
      function ids(attr) {
        var out = [];
        var els = Array.prototype.slice.call(rootEl.querySelectorAll('[' + attr + ']'));
        if (rootEl.hasAttribute(attr)) els.unshift(rootEl);
        els.forEach(function (el) {
          var val = el.getAttribute(attr);
          if (val) {
            val.trim().split(/\s+/).forEach(function (id) {
              if (id && out.indexOf(id) === -1) out.push(id);
            });
          }
        });
        return out;
      }
      var repeated = [];
      (plan.components || []).forEach(function (c) {
        var count = 0;
        try { count = rootEl.querySelectorAll(c.selector).length; } catch (e) {}
        if (count >= 2 && repeated.indexOf(c.name) === -1) {
          repeated.push(c.name);
        }
      });
      return {
        hasVariants: hasVariants,
        motion: ids('data-motion'),
        cmsFields: ids('data-cms'),
        scriptDrawn: ids('data-script-drawn'),
        repeated: repeated
      };
    }

    // 5. convert sections
    var emptyLimit = typeof plan.emptyBytes === 'number' ? plan.emptyBytes : 1000;
    var oversizedLimit = typeof plan.oversizedBytes === 'number' ? plan.oversizedBytes : 120000;
    var sectionsOut = [];

    (plan.sections || []).forEach(function (s) {
      var sectionEl = null;
      try { sectionEl = document.querySelector(s.selector); } catch (e) {}
      if (!sectionEl) {
        sectionsOut.push({
          name: s.name,
          jsx: '',
          empty: true,
          parts: [],
          motion: [],
          scriptDrawn: [],
          repeated: [],
          cmsFields: [],
          hasVariants: false
        });
        return;
      }

      var sectionJsx = conv.element(sectionEl);
      var info = collect(sectionEl);

      var hasVisibleText = Boolean((sectionEl.textContent || '').trim());
      var hasMedia = Boolean(sectionEl.querySelector('img, svg, a, video'));
      var isEmpty = sectionJsx.length < emptyLimit && !hasVisibleText && !hasMedia;

      if (isEmpty) {
        sectionsOut.push({
          name: s.name,
          jsx: sectionJsx,
          empty: true,
          parts: [],
          motion: info.motion,
          scriptDrawn: info.scriptDrawn,
          repeated: info.repeated,
          cmsFields: info.cmsFields,
          hasVariants: info.hasVariants
        });
        return;
      }

      var parts = [];
      if (sectionJsx.length > oversizedLimit) {
        var directKids = Array.prototype.slice.call(sectionEl.children || []);
        var takenNames = {};
        directKids.forEach(function (kid) {
          var baseName = kid.getAttribute('data-framer-name');
          if (baseName) {
            // unique part names: a second "Card" becomes "Card 2"
            var partName = baseName;
            var n = 2;
            while (takenNames[partName]) partName = baseName + ' ' + n++;
            takenNames[partName] = true;
            var partInfo = collect(kid);
            parts.push({
              name: partName,
              jsx: conv.element(kid),
              motion: partInfo.motion,
              scriptDrawn: partInfo.scriptDrawn,
              repeated: partInfo.repeated,
              cmsFields: partInfo.cmsFields,
              hasVariants: partInfo.hasVariants
            });
            var partPlaceholder = document.createElement('fexport-part');
            partPlaceholder.setAttribute('data-name', partName);
            sectionEl.replaceChild(partPlaceholder, kid);
          }
        });
        sectionJsx = conv.element(sectionEl);
        if (parts.length) info = collect(sectionEl); // root only, outside every part
      }

      sectionsOut.push({
        name: s.name,
        jsx: sectionJsx,
        empty: false,
        parts: parts,
        motion: info.motion,
        scriptDrawn: info.scriptDrawn,
        repeated: info.repeated,
        cmsFields: info.cmsFields,
        hasVariants: info.hasVariants
      });

      var sectionPlaceholder = document.createElement('fexport-section');
      sectionPlaceholder.setAttribute('data-name', s.name);
      if (sectionEl === main) {
        main.innerHTML = '';
        main.appendChild(sectionPlaceholder);
      } else if (sectionEl.parentNode) {
        sectionEl.parentNode.replaceChild(sectionPlaceholder, sectionEl);
      }
    });

    // 6. convert #main to viewJsx
    var viewJsx = conv.element(main);

    // 7. collect CSS from document.head
    var css = Array.prototype.slice.call(document.head.querySelectorAll('style'))
      .filter(function (s) { return !s.hasAttribute('data-framer-font-css'); })
      .map(function (s) { return s.textContent || ''; })
      .filter(Boolean);

    return {
      css: css,
      viewJsx: viewJsx,
      sections: sectionsOut,
      unmatchedMotion: unmatchedMotion,
      slimmed: slimmedCount,
      stubs: stubsOut
    };
  })(${planJson})`;
}
