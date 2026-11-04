/* wanTimeline.js — C-13 (G21) WAN visuals: outage timeline, per-source freshness, mapping coverage.
 *
 * Pure (no DOM, no clock of its own: every "now" is passed in). Used by public/wan.html (browser)
 * and routes/opmanager.js (server: coverage). Read-only — nothing here changes an SLA figure.
 *
 *   WanTimeline.build(outages, { fromMs, toMs, nowMs })
 *       → { from, to, rows:[{ key, site_id, site_name, sub_site, uplink, label,
 *                              bars:[{ left, width, attribution, open, pending, start, end, duration_s }],
 *                              outages, down_s, open, pending }], total, open }
 *     One row per site × sub-site × uplink. Each outage is clipped to the window; an OPEN outage
 *     (no restored_end) runs to min(now, window end) and is flagged open. "pending" = closed but with
 *     no attribution / 'unknown' — the SAME rule as services/wanSla.pendingReview (excluded from the
 *     credit until reviewed). Attribution is normalised to isp | site | maintenance | unknown.
 *   WanTimeline.tableSpec(tl)  → ChartTable spec (the accessible alternative to the bars).
 *   WanTimeline.freshness(list) → [{ key, label, at, text }] — text = 'YYYY-MM-DD HH:MM UTC',
 *     'never' when the source never ran (null / empty), 'unreadable' when the value is not a date.
 *     Never the browser clock, never an invented date.
 *   WanTimeline.coverage({ sites, uplinks, mappedKeys })
 *       sites      = [{ site_id, name, network }]  (network '' / null → site not mapped to Meraki)
 *       uplinks    = [{ site_id, sub_site, uplink, site_name? }]  (every uplink seen anywhere)
 *       mappedKeys = ['site|sub|uplink', …]  uplinks that resolve to a configured SLA circuit
 *     → { sites_total, sites_mapped, sites_unmapped:[name…], uplinks_total, uplinks_mapped,
 *         uplinks_unmapped:[{ site_id, site_name, sub_site, uplink }] }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WanTimeline = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ATTR = { isp: 'isp', site: 'site', maintenance: 'maintenance' };

  function ms(v) {
    if (v == null || v === '') return NaN;
    if (typeof v === 'number') return v;
    return Date.parse(String(v));
  }
  function attr(a) { var k = String(a == null ? '' : a).trim().toLowerCase(); return ATTR[k] || 'unknown'; }
  function round2(n) { return Math.round(n * 100) / 100; }
  function key(siteId, sub, uplink) { return String(siteId) + '|' + String(sub || '') + '|' + String(uplink || ''); }

  function build(outages, opts) {
    var o = opts || {};
    var fromMs = ms(o.fromMs), toMs = ms(o.toMs);
    var nowMs = ms(o.nowMs);
    var out = { from: Number.isFinite(fromMs) ? new Date(fromMs).toISOString() : null,
                to: Number.isFinite(toMs) ? new Date(toMs).toISOString() : null, rows: [], total: 0, open: 0 };
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return out;
    var span = toMs - fromMs;
    var byKey = new Map();
    (outages || []).forEach(function (x) {
      if (!x) return;
      var s = ms(x.detected_start);
      if (!Number.isFinite(s)) return;
      var isOpen = !x.restored_end;
      var e = isOpen ? Math.min(Number.isFinite(nowMs) ? nowMs : toMs, toMs) : ms(x.restored_end);
      if (!Number.isFinite(e)) return;
      var cs = Math.max(s, fromMs), ce = Math.min(e, toMs);
      if (cs >= toMs || ce < cs || (ce === cs && !isOpen)) return;
      var k = key(x.site_id, x.sub_site, x.uplink);
      var row = byKey.get(k);
      if (!row) {
        var sub = x.sub_site || '';
        row = { key: k, site_id: x.site_id, site_name: x.site_name || null, sub_site: sub, uplink: x.uplink || '',
                label: (x.site_name || ('#' + x.site_id)) + (sub ? ' / ' + sub : '') + ' · ' + (x.uplink || '—'),
                bars: [], outages: 0, down_s: 0, open: 0, pending: 0 };
        byKey.set(k, row);
      }
      var a = attr(x.attribution);
      var pending = !isOpen && a === 'unknown';
      row.bars.push({ left: round2((cs - fromMs) / span * 100), width: round2((ce - cs) / span * 100),
        attribution: a, open: isOpen, pending: pending,
        start: new Date(s).toISOString(), end: isOpen ? null : new Date(e).toISOString(),
        duration_s: Math.round((ce - cs) / 1000) });
      row.outages += 1; row.down_s += Math.round((ce - cs) / 1000);
      if (isOpen) { row.open += 1; out.open += 1; }
      if (pending) row.pending += 1;
      out.total += 1;
    });
    out.rows = Array.from(byKey.values()).sort(function (a, b) { return a.label < b.label ? -1 : a.label > b.label ? 1 : 0; });
    out.rows.forEach(function (r) { r.bars.sort(function (a, b) { return a.left - b.left; }); });
    return out;
  }

  function tableSpec(tl) {
    var rows = (tl && tl.rows) || [];
    return {
      title: 'Outage timeline', labelHead: 'Site / uplink',
      labels: rows.map(function (r) { return r.label; }),
      datasets: [
        { label: 'Outages', data: rows.map(function (r) { return r.outages; }) },
        { label: 'Downtime', unit: 'h', data: rows.map(function (r) { return Math.round(r.down_s / 360) / 10; }) },
        { label: 'Open now', data: rows.map(function (r) { return r.open; }) },
        { label: 'Pending review', data: rows.map(function (r) { return r.pending; }) },
      ],
      state: rows.length ? 'VALID' : 'NO_DATA',
    };
  }

  function freshText(at) {
    if (at == null || at === '') return 'never';
    var t = ms(at);
    if (!Number.isFinite(t)) return 'unreadable';
    return new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  }
  function freshness(list) {
    return (list || []).map(function (s) {
      var at = s && s.at != null && s.at !== '' ? s.at : null;
      return { key: s && s.key, label: s && s.label, at: at, text: freshText(at) };
    });
  }

  function coverage(input) {
    var i = input || {};
    var sites = i.sites || [];
    var mapped = new Set((i.mappedKeys || []).map(String));
    var sitesMapped = sites.filter(function (s) { return s && String(s.network == null ? '' : s.network).trim() !== ''; });
    var nameById = {}; sites.forEach(function (s) { if (s) nameById[s.site_id] = s.name; });
    var uniq = new Map();
    (i.uplinks || []).forEach(function (u) {
      if (!u || u.site_id == null || !u.uplink) return;
      var k = key(u.site_id, u.sub_site, u.uplink);
      if (!uniq.has(k)) uniq.set(k, { site_id: u.site_id, site_name: u.site_name || nameById[u.site_id] || null, sub_site: u.sub_site || '', uplink: u.uplink });
    });
    var all = Array.from(uniq.entries());
    var unm = all.filter(function (e) { return !mapped.has(e[0]); }).map(function (e) { return e[1]; });
    return {
      sites_total: sites.length, sites_mapped: sitesMapped.length,
      sites_unmapped: sites.filter(function (s) { return sitesMapped.indexOf(s) < 0; }).map(function (s) { return s.name || ('#' + s.site_id); }),
      uplinks_total: all.length, uplinks_mapped: all.length - unm.length, uplinks_unmapped: unm,
    };
  }

  return { build: build, tableSpec: tableSpec, freshness: freshness, coverage: coverage, _key: key };
});
