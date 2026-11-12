'use strict';
// R2-WB-06 over HTTP, fictitious data only: '0' = the migration API exactly as before (no duplicates report, new routes
// 404); '1' = dry run reports duplicates and writes nothing, apply refused on duplicates unless skip_duplicates=1, the
// apply + archive + rollback are recorded, rollback is a soft delete that frees the keys so a new publication works.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'rm-pub-'));
process.env.DASH_USER = process.env.DASH_USER || 'rmpub-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'rmpub-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'rmpub-key';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.AI_PROVIDER = 'off';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, cfg, T = {}, ID = {};

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); cfg = require('../services/reportConfig');
  const mk = async (u, roles) => { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles }); ID[u] = Number(((await rdb.listUsers()) || []).find((x) => x.username === u).id); return (await rdb.login(u, u + 'pass1234')).token; };
  T.sup = await mk('rp_super', ['super_admin']);
  T.admin = await mk('rp_admin', ['admin']);
  await rdb.getRoadmap(ID.rp_super); // lazy-seeds the 4 objectives
  for (const label of ['Fictitious form A', 'fictitious  FORM a', 'Fictitious form B']) await rdb.addRoadmapDeliverable(ID.rp_super, { obj_key: 'catalogue', label, status: 'todo' });
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const send = async (m, p, t, body) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'x-report-token': t }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, j }; };
const sw = (patch) => cfg.setConfig(rdb.db, patch, 'smoke');
const progCount = async () => Number((await rdb.db.prepare("SELECT COUNT(*) AS n FROM portfolio_programmes WHERE key LIKE 'itsm-roadmap%'").get()).n);

test('off: the migration dry run is today’s (no duplicates key) and the publication routes do not exist', async () => {
  await sw({ roadmap_publication_enabled: '0' });
  const d = await send('POST', '/api/governance/roadmap-migration', T.sup, {});
  assert.equal(d.status, 200); assert.equal(d.j.dry_run, true); assert.ok(!('duplicates' in d.j));
  for (const [m, p] of [['GET', '/api/governance/roadmap-publication'], ['POST', '/api/governance/roadmap-migration/rollback'], ['POST', '/api/governance/roadmap-migration/archive']]) assert.equal((await send(m, p, T.sup, m === 'POST' ? {} : undefined)).status, 404, p);
  assert.equal((await send('GET', '/api/governance/ppm/features', T.sup)).j.roadmap_publication, false);
});

test('on: dry run reports duplicates and writes nothing; apply refused, then published with skip; archive is explicit; rollback soft-deletes and frees the keys', async () => {
  await sw({ roadmap_publication_enabled: '1', soft_delete_enabled: '1' });
  try {
    assert.equal((await send('GET', '/api/governance/roadmap-publication', T.admin)).status, 403, 'super_admin only');
    const d = await send('POST', '/api/governance/roadmap-migration', T.sup, {});
    assert.equal(d.j.dry_run, true); assert.equal(d.j.duplicates.count, 1); assert.equal(d.j.duplicates.deliverables[0].name, 'fictitious  FORM a');
    assert.equal(await progCount(), 0, 'the dry run wrote nothing');
    const refused = await send('POST', '/api/governance/roadmap-migration?apply=1', T.sup, {});
    assert.equal(refused.status, 409); assert.equal(refused.j.code, 'DUPLICATES'); assert.equal(await progCount(), 0);
    const ok = await send('POST', '/api/governance/roadmap-migration?apply=1&skip_duplicates=1', T.sup, {});
    assert.equal(ok.status, 200, JSON.stringify(ok.j)); const pid = ok.j.programme_id;
    const dels = (await rdb.db.prepare("SELECT d.name FROM portfolio_deliverables d JOIN portfolio_projects p ON p.id=d.project_id WHERE p.key LIKE 'itsm-roadmap-%' AND p.deleted_at IS NULL").all()).map((x) => x.name);
    assert.equal(dels.filter((n) => /^fictitious\s+form a$/i.test(n.replace(/\s+/g, ' '))).length, 1, 'the repeated name was left out');
    assert.ok(dels.includes('Fictitious form A') && dels.includes('Fictitious form B'));
    const again = await send('POST', '/api/governance/roadmap-migration?apply=1', T.sup, {});
    assert.equal(again.status, 409); assert.ok(again.j.error, 'typed body with an error field');
    let st = (await send('GET', '/api/governance/roadmap-publication', T.sup)).j;
    assert.equal(st.migrated, true); assert.equal(st.read_only, false, 'publishing never switches Roadmap Manager to read-only');
    assert.equal((await send('POST', '/api/governance/roadmap-migration/archive', T.sup, {})).status, 400, 'archive needs an explicit confirm');
    const ar = await send('POST', '/api/governance/roadmap-migration/archive', T.sup, { confirm: true });
    assert.equal(ar.status, 200); assert.equal(ar.j.read_only, true); assert.ok(['in_parity', 'drift'].includes(ar.j.parity));
    st = (await send('GET', '/api/governance/roadmap-publication', T.sup)).j;
    assert.equal(st.read_only, true); assert.equal(st.published.action, 'published');
    const rbDry = await send('POST', '/api/governance/roadmap-migration/rollback', T.sup, {});
    assert.equal(rbDry.j.dry_run, true); assert.equal(rbDry.j.plan.objectives, 4); assert.equal(rbDry.j.plan.projects, 4); assert.equal(rbDry.j.plan.deliverables, dels.length);
    assert.equal(await progCount(), 1, 'the rollback dry run changed nothing');
    assert.equal((await send('POST', '/api/governance/roadmap-migration/rollback?apply=1', T.sup, { reason: 'short' })).status, 400);
    await sw({ soft_delete_enabled: '0' });
    assert.equal((await send('POST', '/api/governance/roadmap-migration/rollback?apply=1', T.sup, { reason: 'fictitious test rollback' })).j.code, 'SOFT_DELETE_OFF');
    await sw({ soft_delete_enabled: '1' });
    const rb = await send('POST', '/api/governance/roadmap-migration/rollback?apply=1', T.sup, { reason: 'fictitious test rollback' });
    assert.equal(rb.status, 200, JSON.stringify(rb.j)); assert.equal(rb.j.read_only, false);
    const row = await rdb.db.prepare('SELECT key, deleted_at FROM portfolio_programmes WHERE id=?').get(pid);
    assert.ok(row.deleted_at, 'soft-deleted, not removed'); assert.match(row.key, /^itsm-roadmap-rb\d+$/);
    assert.equal(String((await cfg.getConfig(rdb.db)).roadmap_redirect_to_portfolio), '0');
    const ev = await rdb.db.prepare("SELECT action FROM ppm_events WHERE entity='programme' AND entity_id=? ORDER BY id").all(pid);
    assert.deepEqual(ev.map((e) => e.action), ['roadmap_migrated', 'published', 'roadmap_rollback']);
    assert.equal(Number((await rdb.db.prepare("SELECT COUNT(*) AS n FROM roadmap_deliverables WHERE user_id=?").get(ID.rp_super)).n), dels.length + 1, 'Roadmap Manager rows untouched (the left-out duplicate included)');
    const d2 = await send('POST', '/api/governance/roadmap-migration', T.sup, {});
    assert.equal(d2.j.plan.exists, false); assert.equal(d2.j.duplicates.objectives.length, 0, 'keys freed by the rollback');
    assert.equal((await send('POST', '/api/governance/roadmap-migration?apply=1&skip_duplicates=1', T.sup, {})).status, 200, 'a new publication works after a rollback');
  } finally { await sw({ roadmap_publication_enabled: '0', soft_delete_enabled: '0', roadmap_redirect_to_portfolio: '0' }); }
});
