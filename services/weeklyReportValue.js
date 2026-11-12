'use strict';
// P4 / B9 + A2 — weekly-report value metrics, for the future value scoreboard (goal D2).
//
//  composeTiming(rows, {dueDays, now})  PURE. Time-to-complete per report = first section edit → FIRST submission,
//                                       both read from audit_log (server timestamps, now()) — nothing the browser
//                                       can set. On-time = first submission ≤ week end_date + dueDays (end of day
//                                       UTC). dueDays not set ('' = policy not decided) → on_time is null for every
//                                       report: an undecided deadline is UNKNOWN, never "0 % on time".
//  composePrefill(rows, {minutesPerCell}) PURE. Over the infrastructure KPI rows of the window: measurable cells
//                                       (WAN1/WAN2/LAN/WLAN/Servers), auto-prefilled (verified Meraki/OpManager
//                                       provenance), manual, empty (unknown), provenance not recorded (rows saved
//                                       before migration 096). minutes_saved = auto × minutesPerCell only when the
//                                       stopwatch baseline has been entered (weekly_report_minutes_per_kpi_cell);
//                                       otherwise null.
//  loadWeeklyValue(H, {from, to, siteIds}) the two readers (siteIds null = every site, [] = none).
const DAY = 864e5;
const _ms = (t) => { if (t == null || t === '') return null; const v = Date.parse(String(t).replace(' ', 'T')); return Number.isFinite(v) ? v : null; };
const _num = (v) => { if (v == null || String(v).trim() === '') return null; const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };

function median(xs) {
  const a = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round(((a[m - 1] + a[m]) / 2) * 10) / 10;
}

function timingOf(r, dueDays, now) {
  const e = _ms(r.first_edit_at), s = _ms(r.first_submit_at);
  const minutes = e != null && s != null && s >= e ? Math.round((s - e) / 6e4) : null;
  let due = null, on_time = null;
  if (dueDays != null && r.end_date) {
    const end = _ms(String(r.end_date).slice(0, 10) + 'T23:59:59.999Z');
    if (end != null) {
      due = end + dueDays * DAY;
      if (s != null) on_time = s <= due;
      else if (now > due) on_time = false;      // past the deadline and still not submitted = late
    }
  }
  return { report_id: Number(r.report_id), site_id: r.site_id == null ? null : Number(r.site_id), site_name: r.site_name || null,
    week_label: r.week_label || null, status: r.status || null, first_edit_at: r.first_edit_at || null,
    first_submit_at: r.first_submit_at || null, minutes, due_at: due == null ? null : new Date(due).toISOString(), on_time };
}

function _agg(list) {
  const decided = list.filter((x) => x.on_time != null);
  return {
    reports: list.length,
    submitted: list.filter((x) => x.first_submit_at).length,
    median_minutes: median(list.map((x) => x.minutes)),
    timed: list.filter((x) => x.minutes != null).length,
    on_time_pct: decided.length ? Math.round((100 * decided.filter((x) => x.on_time).length) / decided.length) : null,
    on_time_den: decided.length,
  };
}

function composeTiming(rows, { dueDays, now = Date.now() } = {}) {
  const dd = _num(dueDays);
  const reports = (rows || []).map((r) => timingOf(r, dd, now));
  const bySite = new Map();
  for (const x of reports) { const k = x.site_id; if (!bySite.has(k)) bySite.set(k, []); bySite.get(k).push(x); }
  const by_site = Array.from(bySite.entries()).map(([site_id, list]) => ({ site_id, site_name: list[0].site_name, ..._agg(list) }))
    .sort((a, b) => String(a.site_name || '').localeCompare(String(b.site_name || '')));
  return { due_days: dd, due_policy: dd == null ? 'not decided (weekly_report_due_days is empty)' : `week end + ${dd} d`, overall: _agg(reports), by_site, reports };
}

function composePrefill(rows, { minutesPerCell } = {}) {
  const fam = (s) => require('./opmReportFill').serviceToFill(s);
  const mpc = _num(minutesPerCell);
  const c = { measurable: 0, auto: 0, manual: 0, unknown: 0, not_recorded: 0 };
  const bySite = new Map();
  for (const r of rows || []) {
    if (!fam(r.service)) continue;
    const k = r.site_id == null ? null : Number(r.site_id);
    if (!bySite.has(k)) bySite.set(k, { site_id: k, site_name: r.site_name || null, measurable: 0, auto: 0, manual: 0, unknown: 0, not_recorded: 0 });
    const s = bySite.get(k);
    const add = (key) => { c[key]++; s[key]++; };
    add('measurable');
    if (r.status_value == null || String(r.status_value).trim() === '') add('unknown');
    else if (r.value_source === 'meraki' || r.value_source === 'opmanager') add('auto');
    else if (r.value_source === 'manual') add('manual');
    else add('not_recorded');
  }
  const pct = (o) => (o.measurable ? Math.round((100 * o.auto) / o.measurable) : null);
  return {
    ...c, auto_pct: pct(c), minutes_per_cell: mpc,
    minutes_saved: mpc == null ? null : Math.round(c.auto * mpc * 10) / 10,
    by_site: Array.from(bySite.values()).map((s) => ({ ...s, auto_pct: pct(s) })),
  };
}

const _ts = (col) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

async function loadWeeklyValue(H, { from, to, siteIds = null } = {}) {
  if (Array.isArray(siteIds) && !siteIds.length) return { timingRows: [], prefillRows: [] };
  const params = [from, to];
  let siteSql = '';
  if (Array.isArray(siteIds)) { siteSql = ` AND wr.site_id IN (${siteIds.map(() => '?').join(',')})`; params.push(...siteIds.map(Number)); }
  const timingRows = await H.prepare(`SELECT wr.id AS report_id, wr.site_id, s.name AS site_name, w.label AS week_label, w.end_date, wr.status,
      (SELECT ${_ts('MIN(a.created_at)')} FROM audit_log a WHERE a.report_id = wr.id AND a.action LIKE 'edited\\_%') AS first_edit_at,
      (SELECT ${_ts('MIN(a.created_at)')} FROM audit_log a WHERE a.report_id = wr.id AND a.action = 'submitted') AS first_submit_at
    FROM weekly_reports wr JOIN weeks w ON w.id = wr.week_id JOIN sites s ON s.id = wr.site_id
    WHERE w.end_date >= ? AND w.end_date <= ?${siteSql} ORDER BY w.end_date, s.name`).all(...params);
  const prefillRows = await H.prepare(`SELECT wr.site_id, s.name AS site_name, k.service, k.status_value, k.value_source
    FROM infra_kpis k JOIN weekly_reports wr ON wr.id = k.report_id JOIN weeks w ON w.id = wr.week_id JOIN sites s ON s.id = wr.site_id
    WHERE w.end_date >= ? AND w.end_date <= ?${siteSql}`).all(...params);
  return { timingRows, prefillRows };
}

module.exports = { composeTiming, composePrefill, loadWeeklyValue, median };
