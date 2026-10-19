/**
 * reportPayload.js — Phase 3 of the Group IT Operations Report integration.
 *
 * The dashboard's executive-report.html button POSTs a payload with the
 * current month + site/group filter, plus a handful of KPI numbers it
 * happens to have on screen. The Python renderer
 * (tools/exec-pptx/render.py) expects the much richer `kpis-may.json`
 * shape (see tools/exec-pptx/fixtures/kpis-may.json) with categories,
 * channel mix, ageing per group, MI records, voice themes, activity
 * tracker snapshot, and per-slide commentary.
 *
 * This module assembles that shape SERVER-SIDE by reading from the
 * existing reports-db helpers + tracker-db.loadTracker(). It runs once
 * per generate-deck click and produces the JSON Python eats on stdin.
 *
 * Usage:
 *   const reportPayload = require('./services/reportPayload');
 *   const enriched = reportPayload.build(browserPayload);
 *   childPython.stdin.end(JSON.stringify(enriched), 'utf8');
 *
 * Browser payload contract (kept stable so executive-report.html
 * doesn't have to change):
 *   filters: {
 *     period_label, period_short, month_name, year, prepared_by,
 *     site_id, site_name, group, groups[]
 *   }
 *   kpis: {...}            ← optional override; takes precedence over DB
 *   commentary: {...}      ← optional override; per-slide strings
 *
 * Output shape — kpis-may.json fields (see fixtures for the canonical
 * reference):
 *   month, year, total, total_apr, total_delta_pct, closed, ...
 *   channel{}, categories{}, groups{}, ageing{}, mi_records[],
 *   changes_*, voice_themes, tracker, commentary
 *
 * Resilience: every DB lookup is wrapped in a try/catch with a fallback
 * empty object so a single failing query doesn't 500 the whole render.
 * Render.py has _DEFAULTS for everything; the worst case is a slide
 * with "—" values instead of real numbers.
 */
'use strict';

const reportsDb = require('../reports-db');
const { aggregateYearlyMI } = require('./execYearly');   // slide 9b (Major Incidents — YTD)
let trackerDb = null;
try { trackerDb = require('../tracker-db'); } catch (_) { /* tracker offline → slides 10/11 stub */ }

// ── Backend-aware DB read helpers ──────────────────────────────────────────
// Prod now runs reports.db under REPORTS_BACKEND=postgres, where reportsDb.db
// is the EMPTY sqlite file. Route every raw SELECT through _get/_all so it hits
// the async pg adapter (reportsDb.pgHandle()) under postgres and the synchronous
// better-sqlite3 handle under sqlite. _toPg translates the sqlite idioms these
// queries use to the SAME dialect contract the reports-db.js PG forks apply.
const _isPg = () => reportsDb.REPORTS_BACKEND === 'postgres';

// SQLite → Postgres dialect translation for the exec-deck queries.
// Idioms present across the 7 queries: strftime('%Y-%m', X)= / strftime('%Y-%m-%d',…),
// date(X) BETWEEN, and case-insensitive LIKE.
//  • strftime('%Y-%m', X)     → to_char(X::timestamptz,'YYYY-MM')   (month bucket compare)
//  • strftime('%Y-%m-%d', X)  → to_char(X::timestamptz,'YYYY-MM-DD')
//  • date(X)                  → to_char(X::timestamptz,'YYYY-MM-DD') — kept as a LEXICAL
//    string compare (NOT ::date) so the lazy 'YYYY-MM-31' upper bound these queries pass
//    still captures the whole month; casting '2026-06-31'::date would throw in pg.
//  • LIKE → ILIKE — sqlite LIKE is case-insensitive for ASCII; pg LIKE is case-sensitive.
//    Both MI LIKEs here (request_type / template '%Major Incident%') rely on that, so
//    ILIKE preserves identical matching. The GROUP BY <alias> clauses (cat/ch/g) resolve
//    to the SELECT output alias in pg (extension) — no input column shadows them — so they
//    pass through unchanged, same as under sqlite.
function _toPg(sql) {
  return sql
    .replace(/strftime\(\s*'%Y-%m-%d'\s*,\s*([^)]+?)\s*\)/gi, "to_char($1::timestamptz,'YYYY-MM-DD')")
    .replace(/strftime\(\s*'%Y-%m'\s*,\s*([^)]+?)\s*\)/gi,    "to_char($1::timestamptz,'YYYY-MM')")
    .replace(/\bdate\(\s*([^)]+?)\s*\)/gi,                    "to_char($1::timestamptz,'YYYY-MM-DD')")
    .replace(/\bLIKE\b/gi, 'ILIKE');
}
async function _all(sql, ...params) {
  if (_isPg()) return await reportsDb.pgHandle().prepare(_toPg(sql)).all(...params);
  return reportsDb.db.prepare(sql).all(...params);
}
async function _get(sql, ...params) {
  if (_isPg()) return await reportsDb.pgHandle().prepare(_toPg(sql)).get(...params);
  return reportsDb.db.prepare(sql).get(...params);
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTH_SHORT = MONTH_NAMES.map(m => m.slice(0, 3));

function _prevMonth(year, month) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

function _safeNum(v, def = 0) {
  if (v == null || isNaN(v)) return def;
  return Number(v);
}

function _pct(num, den) {
  if (!den) return 0;
  return Math.round((num / den) * 1000) / 10;
}

// ── Helpdesk KPIs from request_records ─────────────────────────────────────
async function _helpdeskKpis(filters) {
  const out = {
    total: 0, total_apr: 0, total_delta_pct: 0,
    closed: 0, closed_delta_pct: 0,
    closure_rate: 0, closure_rate_delta_pp: 0,
    sla_compliance: 0, sla_compliance_delta_pp: 0,
    frt_sla: 0, frt_sla_delta_pp: 0,
    open_backlog: 0, open_backlog_delta_pct: null,
    fcr_rate: 0, fcr_delta_pp: null,
    avg_res_days: 0,
    time_to_assign_h: 0, first_reply_h: 0, closing_time_d: 0,
  };
  const { site_id, year, month } = filters;
  if (!site_id || !year || !month) return out;

  try {
    const cur  = await reportsDb.getCalendarMonthlyHelpdesk(site_id, year, month);
    const prev = await (async () => {
      const { year: py, month: pm } = _prevMonth(year, month);
      return reportsDb.getCalendarMonthlyHelpdesk(site_id, py, pm);
    })();
    if (cur) {
      out.total          = _safeNum(cur.inbound);
      out.closed         = _safeNum(cur.closed);
      out.closure_rate   = _safeNum(cur.close_pct);
      out.sla_compliance = _safeNum(cur.sla_res_pct);
      out.frt_sla        = _safeNum(cur.sla_reply_pct);
      out.avg_res_days   = _safeNum(cur.avg_resolution_d);
      out.time_to_assign_h = _safeNum(cur.avg_tta_h);
      out.first_reply_h  = _safeNum(cur.avg_first_reply_h);
    }
    if (prev) {
      out.total_apr               = _safeNum(prev.inbound);
      out.total_delta_pct         = prev.inbound  ? Math.round(((out.total  - prev.inbound) / prev.inbound)  * 100) : 0;
      out.closed_delta_pct        = prev.closed   ? Math.round(((out.closed - prev.closed)  / prev.closed)   * 100) : 0;
      out.closure_rate_delta_pp   = Math.round((out.closure_rate   - _safeNum(prev.close_pct))     * 10) / 10;
      out.sla_compliance_delta_pp = Math.round((out.sla_compliance - _safeNum(prev.sla_res_pct))   * 10) / 10;
      out.frt_sla_delta_pp        = Math.round((out.frt_sla        - _safeNum(prev.sla_reply_pct)) * 10) / 10;
    }
  } catch (e) {
    console.warn('[reportPayload] helpdeskKpis failed:', e.message);
  }
  return out;
}

// ── Distribution + channel breakdowns from request_records ─────────────────
async function _distribution(filters) {
  const out = { categories: {}, channel: {}, groups: {} };
  const { site_id, year, month } = filters;
  if (!site_id || !year || !month) return out;

  // Same group filter as getCalendarMonthlyHelpdesk: derive from sites.zoho_group
  try {
    const siteRow = await _get('SELECT zoho_group FROM sites WHERE id=?', site_id);
    if (!siteRow || !siteRow.zoho_group) return out;
    const groups = siteRow.zoho_group.split(',').map(g => g.trim()).filter(Boolean);
    if (!groups.length) return out;
    const inClause = groups.map(() => '?').join(',');
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    const dateClauseParams = [`${ym}-01`, `${ym}-31`];

    // Categories
    const catRows = await _all(`
      SELECT COALESCE(NULLIF(TRIM(category), ''), 'Uncategorized') AS cat, COUNT(*) AS n
      FROM request_records
      WHERE tech_group IN (${inClause}) AND date(created_time) BETWEEN ? AND ?
      GROUP BY cat ORDER BY n DESC LIMIT 20
    `, ...groups, ...dateClauseParams);
    catRows.forEach(r => { out.categories[r.cat] = r.n; });

    // Submission channel (mode)
    const chRows = await _all(`
      SELECT COALESCE(NULLIF(TRIM(mode), ''), 'Unknown') AS ch, COUNT(*) AS n
      FROM request_records
      WHERE tech_group IN (${inClause}) AND date(created_time) BETWEEN ? AND ?
      GROUP BY ch ORDER BY n DESC
    `, ...groups, ...dateClauseParams);
    chRows.forEach(r => {
      if (r.ch === 'Unknown') return;
      out.channel[r.ch] = r.n;
    });

    // Groups breakdown
    const grpRows = await _all(`
      SELECT tech_group AS g, COUNT(*) AS n
      FROM request_records
      WHERE tech_group IN (${inClause}) AND date(created_time) BETWEEN ? AND ?
      GROUP BY g ORDER BY n DESC
    `, ...groups, ...dateClauseParams);
    grpRows.forEach(r => { out.groups[r.g] = r.n; });
  } catch (e) {
    console.warn('[reportPayload] distribution failed:', e.message);
  }
  return out;
}

// ── Ageing per IT group ────────────────────────────────────────────────────
async function _ageing() {
  const out = {};
  try {
    const rows = await reportsDb.getAgeingByGroupDB();
    rows.forEach(r => {
      const grp = r.group || r.tech_group || r.grp;
      if (!grp) return;
      out[grp] = {
        '0-30':  _safeNum(r.t0_30   || r.under_30),
        '31-60': _safeNum(r.t31_45  || r['31-60'] || r.t31_60),
        '>60':   _safeNum(r.tOver60 || r.over_60),
        'total': _safeNum(r.total),
      };
    });
  } catch (e) {
    console.warn('[reportPayload] ageing failed:', e.message);
  }
  return out;
}

// ── Major Incidents for the selected month (created OR resolved in month) ─
async function _majorIncidents(filters) {
  const out = { mi_total: 0, mi_critical: 0, mi_high: 0, mi_records: [] };
  const { year, month, site_id } = filters;
  if (!year || !month) return out;

  // Site scope (slide 9). Mirrors the browser siteMatch() fuzzy logic so the
  // incident list matches what the rest of the deck shows when a specific
  // site is selected. 'all'/empty = fleet-wide (unchanged). Group filtering
  // is intentionally NOT applied — major incidents are cross-cutting.
  // Accent- + case-insensitive (site selector carries diacritics — "Houndé",
  // "Lafigué" — but SDP ticket sites do not: "HOUNDE", "LAFIGUE").
  const _siteNorm = s => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const _siteSel = (filters.site && _siteNorm(filters.site) !== 'all') ? _siteNorm(filters.site) : null;
  const _miSiteOk = (rowSite) => {
    if (!_siteSel) return true;
    const rs = _siteNorm(rowSite);
    return rs.includes(_siteSel) || _siteSel.includes(rs.split(' ')[0]);
  };

  try {
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    // request_records doesn't store an explicit priority column — the
    // priority is encoded in udf_json (Zoho stores it there) or derived
    // from the request_type/subject. We parse udf_json defensively and
    // fall back to 'High' when it's missing.
    //
    // User direction 2026-06-04: filter strictly by created_time so the
    // count on the tile ("Created in May") matches the list below.
    // Previously the SQL was `created_time = ? OR resolved_time = ?`
    // which let prior-month incidents resolved this month into the list
    // (e.g. "Incident 3rd and 6th February 2026" resolved 2026-05-19
    // was showing up in the May deck) and made the P1/P2 totals not
    // reconcile with the dashboard.
    const rows = await _all(`
      SELECT display_id AS id, site, subject, request_status AS status,
             created_time, resolved_time, completed_time, udf_json,
             impact
      FROM request_records
      WHERE (request_type LIKE '%Major Incident%' OR template LIKE '%Major Incident%')
        AND strftime('%Y-%m', created_time) = ?
      ORDER BY created_time DESC
      LIMIT ${_siteSel ? 50 : 10}
    `, ym);

    // Variant-tolerant UDF reader — Zoho ships keys with mixed
    // colon-space conventions. Mirrors the browser-side resolver in
    // public/lib/dashboard-shared.js (incidentUdf) so the PPTX path
    // sees the same content as the dashboard register table.
    const _udfPick = (udf, variants) => {
      for (const k of variants) {
        if (udf[k] != null && String(udf[k]).trim()) return String(udf[k]).trim();
      }
      return '';
    };
    const _UDF = {
      rca:      ['UDF:Root Cause Analysis :','UDF:Root Cause Analysis:','UDF:Root Cause Analysis','Root Cause Analysis','RCA'],
      ca:       ['UDF:Corrective action:','UDF:Corrective Action:','Corrective Action','CA'],
      ll:       ['UDF:Lessons Learned:','UDF:Lessons Learned','Lessons Learned','LL'],
      pir:      ['UDF:PIR Required:','UDF:PIR Required','PIR'],
      downtime: ['UDF:Total Downtime (Hours):','UDF:Total Downtime (Hours)','UDF:Total Downtime:','UDF:Total Downtime','Total Downtime'],
      // Objective outage window — filled by technicians on the MI template.
      // "13 Jun, 2026 18:57:00" SDP format. Preferred over the typed
      // Total Downtime number (which is rarely filled and often rounded to 0).
      actual_start: ['UDF:Incident Actual Start Time','UDF:Incident Actual Start Time:'],
      actual_end:   ['UDF:Incident Actual Resolution Time','UDF:Incident Actual Resolution Time:'],
    };
    // Parse the SDP UDF datetime format "13 Jun, 2026 18:57:00" (also accepts
    // ISO). Returns a Date or null.
    const _MON3 = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
    const _parseSdpDT = v => {
      if (!v) return null;
      // eslint-disable-next-line security/detect-unsafe-regex -- reviewed (step 4): bounded \d{1,2}/\d{4}, linear
      const m = String(v).match(/(\d{1,2})\s+(\w{3}),?\s+(\d{4})[\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
      if (m && _MON3[m[2].toLowerCase()] !== undefined) {
        return new Date(+m[3], _MON3[m[2].toLowerCase()], +m[1], +m[4], +m[5], +(m[6] || 0));
      }
      const d = new Date(String(v).replace(' ', 'T'));
      return isNaN(d.getTime()) ? null : d;
    };

    rows.forEach(r => {
      if (!_miSiteOk(r.site)) return;   // site scope (slide 9)
      let priority = 'High';
      let udf = {};
      try {
        udf = r.udf_json ? JSON.parse(r.udf_json) : {};
        priority = udf['Priority'] || udf['priority'] || udf['Severity']
                || (r.impact === 'Enterprise' ? 'Critical' : 'High');
      } catch (_) { /* keep default */ }
      const p = priority.toLowerCase();
      if (p.includes('critical') || p === 'p1') out.mi_critical++;
      else if (p.includes('high') || p === 'p2') out.mi_high++;

      const rca = _udfPick(udf, _UDF.rca);
      const ca  = _udfPick(udf, _UDF.ca);
      const ll  = _udfPick(udf, _UDF.ll);
      const pir = _udfPick(udf, _UDF.pir);
      let   dt  = _udfPick(udf, _UDF.downtime);

      // Effective downtime — the objective outage window (Actual Start →
      // Actual Resolution UDFs) beats the typed Total Downtime number, which
      // technicians rarely fill (and round to 0 for sub-hour outages: prod
      // audit 2026-07-09 — #311587 had "Total Downtime (Hours): 0" for a real
      // 40-min outage, #310139 had no downtime field at all for a 7h cut).
      const _as = _parseSdpDT(_udfPick(udf, _UDF.actual_start));
      const _ae = _parseSdpDT(_udfPick(udf, _UDF.actual_end));
      if (_as && _ae && _ae > _as && (_ae - _as) < 30 * 86400000) {
        dt = ((_ae - _as) / 3600000).toFixed(1);   // hours, 1 decimal
      }

      // MTTR (hours to RESTORE) for the slide-9 card header. Precedence:
      // actual outage window (most honest — the ticket often stays open long
      // after service is back: #310139 restored in 7h, ticket closed 42h
      // later) → resolved−created → downtime UDF.
      let mttr_h = null;
      if (_as && _ae && _ae > _as && (_ae - _as) < 30 * 86400000) {
        mttr_h = Math.max(1, Math.round((_ae - _as) / 3600000));
      }
      const _parseDT = v => { if (!v) return null; const d = new Date(String(v).replace(' ', 'T')); return isNaN(d.getTime()) ? null : d; };
      const _ct = _parseDT(r.created_time);
      const _rt = _parseDT(r.resolved_time) || _parseDT(r.completed_time);
      if (mttr_h == null && _ct && _rt) { const h = Math.round((_rt - _ct) / 3600000); if (h >= 0 && h < 24 * 365) mttr_h = h; }
      if (mttr_h == null && dt != null) { const d = parseFloat(dt); if (!isNaN(d) && d >= 0) mttr_h = Math.round(d); }

      // Compose a "lessons / actions" string render.py uses on slide 9.
      // Honest sourcing: only state "pending" when ALL the post-incident
      // UDFs are empty; otherwise quote whichever fields have content.
      let lessonsLine = '';
      if (ll)        lessonsLine = ll;
      else if (ca)   lessonsLine = `Corrective action: ${ca}`;
      else if (rca)  lessonsLine = `Root cause: ${rca}`;
      else           lessonsLine = 'Lessons-learned capture pending — see ticket for RCA.';

      out.mi_records.push({
        id:       r.id,
        site:     r.site || '—',
        priority,
        subject:  r.subject || '—',
        status:   r.status  || '—',
        date_resolved: r.resolved_time
          ? String(r.resolved_time).slice(0, 10)
          : (r.completed_time ? String(r.completed_time).slice(0, 10) : null),
        // 2026-06-04 — surface the post-incident UDFs to render.py so
        // slide 9 stops saying "Lessons-learned capture pending" on
        // incidents that actually have an RCA filled. render.py reads
        // `lessons` (preferred) then `action` then falls back to the
        // pending message.
        rca, ca, ll, pir, downtime: dt, mttr_h,
        lessons: lessonsLine,
        // Also build a one-line ticket-status detail (used by slide 9
        // when no inline "description" is set).
        detail: pir
          ? `Ticket ${r.id || '?'} · ${r.status || 'Closed'} · PIR ${pir}${dt ? ' · Downtime ' + dt + 'h' : ''}`
          : `Ticket ${r.id || '?'} · status: ${r.status || 'Closed'}${dt ? ' · Downtime ' + dt + 'h' : ''}`,
      });
    });
    out.mi_total = out.mi_records.length;

    // ── Slide-9 tile aggregates (Resolved / Open / Downtime / MoM) ──────
    let _down = 0, _res = 0;
    out.mi_records.forEach(m => {
      const st = String(m.status || '').toLowerCase();
      if (st === 'closed' || st === 'resolved' || m.date_resolved) _res++;
      const d = parseFloat(m.downtime); if (!isNaN(d) && d > 0) _down += d;
    });
    out.mi_resolved   = _res;
    out.mi_open       = Math.max(0, out.mi_total - _res);
    out.mi_downtime_h = Math.round(_down);
    // Previous-month major-incident count → drives the "MoM CHANGE" tile.
    try {
      const _pm  = month === 1 ? 12 : month - 1;
      const _py  = month === 1 ? year - 1 : year;
      const _pym = `${_py}-${String(_pm).padStart(2, '0')}`;
      // Fetch site so the prev-month MoM count respects the same site scope.
      const _prevRows = await _all(`
        SELECT site FROM request_records
        WHERE (request_type LIKE '%Major Incident%' OR template LIKE '%Major Incident%')
          AND strftime('%Y-%m', created_time) = ?`, _pym);
      out.mi_prev_total = _prevRows.filter(r => _miSiteOk(r.site)).length;
    } catch (_) { out.mi_prev_total = null; }
  } catch (e) {
    console.warn('[reportPayload] majorIncidents failed:', e.message);
  }
  return out;
}

// Year-to-date major incidents (slide 9b companion). Fetches every MI created
// from Jan → the report month and aggregates with the pure aggregateYearlyMI
// (P1/P2 + downtime + resolved + per-month), scoped by site the same way as the
// monthly path. Kept separate so the monthly _majorIncidents stays untouched.
async function _majorIncidentsYearly(filters) {
  const empty = { mi_total: 0, mi_critical: 0, mi_high: 0, mi_downtime_h: 0, mi_resolved: 0, by_month: [] };
  const { year, month, site } = filters;
  if (!year || !month) return empty;
  try {
    const from = `${year}-01`;
    const to   = `${year}-${String(month).padStart(2, '0')}`;
    const rows = await _all(`
      SELECT site, request_status, created_time, resolved_time, completed_time, udf_json, impact
      FROM request_records
      WHERE (request_type LIKE '%Major Incident%' OR template LIKE '%Major Incident%')
        AND strftime('%Y-%m', created_time) BETWEEN ? AND ?
    `, from, to);
    return aggregateYearlyMI(rows, { site });
  } catch (e) {
    console.warn('[reportPayload] majorIncidentsYearly failed:', e.message);
    return empty;
  }
}

// ── Change Management for the selected month ──────────────────────────────
async function _changes(filters) {
  const out = {
    changes_total: 0,
    changes_type: { Standard: 0, Major: 0, Emergency: 0 },
    changes_status: {},
    changes_emergency: 0,
    emergency_changes: [],
    changes_division: {},
  };
  const { year, month } = filters;
  if (!year || !month) return out;

  try {
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    const rows = await _all(`
      SELECT display_id AS id, subject, change_type, status, emergency, udf_json
      FROM change_records
      WHERE strftime('%Y-%m', created_time) = ?
    `, ym);
    rows.forEach(r => {
      out.changes_total++;
      const t = (r.change_type || '').trim();
      if (t === 'Major' || t === 'Normal') out.changes_type.Major++;
      else if (t === 'Emergency')          out.changes_type.Emergency++;
      else                                  out.changes_type.Standard++;
      const st = r.status || 'Unknown';
      out.changes_status[st] = (out.changes_status[st] || 0) + 1;
      if (r.emergency === 1 || t === 'Emergency') {
        out.changes_emergency++;
        out.emergency_changes.push({
          id: r.id, subject: r.subject || '—', status: r.status || 'In Progress',
        });
      }
      // Division tally (slide 8, 2nd donut). The change-table UDF is a BARE
      // `Division` key inside udf_json (see zoho-sync UDF_PREFIXES — change
      // UDFs have no "UDF:" prefix). Month-only scope, same as changes_type.
      try {
        const u = r.udf_json ? JSON.parse(r.udf_json) : null;
        const d = String((u && (u['Division'] || u['UDF:Division'])) || '').trim() || 'Unassigned';
        out.changes_division[d] = (out.changes_division[d] || 0) + 1;
      } catch (e) { /* malformed udf_json — skip division for this row */ }
    });
  } catch (e) {
    console.warn('[reportPayload] changes failed:', e.message);
  }
  return out;
}

// ── Activity Tracker snapshot (slides 10 + 11 + 11b) ──────────────────────
// Output shape:
//   {
//     green, amber, red,            (totals across fleet × current month)
//     avg_score, avg_delta_pp,      (fleet average + month-over-month delta)
//     sites: [{ code, name, color, score, delta_pp, g, a, r }],
//     pillars: { "P1-Network Infrast": { green, amber, red, score, weight }, ... },
//     trends: {                     (2026-06-04 — drill-down support)
//       months: ['Dec 25','Jan 26',...,'May 26'],   ← last 6 months ending at selected period
//       fleet: [pct, ...],                          ← fleet score per month
//       pillars: { "P1-Network Infrast": [pct, ...], ... },
//       sites:   { "MGO": [pct, ...], ... },        ← per-site score per month
//     },
//     commentary: []                (placeholder for AI/manual annotations)
//   }
function _tracker(filters) {
  const out = {
    green: 0, amber: 0, red: 0, avg_score: 0, avg_delta_pp: 0,
    sites: [], pillars: {}, commentary: [],
    trends: { months: [], fleet: [], pillars: {}, sites: {} },
  };
  if (!trackerDb) return out;
  try {
    const D = trackerDb.loadTracker();
    const activeSites = (D.activeSites && D.activeSites.length) ? D.activeSites : D.sites;
    const _ragOf = (v, target) => {
      const t = target || 1;
      if (v >= t)        return 'g';
      if (v >= t / 2)    return 'a';
      return 'r';
    };
    const _scoreOf = (g, a, r) => (g + a + r) > 0 ? Math.round((g / (g + a + r)) * 100) : 0;
    const _SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    // Compute counts (g/a/r) at a specific (year, month) for a given site.
    // Returns null when targets/inputs absent. Reused by trend loop below.
    const _scoreSiteAt = (siteCode, year, month) => {
      let g = 0, a = 0, r = 0;
      let nActive = 0;
      const pillarBreakdown = {};   // for pillar trend roll-up
      (D.activities || []).forEach((act, ix) => {
        const tgt = (D.targets || {})[siteCode]?.[ix];
        if (!tgt || !tgt.active) return;
        nActive++;
        const months = (D.inputs || {})[year]?.[siteCode]?.[ix] || [];
        const v   = months[month - 1] || 0;
        const tag = _ragOf(v, tgt.target);
        if (tag === 'g') g++;
        else if (tag === 'a') a++;
        else r++;
        const pillar = act.pillar || 'Other';
        if (!pillarBreakdown[pillar]) pillarBreakdown[pillar] = { g: 0, a: 0, r: 0 };
        pillarBreakdown[pillar][tag]++;
      });
      return { g, a, r, score: _scoreOf(g, a, r), nActive, pillarBreakdown };
    };

    // Build the trailing 6-month window ending at filters.{year, month}
    const TREND_LEN = 6;
    const trendPeriods = [];   // [{ year, month, label }]
    {
      let y = filters.year, m = filters.month;
      for (let i = 0; i < TREND_LEN; i++) {
        trendPeriods.unshift({ year: y, month: m,
                               label: `${_SHORT_MONTHS[m - 1]} ${String(y).slice(-2)}` });
        m--; if (m < 1) { m = 12; y--; }
      }
    }
    out.trends.months = trendPeriods.map(p => p.label);

    // Pillar tally — running across all sites × activities for CURRENT month
    const pillarTally = {};

    // Initialise per-pillar / per-site trend arrays
    const pillarNames = new Set();
    activeSites.forEach(s => { out.trends.sites[s] = new Array(TREND_LEN).fill(null); });

    // Walk every (period × site) once — fills both the current-month
    // aggregates AND the trend arrays. Single pass instead of N nested
    // loops with the previous-month-only logic.
    activeSites.forEach((siteCode) => {
      trendPeriods.forEach((p, pIx) => {
        const r = _scoreSiteAt(siteCode, p.year, p.month);
        if (r.nActive === 0) return;
        // Per-site trend point
        out.trends.sites[siteCode][pIx] = r.score;
        // Per-pillar trend accumulator — aggregate across active sites
        Object.entries(r.pillarBreakdown).forEach(([pname, t]) => {
          pillarNames.add(pname);
          const arr = (out.trends.pillars[pname] = out.trends.pillars[pname] || []);
          // We need TOTALS to compute the pillar score across all sites
          // for this period — store {g,a,r} sums then convert to %
          while (arr.length <= pIx) arr.push({ g: 0, a: 0, r: 0 });
          arr[pIx].g += t.g; arr[pIx].a += t.a; arr[pIx].r += t.r;
        });

        // CURRENT-month aggregate (last period in trendPeriods)
        if (pIx === TREND_LEN - 1) {
          out.green += r.g; out.amber += r.a; out.red += r.r;
          Object.entries(r.pillarBreakdown).forEach(([pname, t]) => {
            if (!pillarTally[pname]) pillarTally[pname] = { g: 0, a: 0, r: 0 };
            pillarTally[pname].g += t.g;
            pillarTally[pname].a += t.a;
            pillarTally[pname].r += t.r;
          });

          const prev = trendPeriods[TREND_LEN - 2];
          const rPrev = prev ? _scoreSiteAt(siteCode, prev.year, prev.month) : null;
          out.sites.push({
            code:     siteCode,
            name:     (D.siteNames || {})[siteCode] || siteCode,
            color:    (D.siteColors || {})[siteCode] || '#1A3A5F',
            score:    r.score,
            delta_pp: r.score - (rPrev ? rPrev.score : r.score),
            g: r.g, a: r.a, r: r.r,
          });
        }
      });
    });

    // Convert pillar trend accumulators to percentages
    Object.keys(out.trends.pillars).forEach(pname => {
      out.trends.pillars[pname] = out.trends.pillars[pname].map(
        b => _scoreOf(b.g, b.a, b.r)
      );
    });

    // Fleet score per period — average of site scores at that period
    out.trends.fleet = trendPeriods.map((p, ix) => {
      const periodSiteScores = activeSites
        .map(s => out.trends.sites[s][ix])
        .filter(v => v != null);
      if (!periodSiteScores.length) return 0;
      return Math.round(periodSiteScores.reduce((s, x) => s + x, 0) / periodSiteScores.length);
    });

    if (out.sites.length) {
      out.avg_score    = out.trends.fleet[TREND_LEN - 1] || 0;
      out.avg_delta_pp = out.avg_score - (out.trends.fleet[TREND_LEN - 2] || out.avg_score);
    }

    // Materialise pillars{} with per-pillar score + weight from config
    const weights = D.pillarWeights || {};
    Object.entries(pillarTally).forEach(([name, t]) => {
      out.pillars[name] = {
        green:  t.g,
        amber:  t.a,
        red:    t.r,
        score:  _scoreOf(t.g, t.a, t.r),
        weight: weights[name] || 0,
      };
    });
  } catch (e) {
    console.warn('[reportPayload] tracker failed:', e.message);
  }
  return out;
}

// ── v14 deck — Governance block (slides 13/14) ────────────────────────────
// Meetings site-code → friendly name for the scoreboard table. In-code (like
// scoreboardAliases) — the 5 governance sites are stable; falls back to code.
const _GOV_NAMES = { SML: 'Lafigué', SMI: 'Ity', HGO: 'Houndé', MGO: 'Mana', SGO: 'Sabodala',
                     DKR: 'Dakar', ABJ: 'Abidjan', OUA: 'Ouaga', KGO: 'Kalana' };

// Roadmap Δpp per meetings-code, derived from the browser's tracker block
// (tracker codes → meetings codes). Best-effort; {} if unavailable.
function _govRoadmap(browserPayload) {
  try {
    const { trackerToMeetingsCode } = require('./deptMeetingsTracker');
    const sites = (browserPayload.tracker && browserPayload.tracker.sites) || [];
    const out = {};
    sites.forEach((s) => {
      const mc = trackerToMeetingsCode(s.code);
      if (mc && s.delta_pp != null) out[mc] = Math.round(s.delta_pp);
    });
    return out;
  } catch (_) { return {}; }
}

// Deterministic default footers (used when the operator hasn't authored them).
function _autoScoreboardFooter(sb) {
  const rows = (sb && sb.rows) || [];
  if (!rows.length) return [];
  const top = rows[0];
  return [
    'Scoring v2 rewards finding & fixing: sites that log what they find and close it score GREEN; inspections that report "all fine" every visit are treated as a warning sign.',
    top ? (top.name + ' leads at ' + top.score + '/100' + (top.groundRules === 'PASS' ? ' — all ground rules met.' : '.')) : '',
    'Group average ' + (sb.groupAvg != null ? sb.groupAvg : '—') + '/100  ·  GREEN ≥70 · AMBER 45–69 · RED <45.',
  ].filter(Boolean);
}
function _autoEffortFooter() {
  return [
    'How to read this: sites to the right close more of what they log; lower means fewer late commitments; bigger bubbles held more meetings.',
    'Each site\'s two moves are its biggest available point gains — clear the reds first.',
  ];
}

// Compose the governance block from live review data. Returns null on any
// failure so render.py degrades gracefully (skips slides 13/14).
async function _governance(browserPayload, filters) {
  try {
    const { loadReviewData } = require('./reviewData');
    const { buildScoreboardV2, buildEffortMatrixV2, ANCHOR } = require('./deckGovernanceV2');
    // As-of = the report MONTH-END (the deck is "as at 31 <Month>"), not the
    // dashboard's hardcoded mid-month ANCHOR — a mid-month as-of undercounts the
    // second half of the month and diverges from the board deck. Programme
    // window starts Apr of the report year.
    const _y = Number(filters.year) || Number(ANCHOR.slice(0, 4));
    const _m = Number(filters.month) || 7;
    const _last = new Date(Date.UTC(_y, _m, 0)).getUTCDate();   // day 0 of next month = last day of this month
    const asOf = `${_y}-${String(_m).padStart(2, '0')}-${String(_last).padStart(2, '0')}`;
    const from = `${_y}-04-01`;
    const D = await loadReviewData(asOf);
    const ed = (browserPayload.governance_editorial && typeof browserPayload.governance_editorial === 'object')
      ? browserPayload.governance_editorial : {};
    const opts = {
      asOf, from,
      incubation: ed.incubation || {},         // editorial (not in our data model)
      roadmap: ed.roadmap || _govRoadmap(browserPayload),
      siteName: (c) => _GOV_NAMES[c] || c,
    };
    const scoreboard = buildScoreboardV2(D, opts);
    const effort = buildEffortMatrixV2(D, opts);
    return {
      scoreboard, effort,
      window_label: 'Apr–' + (MONTH_SHORT[_m - 1] || 'Jul') + ' ' + _y,
      scoreboard_footer: Array.isArray(ed.scoreboard_footer) ? ed.scoreboard_footer : _autoScoreboardFooter(scoreboard),
      effort_footer: Array.isArray(ed.effort_footer) ? ed.effort_footer : _autoEffortFooter(),
    };
  } catch (e) {
    console.error('[reportPayload] governance block failed:', e && e.message);
    return null;
  }
}

// ── v14 deck — Site Impact block (slide 7) ────────────────────────────────
function _autoOperatingContext(si) {
  const c = (si && si.cards) || {};
  const out = [];
  if (c.most_stretched) out.push(c.most_stretched.name + ': ' + c.most_stretched.caption + '.');
  if (c.under_dual_pressure) out.push(c.under_dual_pressure.name + ': ' + c.under_dual_pressure.caption + '.');
  if (c.proof) out.push(c.proof.name + ': ' + c.proof.caption + ' — the standard.');
  return out;
}
function _autoSiteImpactFooter(si) {
  const c = (si && si.cards) || {};
  return [
    c.most_stretched ? (c.most_stretched.name + ' carries ' + c.most_stretched.caption + ' — a capacity gap, not a capability one.') : '',
    c.proof ? (c.proof.name + ' shows the standard: ' + c.proof.caption + '.') : '',
  ].filter(Boolean);
}
async function _siteImpact(browserPayload, monthName, year, monthIdx) {
  try {
    const mm = String(monthIdx).padStart(2, '0');
    const from = `${year}-${mm}-01`;
    const to = `${year}-${mm}-31`;   // substr(created_time,1,10) BETWEEN — 31 is a safe upper bound
    const perSite = await reportsDb.getSiteImpactCounts(from, to);
    const ed = (browserPayload.site_impact_editorial && typeof browserPayload.site_impact_editorial === 'object')
      ? browserPayload.site_impact_editorial : {};
    const si = require('./deckSiteImpact').buildSiteImpact(perSite, { prizeDeltaPP: ed.prize_delta_pp });
    if (!si.rows.length) return null;   // no data → render.py skips slide 7
    return {
      ...si,
      month_label: `${monthName} ${year}`,
      operating_context: Array.isArray(ed.operating_context) ? ed.operating_context : _autoOperatingContext(si),
      footer: Array.isArray(ed.footer) ? ed.footer : _autoSiteImpactFooter(si),
    };
  } catch (e) {
    console.error('[reportPayload] site_impact block failed:', e && e.message);
    return null;
  }
}

// ── Public — build() merges DB enrichment over the browser payload ────────
async function build(browserPayload) {
  const filters = browserPayload.filters || {};
  // Render.py wants the month NAME ('May') + year. Browser sends
  // filters.month_name + filters.year already; mirror to top-level for
  // backward-compat with the kpis-may.json shape.
  const monthName = filters.month_name || filters.period_short || 'May';
  const monthIdx  = MONTH_NAMES.indexOf(monthName) + 1
                 || MONTH_SHORT.indexOf(monthName) + 1
                 || new Date().getMonth() + 1;
  const year      = parseInt(filters.year || new Date().getFullYear(), 10);

  // Normalise filter object the DB helpers expect (site_id + year + month).
  const dbFilters = {
    site_id: filters.site_id,
    site:    filters.site,      // selected site name ('all' = no filter) → slide-9 MI scoping
    year,
    month: monthIdx,
  };

  // Build all sections in parallel — they're independent DB queries. Under
  // postgres each is an async round-trip; Promise.all keeps them concurrent.
  const [helpdesk, distribution, ageing, mi, changes, incidentsYearly] = await Promise.all([
    _helpdeskKpis(dbFilters),
    _distribution(dbFilters),
    _ageing(),
    _majorIncidents(dbFilters),
    _changes(dbFilters),
    _majorIncidentsYearly(dbFilters),
  ]);
  // Prefer the browser-built tracker block: executive-report.html scores the
  // tracker with the faithful engine (cumulative + per-KPI-type via
  // _trkSiteSummary), whereas _tracker() below scores a single month crudely
  // (all-red). Fall back to _tracker() only when the browser didn't send one.
  const tracker     = browserPayload.tracker || _tracker(dbFilters);

  // v14 deck — Governance (slides 13/14). Only computed for deck='v14'
  // (loadReviewData is a heavier query); null otherwise → render.py skips them.
  const deck = String(browserPayload.deck || 'classic').toLowerCase();
  const [governance, site_impact] = deck === 'v14'
    ? await Promise.all([_governance(browserPayload, dbFilters), _siteImpact(browserPayload, monthName, year, monthIdx)])
    : [null, null];

  // Assemble final payload. Browser fields take precedence so the
  // operator can override anything via the dashboard UI.
  const enriched = {
    // Core period labels — what render.py reads
    month: monthName,
    year:  String(year),
    prev_month_short: monthIdx > 1 ? MONTH_SHORT[monthIdx - 2] : 'Dec',

    // Helpdesk KPI block (drives slides 3, 4, 5, 6)
    ...helpdesk,
    ...distribution,
    ageing,

    // Slides 7-9
    ...mi,
    ...changes,
    // Companion year-to-date views (slides 8b + 9b). Changes-YTD is browser-
    // computed (group-scoped, like the monthly changes block); Incidents-YTD is
    // server-computed here (MI are server-owned). Both null/empty when absent →
    // render.py skips the companion slide.
    changes_yearly: (browserPayload.changes_yearly && typeof browserPayload.changes_yearly === 'object')
      ? browserPayload.changes_yearly : null,
    incidents_yearly: incidentsYearly,
    // Pain themes are derived deterministically in the browser from the negative
    // survey verbatims (voice_themes.pain) — pass them through. Fall back to
    // empty so render.py shows its clean no-data line.
    voice_themes: (browserPayload.voice_themes && Array.isArray(browserPayload.voice_themes.pain))
      ? browserPayload.voice_themes
      : { pain: [], praise: [] },
    // Backlog classified by theme (keyword rules over open-ticket subjects) —
    // drives slide 6's backlog panel.
    backlog_themes: Array.isArray(browserPayload.backlog_themes) ? browserPayload.backlog_themes : [],
    // Changes by Division (bare `Division` UDF on the change table) — slide 8's
    // second donut, {division: count}. Browser-computed over the SCOPED change
    // set when available; else the server tally from _changes() (month-only,
    // unscoped — same doctrine as changes_type). An all-'Unassigned' browser
    // tally also falls back: it means the browser rows lacked the field
    // (stale cached HTML), not that every change is genuinely unassigned.
    changes_division: (() => {
      const b = browserPayload.changes_division;
      const hasReal = b && typeof b === 'object'
        && Object.keys(b).some(k => k !== 'Unassigned' && b[k] > 0);
      return hasReal ? b : (changes.changes_division || {});
    })(),

    // Slides 10-11
    tracker,

    // v14 deck — selector for render.py + Governance block (slides 13/14).
    // Absent/'classic' → render.py builds the classic deck unchanged.
    deck,
    governance,
    site_impact,

    // Operator overrides (browser → DB → defaults)
    commentary: (browserPayload.commentary || {}),

    // Keep the browser payload accessible so render.py can fall back to
    // legacy field names where present.
    _browser: browserPayload,
  };

  // ── Browser overrides — map dashboard's computed values to render.py's
  // expected field names. The browser's `kpis.*` shape uses
  // `total_tickets`/`sla_res_pct` etc. (mirrored from the dashboard's
  // own variable names), but render.py reads `total`/`sla_compliance`.
  // We map deliberately rather than `Object.assign` to avoid sending
  // both `total` AND `total_tickets` and confusing future maintainers.
  //
  // ALWAYS prefer browser-computed values: the dashboard has applied the
  // user's filter (site/group/period) and we don't want render to second-
  // guess that selection. DB enrichment fills in only what the browser
  // doesn't (charts, MI records, tracker).
  const bk = browserPayload.kpis || {};
  const KPI_MAP = {
    total:                   'total_tickets',
    closed:                  'closed_tickets',
    closure_rate:            'closure_rate',
    sla_compliance:          'sla_res_pct',
    frt_sla:                 'frt_sla_pct',
    open_backlog:            'open_backlog',
    fcr_rate:                'fcr_rate',
    csat_pct:                'csat_pct',
    nps:                     'nps',
    prev_csat_pct:           'prev_csat_pct',
    prev_nps:                'prev_nps',
    total_apr:               'prev_total_tickets',
    avg_res_days:            'avg_mttr_days',     // browser sends if computed; payload uses for slide 3
    total_delta_pct:         'mom_total_pct',
    closed_delta_pct:        'mom_closed_pct',
    closure_rate_delta_pp:   'mom_closure_pp',
    sla_compliance_delta_pp: 'mom_sla_pp',
    frt_sla_delta_pp:        'mom_frt_pp',
    csat_delta_pp:           'mom_csat_pp',
    nps_delta:               'mom_nps',
    // MoM deltas added 2026-06-04 for slide 3 tile labels (FCR, AVG
    // RESOLUTION, CHANGES NEW, EMERGENCY rate, MAJOR INCIDENTS,
    // SUPPORT GROUPS). When the browser doesn't supply a value, the
    // slide falls back to a neutral "— MoM" label.
    fcr_delta_pp:            'mom_fcr_pp',
    avg_res_days_delta:      'mom_avg_mttr_d',
    open_backlog_delta_pct:  'mom_backlog_pct',
    changes_total_delta:     'mom_changes',
    emergency_delta_pp:      'mom_emergency_pp',
    mi_total_delta:          'mom_mi',
    support_groups_delta:    'mom_groups',
    support_groups:          'support_groups',  // count of distinct tech_groups active this period
  };
  // For KPI fields where the browser can legitimately compute 0 (e.g. an
  // empty filter excluded all data) the SERVER's count is authoritative
  // — keep it. For fields where 0 is a meaningful value (e.g. closure
  // rate or SLA at 0% would be a five-alarm fire), always trust the
  // browser. This avoids the "user has 0 changes because their CHANGES
  // GRP filter excludes everything → PPTX shows 0 even though the DB
  // has 16" regression.
  const KEEP_SERVER_WHEN_BROWSER_IS_ZERO = new Set([
    'total', 'closed', 'changes_total', 'open_backlog',
    'mi_total', 'fcr_rate', 'support_groups',
  ]);
  Object.entries(KPI_MAP).forEach(([renderKey, browserKey]) => {
    const v = bk[browserKey];
    if (v == null) return;
    // Skip overriding when browser sent 0 but server has a positive value
    if (v === 0 && KEEP_SERVER_WHEN_BROWSER_IS_ZERO.has(renderKey)
                && (enriched[renderKey] || 0) > 0) {
      return;
    }
    enriched[renderKey] = v;
  });

  // Major Incidents MoM — server-owned (the browser can't reliably re-derive the
  // MI definition). _majorIncidents already computes mi_total + mi_prev_total.
  if (mi && mi.mi_total != null && mi.mi_prev_total != null) {
    enriched.mi_total_delta = mi.mi_total - mi.mi_prev_total;
  }

  // 12-month trend — browser shape matches render.py expectation
  if (Array.isArray(browserPayload.monthly_trend) && browserPayload.monthly_trend.length) {
    enriched.monthly_trend = browserPayload.monthly_trend;
  }
  // 12-month channel share — for slide 5 Email vs Web Form trend chart
  if (Array.isArray(browserPayload.monthly_channels) && browserPayload.monthly_channels.length) {
    enriched.monthly_channels = browserPayload.monthly_channels;
  }

  // Categories — browser sends [{name, current, previous}]; render.py
  // wants {catName: count}.
  if (Array.isArray(browserPayload.categories) && browserPayload.categories.length) {
    const cats = {}, catsPrev = {};
    browserPayload.categories.forEach(c => {
      if (c && c.name) { cats[c.name] = c.current || 0; catsPrev[c.name] = c.previous || 0; }
    });
    enriched.categories = cats;
    // Prior-month counts → slide 5 grouped (current vs previous) bars.
    if (Object.values(catsPrev).some(v => v > 0)) enriched.categories_prev = catsPrev;
  }

  // Recent change titles → slide 8 yellow-box "at a glance" line.
  if (Array.isArray(browserPayload.recent_changes) && browserPayload.recent_changes.length) {
    enriched.recent_changes = browserPayload.recent_changes.filter(Boolean).slice(0, 6);
  }

  // Submission channels (Mode field) — same reshape
  if (Array.isArray(browserPayload.channels) && browserPayload.channels.length) {
    const chs = {};
    browserPayload.channels.forEach(c => { if (c && c.name) chs[c.name] = c.current || 0; });
    enriched.channel = chs;
  }

  // Ageing per group — browser sends [{group, t0_30, t31_45, t46_60, t_over_60}]
  // render.py wants {grp: {0-30, 31-60, >60, total}}
  if (Array.isArray(browserPayload.ageing) && browserPayload.ageing.length) {
    const ag = {};
    browserPayload.ageing.forEach(a => {
      if (!a || !a.group) return;
      const t0  = _safeNum(a.t0_30);
      const t31 = _safeNum(a.t31_45) + _safeNum(a.t46_60);  // collapse 31-45 + 46-60 → 31-60
      const t60 = _safeNum(a.t_over_60);
      ag[a.group] = { '0-30': t0, '31-60': t31, '>60': t60, 'total': t0 + t31 + t60 };
    });
    if (Object.keys(ag).length) enriched.ageing = ag;
  }

  // CSAT block — render.py reads csat_satisfied / csat_neutral /
  // csat_dissatisfied / csat_no_rating / csat_total_responses /
  // csat_avg_score / csat_pct / nps_proxy. Browser sends the
  // structured `csat:{...}` payload; map every field to its render.py
  // counterpart with safe fallbacks.
  if (browserPayload.csat && typeof browserPayload.csat === 'object') {
    const c = browserPayload.csat;
    // KEEP_SERVER pattern: if browser sent 0 but server already has a
    // value, let the server win. CSAT totals at 0 are almost always a
    // sign survey data didn't load on the browser side, not a real zero.
    const _take = (key, browserVal) => {
      if (browserVal == null) return;   // null = browser doesn't know
      if (browserVal === 0 && (enriched[key] || 0) > 0) return;  // keep server
      enriched[key] = browserVal;
    };
    _take('csat_satisfied',        c.satisfied);
    _take('csat_neutral',          c.neutral);
    _take('csat_dissatisfied',     c.dissatisfied);
    _take('csat_no_rating',        c.no_rating);
    _take('csat_total_responses',  c.total_responses);
    _take('csat_avg_score',        c.avg_score);
    _take('csat_pct',              c.csat_pct);
    _take('nps_proxy',             c.nps);
    // Back-compat aliases (older render.py paths may still read these)
    if (c.promoters  != null) enriched.csat_promoters  = c.promoters;
    if (c.passives   != null) enriched.csat_passives   = c.passives;
    if (c.detractors != null) enriched.csat_detractors = c.detractors;
    if (c.total_responses != null) enriched.csat_total = c.total_responses;
  }

  // Changes — browser nested {total, emergency, major, standard, ...} →
  // render.py flat `changes_total` + `changes_type` + `changes_emergency`
  if (browserPayload.changes && typeof browserPayload.changes === 'object') {
    const bc = browserPayload.changes;
    // When the browser has changes IN SCOPE (total > 0), its group-scoped counts
    // are authoritative for EVERY change sub-field — INCLUDING a legitimate 0
    // (e.g. an OPS scope with 0 emergencies). Previously changes_emergency and
    // emergency_pct kept the server's UNSCOPED value on a 0, so slide 3's
    // EMERGENCY tile (reads the scalar changes_emergency) showed 1 (an Apps
    // emergency like IVALUA) while slide 8's donut (reads the dict
    // changes_type.Emergency) showed 0 — the SAME metric contradicting itself
    // across slides. One scoped source now, so every slide agrees.
    //
    // A browser total of 0 still means "the CHANGES GRP scope excluded
    // everything" (the canonical Operations seed is empty per
    // services/groupPresets.js) → keep the DB-authoritative server counts
    // rather than zeroing the whole change section on the deck.
    if (bc.total != null && bc.total > 0) {
      enriched.changes_total     = bc.total;
      enriched.changes_emergency = _safeNum(bc.emergency);
      enriched.emergency_pct     = (bc.emergency_pct != null)
        ? bc.emergency_pct
        : (bc.total ? (_safeNum(bc.emergency) / bc.total * 100) : 0);
      enriched.changes_type = {
        Standard:  _safeNum(bc.standard),
        Major:     _safeNum(bc.major),
        Emergency: _safeNum(bc.emergency),
      };
      if (bc.completed > 0 || bc.in_progress > 0) {
        enriched.changes_status = {
          Completed:     _safeNum(bc.completed),
          'In Progress': _safeNum(bc.in_progress),
        };
      }
      // Scoped emergency-change list → the slide-8 glance. The browser's
      // group-scoped list is empty when the OPS scope has 0 emergencies; using
      // it (over the server's month-only UNSCOPED list) is what keeps an
      // Applications change (IVALUA) out of an OPS-scoped deck.
      if (Array.isArray(bc.emergency_changes)) enriched.emergency_changes = bc.emergency_changes;
    }
  }

  return enriched;
}

module.exports = { build };
