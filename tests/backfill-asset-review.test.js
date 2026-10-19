'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { main, needsBackfill } = require('../tools/reports/backfill-asset-review');

test('needsBackfill: missing row, null counts, pre-no_tag counts → yes; frozen or non-applicable → no', () => {
  assert.strictEqual(needsBackfill(null), true);
  assert.strictEqual(needsBackfill({ applicable: true, counts: null }), true);
  assert.strictEqual(needsBackfill({ applicable: true, counts: { new: 1, unassigned: 2 } }), true);
  assert.strictEqual(needsBackfill({ applicable: true, counts: { no_tag: 3 } }), false);
  assert.strictEqual(needsBackfill({ applicable: false, counts: null }), false);
});

function fakes() {
  const saved = [];
  const reportsDb = {
    listSiteModuleCodes: async () => [{ site_id: 1, code: 'HGO' }, { site_id: 2, code: 'MGO' }, { site_id: null, code: 'X' }],
    listReports: async (id) => id === 1
      ? [{ id: 10, status: 'submitted', start_date: '2026-09-06', end_date: '2026-09-12', week_label: 'W36 2026' },
         { id: 11, status: 'submitted', start_date: '2026-09-13', end_date: '2026-09-19', week_label: 'W37 2026' },
         { id: 12, status: 'draft',     start_date: '2026-09-20', end_date: '2026-09-26', week_label: 'W38 2026' }]
      : [{ id: 20, status: 'submitted', start_date: '2026-09-13', end_date: '2026-09-19', week_label: 'W37 2026' }],
    getReportAssetReview: async (id) => (id === 20 ? { applicable: true, counts: { no_tag: 1 } } : null),
    saveReportAssetReview: async (id, patch) => { saved.push({ id, patch }); },
  };
  const assetsDb = {
    getAssetLookups: async () => ({ sites: ['HOUNDE', 'MANA'] }),
    getSiteAssetFollowups: async () => ({ counts: { new: 0, no_tag: 32, unassigned: 303, no_cost: 298, no_date: 187 } }),
  };
  return { saved, reportsDb, assetsDb };
}

test('dry-run writes nothing; --apply freezes only the latest submitted report lacking counts', async () => {
  const f = fakes();
  const dry = await main({ reportsDb: f.reportsDb, assetsDb: f.assetsDb, log: () => {} });
  assert.strictEqual(f.saved.length, 0);
  assert.deepStrictEqual(dry.map(r => [r.code, r.action]), [['HGO', 'would freeze'], ['MGO', 'skip']]);
  const g = fakes();
  await main({ reportsDb: g.reportsDb, assetsDb: g.assetsDb, apply: true, log: () => {} });
  assert.deepStrictEqual(g.saved.map(s => s.id), [11], 'W37 (latest submitted), never the draft W38 nor MGO already frozen');
  assert.strictEqual(g.saved[0].patch.counts.no_tag, 32);
  assert.ok(!('handled_note' in g.saved[0].patch), 'notes never written');
});
