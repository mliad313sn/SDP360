'use strict';
// P4 — migration 096 is additive and its manual rollback (db/postgres_rollback/096_connector_health_drop.sql) undoes
// it without touching infra_kpis rows; replaying the migration afterwards brings the objects back.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('096 adds provenance columns + connector_fix_tasks; rollback removes them and keeps the KPI rows', async () => {
  const rdb = require('../reports-db');
  const H = rdb.pgHandle();
  const cols = async () => (await H.prepare(`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'infra_kpis'`).all()).map((r) => r.column_name);
  const hasTable = async () => !!(await H.prepare(`SELECT to_regclass(quote_ident(current_schema()) || '.connector_fix_tasks') AS t`).get()).t;
  assert.ok((await cols()).includes('value_source'));
  assert.ok((await cols()).includes('value_data_through'));
  assert.ok(await hasTable());
  const site = ((await rdb.listSites()) || [])[0];
  const rep = await rdb.ensureReport(site.id, 2026, 30);
  await rdb.saveInfraKpis(rep.id, [{ service: 'WAN1', kpi: 'x', target: '98%', status_value: '99%', value_source: 'meraki', value_data_through: '2026-07-20' }]);
  // a duplicate OPEN task for the same connector × site × scope is refused by the partial unique index
  await H.prepare(`INSERT INTO connector_fix_tasks (connector, site_id, scope, cause, owner_role) VALUES ('meraki', ?, 'wan1', 'c', 'r')`).run(site.id);
  await assert.rejects(H.prepare(`INSERT INTO connector_fix_tasks (connector, site_id, scope, cause, owner_role) VALUES ('meraki', ?, 'wan1', 'c', 'r')`).run(site.id));

  await H.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'postgres_rollback', '096_connector_health_drop.sql'), 'utf8'));
  assert.ok(!(await cols()).includes('value_source'));
  assert.ok(!(await hasTable()));
  const n = await H.prepare('SELECT COUNT(*) AS n FROM infra_kpis WHERE report_id = ?').get(rep.id);
  assert.strictEqual(Number(n.n), 1, 'rollback keeps the KPI rows');

  await H.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'postgres', 'reports', '096_connector_health.sql'), 'utf8'));
  assert.ok((await cols()).includes('value_source'));
  assert.ok(await hasTable());
});
