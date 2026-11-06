'use strict';
// E-I04 — Business Incubation session → RFI (one per session) + lineage session → RFI → project.
// Store: idempotent, PV refused, unique per session. Routes: 404 while incubation_rfi_link_enabled = '0',
// editor of the session's site only (other site 403, viewer 403), admin tier anywhere.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'inc-rfi-'));
process.env.DASH_USER = process.env.DASH_USER || 'incrfi-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'incrfi-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'incrfi-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, mdb, cfg, admin, editor, otherEditor, viewer, incId, pvId, hgoSite;

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); mdb = require('../meetings-db'); cfg = require('../services/reportConfig');
  const sites = await rdb.listSites({ includeInactive: true });
  const hounde = sites.find((s) => /hounde/i.test(s.name)).id; const mana = sites.find((s) => /mana/i.test(s.name)).id;
  hgoSite = (await rdb.getSiteIdByModuleCode('meetings', 'HGO')).site_id;
  const mk = async (u, role, roles, site) => { try { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', role, roles, site_id: site }); } catch {} return (await rdb.login(u, u + 'pass1234')).token; };
  admin = await mk('ir_admin', 'admin', ['admin']);
  editor = await mk('ir_editor', 'editor', ['editor'], hounde);
  otherEditor = await mk('ir_other', 'editor', ['editor'], mana);
  viewer = await mk('ir_viewer', 'viewer', ['viewer'], hounde);
  incId = (await mdb.saveMeeting({ header: { site_code: 'HGO', department: 'mining', meeting_date: '2026-09-07', intake_source: 'business_incubation', status: 'draft' } }, null, null)).id;
  await mdb.setMeetingIncubation(incId, { business_description: 'Drill planning runs on paper sheets.' });
  pvId = (await mdb.saveMeeting({ header: { site_code: 'HGO', department: 'mining', meeting_date: '2026-09-08', intake_source: 'dept_meeting', status: 'draft' } }, null, null)).id;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const H = (t) => ({ headers: t ? { 'x-report-token': t } : {} });
const get = (p, t) => fetch(base + p, H(t));
const post = (p, t) => fetch(base + p, { method: 'POST', ...H(t) });

test('switch 0 (default): every E-I04 route 404s', async () => {
  assert.equal(cfg.DEFAULTS.incubation_rfi_link_enabled, '0');
  assert.equal((await get(`/api/governance/rfi/from-meeting/${incId}`, admin)).status, 404);
  assert.equal((await post(`/api/governance/rfi/from-meeting/${incId}`, admin)).status, 404);
  assert.equal((await get('/api/governance/rfi/1/lineage', admin)).status, 404);
});

test('meetings helper reads the session through meetings-db (incubation flag, description)', async () => {
  const s = await mdb.getIncubationSource(incId);
  assert.equal(s.is_incubation, true); assert.match(s.business_description, /paper sheets/);
  assert.equal((await mdb.getIncubationSource(pvId)).is_incubation, false);
  assert.equal(await mdb.getIncubationSource(999999), null);
});

test('switch 1: editor of the site raises ONE RFI (idempotent); PV refused; other site / viewer 403; lineage', async () => {
  await cfg.setConfig(rdb.db, { incubation_rfi_link_enabled: '1' }, 'test');
  try {
    assert.equal((await post(`/api/governance/rfi/from-meeting/${incId}`, otherEditor)).status, 403);
    assert.equal((await post(`/api/governance/rfi/from-meeting/${incId}`, viewer)).status, 403);
    assert.equal((await post(`/api/governance/rfi/from-meeting/${pvId}`, editor)).status, 400, 'a PV never raises an RFI');
    assert.equal((await post('/api/governance/rfi/from-meeting/999999', editor)).status, 404);
    const before = await (await get(`/api/governance/rfi/from-meeting/${incId}`, editor)).json();
    assert.equal(before.rfi, null); assert.equal(before.is_incubation, true);
    const a = await (await post(`/api/governance/rfi/from-meeting/${incId}`, editor)).json();
    assert.equal(a.ok, true); assert.equal(a.created, true); assert.match(a.rfi.ref, /^RFI-\d{4}-\d{3}$/);
    assert.equal(Number(a.rfi.source_meeting_id), incId); assert.equal(a.rfi.site_id, Number(hgoSite)); assert.equal(a.rfi.status, 'submitted');
    assert.match(a.rfi.problem, /paper sheets/);
    const b = await (await post(`/api/governance/rfi/from-meeting/${incId}`, admin)).json();
    assert.equal(b.created, false); assert.equal(b.rfi.id, a.rfi.id, 'second call returns the same RFI');
    const n = (await rdb.db.prepare('SELECT COUNT(*)::int AS n FROM rfi_requests WHERE source_meeting_id = ?').get(incId)).n;
    assert.equal(n, 1);
    assert.deepEqual(a.lineage, { meeting_id: incId, rfi: { id: a.rfi.id, ref: a.rfi.ref, status: 'submitted' }, project: null }, 'no project auto-created');
    const l = await (await get(`/api/governance/rfi/${a.rfi.id}/lineage`, editor)).json();
    assert.equal(l.lineage.meeting_id, incId);
    assert.equal((await get(`/api/governance/rfi/${a.rfi.id}/lineage`, otherEditor)).status, 403);
    const ev = (await rdb.db.prepare("SELECT action FROM ppm_events WHERE entity='rfi' AND entity_id=?").all(a.rfi.id)).map((r) => r.action);
    assert.deepEqual(ev, ['from_meeting']);
  } finally { await cfg.setConfig(rdb.db, { incubation_rfi_link_enabled: '0' }, 'test'); }
});

test('store: unique per session survives a concurrent second insert (unique index)', async () => {
  const { makeGovernanceStore } = require('../services/governanceStore');
  const s = makeGovernanceStore({ prepare: (sql) => rdb.pgHandle().prepare(sql) }, { isPg: true });
  const src = { id: 777001, is_incubation: true, reference: 'X_INC_1', department: 'hr', meeting_date: '2026-09-01' };
  const [x, y] = await Promise.all([s.rfiFromMeeting(src, { siteId: 1 }), s.rfiFromMeeting(src, { siteId: 1 })]);
  assert.equal(x.rfi.id, y.rfi.id);
  assert.equal([x.created, y.created].filter(Boolean).length, 1);
  await assert.rejects(s.rfiFromMeeting({ id: 777002, is_incubation: false }), (e) => e.status === 400);
  await assert.rejects(s.rfiFromMeeting(null), (e) => e.status === 404);
});
