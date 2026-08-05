'use strict';
// Pure year-to-date aggregators for the exec deck's companion slides
// (slide 9b "Major Incidents — Year to Date"). Kept OUT of reportPayload's
// _majorIncidents so the monthly path (which has no regression test) stays
// byte-identical; this module is unit-tested (tests/exec-yearly-mi.test.js).
//
// The P1/P2 classification + downtime resolution mirror the monthly
// _majorIncidents logic (services/reportPayload.js) exactly, so YTD totals are
// consistent with (and >=) the monthly figures.

// Accent- + case-fold a site string (site selector carries diacritics —
// "Houndé"/"Lafigué" — but SDP ticket sites do not: "HOUNDE"/"LAFIGUE").
function _norm(s) {
  return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// SDP UDF datetime "13 Jun, 2026 18:57:00" (also accepts ISO) → Date | null.
const _MON3 = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function _parseSdpDT(v) {
  if (!v) return null;
  const m = String(v).match(/(\d{1,2})\s+(\w{3}),?\s+(\d{4})[\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m && _MON3[m[2].toLowerCase()] !== undefined) {
    return new Date(+m[3], _MON3[m[2].toLowerCase()], +m[1], +m[4], +m[5], +(m[6] || 0));
  }
  const d = new Date(String(v).replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
}

function _udfPick(udf, variants) {
  for (const k of variants) {
    if (udf[k] != null && String(udf[k]).trim()) return String(udf[k]).trim();
  }
  return '';
}
const _UDF = {
  downtime:     ['UDF:Total Downtime (Hours):', 'UDF:Total Downtime (Hours)', 'UDF:Total Downtime:', 'UDF:Total Downtime', 'Total Downtime'],
  actual_start: ['UDF:Incident Actual Start Time', 'UDF:Incident Actual Start Time:'],
  actual_end:   ['UDF:Incident Actual Resolution Time', 'UDF:Incident Actual Resolution Time:'],
};

// Effective downtime in hours for one incident — the objective outage window
// (Actual Start → Actual Resolution UDFs) beats the typed Total Downtime number
// (rarely filled, rounded to 0 for sub-hour outages). Mirrors _majorIncidents.
function _downtimeH(udf) {
  const as = _parseSdpDT(_udfPick(udf, _UDF.actual_start));
  const ae = _parseSdpDT(_udfPick(udf, _UDF.actual_end));
  if (as && ae && ae > as && (ae - as) < 30 * 86400000) return (ae - as) / 3600000;
  const dt = parseFloat(_udfPick(udf, _UDF.downtime));
  return !isNaN(dt) && dt > 0 ? dt : 0;
}

/**
 * Year-to-date major-incident aggregate. `rows` are request_records for the YTD
 * window already fetched by the caller: { site, request_status, created_time,
 * resolved_time, completed_time, udf_json, impact }. opts.site scopes the count
 * ('all'/empty = fleet-wide) with the same fuzzy match the deck uses elsewhere.
 * Returns { mi_total, mi_critical, mi_high, mi_downtime_h, mi_resolved,
 *           by_month:[{m,count}] }.
 */
function aggregateYearlyMI(rows, opts = {}) {
  const out = { mi_total: 0, mi_critical: 0, mi_high: 0, mi_downtime_h: 0, mi_resolved: 0, by_month: [] };
  const siteSel = (opts.site && _norm(opts.site) !== 'all') ? _norm(opts.site) : null;
  const siteOk = (rowSite) => {
    if (!siteSel) return true;
    const rs = _norm(rowSite);
    return rs.includes(siteSel) || siteSel.includes(rs.split(' ')[0]);
  };
  const monthCount = {};
  let downtime = 0;
  (Array.isArray(rows) ? rows : []).forEach((r) => {
    if (!siteOk(r.site)) return;
    out.mi_total++;

    const mm = String(r.created_time || '').slice(0, 7);   // 'YYYY-MM'
    const m = parseInt(mm.slice(5, 7), 10);
    if (m >= 1 && m <= 12) monthCount[m] = (monthCount[m] || 0) + 1;

    let udf = {};
    try { udf = r.udf_json ? JSON.parse(r.udf_json) : {}; } catch (_) { udf = {}; }
    const priority = udf['Priority'] || udf['priority'] || udf['Severity']
      || (r.impact === 'Enterprise' ? 'Critical' : 'High');
    const p = String(priority).toLowerCase();
    if (p.includes('critical') || p === 'p1') out.mi_critical++;
    else if (p.includes('high') || p === 'p2') out.mi_high++;

    downtime += _downtimeH(udf);

    const st = String(r.request_status || '').toLowerCase();
    if (st === 'closed' || st === 'resolved' || r.resolved_time || r.completed_time) out.mi_resolved++;
  });
  out.mi_downtime_h = Math.round(downtime);
  out.by_month = Object.keys(monthCount)
    .map((m) => ({ m: +m, count: monthCount[m] }))
    .sort((a, b) => a.m - b.m);
  return out;
}

module.exports = { aggregateYearlyMI };
