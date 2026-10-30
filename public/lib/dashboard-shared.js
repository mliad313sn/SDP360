'use strict';
/**
 * Dashboard-shared helpers
 *
 * Single source of truth for the small set of constants + functions that were
 * duplicated across:
 *   - public/index.html               (helpdesk dashboard)
 *   - public/executive.html           (executive view)
 *   - public/executive-report.html    (executive monthly report)
 *
 * What lives here (truly identical across all three before this refactor):
 *   - MONTH_INDEX         Jan→0..Dec→11 lookup
 *   - parseZohoDT(str)    parse a Zoho-format datetime string ("19 Mar, 2026 14:30:00 PM") → Date
 *   - CLOSED_STATUSES     set of Request Status values that mean "ticket is done"
 *   - IT_HELPDESK_GROUPS  set of Zoho groups that count as IT helpdesk operations
 *   - isITHelpdesk(r)     row → bool
 *   - isClosed(r)         dual-source closed test (Pending Status, fallback to Request Status)
 *   - escapeHTML(v)       interpolation guard for innerHTML / attribute values
 *
 * What does NOT live here:
 *   - siteMatch / groupMatch / parseDT — these are local to executive-report.html
 *     and tied to its multi-period filter state. Not duplicated.
 *   - GROUP_PRESETS / localStorage keys — each dashboard manages its own preset
 *     list with a different key (sdp_group_presets, sdp_category_groups, grpTeams).
 *     Unifying would require user-data migration and isn't justified by the value.
 *
 * Usage:
 *   <script src="lib/dashboard-shared.js"></script>     (load BEFORE inline page scripts)
 *
 *   In page code, reference the identifiers directly — they're attached to window.
 *   Example: if (CLOSED_STATUSES.has(...)) {...}
 */

const MONTH_INDEX = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };

/**
 * Parse a Zoho-format datetime string into a Date.
 * Format: "DD MMM, YYYY HH:MM[:SS] [AM|PM]"  e.g. "19 Mar, 2026 14:30:00 PM"
 * Returns null on any parse failure (caller is responsible for handling null).
 */
function parseZohoDT(str) {
  if (!str || !str.trim()) return null;
  const p = str.trim().split(/[\s,]+/);
  if (p.length < 3) return null;
  const d = parseInt(p[0]), m = MONTH_INDEX[p[1]], y = parseInt(p[2]);
  if (isNaN(d) || m === undefined || isNaN(y)) return null;
  const tp = (p[3] || '').split(':').map(Number);
  let h = tp[0] || 0;
  const mi = tp[1] || 0, sc = tp[2] || 0;
  const suf = (p[4] || '').toUpperCase();
  if (suf === 'PM' && h < 12) h += 12;
  else if (suf === 'AM' && h === 12) h = 0;
  return new Date(y, m, d, h, mi, sc);
}

/**
 * Request Status values that mean "ticket is done", regardless of the
 * Request Pending Status field. Used as the fallback in isClosed when the
 * Pending Status field is empty (typical for older tickets).
 */
const CLOSED_STATUSES = new Set([
  'closed', 'resolved', 'confirmed resolution', 'confirm resolution', 'cancelled'
]);

/**
 * Canonical Operations group list — the IT helpdesk site-agent teams.
 * This is the SINGLE SOURCE OF TRUTH for the "Operations" preset across
 * every dashboard. server.js mirrors this (it can't import from a browser
 * file), but the values must stay identical — keep both lists in sync
 * when adding/retiring a site.
 *
 * v1.10.9: added "Tanda IT Agents" — Tanda is a new mining site.
 */
const OPS_GROUPS_DEFAULT = [
  'Abidjan IT Agents',
  'Exploration BF Support',
  'Exploration CI Support',
  'Exploration IT Support',
  'Hounde IT Agents',
  'ITY IT Agents',
  'Kalana IT Agents',
  'Lafigue IT Agents',
  'Mana IT Agent',
  'Ouaga IT Agents',
  'Sabodala IT Agents',
  'Tanda IT Agents'
];

/**
 * Canonical Applications group list — the system / application support
 * teams (separate from site-agent operations). Used by the "Applications"
 * preset across dashboards.
 */
const APPS_GROUPS_DEFAULT = [
  'Benchmark Support Team',
  'CELOXIS Support Agents',
  'EDV Academy Team',
  'EDV SharePoint Support',
  'EQS ONEIT Support Agents',
  'ERP Support',
  'Infosec Team',
  'Ivalua Support Team',
  'ManageEngine ServiceDesk Plus',
  'My Path Support Agents',
  'Oracle Support'
];

/**
 * Union of every Zoho group inside the IT Helpdesk scope (Ops + Apps).
 * Used by isITHelpdesk() to filter the raw ticket cache so non-IT groups
 * (legacy categorisation, business units, etc.) are excluded from all
 * KPI calculations.
 */
const IT_HELPDESK_GROUPS = new Set([
  ...OPS_GROUPS_DEFAULT,
  ...APPS_GROUPS_DEFAULT
]);

/** Does this row's Group put it in the IT helpdesk scope? */
function isITHelpdesk(r) {
  return IT_HELPDESK_GROUPS.has((r['Group'] || '').trim());
}

/**
 * AP-aligned closed test — DUAL-SOURCE.
 *
 * Primary: countif(Request Pending Status = 0). Raw Zoho data uses
 *   "No"=not pending (closed), "Yes"=pending (open).
 *
 * Fallback: when Request Pending Status is EMPTY (older tickets where the
 * field was never populated), consult Request Status — this correctly closes
 * legacy resolved/closed/cancelled tickets that would otherwise count as open
 * forever.
 *
 * Audit Tier 2 fix #2: previously each dashboard had a single-source version
 * with different defaults, so the same ticket counted differently across
 * pages. Now identical everywhere.
 */
function isClosed(r) {
  const ps = (r['Request Pending Status'] || '').toLowerCase().trim();
  if (ps) return ps === 'no' || ps === '0' || ps === 'false';
  return CLOSED_STATUSES.has((r['Request Status'] || '').toLowerCase().trim());
}

/**
 * Exact-match priority classifiers.
 *
 * Zoho ships ticket Priority in three different shapes depending on view + view age:
 *   - 'Critical' / 'High' / 'Medium' / 'Low' (text)
 *   - 'P1' / 'P2' / 'P3' / 'P4' (already classified)
 *   - '1' / '2' / '3' / '4'    (numeric)
 *
 * Previous code used `(r['Priority']||'').includes('1')` — that matches 'P1'
 * AND 'P10' AND 'P11' AND any subject containing '1'. Replaced with strict
 * exact-match across all three shapes so future Zoho enum changes don't
 * silently inflate P1 / P2 counts. (Endeavour SDP audit recommendation #7.)
 */
function isP1(r) {
  const s = String(r && r['Priority'] || '').toLowerCase().trim();
  return s === '1' || s === 'p1' || s === 'critical';
}
function isP2(r) {
  const s = String(r && r['Priority'] || '').toLowerCase().trim();
  return s === '2' || s === 'p2' || s === 'high';
}

/**
 * isResOverdue — SLA violation check aligned with Zoho AP formula.
 *
 * Canonical implementation lifted verbatim from index.html (the page where
 * KPI math is most thoroughly tested vs AP). Previously this function was
 * duplicated in index.html, executive.html, and executive-report.html, and
 * the executive-report copy had silently drifted — it omitted the
 * 'confirm resolution' status variant Zoho occasionally returns, causing
 * the same ticket to count as a violation on one page and not the other.
 * One source of truth here ends that drift.
 *
 *   Primary check  : Due By Time vs Resolved/Completed Time (closed tickets
 *                    with both fields present)
 *   Fallback / open: Overdue Status field — AP stores "1"=violated,
 *                    "0"=within SLA, plus "yes"/"true" string variants
 *   Never violated : cancelled tickets are explicitly excluded
 */
function isResOverdue(r) {
  const s = (r['Request Status'] || '').toLowerCase().trim();
  if (s === 'cancelled') return false;
  const due = parseZohoDT(r['Due By Time'] || r['DueBy Time']);   // Zoho's column is 'DueBy Time' (UAT ITSM-07)
  const res = parseZohoDT(r['Resolved Time'] || r['Completed Time']);
  const isRes = s === 'closed' || s === 'resolved' ||
                s === 'confirmed resolution' || s === 'confirm resolution';
  if (due && res && isRes) return res > due;
  const ov = (r['Overdue Status'] || '').toString().trim();
  return ov === '1' || ov.toLowerCase() === 'yes' || ov.toLowerCase() === 'true';
}

/**
 * xRows — extract rows array from any Analytics Plus / dashboard API
 * response shape. Replaces:
 *   - index.html         xRows()        (canonical)
 *   - executive.html     extractRows()  (same logic, different name)
 *   - executive-report.html / reports.html (any local copies)
 *
 * Tolerates every wrapper our endpoints emit:
 *   { rows: [...] }
 *   { data: { rows: [...] } }
 *   { data: { data: [...] } }
 *   { data: { data: { rows: [...] } } }
 *   { data: { data: { <key>: [...] } } }     <- last-ditch first-array shape
 *
 * Returns [] when nothing parses, never throws.
 */
function xRows(res) {
  try {
    if (res && res.rows && Array.isArray(res.rows)) return res.rows;
    if (res && res.data && res.data.rows && Array.isArray(res.data.rows)) return res.data.rows;
    const d = res && res.data && res.data.data;
    if (Array.isArray(d)) return d;
    if (d && d.rows) return d.rows;
    if (d && typeof d === 'object') {
      for (const k of Object.keys(d)) { if (Array.isArray(d[k])) return d[k]; }
    }
  } catch (e) { /* fall through to [] */ }
  return [];
}

/**
 * Escape any string before interpolating into innerHTML / attribute values.
 * Zoho ticket subjects, group names, and site labels are end-user free-text;
 * without escaping, a subject like `<img src=x onerror=alert(1)>` would
 * execute when tables/dropdowns render. Audit Tier 1 fix #5.
 */
function escapeHTML(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Build the canonical ServiceDesk Plus deep-link URL for a ticket.
 *
 * Pattern is what `index.html` has used since the audit — produces a
 * "Open ticket in SDP" URL that lands directly on the request's detail
 * page. `longId` MUST be the Zoho-internal `Request ID` (the 18+ digit
 * number like "212627000020587071"), NOT the human-readable Display ID
 * (e.g. "INC-12345"). SDP's UI routes by the long ID; the display ID
 * is just a label.
 *
 * Returns `null` when no usable longId is provided so callers can
 * fall back to plain text. NEVER throws.
 *
 * Survey verbatim note: /api/survey/voice returns each comment with a
 * `requestId` field that is exactly this long-ID format — so verbatim
 * cards can be linked directly to the closed ticket the survey was
 * sent for, which is how SDP correlates feedback to work.
 */
const SDP_TICKET_URL_BASE = 'https://oneitsupport.endeavourmining.com/app/itdesk/ui/requests/';
function sdpTicketUrl(longId) {
  if (!longId) return null;
  const id = String(longId).trim();
  if (!id || id === '0' || id === '-' || id === '—') return null;
  return SDP_TICKET_URL_BASE + id + '/details';
}

/**
 * Render an `<a>` linking to the ticket in SDP. Pass `displayId` for the
 * visible label (e.g. "#INC-12345") and `longId` for the URL target.
 * If only one of them is known, falls back to plain text without a link.
 *
 * `extraStyle` lets callers pass extra inline CSS (small font, colour
 * override, etc.) without having to wrap the result. Returns an HTML
 * string — caller is responsible for putting it where it belongs.
 */
function sdpTicketLink(displayId, longId, extraStyle) {
  const url = sdpTicketUrl(longId);
  const safeDisplay = escapeHTML(displayId == null || displayId === '' ? '—' : String(displayId));
  if (!url) return safeDisplay;
  const baseStyle = 'color:#1976BC;text-decoration:none;font-weight:600';
  const style = extraStyle ? baseStyle + ';' + extraStyle : baseStyle;
  return '<a href="' + url + '" target="_blank" rel="noopener"' +
         ' style="' + style + '"' +
         ' title="Open ticket ' + safeDisplay + ' in ServiceDesk Plus">' +
         safeDisplay + ' ↗</a>';
}

/**
 * Format an hour count for human reading.
 *
 * Zoho's "UDF:Total Downtime:" field stores hours as a raw number (often
 * a decimal like "4.5" or "72.25"). When the value is small, hours is
 * easier to read; when it grows past 2 days, hours becomes meaningless
 * ("72h" — is that a lot? "3d 0h" is instantly clear).
 *
 * Rules:
 *   null / undefined / NaN              → '—'
 *   0                                   → '0h'
 *   0 <  h <  1     (sub-hour)          → 'Nm'         (e.g. '30m')
 *   1 <= h <  24    (hours, no days)    → 'N.Nh' or 'Nh' (e.g. '4.5h', '12h')
 *   24 <= h         (days + remainder)  → 'Nd Mh' or 'Nd' (e.g. '1d 22h', '5d')
 *
 * Threshold dropped from 48h to 24h (2026-06-04) per user feedback —
 * once you're over a day, days+hours is more readable than raw hours.
 * "46h" becomes "1d 22h", "82h" becomes "3d 10h", "427h" becomes
 * "17d 19h" — the day count is the at-a-glance signal an executive
 * wants ("multi-day outage" vs "intra-day").
 *
 * @param  {number|string} hours
 * @returns {string}
 */
function fmtDowntime(hours) {
  if (hours == null) return '—';
  const h = parseFloat(hours);
  if (isNaN(h)) return '—';
  if (h === 0) return '0h';
  if (h < 0) return '—';                     // defensive — never expected
  if (h < 1) return Math.round(h * 60) + 'm';
  if (h < 24) {
    // 1-decimal precision, but drop the .0 when whole
    const rounded = Math.round(h * 10) / 10;
    return (Math.round(h) === rounded ? Math.round(h) : rounded) + 'h';
  }
  const days = Math.floor(h / 24);
  const remH = Math.round(h - days * 24);
  return remH > 0 ? `${days}d ${remH}h` : `${days}d`;
}

/**
 * ── Major Incident priority + UDF resolution (2026-06-04) ────────────
 *
 * `request_records` does NOT store major-incident priority as a top-level
 * column. The value lives inside `udf_json` under varying keys:
 *   Priority / priority / Severity / severity / UDF:Priority / UDF:Severity
 * AND the server (`reports-db.js getMajorIncidentsHistory()`) now ships
 * a canonical `P-Label` ('P1'/'P2'/'P3'/'P4') on every incident row.
 *
 * Browser code should prefer P-Label, then fall back to the variant scan
 * + impact-based default — same logic as `services/reportPayload.js`
 * `_majorIncidents()` and `getMajorIncidentsHistory()`. Single source of
 * truth across all dashboards (executive-report.html, executive.html,
 * analytics.html) so the P1/P2 counters never drift.
 *
 * Canonical mapping (CLAUDE.md §"Incident SLA Configuration"):
 *   Critical | P1   ·   High | P2   ·   Medium | P3   ·   Low | P4
 */
const _INC_PRIORITY_VARIANTS = [
  'P-Label',
  'Priority', 'priority', 'PRIORITY',
  'Severity', 'severity',
  'UDF:Priority', 'UDF:Priority:', 'UDF:Severity', 'UDF:Severity:',
  'Request Priority', 'P',
];
const _INC_UDF_VARIANTS = {
  rca: [
    'UDF:Root Cause Analysis :', 'UDF:Root Cause Analysis:',
    'UDF:Root Cause Analysis', 'UDF:RCA', 'UDF:RCA:',
    'Root Cause Analysis', 'RCA', 'rca', 'root_cause_analysis',
  ],
  ca: [
    'UDF:Corrective action:', 'UDF:Corrective Action:',
    'UDF:Corrective action', 'UDF:Corrective Action',
    'Corrective Action', 'Corrective action', 'CA', 'corrective_action',
  ],
  pir: [
    'UDF:PIR Required:', 'UDF:PIR Required', 'UDF:PIR',
    'UDF:Post-Incident Review:', 'PIR Required', 'PIR', 'pir', 'pir_required',
  ],
  ll: [
    'UDF:Lessons Learned:', 'UDF:Lessons Learned',
    'UDF:Lessons-Learned:', 'Lessons Learned', 'LL', 'll', 'lessons_learned',
  ],
  downtime: [
    'UDF:Total Downtime:', 'UDF:Total Downtime',
    'UDF:Downtime:', 'Total Downtime', 'downtime', 'downtime_h',
  ],
  workaround: [
    'UDF:Workaround Details (if applicable):',
    'UDF:Workaround Details:', 'UDF:Workaround:', 'Workaround',
  ],
  preventive: [
    'UDF:Preventive Measures:', 'UDF:Preventive Measures',
    'UDF:Preventive:', 'Preventive Measures', 'Preventive',
  ],
};
function _pickIncField(r, variants) {
  if (!r || !variants) return '';
  for (let i = 0; i < variants.length; i++) {
    const k = variants[i];
    if (r[k] != null) {
      const v = String(r[k]).trim();
      if (v.length) return v;
    }
  }
  return '';
}
/** 'p1'/'p2'/'p3'/'p4'/'' — resolves Priority across every variant + impact + subject. */
function incidentPriority(r) {
  // Trust server-side canonical label first (reports-db sets this on every row)
  const canonical = String(r && r['P-Label'] || '').toLowerCase().trim();
  if (canonical === 'p1' || canonical === 'p2' ||
      canonical === 'p3' || canonical === 'p4') return canonical;
  const raw = _pickIncField(r, _INC_PRIORITY_VARIANTS).toLowerCase();
  if (raw === '1' || raw === 'p1' || raw.includes('critical') || raw.includes('enterprise')) return 'p1';
  if (raw === '2' || raw === 'p2' || raw.includes('high'))     return 'p2';
  if (raw === '3' || raw === 'p3' || raw.includes('medium') || raw.includes('normal')) return 'p3';
  if (raw === '4' || raw === 'p4' || raw.includes('low'))      return 'p4';
  const subj = String(r && r['Subject'] || '').toLowerCase();
  if (subj.match(/\bp1\b|critical/)) return 'p1';
  if (subj.match(/\bp2\b|high incident/)) return 'p2';
  // Final fallback: impact='Enterprise' → P1, else P2 (matches server fallback)
  const imp = String(r && r['Impact'] || r && r.impact || '').toLowerCase();
  return imp.includes('enterprise') ? 'p1' : 'p2';
}
/** boolean — incident is P1 (Critical). */
function isIncidentP1(r) { return incidentPriority(r) === 'p1'; }
/** boolean — incident is P2 (High). */
function isIncidentP2(r) { return incidentPriority(r) === 'p2'; }
/** boolean — incident is P3 (Medium / Normal). */
function isIncidentP3(r) { return incidentPriority(r) === 'p3'; }
/** boolean — incident is P4 (Low). */
function isIncidentP4(r) { return incidentPriority(r) === 'p4'; }
/** Read an incident UDF tolerant of Zoho key-naming drift. kind ∈ rca/ca/pir/ll/downtime/workaround/preventive. */
function incidentUdf(r, kind) {
  return _pickIncField(r, _INC_UDF_VARIANTS[kind] || []);
}

// Attach to window so inline page scripts can use these as globals.
// (No bundler in this project — this is the simplest cross-file sharing pattern.)
if (typeof window !== 'undefined') {
  window.MONTH_INDEX         = MONTH_INDEX;
  window.parseZohoDT         = parseZohoDT;
  window.CLOSED_STATUSES     = CLOSED_STATUSES;
  window.IT_HELPDESK_GROUPS  = IT_HELPDESK_GROUPS;
  window.OPS_GROUPS_DEFAULT  = OPS_GROUPS_DEFAULT;   // canonical Ops preset
  window.APPS_GROUPS_DEFAULT = APPS_GROUPS_DEFAULT;  // canonical Apps preset
  window.isITHelpdesk        = isITHelpdesk;
  window.isClosed            = isClosed;
  window.isResOverdue        = isResOverdue;   // shared SLA violation check
  window.isP1                = isP1;
  window.isP2                = isP2;
  window.xRows               = xRows;          // shared API response unwrapper
  window.escapeHTML          = escapeHTML;
  window.fmtDowntime         = fmtDowntime;    // hours → "N.Nh" or "Nd Mh"
  window.SDP_TICKET_URL_BASE = SDP_TICKET_URL_BASE;
  window.sdpTicketUrl        = sdpTicketUrl;   // longId → URL string (null if no id)
  window.sdpTicketLink       = sdpTicketLink;  // (displayId, longId, extraStyle?) → <a>...</a> HTML
  // Major Incident defensive helpers (new 2026-06-04)
  window.incidentPriority    = incidentPriority;    // → 'p1'/'p2'/'p3'/'p4'/''
  window.isIncidentP1        = isIncidentP1;
  window.isIncidentP2        = isIncidentP2;
  window.isIncidentP3        = isIncidentP3;
  window.isIncidentP4        = isIncidentP4;
  window.incidentUdf         = incidentUdf;         // (r, 'rca'|'ca'|'pir'|'ll'|'downtime'|...)
  // Back-compat aliases — existing pages that still reference these by their
  // old names continue to work without per-page edits. New code should use
  // the canonical names above.
  window.extractRows         = xRows;
}
// NOTE: server-side modules (reports-db.js) keep their own copy of
// fmtDowntime — this file is loaded as a browser <script>, not via require,
// so module.exports isn't a safe contract. Keep the two copies in sync by
// matching the rule table in the JSDoc above.
