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
 * C-30 (PO decision P8) — ONE resolution-SLA definition for the Helpdesk page's three
 * figures: the "Resolution SLA %" tile (index.html pStats), the per-site/group ranking
 * (slaRanking) and the trend chart (periodSlaRates). They all call resolutionSla().
 *
 *   denominator = closed tickets (isClosed) — a CANCELLED closed ticket stays in it and
 *                 is never "missed" (the tile's rule since 2026-06-02; the trend used to
 *                 drop cancelled tickets, so its latest point disagreed with the tile);
 *   violated    = closed AND missed, the "missed" rule being the definition:
 *     'due_vs_resolved' — isResOverdue (Resolved/Completed vs Due By, flag fallback)
 *                         = what the page has always used, so it stays the page default;
 *     'flag'            — the stored Overdue Status flag only (cancelled never missed),
 *                         i.e. the server's default rule (services/slaDefinition.js).
 * The vocabulary is report_config helpdesk_sla_definition's; which value the page should
 * follow is the KPI committee's call (P8) — HD_SLA_DEFINITION keeps today's behaviour.
 */
var HD_SLA_DEFINITIONS = ['flag', 'due_vs_resolved'];
var HD_SLA_DEFINITION = 'due_vs_resolved';
function _slaDef(d) { return HD_SLA_DEFINITIONS.indexOf(d) >= 0 ? d : HD_SLA_DEFINITION; }
function resOverdueByDefinition(r, definition) {
  if (_slaDef(definition) === 'due_vs_resolved') return isResOverdue(r);
  var st = String((r && r['Request Status']) || '').toLowerCase().trim();
  if (st === 'cancelled' || st === 'canceled') return false;
  var ov = String((r && r['Overdue Status']) || '').toLowerCase().trim();
  return ov === '1' || ov === 'yes' || ov === 'true';
}
// C-31 — opts.excludeCancelled (a KPI policy block): cancelled closed tickets leave the denominator.
// HD_SLA_POLICY = {} today; with report_config kpi_policy_enforced='1' the Helpdesk page fills it from the
// committee-ADOPTED policy (GET /api/kpi-policies/effective/...) — {definition, excludeCancelled, minN}.
var HD_SLA_POLICY = {};
function _isCancelled(r) { var s = String((r && r['Request Status']) || '').toLowerCase().trim(); return s === 'cancelled' || s === 'canceled'; }
function resolutionSla(rows, opts) {
  var def = _slaDef(opts && opts.definition);
  var exc = !!(opts && opts.excludeCancelled);
  var closed = 0, violated = 0;
  (Array.isArray(rows) ? rows : []).forEach(function (r) {
    if (!isClosed(r)) return;
    if (exc && _isCancelled(r)) return;
    closed++;
    if (resOverdueByDefinition(r, def)) violated++;
  });
  return {
    definition: def, closed: closed, violated: violated,
    ok_pct: closed > 0 ? Math.round((1 - violated / closed) * 1000) / 10 : null,
    violated_pct: closed > 0 ? Math.round(violated / closed * 1000) / 10 : null,
  };
}

/**
 * periodSlaRates — SLA violation rates for one period, on the ITSM
 * denominator doctrine (CLAUDE.md "KPI denominator doctrine"):
 *   res_violated_pct = resolutionSla(rows).violated_pct — the SAME denominator and
 *                      definition as the Resolution SLA % tile (C-30)
 *   fr_violated_pct  = responded tickets flagged late on first response
 *                      ÷ responded tickets (non-empty 'Responded Time')
 * A rate with no denominator is null (nothing to judge), never 0 — so a
 * chart line breaks instead of plotting a fake 0 % (A-17a).
 */
function periodSlaRates(rows, opts) {
  const list = Array.isArray(rows) ? rows : [];
  const res = resolutionSla(list, opts);
  let responded = 0, frViol = 0;
  for (const r of list) {
    const rt = r['Responded Time'];
    if (rt != null && String(rt).trim() !== '') {
      responded++;
      const f = String(r['First Response Overdue Status'] || '').toLowerCase().trim();
      if (f === 'true' || f === '1' || f === 'yes') frViol++;
    }
  }
  const pct = (n, d) => d > 0 ? Math.round(n / d * 1000) / 10 : null;
  return {
    inbound: list.length, closed: res.closed, responded,
    res_violated: res.violated,
    res_violated_pct: res.violated_pct,
    fr_violated_pct:  pct(frViol, responded),
  };
}

/**
 * C-11 (G19) — Helpdesk analytical views: category Pareto + per-site / per-group
 * resolution-SLA ranking. Pure helpers, shared by index.html and its tests.
 *
 * helpdeskCategoryKey — the category a ticket is counted under. Same field order as
 * the Top-10 chart (Category, else Sub Category), but an empty / '-No Value-' value is
 * kept as '(No category)' instead of being dropped, so the Pareto total stays equal to
 * the Inbound tile.
 */
var HD_NO_CATEGORY = '(No category)';
var HD_NO_KEY = '(Not set)';
function helpdeskCategoryKey(r) {
  var c = String((r && (r['Category'] || r['Sub Category'])) || '').trim();
  return (!c || c === '-No Value-') ? HD_NO_CATEGORY : c;
}
function _dimKey(field) {
  return function (r) {
    var v = String((r && r[field]) || '').trim();
    return (!v || v === '-No Value-') ? HD_NO_KEY : v;
  };
}

/**
 * paretoRows — counts per key, sorted descending (ties by key), the first `top` keys
 * kept as their own bar and every remaining key folded into ONE 'Other (k)' bar that
 * carries their FULL total (never silently truncated). cum_pct = cumulative share of
 * the grand total, so the last bar reads 100. Σ n === total === rows.length.
 */
function paretoRows(rows, keyFn, opts) {
  var list = Array.isArray(rows) ? rows : [];
  var top = (opts && Number.isFinite(opts.top) && opts.top > 0) ? Math.floor(opts.top) : 10;
  var kf = typeof keyFn === 'function' ? keyFn : helpdeskCategoryKey;
  var m = new Map();
  list.forEach(function (r) { var k = kf(r); m.set(k, (m.get(k) || 0) + 1); });
  var sorted = Array.from(m.entries()).sort(function (a, b) { return b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0); });
  var total = list.length;
  var head = sorted.length > top + 1 ? sorted.slice(0, top) : sorted;   // never an 'Other' of a single key
  var tail = sorted.length > top + 1 ? sorted.slice(top) : [];
  var out = head.map(function (e) { return { key: e[0], label: e[0], n: e[1], keys: [e[0]], other: false }; });
  if (tail.length) {
    var n = tail.reduce(function (s, e) { return s + e[1]; }, 0);
    out.push({ key: '__other__', label: 'Other (' + tail.length + ')', n: n, keys: tail.map(function (e) { return e[0]; }), other: true });
  }
  var cum = 0;
  out.forEach(function (o) {
    cum += o.n;
    o.pct = total > 0 ? Math.round(o.n / total * 1000) / 10 : null;
    o.cum_pct = total > 0 ? Math.round(cum / total * 1000) / 10 : null;
  });
  return { total: total, categories: sorted.length, rows: out };
}

/**
 * Minimum closed tickets for a site/group to be RANKED on resolution SLA %. Below it the
 * row is shown as 'low sample' with its n but gets no rank (one late ticket out of two
 * would otherwise read 50 % and top the "worst" list). No helpdesk threshold existed in
 * the codebase; 10 is a PROPOSAL recorded in docs/agent-execution/C-11.md for owner review.
 */
var MIN_SLA_RANK_N = 10;

/**
 * slaRanking — resolution SLA % per key on the SAME rule as the Helpdesk
 * "Resolution SLA %" tile: resolutionSla() per key (opts.definition, C-30).
 * pct = null when nothing closed. ranked = keys with closed ≥ minN, worst (lowest %)
 * first, ties by larger n then key; low_sample = the rest (with their n, no rank).
 * Σ closed over both lists === total.closed.
 * C-30 (P7): when keyFn folds spelling variants (helpdeskSiteFoldKey), the counts of the
 * variants are SUMMED and the % recomputed (never an average of percentages); each row
 * carries `label` (the most frequent raw spelling, ties → alphabetical) and `variants`
 * (every raw spelling folded into it) — opts.labelFn gives the raw spelling.
 */
function slaRanking(rows, keyFn, opts) {
  var list = Array.isArray(rows) ? rows : [];
  var minN = (opts && Number.isFinite(opts.minN) && opts.minN >= 1) ? Math.floor(opts.minN) : MIN_SLA_RANK_N;
  var kf = typeof keyFn === 'function' ? keyFn : _dimKey('Site');
  var lf = (opts && typeof opts.labelFn === 'function') ? opts.labelFn : kf;
  var def = opts && opts.definition;
  var exc = !!(opts && opts.excludeCancelled);
  var groups = new Map();
  list.forEach(function (r) {
    var k = kf(r);
    var g = groups.get(k) || { rows: [], spell: new Map() };
    g.rows.push(r);
    var raw = lf(r); g.spell.set(raw, (g.spell.get(raw) || 0) + 1);
    groups.set(k, g);
  });
  var all = [];
  groups.forEach(function (g, k) {
    var s = resolutionSla(g.rows, { definition: def, excludeCancelled: exc });
    if (!s.closed) return;
    var spells = Array.from(g.spell.entries()).sort(function (a, b) { return b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0); });
    all.push({ key: k, label: spells[0][0], variants: spells.map(function (e) { return e[0]; }).sort(),
      closed: s.closed, violated: s.violated, pct: s.ok_pct });
  });
  var tot = resolutionSla(list, { definition: def, excludeCancelled: exc });
  var byKey = function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; };
  var ranked = all.filter(function (e) { return e.closed >= minN; })
    .sort(function (a, b) { return a.pct - b.pct || b.closed - a.closed || byKey(a, b); });
  ranked.forEach(function (e, i) { e.rank = i + 1; });
  var low = all.filter(function (e) { return e.closed < minN; })
    .sort(function (a, b) { return b.closed - a.closed || byKey(a, b); });
  low.forEach(function (e) { e.rank = null; e.low_sample = true; });
  return { min_n: minN, definition: tot.definition, total: { closed: tot.closed, violated: tot.violated, pct: tot.ok_pct }, ranked: ranked, low_sample: low };
}

/** Drill helper: the rows whose key (keyFn) is one of `keys`. */
function rowsForKeys(rows, keyFn, keys) {
  var set = new Set(keys || []);
  return (Array.isArray(rows) ? rows : []).filter(function (r) { return set.has(keyFn(r)); });
}
var helpdeskSiteKey = _dimKey('Site');
var helpdeskGroupKey = _dimKey('Group');
/**
 * C-30 (P7) — site key with spelling variants folded through the shared site-alias
 * table (public/lib/siteAliases.js, the same table as services/scoreboardAliases.js):
 * 'HOUNDE', 'Hounde Mine', 'Houndé' → 'HGO'; 'Dakar'/'Dakar Office' → 'DKR';
 * 'LONDON'/'London' → 'london'. Empty / '-No Value-' stays '(Not set)'. Without the
 * alias module loaded it still folds case/accents/spaces.
 */
function helpdeskSiteFoldKey(r) {
  var raw = helpdeskSiteKey(r);
  if (raw === HD_NO_KEY) return raw;
  var SA = (typeof SiteAliases !== 'undefined' && SiteAliases) ? SiteAliases
    : (typeof window !== 'undefined' && window.SiteAliases) ? window.SiteAliases : null;
  if (SA && typeof SA.siteFoldKey === 'function') return SA.siteFoldKey(raw);
  return raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
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
  window.periodSlaRates      = periodSlaRates; // per-period SLA rates (doctrine denominators, null when empty)
  window.helpdeskCategoryKey = helpdeskCategoryKey; // C-11 Pareto key (empty -> '(No category)')
  window.helpdeskSiteKey     = helpdeskSiteKey;
  window.helpdeskGroupKey    = helpdeskGroupKey;
  window.helpdeskSiteFoldKey = helpdeskSiteFoldKey; // C-30 site key with spelling variants folded (siteAliases.js)
  window.resolutionSla       = resolutionSla;       // C-30 one definition for tile / ranking / trend
  window.resOverdueByDefinition = resOverdueByDefinition;
  window.HD_SLA_DEFINITION   = HD_SLA_DEFINITION;   // today's page rule ('due_vs_resolved' vocabulary)
  window.HD_SLA_POLICY       = HD_SLA_POLICY;       // C-31 adopted-policy overrides ({} = today)
  window.paretoRows          = paretoRows;     // C-11 counts desc + cumulative %, explicit 'Other (k)'
  window.slaRanking          = slaRanking;     // C-11 resolution SLA % per site/group, tile rule, low-sample unranked
  window.rowsForKeys         = rowsForKeys;
  window.MIN_SLA_RANK_N      = MIN_SLA_RANK_N;
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
