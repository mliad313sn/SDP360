'use strict';
// DB schema boot smoke tests (audit 3.5) — PostgreSQL only (PO-08).
// tests/_pg-boot.mjs gives this file its own throwaway database, runs every module's initPg*
// and the migrator. We assert the key tables exist in that database and that no SQLite file
// is created anywhere in the data directory.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdp-db-smoke-'));
process.env.SDP_DATA_DIR = TMP;

async function tables() {
  const rows = await require('../reports-db').pgHandle().prepare(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()").all();
  return new Set(rows.map((r) => r.table_name));
}
async function assertHas(expected, label) {
  const t = await tables();
  for (const n of expected) assert.ok(t.has(n), `${label}: missing table ${n}`);
}

test('reports schema: core auth/report tables', async () => (await assertHas(['users', 'sites', 'sessions', 'user_roles', 'audit_log'], 'reports')));
test('tracker schema: v2 per-year tables', async () => (await assertHas(['tracker_years', 'tracker_pillars', 'tracker_activities', 'tracker_targets_v2', 'tracker_inputs_v2'], 'tracker')));
test('inspection schema: inspection + action-audit tables', async () => (await assertHas(['insp_inspections', 'insp_findings', 'insp_actions', 'insp_action_updates'], 'inspection')));
test('meetings schema: meeting + action-audit tables', async () => (await assertHas(['md_meetings', 'md_issues', 'md_actions', 'md_action_updates', 'md_departments'], 'meetings')));

test('action_items.uid exists and no row is left without one (boot backfill)', async () => {
  const H = require('../reports-db').pgHandle();
  const col = await H.prepare("SELECT 1 AS ok FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'action_items' AND column_name = 'uid'").get();
  assert.ok(col, 'uid column');
  assert.equal(Number((await H.prepare('SELECT COUNT(*) AS n FROM action_items WHERE uid IS NULL').get()).n), 0);
});

test('default sites are seeded in PostgreSQL', async () => {
  const sites = await require('../reports-db').listSites();
  for (const n of ['Sabodala', 'MANA', 'Hounde', 'Exploration']) assert.ok(sites.some((s) => s.name === n), n);
});

test('no SQLite file is created in the data directory', async () => {
  await require('../tracker-db').loadTracker();
  await require('../meetings-db').loadLookups();
  await require('../inspection-db').loadLookups();
  const dbFiles = fs.readdirSync(TMP).filter((f) => /\.db$/.test(f));
  assert.deepStrictEqual(dbFiles, []);
});
