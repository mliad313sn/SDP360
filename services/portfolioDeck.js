'use strict';
// A-27 — portfolio deck (PPTX) and workbook (XLSX) for the IT committee, from the SAME view the portfolio page
// reads (routes/governance.js viewFor → stripMoney for a reader without canSeeMoney). No formula here beyond
// presentation: slip = projectSchedule.varianceOf, exposure = portfolioEvidence.riskView, exceptions = ppmAlerts.
// Canvas rules (CLAUDE.md): LAYOUT_WIDE 13.33 × 7.5 in, every panel x = 0.3 w = 12.73, safe bottom 7.38,
// BMP glyphs only, a title never carries an overlapping subtitle, null shows "—" (never 0), amounts carry
// their ISO currency code as text (no currency glyph). Golden fingerprint: tests/portfolio-deck.test.js.
const { varianceOf } = require('./projectSchedule');

const X = 0.3, W = 12.73, BOTTOM = 7.38;
const C = { navy: '3A4A60', ink: '1F2A33', grey: '6B7785', line: 'DDDDDD', head: '3A4A60', red: 'C0392B', amber: 'B7791F', green: '2E7D32' };
const dash = (v, unit = '') => (v == null || v === '' || (typeof v === 'number' && !Number.isFinite(v)) ? '—' : String(v) + unit);
const money = (n, cur) => (n == null ? '—' : Math.round(Number(n)).toLocaleString('en-US') + ' ' + (cur || '').trim()).trim();
const MAX_ROWS = 14;

function _title(slide, text) {
  slide.addText(text, { x: X, y: 0.25, w: W, h: 0.55, fontSize: 24, bold: true, color: C.navy, fontFace: 'Calibri', valign: 'middle' });
  slide.addShape('rect', { x: X, y: 0.85, w: W, h: 0.03, fill: { color: C.navy }, line: { color: C.navy, pt: 0 } });
}
function _footer(slide, asOf, n) {
  slide.addText(`Portfolio review · as of ${dash(asOf && String(asOf).slice(0, 10))} · “—” = not measured · page ${n}`, { x: X, y: 7.05, w: W, h: 0.3, fontSize: 9, color: C.grey, fontFace: 'Calibri', valign: 'middle' });
}
function _table(slide, header, rows, { y = 1.05, colW, more = 0, empty = 'None.' } = {}) {
  if (!rows.length) { slide.addText(empty, { x: X, y, w: W, h: 0.4, fontSize: 12, color: C.grey, fontFace: 'Calibri' }); return; }
  const hcell = (t) => ({ text: t, options: { bold: true, color: 'FFFFFF', fill: { color: C.head } } });
  const body = rows.map((r, i) => r.map((c) => ({ text: dash(c), options: { fill: { color: i % 2 ? 'F4F6F7' : 'FFFFFF' } } })));
  const rowH = Math.min(0.36, (BOTTOM - 0.45 - y) / (body.length + 1));
  slide.addTable([header.map(hcell), ...body], { x: X, y, w: W, colW, rowH, fontSize: 10, fontFace: 'Calibri', color: C.ink, border: { type: 'solid', pt: 0.5, color: C.line }, valign: 'middle' });
  if (more > 0) slide.addText(`+ ${more} more in the workbook`, { x: X, y: 6.7, w: W, h: 0.3, fontSize: 9, italic: true, color: C.grey, fontFace: 'Calibri' });
}
const _cap = (list) => ({ rows: list.slice(0, MAX_ROWS), more: Math.max(0, list.length - MAX_ROWS) });

/** @param view portfolio view (projects, summary, risks, programmes); opts { money, exceptions, asOf } → Promise<Buffer> */
async function buildDeck(view, { money: showMoney = false, exceptions = [], asOf = null } = {}) {
  const PptxGenJS = require('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = 'Portfolio review';
  const v = view || {};
  const projects = v.projects || [], summary = v.summary || [], risks = v.risks || [];
  const at = asOf || v.as_of || null;
  let page = 0;

  // 1 — cover + portfolio summary tiles
  let s = pptx.addSlide(); page++;
  s.addText('Portfolio review', { x: X, y: 1.6, w: W, h: 0.9, fontSize: 36, bold: true, color: C.navy, fontFace: 'Calibri' });
  s.addText(`IT committee · as of ${dash(at && String(at).slice(0, 10))}`, { x: X, y: 2.6, w: W, h: 0.45, fontSize: 16, color: C.grey, fontFace: 'Calibri' });
  const open = projects.filter((p) => !['done', 'cancelled'].includes(p.status));
  const slipping = projects.filter((p) => { const d = varianceOf(p).finish_variance_days; return d != null && d > 0; }).length;
  const tiles = [['Programmes', summary.length], ['Open projects', open.length], ['Late vs baseline', slipping], ['High risks open', risks.filter((r) => r.status === 'open' && r.severity === 'high').length], ['Exceptions', (exceptions || []).length]];
  const tw = (W - 0.1 * (tiles.length - 1)) / tiles.length;
  tiles.forEach(([label, val], i) => {
    const x = X + i * (tw + 0.1);
    s.addShape('rect', { x, y: 3.6, w: tw, h: 1.2, fill: { color: 'F4F6F7' }, line: { color: C.line, pt: 0.5 } });
    s.addText(label, { x: x + 0.1, y: 3.65, w: tw - 0.2, h: 0.35, fontSize: 11, bold: true, color: C.ink, fontFace: 'Calibri', valign: 'middle' });
    s.addText(dash(val), { x: x + 0.1, y: 4.05, w: tw - 0.2, h: 0.6, fontSize: 28, bold: true, color: C.navy, fontFace: 'Calibri', valign: 'middle' });
  });
  s.addText(showMoney ? 'Amounts are shown in their own currency (ISO code); currencies are never added together.' : 'Amounts are restricted for this reader (committee, admin or finance-viewer only).', { x: X, y: 5.1, w: W, h: 0.4, fontSize: 11, color: C.grey, fontFace: 'Calibri' });
  _footer(s, at, page);

  // 2 — programmes
  s = pptx.addSlide(); page++; _title(s, 'Programmes');
  _table(s, ['Programme', 'Objectives', 'Projects', 'Late', 'High risks', 'Weighted evidence'], summary.map((x) => [x.name, x.objectives, x.projects, x.late_projects, x.high_risks, x.weighted_evidence_pct == null ? null : x.weighted_evidence_pct + ' %']), { colW: [4.33, 1.6, 1.6, 1.6, 1.6, 2.0], empty: 'No programme.' });
  _footer(s, at, page);

  // 3 — schedule vs baseline
  s = pptx.addSlide(); page++; _title(s, 'Schedule vs baseline');
  const sched = projects.map((p) => ({ p, v: varianceOf(p) })).sort((a, b) => (b.v.finish_variance_days ?? -1e9) - (a.v.finish_variance_days ?? -1e9));
  const sc = _cap(sched);
  _table(s, ['Key', 'Project', 'Stage', 'Baseline end', 'Forecast end', 'Slip (days)'], sc.rows.map(({ p, v: x }) => [p.key, p.name, p.stage || null, x.baseline_end, x.actual_end || x.forecast_end, x.finish_variance_days == null ? null : (x.finish_variance_days > 0 ? '▲ ' : x.finish_variance_days < 0 ? '▼ ' : '') + x.finish_variance_days]), { colW: [1.4, 4.53, 1.5, 1.8, 1.8, 1.7], more: sc.more, empty: 'No project.' });
  _footer(s, at, page);

  // 4 — RAID: top open risks by exposure
  s = pptx.addSlide(); page++; _title(s, 'RAID — top open risks');
  const keyOf = new Map(projects.map((p) => [Number(p.id), p.key]));
  const top = risks.filter((r) => r.status === 'open').sort((a, b) => (b.exposure || 0) - (a.exposure || 0) || Number(a.id) - Number(b.id));
  const rc = _cap(top);
  _table(s, ['Project', 'Kind', 'Title', 'Exposure', 'Severity', 'Owner', 'Mitigation'], rc.rows.map((r) => [keyOf.get(Number(r.project_id)) || null, r.kind || 'risk', r.title, r.exposure, r.severity, r.owner, r.mitigation]), { colW: [1.3, 0.9, 3.2, 1.0, 1.0, 1.5, 3.83], more: rc.more, empty: 'No open risk.' });
  _footer(s, at, page);

  // 5 — exceptions (A11)
  s = pptx.addSlide(); page++; _title(s, 'Exceptions (Friday queue)');
  const ex = _cap(exceptions || []);
  _table(s, ['⚠ Kind', 'Project', 'Owner', 'Since', 'Detail'], ex.rows.map((e) => [e.kind.replace(/_/g, ' '), e.project_key, e.owner, e.since, e.message]), { colW: [2.0, 1.4, 1.8, 1.4, 6.13], more: ex.more, empty: 'No exception.' });
  _footer(s, at, page);

  // 6 — money per programme, only for a reader allowed to see it
  if (showMoney) {
    s = pptx.addSlide(); page++; _title(s, 'Budget and spend per programme');
    const rows = [];
    for (const x of summary) {
      const by = x.budget_by_currency || {};
      const cur = Object.keys(by).sort();
      if (!cur.length) rows.push([x.name, null, null, null, x.budget_unknown]);
      for (const c of cur) rows.push([x.name, c, money(by[c].budget, c), money(by[c].spent, c), x.budget_unknown]);
    }
    const mc = _cap(rows);
    _table(s, ['Programme', 'Currency', 'Budget', 'Spent', 'Projects without budget'], mc.rows, { colW: [4.33, 1.4, 2.4, 2.4, 2.2], more: mc.more, empty: 'No programme.' });
    _footer(s, at, page);
  }
  return pptx.write('nodebuffer');
}

/** Workbook sheets: Projects, Tasks, Milestones, RAID, Baselines, Exceptions, Benefits (SheetJS CE — no styling). */
function buildWorkbookBuffer(view, { money: showMoney = false, baselines = [], exceptions = [] } = {}) {
  const v = view || {};
  const keyOf = new Map((v.projects || []).map((p) => [Number(p.id), p.key]));
  const projects = (v.projects || []).map((p) => {
    const x = varianceOf(p);
    const row = { key: p.key, name: p.name, owner: p.owner, stage: p.stage || null, status: p.status, site_id: p.site_id, start_date: p.start_date, end_date: p.end_date, baseline_start: p.baseline_start, baseline_end: p.baseline_end, forecast_end: x.forecast_end, actual_end: x.actual_end, slip_days: x.finish_variance_days, progress_pct: p.progress_pct };
    if (showMoney) Object.assign(row, { currency: p.currency || null, budget: p.budget, spent: p.spent, spend_type: p.spend_type || null });
    return row;
  });
  const tasks = (v.tasks || []).map((t) => ({ project: keyOf.get(Number(t.project_id)) || null, id: t.id, wbs_code: t.wbs_code, name: t.name, owner: t.owner, status: t.status, start_date: t.start_date, end_date: t.end_date, baseline_start: t.baseline_start, baseline_end: t.baseline_end, progress_pct: t.progress_pct, depends_on: (t.depends_on || []).join(',') }));
  const milestones = (v.milestones || []).map((m) => ({ project: keyOf.get(Number(m.project_id)) || null, id: m.id, name: m.name, owner: m.owner || null, status: m.status, due_date: m.due_date, baseline_date: m.baseline_date, done_at: m.done_at }));
  const raid = (v.risks || []).map((r) => ({ project: keyOf.get(Number(r.project_id)) || null, id: r.id, kind: r.kind || 'risk', title: r.title, probability: r.probability, impact: r.impact, exposure: r.exposure, severity: r.severity, owner: r.owner, status: r.status, mitigation: r.mitigation }));
  const bl = (baselines || []).map((b) => ({ project: keyOf.get(Number(b.project_id)) || null, version: b.version, captured_at: b.captured_at, approved_by: b.approved_by_name, reason: b.reason, baseline_start: b.payload && b.payload.project ? b.payload.project.baseline_start : null, baseline_end: b.payload && b.payload.project ? b.payload.project.baseline_end : null, tasks: b.payload && b.payload.tasks ? b.payload.tasks.length : null }));
  const ex = (exceptions || []).map((e) => ({ kind: e.kind, project: e.project_key, owner: e.owner, since: e.since, message: e.message, key: e.key }));
  // B-08 — benefits: a money benefit's values only for a money reader (the row stays, its values are empty)
  const BEN = require('./portfolioBenefits');
  const ben = (v.benefits || []).map((b) => {
    const x = BEN.visibleBenefit(b, { money: showMoney, asOf: v.as_of || null });
    return { project: keyOf.get(Number(b.project_id)) || null, id: b.id, description: b.description, measure: b.measure || null, unit: b.unit || null, value_kind: b.value_kind || 'quantity',
      baseline_value: x.baseline_value ?? null, target_value: x.target_value ?? null, realised_value: x.realised_value ?? null, owner: b.owner || null, review_date: b.review_date || null,
      state: x.state, evidence_link: b.evidence_link || null, realised_by: b.realised_by_name || null, verified_by: b.verified_by_name || null, verified_at: b.verified_at || null };
  });
  return require('./tableExcel').buildWorkbook([{ name: 'Projects', rows: projects }, { name: 'Tasks', rows: tasks }, { name: 'Milestones', rows: milestones }, { name: 'RAID', rows: raid }, { name: 'Baselines', rows: bl }, { name: 'Exceptions', rows: ex }, { name: 'Benefits', rows: ben }]);
}

module.exports = { buildDeck, buildWorkbookBuffer, X, W, BOTTOM };
