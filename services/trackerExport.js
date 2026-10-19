'use strict';
// Step 7 — Excel + PPTX exports of a GENERIC tracker, both reading the engine result
// (trackerStore.scoreTracker → trackerDefinitions.score). No formula lives here.
const XLSX = require('xlsx');

function periodLabels(def) {
  const n = def.period.count, k = def.period.kind;
  const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const start = /^\d{4}-(\d{2})$/.test(String(def.period.start || '')) ? Number(String(def.period.start).slice(5, 7)) - 1 : 0;
  return Array.from({ length: n }, (_, i) => k === 'monthly' ? MO[(start + i) % 12] : k === 'weekly' ? `W${String(i + 1).padStart(2, '0')}` : `Q${i + 1}`);
}
const pct = (x) => x == null ? '' : Math.round(x * 1000) / 10;

/** Workbook: Scores (unit × group + total), Entries (unit × item × slots), Definition. Returns a Buffer. */
function buildWorkbook(def, result, inputs) {
  const wb = XLSX.utils.book_new();
  const labels = periodLabels(def);
  const scores = [['Unit', ...def.groups.map(g => g.name), 'Score %', 'RAG']];
  for (const u of def.units) { const r = result.units[u.code] || {}; scores.push([u.code, ...def.groups.map(g => pct(r.groups && r.groups[g.code] && r.groups[g.code].score)), pct(r.score), r.rag || '']); }
  scores.push([]); scores.push(['Fleet mean %', pct(result.fleet.mean)], ['Best', result.fleet.best || ''], ['Worst', result.fleet.worst || ''], ['Attainment %', pct(result.fleet.attainment)], ['Period reached', result.currentPeriod], ['Version', result.version || 'draft']);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(scores), 'Scores');
  const ent = [['Unit', 'Group', 'Item', 'KPI type', 'Target', ...labels, 'Value', 'Attainment %', 'RAG']];
  for (const u of def.units) for (const g of def.groups) for (const it of g.items) {
    const ser = ((inputs[u.code] || {})[it.code] || []); const ir = ((result.units[u.code] || {}).items || {})[it.code] || {};
    ent.push([u.code, g.name, it.name, it.kpiType, ir.target ?? it.target ?? '', ...labels.map((_, i) => ser[i] == null ? '' : ser[i]), ir.value ?? '', pct(ir.attainment), ir.rag || '']);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ent), 'Entries');
  const d = [['Key', def.key], ['Name', def.name], ['Period', `${def.period.kind} from ${def.period.start} × ${def.period.count}`], ['RAG policy', typeof def.ragPolicy === 'string' ? def.ragPolicy : JSON.stringify(def.ragPolicy)], [], ['Group', 'Weight', 'Item', 'KPI type', 'Weight', 'Start', 'End', 'Shared', 'Source metric']];
  for (const g of def.groups) for (const it of g.items) d.push([g.name, g.weight, `${it.code} ${it.name}`, it.kpiType, it.weight, it.start || 1, it.end || def.period.count, it.shared ? 'yes' : '', it.source ? it.source.metric : '']);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(d), 'Definition');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/** Parse an uploaded Entries sheet (same layout as the export) → cells for trackerStore.saveEntries. */
function parseEntriesWorkbook(buf, def) {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets.Entries || wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const labels = periodLabels(def);
  const head = (rows[0] || []).map(x => String(x == null ? '' : x).trim());
  const iUnit = head.indexOf('Unit'), iItem = head.indexOf('Item');
  const slotCols = labels.map(l => head.indexOf(l));
  const itemByName = new Map(); for (const g of def.groups) for (const it of g.items) { itemByName.set(it.name.toLowerCase(), it.code); itemByName.set(it.code.toLowerCase(), it.code); }
  const cells = [], errors = [];
  if (iUnit < 0 || iItem < 0) return { cells, errors: [{ row: 1, error: 'header needs Unit and Item columns' }] };
  rows.slice(1).forEach((r, k) => {
    const unit = String(r[iUnit] || '').trim(), item = itemByName.get(String(r[iItem] || '').trim().toLowerCase());
    if (!unit || !item) { if (unit || r[iItem]) errors.push({ row: k + 2, error: 'unknown unit or item' }); return; }
    slotCols.forEach((ci, s) => { if (ci < 0) return; const v = r[ci]; if (v == null || v === '') return; if (!Number.isFinite(Number(v))) { errors.push({ row: k + 2, error: `non-numeric value in ${labels[s]}` }); return; } cells.push({ unit, item, slot: s + 1, value: Number(v) }); });
  });
  return { cells, errors };
}

/** 2-slide PPTX (scores table + per-unit cards) via pptxgenjs, same canvas rules as the other decks. */
async function buildPptx(def, result) {
  const PptxGenJS = require('pptxgenjs');
  const { fixComboChartAxes } = require('../pptx-fix-axes');
  const pptx = new PptxGenJS(); pptx.layout = 'LAYOUT_WIDE';
  const C = { blue: '2A5490', green: '27AE60', amber: 'E87722', red: 'E74C3C', grey: '666666' };
  const rc = (r) => r === 'GREEN' ? C.green : r === 'AMBER' ? C.amber : r === 'RED' ? C.red : C.grey;
  const s1 = pptx.addSlide();
  s1.addText(`${def.name} — period ${result.currentPeriod}/${def.period.count}`, { x: 0.3, y: 0.2, w: 12.73, h: 0.5, fontSize: 22, bold: true, color: C.blue, fontFace: 'Calibri' });
  const head = ['Unit', ...def.groups.map(g => g.name), 'Score', 'RAG'].map(t => ({ text: t, options: { bold: true, color: 'FFFFFF', fill: { color: C.blue }, fontSize: 10 } }));
  const body = def.units.map(u => { const r = result.units[u.code] || {}; return [u.name || u.code, ...def.groups.map(g => { const v = r.groups && r.groups[g.code] && r.groups[g.code].score; return v == null ? '—' : `${pct(v)} %`; }), r.score == null ? '—' : `${pct(r.score)} %`, { text: r.rag || 'NA', options: { color: rc(r.rag), bold: true } }]; });
  s1.addTable([head, ...body.map(r => r.map(c => typeof c === 'object' ? c : { text: String(c), options: { fontSize: 10 } }))], { x: 0.3, y: 0.9, w: 12.73, fontFace: 'Calibri', border: { type: 'solid', color: 'DDDDDD', pt: 0.5 } });
  s1.addText(`Fleet mean ${result.fleet.mean == null ? '—' : pct(result.fleet.mean) + ' %'} · attainment ${result.fleet.attainment == null ? '—' : pct(result.fleet.attainment) + ' %'} · version ${result.version || 'draft'} · generated ${new Date().toISOString().slice(0, 10)}`, { x: 0.3, y: 6.9, w: 12.73, h: 0.3, fontSize: 9, color: C.grey, italic: true, fontFace: 'Calibri' });
  const s2 = pptx.addSlide();
  s2.addText('Items by unit', { x: 0.3, y: 0.2, w: 12.73, h: 0.5, fontSize: 22, bold: true, color: C.blue, fontFace: 'Calibri' });
  const n = def.units.length || 1, cw = (12.73 - 0.14 * (n - 1)) / n;
  def.units.forEach((u, i) => {
    const x = 0.3 + i * (cw + 0.14); const r = result.units[u.code] || { items: {} };
    s2.addShape('rect', { x, y: 0.9, w: cw, h: 6.2, fill: { color: 'FFFFFF' }, line: { color: 'DDDDDD', pt: 0.5 } });
    s2.addText(`${u.code} · ${r.score == null ? '—' : pct(r.score) + ' %'}`, { x: x + 0.1, y: 0.95, w: cw - 0.2, h: 0.35, fontSize: 12, bold: true, color: rc(r.rag), fontFace: 'Calibri' });
    const lines = def.groups.flatMap(g => g.items.map(it => { const ir = (r.items || {})[it.code] || {}; return { text: `${ir.rag === 'GREEN' ? '✓' : ir.rag === 'RED' ? '■' : '▲'} ${it.name}`, options: { color: rc(ir.rag), fontSize: 8, breakLine: true } }; }));
    s2.addText(lines, { x: x + 0.1, y: 1.35, w: cw - 0.2, h: 5.6, valign: 'top', fontFace: 'Calibri', fit: 'shrink' });
  });
  const raw = await pptx.write({ outputType: 'nodebuffer' });
  return fixComboChartAxes(raw);
}

module.exports = { buildWorkbook, parseEntriesWorkbook, buildPptx, periodLabels };
