'use strict';

// Assets sub-project B, Task 3 — PURE hygiene digest composer.
//
//   buildHygieneDigest(summary, opts) -> { subject, html, attachments }
//
// It receives ALREADY-COMPUTED data (the getHygieneSummary shape, plus a
// caller-attached `summary.sync` freshness block, plus a per-kind map of
// identity rows for the workbook) and builds strings + an xlsx Buffer. Zero
// I/O: the ONLY dependency is ./tableExcel (pure buffer builder). No db, no
// mailer, no fs — so it unit-tests with no fixtures and no side effects.
//
// Deliberate content rules (see the hygiene spec):
//  - NO money anywhere in the html. The digest is a completeness/cadence tool,
//    not a valuation. It never prints purchase_cost or a currency symbol — the
//    "no cost data" gap is reported as a COUNT only.
//  - Every interpolated free-text value (site names) is HTML-escaped — the rows
//    ultimately originate in ManageEngine/Zoho and are untrusted.
//  - Deltas vs a previous period degrade cleanly to nothing when `prev` is null
//    (no NaN, no "undefined").
//
// INPUT CONTRACT
//  summary — the getHygieneSummary output:
//    { total, by_kind:{discovered,never_scanned,ghost,no_owner,no_age,no_cost},
//      by_site:[{site,total,cost_pct,age_pct,owner_pct,scan_pct,completeness}],
//      scan_freshness:{never,over90,d30_90,d7_30,under7}, by_state:{...} }
//    PLUS summary.sync = { last_success:'YYYY-MM-DD'|null, age_days:Number|null }
//    (register freshness, attached by the caller — Task 4).
//  opts — { period:'YYYY-MM', prev, exceptionsByKind }
//    prev            — a previous `summary` (or just its `by_kind`) or null.
//    exceptionsByKind— { kind: rows[] } identity rows for the workbook. Read
//                      from opts.exceptionsByKind, falling back to
//                      summary.exceptionsByKind. (Chosen: opts is where the
//                      caller passes freshly-fetched rows — see report note.)

const tableExcel = require('./tableExcel');
const { fmtUsd } = require('./money');

// Kept in step with assets-db HYGIENE_KINDS labels (that module is a DB reader
// we deliberately do NOT require here to stay I/O-free). Only the three
// worklist kinds + the three completeness-gap kinds are labelled for display.
const KIND_LABELS = {
  discovered: 'Discovered',
  never_scanned: 'Never successfully scanned',
  ghost: 'Ghost (was healthy, stale >90d)',
  no_owner: 'No owner',
  no_age: 'No acquisition date',
  no_cost: 'No cost data',
};

// The three "act on these now" worklist kinds, in presentation order.
const WORKLIST_KINDS = ['discovered', 'never_scanned', 'ghost'];
// The three completeness-gap kinds.
const GAP_KINDS = ['no_owner', 'no_age', 'no_cost'];

// Brand-ish inline colours (no external CSS — must survive Outlook).
const FONT = "'Segoe UI', Arial, sans-serif";
const NAVY = '#1F3D5C';
const MUTED = '#6B7280';
const BORDER = '#D9DEE5';
const TEAL = '#0D9488';
const RED = '#DC2626';
const GREEN = '#16A34A';

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v) => (isNum(v) ? v : Number(v));

// 1-decimal percent display; non-finite -> em dash (never NaN).
function pctDisp(v) {
  return isNum(num(v)) ? `${(Math.round(num(v) * 10) / 10).toFixed(1)}%` : '&mdash;';
}

// Fleet completeness — ASSET-WEIGHTED over the four completeness attributes, computed
// IDENTICALLY to the dashboard header (public/assets-hygiene.html:396-399):
//   present / (4·total), where the four gaps are no_cost + no_age + no_owner + never_scanned.
// So the digest headline and the page header show the SAME number, to the decimal (page
// and email agree). total 0 (or missing) → null → renders a dash, never NaN.
// NB: this is the fleet HEADLINE only; the per-site completeness TABLE stays per-site.
function fleetCompleteness(summary) {
  const total = num(summary && summary.total);
  if (!isNum(total) || total <= 0) return null;
  const bk = (summary && summary.by_kind) || {};
  const g = (k) => { const v = num(bk[k]); return isNum(v) ? v : 0; };
  const gaps = g('no_cost') + g('no_age') + g('no_owner') + g('never_scanned');
  return Math.round(1000 * (4 * total - gaps) / (4 * total)) / 10;
}

// Signed delta indicator vs prev.by_kind[kind]. Returns '' when there's no prior
// value (no prev given, or the kind is absent) — clean omission, no NaN.
function deltaBadge(kind, cur, prev) {
  const pk = prev && (prev.by_kind || prev);
  const prior = pk ? pk[kind] : undefined;
  if (!isNum(num(prior)) || !isNum(num(cur))) return '';
  const d = num(cur) - num(prior);
  const mark = d < 0 ? '▼' : d > 0 ? '▲' : '=';
  // Down is GOOD for a worklist (fewer problems); up is bad.
  const color = d < 0 ? GREEN : d > 0 ? RED : MUTED;
  const sign = d > 0 ? '+' : ''; // negatives already carry '-'
  return ` <span style="font-family:${FONT};font-size:11px;font-weight:bold;color:${color};">${mark} ${sign}${d}</span>`;
}

// ---- html building blocks (all inline-styled tables) -----------------------

function cardOpen(title, accent) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;background:#FFFFFF;border:1px solid ${BORDER};border-radius:6px;margin:0 0 14px 0;">
<tr><td style="background:${accent};height:4px;line-height:4px;font-size:0;border-radius:6px 6px 0 0;">&nbsp;</td></tr>
<tr><td style="padding:14px 16px 16px 16px;">
<div style="font-family:${FONT};font-size:12px;font-weight:bold;color:${NAVY};letter-spacing:0.8px;text-transform:uppercase;padding-bottom:10px;">${escapeHtml(title)}</div>`;
}
function cardClose() {
  return `</td></tr></table>`;
}

function headerBlock(summary, period) {
  const total = isNum(num(summary.total)) ? num(summary.total) : 0;
  const fc = fleetCompleteness(summary);
  const sync = summary.sync || {};
  let freshness;
  // NB: `num(null)` === 0 (finite), so guard the null/blank case explicitly —
  // a missing age is "unknown", not "0 days ago".
  if (sync.age_days === null || sync.age_days === undefined || sync.age_days === '' || !isNum(Number(sync.age_days))) {
    freshness = 'Register sync status unknown.';
  } else {
    const d = num(sync.age_days);
    const dayWord = d === 1 ? 'day' : 'days';
    const when = sync.last_success ? ` (${escapeHtml(sync.last_success)})` : '';
    freshness = `Register last synced ${d} ${dayWord} ago${when}.`;
  }
  return cardOpen(`CMDB hygiene digest · ${period}`, NAVY) +
    `<div style="font-family:${FONT};font-size:22px;font-weight:bold;color:${NAVY};line-height:1.2;">${fc === null ? '&mdash;' : `${fc.toFixed(1)}%`} <span style="font-size:12px;font-weight:normal;color:${MUTED};">fleet completeness</span></div>
<div style="font-family:${FONT};font-size:13px;color:${MUTED};line-height:1.5;padding-top:4px;">${total} assets tracked.</div>
<div style="font-family:${FONT};font-size:12px;color:${MUTED};font-style:italic;line-height:1.5;padding-top:6px;">${freshness}</div>` +
    cardClose();
}

function worklistRow(kind, summary, prev) {
  const label = KIND_LABELS[kind] || kind;
  const count = isNum(num(summary.by_kind && summary.by_kind[kind])) ? num(summary.by_kind[kind]) : 0;
  return `<tr>
<td style="font-family:${FONT};font-size:13px;color:${NAVY};padding:6px 0;border-bottom:1px solid ${BORDER};">${escapeHtml(label)}</td>
<td align="right" style="font-family:${FONT};font-size:15px;font-weight:bold;color:${NAVY};padding:6px 0;border-bottom:1px solid ${BORDER};white-space:nowrap;">${count}${deltaBadge(kind, count, prev)}</td>
</tr>`;
}

function worklistBlock(summary, prev) {
  const rows = WORKLIST_KINDS.map((k) => worklistRow(k, summary, prev)).join('');
  const note = prev
    ? `<div style="font-family:${FONT};font-size:11px;color:${MUTED};font-style:italic;padding-top:8px;">&Delta; shown vs the previous period.</div>`
    : '';
  return cardOpen('Worklist — act on these now', TEAL) +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">${rows}</table>${note}` +
    cardClose();
}

function gapBlock(summary) {
  const bk = summary.by_kind || {};
  const fc = fleetCompleteness(summary);
  const items = GAP_KINDS.map((k) => {
    const c = isNum(num(bk[k])) ? num(bk[k]) : 0;
    return `<tr>
<td style="font-family:${FONT};font-size:13px;color:${NAVY};padding:5px 0;border-bottom:1px solid ${BORDER};">${escapeHtml(KIND_LABELS[k] || k)}</td>
<td align="right" style="font-family:${FONT};font-size:15px;font-weight:bold;color:${NAVY};padding:5px 0;border-bottom:1px solid ${BORDER};">${c}</td>
</tr>`;
  }).join('');
  return cardOpen('Completeness gaps', '#E87722') +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">${items}</table>
<div style="font-family:${FONT};font-size:12px;color:${MUTED};line-height:1.5;padding-top:8px;">Fleet completeness: ${fc === null ? '&mdash;' : `${fc.toFixed(1)}%`} (asset-weighted across the four attributes, fleet-wide).</div>` +
    cardClose();
}

function siteTable(summary) {
  const rows = (Array.isArray(summary.by_site) ? summary.by_site : []).map((r) => {
    return `<tr>
<td style="font-family:${FONT};font-size:12px;color:${NAVY};padding:5px 8px;border-bottom:1px solid ${BORDER};">${escapeHtml(r.site || '&mdash;')}</td>
<td align="right" style="font-family:${FONT};font-size:12px;color:${NAVY};padding:5px 8px;border-bottom:1px solid ${BORDER};">${isNum(num(r.total)) ? num(r.total) : 0}</td>
<td align="right" style="font-family:${FONT};font-size:12px;color:${NAVY};padding:5px 8px;border-bottom:1px solid ${BORDER};">${pctDisp(r.owner_pct)}</td>
<td align="right" style="font-family:${FONT};font-size:12px;color:${NAVY};padding:5px 8px;border-bottom:1px solid ${BORDER};">${pctDisp(r.scan_pct)}</td>
<td align="right" style="font-family:${FONT};font-size:12px;font-weight:bold;color:${NAVY};padding:5px 8px;border-bottom:1px solid ${BORDER};">${pctDisp(r.completeness)}</td>
</tr>`;
  }).join('');
  const head = `<tr>
<td style="font-family:${FONT};font-size:10px;font-weight:bold;color:${MUTED};text-transform:uppercase;letter-spacing:0.5px;padding:4px 8px;border-bottom:2px solid ${BORDER};">Site</td>
<td align="right" style="font-family:${FONT};font-size:10px;font-weight:bold;color:${MUTED};text-transform:uppercase;letter-spacing:0.5px;padding:4px 8px;border-bottom:2px solid ${BORDER};">Assets</td>
<td align="right" style="font-family:${FONT};font-size:10px;font-weight:bold;color:${MUTED};text-transform:uppercase;letter-spacing:0.5px;padding:4px 8px;border-bottom:2px solid ${BORDER};">Owner%</td>
<td align="right" style="font-family:${FONT};font-size:10px;font-weight:bold;color:${MUTED};text-transform:uppercase;letter-spacing:0.5px;padding:4px 8px;border-bottom:2px solid ${BORDER};">Scan%</td>
<td align="right" style="font-family:${FONT};font-size:10px;font-weight:bold;color:${MUTED};text-transform:uppercase;letter-spacing:0.5px;padding:4px 8px;border-bottom:2px solid ${BORDER};">Complete%</td>
</tr>`;
  const body = rows || `<tr><td colspan="5" style="font-family:${FONT};font-size:12px;color:${MUTED};font-style:italic;padding:6px 8px;">No sites in scope.</td></tr>`;
  return cardOpen('Per-site completeness', NAVY) +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">${head}${body}</table>` +
    cardClose();
}

function freshnessBlock(summary) {
  const f = summary.scan_freshness || {};
  const n = (v) => (isNum(num(v)) ? num(v) : 0);
  return cardOpen('Scan freshness', TEAL) +
    `<div style="font-family:${FONT};font-size:13px;color:${NAVY};line-height:1.6;">Never scanned: <b>${n(f.never)}</b> &middot; &gt;90d: <b>${n(f.over90)}</b> &middot; 30&ndash;90d: <b>${n(f.d30_90)}</b> &middot; 7&ndash;30d: <b>${n(f.d7_30)}</b> &middot; &lt;7d: <b>${n(f.under7)}</b></div>` +
    cardClose();
}

// ---- Task 7: optional Finance + Licence snapshots --------------------------
// Both blocks are appended ONLY when their opt is present — absent → skipped
// entirely (backward-compatible). Money is rendered via money.fmtUsd (thousands
// + 2dp, NO currency glyph) with a textual "USD" label — the digest still holds
// the !html.includes('$') invariant. Finance USD figures are already converted
// by getFinanceSummary(rate); we only display + label the rate.

// finance — { fleet:{book_value_usd, purchase_cost_usd, refresh_due, ...}, rate }
function financeBlock(finance) {
  const fleet = (finance && finance.fleet) || {};
  const rate = finance && finance.rate;
  const rateLabel = isNum(num(rate))
    ? `USD (approx @ ${escapeHtml(String(rate))})`
    : 'USD (approx)';
  const money = (v) => fmtUsd(isNum(num(v)) ? num(v) : null);
  const refresh = isNum(num(fleet.refresh_due)) ? num(fleet.refresh_due) : 0;
  const rowsHtml = [
    ['Fleet book value', money(fleet.book_value_usd)],
    ['Fleet purchase value', money(fleet.purchase_cost_usd)],
  ].map(([label, val]) => `<tr>
<td style="font-family:${FONT};font-size:13px;color:${NAVY};padding:6px 0;border-bottom:1px solid ${BORDER};">${escapeHtml(label)}</td>
<td align="right" style="font-family:${FONT};font-size:15px;font-weight:bold;color:${NAVY};padding:6px 0;border-bottom:1px solid ${BORDER};white-space:nowrap;">${val} <span style="font-size:11px;font-weight:normal;color:${MUTED};">USD</span></td>
</tr>`).join('');
  return cardOpen('Finance snapshot', TEAL) +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">${rowsHtml}<tr>
<td style="font-family:${FONT};font-size:13px;color:${NAVY};padding:6px 0;">Assets due for refresh</td>
<td align="right" style="font-family:${FONT};font-size:15px;font-weight:bold;color:${NAVY};padding:6px 0;white-space:nowrap;">${refresh}</td>
</tr></table>
<div style="font-family:${FONT};font-size:12px;color:${MUTED};font-style:italic;line-height:1.5;padding-top:8px;">Values in ${rateLabel}. XOF purchase cost converted at the configured rate.</div>` +
    cardClose();
}

// licences — { total, expiry:{expired, expiring_90, ok, no_expiry}, by_family:{...} }
function licenceBlock(licences) {
  const total = isNum(num(licences.total)) ? num(licences.total) : 0;
  const exp = (licences && licences.expiry) || {};
  const expired = isNum(num(exp.expired)) ? num(exp.expired) : 0;
  const expiring = isNum(num(exp.expiring_90)) ? num(exp.expiring_90) : 0;
  const byFam = (licences && licences.by_family) || {};
  const famLine = Object.keys(byFam)
    .map((f) => `${escapeHtml(f)} ${isNum(num(byFam[f])) ? num(byFam[f]) : 0}`)
    .join(' &middot; ');
  const expiredColor = expired > 0 ? RED : NAVY;
  return cardOpen('Licence snapshot', '#E87722') +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;"><tr>
<td style="font-family:${FONT};font-size:13px;color:${NAVY};padding:6px 0;border-bottom:1px solid ${BORDER};">Expired</td>
<td align="right" style="font-family:${FONT};font-size:15px;font-weight:bold;color:${expiredColor};padding:6px 0;border-bottom:1px solid ${BORDER};">${expired}</td>
</tr><tr>
<td style="font-family:${FONT};font-size:13px;color:${NAVY};padding:6px 0;border-bottom:1px solid ${BORDER};">Expiring within 90d</td>
<td align="right" style="font-family:${FONT};font-size:15px;font-weight:bold;color:${NAVY};padding:6px 0;border-bottom:1px solid ${BORDER};">${expiring}</td>
</tr><tr>
<td style="font-family:${FONT};font-size:13px;color:${NAVY};padding:6px 0;">Total licences</td>
<td align="right" style="font-family:${FONT};font-size:15px;font-weight:bold;color:${NAVY};padding:6px 0;">${total}</td>
</tr></table>
<div style="font-family:${FONT};font-size:12px;color:${MUTED};line-height:1.5;padding-top:8px;">By family: ${famLine || '&mdash;'}</div>` +
    cardClose();
}

// ---- workbook --------------------------------------------------------------

// One sheet per kind present in exceptionsByKind. tableExcel already renders
// "(no rows)" for empty arrays, so we keep every provided kind — but the sheet
// NAME uses the kind key so XLSX.read can find it.
function buildAttachment(period, exceptionsByKind) {
  const map = exceptionsByKind || {};
  const sheets = Object.keys(map).map((kind) => ({
    name: kind,                       // e.g. 'discovered' — 31-char safe, matched by the test
    rows: Array.isArray(map[kind]) ? map[kind] : [],
  }));
  const content = tableExcel.buildWorkbook(sheets);
  return { filename: `assets-hygiene-${period}.xlsx`, content };
}

function buildHygieneDigest(summary, opts) {
  const s = summary && typeof summary === 'object' ? summary : {};
  const o = opts && typeof opts === 'object' ? opts : {};
  const period = o.period || 'unknown';
  const prev = o.prev || null;
  const exceptionsByKind = o.exceptionsByKind || s.exceptionsByKind || {};
  const finance = o.finance && typeof o.finance === 'object' ? o.finance : null;
  const licences = o.licences && typeof o.licences === 'object' ? o.licences : null;

  const subject = `Assets — CMDB hygiene digest · ${period}`;

  const html =
    `<div style="background:#F4F6F8;padding:16px;font-family:${FONT};">` +
    `<div style="max-width:680px;margin:0 auto;">` +
    headerBlock(s, period) +
    worklistBlock(s, prev) +
    gapBlock(s) +
    (finance ? financeBlock(finance) : '') +
    (licences ? licenceBlock(licences) : '') +
    siteTable(s) +
    freshnessBlock(s) +
    `</div></div>`;

  const attachments = [buildAttachment(period, exceptionsByKind)];

  return { subject, html, attachments };
}

module.exports = { buildHygieneDigest, fleetCompleteness, deltaBadge, escapeHtml };
