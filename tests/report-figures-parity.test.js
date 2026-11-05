'use strict';
// C-16 (G25, F27) — golden figure parity: ONE fixture, the SAME headline figures (total, closed,
// resolution SLA %, changes) asserted identical across every output that carries them:
//   A. Report Studio run (the single publication chain, PO decision P2): HTML · CSV · XLSX · PPTX.
//      The PDF is renderPdf(run.html) (routes/reportStudio.js) — same string as the HTML, asserted statically.
//   B. Group IT deck: screen rule (public/lib/dashboard-shared.js) · browser deck payload
//      (public/lib/execDeckPayload.js, the builder's figure core) · server payload (reportPayload merge).
// On a mismatch the failure message is a diff report (figure · source · expected · got).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const XLSX = require('xlsx');
const JSZip = require('jszip');
const ROOT = path.join(__dirname, '..');
const pack = require('../services/reportPack');
const { buildWorkbook } = require('../services/tableExcel');
const XP = require('../public/lib/execDeckPayload');
const rp = require('../services/reportPayload');

// ── shared fixture: July 2026 tickets + changes (no cancelled ticket — see the P8 test below) ──
const ctx = { window: {}, console };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public', 'lib', 'dashboard-shared.js'), 'utf8'), ctx);
const H = { isClosed: ctx.window.isClosed, isResOverdue: ctx.window.isResOverdue, periodSlaRates: ctx.window.periodSlaRates };
const T = (o) => Object.assign({ 'Request Status': 'Open', 'Created Time': '05 Jul 2026 09:00 AM', Category: 'Hardware', Mode: 'Web Form', 'Responded Time': '05 Jul 2026 09:30 AM', 'First Response Overdue Status': 'false', 'Overdue Status': '0' }, o);
const CUR = [
  ...Array.from({ length: 9 }, (_, i) => T({ 'Request Status': 'Closed', Category: ['Hardware', 'Network', 'Email', 'Access'][i % 4] })),
  T({ 'Request Status': 'Closed', 'Overdue Status': '1', Category: 'Network' }),
  T({ 'Request Status': 'Resolved', 'Overdue Status': '1', Category: 'Software' }),
  T({ Category: 'Printing' }), T({ Category: 'Printing', 'First Response Overdue Status': 'true' }), T({ Category: 'Telephony' }),
];
const PREV = [T({ 'Request Status': 'Closed' }), T({})];
const CHANGES = ['Standard', 'Standard', 'Normal', 'Normal', 'Normal', 'Emergency', 'Major'].map((t) => ({ 'Change Type': t }));

// Screen rule: the ITSM denominator doctrine as the helpdesk screen applies it (dashboard-shared).
function screenFigures(rows, chg) {
  const closed = rows.filter(H.isClosed);
  const viol = closed.filter(H.isResOverdue).length;
  return { total: rows.length, closed: closed.length, sla_res_pct: closed.length ? Math.round((closed.length - viol) / closed.length * 1000) / 10 : null, changes: chg.length };
}
function diffReport(expected, sources) {
  const lines = [];
  for (const [src, got] of Object.entries(sources)) for (const k of Object.keys(expected)) if (got[k] !== expected[k]) lines.push(`${k.padEnd(12)} ${src.padEnd(14)} expected ${expected[k]} got ${got[k]}`);
  return lines;
}

test('B. Group IT deck: screen = browser deck payload = server deck payload (total, closed, SLA %, changes)', () => {
  const screen = screenFigures(CUR, CHANGES);
  const hk = XP.headlineKpis(CUR, PREV, H);
  const ct = XP.changeTypeCounts(CHANGES);
  const browser = { total: hk.total_tickets, closed: hk.closed_tickets, sla_res_pct: hk.sla_res_pct, changes: ct.total };
  const enriched = rp.mergeBrowserKpis({ total: 999, closed: 999, sla_compliance: 1 }, { total_tickets: hk.total_tickets, closed_tickets: hk.closed_tickets, sla_res_pct: hk.sla_res_pct });
  rp.mergeBrowserChanges(enriched, { total: ct.total, emergency: ct.emergency, major: ct.major, standard: ct.standard, normal: ct.normal, type_partition: ct.partition }, { otherBucket: false });
  const server = { total: enriched.total, closed: enriched.closed, sla_res_pct: enriched.sla_compliance, changes: enriched.changes_total };
  const diff = diffReport(screen, { browser_payload: browser, server_payload: server });
  assert.deepStrictEqual(diff, [], 'figure diff report:\n' + diff.join('\n'));
  // helpdesk tile helper (index.html) agrees too when no ticket is cancelled
  const r = H.periodSlaRates(CUR);
  assert.strictEqual(Math.round((100 - r.res_violated_pct) * 10) / 10, screen.sla_res_pct);
});

test('B. switch on: every deck chart total equals the KPI it illustrates (Σ categories = tickets, Σ change slices = changes)', () => {
  const hk = XP.headlineKpis(CUR, PREV, H);
  const tally = {}; CUR.forEach((t) => { tally[t.Category] = (tally[t.Category] || 0) + 1; });
  const full = Object.entries(tally).map(([name, current]) => ({ name, current, previous: 0 })).sort((a, b) => b.current - a.current);
  const ct = XP.changeTypeCounts(CHANGES);
  const e = {};
  rp.mergeBrowserCategories(e, { categories: full.slice(0, 3), categories_full: full }, { otherBucket: true, top: 3 });
  rp.mergeBrowserChanges(e, { total: ct.total, emergency: ct.emergency, major: ct.major, standard: ct.standard, normal: ct.normal, type_partition: ct.partition }, { otherBucket: true });
  const sum = (o) => Object.values(o).reduce((s, v) => s + v, 0);
  assert.strictEqual(sum(e.categories), hk.total_tickets);
  assert.strictEqual(sum(e.changes_type), e.changes_total);
  assert.strictEqual(e.changes_type.Normal, 3, 'Normal changes are their own slice');
});

test('B. cancelled tickets: the deck and the helpdesk tile now share ONE SLA rule (C-30 resolutionSla)', () => {
  // Before C-30 a cancelled closed ticket was the only source of deck-vs-tile divergence (P8).
  // C-30 routed the tile, ranking and trend through one helper that keeps cancelled tickets in the
  // closed denominator, like the deck — so the two now agree. Which rule is right stays with the
  // KPI committee (helpdesk_sla_definition); this test pins that both surfaces move together.
  const rows = [...CUR, T({ 'Request Status': 'Cancelled' })];
  const deck = XP.headlineKpis(rows, PREV, H).sla_res_pct;
  const tile = Math.round((100 - H.periodSlaRates(rows).res_violated_pct) * 10) / 10;
  assert.strictEqual(deck, tile, 'deck and helpdesk tile must give the same SLA % with a cancelled ticket present');
  assert.strictEqual(XP.headlineKpis(CUR, PREV, H).sla_res_pct, Math.round((100 - H.periodSlaRates(CUR).res_violated_pct) * 10) / 10);
});

// ── A. Report Studio: one run, four formats ──────────────────────────────────────────────────
function studioRun() {
  const s = screenFigures(CUR, CHANGES);
  const single = (metric, title, value, unit) => ({ metric, title, value, unit, rag: 'NA', window: '2026-07', as_of: '2026-07-31' });
  return {
    status: 'draft', window_label: '2026-07', created_at: '2026-08-01T07:00:00Z', analysis: { headline: 'July', bullets: ['b'] }, commentary: {},
    figures: [
      single('helpdesk.window_created', 'Tickets created', s.total, 'count'),
      single('helpdesk.window_closed', 'Tickets closed', s.closed, 'count'),
      single('helpdesk.resolution_sla_pct', 'Resolution SLA', s.sla_res_pct, '%'),
      single('changes.window_total', 'Changes', s.changes, 'count'),
      single('helpdesk.first_reply_sla_pct', 'First reply SLA', 92.86, '%'),
      single('inspection.conformity_pct', 'Inspection conformity', null, '%'),
      single('helpdesk.window_major_incidents', 'Major incidents', 0, 'count'),
      single('helpdesk.window_overdue', 'Overdue', 2, 'count'),
      single('meetings.engagement_score', 'Engagements', 61.5, '%'),
      { metric: 'helpdesk.resolution_sla_pct', title: 'SLA per site', unit: '%', rows: [{ site: 'Hounde', value: 81.8, rag: 'AMBER' }, { site: 'Mana', value: null, rag: 'NA' }] },
    ],
  };
}
const TEMPLATE = { key: 'golden', name: 'Golden pack', dashboard_key: 'exec-home', lang: 'en', sections: ['headline', 'figures'] };
const unesc = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
function parseCsv(text) {
  const out = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell.replace(/\r$/, '')); out.push(row); row = []; cell = ''; } else cell += c;
  }
  return out;
}
async function pptxTexts(buf) {
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
  const all = [];
  for (const n of names) { const xml = await zip.file(n).async('string'); for (const m of xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)) all.push(unesc(m[1])); }
  return all;
}

test('A. Report Studio golden run: HTML, CSV, XLSX and PPTX carry the same figure set (incl. a 9th tile and per-site rows)', async () => {
  const run = studioRun();
  const fmt = (v, u) => (v == null ? '—' : u === '%' ? `${Math.round(Number(v) * 10) / 10} %` : String(Math.round(Number(v) * 100) / 100));
  const singles = run.figures.filter((f) => !f.rows);
  const grid = run.figures.find((f) => f.rows);

  const html = pack.renderHtml({ template: TEMPLATE, run });
  const htmlTiles = {}; for (const m of html.matchAll(/<div class="tn">([^<]*)<\/div><div class="tl">([^<]*)<\/div>/g)) htmlTiles[unesc(m[2])] = unesc(m[1]);
  const htmlGrid = {}; for (const m of html.matchAll(/<tr><td>([^<]*)<\/td><td>([^<]*)<\/td>/g)) htmlGrid[unesc(m[1])] = unesc(m[2]);

  const csv = parseCsv(pack.renderCsv(run).replace(/^﻿/, ''));
  const head = csv[0]; const ix = (k) => head.indexOf(k);
  const csvSingles = {}, csvGrid = {};
  for (const r of csv.slice(1)) { if (r[ix('kind')] === 'single') csvSingles[r[ix('title')]] = r[ix('value')]; if (r[ix('kind')] === 'per-site') csvGrid[r[ix('site_or_label')]] = r[ix('value')]; }

  const wb = XLSX.read(buildWorkbook([{ name: 'Figures', rows: pack.figureRows(run) }]), { type: 'buffer' });
  const xl = XLSX.utils.sheet_to_json(wb.Sheets.Figures, { defval: null });
  const xlSingles = {}, xlGrid = {};
  for (const r of xl) { if (r.kind === 'single') xlSingles[r.title] = r.value; if (r.kind === 'per-site') xlGrid[r.label] = r.value; }

  const texts = await pptxTexts(await pack.renderPptx({ template: TEMPLATE, run }));

  const diff = [];
  for (const f of singles) {
    const shown = fmt(f.value, f.unit), raw = f.value == null ? '' : String(f.value);
    if (htmlTiles[f.title] !== shown) diff.push(`${f.title}: HTML ${htmlTiles[f.title]} ≠ ${shown}`);
    if (csvSingles[f.title] !== raw) diff.push(`${f.title}: CSV ${csvSingles[f.title]} ≠ ${raw}`);
    if ((xlSingles[f.title] ?? null) !== (f.value ?? null)) diff.push(`${f.title}: XLSX ${xlSingles[f.title]} ≠ ${f.value}`);
    const ti = texts.findIndex((t) => t.startsWith(f.title + ' · '));
    if (ti < 1 || texts[ti - 1] !== shown) diff.push(`${f.title}: PPTX ${ti < 1 ? 'missing' : texts[ti - 1]} ≠ ${shown}`);
  }
  for (const r of grid.rows) {
    const shown = fmt(r.value, grid.unit);
    if (htmlGrid[r.site] !== shown) diff.push(`${r.site}: HTML grid ${htmlGrid[r.site]} ≠ ${shown}`);
    if (csvGrid[r.site] !== (r.value == null ? '' : String(r.value))) diff.push(`${r.site}: CSV grid ${csvGrid[r.site]}`);
    if ((xlGrid[r.site] ?? null) !== (r.value ?? null)) diff.push(`${r.site}: XLSX grid ${xlGrid[r.site]}`);
    const ti = texts.indexOf(r.site); if (ti < 0 || texts[ti + 1] !== shown) diff.push(`${r.site}: PPTX grid ${ti < 0 ? 'missing' : texts[ti + 1]} ≠ ${shown}`);
  }
  assert.deepStrictEqual(diff, [], 'figure diff report:\n' + diff.join('\n'));
});

test('A. PDF = renderPdf(run.html) and the XLSX route uses the shared figureRows (one row builder for every format)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'routes', 'reportStudio.js'), 'utf8');
  assert.ok(/renderPdf\)\(r\.html \|\| ''/.test(src), 'the PDF is printed from the very HTML that was asserted above');
  assert.ok(src.includes('figureRows(r)'), 'the XLSX export uses reportPack.figureRows');
});
