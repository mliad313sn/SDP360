'use strict';
// A-27 — the portfolio deck (services/portfolioDeck.buildDeck): structural golden fingerprint on a fixed
// fictitious portfolio, canvas rules (x >= 0.3, x + w <= 13.03 in, safe bottom), BMP glyphs only, null → "—".
// Regenerate the golden ONLY after an intentional visual change:
//   GOLDEN_UPDATE=1 node --test tests/portfolio-deck.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const D = require('../services/portfolioDeck');
const XLSX = require('xlsx');

const GOLDEN = path.join(__dirname, '__golden__', 'portfolio-deck-fingerprint.json');
const EMU = 914400;

// same structural fingerprint as tests/pptx-monthly-golden.test.js
async function fingerprint(buf) {
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/(\d+)\.xml/)[1]) - Number(b.match(/(\d+)\.xml/)[1]));
  const slides = [];
  for (const n of names) {
    const xml = await zip.file(n).async('string');
    const texts = (xml.match(/<a:t>([\s\S]*?)<\/a:t>/g) || []).map((t) => t.replace(/<\/?a:t>/g, ''));
    slides.push({ shapes: (xml.match(/<p:sp>/g) || []).length, pics: (xml.match(/<p:pic>/g) || []).length, frames: (xml.match(/<p:graphicFrame>/g) || []).length, textCount: texts.length, texts, xml });
  }
  return { slideCount: slides.length, slides };
}
const strip = (fp) => ({ slideCount: fp.slideCount, slides: fp.slides.map(({ xml, ...s }) => s) });

// fictitious portfolio (no real names, figures or sites)
const view = {
  as_of: '2027-02-15T08:00:00.000Z',
  programmes: [{ id: 1, key: 'net', name: 'Network resilience' }, { id: 2, key: 'svc', name: 'Service catalogue' }],
  summary: [
    { programme: 'net', name: 'Network resilience', objectives: 2, projects: 2, late_projects: 1, high_risks: 1, weighted_evidence_pct: 64, budget: null, spent: null, currency: null, currency_mixed: true, budget_by_currency: { USD: { budget: 120000, spent: 30000, projects: 1 }, XOF: { budget: 5500000, spent: 0, projects: 1 } }, budget_unknown: 0 },
    { programme: 'svc', name: 'Service catalogue', objectives: 1, projects: 1, late_projects: 0, high_risks: 0, weighted_evidence_pct: null, budget: null, spent: null, currency: null, currency_mixed: false, budget_by_currency: {}, budget_unknown: 1 },
  ],
  projects: [
    { id: 1, key: 'NET-1', name: 'Second WAN link', stage: 'in_progress', status: 'active', owner: 'pmo', start_date: '2027-01-04', end_date: '2027-04-14', baseline_end: '2027-03-31', budget: 120000, spent: 30000, currency: 'USD' },
    { id: 2, key: 'NET-2', name: 'Radio upgrade', stage: 'approval', status: 'planned', owner: 'pmo', start_date: '2027-02-01', end_date: '2027-05-01', baseline_end: null, budget: 5500000, spent: 0, currency: 'XOF' },
    { id: 3, key: 'SVC-1', name: 'Request forms', stage: 'proposal', status: 'planned', owner: null, start_date: null, end_date: null, baseline_end: null, budget: null, spent: null, currency: null },
  ],
  risks: [
    { id: 1, project_id: 1, kind: 'risk', title: 'ISP lead time', status: 'open', probability: 3, impact: 3, exposure: 9, severity: 'high', owner: 'pmo', mitigation: 'second ISP quote' },
    { id: 2, project_id: 2, kind: 'issue', title: 'Licence pending', status: 'open', probability: 1, impact: 2, exposure: 2, severity: 'low', owner: null, mitigation: null },
    { id: 3, project_id: 1, kind: 'risk', title: 'closed one', status: 'closed', probability: 3, impact: 3, exposure: 9, severity: 'high' },
  ],
  tasks: [{ id: 10, project_id: 1, wbs_code: '1', name: 'Survey', owner: 'A', status: 'done', start_date: '2027-01-04', end_date: '2027-01-15', baseline_start: '2027-01-04', baseline_end: '2027-01-15', depends_on: [] }],
  milestones: [{ id: 5, project_id: 1, name: 'Go-live', due_date: '2027-04-14', baseline_date: '2027-03-31', status: 'planned' }],
};
const exceptions = [{ key: 'baseline_slip:project:1', kind: 'baseline_slip', project_key: 'NET-1', owner: 'pmo', since: '2027-03-31', message: 'NET-1 Second WAN link: finish 14 d later than its baseline (2027-03-31)' }];

test('deck fingerprint matches the golden (fictitious portfolio)', async () => {
  const fp = strip(await fingerprint(await D.buildDeck(view, { money: true, exceptions, asOf: view.as_of })));
  if (process.env.GOLDEN_UPDATE === '1' || !fs.existsSync(GOLDEN)) {
    if (process.env.GOLDEN_UPDATE !== '1') assert.fail('golden missing — run with GOLDEN_UPDATE=1 once, then review it');
    fs.mkdirSync(path.dirname(GOLDEN), { recursive: true }); fs.writeFileSync(GOLDEN, JSON.stringify(fp, null, 2) + '\n');
  }
  assert.deepStrictEqual(fp, JSON.parse(fs.readFileSync(GOLDEN, 'utf8')));
});

test('every shape lies inside x >= 0.3 and x + w <= 13.03 in, above the safe bottom; BMP glyphs only', async () => {
  const fp = await fingerprint(await D.buildDeck(view, { money: true, exceptions, asOf: view.as_of }));
  for (const [i, s] of fp.slides.entries()) {
    // the slide's group transform (<a:off 0,0/><a:ext 0,0/>) is not a shape
    const boxes = [...s.xml.matchAll(/<a:off x="(\d+)" y="(\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\/>/g)].filter((b) => !(b[3] === '0' && b[4] === '0'));
    assert.ok(boxes.length, 'slide ' + (i + 1) + ' has positioned shapes');
    for (const b of boxes) {
      const [x, y, w, h] = b.slice(1).map((n) => Number(n) / EMU);
      assert.ok(x >= 0.3 - 1e-6, `slide ${i + 1}: x ${x}`);
      assert.ok(x + w <= 13.03 + 1e-6, `slide ${i + 1}: right edge ${x + w}`);
      assert.ok(y + h <= 7.38 + 1e-6, `slide ${i + 1}: bottom ${y + h}`);
    }
    for (const t of s.texts) for (const ch of t) assert.ok(ch.codePointAt(0) <= 0xFFFF, `non-BMP glyph in "${t}"`);
  }
});

test('null renders as an em dash, never 0; without money no amount slide and no amount text', async () => {
  const fp = await fingerprint(await D.buildDeck(view, { money: false, exceptions: [], asOf: view.as_of }));
  assert.strictEqual(fp.slideCount, 5, 'no money slide for a reader without canSeeMoney');
  const sched = fp.slides[2].texts;
  const row = sched.indexOf('SVC-1'); assert.ok(row > 0);
  assert.deepStrictEqual(sched.slice(row + 3, row + 6), ['—', '—', '—'], 'unknown baseline / forecast / slip are "—"');
  const all = fp.slides.flatMap((s) => s.texts).join(' | ');
  assert.ok(!/120,000|5,500,000|USD|XOF/.test(all), 'no amount or currency in the restricted deck');
  assert.ok(fp.slides[0].texts.includes('Amounts are restricted for this reader (committee, admin or finance-viewer only).'));
});

test('workbook: eight sheets; money columns only when allowed; null stays empty, never 0', () => {
  const read = (buf) => XLSX.read(buf, { type: 'buffer' });
  const wb = read(D.buildWorkbookBuffer(view, { money: true, exceptions, baselines: [{ project_id: 1, version: 1, captured_at: '2027-01-04T00:00:00Z', approved_by_name: null, reason: null, payload: { project: { baseline_end: '2027-03-31' }, tasks: [{}] } }] }));
  assert.deepStrictEqual(wb.SheetNames, ['Projects', 'Tasks', 'Milestones', 'RAID', 'Baselines', 'Exceptions', 'Benefits', 'Capacity']);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets.Projects);
  assert.strictEqual(rows[0].budget, 120000);
  assert.strictEqual(rows[2].slip_days, undefined, 'unknown slip is an empty cell');
  const wb2 = read(D.buildWorkbookBuffer(view, { money: false }));
  const head = XLSX.utils.sheet_to_json(wb2.Sheets.Projects, { header: 1 })[0];
  assert.ok(!head.includes('budget') && !head.includes('spent'));
});

test('F-PRODUCT-02 workbook: Tasks carry allocation and effort (unknown = empty cell, never 0); Capacity sheet lists coverage, conflicts and possible conflicts, no money', () => {
  const t = (id, o) => ({ id, project_id: 1, wbs_code: String(id), name: 'T' + id, owner: 'Ana', status: 'todo', start_date: '2027-01-04', end_date: '2027-01-08', depends_on: [], ...o });
  const v = { ...view, tasks: [t(1, { allocation_pct: 70, effort_hours: 12 }), t(2, { allocation_pct: 50 }), t(3, { allocation_pct: null, effort_hours: null }), t(4, { owner: 'Bob', allocation_pct: 60 }), t(5, { owner: 'Bob' }), t(6, { owner: 'Cy', allocation_pct: 0 })] };
  const wb = XLSX.read(D.buildWorkbookBuffer(v, { money: true }), { type: 'buffer' });
  const head = XLSX.utils.sheet_to_json(wb.Sheets.Tasks, { header: 1 })[0];
  assert.ok(head.includes('allocation_pct') && head.includes('effort_hours'));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets.Tasks);
  assert.strictEqual(rows[0].allocation_pct, 70); assert.strictEqual(rows[0].effort_hours, 12);
  assert.strictEqual(rows[2].allocation_pct, undefined, 'unknown allocation is an empty cell, not 0 and not 100');
  assert.strictEqual(rows[2].effort_hours, undefined);
  assert.strictEqual(rows[4].allocation_pct, undefined, 'omitted allocation is empty too');
  assert.strictEqual(rows[5].allocation_pct, 0, 'an entered 0 % stays 0');
  const cap = XLSX.utils.sheet_to_json(wb.Sheets.Capacity);
  assert.deepStrictEqual(cap.map((r) => r.kind), ['coverage', 'conflict', 'possible conflict']);
  assert.match(cap[0].note, /4 of 6 open task\(s\) with a known allocation; 2 unknown/);
  assert.deepStrictEqual([cap[1].owner, cap[1].peak_pct, cap[1].task_ids], ['Ana', 120, '1,2']);
  assert.deepStrictEqual([cap[2].owner, cap[2].peak_pct, cap[2].task_ids], ['Bob', 60, '5']);
  const capHead = XLSX.utils.sheet_to_json(wb.Sheets.Capacity, { header: 1 })[0];
  for (const k of ['budget', 'spent', 'currency']) assert.ok(!capHead.includes(k), 'no money in the Capacity sheet');
  assert.doesNotMatch(JSON.stringify(cap), /USD|XOF|120000/);
});

test('F-PRODUCT-03 workbook Benefits sheet: class columns only with the switch; an estimate is labelled; no total row', () => {
  const ben = (id, o) => ({ id, project_id: 1, description: 'B' + id, value_kind: 'quantity', unit: 'h', realised_value: 5, realised_by: 2, evidence_link: 'https://example.test/e', ...o });
  const v = { ...view, benefits: [ben(1, { basis: 'estimated_avoidance', value_class: 'cost_avoidance_estimate', measured_from: '2027-01-01', measured_to: '2027-03-31', method_note: 'tickets avoided x mean handling time' }), ben(2, {}), ben(3, { basis: 'observed', value_class: 'productivity_time' })] };
  const off = XLSX.utils.sheet_to_json(XLSX.read(D.buildWorkbookBuffer(v, {}), { type: 'buffer' }).Sheets.Benefits, { header: 1 })[0];
  assert.ok(!off.includes('value_class') && !off.includes('measurement_class'), "switch off: today's columns");
  const wb = XLSX.read(D.buildWorkbookBuffer(v, { benefitClasses: true }), { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets.Benefits);
  assert.equal(rows.length, 3, 'one row per benefit, no total row');
  assert.deepStrictEqual([rows[0].value_class, rows[0].basis, rows[0].measurement_class, rows[0].evidence_level, rows[0].measured_from, rows[0].measured_to], ['cost_avoidance_estimate', 'estimated_avoidance', 'estimate', 'entered', '2027-01-01', '2027-03-31']);
  assert.strictEqual(rows[1].value_class, undefined, 'unclassified stays an empty cell');
  assert.strictEqual(rows[1].measurement_class, undefined);
  assert.equal(rows[2].measurement_class, 'observed'); assert.equal(rows[2].verification_independent, 'no');
});

test('R2-WB-03 workbook "Budget periods" sheet: absent without money or without periods (switch off); present = the store rows, currency per row, no total', () => {
  const read = (buf) => XLSX.read(buf, { type: 'buffer' });
  const periods = [
    { project_id: 1, period: '2027-01', currency: 'USD', kind: 'baseline', amount: 15000, reason: null },
    { project_id: 1, period: '2027-01', currency: 'USD', kind: 'actual', amount: 12000, reason: 'below baseline' },
    { project_id: 2, period: '2027-01', currency: 'XOF', kind: 'actual', amount: 1500000, reason: 'local' },
  ];
  assert.ok(!read(D.buildWorkbookBuffer(view, { money: true })).SheetNames.includes('Budget periods'), 'switch off: no periods given');
  assert.ok(!read(D.buildWorkbookBuffer(view, { money: false, budgetPeriods: periods })).SheetNames.includes('Budget periods'), 'no money reader: never');
  const wb = read(D.buildWorkbookBuffer(view, { money: true, budgetPeriods: periods }));
  assert.strictEqual(wb.SheetNames[wb.SheetNames.length - 1], 'Budget periods');
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Budget periods'], { defval: null });
  assert.deepStrictEqual(rows.map((r) => [r.project, r.period, r.currency, r.kind, r.amount, r.reason]), [['NET-1', '2027-01', 'USD', 'baseline', 15000, null], ['NET-1', '2027-01', 'USD', 'actual', 12000, 'below baseline'], ['NET-2', '2027-01', 'XOF', 'actual', 1500000, 'local']]);
  assert.ok(rows.every((r) => /^[A-Z]{3}$/.test(r.currency)), 'every amount carries its currency');
  assert.ok(!rows.some((r) => /total/i.test(String(r.kind) + String(r.project))), 'no cross-currency total row');
});
