'use strict';
// G-17 — commitments backfill dry-run on PostgreSQL with the REAL readers (meetings-db, inspection-db,
// reports-db), not stubs: the dry-run writes nothing (commitment tables and source tables byte-identical),
// sites resolve through site_module_codes, closed source rows are not proposed, the readers are paged
// (listActions() defaults to LIMIT 1000), the Markdown report carries counts and no titles, and --apply
// stays idempotent.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'cmt-bf-pg-'));
const { test, before } = require('node:test');
const assert = require('node:assert');
const { run, pagedAll, formatMarkdown } = require('../tools/pg/commitments-backfill');

let rdb, mdb, idb, store, hounde, mana;
const CMT = ['commitments', 'commitment_source_links', 'commitment_events', 'evidence_items', 'closure_verifications'];
const SRC = ['md_actions', 'md_issues', 'md_meetings', 'insp_actions', 'insp_inspections', 'action_items', 'weekly_reports'];

async function dump(H, tables) {
  const out = {};
  for (const t of tables) out[t] = JSON.stringify(await H.prepare(`SELECT * FROM ${t} ORDER BY 1`).all());
  return out;
}

before(async () => {
  rdb = require('../reports-db'); mdb = require('../meetings-db'); idb = require('../inspection-db');
  await rdb.initPgReports(); await mdb.initPgMeetings(); await idb.initPgInspection();
  const sites = await rdb.listSites({ includeInactive: true });
  hounde = sites.find((s) => /hounde/i.test(s.name)).id; mana = sites.find((s) => /^mana$/i.test(s.name)).id;
  await mdb.saveMeeting({ header: { site_code: 'HGO', department: 'mining', meeting_date: '2026-09-05', status: 'draft' },
    actions: [1, 2, 3, 4, 5].map((n) => ({ description: `Hounde meeting action ${n}`, status: 'open', owner_it: n % 2 ? 'ana' : '', target_date: '2026-11-0' + n }))
      .concat([{ description: 'Hounde closed action', status: 'resolved', owner_it: 'ana' }]) }, null, null);
  await mdb.saveMeeting({ header: { site_code: 'MGO', department: 'plant', meeting_date: '2026-09-06', status: 'draft' },
    actions: [{ description: 'Mana meeting action', status: 'open', owner_it: 'bob' }] }, null, null);
  await idb.saveInspection({ meta: { f_site: 'Hounde (HGO)', f_date: '2026-09-07', f_area: 'Server room' }, items: {},
    actions: [{ desc: 'Fire extinguisher missing', owner: '', due: '', priority: 'Critical' }, { desc: 'Label the patch panel', owner: 'carl', due: '2026-12-01', priority: 'Low' }] }, null);
  const rep = await rdb.ensureReport(mana, 2026, 38);
  await rdb.saveActionItems(rep.id, [{ task: 'Replace UPS battery', status: 'open', owner: 'dan', department: 'IT' }, { task: 'Done thing', status: 'closed', owner: 'dan', department: 'IT' }]);
  store = require('../routes/commitments').createStore(rdb); await store.init();
});

test('pagedAll reads every page and stops on the short one', async () => {
  const rows = Array.from({ length: 7 }, (_, i) => i);
  const calls = [];
  const got = await pagedAll(async ({ limit, offset }) => { calls.push(offset); return rows.slice(offset, offset + limit); }, 3);
  assert.deepEqual(got, rows); assert.deepEqual(calls, [0, 3, 6]);
  // the defect it fixes: a reader that caps at its default limit loses rows when called once
  const capped = async (o = {}) => rows.slice(o.offset || 0, (o.offset || 0) + (o.limit || 4));
  assert.equal((await capped({})).length, 4);
  assert.equal((await pagedAll(capped, 4)).length, 7);
});

test('dry-run on PostgreSQL with the real readers writes nothing and proposes the open rows only', async () => {
  const H = rdb.pgHandle();
  const before = await dump(H, [...CMT, ...SRC]);
  const r = await run({ rdb, mdb, idb, store }, { pageSize: 2 });
  assert.deepEqual(await dump(H, [...CMT, ...SRC]), before, 'no table changed');
  assert.equal(r.mode, 'dry-run'); assert.equal(r.created, 0);
  assert.deepEqual(r.read, { md_actions: 7, insp_actions: 2, report_actions: 1 }, 'paged reads see every row (closed report follow-ups are filtered by the reader)');
  const keys = r.proposals.map((p) => p.source.system);
  assert.equal(keys.filter((k) => k === 'meetings').length, 6, '5 Hounde + 1 Mana open meeting actions, the resolved one excluded');
  assert.equal(keys.filter((k) => k === 'inspection').length, 2);
  assert.equal(keys.filter((k) => k === 'report').length, 1);
  assert.equal(r.proposals[0].severity, 'critical', 'critical inspection finding first');
  assert.deepEqual(r.proposals[0].gaps.sort(), ['accountable_owner', 'due_date', 'treatment_plan']);
  assert.equal(r.per_site[String(hounde)].proposed, 7); assert.equal(r.per_site[String(mana)].proposed, 2);
  assert.ok(r.proposals.every((p) => Number.isInteger(p.site_id)), 'every site resolved through site_module_codes');

  const md = formatMarkdown(r, { siteNames: { [hounde]: 'Hounde', [mana]: 'MANA' }, generatedAt: '2026-10-28T00:00:00Z' });
  assert.match(md, /# Commitments backfill — dry-run/);
  assert.match(md, /\| md_actions \| 7 \|/);
  assert.match(md, /\| Hounde \| 7 \| 1 \| 0 \| 0 \|/);
  assert.match(md, /\| accountable_owner \| \d+ \|/);
  assert.ok(!/Fire extinguisher|Replace UPS|Hounde meeting action/.test(md), 'no titles in the shareable summary');
});

test('apply creates captured commitments once; a second apply creates nothing; sources unchanged', async () => {
  const H = rdb.pgHandle();
  const src = await dump(H, SRC);
  const a = await run({ rdb, mdb, idb, store }, { apply: true, pageSize: 2 });
  assert.equal(a.created, 9);
  const b = await run({ rdb, mdb, idb, store }, { apply: true, pageSize: 2 });
  assert.equal(b.created, 0); assert.equal(b.totals.proposed, 0);
  assert.equal(b.per_site[String(hounde)].already_linked, 7);
  assert.ok((await store.list()).every((c) => c.status === 'captured'));
  assert.deepEqual(await dump(H, SRC), src, 'source records never edited');
});
