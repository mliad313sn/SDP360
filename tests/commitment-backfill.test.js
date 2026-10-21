'use strict';
// 2027 Goal 02 — backfill: dry-run writes nothing, --apply is idempotent, sources are never touched,
// high / critical inspection actions come first, similar titles inside a site are reported as
// duplicates (never merged), unresolved sites are skipped; hub pairs / badge attach.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'cmt-bf-'));
const { test } = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { makeCommitmentStore } = require('../services/commitmentStore');
const { run } = require('../tools/pg/commitments-backfill');
const B = require('../services/commitmentBackfill');

const md = [
  { id: 11, description: 'Install Wi-Fi in the plant control room', status: 'open', site_code: 'HGO', owner_it: 'ana', target_date: '2026-11-01' },
  { id: 12, description: 'Old closed action', status: 'resolved', site_code: 'HGO' },
  { id: 13, description: 'Unknown site action', status: 'open', site_code: 'ZZZ' },
];
const insp = [
  { id: 21, description: 'Install wifi in plant control room', priority: 'Low', status: 'open', site_code: 'HGO' },
  { id: 22, description: 'Fire extinguisher missing in server room', priority: 'Critical', status: 'open', site_code: 'HGO', owner: 'bob', due_date: '2026-10-30' },
];
const rep = { 3: [{ uid: 'u-1', task: 'Replace UPS battery', status: 'open', owner: 'carl' }, { uid: 'u-2', task: 'merged', status: 'open', source: 'meetings' }] };
const deps = (store) => ({
  store,
  rdb: { listSiteModuleCodes: async () => [{ site_id: 3, code: 'HGO' }], listSites: async () => [{ id: 3 }], getSiteOpenReportActions: async (id) => ({ actions: rep[id] || [] }) },
  mdb: { listActions: async () => md }, idb: { listActions: async () => insp },
});

test('dry-run proposes, writes nothing; apply creates; replay creates nothing; sources untouched', async () => {
  const snap = JSON.stringify([md, insp, rep]);
  const store = makeCommitmentStore(new Database(':memory:')); await store.init();
  const dry = await run(deps(store));
  assert.equal(dry.mode, 'dry-run'); assert.equal(dry.created, 0); assert.equal((await store.list()).length, 0);
  assert.deepEqual(dry.proposals.map((p) => `${p.source.system}:${p.source.id}`), ['inspection:22', 'meetings:11', 'report:u-1', 'inspection:21']);
  assert.equal(dry.proposals[0].severity, 'critical'); assert.ok(dry.proposals[0].gaps.includes('treatment_plan'));
  assert.ok(dry.skipped.some((s) => s.key === 'meetings:13' && s.reason === 'site_unresolved'));
  assert.ok(dry.duplicates.some((d) => [d.a, d.b].sort().join() === 'inspection:21,meetings:11'), 'similar titles reported');
  assert.deepEqual(dry.per_site['3'], { proposed: 4, high_or_critical: 1, already_linked: 0, skipped: 0 });
  const ap = await run(deps(store), { apply: true });
  assert.equal(ap.created, 4); assert.equal((await store.list()).length, 4);
  assert.ok((await store.list()).every((c) => c.status === 'captured'), 'never auto-verified');
  const again = await run(deps(store), { apply: true });
  assert.equal(again.created, 0); assert.equal(again.totals.proposed, 0); assert.equal(again.per_site['3'].already_linked, 4);
  assert.equal(JSON.stringify([md, insp, rep]), snap, 'source rows unchanged');
});

test('hub pairs + attach: badge only on linked rows, awaiting_verification flagged', () => {
  const sa = { groups: { meetings: { items: [{ action_id: 11 }, { action_id: 12 }] }, inspection: { items: [{ action_id: 22 }] }, report: { items: [{ uid: 'u-1' }] }, issues: { items: [{ issue_id: 5 }] }, incubation: { items: [] } } };
  assert.deepEqual(B.hubPairs(sa).map((p) => p.system + ':' + p.id), ['meetings:11', 'meetings:12', 'inspection:22', 'report:u-1', 'meetings:issue:5']);
  B.attachCommitments(sa, new Map([['meetings:11', { id: 1, status: 'awaiting_verification' }], ['report:u-1', { id: 2, status: 'in_progress' }]]));
  assert.deepEqual(sa.groups.meetings.items[0].commitment, { id: 1, status: 'awaiting_verification', awaiting_verification: true });
  assert.equal(sa.groups.meetings.items[1].commitment, undefined);
  assert.equal(sa.groups.report.items[0].commitment.awaiting_verification, false);
  assert.equal(sa.commitments_linked, 2);
});

test('metrics: empty denominator is UNKNOWN (null), unverified technical completion never counts', () => {
  const M = require('../services/commitmentMetrics');
  assert.deepEqual(M.verifiedOnTime([]), { numerator: 0, denominator: 0, value: null, state: 'UNKNOWN' });
  const rows = [
    { status: 'awaiting_verification', due_date: '2026-10-01', technical_completed_at: '2026-09-01' },
    { status: 'verified_closed', due_date: '2026-10-01', verified_at: '2026-10-02T09:00:00Z', technical_completed_at: '2026-09-20' },
    { status: 'verified_closed', due_date: '2026-10-05', verified_at: '2026-10-05T23:00:00Z', technical_completed_at: '2026-10-01' },
  ];
  assert.equal(M.verifiedOnTime(rows).value, 50);
  assert.deepEqual(M.technicalVsVerified(rows), { technical: 3, verified: 2, pending_verification: 1, value: 66.7, state: 'measured' });
});
