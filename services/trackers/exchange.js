'use strict';
// Step 7 — the tracker's Excel and slide outputs, and its Excel import. Every score printed here comes from
// public/lib/trackerEngine.js (the same engine as the entry screen) — no formula in this file.
//
// Workbook layout (export AND import template): sheet "Saisies", one row per unit × item, columns
//   Unité | Élément | Code élément | M1 … M12 | Type | Cible | Score | Couleur
// The import reads "Unité" (unit code), "Code élément" and the M1-M12 columns; everything else is ignored.

const XLSX = require('xlsx');
const Engine = require('../../public/lib/trackerEngine');

const MONTHS = Array.from({ length: 12 }, (_, i) => 'M' + (i + 1));
const label = (t) => (t && typeof t === 'object' ? (t.fr || t.en || '') : String(t || ''));

function workbook(def, values, mo) {
  const rows = [];
  for (const u of def.units) {
    const sc = Engine.score(def, values, u.code, mo);
    def.items.forEach((it, i) => {
      const s = sc[i];
      const row = { 'Unité': u.code, 'Nom de l\'unité': u.name, 'Élément': label(it.name), 'Code élément': it.code, 'Groupe': it.group };
      const v = (values[u.code] && values[u.code][it.code]) || [];
      MONTHS.forEach((m, k) => { row[m] = v[k] || 0; });
      Object.assign(row, { 'Type': it.kpi, 'Cible': s.on ? s.yt : '', 'Cumul': s.on ? s.ya : '', 'Score': typeof s.sc === 'number' ? s.sc : '', 'Couleur': s.rg, 'Lié à': it.source ? it.source.metric : '' });
      rows.push(row);
    });
  }
  const units = Engine.activeUnits(def);
  const summary = units.map(u => {
    const s = Engine.unitSummary(def, values, u, mo);
    const r = { 'Unité': u, 'Score global (%)': Math.round(s.avg * 1000) / 10, 'Vert': s.g, 'Orange': s.a, 'Rouge': s.r };
    for (const g of def.groups) r[g.name] = s.groups[g.code] == null ? '' : Math.round(s.groups[g.code] * 1000) / 10;
    return r;
  });
  const f = Engine.fleet(def, values, mo);
  summary.push({ 'Unité': 'Ensemble', 'Score global (%)': Math.round(f.avg * 1000) / 10 });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Synthèse');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Saisies');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/**
 * Parse an uploaded workbook into cells for the definition. Unknown units / items and non-numeric values are
 * reported, never guessed. Returns { cells: [{unit,item,month,value}], rejected: [string] }.
 */
function parseImport(def, buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets['Saisies'] || wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { cells: [], rejected: ['no sheet'] };
  const units = new Set(def.units.map(u => u.code)), items = new Set(def.items.map(i => i.code));
  const linked = new Set(def.items.filter(i => i.source).map(i => i.code));
  const cells = [], rejected = [];
  XLSX.utils.sheet_to_json(sheet, { defval: null }).forEach((r, i) => {
    const line = i + 2, u = String(r['Unité'] == null ? '' : r['Unité']).trim(), it = String(r['Code élément'] == null ? '' : r['Code élément']).trim();
    if (!units.has(u)) { rejected.push(`ligne ${line} : unité inconnue « ${u} »`); return; }
    if (!items.has(it)) { rejected.push(`ligne ${line} : élément inconnu « ${it} »`); return; }
    if (linked.has(it)) return;   // computed from the dictionary, never typed
    MONTHS.forEach((m, k) => {
      const raw = r[m];
      if (raw == null || raw === '') return;
      const v = Number(String(raw).replace(',', '.'));
      if (!Number.isFinite(v)) { rejected.push(`ligne ${line} ${m} : « ${raw} » n'est pas un nombre`); return; }
      cells.push({ unit: u, item: it, month: k + 1, value: v });
    });
  });
  return { cells, rejected };
}

/** Two slides: the units × groups overview, then the item colours of every active unit. */
async function slides(def, values, mo) {
  const PptxGenJS = require('pptxgenjs');
  const { EDV } = require('../../public/brand/brand-tokens');
  const ORANGE = EDV.orange, INK = '2A2A2A';
  const RAG = { GREEN: EDV.green, AMBER: 'D97706', RED: 'D90038', 'N/A': 'A49F9E' };
  const p = new PptxGenJS();
  p.layout = 'LAYOUT_16x9';
  const units = Engine.activeUnits(def), f = Engine.fleet(def, values, mo);
  const title = label(def.title);
  const s1 = p.addSlide();
  s1.addText(title, { x: 0.4, y: 0.25, w: 9.2, h: 0.5, fontSize: 22, bold: true, color: INK });
  s1.addText(`${def.year} · cumul à fin du mois ${mo} · score d'ensemble ${Math.round(f.avg * 100)} %`, { x: 0.4, y: 0.75, w: 9.2, h: 0.3, fontSize: 12, color: ORANGE });
  const head = ['Unité', 'Global'].concat(def.groups.map(g => g.name)).map(t => ({ text: t, options: { bold: true, color: 'FFFFFF', fill: { color: INK } } }));
  const body = units.map(u => {
    const s = Engine.unitSummary(def, values, u, mo);
    return [u, Math.round(s.avg * 100) + ' %'].concat(def.groups.map(g => (s.groups[g.code] == null ? '—' : Math.round(s.groups[g.code] * 100) + ' %')));
  });
  s1.addTable([head].concat(body), { x: 0.4, y: 1.2, w: 9.2, fontSize: 11, border: { type: 'solid', color: 'E2E5EA', pt: 0.5 } });
  const s2 = p.addSlide();
  s2.addText('Couleur de chaque élément', { x: 0.4, y: 0.25, w: 9.2, h: 0.4, fontSize: 18, bold: true, color: INK });
  const short = (t) => (t.length > 34 ? t.slice(0, 33) + '…' : t);
  const h2 = [{ text: 'Élément', options: { bold: true } }].concat(units.map(u => ({ text: u, options: { bold: true, align: 'center' } })));
  const scores = units.map(u => Engine.score(def, values, u, mo));
  const rows2 = def.items.slice(0, 22).map((it, i) => [short(label(it.name))].concat(scores.map(sc => ({ text: sc[i].rg === 'N/A' ? '—' : (typeof sc[i].sc === 'number' ? Math.round(sc[i].sc * 100) + ' %' : ''), options: { align: 'center', color: 'FFFFFF', fill: { color: RAG[sc[i].rg] || RAG['N/A'] } } }))));
  s2.addTable([h2].concat(rows2), { x: 0.4, y: 0.75, w: 9.2, fontSize: 8, border: { type: 'solid', color: 'FFFFFF', pt: 0.5 } });
  if (def.items.length > 22) s2.addText(`+ ${def.items.length - 22} éléments dans l'export Excel`, { x: 0.4, y: 5.2, w: 9.2, h: 0.3, fontSize: 9, color: '666666' });
  return p.write({ outputType: 'nodebuffer' });
}

module.exports = { workbook, parseImport, slides, MONTHS };
