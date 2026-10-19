'use strict';
// Step 9 — renders a generated report run into its outputs: HTML (pure), CSV of the canonical
// figures (pure), PPTX (pptxgenjs, same canvas rules as the other decks, through fixComboChartAxes).
// The PDF is reportRender.renderPdf(html). Every figure printed here comes from run.figures.

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, u) => (v == null ? '—' : u === '%' ? `${Math.round(Number(v) * 10) / 10} %` : String(Math.round(Number(v) * 100) / 100));
const RAG = { GREEN: '#27AE60', AMBER: '#E8A100', RED: '#DC2626', NA: '#6b7785' };
const T = {
  en: { draft: 'DRAFT — awaiting human review', reviewed: 'Reviewed', published: 'Published', rejected: 'Rejected', figures: 'Key figures', analysis: 'Analysis', commentary: 'Commentary', actions: 'Open actions', trend: 'Trend', persite: 'Per site', asof: 'Data as of', source: 'Source', deterministic: 'deterministic analysis', ai: 'AI commentary (verified against the canonical figures)', notmeasured: 'not measured', generated: 'Generated', window: 'Window', metric: 'Metric', value: 'Value', unit: 'Unit', rag: 'RAG', site: 'Site' },
  fr: { draft: 'BROUILLON — en attente de relecture', reviewed: 'Relu', published: 'Publié', rejected: 'Rejeté', figures: 'Chiffres clés', analysis: 'Analyse', commentary: 'Commentaire', actions: 'Actions ouvertes', trend: 'Tendance', persite: 'Par site', asof: 'Données au', source: 'Source', deterministic: 'analyse déterministe', ai: 'commentaire IA (vérifié sur les chiffres canoniques)', notmeasured: 'non mesuré', generated: 'Généré le', window: 'Fenêtre', metric: 'Indicateur', value: 'Valeur', unit: 'Unité', rag: 'RAG', site: 'Site' },
};

/** @param {object} o { template, run, siteName, baseUrl } — run.figures/analysis/commentary are objects. */
function renderHtml({ template, run, siteName = null, baseUrl = '' }) {
  const lang = template.lang === 'fr' ? 'fr' : 'en'; const t = T[lang]; const A = run.analysis || {}; const F = run.figures || []; const C = run.commentary || {};
  const sections = template.sections && template.sections.length ? template.sections : ['headline', 'figures', 'analysis', 'commentary', 'actions'];
  const singles = F.filter(f => f.value !== undefined && !f.series && !f.rows && f.open === undefined);
  const series = F.filter(f => f.series), grids = F.filter(f => f.rows), actions = F.filter(f => f.open !== undefined);
  const parts = [];
  for (const s of sections) {
    if (s === 'headline') parts.push(`<p class="headline">${esc(A.headline || '')}</p>`);
    if (s === 'figures' && singles.length) parts.push(`<h2>${t.figures}</h2><div class="tiles">${singles.map(f => `<div class="tile" style="border-top-color:${RAG[f.rag] || RAG.NA}"><div class="tn">${esc(fmt(f.value, f.unit))}</div><div class="tl">${esc(f.title || f.metric)}</div><div class="tm">${f.window ? esc(f.window) : ''}${f.fleet != null ? ` · ${lang === 'fr' ? 'flotte' : 'fleet'} ${esc(fmt(f.fleet, f.unit))}` : ''}</div></div>`).join('')}</div>`);
    if (s === 'figures' && series.length) parts.push(series.map(f => `<h3>${esc(f.title || f.metric)} — ${t.trend}</h3><table><tr>${f.series.map(p => `<th>${esc(p.label)}</th>`).join('')}</tr><tr>${f.series.map(p => `<td>${esc(fmt(p.value, f.unit))}</td>`).join('')}</tr></table>`).join(''));
    if (s === 'figures' && grids.length) parts.push(grids.map(f => `<h3>${esc(f.title || f.metric)} — ${t.persite}</h3><table><tr><th>${t.site}</th><th>${t.value}</th><th>${t.rag}</th></tr>${f.rows.map(r => `<tr><td>${esc(r.site)}</td><td>${esc(fmt(r.value, f.unit))}</td><td><span class="pill" style="background:${RAG[r.rag] || RAG.NA}">${esc(r.rag || 'NA')}</span></td></tr>`).join('')}</table>`).join(''));
    if (s === 'analysis') parts.push(`<h2>${t.analysis} <small>(${t.deterministic})</small></h2><ul>${(A.bullets || []).map(b => `<li>${esc(b)}</li>`).join('') || `<li>—</li>`}</ul>`);
    if (s === 'commentary' && C.text) parts.push(`<h2>${t.commentary} <small>(${C.source === 'ai' ? t.ai : t.deterministic}${C.provider && C.source === 'ai' ? ' · ' + esc(C.provider) : ''})</small></h2><p class="commentary">${esc(C.text)}</p>`);
    if (s === 'actions' && actions.length) parts.push(`<h2>${t.actions}</h2><ul>${actions.map(f => `<li>${esc(f.title || '')}: ${f.open == null ? t.notmeasured : esc(f.open)} ${lang === 'fr' ? 'ouvertes' : 'open'}, ${esc(f.overdue)} ${lang === 'fr' ? 'en retard' : 'overdue'}</li>`).join('')}</ul>`);
  }
  const status = t[run.status] || run.status;
  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><title>${esc(template.name)}${siteName ? ' — ' + esc(siteName) : ''}</title><style>body{font-family:Calibri,Arial,sans-serif;color:#1F2A33;max-width:960px;margin:0 auto;padding:18px}h1{font-size:20px;color:#3A4A60;margin:0}h2{font-size:15px;color:#3A4A60;margin:18px 0 6px}h3{font-size:13px;margin:12px 0 4px}small{color:#6b7785;font-weight:400}.meta{color:#6b7785;font-size:12px}.status{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;color:#fff;background:${run.status === 'published' ? '#27AE60' : run.status === 'reviewed' ? '#3A4A60' : '#E8A100'}}.headline{font-size:15px;font-weight:600;margin:14px 0}.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.tile{border:1px solid #e4e8ee;border-top:4px solid;border-radius:10px;padding:8px 10px}.tn{font-size:20px;font-weight:700;color:#3A4A60}.tl{font-size:12px}.tm{font-size:11px;color:#6b7785}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #e4e8ee;padding:4px 8px;font-size:12px;text-align:left}th{background:#f4f6f7}.pill{color:#fff;border-radius:999px;padding:1px 7px;font-size:11px}.commentary{white-space:pre-wrap}</style></head><body>
<h1>${esc(template.name)}${siteName ? ' — ' + esc(siteName) : ''}</h1><p class="meta"><span class="status">${esc(status)}</span> · ${t.window}: ${esc(run.window_label || (lang === 'fr' ? 'courante' : 'current'))} · ${t.generated} ${esc(String(run.created_at || '').slice(0, 16).replace('T', ' '))}${A.coverage ? ` · ${A.coverage.measured}/${A.coverage.total} ${lang === 'fr' ? 'indicateurs mesurés' : 'indicators measured'}` : ''}</p>
${parts.join('\n')}
<p class="meta">${t.source}: ${lang === 'fr' ? 'dictionnaire des KPI, tableau de bord' : 'KPI dictionary, dashboard'} <code>${esc(template.dashboard_key)}</code>${baseUrl ? ` · <a href="${esc(baseUrl)}/dashboards.html?key=${esc(template.dashboard_key)}">${lang === 'fr' ? 'ouvrir le tableau de bord' : 'open the dashboard'}</a>` : ''}. ${lang === 'fr' ? '« — » = non mesuré, jamais 0.' : '“—” = not measured, never 0.'}</p></body></html>`;
}

/** CSV of the canonical figures (UTF-8 BOM, CRLF). */
function renderCsv(run) {
  const rows = [['kind', 'metric', 'title', 'site_or_label', 'value', 'unit', 'rag', 'window', 'as_of']];
  for (const f of run.figures || []) {
    if (f.series) for (const p of f.series) rows.push(['series', f.metric, f.title, p.label, p.value, f.unit, '', '', '']);
    else if (f.rows) for (const r of f.rows) rows.push(['per-site', f.metric, f.title, r.site, r.value, f.unit, r.rag, '', '']);
    else if (f.open !== undefined) rows.push(['actions', '', f.title, '', f.open, 'count', '', '', ''], ['actions_overdue', '', f.title, '', f.overdue, 'count', '', '', '']);
    else rows.push(['single', f.metric, f.title, '', f.value, f.unit, f.rag, f.window, f.as_of]);
  }
  const q = (v) => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + rows.map(r => r.map(q).join(',')).join('\r\n') + '\r\n';
}

/** PPTX: cover + figures tiles + analysis/commentary slide (+ one slide per grid). LAYOUT_WIDE 13.33 × 7.5. */
async function renderPptx({ template, run, siteName = null }) {
  const PptxGenJS = require('pptxgenjs'); const { fixComboChartAxes } = require('../pptx-fix-axes');
  const pptx = new PptxGenJS(); pptx.layout = 'LAYOUT_WIDE'; const lang = template.lang === 'fr' ? 'fr' : 'en'; const t = T[lang]; const A = run.analysis || {}; const F = run.figures || [];
  const title = (s, txt) => { s.addShape('rect', { x: 0, y: 0, w: 13.33, h: 0.9, fill: { color: '3A4A60' }, line: { color: '3A4A60' } }); s.addText(txt, { x: 0.3, y: 0.15, w: 12.73, h: 0.6, fontSize: 22, bold: true, color: 'FFFFFF', fontFace: 'Calibri' }); };
  const s1 = pptx.addSlide(); title(s1, `${template.name}${siteName ? ' — ' + siteName : ''}`);
  s1.addText(`${t.window}: ${run.window_label || '—'} · ${t.generated} ${String(run.created_at || '').slice(0, 10)} · ${(t[run.status] || run.status)}`, { x: 0.3, y: 1.1, w: 12.73, h: 0.4, fontSize: 12, color: '666666' });
  s1.addText(A.headline || '', { x: 0.3, y: 1.7, w: 12.73, h: 0.8, fontSize: 16, bold: true, color: '1F2A33' });
  const singles = F.filter(f => f.value !== undefined && !f.series && !f.rows && f.open === undefined).slice(0, 8);
  singles.forEach((f, i) => { const col = i % 4, row = Math.floor(i / 4); const x = 0.3 + col * 3.19, y = 2.7 + row * 1.5; s1.addShape('rect', { x, y, w: 3.05, h: 1.3, fill: { color: 'FFFFFF' }, line: { color: 'DDDDDD', pt: 0.5 } }); s1.addShape('rect', { x, y, w: 3.05, h: 0.08, fill: { color: (RAG[f.rag] || RAG.NA).slice(1) }, line: { color: (RAG[f.rag] || RAG.NA).slice(1), pt: 0 } });
    s1.addText(fmt(f.value, f.unit), { x: x + 0.1, y: y + 0.15, w: 2.85, h: 0.6, fontSize: 24, bold: true, color: '3A4A60' }); s1.addText(`${f.title || f.metric}${f.window ? ' · ' + f.window : ''}`, { x: x + 0.1, y: y + 0.78, w: 2.85, h: 0.45, fontSize: 10, color: '666666' }); });
  const s2 = pptx.addSlide(); title(s2, `${t.analysis} · ${t.commentary}`);
  s2.addText((A.bullets || []).slice(0, 8).map(b => ({ text: b, options: { bullet: true, breakLine: true } })), { x: 0.3, y: 1.1, w: 12.73, h: 3.0, fontSize: 13, color: '1F2A33', valign: 'top' });
  if (run.commentary && run.commentary.text) s2.addText(run.commentary.text, { x: 0.3, y: 4.3, w: 12.73, h: 2.8, fontSize: 12, italic: true, color: '333333', valign: 'top', fill: { color: 'F4F6F7' } });
  for (const g of F.filter(f => f.rows).slice(0, 4)) { const s = pptx.addSlide(); title(s, `${g.title || g.metric} — ${t.persite}`); s.addTable([[{ text: t.site, options: { bold: true, fill: { color: 'F4F6F7' } } }, { text: t.value, options: { bold: true, fill: { color: 'F4F6F7' } } }, { text: t.rag, options: { bold: true, fill: { color: 'F4F6F7' } } }], ...g.rows.slice(0, 16).map(r => [r.site, fmt(r.value, g.unit), { text: r.rag || 'NA', options: { color: (RAG[r.rag] || RAG.NA).slice(1), bold: true } }])], { x: 0.3, y: 1.1, w: 12.73, colW: [6.73, 3, 3], fontSize: 12, border: { type: 'solid', pt: 0.5, color: 'DDDDDD' } }); }
  const buf = await pptx.write({ outputType: 'nodebuffer' });
  return fixComboChartAxes(buf);
}

module.exports = { renderHtml, renderCsv, renderPptx, T };
