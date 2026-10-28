'use strict';
// Step 8 — governance store on PostgreSQL (migration reports/018): cadence/session/decision/RFI/portfolio parity with the sqlite suite.
process.env.REPORTS_BACKEND = 'postgres';
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'govpg-'));
process.env.DASH_USER = process.env.DASH_USER || 'pgtest-admin'; process.env.DASH_PASS = process.env.DASH_PASS || 'pgtest-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');

test('pg: governance store parity (cadence → session → stamps → decision refs → RFI score → portfolio cascade)', async (t) => {
  const ctx = await provisionTestDb(); if (!ctx) return t.skip('no pg');
  process.env.PG_URL = ctx.url;
  const rdb = require('../reports-db'); await rdb.initPgReports();
  await require('../db/migrate').migrateAtBoot({ log: () => {} });
  const { makeGovernanceStore } = require('../services/governanceStore');
  const s = makeGovernanceStore({ prepare: (sql) => rdb.pgHandle().prepare(sql) }, { isPg: true });
  try {
    await s.init();
    const c = await s.saveCadence({ key: 'pg-c', name: 'C', kind: 'site_weekly', site_id: 1, participants: ['x@y.z'] }); assert.ok(c.id > 0); assert.deepEqual(c.participants, ['x@y.z']);
    assert.equal((await s.saveCadence({ key: 'pg-c', name: 'C2' })).id, c.id);
    const ses = await s.createSession({ cadenceId: c.id, agenda: { items: [{ id: 's1-kpis' }] }, user: { id: 1 } }); assert.equal(ses.items.length, 1);
    assert.ok((await s.stampItem(ses.id, 's1-kpis', 'started_at')).items[0].started_at);
    const d1 = await s.addDecision({ title: 'A', session_id: ses.id }); const d2 = await s.addDecision({ title: 'B', session_id: ses.id });
    assert.equal(d1.ref.slice(0, 4), 'DEC-'); assert.equal(Number(d2.ref.split('-').pop()), Number(d1.ref.split('-').pop()) + 1);
    assert.equal((await s.listDecisions({ sessionId: ses.id })).length, 2);
    const a = await s.addSessionAction(ses.id, { title: 'act' }); await s.setSessionActionStatus(a.id, 'done', ses.id); assert.ok((await s.sessionActions(ses.id))[0].closed_at);
    const r = await s.submitRfi({ kind: 'metric', title: 'T', problem: 'P', impact: 3, effort: 1, data_risk: 1 }); assert.equal(r.score, 7);
    assert.equal((await s.triageRfi(r.id, { status: 'accepted', effort: 3 })).score, 5);
    const pr = await s.upsertPortfolio('programme', { key: 'pgp', name: 'P' }); const ob = await s.upsertPortfolio('objective', { programme_id: pr, key: 'pgo', name: 'O', weight: 2 });
    const pj = await s.upsertPortfolio('project', { objective_id: ob, key: 'pgj', name: 'J', depends_on: [] }); await s.upsertPortfolio('risk', { project_id: pj, title: 'R' });
    let pf = await s.portfolio(); assert.equal(pf.risks.length, 1); assert.equal(Number(pf.objectives[0].weight), 2);
    await s.removePortfolio('programme', pr); pf = await s.portfolio(); assert.equal(pf.projects.length + pf.risks.length, 0, 'cascade on pg');
    await s.removeCadence(c.id); assert.equal((await s.listSessions({ cadenceId: c.id })).length, 0, 'sessions cascade with the cadence');
  } finally { await dropTestDb(ctx); }
});
