/**
 * DOM -> JSX converter. The source below is plain ES2020 kept as a string so the very same code runs inside
 * the headless browser (puppeteer `evaluate`) and in Node unit tests against a fake DOM, with no transpiler
 * helpers leaking into the page.
 */
export const DOM_TO_JSX_SRC = String.raw`(function () {
  var VOID = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, source: 1, track: 1, wbr: 1 };
  var SKIP = { script: 1, noscript: 1, template: 1 };
  var INLINE = { a: 1, span: 1, p: 1, h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1, li: 1, label: 1, button: 1, em: 1, strong: 1, b: 1, i: 1, small: 1, u: 1, code: 1 };
  var DROP_ATTRS = { 'data-framer-hydrate-v2': 1, 'data-framer-ssr-released-at': 1, 'data-framer-page-optimized-at': 1, 'data-framer-generated-page': 1 };
  var RENAME = {
    'class': 'className', 'for': 'htmlFor', tabindex: 'tabIndex', srcset: 'srcSet', crossorigin: 'crossOrigin',
    fetchpriority: 'fetchPriority', readonly: 'readOnly', maxlength: 'maxLength', minlength: 'minLength',
    autoplay: 'autoPlay', playsinline: 'playsInline', colspan: 'colSpan', rowspan: 'rowSpan',
    contenteditable: 'contentEditable', autocomplete: 'autoComplete', referrerpolicy: 'referrerPolicy',
    allowfullscreen: 'allowFullScreen', frameborder: 'frameBorder', spellcheck: 'spellCheck', charset: 'charSet',
    datetime: 'dateTime', usemap: 'useMap', novalidate: 'noValidate', srclang: 'srcLang',
    controlslist: 'controlsList', enctype: 'encType', formaction: 'formAction', accesskey: 'accessKey',
    autofocus: 'autoFocus', cellpadding: 'cellPadding', cellspacing: 'cellSpacing', inputmode: 'inputMode'
  };
  var BOOL = {
    hidden: 1, muted: 1, loop: 1, controls: 1, autoplay: 1, playsinline: 1, disabled: 1, checked: 1, selected: 1,
    readonly: 1, required: 1, multiple: 1, open: 1, allowfullscreen: 1, 'default': 1, autofocus: 1, novalidate: 1,
    async: 1, defer: 1, reversed: 1
  };

  function camel(name) {
    return name.replace(/[-:]([a-zA-Z])/g, function (_m, c) { return c.toUpperCase(); });
  }

  function attrName(name, tag) {
    var lower = name.toLowerCase();
    if (lower.indexOf('data-') === 0 || lower.indexOf('aria-') === 0) return name;
    if (lower === 'value' && tag === 'input') return 'defaultValue';
    if (lower === 'checked' && tag === 'input') return 'defaultChecked';
    if (Object.prototype.hasOwnProperty.call(RENAME, lower)) return RENAME[lower];
    if (name.indexOf('-') >= 0 || name.indexOf(':') >= 0) return camel(name);
    return name;
  }

  function splitDeclarations(css) {
    var out = [];
    var depth = 0;
    var quote = '';
    var start = 0;
    for (var i = 0; i <= css.length; i++) {
      var c = css.charAt(i);
      if (i === css.length || (c === ';' && depth === 0 && !quote)) {
        var decl = css.slice(start, i);
        var colon = decl.indexOf(':');
        if (colon > 0) out.push([decl.slice(0, colon).trim(), decl.slice(colon + 1).trim()]);
        start = i + 1;
      } else if (quote) {
        if (c === quote) quote = '';
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '(') depth++;
      else if (c === ')') depth = Math.max(0, depth - 1);
    }
    return out;
  }

  function styleObject(css) {
    var obj = {};
    var any = false;
    splitDeclarations(css).forEach(function (d) {
      var prop = d[0];
      var value = d[1].replace(/\s*!important\s*$/i, '');
      if (!prop || !value) return;
      var key = prop.indexOf('--') === 0 ? prop : prop.indexOf('-ms-') === 0 ? camel('ms' + prop.slice(3)) : camel(prop);
      obj[key] = value;
      any = true;
    });
    return any ? obj : null;
  }

  var PLAIN_ATTR = /^[^"&\\{}<>\n\r]*$/;
  var PLAIN_TEXT = /^[^{}<>&\n\r]+$/;

  function attr(name, value, tag) {
    var lower = name.toLowerCase();
    if (lower.indexOf('on') === 0 && lower.length > 2) return '';
    if (DROP_ATTRS[name]) return '';
    if (lower === 'style') {
      var obj = styleObject(value);
      return obj ? ' style={' + JSON.stringify(obj) + '}' : '';
    }
    var jsx = attrName(name, tag);
    if (value === '' && BOOL[lower]) return ' ' + jsx + '={true}';
    if (PLAIN_ATTR.test(value)) return ' ' + jsx + '="' + value + '"';
    return ' ' + jsx + '={' + JSON.stringify(value) + '}';
  }

  function children(el, tag) {
    var nodes = Array.prototype.slice.call(el.childNodes || []);
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.nodeType === 3) {
        var text = n.nodeValue || '';
        if (/^\s*$/.test(text)) {
          var prev = nodes[i - 1];
          var next = nodes[i + 1];
          if (INLINE[tag] && prev && next) out.push('{" "}');
          continue;
        }
        out.push(PLAIN_TEXT.test(text) && text === text.trim() ? text : '{' + JSON.stringify(text) + '}');
      } else if (n.nodeType === 1) {
        var rendered = element(n);
        if (rendered) out.push(rendered);
      }
    }
    return out;
  }

  function element(el) {
    var tag = el.localName || String(el.tagName || '').toLowerCase();
    if (!tag || SKIP[tag]) return '';
    var attrs = '';
    var list = Array.prototype.slice.call(el.attributes || []);
    for (var i = 0; i < list.length; i++) attrs += attr(list[i].name, list[i].value, tag);
    if (tag === 'style') {
      return '<style dangerouslySetInnerHTML={{ __html: ' + JSON.stringify(el.textContent || '') + ' }} />';
    }
    if (VOID[tag]) return '<' + tag + attrs + ' />';
    var kids = children(el, tag);
    if (!kids.length) return '<' + tag + attrs + '></' + tag + '>';
    return '<' + tag + attrs + '>\n' + kids.join('\n') + '\n</' + tag + '>';
  }

  return { element: element, children: function (el) { return children(el, ''); } };
})()`;

export interface DomToJsx {
  element(el: unknown): string;
  children(el: unknown): string[];
}

/** The converter evaluated in this Node process (used by tests with a fake DOM). */
export function createDomToJsx(): DomToJsx {
  return (0, eval)(DOM_TO_JSX_SRC) as DomToJsx;
}

const ASSET = /(?:\.{1,2}\/)*assets\/(images|fonts|misc|videos)\/([^"'\s)\\,]+)/g;

/**
 * Rewrites links to exported pages (`subpages/about.html`, `index.html`) to their routes. `pageRoutes` maps an
 * export file (as listed in pages.json) to the route that replaces it.
 */
export function rewriteLinks(text: string, pageRoutes: Record<string, string>): string {
  return text.replace(/href="((?:\.{1,2}\/)*)([^"#?]*)((?:[#?][^"]*)?)"/g, (m, _up: string, file: string, rest: string) => {
    const route = Object.hasOwn(pageRoutes, file) ? pageRoutes[file] : undefined;
    return route === undefined ? m : `href="${route}${rest}"`;
  });
}

/** Rewrites export-relative `assets/<kind>/<file>` URLs to the public paths of the Next.js project. */
export function rewriteAssets(text: string, map: Record<string, string> = {}): string {
  return text.replace(ASSET, (_m, kind: string, file: string) => map[`assets/${kind}/${file}`] ?? `/${kind}/${file}`);
}
