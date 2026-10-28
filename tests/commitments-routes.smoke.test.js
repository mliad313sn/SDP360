'use strict';
const fetch = require('./_http-fetch');
// 2027 Goal 02 — /api/commitments on sqlite through the real server: flag off = 404, IDOR / cross-site
// denial, self-verification refused (super_admin included), stale version 409, evidence checksum +
// mime refusal, hub badge on a linked meeting action, and the two brief demos (F-1, F-2) end to end.
const _os = require('os'), _fs = require('fs'), _path = require('path');
for (const k of ['REPORTS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND', 'ASSETS_BACKEND']) process.env[k] = 'sqlite';
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'cmt-smoke-'));
process.env.DASH_USER = process.env.DASH_USER || 'cmt-smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'cmt-smoke-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'cmt-smoke-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const http = require('http');
let server, base, rdb, hounde, mana, editor, otherEditor, reviewer, superT, siteless, mdActionId;
const trace = (...a) => console.log('[demo]', ...a);

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  for (let i = 0; i < 50; i++) { if (rdb.db.prepare("SELECT 1 FROM sqlite_master WHERE name='commitments'").get()) break; await new Promise((r) => setTimeout(r, 100)); }
  const sites = rdb.listSites({ includeInactive: true });
  hounde = sites.find((s) => /hounde/i.test(s.name)).id; mana = sites.find((s) => /mana/i.test(s.name)).id;
  const mk = async (u, role, roles, site) => { try { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', role, roles, site_id: site }); } catch {} return (await rdb.login(u, u + 'pass1234')).token; };
  editor = await mk('cm_editor', 'editor', ['editor'], hounde); otherEditor = await mk('cm_other', 'editor', ['editor'], mana);
  reviewer = await mk('cm_reviewer', 'viewer', ['viewer']); superT = await mk('cm_super', 'super_admin', ['super_admin']);
  siteless = await mk('cm_siteless', 'editor', ['editor']);
  const m = require('../meetings-db').saveMeeting({ header: { reference: 'CMT_PV_HGO_2026-10', site_code: 'HGO', department: 'mining', meeting_date: '2026-10-05', intake_source: 'dept_meeting', status: 'draft' },
    actions: [{ description: 'Provide rugged laptops to the geology team', status: 'open', target_date: '2026-11-30', owner_it: 'cm_editor' }] }, null, null);
  mdActionId = require('../meetings-db').getMeeting(m.id).actions[0].id;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const H = (t, extra) => ({ headers: Object.assign(t ? { 'x-report-token': t } : {}, extra || {}) });
const get = (p, t) => fetch(base + p, H(t));
const send = (m, p, t, body) => fetch(base + p, { method: m, ...H(t, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
const upload = (p, t, buf, mime, name) => fetch(base + p, { method: 'POST', ...H(t, { 'content-type': mime, 'x-filename': name }), body: buf });
const PDF = Buffer.from('%PDF-1.4\n% acceptance memo signed by the business head\n%%EOF\n');

test('flag off: every commitments route is 404 and the hub carries no commitment field', async () => {
  assert.equal((await get('/api/commitments')).status, 401);
  assert.equal((await get('/api/commitments', editor)).status, 404);
  assert.equal((await send('POST', '/api/commitments', editor, { kind: 'issue', title: 'x', site_id: hounde })).status, 404);
  const hub = await (await get('/api/reports/site-actions?site=HGO', editor)).json();
  assert.ok(!JSON.stringify(hub).includes('"commitment"'));
  require('../services/reportConfig').setConfig(rdb.db, { commitments_enabled: '1' }, 'test');
});

let id, ver;
test('demo F-1: need → commitment → SDP ticket link → technical complete → reviewer rejects → rework → evidence → verified → metric counts it', async () => {
  let r = await send('POST', '/api/commitments', editor, { kind: 'business_need', title: 'Rugged laptops for geology', site_id: hounde, department: 'mining',
    accountable_owner: 'cm_editor', execution_owners: ['it.tech'], reviewer: 'cm_reviewer', due_date: '2099-12-31', source: { system: 'meetings', id: String(mdActionId) } });
  assert.equal(r.status, 201); let c = (await r.json()).commitment; id = c.id; ver = c.version;
  trace(`1 need captured: commitment #${id} status=${c.status} linked to meetings:${mdActionId}`);
  const dup = await (await send('POST', '/api/commitments', editor, { kind: 'business_need', title: 'again', site_id: hounde, source: { system: 'meetings', id: String(mdActionId) } })).json();
  assert.equal(dup.created, false); assert.equal(dup.commitment.id, id);
  c = (await (await send('POST', `/api/commitments/${id}/links`, editor, { source_system: 'sdp_ticket', source_id: '311587', relation: 'delivers' })).json()).commitment;
  trace(`2 SDP ticket linked: ${c.links.map((l) => l.source_system + ':' + l.source_id).join(', ')}`);
  for (const to of ['committed', 'in_progress', 'awaiting_verification']) {
    c = (await (await send('POST', `/api/commitments/${id}/transition`, editor, { to, version: c.version })).json()).commitment;
  }
  assert.equal(c.status, 'awaiting_verification'); assert.ok(c.technical_completed_at);
  trace(`3 technical completion: status=${c.status} technical_completed_at set, verified_at=${c.verified_at}`);
  let m = await (await get(`/api/commitments/metrics?site=${hounde}`, editor)).json();
  assert.equal(m.verified_on_time_pct, null); assert.equal(m.technical_vs_verified.technical, 1); assert.equal(m.technical_vs_verified.verified, 0);
  trace(`4 metric before verification: verified_on_time=${m.verified_on_time.state} technical=1 verified=0 (not counted as a benefit)`);
  // the IT editor cannot verify their own work
  assert.equal((await send('POST', `/api/commitments/${id}/transition`, editor, { to: 'verified_closed', version: c.version })).status, 403);
  r = await send('POST', `/api/commitments/${id}/transition`, reviewer, { to: 'rejected_for_rework', version: c.version, reason: 'no acceptance evidence' });
  c = (await r.json()).commitment; assert.equal(c.status, 'rejected_for_rework');
  trace(`5 reviewer rejected: status=${c.status} reason="no acceptance evidence"`);
  c = (await (await send('POST', `/api/commitments/${id}/transition`, editor, { to: 'in_progress', version: c.version })).json()).commitment;
  const ev = await (await upload(`/api/commitments/${id}/evidence?type=sign_off`, editor, PDF, 'application/pdf', 'acceptance.pdf')).json();
  assert.equal(ev.sha256, crypto.createHash('sha256').update(PDF).digest('hex'));
  trace(`6 evidence uploaded: id=${ev.evidence_id} sha256=${ev.sha256.slice(0, 16)}…`);
  const dl = await get(`/api/commitments/${id}/evidence/${ev.evidence_id}`, reviewer); assert.equal(dl.status, 200);
  assert.equal(dl.headers.get('x-content-sha256'), ev.sha256);
  c = (await (await send('POST', `/api/commitments/${id}/transition`, editor, { to: 'awaiting_verification', version: ev.commitment.version })).json()).commitment;
  c = (await (await send('POST', `/api/commitments/${id}/transition`, reviewer, { to: 'verified_closed', version: c.version })).json()).commitment;
  assert.equal(c.status, 'verified_closed'); assert.equal(c.verified_by, 'cm_reviewer');
  assert.deepEqual(c.verifications.map((v) => v.decision), ['rejected_for_rework', 'accepted']);
  trace(`7 verified by ${c.verified_by}: verifications=${c.verifications.map((v) => v.attempt + ':' + v.decision).join(',')}`);
  m = await (await get(`/api/commitments/metrics?site=${hounde}`, editor)).json();
  assert.equal(m.verified_on_time_pct, 100); assert.equal(m.verified_on_time.denominator, 1); assert.equal(m.status, 'draft — pending committee');
  trace(`8 metric counts it: verified_on_time_pct=${m.verified_on_time_pct} (${m.verified_on_time.numerator}/${m.verified_on_time.denominator}), status="${m.status}"`);
  const hub = await (await get('/api/reports/site-actions?site=HGO', editor)).json();
  const row = hub.groups.meetings.items.find((x) => x.action_id === mdActionId);
  assert.equal(row.commitment.status, 'verified_closed'); assert.equal(row.status, 'open', 'the source record is untouched');
  trace(`9 hub badge on meetings:${mdActionId}: commitment=${row.commitment.status}, source status still "${row.status}"`);
});

test('demo F-2: a high inspection finding without owner / due date is refused server-side', async () => {
  const r = await send('POST', '/api/commitments', editor, { kind: 'inspection_finding', severity: 'high', title: 'Server room door not locked', site_id: hounde, source: { system: 'inspection', id: '9001' } });
  const c = (await r.json()).commitment; assert.equal(c.status, 'captured');
  for (const to of ['triaged', 'committed']) {
    const t = await send('POST', `/api/commitments/${c.id}/transition`, editor, { to, version: c.version });
    assert.equal(t.status, 400); const b = await t.json(); assert.match(b.error, /accountable_owner, due_date, treatment_plan/);
    trace(`F-2 ${to} refused: 400 "${b.error}"`);
  }
});

// Consolidation scenario 2 (goal P1 acceptance): critical inspection finding → A01 (unowned) → owner/date →
// overdue → A02 → evidence → rejection → rework → independent verification → reopen with reason; audited.
test('demo F-3: critical finding → A01 → owner/date → A02 overdue → evidence → reject → rework → verified → reopen', async () => {
  const alerts = require('../services/alertEngine');
  const metrics = async () => (await (await get(`/api/commitments/metrics?site=${hounde}`, editor)).json());
  const fire = (metric, value) => alerts.evaluate([{ key: metric, metric: 'commitments.' + metric, op: 'gt', threshold: 0 }],
    [{ rule_key: metric, site_id: hounde, site: 'Hounde', value, unit: 'count' }]).firings.length;
  const base = await metrics();
  let c = (await (await send('POST', '/api/commitments', editor, { kind: 'inspection_finding', severity: 'critical', title: 'UPS bypassed in the server room',
    site_id: hounde, reviewer: 'cm_reviewer', source: { system: 'inspection', id: '9002' } })).json()).commitment;
  let m = await metrics();
  assert.equal(m.serious_unowned, base.serious_unowned + 1, 'the unowned critical finding is counted');
  assert.equal(fire('serious_unowned', m.serious_unowned), 1, 'A01 fires on the reading');
  trace(`F-3 1 critical finding #${c.id} captured without owner → serious_unowned=${m.serious_unowned} → A01 fires`);
  assert.equal((await send('POST', `/api/commitments/${c.id}/transition`, editor, { to: 'committed', version: c.version })).status, 400);
  const put = await send('PUT', `/api/commitments/${c.id}`, editor, { version: c.version, accountable_owner: 'cm_editor', execution_owners: ['it.tech'],
    due_date: '2026-01-15', treatment_plan: 'Restore UPS inline, test transfer, lock panel', reason: 'initial due date' });
  const putBody = await put.text(); assert.equal(put.status, 200, putBody); c = JSON.parse(putBody).commitment;
  for (const to of ['committed', 'in_progress']) c = (await (await send('POST', `/api/commitments/${c.id}/transition`, editor, { to, version: c.version })).json()).commitment;
  m = await metrics();
  assert.equal(m.serious_unowned, base.serious_unowned, 'owned now');
  assert.ok(m.serious_exposure.overdue_ids.includes(c.id), 'past its due date without an exception');
  assert.ok(fire('serious_overdue', m.serious_overdue) === 1, 'A02 fires');
  trace(`F-3 2 owner + due 2026-01-15 + plan set → committed → in_progress; overdue_ids include #${c.id} → A02 fires`);
  const ev = await (await upload(`/api/commitments/${c.id}/evidence?type=report`, editor, PDF, 'application/pdf', 'ups-test.pdf')).json();
  c = (await (await send('POST', `/api/commitments/${c.id}/transition`, editor, { to: 'awaiting_verification', version: ev.commitment.version })).json()).commitment;
  assert.ok(!(await metrics()).serious_exposure.overdue_ids.includes(c.id), 'awaiting verification is not counted as overdue');
  c = (await (await send('POST', `/api/commitments/${c.id}/transition`, reviewer, { to: 'rejected_for_rework', version: c.version, reason: 'transfer test not witnessed' })).json()).commitment;
  assert.equal(c.status, 'rejected_for_rework');
  for (const to of ['in_progress', 'awaiting_verification']) c = (await (await send('POST', `/api/commitments/${c.id}/transition`, editor, { to, version: c.version })).json()).commitment;
  assert.equal((await send('POST', `/api/commitments/${c.id}/transition`, editor, { to: 'verified_closed', version: c.version })).status, 403, 'owner cannot verify');
  c = (await (await send('POST', `/api/commitments/${c.id}/transition`, reviewer, { to: 'verified_closed', version: c.version })).json()).commitment;
  assert.equal(c.status, 'verified_closed');
  trace(`F-3 3 evidence ${ev.sha256.slice(0, 12)}… → rejected ("transfer test not witnessed") → rework → verified by ${c.verified_by}`);
  assert.equal((await send('POST', `/api/commitments/${c.id}/transition`, reviewer, { to: 'reopened', version: c.version })).status, 400, 'reopen needs a reason');
  c = (await (await send('POST', `/api/commitments/${c.id}/transition`, reviewer, { to: 'reopened', version: c.version, reason: 'UPS bypassed again on 2026-10-27' })).json()).commitment;
  assert.equal(c.status, 'reopened');
  const fj = await (await get(`/api/commitments/${c.id}`, editor)).json(); const full = fj.commitment || fj;
  const path = full.events.filter((e) => e.action === 'transition').map((e) => e.to_status);
  assert.ok(full.events.some((e) => e.action === 'evidence_added') && full.events.some((e) => e.action === 'due_date_changed' || e.action === 'updated'), 'edits and evidence are audited');
  assert.deepEqual(path, ['committed', 'in_progress', 'awaiting_verification', 'rejected_for_rework', 'in_progress', 'awaiting_verification', 'verified_closed', 'reopened'], 'audited path');
  assert.ok(full.events.every((e) => e.at && e.actor), 'every event has a time and an actor');
  assert.deepEqual(full.verifications.map((v) => v.decision), ['rejected_for_rework', 'accepted']);
  trace(`F-3 4 reopened with reason; audit trail: ${path.join(' → ')}`);
});

test('IDOR / cross-site: another site editor, a site-less editor, an unrelated viewer get 404 / 403 / empty lists', async () => {
  assert.equal((await get(`/api/commitments/${id}`, otherEditor)).status, 404);
  assert.equal((await send('PUT', `/api/commitments/${id}`, otherEditor, { title: 'hijack', version: 1 })).status, 404);
  assert.equal((await send('POST', `/api/commitments/${id}/transition`, otherEditor, { to: 'reopened', version: 1, reason: 'x' })).status, 404);
  assert.equal((await get(`/api/commitments/${id}/evidence/1`, otherEditor)).status, 404);
  assert.equal((await send('POST', '/api/commitments', otherEditor, { kind: 'issue', title: 'x', site_id: hounde })).status, 403);
  assert.equal((await (await get('/api/commitments', otherEditor)).json()).commitments.length, 0);
  assert.equal((await (await get('/api/commitments', siteless)).json()).commitments.length, 0, 'site-less editor sees nothing');
  assert.equal((await get(`/api/commitments/metrics?site=${hounde}`, otherEditor)).status, 403);
  assert.equal((await get(`/api/commitments/${id}`, reviewer)).status, 200, 'the named reviewer sees it');
  trace('cross-site: Mana editor GET/PUT/transition → 404, create on Hounde → 403, site-less list → 0');
});

test('self-verification refused for a super_admin; stale version → 409; evidence mime refused', async () => {
  const c = (await (await send('POST', '/api/commitments', superT, { kind: 'improvement', title: 'Self check', site_id: hounde, accountable_owner: 'cm_super' })).json()).commitment;
  let cur = c;
  for (const to of ['committed', 'in_progress', 'awaiting_verification']) cur = (await (await send('POST', `/api/commitments/${c.id}/transition`, superT, { to, version: cur.version })).json()).commitment;
  const self = await send('POST', `/api/commitments/${c.id}/transition`, superT, { to: 'verified_closed', version: cur.version });
  assert.equal(self.status, 403); assert.match((await self.json()).error, /cannot verify their own/);
  assert.equal((await send('POST', `/api/commitments/${c.id}/transition`, superT, { to: 'rejected_for_rework', version: 1, reason: 'x' })).status, 403);
  const stale = await send('PUT', `/api/commitments/${c.id}`, editor, { title: 'new', version: 1 });
  assert.equal(stale.status, 409, 'stale version');
    const c2 = (await (await send('POST', '/api/commitments', editor, { kind: 'issue', title: 'Stale test', site_id: hounde })).json()).commitment;
  assert.equal((await send('PUT', `/api/commitments/${c2.id}`, editor, { title: 'v2', version: 1 })).status, 200);
  assert.equal((await send('PUT', `/api/commitments/${c2.id}`, editor, { title: 'v3', version: 1 })).status, 409);
  assert.equal((await upload(`/api/commitments/${c2.id}/evidence`, editor, Buffer.from('MZ\x90\x00'), 'application/x-msdownload', 'a.exe')).status, 415);
  assert.equal((await upload(`/api/commitments/${c2.id}/evidence`, editor, Buffer.from('<html>'), 'application/pdf', 'fake.pdf')).status, 415);
  assert.equal((await send('POST', `/api/commitments/${c2.id}/evidence`, editor, { url: 'https://sharepoint.example/doc' })).status, 201);
  const page = await get('/commitments.html', editor); assert.equal(page.status, 200);
});
