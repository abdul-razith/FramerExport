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

export interface SnapshotSection {
  name: string;
  jsx: string;
  empty: boolean;
  parts: Array<{ name: string; jsx: string }>;
  motion: string[];
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
  return `(function (plan) {
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
          repeated: [],
          cmsFields: [],
          hasVariants: false
        });
        return;
      }

      var hasVariants = Boolean(
        sectionEl.hasAttribute('data-variant') ||
        sectionEl.querySelector('[data-variant]')
      );

      var motionIds = [];
      var motionEls = Array.prototype.slice.call(sectionEl.querySelectorAll('[data-motion]'));
      if (sectionEl.hasAttribute('data-motion')) motionEls.unshift(sectionEl);
      motionEls.forEach(function (mEl) {
        var val = mEl.getAttribute('data-motion');
        if (val) {
          val.split(/\\s+/).forEach(function (id) {
            if (id && motionIds.indexOf(id) === -1) motionIds.push(id);
          });
        }
      });

      var cmsFields = [];
      var cmsEls = Array.prototype.slice.call(sectionEl.querySelectorAll('[data-cms]'));
      if (sectionEl.hasAttribute('data-cms')) cmsEls.unshift(sectionEl);
      cmsEls.forEach(function (cEl) {
        var val = cEl.getAttribute('data-cms');
        if (val) {
          val.split(/\\s+/).forEach(function (f) {
            if (f && cmsFields.indexOf(f) === -1) cmsFields.push(f);
          });
        }
      });

      var repeated = [];
      (plan.components || []).forEach(function (c) {
        var count = 0;
        try { count = sectionEl.querySelectorAll(c.selector).length; } catch (e) {}
        if (count >= 2 && repeated.indexOf(c.name) === -1) {
          repeated.push(c.name);
        }
      });

      var sectionJsx = conv.element(sectionEl);

      var hasVisibleText = Boolean((sectionEl.textContent || '').trim());
      var hasMedia = Boolean(sectionEl.querySelector('img, svg, a, video'));
      var isEmpty = sectionJsx.length < emptyLimit && !hasVisibleText && !hasMedia;

      if (isEmpty) {
        sectionsOut.push({
          name: s.name,
          jsx: sectionJsx,
          empty: true,
          parts: [],
          motion: motionIds,
          repeated: repeated,
          cmsFields: cmsFields,
          hasVariants: hasVariants
        });
        return;
      }

      var parts = [];
      if (sectionJsx.length > oversizedLimit) {
        var directKids = Array.prototype.slice.call(sectionEl.children || []);
        directKids.forEach(function (kid) {
          var partName = kid.getAttribute('data-framer-name');
          if (partName) {
            var partJsx = conv.element(kid);
            parts.push({ name: partName, jsx: partJsx });
            var partPlaceholder = document.createElement('fexport-part');
            partPlaceholder.setAttribute('data-name', partName);
            sectionEl.replaceChild(partPlaceholder, kid);
          }
        });
        sectionJsx = conv.element(sectionEl);
      }

      sectionsOut.push({
        name: s.name,
        jsx: sectionJsx,
        empty: false,
        parts: parts,
        motion: motionIds,
        repeated: repeated,
        cmsFields: cmsFields,
        hasVariants: hasVariants
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
      slimmed: slimmedCount
    };
  })(${planJson})`;
}
