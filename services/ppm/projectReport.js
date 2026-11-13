'use strict';
// W3-GOVERNANCE (PPM parity H6) — the project status report (HTML for print/PDF, Excel workbook). PURE composer: the
// caller gathers the data (summary cards, RAG, DCMA, RAID, gates) and says whether the reader may see amounts.
// Amounts appear only when money = true (admin tier + finance-viewer, services/exportPolicy); the SCHEDULED report goes
// to a distribution list (not a user) and is therefore ALWAYS composed with money = false.
// "—" = not measured, never 0. Every figure from EVM is "non certifié".

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = (v, unit) => (v == null || (typeof v === 'number' && !Number.isFinite(v)) ? '—' : String(v) + (unit || ''));
const RAGC = { green: '#1E7B45', amber: '#B45309', red: '#B91C1C' };
const ragTxt = (r) => (r ? r.toUpperCase() : '—');

/** One project's block. x = { project, summary, rag, dcma, raid, gates, money } */
function projectBlock(x) {
  const p = x.project || {}, c = (x.summary && x.summary.cards) || {};
  const burn = x.money && Array.isArray(c.budget_burn) ? c.budget_burn.map((b) => `${esc(b.currency)}: AC ${n(b.ac)} / PV ${n(b.pv)} (×${n(b.burn_vs_plan)})`).join(' · ') : (x.money ? '—' : 'amounts restricted');
  const rows = [
    ['RAG (composite)', `<b style="color:${RAGC[c.rag] || '#3A4A60'}">${esc(ragTxt(c.rag))}</b>`],
    ['Schedule complete (work-weighted)', esc(n(c.schedule_complete_pct, ' %'))],
    ['Forecast finish / baseline', `${esc(n(c.forecast_finish))} / ${esc(n(c.baseline_finish))} (slip ${esc(n(c.slip_working_days, ' working days'))})`],
    ['Budget burn (non certifié)', burn],
    ['Open risks / high / blocked tasks', `${esc(n(c.active_risks))} / ${esc(n(c.high_risks))} / ${esc(n(c.blocked_tasks))}`],
    ['Next milestone', c.next_milestone ? `${esc(c.next_milestone.name)} — ${esc(c.next_milestone.due_date)}` : '—'],
    ['Overdue milestones', esc(n(c.overdue_milestones))],
  ];
  const strip = ((x.summary && x.summary.phase_strip) || []).map((ph) => `<td style="padding:4px 8px;border:1px solid #ddd;${ph.state === 'current' ? 'background:#eef2f7;font-weight:bold' : ''}">${esc(ph.label)} · ${esc(ph.state)}${ph.pct_complete != null ? ' · ' + esc(ph.pct_complete) + ' %' : ''}</td>`).join('');
  const risks = ((x.summary && x.summary.top_risks) || []).map((r) => `<tr><td>${esc(r.kind)}</td><td>${esc(r.title)}</td><td>${esc(r.score)}</td><td>${esc(r.owner || '—')}</td></tr>`).join('');
  const dc = x.dcma ? `<p>DCMA 14-point: ${x.dcma.summary.passed} passed · ${x.dcma.summary.failed} failed · ${x.dcma.summary.not_measurable} not measurable</p>` : '';
  return `<section style="page-break-after:always"><h2>${esc(p.key || '')} — ${esc(p.name || '')}</h2>
<p>Stage: ${esc(p.stage || 'proposal')} · Owner: ${esc(p.owner || '—')} · Sponsor: ${esc(p.sponsor || '—')}</p>
<table style="border-collapse:collapse"><tr>${strip}</tr></table>
<table style="border-collapse:collapse;margin-top:8px">${rows.map((r) => `<tr><th style="text-align:left;padding:3px 8px;border:1px solid #ddd">${esc(r[0])}</th><td style="padding:3px 8px;border:1px solid #ddd">${r[1]}</td></tr>`).join('')}</table>
${risks ? `<h3>Top risks and issues</h3><table style="border-collapse:collapse"><tr><th>Kind</th><th>Title</th><th>P×I</th><th>Owner</th></tr>${risks}</table>` : ''}${dc}</section>`;
}

/** The HTML report (printable; the scheduled CLI renders it to PDF). */
function buildReportHtml({ title, asOf, blocks, money }) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:Arial,sans-serif;font-size:12px;color:#1F2A33;margin:18px}h1{font-size:18px}h2{font-size:15px;color:#3A4A60}th,td{font-size:11.5px}@page{size:A4 landscape;margin:12mm}</style></head><body>
<h1>${esc(title)}</h1><p>As of ${esc(asOf)} · “—” = not measured, never 0 · RAG thresholds PROPOSED unless configured · EVM figures non certifié${money ? '' : ' · amounts not included'}</p>
${(blocks || []).map((b) => projectBlock({ ...b, money })).join('\n')}</body></html>`;
}

/** The Excel workbook: one Summary sheet + one RAID sheet (amount columns only with money). */
function buildReportWorkbook({ blocks, money, asOf }) {
  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();
  const head = ['Project', 'Name', 'Stage', 'RAG', 'Schedule %', 'Forecast finish', 'Baseline finish', 'Slip (working days)', 'Open risks', 'High risks', 'Blocked tasks', 'Next milestone', 'Next milestone date', 'Overdue milestones', 'DCMA passed', 'DCMA failed', 'DCMA not measurable'];
  if (money) head.push('Budget burn (non certifié)');
  const rows = [head];
  for (const b of blocks || []) {
    const c = (b.summary && b.summary.cards) || {}, p = b.project || {};
    const r = [p.key || null, p.name || null, p.stage || null, c.rag || null, c.schedule_complete_pct, c.forecast_finish, c.baseline_finish, c.slip_working_days, c.active_risks, c.high_risks, c.blocked_tasks, c.next_milestone ? c.next_milestone.name : null, c.next_milestone ? c.next_milestone.due_date : null, c.overdue_milestones,
      b.dcma ? b.dcma.summary.passed : null, b.dcma ? b.dcma.summary.failed : null, b.dcma ? b.dcma.summary.not_measurable : null];
    if (money) r.push(Array.isArray(c.budget_burn) ? c.budget_burn.map((x) => `${x.currency} AC ${x.ac == null ? '—' : x.ac} / PV ${x.pv == null ? '—' : x.pv}`).join('; ') : null);
    rows.push(r);
  }
  rows.push([]); rows.push(['As of', asOf]); rows.push(['Note', 'empty cell = not measured (never 0); RAG thresholds PROPOSED unless configured']);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Summary');
  const rh = ['Project', 'Kind', 'Title', 'P', 'I', 'P×I', 'Owner', 'Status', 'Response', 'Review date', 'Review overdue', 'Dependency on'];
  if (money) rh.push('Impact amount', 'Currency', 'Exposure');
  const raid = [rh];
  for (const b of blocks || []) for (const it of b.raid || []) {
    const r = [(b.project || {}).key || null, it.kind, it.title, it.probability, it.impact, it.score, it.owner, it.status, it.response, it.review_date, it.review_overdue ? 'yes' : 'no', it.dependency_ref];
    if (money) r.push(it.impact_amount == null ? null : it.impact_amount, it.impact_currency || null, it.exposure_amount == null ? null : it.exposure_amount);
    raid.push(r);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(raid), 'RAID');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  try { Object.defineProperty(buf, 'exportRows', { value: rows.length - 4 }); } catch (_) { /* rows unknown */ }
  return buf;
}

module.exports = { buildReportHtml, buildReportWorkbook, projectBlock };
