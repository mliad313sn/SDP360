'use strict';

// Pure: rows = [{ site, open_incidents, has_active_mi, overdue_open }] →
// exception-only list [{ code, name, status, open_incidents }], major first,
// max 4. Only major/degraded are emitted (operational sites are omitted).
function deriveSiteStatus(rows, opts = {}) {
  const cap = opts.cap || 4;
  const out = [];
  for (const r of rows || []) {
    let status = 'operational';
    if (r.has_active_mi) status = 'major';
    else if ((r.overdue_open || 0) >= 1) status = 'degraded';
    if (status === 'operational') continue;
    out.push({ code: r.code || r.site, name: r.name || r.site, status, open_incidents: r.open_incidents || 0 });
  }
  const rank = { major: 0, degraded: 1 };
  out.sort((a, b) => rank[a.status] - rank[b.status] || b.open_incidents - a.open_incidents);
  return out.slice(0, cap);
}

module.exports = { deriveSiteStatus };
