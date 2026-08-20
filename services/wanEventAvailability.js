'use strict';
// Event-based 24x7 WAN availability — the ONE shared core for the WAN Health dashboard and the
// site-report auto-fill, so the two can never disagree. FAITHFUL availability = event-based (the
// poller's Meraki uplink-status outage log), NOT the disqualified loss-derived snapshot value.
//
// Aligned with Meraki's "% Time Up" method: availability = uplink up WHILE THE MX IS ONLINE ÷
// TIME THE MX IS ONLINE. Periods where the whole box is offline are removed from the denominator
// (device downtime, not uplink downtime). We recognise device-offline TWO ways:
//   1. explicit attribution 'site' (both-down / power) or 'maintenance' — set by the nightly
//      ingester; and
//   2. ON THE FLY: any interval where ALL of a device's uplinks are down at once (both wan1 AND
//      wan2 down together) — so a power/site outage is excluded IMMEDIATELY, without waiting for
//      the nightly attribution. ISP downtime (one uplink down while another is up) still counts.
// A single-uplink device cannot distinguish device-offline from an ISP fault, so nothing is
// inferred there (its down time counts, same as Meraki).
const { statusColor } = require('./merakiWanQuality');

const EXCLUDED_ATTR = new Set(['site', 'maintenance']);
const _attr = (o) => String((o && o.attribution) || '').trim().toLowerCase();

// ── interval math on [start,end) ms — few intervals per uplink, so simple O(n·m) is fine ──
function _mergeIntervals(iv) {
  const a = iv.slice().sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [s, e] of a) {
    if (out.length && s <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], e);
    else out.push([s, e]);
  }
  return out;
}
// Outage rows → merged clamped intervals within [fromMs,toMs]. Open outage (restored_end null) → toMs.
function _clampIntervals(outages, fromMs, toMs) {
  const iv = [];
  for (const o of (outages || [])) {
    if (!o) continue;
    const s = Date.parse(o.detected_start);
    if (Number.isNaN(s)) continue;
    let e = o.restored_end == null ? toMs : Date.parse(o.restored_end);
    if (Number.isNaN(e)) e = toMs;
    const cs = Math.max(s, fromMs), ce = Math.min(e, toMs);
    if (ce > cs) iv.push([cs, ce]);
  }
  return _mergeIntervals(iv);
}
function _intersect(a, b) {   // both merged+sorted
  const out = []; let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    const s = Math.max(a[i][0], b[j][0]), e = Math.min(a[i][1], b[j][1]);
    if (e > s) out.push([s, e]);
    if (a[i][1] < b[j][1]) i++; else j++;
  }
  return out;
}
function _len(iv) { let t = 0; for (const [s, e] of iv) t += e - s; return t; }
// Total length of a NOT covered by b (both merged+sorted).
function _subtractLen(a, b) {
  let total = 0;
  for (const [s, e] of a) {
    let cur = s;
    for (const [bs, be] of b) {
      if (be <= cur) continue;
      if (bs >= e) break;
      if (bs > cur) total += bs - cur;
      cur = Math.max(cur, be);
      if (cur >= e) break;
    }
    if (cur < e) total += e - cur;
  }
  return total;
}

// Per-uplink availability for one device (one (site_id, sub_site)) over [fromMs,toMs], with
// device-offline (all-uplinks-down + attributed site/maintenance) removed from the denominator.
// `uplinks` = the uplink objects for THIS device; `outagesOf(u)` returns u's outage rows.
// Returns an array of availabilities aligned to `uplinks` (null when window/denominator invalid).
function siteEventAvailability(uplinks, outagesOf, fromMs, toMs) {
  const win = toMs - fromMs;
  const downs = uplinks.map(u => _clampIntervals(outagesOf(u), fromMs, toMs));
  const excl = uplinks.map(u => _clampIntervals((outagesOf(u) || []).filter(o => EXCLUDED_ATTR.has(_attr(o))), fromMs, toMs));
  // device-offline (on the fly) = ALL uplinks down at once — only inferable with >=2 uplinks.
  let bothDown = uplinks.length >= 2 ? downs[0] : [];
  for (let i = 1; i < downs.length; i++) bothDown = _intersect(bothDown, downs[i]);
  return uplinks.map((u, i) => {
    if (!(win > 0)) return null;
    const excluded = _mergeIntervals(bothDown.concat(excl[i]));   // device-offline for this uplink
    const denom = win - _len(excluded);
    if (!(denom > 0)) return null;                                // whole window device-offline
    const counted = _subtractLen(downs[i], excluded);             // ISP downtime (uplink down, box online)
    return Math.round((100 * (denom - counted) / denom) * 100) / 100;
  });
}

// Backward-compatible per-uplink availability (attribution-only exclusion, no cross-uplink
// inference). Kept for callers that have a single uplink's outages in isolation.
function eventAvailability(outages, fromMs, toMs) {
  return siteEventAvailability([{}], () => outages, fromMs, toMs)[0];
}

// Mutating helpers. `cells` are the uplink objects of ONE device (share site_id+sub_site).
function applySiteEventAvailability(cells, outages, opts = {}) {
  const list = cells || [];
  if (!list.length) return list;
  const target = opts.target == null ? 98 : Number(opts.target);
  const os = outages || [];
  const outagesOf = (u) => os.filter(o => o && o.site_id === u.site_id && (o.sub_site || '') === (u.sub_site || '') && o.uplink === u.uplink);
  // Availability is only meaningful over the time actually collected: clamp the window start to
  // when monitoring began (minFromMs). If that leaves no window (period entirely before
  // monitoring) → the helper returns null (no data), never a fabricated 100%.
  let fromMs = opts.fromMs;
  if (opts.minFromMs != null && Number.isFinite(opts.minFromMs)) fromMs = Math.max(fromMs, opts.minFromMs);
  const avs = siteEventAvailability(list, outagesOf, fromMs, opts.toMs);
  list.forEach((u, i) => {
    const av = avs[i];
    u.availability_pct = av;
    u.status_color = (av == null) ? 'none' : statusColor(av, target);
    u.basis = 'event';
  });
  return list;
}

// Legacy per-cell entry (window derived from each cell's period_start/period_end date). Groups
// the given cells by (site_id, sub_site) so cross-uplink device-offline is inferred per device.
function applyEventAvailability(cells, outages, opts = {}) {
  const target = opts.target == null ? 98 : Number(opts.target);
  const minFromMs = (opts.minFromMs != null && Number.isFinite(opts.minFromMs)) ? opts.minFromMs : null;
  const groups = new Map();
  for (const u of (cells || [])) {
    const k = `${u.site_id}|${u.sub_site || ''}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(u);
  }
  for (const g of groups.values()) {
    const fMs = Date.parse((g[0].period_start || '') + 'T00:00:00Z');
    const tMs = Date.parse((g[0].period_end || g[0].period_start || '') + 'T23:59:59Z');
    applySiteEventAvailability(g, outages, { target, fromMs: fMs, toMs: tMs, minFromMs });
  }
  return cells;
}

module.exports = { applyEventAvailability, applySiteEventAvailability, eventAvailability, siteEventAvailability };
