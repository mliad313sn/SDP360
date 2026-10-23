'use strict';
// Step 9 — the outputs of a report run: HTML (self-contained, the same look as the screens — the dashboard renderer
// and stylesheet are reused), CSV (every figure), PPTX (one slide per section). The PDF is the HTML printed by the
// server's browser (services/reportRender.js). Every figure comes from the run's frozen data; every commentary from
// the run's reviewed text.

const fs = require('fs');
const path = require('path');
const R = require('../../public/lib/dashboardRender');

let _css = null;
function css() {
  if (_css == null) {
    const read = (f) => { try { return fs.readFileSync(path.join(__dirname, '..', '..', 'public', f), 'utf8'); } catch (_) { return ''; } };
    _css = read('_tokens.css') + '\n' + read('dashboard.css') + '\nbody{background:#fff;margin:0}.rp-com{background:#F4F5F7;border-radius:10px;padding:12px 16px;margin:12px 0}.rp-com p{margin:4px 0}.rp-meta{color:#666;font-size:.85rem}';
  }
  return _css;
}
const esc = R.esc;
const STATUS = { draft: 'Brouillon — en attente de relecture', approved: 'Validé' };

/** commentary: { [sectionId]: string (paragraphs separated by blank lines) } */
function html(def, run, data, commentary) {
  const lang = def.language || 'fr';
  const title = def.title && typeof def.title === 'object' ? (def.title[lang] || def.title.fr || def.title.en || '') : String(def.title || '');
  const head = `<header class="db-head"><div><div class="db-eyebrow">${esc(run.scope_label)} · ${esc(run.month)}</div><h1>${esc(title)}</h1>` +
    `<p class="rp-meta">${esc(STATUS[run.status] || run.status)}${run.approved_by ? ' par ' + esc(run.approved_by) + ' le ' + esc(String(run.approved_at || '').slice(0, 10)) : ''} · chiffres calculés le ${esc(String(run.created_at || '').slice(0, 16).replace('T', ' '))} UTC</p></div></header>`;
  const body = def.sections.map(s => {
    if (s.type === 'commentary') {
      const text = (commentary || {})[s.id] || '';
      return `<section class="db-w rp-com" style="grid-column:span 12"><h2>${esc(s.title)}</h2>${text.split(/\n{2,}|\n/).filter(Boolean).map(p => `<p>${esc(p)}</p>`).join('')}</section>`;
    }
    return R.renderWidget(s, (data.widgets || {})[s.id] || { error: 'No data.' }, { lang });
  }).join('');
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title || 'Report')} — ${esc(run.month)}</title><style>${css()}</style></head>` +
    `<body><main class="db-page">${head}<div class="db-grid db-compact">${body}</div></main></body></html>`;
}

/** CSV: one line per figure. */
function csv(def, data) {
  const lines = [['section', 'indicateur', 'site', 'valeur', 'mois precedent', 'unite', 'etat']];
  const q = (v) => { const s = v == null ? '' : String(v); return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lbl = (l) => (l && typeof l === 'object' ? (l.fr || l.en || '') : String(l || ''));
  for (const s of def.sections) {
    if (s.type === 'commentary') continue;
    const d = (data.widgets || {})[s.id] || {};
    const title = lbl(s.title) || s.type;
    if (s.type === 'kpi') for (const it of d.items || []) lines.push([title, lbl(it.label), '', it.value, it.prev, it.unit, it.rag]);
    if (s.type === 'table' || s.type === 'rag-grid') for (const r of d.rows || []) (d.columns || []).forEach((c, i) => lines.push([title, lbl(c.label), r.name, r.cells[i] && r.cells[i].value, '', c.unit, r.cells[i] && r.cells[i].rag]));
    if (s.type === 'trend') for (const sr of d.series || []) for (const p of sr.points || []) lines.push([title, lbl(sr.label), p.label, p.value, '', sr.unit, '']);
    if (s.type === 'events') lines.push([title, s.source, '', s.source === 'incidents' ? d.open : d.pending, '', '', '']);
    if (s.type === 'actions') lines.push([title, 'en retard', '', d.total, '', '', '']);
    if (s.type === 'tracker') lines.push([title, 'ensemble', '', d.overall, '', '%', '']);
  }
  return '﻿' + lines.map(l => l.map(q).join(';')).join('\r\n');
}

/** PPTX: a title slide, then one slide per section. */
async function pptx(def, run, data, commentary) {
  const PptxGenJS = require('pptxgenjs');
  const { EDV } = require('../../public/brand/brand-tokens');
  const p = new PptxGenJS(); p.layout = 'LAYOUT_16x9';
  const lang = def.language || 'fr', lbl = (l) => (l && typeof l === 'object' ? (l[lang] || l.fr || l.en || '') : String(l || ''));
  const fmt = (v, u) => (v == null ? '—' : (Math.round(Number(v) * 10) / 10).toLocaleString('fr-FR') + (u === '%' ? ' %' : ''));
  const RAG = { green: EDV.green, amber: 'D97706', red: 'D90038' };
  const t = p.addSlide();
  t.addText(lbl(def.title), { x: 0.5, y: 1.6, w: 9, h: 0.9, fontSize: 30, bold: true, color: '2A2A2A' });
  t.addText(`${run.scope_label} · ${run.month}${run.status === 'approved' ? '' : ' · BROUILLON'}`, { x: 0.5, y: 2.5, w: 9, h: 0.5, fontSize: 16, color: EDV.orange });
  for (const s of def.sections) {
    const sl = p.addSlide();
    sl.addText(s.type === 'commentary' ? s.title : lbl(s.title) || s.type, { x: 0.4, y: 0.25, w: 9.2, h: 0.5, fontSize: 20, bold: true, color: '2A2A2A' });
    const d = (data.widgets || {})[s.id] || {};
    if (s.type === 'commentary') { sl.addText(((commentary || {})[s.id] || '—').split(/\n+/).filter(Boolean).map(x => ({ text: x, options: { bullet: true, breakLine: true } })), { x: 0.5, y: 0.9, w: 9, h: 4.3, fontSize: 14, color: '2A2A2A', valign: 'top' }); continue; }
    if (d.error) { sl.addText(d.error, { x: 0.5, y: 1, w: 9, h: 1, fontSize: 12, color: '666666' }); continue; }
    if (s.type === 'kpi') {
      const rows = [[{ text: 'Indicateur', options: { bold: true } }, { text: 'Valeur', options: { bold: true } }, { text: 'Mois précédent', options: { bold: true } }]]
        .concat((d.items || []).map(it => [lbl(it.label), { text: fmt(it.value, it.unit), options: { color: it.rag ? 'FFFFFF' : '2A2A2A', fill: it.rag ? { color: RAG[it.rag] } : undefined, bold: true } }, fmt(it.prev, it.unit)]));
      sl.addTable(rows, { x: 0.5, y: 0.9, w: 9, fontSize: 13, border: { type: 'solid', color: 'E2E5EA', pt: 0.5 } });
    } else if (s.type === 'trend' && (d.series || []).length) {
      sl.addChart(p.ChartType.line, d.series.map(sr => ({ name: lbl(sr.label), labels: sr.points.map(x => x.label), values: sr.points.map(x => (x.value == null ? 0 : x.value)) })),
        { x: 0.5, y: 0.9, w: 9, h: 4.3, showLegend: true, legendPos: 'b', chartColors: [EDV.orange, EDV.blue, EDV.green], lineDataSymbol: 'none' });
    } else if ((s.type === 'table' || s.type === 'rag-grid') && (d.rows || []).length) {
      const head = [{ text: 'Site', options: { bold: true } }].concat((d.columns || []).map(c => ({ text: lbl(c.label), options: { bold: true } })));
      const rows = d.rows.slice(0, 14).map(r => [r.name].concat(r.cells.map((c, i) => ({ text: fmt(c.value, d.columns[i] && d.columns[i].unit), options: { color: c.rag ? 'FFFFFF' : '2A2A2A', fill: c.rag ? { color: RAG[c.rag] } : undefined } }))));
      sl.addTable([head].concat(rows), { x: 0.5, y: 0.9, w: 9, fontSize: 10, border: { type: 'solid', color: 'E2E5EA', pt: 0.5 } });
    } else {
      const items = s.type === 'events' ? (d.items || []).slice(0, 10).map(i => `${i.title}${i.site ? ' — ' + i.site : ''}`) : s.type === 'actions' ? [`${d.total || 0} action(s) en retard, dont ${d.over30 || 0} de plus de 30 jours`]
        : s.type === 'tracker' ? [`Ensemble : ${d.overall == null ? '—' : d.overall + ' %'}`].concat((d.pillars || []).map(x => `${x.name} : ${x.pct == null ? '—' : x.pct + ' %'}`)) : [];
      sl.addText((items.length ? items : ['Rien à signaler.']).map(x => ({ text: x, options: { bullet: true, breakLine: true } })), { x: 0.5, y: 0.9, w: 9, h: 4.3, fontSize: 14, color: '2A2A2A', valign: 'top' });
    }
  }
  return p.write({ outputType: 'nodebuffer' });
}

module.exports = { html, csv, pptx, css };
