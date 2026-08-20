'use strict';
// Event-based 24x7 WAN availability applied to circuit-week cells — the ONE shared code path
// used by BOTH the WAN Health dashboard summary and the site-report auto-fill, so the two can
// never disagree on a site's WAN number. FAITHFUL availability = event-based (the poller's
// Meraki uplink-status outage log), NOT the disqualified loss-derived snapshot value.
//
// Aligned with Meraki's "% Time Up" method: availability = uplink up WHILE THE MX IS ONLINE ÷
// TIME THE MX IS ONLINE. So periods where the whole box is offline (both uplinks down together
// = attribution 'site' = power/MX outage) and planned 'maintenance' are removed from the
// denominator, exactly as Meraki excludes device-offline time from an uplink's % Time Up. ISP
// downtime (and not-yet-attributed provisional outages) counts against the uplink.
//
// Each cell must carry {site_id, sub_site, uplink, period_start, period_end}. Mutates each cell
// IN PLACE: availability_pct (null when the window/denominator is invalid), status_color (via
// statusColor(av, target); 'none' when null), basis='event'. `outages` are getWanOutagesOverlapping
// rows (detected_start / restored_end / attribution / site_id / sub_site / uplink). The
// poller-inactive case ('—' instead of a fabricated %) is the CALLER's responsibility.
const { statusColor } = require('./merakiWanQuality');

// Device-offline (site power / MX down) + planned maintenance → OUT of monitored time, per
// Meraki. Everything else (ISP faults, and provisional null attribution) counts as uplink down.
const EXCLUDED_ATTR = new Set(['site', 'maintenance']);
const _attr = (o) => String((o && o.attribution) || '').trim().toLowerCase();

// Sum of outage down-time clamped to [fromMs, toMs]. An open outage (restored_end null) runs to toMs.
function _clampedDownMs(outages, fromMs, toMs) {
  let down = 0;
  for (const o of (outages || [])) {
    if (!o) continue;
    const s = Date.parse(o.detected_start);
    if (Number.isNaN(s)) continue;
    const e = o.restored_end == null ? toMs : Date.parse(o.restored_end);
    const cs = Math.max(s, fromMs), ce = Math.min(Number.isNaN(e) ? toMs : e, toMs);
    if (ce > cs) down += (ce - cs);
  }
  return down;
}

// Meraki-aligned per-uplink availability over [fromMs, toMs] from this uplink's outage rows.
//   denom = window − device_offline_time            (Meraki: "time the MX is online")
//   up    = denom − isp_downtime                    (Meraki: "uplink up while MX online")
// Returns null when the window is invalid OR the whole window was device-offline (nothing to
// attribute to the uplink — never a fabricated 0/100).
function eventAvailability(outages, fromMs, toMs) {
  const win = toMs - fromMs;
  if (!(win > 0)) return null;
  const excluded = [], counted = [];
  for (const o of (outages || [])) (EXCLUDED_ATTR.has(_attr(o)) ? excluded : counted).push(o);
  const offlineMs = _clampedDownMs(excluded, fromMs, toMs);   // MX offline (site/maintenance) → out of denominator
  const denom = win - offlineMs;
  if (!(denom > 0)) return null;                              // window entirely device-offline
  const uplinkDownMs = _clampedDownMs(counted, fromMs, toMs); // ISP + provisional → counts against the uplink
  return Math.round((100 * (denom - uplinkDownMs) / denom) * 100) / 100;
}

function applyEventAvailability(cells, outages, opts = {}) {
  const target = opts.target == null ? 98 : Number(opts.target);
  const os = outages || [];
  for (const u of (cells || [])) {
    const fMs = Date.parse((u.period_start || '') + 'T00:00:00Z');
    const tMs = Date.parse((u.period_end || u.period_start || '') + 'T23:59:59Z');
    const mine = os.filter(o =>
      o && o.site_id === u.site_id && (o.sub_site || '') === (u.sub_site || '') && o.uplink === u.uplink);
    const av = (tMs > fMs) ? eventAvailability(mine, fMs, tMs) : null;
    u.availability_pct = av;
    u.status_color = (av == null) ? 'none' : statusColor(av, target);
    u.basis = 'event';
  }
  return cells;
}

module.exports = { applyEventAvailability, eventAvailability };
