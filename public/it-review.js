/**
 * it-review.js — the IT Review page's template renderer + fetch/mount.
 *
 * This is a 3-PRIMITIVE RENDERER, deliberately NOT a template engine. The
 * authoritative template (docs/reference/it-review-dashboard.template.html) is
 * mechanical: 219 pure {{ key }} / {{ obj.field }} bindings (max ONE dot), 32
 * <sc-for>, 3 <sc-if>, nesting exactly 2 deep. Do not generalise it. Do not add
 * a raw/unescaped mode — every binding renders untrusted PV/ticket free-text.
 *
 * TWO NON-OBVIOUS INVARIANTS (each cost a review round — see the plan):
 *
 *   1. The grammar MUST tolerate arbitrary extra attributes in ANY order. Every
 *      real tag carries a hint attribute:
 *          <sc-for list="{{ kpis }}" as="k" hint-placeholder-count="8">
 *          <sc-if value="{{ isDashboard }}" hint-placeholder-val="{{ true }}">
 *      A bare-form grammar passes its unit tests while matching 0 of 32 loops —
 *      the page ships inert, with a fully green suite.
 *
 *   2. Control flow MUST resolve BEFORE interpolation. hint-placeholder-val
 *      puts a {{ }} INSIDE the sc-if tag; interpolate first and the tag becomes
 *      <sc-if value="true" hint-placeholder-val="">, the value="{{ … }}" matcher
 *      never fires, and the view gate silently vanishes.
 *
 * _render() honours both structurally: it parses control tags out of the RAW
 * text and only ever interpolates the segments BETWEEN them, so a tag's own
 * attributes are never touched by the interpolator and the hint attributes are
 * discarded with the open tag rather than leaking into the output.
 *
 * tests/review-render.test.js's BACKSTOP runs this over the real template in all
 * 3 views and is the only test that catches either failure. Never delete it.
 */
'use strict';

(function () {
  /** HTML-escape. Always applied — there is no raw mode.
   *  0 and false must RENDER; only null/undefined render empty. */
  function _escape(v) {
    if (v === null || v === undefined) return '';
    return String(v)
      .replace(/&/g, '&amp;')   // must run first
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Resolve a path (<=1 dot) against a scope CHAIN: an array of frames,
   *  innermost LAST. Walks outward so {{ title }} still resolves inside a loop
   *  while a loop var shadows an outer key of the same name. Never throws. */
  function _resolve(path, chain) {
    if (!path) return undefined;
    var parts = String(path).trim().split('.');
    var head = parts[0];
    for (var i = chain.length - 1; i >= 0; i--) {
      var frame = chain[i];
      if (frame && typeof frame === 'object' && head in frame) {
        var val = frame[head];
        for (var j = 1; j < parts.length && val !== null && val !== undefined; j++) {
          val = val[parts[j]];
        }
        return val;
      }
    }
    return undefined;
  }

  /** Substitute {{ path }} in a text segment. Escapes every value. */
  function _interpolate(text, chain) {
    return text.replace(/\{\{\s*([^}]*?)\s*\}\}/g, function (_m, path) {
      return _escape(_resolve(path, chain));
    });
  }

  /** Parse an open tag's attributes into a map. Tolerates any order and any
   *  extra attributes (hint-placeholder-*, etc. — we simply never read them). */
  function _attrs(tagSrc) {
    var out = {};
    var re = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*"([^"]*)"/g;
    var m;
    while ((m = re.exec(tagSrc)) !== null) out[m[1]] = m[2];
    return out;
  }

  /** An attribute value is either {{ path }} or a bare path. Strip the braces. */
  function _attrPath(v) {
    if (v === undefined) return undefined;
    var m = /^\s*\{\{\s*([^}]*?)\s*\}\}\s*$/.exec(v);
    return m ? m[1] : String(v).trim();
  }

  /** Find the index just past the </tag> that balances the open tag starting at
   *  `from`. Counts same-name opens only — sc-for/sc-if are properly nested, so
   *  per-name counting is sufficient. Returns null if unbalanced. */
  function _matchClose(html, tag, from) {
    var openRe = new RegExp('<' + tag + '(?=[\\s>])', 'g');
    var closeRe = new RegExp('</' + tag + '\\s*>', 'g');
    var depth = 0;
    var i = from;
    while (i < html.length) {
      openRe.lastIndex = i;
      closeRe.lastIndex = i;
      var o = openRe.exec(html);
      var c = closeRe.exec(html);
      if (!c) return null;                       // unbalanced
      if (o && o.index < c.index) { depth++; i = o.index + 1; continue; }
      if (depth === 0) return { inner_end: c.index, end: c.index + c[0].length };
      depth--;
      i = c.index + 1;
    }
    return null;
  }

  /**
   * Render `html` against a scope chain. Control flow first, interpolation
   * second — structurally, by construction (see the header).
   */
  function _render(html, chain) {
    var out = '';
    var pos = 0;
    var re = /<(sc-for|sc-if)(?=[\s>])/g;
    var m;

    re.lastIndex = 0;
    while ((m = re.exec(html)) !== null) {
      var tag = m[1];
      var tagStart = m.index;

      // The open tag ends at the first '>' — no '>' appears inside our quoted
      // attribute values in the real template.
      var openEnd = html.indexOf('>', tagStart);
      if (openEnd === -1) break;

      var match = _matchClose(html, tag, openEnd + 1);
      if (!match) break;                          // malformed — leave as-is

      // Text BEFORE the tag: interpolate with the current scope.
      out += _interpolate(html.slice(pos, tagStart), chain);

      var attrs = _attrs(html.slice(tagStart, openEnd));
      var inner = html.slice(openEnd + 1, match.inner_end);

      if (tag === 'sc-if') {
        // Only `value` is read; hint-placeholder-val is discarded with the tag.
        if (_resolve(_attrPath(attrs.value), chain)) out += _render(inner, chain);
      } else {
        var list = _resolve(_attrPath(attrs.list), chain);
        var as = attrs.as;
        if (Array.isArray(list) && as) {
          for (var i = 0; i < list.length; i++) {
            var frame = {};
            frame[as] = list[i];
            out += _render(inner, chain.concat([frame]));   // child shadows parent
          }
        }
        // A missing/empty/non-array list emits nothing.
      }

      pos = match.end;
      re.lastIndex = pos;
    }

    return out + _interpolate(html.slice(pos), chain);
  }

  /** Public entry: render a template string against a flat vals object. */
  function renderTemplate(html, vals) {
    return _render(String(html), [vals || {}]);
  }

  // ── page boot (browser only — nothing below runs under require()) ─────────

  var VIEWS = ['dashboard', 'scoreboard', 'brief'];
  var PERIODS = ['week', 'month', 'quarter', 'semester'];

  function _params() {
    var q = new URLSearchParams(window.location.search);
    var view = q.get('view');
    var period = q.get('period');
    var asOf = q.get('asOf');
    var site = q.get('site');
    var p = new URLSearchParams();
    p.set('view', VIEWS.indexOf(view) !== -1 ? view : 'dashboard');
    p.set('period', PERIODS.indexOf(period) !== -1 ? period : 'week');
    p.set('site', site || 'ALL');
    if (asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf)) p.set('asOf', asOf);
    return p;
  }

  function boot() {
    var mount = document.getElementById('review-root');
    if (!mount) return;
    var tplEl = document.getElementById('review-template');
    var tpl = tplEl ? tplEl.innerHTML : '';

    fetch('/api/reports/review-data?' + _params().toString(), { credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (vals) { mount.innerHTML = renderTemplate(tpl, vals); })
      .catch(function (e) {
        // Never a blank page.
        mount.innerHTML = '<div style="padding:24px;font:14px system-ui;color:#b42318">'
          + 'IT Review data unavailable — ' + _escape(e && e.message) + '</div>';
      });
  }

  var api = {
    renderTemplate: renderTemplate,
    _resolve: _resolve,
    _escape: _escape,
    _interpolate: _interpolate,
    _render: _render
  };

  // Guard BOTH sides: require()-able by the tests AND usable in the browser.
  // NOTHING may touch document/fetch at module scope — require() would throw.
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.ITReview = api;
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', boot);
})();
