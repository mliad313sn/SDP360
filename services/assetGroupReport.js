'use strict';

// Assets reports integration, Task 2 — PURE "Assets — Groupe" digest composer.
//
//   buildAssetGroupDigest({ leaderboard, forecast, coverage, period, fmtUsd })
//     -> { subject, html }
//
// It receives ALREADY-COMPUTED reader output and builds strings only. Zero I/O:
// no db, no mailer, no fs, no network. `fmtUsd` is INJECTED (the caller passes
// require('./money').fmtUsd) so the module has no runtime dependency at all —
// it unit-tests with plain objects. Modelled on services/assetHygieneReport.js
// (same inline-styled, table-based, Outlook-safe, FR-labelled house style).
//
// Deliberate content rules:
//  - NO `$` glyph anywhere in html. Money is fmtUsd (thousands + 2dp, no glyph)
//    followed by a textual "USD" label. Invariant asserted by the tests.
//  - Coverage-% banners are VERBATIM and PROMINENT (a coloured callout at the top
//    of the investment section) — the hardware forecast often rests on a
//    single-digit % of the fleet, so the digest must never read as exhaustive.
//  - `beyond_horizon` is rendered as a COUNT only, never summed into a total
//    (the reader already excludes it from total_forecast_usd — we honour that).
//  - Every interpolated free-text value (site names) is HTML-escaped — the rows
//    originate in ManageEngine/Zoho and are untrusted.
//
// INPUT CONTRACT (what the readers actually return — verified against the code):
//  leaderboard — getEffortLeaderboard():
//    { rows:[{site, effort_score, baseline_score, delta, rank}],
//      most_improved:{...row}|null, needs_attention:{...row}|null }
//    (`most_improved`/`needs_attention` are FULL row objects, not {site,delta} —
//     the brief was slightly off; we read .site + .delta off them.)
//  forecast — getInvestmentForecast(): { hardware, software }, each half:
//    { years:[{year, replacement_usd|renewal_usd, count}],
//      due_now:{replacement_usd|renewal_usd, count},
//      beyond_horizon:{count, usd},  total_forecast_usd,
//      coverage:{eligible, total, pct, excluded:{...}} }
//    → COVERAGE LIVES INSIDE EACH HALF (not a separate object), and there is NO
//      per-equipment-type grain — only fleet totals + a per-year breakdown.
//  coverage — OPTIONAL override. If omitted (the normal case), coverage is read
//    from forecast.hardware.coverage / forecast.software.coverage. Kept in the
//    signature for callers that want to pass a pre-extracted block.
//  period — 'YYYY-MM'.
//  fmtUsd — injected number→USD formatter (no glyph).

const FONT = "'Segoe UI', Arial, sans-serif";
const NAVY = '#1F3D5C';
const MUTED = '#6B7280';
const BORDER = '#D9DEE5';
const TEAL = '#0D9488';
const RED = '#DC2626';
const GREEN = '#16A34A';
const AMBER = '#E87722';

const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

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
const int = (v) => (isNum(num(v)) ? num(v) : 0);

// 'YYYY-MM' → 'juillet 2026 (2026-07)'; falls back to the raw period on garbage.
function monthLabel(period) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(period || ''));
  if (!m) return escapeHtml(String(period || 'inconnu'));
  const y = m[1];
  const mi = Number(m[2]) - 1;
  const name = MONTHS_FR[mi] || m[2];
  return `${name} ${y} (${escapeHtml(period)})`;
}

// Signed integer delta, '' when null/absent (clean omission, never NaN).
function signedDelta(d) {
  if (!isNum(num(d))) return '';
  const v = num(d);
  const sign = v > 0 ? '+' : ''; // negatives already carry '-'
  const color = v > 0 ? GREEN : v < 0 ? RED : MUTED;
  const mark = v > 0 ? '▲' : v < 0 ? '▼' : '=';
  return `<span style="font-family:${FONT};font-size:12px;font-weight:bold;color:${color};">${mark} ${sign}${v}</span>`;
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

function headerBlock(period) {
  return cardOpen(`Assets — Groupe · ${monthLabel(period)}`, NAVY) +
    `<div style="font-family:${FONT};font-size:13px;color:${MUTED};line-height:1.5;">Synthèse mensuelle pour le management : effort de gestion des actifs par site et prévision d'investissement.</div>` +
    cardClose();
}

// ── Leaderboard effort ──────────────────────────────────────────────────────
function leaderboardBlock(leaderboard) {
  const rows = (Array.isArray(leaderboard.rows) ? leaderboard.rows : [])
    .slice()
    .sort((a, b) => int(a.rank) - int(b.rank));
  const head = `<tr>
<td style="font-family:${FONT};font-size:10px;font-weight:bold;color:${MUTED};text-transform:uppercase;letter-spacing:0.5px;padding:4px 8px;border-bottom:2px solid ${BORDER};">Site</td>
<td align="right" style="font-family:${FONT};font-size:10px;font-weight:bold;color:${MUTED};text-transform:uppercase;letter-spacing:0.5px;padding:4px 8px;border-bottom:2px solid ${BORDER};">Score/100</td>
<td align="right" style="font-family:${FONT};font-size:10px;font-weight:bold;color:${MUTED};text-transform:uppercase;letter-spacing:0.5px;padding:4px 8px;border-bottom:2px solid ${BORDER};">Rang</td>
<td align="right" style="font-family:${FONT};font-size:10px;font-weight:bold;color:${MUTED};text-transform:uppercase;letter-spacing:0.5px;padding:4px 8px;border-bottom:2px solid ${BORDER};">&Delta;</td>
</tr>`;
  const body = rows.map((r) => `<tr>
<td style="font-family:${FONT};font-size:13px;color:${NAVY};padding:5px 8px;border-bottom:1px solid ${BORDER};">${escapeHtml(r.site || '—')}</td>
<td align="right" style="font-family:${FONT};font-size:13px;font-weight:bold;color:${NAVY};padding:5px 8px;border-bottom:1px solid ${BORDER};">${int(r.effort_score)}</td>
<td align="right" style="font-family:${FONT};font-size:13px;color:${NAVY};padding:5px 8px;border-bottom:1px solid ${BORDER};">${int(r.rank)}</td>
<td align="right" style="font-family:${FONT};font-size:13px;color:${NAVY};padding:5px 8px;border-bottom:1px solid ${BORDER};white-space:nowrap;">${signedDelta(r.delta) || '<span style="color:' + MUTED + ';font-size:12px;">—</span>'}</td>
</tr>`).join('') ||
    `<tr><td colspan="4" style="font-family:${FONT};font-size:12px;color:${MUTED};font-style:italic;padding:6px 8px;">Aucun site en collecte de données.</td></tr>`;

  const mi = leaderboard.most_improved;
  const na = leaderboard.needs_attention;
  const miLine = (mi && mi.site != null)
    ? `<div style="font-family:${FONT};font-size:13px;color:${GREEN};line-height:1.6;padding-top:10px;"><b>Plus forte progression :</b> ${escapeHtml(mi.site)} ${signedDelta(mi.delta)}</div>`
    : '';
  const naLine = (na && na.site != null)
    ? `<div style="font-family:${FONT};font-size:13px;color:${RED};line-height:1.6;"><b>À surveiller :</b> ${escapeHtml(na.site)} ${signedDelta(na.delta)}</div>`
    : '';

  return cardOpen('Effort de gestion des actifs — classement', TEAL) +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">${head}${body}</table>${miLine}${naLine}` +
    cardClose();
}

// ── Coverage banners — VERBATIM + PROMINENT ─────────────────────────────────
// One coloured callout card carrying both the hardware and the software basis,
// each stating "N/M actifs (X%)" and the exclusion breakdown. Colour keys off the
// hardware coverage: <50% → RED accent (the usual state — do not over-read the
// forecast), otherwise AMBER.
function excludedLine(excluded) {
  const e = excluded || {};
  const parts = [];
  if (isNum(num(e.no_date))) parts.push(`sans date : ${num(e.no_date)}`);
  if (isNum(num(e.no_cost))) parts.push(`sans coût : ${num(e.no_cost)}`);
  if (isNum(num(e.no_life))) parts.push(`sans politique de cycle de vie : ${num(e.no_life)}`);
  if (isNum(num(e.no_expiry))) parts.push(`sans date d'expiration : ${num(e.no_expiry)}`);
  return parts.length
    ? `<div style="font-family:${FONT};font-size:11px;color:${MUTED};line-height:1.5;padding-top:2px;">Exclus — ${parts.map(escapeHtml).join(' · ')}.</div>`
    : '';
}

function coverageBanners(hwCov, swCov) {
  const hwPct = int(hwCov.pct);
  const accent = hwPct < 50 ? RED : AMBER;
  const hwLine = `Prévision matériel basée sur ${int(hwCov.eligible)}/${int(hwCov.total)} actifs (${hwPct}%) — date d'acquisition + coût + politique de cycle de vie.`;
  const swLine = `Renouvellement logiciel basé sur ${int(swCov.eligible)}/${int(swCov.total)} licences (${int(swCov.pct)}%) — date d'expiration + coût.`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;background:#FFF7ED;border:1px solid ${accent};border-left:5px solid ${accent};border-radius:6px;margin:0 0 14px 0;">
<tr><td style="padding:12px 16px;">
<div style="font-family:${FONT};font-size:11px;font-weight:bold;color:${accent};letter-spacing:0.6px;text-transform:uppercase;padding-bottom:8px;">Couverture des données — lire avant les montants</div>
<div style="font-family:${FONT};font-size:13px;font-weight:bold;color:${NAVY};line-height:1.5;">${escapeHtml(hwLine)}</div>${excludedLine(hwCov.excluded)}
<div style="font-family:${FONT};font-size:13px;font-weight:bold;color:${NAVY};line-height:1.5;padding-top:8px;">${escapeHtml(swLine)}</div>${excludedLine(swCov.excluded)}
<div style="font-family:${FONT};font-size:11px;color:${MUTED};font-style:italic;line-height:1.5;padding-top:8px;">La prévision n'est pas exhaustive : elle s'affine à mesure que les gestionnaires d'actifs renseignent date d'acquisition et coût.</div>
</td></tr></table>`;
}

// ── Forecast half (hardware or software) ────────────────────────────────────
// `amountKey` is the per-year money field ('replacement_usd' | 'renewal_usd');
// `dueKey` the due-now money field (same names). All money via injected fmtUsd,
// labelled "USD" (no glyph). beyond_horizon is a COUNT line only.
function usd(fmt, v) {
  return `${fmt(isNum(num(v)) ? num(v) : null)} <span style="font-size:11px;font-weight:normal;color:${MUTED};">USD</span>`;
}

function forecastHalf(title, half, amountKey, dueKey, fmt) {
  const years = Array.isArray(half.years) ? half.years : [];
  const due = half.due_now || {};
  const beyond = half.beyond_horizon || {};
  const yearRows = years.map((y) => `<tr>
<td style="font-family:${FONT};font-size:13px;color:${NAVY};padding:5px 8px;border-bottom:1px solid ${BORDER};">${int(y.year)}</td>
<td align="right" style="font-family:${FONT};font-size:12px;color:${MUTED};padding:5px 8px;border-bottom:1px solid ${BORDER};">${int(y.count)}</td>
<td align="right" style="font-family:${FONT};font-size:13px;font-weight:bold;color:${NAVY};padding:5px 8px;border-bottom:1px solid ${BORDER};white-space:nowrap;">${usd(fmt, y[amountKey])}</td>
</tr>`).join('');
  const dueRow = `<tr>
<td style="font-family:${FONT};font-size:13px;color:${NAVY};padding:5px 8px;border-bottom:1px solid ${BORDER};">À échéance maintenant</td>
<td align="right" style="font-family:${FONT};font-size:12px;color:${MUTED};padding:5px 8px;border-bottom:1px solid ${BORDER};">${int(due.count)}</td>
<td align="right" style="font-family:${FONT};font-size:13px;font-weight:bold;color:${NAVY};padding:5px 8px;border-bottom:1px solid ${BORDER};white-space:nowrap;">${usd(fmt, due[dueKey])}</td>
</tr>`;
  const head = `<tr>
<td style="font-family:${FONT};font-size:10px;font-weight:bold;color:${MUTED};text-transform:uppercase;letter-spacing:0.5px;padding:4px 8px;border-bottom:2px solid ${BORDER};">Année</td>
<td align="right" style="font-family:${FONT};font-size:10px;font-weight:bold;color:${MUTED};text-transform:uppercase;letter-spacing:0.5px;padding:4px 8px;border-bottom:2px solid ${BORDER};">Nb</td>
<td align="right" style="font-family:${FONT};font-size:10px;font-weight:bold;color:${MUTED};text-transform:uppercase;letter-spacing:0.5px;padding:4px 8px;border-bottom:2px solid ${BORDER};">Montant</td>
</tr>`;
  // beyond_horizon: COUNT only — never a money figure, never summed into the total.
  const beyondLine = `<div style="font-family:${FONT};font-size:12px;color:${MUTED};line-height:1.5;padding-top:8px;">Au-delà de l'horizon : <b>${int(beyond.count)}</b> (compté, non chiffré).</div>`;
  const totalLine = `<div style="font-family:${FONT};font-size:13px;color:${NAVY};line-height:1.5;padding-top:6px;">Total sur l'horizon : <b>${usd(fmt, half.total_forecast_usd)}</b>.</div>`;
  return `<div style="font-family:${FONT};font-size:12px;font-weight:bold;color:${NAVY};padding:4px 0 6px 0;">${escapeHtml(title)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">${head}${dueRow}${yearRows}</table>${totalLine}${beyondLine}`;
}

function forecastBlock(hw, sw, fmt) {
  // Reader supplies only fleet totals + a per-year breakdown — NO per-equipment-type
  // grain — so this section aggregates at the total level (noted for the reader).
  return cardOpen("Prévision d'investissement", NAVY) +
    forecastHalf('Matériel — remplacement (CAPEX)', hw, 'replacement_usd', 'replacement_usd', fmt) +
    `<div style="height:12px;line-height:12px;font-size:0;">&nbsp;</div>` +
    forecastHalf('Logiciel — renouvellement', sw, 'renewal_usd', 'renewal_usd', fmt) +
    `<div style="font-family:${FONT};font-size:11px;color:${MUTED};font-style:italic;line-height:1.5;padding-top:8px;">Montants agrégés au niveau flotte (le lecteur ne fournit pas de ventilation par type d'équipement).</div>` +
    cardClose();
}

// ---- entrypoint ------------------------------------------------------------

function buildAssetGroupDigest({ leaderboard, forecast, coverage, period, fmtUsd } = {}) {
  const lb = leaderboard && typeof leaderboard === 'object' ? leaderboard : { rows: [], most_improved: null, needs_attention: null };
  const fc = forecast && typeof forecast === 'object' ? forecast : {};
  const hw = fc.hardware && typeof fc.hardware === 'object' ? fc.hardware : {};
  const sw = fc.software && typeof fc.software === 'object' ? fc.software : {};
  const per = period || 'unknown';
  const fmt = typeof fmtUsd === 'function' ? fmtUsd : (n) => (isNum(num(n)) ? String(num(n)) : '—');

  // Coverage lives inside the forecast halves; an explicit `coverage` arg (rare)
  // overrides. Each side falls back independently.
  const cov = coverage && typeof coverage === 'object' ? coverage : {};
  const hwCov = (cov.hardware && typeof cov.hardware === 'object' ? cov.hardware : hw.coverage) || {};
  const swCov = (cov.software && typeof cov.software === 'object' ? cov.software : sw.coverage) || {};

  const subject = `Assets — Groupe · ${per}`;

  const html =
    `<div style="background:#F4F6F8;padding:16px;font-family:${FONT};">` +
    `<div style="max-width:680px;margin:0 auto;">` +
    headerBlock(per) +
    leaderboardBlock(lb) +
    coverageBanners(hwCov, swCov) +
    forecastBlock(hw, sw, fmt) +
    `</div></div>`;

  return { subject, html };
}

module.exports = { buildAssetGroupDigest, escapeHtml };
