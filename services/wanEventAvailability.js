'use strict';
// Event-based 24x7 WAN availability applied to circuit-week cells — the ONE shared code path
// used by BOTH the WAN Health dashboard summary and the site-report auto-fill, so the two can
// never disagree on a site's WAN number. FAITHFUL availability = event-based (the poller's
// Meraki uplink-status outage log), NOT the disqualified loss-derived snapshot value.
//
// Each cell must carry {site_id, sub_site, uplink, period_start, period_end}. Mutates each cell
// IN PLACE: sets availability_pct (event-based, null when the window is invalid), status_color
// (via statusColor(av, target); 'none' when null), and basis='event'. `outages` are the rows
// from getWanOutagesOverlapping (fields detected_start / restored_end / site_id / sub_site /
// uplink). The poller-inactive case (present a '—' instead of a fabricated %) is the CALLER's
// responsibility — this helper only computes the event-based figure.
const { availability24x7 } = require('./wanSla');
const { statusColor } = require('./merakiWanQuality');

function applyEventAvailability(cells, outages, opts = {}) {
  const target = opts.target == null ? 98 : Number(opts.target);
  const os = outages || [];
  for (const u of (cells || [])) {
    const fMs = Date.parse((u.period_start || '') + 'T00:00:00Z');
    const tMs = Date.parse((u.period_end || u.period_start || '') + 'T23:59:59Z');
    const mine = os.filter(o =>
      o && o.site_id === u.site_id && (o.sub_site || '') === (u.sub_site || '') && o.uplink === u.uplink);
    const av = (tMs > fMs) ? availability24x7(mine, fMs, tMs) : null;
    u.availability_pct = av;
    u.status_color = (av == null) ? 'none' : statusColor(av, target);
    u.basis = 'event';
  }
  return cells;
}

module.exports = { applyEventAvailability };
