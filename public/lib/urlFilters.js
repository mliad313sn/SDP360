/* E-U02 — filters persisted in the URL (audit U-05 / G18). UMD: Node (tests) + browser (window.UrlFilters).
 *
 * PURE helpers: parse a query string against a SCHEMA and serialise a state back. A schema lists the only keys a
 * page may read from / write to the URL:
 *   { site:   { type: 'enum', values: ['', 'Sabodala', ...], def: '' },
 *     status: { type: 'list', max: 50, def: null } }          // list: CSV; null = "all" (not written)
 * Rules:
 *   - unknown keys are ignored; an enum value not in `values` is dropped (falls back to def);
 *   - list items are trimmed, de-duplicated, capped (count and length) and later intersected with the live
 *     options by the page (filterList) — the URL is never trusted, never inserted as HTML;
 *   - only filter SELECTIONS go in the URL, never a data value (KPI, count, name of a person);
 *   - the default value of a key is never written, so a page with no filter has a clean URL;
 *   - query keys that are NOT in the schema are preserved untouched by merge().
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UrlFilters = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const MAX_ITEM_LEN = 120;

  function _params(search) {
    const out = new Map();
    const s = String(search == null ? '' : search).replace(/^\?/, '');
    if (!s) return out;
    for (const part of s.split('&')) {
      if (!part) continue;
      const i = part.indexOf('=');
      const kRaw = i < 0 ? part : part.slice(0, i);
      const vRaw = i < 0 ? '' : part.slice(i + 1);
      let k; let v;
      try { k = decodeURIComponent(kRaw.replace(/\+/g, ' ')); v = decodeURIComponent(vRaw.replace(/\+/g, ' ')); }
      catch (_) { continue; } // malformed %-escape: ignore that pair
      if (!out.has(k)) out.set(k, v);
    }
    return out;
  }

  function _cleanList(v, spec) {
    const max = spec && spec.max > 0 ? spec.max : 50;
    const seen = new Set(); const list = [];
    for (const raw of String(v).split(',')) {
      const it = raw.trim();
      if (!it || it.length > MAX_ITEM_LEN || seen.has(it)) continue;
      seen.add(it); list.push(it);
      if (list.length >= max) break;
    }
    return list;
  }

  /** Query string → state with EVERY schema key (absent/invalid → def). */
  function parse(search, schema) {
    const p = _params(search);
    const state = {};
    for (const [key, spec] of Object.entries(schema || {})) {
      const def = spec.def === undefined ? (spec.type === 'list' ? null : '') : spec.def;
      if (!p.has(key)) { state[key] = def; continue; }
      const v = p.get(key);
      if (spec.type === 'enum') state[key] = (spec.values || []).includes(v) ? v : def;
      else if (spec.type === 'list') state[key] = v === '' ? [] : _cleanList(v, spec);
      else state[key] = def;
    }
    return state;
  }

  function _isDefault(v, spec) {
    const def = spec.def === undefined ? (spec.type === 'list' ? null : '') : spec.def;
    if (spec.type === 'list') return v == null && def == null;
    return v == null || v === def;
  }

  /** State → ordered [key, value] pairs for the schema keys that differ from their default. */
  function pairs(state, schema) {
    const out = [];
    for (const [key, spec] of Object.entries(schema || {})) {
      const v = state ? state[key] : undefined;
      if (_isDefault(v, spec)) continue;
      if (spec.type === 'enum') { if ((spec.values || []).includes(v)) out.push([key, String(v)]); }
      else if (spec.type === 'list' && Array.isArray(v)) out.push([key, _cleanList(v.join(','), spec).join(',')]);
    }
    return out;
  }

  function _enc(s) { return encodeURIComponent(s).replace(/%2C/g, ','); }

  /** State → '?a=b&c=d' ('' when nothing to write). */
  function serialise(state, schema) {
    const ps = pairs(state, schema);
    return ps.length ? '?' + ps.map(([k, v]) => _enc(k) + '=' + _enc(v)).join('&') : '';
  }

  /** Rewrite `search`: schema keys replaced by the state, foreign keys kept in their original order. */
  function merge(search, state, schema) {
    const p = _params(search);
    const keys = new Set(Object.keys(schema || {}));
    const kept = [...p.entries()].filter(([k]) => !keys.has(k));
    const all = kept.concat(pairs(state, schema));
    return all.length ? '?' + all.map(([k, v]) => _enc(k) + '=' + _enc(v)).join('&') : '';
  }

  /** Intersect a parsed list with the live options (null stays null = all). */
  function filterList(list, options) {
    if (list == null) return null;
    const opts = new Set(options || []);
    return list.filter((v) => opts.has(v));
  }

  return { parse, serialise, merge, pairs, filterList, MAX_ITEM_LEN };
}));
