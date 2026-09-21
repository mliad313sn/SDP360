'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Shared PPTX helpers — single source of truth for the small, pure RAG/trend
// functions that were previously duplicated **verbatim** across
// reports-weekly-pptx.js and reports-monthly-pptx.js.
//
// Only functions that are byte-for-byte (or whitespace/comment-only)
// IDENTICAL between the two files live here. Functions that have legitimately
// diverged between the two decks (addTitle, addSectionBadge, the `C` palette,
// every slideMonthly* renderer, …) are intentionally LEFT in their own files
// because the weekly and monthly decks render them differently — see
// CLAUDE.md § "slideMonthly* duplication".
//
// Pure functions, no DB / pptxgenjs / file-local state. Covered by
// tests/pptx-shared-helpers.test.js (unit) and locked end-to-end by the
// golden fingerprint in tests/pptx-monthly-golden.test.js.
// ─────────────────────────────────────────────────────────────────────────

/** RAG word ('green'|'orange'|'red') → hex. Unknown → neutral grey. */
function statusColor(color) {
  switch ((color || '').toLowerCase()) {
    case 'green':  return '2D9C4A';
    case 'orange': return 'E87722';
    case 'red':    return 'D0312D';
    default:       return 'AAAAAA';
  }
}

/** Trend word → glyph used in the infra tables. */
function trendArrow(trend) {
  switch ((trend || '').toLowerCase()) {
    case 'up':        return '▲';
    case 'down':      return '▼';
    case 'stable':    return '→';
    case 'no_change': return 'No change';
    default:          return '—';
  }
}

/** Trend word → hex (up = green, down = red, else grey). */
function trendColor(trend) {
  switch ((trend || '').toLowerCase()) {
    case 'up':   return '2D9C4A';
    case 'down': return 'D0312D';
    default:     return '666666';
  }
}

/**
 * Auto-compute trend direction by comparing current vs previous week's numeric
 * value. Matched by service name (case-insensitive, trimmed). Non-numeric
 * values keep their stored trend. Returns a new array of KPI objects.
 */
function computeTrends(currentKpis, prevKpis) {
  if (!currentKpis || !currentKpis.length) return currentKpis || [];
  if (!prevKpis    || !prevKpis.length)    return currentKpis;
  const prevMap = {};
  prevKpis.forEach(k => { prevMap[(k.service || '').trim().toLowerCase()] = k.status_value; });
  return currentKpis.map(k => {
    const key     = (k.service || '').trim().toLowerCase();
    const curRaw  = String(k.status_value || '').replace('%', '').replace(',', '.').trim();
    const prevRaw = String(prevMap[key]  || '').replace('%', '').replace(',', '.').trim();
    const curVal  = parseFloat(curRaw);
    const prevVal = parseFloat(prevRaw);
    if (!isNaN(curVal) && !isNaN(prevVal)) {
      const trend = curVal > prevVal ? 'up' : curVal < prevVal ? 'down' : 'stable';
      return { ...k, trend };
    }
    return k; // non-numeric: keep stored trend
  });
}

/**
 * Auto-derive status cell color by comparing numeric status_value to target.
 * Renders all sites consistently regardless of the manually-selected
 * status_color in the form.
 *   ≥ target        → green  (#2D9C4A)
 *   ≥ target × 0.90 → orange (#E87722)
 *   < target × 0.90 → red    (#D0312D)
 * Falls back to the stored status_color when numeric comparison isn't possible.
 * Returns { color: hex, hasColor: bool }.
 */
function autoStatusColor(statusValue, target, storedColor) {
  const val = parseFloat(String(statusValue || '').replace('%', '').trim());
  const tgt = parseFloat(String(target || '').replace('%', '').trim());
  if (!isNaN(val) && !isNaN(tgt) && tgt > 0) {
    if (val >= tgt)        return { color: '2D9C4A', hasColor: true };
    if (val >= tgt * 0.90) return { color: 'E87722', hasColor: true };
    return                        { color: 'D0312D', hasColor: true };
  }
  const sc = statusColor(storedColor);
  const hasColor = !!(storedColor && storedColor !== 'none');
  return { color: sc, hasColor };
}

// ── Department Meetings monthly-status slide ──────────────────────────────
// Self-contained (inline colours, own title/badge) so BOTH reports-weekly-pptx
// and reports-monthly-pptx can drop it into any deck without depending on
// their (forked) addTitle/addSectionBadge/C. Fed by
// meetings-db.getSiteMonthlyMeetingSummary(). Renders a KPI strip, a
// per-department RAG table, a "why progress stalled" commentary band and a
// 3-month opened/closed trend strip. Callers gate emission on
// summary.available + (departments.length || pvs_held) — see emitDeptMeetings.
function slideDepartmentMeetings(pptx, summary) {
  const NAVY = '2A5490', WHITE = 'FFFFFF', LGREY = 'F5F5F5', DGREY = '333333', ORANGE = 'E87722';
  const slide = pptx.addSlide();
  const s = summary || {};
  const k = s.kpis || {};
  const siteLabel = s.site_code ? s.site_code + ' — ' : '';

  slide.addText(`${siteLabel}Department Meetings · ${s.month_label || ''}`,
    { x: 0.3, y: 0.15, w: 12.73, h: 0.5, fontSize: 24, bold: true, color: ORANGE, fontFace: 'Calibri', align: 'center' });

  const tileW = 3.13, tileG = 0.04, tileH = 0.85, tileY = 1.0;
  const tX = i => 0.3 + i * (tileW + tileG);
  const tile = (col, label, value, sub, accent) => {
    const x = tX(col);
    slide.addShape('rect', { x, y: tileY, w: tileW, h: tileH, fill: { color: WHITE }, line: { color: 'DDDDDD', pt: 0.5 } });
    slide.addShape('rect', { x, y: tileY, w: 0.06, h: tileH, fill: { color: accent }, line: { color: accent, pt: 0 } });
    slide.addText(label, { x: x + 0.12, y: tileY + 0.06, w: tileW - 0.2, h: 0.16, fontSize: 8, bold: true, color: '444444', fontFace: 'Calibri', valign: 'middle' });
    slide.addText(String(value), { x: x + 0.12, y: tileY + 0.26, w: tileW - 0.2, h: 0.34, fontSize: 22, bold: true, color: NAVY, fontFace: 'Calibri', valign: 'middle' });
    if (sub) slide.addText(sub, { x: x + 0.12, y: tileY + 0.62, w: tileW - 0.2, h: 0.16, fontSize: 8, color: '666666', fontFace: 'Calibri', valign: 'middle' });
  };
  const pvBelow = (k.depts_with_pv || 0) < (k.dept_target || 3);
  tile(0, 'PVs HELD (MONTH)', `${k.pvs_held || 0} / ${k.dept_target || 3}`, pvBelow ? 'below 3-dept target' : 'target met', pvBelow ? ORANGE : '2D9C4A');
  tile(1, 'OPEN ISSUES', k.open_issues || 0, `${k.high_open || 0} HIGH severity`, 'DC2626');
  tile(2, 'RESOLVED (MONTH)', k.resolved_month || 0, `${k.new_month || 0} new raised`, '2D9C4A');
  tile(3, 'ESCALATIONS OPEN', k.escalations_open || 0, 'to Mine IT Council', '7C3AED');

  slide.addShape('rect', { x: 0.3, y: 2.05, w: 12.73, h: 0.3, fill: { color: NAVY } });
  slide.addText('Department status', { x: 0.3, y: 2.05, w: 12.73, h: 0.3, fontSize: 11, bold: true, color: WHITE, fontFace: 'Calibri', align: 'left', margin: [0, 0, 0, 8] });

  const MAXD = 8;
  const depts = (s.departments || []).slice(0, MAXD);
  const pill = { blocked: { bg: 'FCEBEB', fg: 'A32D2D', txt: 'BLOCKED' },
                 no_pv:   { bg: 'FAEEDA', fg: '854F0B', txt: 'NO PV — MISS' },
                 on_track:{ bg: 'EAF3DE', fg: '3B6D11', txt: 'ON TRACK' } };
  const hdr = ['Department', 'Last PV', 'Open', 'HIGH', 'Resolved', 'New', 'Status'].map((t, i) => ({
    text: t, options: { bold: true, color: WHITE, fill: { color: NAVY }, align: i === 0 ? 'left' : 'center' } }));
  const rows = depts.length ? depts.map((d, i) => {
    const f = i % 2 === 0 ? LGREY : WHITE;
    const p = pill[d.status] || pill.on_track;
    return [
      { text: d.department || '—',       options: { fill: { color: f }, bold: true, align: 'left' } },
      { text: d.last_pv || '— none',     options: { fill: { color: f }, align: 'center', color: d.last_pv ? DGREY : '999999' } },
      { text: String(d.open || 0),       options: { fill: { color: f }, align: 'center' } },
      { text: String(d.high || 0),       options: { fill: { color: f }, align: 'center', bold: (d.high || 0) > 0, color: (d.high || 0) > 0 ? 'A32D2D' : DGREY } },
      { text: String(d.resolved_m || 0), options: { fill: { color: f }, align: 'center' } },
      { text: String(d.new_m || 0),      options: { fill: { color: f }, align: 'center' } },
      { text: p.txt,                     options: { fill: { color: p.bg }, align: 'center', bold: true, color: p.fg } },
    ];
  }) : [[{ text: 'No department meetings recorded for this site yet.', options: { colspan: 7, align: 'center', color: '888888', italic: true } }]];

  const rowH = 0.42;
  const tableH = (rows.length + 1) * rowH;
  slide.addTable([hdr, ...rows], {
    x: 0.3, y: 2.42, w: 12.73, fontFace: 'Calibri', fontSize: 11,
    border: { type: 'solid', color: 'CCCCCC', pt: 0.5 },
    colW: [3.93, 1.7, 1.3, 1.2, 1.5, 1.2, 1.9], rowH,
  });
  if ((s.departments || []).length > MAXD) {
    slide.addText(`+ ${(s.departments.length - MAXD)} more departments — see the Meetings module`, {
      x: 0.3, y: 2.42 + tableH + 0.02, w: 12.73, h: 0.18, fontSize: 8, italic: true, color: '888888', fontFace: 'Calibri' });
  }

  const cmtY = Math.min(2.42 + tableH + 0.22, 6.35);
  slide.addShape('rect', { x: 0.3, y: cmtY, w: 12.73, h: 0.62, fill: { color: 'FBF3E9' }, line: { color: 'E8C9A0', pt: 0.5 } });
  slide.addShape('rect', { x: 0.3, y: cmtY, w: 0.06, h: 0.62, fill: { color: ORANGE }, line: { color: ORANGE, pt: 0 } });
  slide.addText('WHY PROGRESS STALLED', { x: 0.46, y: cmtY + 0.05, w: 12.5, h: 0.16, fontSize: 8, bold: true, color: 'A05A12', fontFace: 'Calibri' });
  slide.addText(s.commentary || '—', { x: 0.46, y: cmtY + 0.22, w: 12.5, h: 0.36, fontSize: 11, color: '5A3A12', fontFace: 'Calibri', valign: 'top' });

  const tr = s.trend || { months: [], opened: [], closed: [] };
  if (tr.months && tr.months.length) {
    const ty = cmtY + 0.72;
    const pairs = tr.months.map((m, i) => `${m}: ${tr.opened[i] || 0}↑/${tr.closed[i] || 0}↓`).join('    ');
    slide.addText([
      { text: '3-month issue flow  ', options: { bold: true, color: NAVY } },
      { text: pairs, options: { color: '555555' } },
      { text: '    (opened↑ / closed↓ — flat or rising opened = not advancing)', options: { italic: true, color: '999999' } },
    ], { x: 0.3, y: ty, w: 12.73, h: 0.22, fontSize: 9, fontFace: 'Calibri', valign: 'middle' });
  }
  return slide;
}

// Gate helper — true when a summary is worth a slide (has real data).
function hasDeptMeetingData(summary) {
  return !!(summary && summary.available &&
    ((summary.departments && summary.departments.length) || (summary.kpis && summary.kpis.pvs_held)));
}

/**
 * Decide the layout for the "Infrastructure KPIs" table. Most sites carry a
 * handful of KPIs (one column is fine). A few coordinators — Exploration most
 * of all — track infra across several sub-sites (WAN/LAN/WLAN/Servers/Backup ×
 * N sites = 30+ rows), which overflows a single column off the bottom of the
 * slide. Above `threshold` KPIs we split the list into two balanced side-by-side
 * columns; at or below it we return a single column so short lists render
 * exactly as before (byte-identical — the golden fingerprint must not move).
 *
 * Returns { twoCol, columns } where `columns` is [list] (single) or
 * [firstHalf, secondHalf] (two). Order is preserved; concatenating the columns
 * reproduces the input. A non-array or empty input is a single (empty) column.
 */
const INFRA_TWO_COL_THRESHOLD = 12;
function splitInfraKpiColumns(kpis, threshold = INFRA_TWO_COL_THRESHOLD) {
  const list = Array.isArray(kpis) ? kpis : [];
  if (list.length <= threshold) return { twoCol: false, columns: [list] };
  const half = Math.ceil(list.length / 2);
  return { twoCol: true, columns: [list.slice(0, half), list.slice(half)] };
}

// -- Parc informatique (asset engagement) - weekly decks (2026-09-21) ---------
// Same four counters, same order and same wording as tab 5 and the weekly e-mail
// (services/reportTemplates/weekly.js REVIEW_KPIS). A null/non-numeric count is
// "—" (not measured), never a fabricated 0. previous_counts, when given, adds
// the change vs the previous week's report - lower is better for all four.
const ASSET_REVIEW_KPIS = [
  ['no_tag', 'SANS QR CODE', 'DC2626'],
  ['no_date', 'SANS DATE D’ACQUISITION', 'E87722'],
  ['no_cost', 'SANS COÛT D’ACHAT', '7C3AED'],
  ['unassigned', 'NON ASSIGNÉ À UN UTILISATEUR', '2A5490'],
];
// Reject null/'' BEFORE the numeric coercion: +null === 0 passes Number.isFinite.
const _arNum = v => (v != null && v !== '' && Number.isFinite(+v)) ? +v : null;

function hasAssetReview(review) {
  return !!(review && typeof review === 'object' && review.applicable !== false && review.applicable !== 0);
}

function slideAssetReview(pptx, review, opts = {}) {
  const NAVY = '2A5490', WHITE = 'FFFFFF', PARC = '7C3AED', MUTED = '888888';
  const rv = review || {};
  const c = rv.counts && typeof rv.counts === 'object' ? rv.counts : null;
  const pc = rv.previous_counts && typeof rv.previous_counts === 'object' ? rv.previous_counts : null;
  const slide = pptx.addSlide();
  const site = opts.siteLabel ? opts.siteLabel + ' — ' : '';

  slide.addText(`${site}Parc informatique${opts.weekLabel ? ' · ' + opts.weekLabel : ''}`,
    { x: 0.3, y: 0.15, w: 12.73, h: 0.5, fontSize: 24, bold: true, color: PARC, fontFace: 'Calibri', align: 'center' });
  const scope = rv.status === 'submitted' ? 'Compteurs figés à la soumission' : 'Compteurs au dernier enregistrement';
  slide.addText(`${scope} · matériel En service / En stock / En réparation`,
    { x: 0.3, y: 0.62, w: 12.73, h: 0.24, fontSize: 10, italic: true, color: '666666', fontFace: 'Calibri', align: 'center' });

  const tileW = 3.13, tileG = 0.07, tileH = 1.25, tileY = 1.05;
  const tX = i => 0.3 + i * (tileW + tileG);
  ASSET_REVIEW_KPIS.forEach(([k, label, accent], i) => {
    const x = tX(i);
    const v = c ? _arNum(c[k]) : null;
    const pv = pc ? _arNum(pc[k]) : null;
    const bar = v == null ? 'BBBBBB' : accent;
    slide.addShape('rect', { x, y: tileY, w: tileW, h: tileH, fill: { color: WHITE }, line: { color: 'DDDDDD', pt: 0.5 } });
    slide.addShape('rect', { x, y: tileY, w: 0.07, h: tileH, fill: { color: bar }, line: { color: bar, pt: 0 } });
    slide.addText(label, { x: x + 0.15, y: tileY + 0.08, w: tileW - 0.25, h: 0.2, fontSize: 9, bold: true, color: '444444', fontFace: 'Calibri', valign: 'middle' });
    slide.addText(v == null ? '—' : String(v), { x: x + 0.15, y: tileY + 0.33, w: tileW - 0.25, h: 0.5, fontSize: 30, bold: true, color: v == null ? MUTED : NAVY, fontFace: 'Calibri', valign: 'middle' });
    let sub = '', subColor = MUTED;
    if (v != null && pv != null) {
      const d = v - pv;
      sub = d === 0 ? `= semaine précédente (${pv})` : `${d > 0 ? '+' : '−'}${Math.abs(d)} vs semaine précédente (${pv})`;
      subColor = d < 0 ? '27AE60' : d > 0 ? 'E74C3C' : MUTED;
    } else if (v != null) sub = 'pas de semaine précédente';
    if (sub) slide.addText(sub, { x: x + 0.15, y: tileY + 0.9, w: tileW - 0.25, h: 0.22, fontSize: 9, color: subColor, fontFace: 'Calibri', valign: 'middle' });
  });

  const note = (title, text, y) => {
    const t = String(text == null ? '' : text).trim();
    slide.addShape('rect', { x: 0.3, y, w: 12.73, h: 2.05, fill: { color: 'F5F3FF' }, line: { color: 'DDD6FE', pt: 0.5 } });
    slide.addShape('rect', { x: 0.3, y, w: 0.07, h: 2.05, fill: { color: PARC }, line: { color: PARC, pt: 0 } });
    slide.addText(title, { x: 0.5, y: y + 0.08, w: 12.4, h: 0.24, fontSize: 11, bold: true, color: PARC, fontFace: 'Calibri' });
    if (t) {
      slide.addText(t, { x: 0.5, y: y + 0.36, w: 12.4, h: 1.6, fontSize: 12, color: '333333', fontFace: 'Calibri', valign: 'top', fit: 'shrink' });
    } else {
      // An empty note must be SEEN in the meeting, like the e-mail's amber pill.
      slide.addText('non renseigné', { x: 0.5, y: y + 0.4, w: 1.6, h: 0.3, fontSize: 10, bold: true, color: '92400E', fill: { color: 'FEF3C7' }, fontFace: 'Calibri', align: 'center', valign: 'middle' });
    }
  };
  note('TRAITÉ CETTE SEMAINE', rv.handled_note, 2.55);
  note('PLAN / BLOCAGES', rv.plan_note, 4.8);
  return slide;
}

module.exports = { statusColor, trendArrow, trendColor, computeTrends, autoStatusColor,
  slideDepartmentMeetings, hasDeptMeetingData, splitInfraKpiColumns, INFRA_TWO_COL_THRESHOLD,
  slideAssetReview, hasAssetReview, ASSET_REVIEW_KPIS };
