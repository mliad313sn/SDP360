'use strict';
// E-P08 (audit P-08, catalogue R16) — annual planning DRAFT pack (services/annualPlanPack.js, pure). Fictitious data.
const test = require('node:test');
const assert = require('node:assert');
const XLSX = require('xlsx');
const AP = require('../services/annualPlanPack');
const C = require('../services/reportCatalogue');

const view = { projects: [
  { id: 1, key: 'P-1', name: 'WAN', status: 'active', start_date: '2026-10-01', end_date: '2027-03-31', site_id: 3, budget: 1000, spent: 200, currency: 'USD' },
  { id: 2, key: 'P-2', name: 'Radio', status: 'planned', start_date: '2027-02-01', end_date: '2027-06-30', budget: 5000000, spent: 0, currency: 'XOF' },
  { id: 3, key: 'P-3', name: 'Old', status: 'done', start_date: '2025-01-01', end_date: '2025-12-31', budget: 9, currency: 'USD' },
  { id: 4, key: 'P-4', name: 'Undated', status: 'planned', budget: null, currency: 'USD' },
  { id: 5, key: 'P-5', name: 'USD two', status: 'planned', start_date: '2027-05-01', end_date: '2027-08-01', budget: 500, spent: 50, currency: 'USD' },
] };
const capacity = { sites: [{ site: '3', over_weeks: 2, unknown_tasks: 1, weeks: [{ total_pct: 130 }, { total_pct: null }] }] };
const rfis = [{ ref: 'RFI-1', title: 'Need', status: 'triaged', score: 5 }, { ref: 'RFI-2', title: 'Done', status: 'delivered', score: 7 }];

test('no cross-currency sum: one budget row per currency, the envelope is null (UNKNOWN in the sheet)', () => {
  const p = AP.buildAnnualPack({ year: 2027, view, money: true, capacity, rfis, asOf: '2026-11-12' });
  assert.deepEqual(p.budget.map((b) => [b.currency, b.projects, b.budget, b.spent]), [['USD', 2, 1500, 250], ['XOF', 1, 5000000, 0]]);
  assert.ok(p.budget.every((b) => b.envelope === null)); assert.deepEqual(p.envelope, [null, null]);
  const sheet = p.sheets.find((s) => s.name === 'Budget').rows;
  assert.deepEqual(sheet[2], ['USD', 2, 1500, 250, 'UNKNOWN']);
  assert.ok(!sheet.some((r) => r.includes(5001500)), 'never USD + XOF');
  assert.deepEqual(p.sheets.find((s) => s.name === 'Projects').rows.slice(2).map((r) => r[0]), ['P-1', 'P-2', 'P-4', 'P-5'], 'P-3 (2025) out, undated open in');
});

test('every sheet is labelled DRAFT — not approved, also in the XLSX; RFI scores are provisional', () => {
  const p = AP.buildAnnualPack({ year: 2027, view, money: true, capacity, rfis, asOf: '2026-11-12' });
  assert.ok(p.sheets.every((s) => s.rows[0][0] === AP.DRAFT));
  const wb = XLSX.read(AP.toWorkbookBuffer(p), { type: 'buffer' });
  assert.deepEqual(wb.SheetNames, ['About', 'Projects', 'Budget', 'Capacity', 'RFI (provisional)']);
  for (const n of wb.SheetNames) assert.equal(wb.Sheets[n].A1.v, 'DRAFT — not approved', n);
  const rfi = p.sheets.find((s) => s.name === 'RFI (provisional)').rows;
  assert.deepEqual(rfi.slice(2), [['RFI-1', 'Need', 'triaged', 5]]); assert.match(rfi[1][3], /Provisional/);
  assert.deepEqual(p.sheets.find((s) => s.name === 'Capacity').rows[2], ['3', 2, 130, 1]);
});

test('money stripped for a reader without money rights: no amount anywhere in the pack', () => {
  const stripped = { projects: view.projects.map((x) => ({ ...x, budget: undefined, spent: undefined })) };
  const p = AP.buildAnnualPack({ year: 2027, view: stripped, money: false, capacity, rfis: [], rfiVisible: false, asOf: '2026-11-12' });
  assert.equal(p.budget, null);
  const all = JSON.stringify(p.sheets);
  for (const amt of ['1000', '5000000', '1500', 'Spent', 'Currency']) assert.ok(!all.includes(amt), amt);
  assert.match(all, /restricted/); assert.match(all, /read by the committee/);
});

test('catalogue: R16 is partial, cites the pack and its switch (default 0)', () => {
  const r16 = C.REPORTS.find((x) => x.id === 'R16');
  assert.equal(r16.status, 'partial'); assert.ok(r16.surfaces.includes('services/annualPlanPack.js'));
  assert.deepEqual(r16.gates, [['ppm_annual_pack_enabled', '0']]);
});
