'use strict';
// Step 8 — cockpit and portfolio stores on PostgreSQL (db/postgres/reports/020_cockpit_portfolio.sql applied by the
// migrator): sessions with frozen agenda, items, decisions, actions, requests, portfolio nodes.
process.env.REPORTS_BACKEND = 'postgres';
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'pgck-'));
process.env.DASH_USER = process.env.DASH_USER || 'pgtest-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'pgtest-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');

test('pg: cockpit sessions, decisions, actions, requests; portfolio nodes', async (t) => {
  const ctx = await provisionTestDb(); if (!ctx) return t.skip('no pg');
  process.env.PG_URL = ctx.url;
  const rdb = require('../reports-db');
  await rdb.initPgReports();
  const ck = require('../services/cockpit/store');
  const pf = require('../services/portfolio/store');
  try {
    const def = { id: 'pg-cad', title: 'Hebdo', agenda: [{ id: 's1', kind: 'topic', title: 'Divers' }] };
    await ck.cadences.saveDraft('pg-cad', def, 'chair');
    assert.equal(await ck.cadences.publishDefinition('pg-cad', def, 'chair'), 1);
    const s = await ck.createSession({ cadence_id: 'pg-cad', cadence_version: 1, held_on: '2026-10-20' }, 'chair');
    assert.equal(s.status, 'planned');
    const live = await ck.startSession(s.id, { sections: [{ kind: 'topic', title: 'Divers' }, { kind: 'followup', title: 'Suivi' }] });
    assert.equal(live.status, 'live'); assert.equal(live.agenda.sections.length, 2);
    let items = await ck.startItem(s.id, 1);
    assert.ok(items[0].started_at && !items[0].ended_at);
    items = await ck.startItem(s.id, 2);
    assert.ok(items[0].ended_at, 'opening point 2 closes point 1');
    await ck.setNotes(s.id, 2, 'note');
    await ck.addDecision({ session_id: s.id, item_seq: 2, text: 'Oui' }, 'chair');
    const a = await ck.addAction({ session_id: s.id, cadence_id: 'pg-cad', item_seq: 2, title: 'Faire', due_date: '2026-10-27', source_kind: 'metric', source_ref: 'helpdesk.backlog' }, 'chair');
    assert.equal((await ck.updateAction(a.id, { status: 'done' }, 'owner')).status, 'done');
    assert.equal((await ck.listActions({ cadence_id: 'pg-cad', status: 'done' })).length, 1);
    const closed = await ck.closeSession(s.id, '<p>pv</p>');
    assert.equal(closed.status, 'closed'); assert.equal(await ck.getMinutes(s.id), '<p>pv</p>');
    assert.equal((await ck.decisions({ session_id: s.id })).length, 1);
    const r = await ck.addRfi({ title: 'Q' }, 'req');
    await ck.triageRfi(r.id, { status: 'scored', value: 4, urgency: 5, effort: 2, score: 10 }, 'com');
    const did = await ck.addDecision({ rfi_id: r.id, text: 'Accordé', source_kind: 'rfi', source_ref: r.id }, 'com');
    const dec = await ck.decideRfi(r.id, did, 'decided');
    assert.equal(dec.status, 'decided'); assert.equal(Number(dec.score), 10);

    const v = await pf.validate({ kind: 'programme', title: 'P' });
    const p = await pf.save(null, v.node, 'pm');
    const v2 = await pf.validate({ kind: 'objective', title: 'O', parent_id: p.id, due_date: '2026-12-31', depends_on: [], incidents: ['INC-1'] });
    const o = await pf.save(null, v2.node, 'pm');
    assert.deepStrictEqual(o.incidents, ['INC-1']); assert.equal(o.baseline_due, '2026-12-31');
    assert.equal((await pf.remove(p.id)).ok, false, 'has children');
    assert.equal((await pf.list()).length, 2);
    await pf.save('RM-1', (await pf.validate({ kind: 'programme', title: 'Roadmap' })).node, 'sa', { create: true });
    assert.ok(await pf.get('RM-1'), 'create with a stable id');
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});
