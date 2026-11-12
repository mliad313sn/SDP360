'use strict';
// P8 / goal B1 — /api/analytics/wan/sla/claims/* end to end on the real app (PostgreSQL test database):
// 404 while the switch is off · admin-only writes · no duplicate claim · motive + legal transitions only · every
// change audited (hash-chained, verifiable) · stale vs evidence · site perimeter + amount masking (invariant 2) ·
// evidence pack content · operator notification never leaves unarmed / under STOP / without a second person ·
// the value metric is money-only · the SLA summary hides amounts from non-money readers.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'wan-claims-'));
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'wan-claims-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, rdb, reportConfig, siteA, siteB;
const tok = {};
const sent = [];
const BASE = '/api/analytics/wan/sla/claims';
const call = (method, p, t, body) => fetch(base + p, { method, headers: { 'x-report-token': t, 'content-type': 'application/json' }, body: body == null ? undefined : JSON.stringify(body) });
const get = (p, t) => call('GET', p, t);
const post = (p, t, b) => call('POST', p, t, b || {});
const slaCfg = (notifyEnabled) => JSON.stringify({ clock_start: 'detection', notify: { enabled: notifyEnabled },
  circuits: [{ site_id: siteA.id, sub_site: '', uplink: 'wan1', tier: 'SILVER', isp: 'TestISP', circuit_id: 'C-1', mrc_amount: 100000, currency: 'XOF', isp_notify_email: 'noc@isp.example' }] });
const setCfg = (kv) => reportConfig.setConfig(rdb.db, kv, 'test');

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  reportConfig = require('../services/reportConfig');
  [siteA, siteB] = (await rdb.listSites());
  // August 2026, office calendar (Mon–Fri 08-13 / 14-17): 8 h 24 min of ISP outage in service hours → 95.00 % → 10 %.
  for (const [s, e] of [['2026-08-03T08:00:00.000Z', '2026-08-03T17:00:00.000Z'], ['2026-08-04T08:00:00.000Z', '2026-08-04T08:24:00.000Z']]) {
    await rdb.upsertWanOutage({ site_id: siteA.id, sub_site: '', uplink: 'wan1', detected_start: s, restored_end: e, duration_s: 1, attribution: 'isp', source: 'meraki_event' });
  }
  await setCfg({ sla_wan_config: slaCfg(false) });
  const mk = async (username, roles, site_id) => {
    await rdb.createUser({ username, full_name: username, password: username + '-0000', roles, site_id });
    return (await rdb.login(username, username + '-0000')).token;
  };
  tok.admin = await mk('claims-admin', ['admin'], null);
  tok.admin2 = await mk('claims-admin2', ['admin'], null);
  tok.finance = await mk('claims-finance', ['viewer', 'finance-viewer'], null);
  tok.editorA = await mk('claims-editor-a', ['editor'], siteA.id);
  tok.editorB = await mk('claims-editor-b', ['editor'], siteB.id);
  // the operator e-mail goes through services/mailer only — stubbed here (no network), every send recorded
  require('../services/mailer').buildMailer = () => ({ send: async (m) => { sent.push(m); return { ok: true }; } });
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

let claimId;

test('switch off (default) → every claims route answers 404, even for the admin tier', async () => {
  assert.equal(require('../services/reportConfig').DEFAULTS.wan_sla_claims_enabled, '0');
  assert.equal((await get(BASE, tok.admin)).status, 404);
  assert.equal((await get(BASE + '/status', tok.admin)).status, 404);
  assert.equal((await post(BASE, tok.admin, { site_id: siteA.id, uplink: 'wan1', period: '2026-08' })).status, 404);
  await setCfg({ wan_sla_claims_enabled: '1' });
});

test('create: admin only; the frozen due amount is the engine figure; no duplicate; closed + mapped months only', async () => {
  assert.equal((await post(BASE, tok.editorA, { site_id: siteA.id, uplink: 'wan1', period: '2026-08' })).status, 403);
  assert.equal((await post(BASE, tok.finance, { site_id: siteA.id, uplink: 'wan1', period: '2026-08' })).status, 403, 'finance-viewer reads, never writes');
  const r = await post(BASE, tok.admin, { site_id: siteA.id, uplink: 'wan1', period: '2026-08', owner_name: 'Network lead' });
  const body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  const c = body.claim; claimId = c.id;
  assert.equal(c.status, 'due');
  assert.equal(c.due_amount, 10000); assert.equal(c.currency, 'XOF'); assert.equal(c.due_credit_pct, 10); assert.equal(c.availability_pct, 95);
  assert.match(c.evidence_hash, /^[0-9a-f]{64}$/);
  const dup = await post(BASE, tok.admin2, { site_id: siteA.id, uplink: 'wan1', period: '2026-08' });
  assert.equal(dup.status, 409, 'no duplicate claim for the same circuit × month');
  assert.equal((await dup.json()).code, 'CONFLICT');
  const n = await rdb.pgHandle().prepare('SELECT COUNT(*)::int AS n FROM wan_sla_claims').get();
  assert.equal(n.n, 1);
  const cur = new Date(); const curPeriod = `${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, '0')}`;
  assert.equal((await post(BASE, tok.admin, { site_id: siteA.id, uplink: 'wan1', period: curPeriod })).status, 400, 'the current month is provisional');
  assert.equal((await post(BASE, tok.admin, { site_id: siteB.id, uplink: 'wan1', period: '2026-08' })).status, 400, 'unmapped circuit');
  assert.equal((await post(BASE, tok.admin, { site_id: siteA.id, uplink: 'wan1', period: '2026-07' })).status, 400, 'no credit due → no claim');
});

test('perimeter + masking: admin and finance-viewer see amounts, the site editor sees the claim without money, another site sees nothing', async () => {
  const fin = await (await get(BASE, tok.finance)).json();
  assert.equal(fin.claims[0].due_amount, 10000);
  const ed = await (await get(BASE, tok.editorA)).json();
  assert.equal(ed.claims.length, 1);
  assert.equal(ed.claims[0].due_amount, null); assert.equal(ed.claims[0].money_hidden, true);
  assert.equal(ed.claims[0].calc.amount, null); assert.equal(ed.claims[0].calc.params.mrc_amount, null);
  assert.ok(!JSON.stringify(ed).includes('10000'), 'no amount anywhere in the editor payload');
  assert.deepEqual((await (await get(BASE, tok.editorB)).json()).claims, []);
  assert.equal((await get(`${BASE}/${claimId}`, tok.editorB)).status, 404, 'out of perimeter = not found');
  assert.equal((await get(`${BASE}/value`, tok.editorA)).status, 403, 'the value metric is money');
});

test('transitions: motive mandatory, illegal moves refused, credited needs the amount, terminal until a reopen', async () => {
  const tr = (b, t = tok.admin) => post(`${BASE}/${claimId}/transition`, t, b);
  assert.equal((await tr({ to: 'claimed' })).status, 400, 'no motive');
  assert.equal((await tr({ to: 'credited', motive: 'skip ahead' })).status, 409);
  assert.equal((await tr({ to: 'claimed', motive: 'sent to the ISP' }, tok.editorA)).status, 403);
  const cl = await (await tr({ to: 'claimed', motive: 'sent to the ISP' })).json();
  assert.equal(cl.claim.status, 'claimed'); assert.equal(cl.claim.claimed_amount, 10000);
  assert.equal((await tr({ to: 'credited', motive: 'credit note received' })).status, 400, 'credited_amount required');
  const cr = await (await tr({ to: 'credited', motive: 'credit note CN-12', credited_amount: 9000 })).json();
  assert.equal(cr.claim.status, 'credited'); assert.equal(cr.claim.credited_amount, 9000);
  const term = await tr({ to: 'claimed', motive: 'again' });
  assert.equal(term.status, 409);
  const re = await (await tr({ to: 'disputed', motive: 'credit reversed on the next invoice', reopen: true })).json();
  assert.equal(re.claim.status, 'disputed');
});

test('audit: one hash-chained event per change (created + 3 moves), append-only, verified by the chain job', async () => {
  const d = await (await get(`${BASE}/${claimId}`, tok.admin)).json();
  assert.deepEqual(d.events.map((e) => [e.action, e.to_status]), [['created', 'due'], ['transition', 'claimed'], ['transition', 'credited'], ['reopen', 'disputed']]);
  assert.ok(d.events.every((e) => /^[0-9a-f]{64}$/.test(e.row_hash)));
  assert.ok(d.events.slice(1).every((e) => e.motive && e.actor_name === 'claims-admin'));
  const db = rdb.pgHandle();
  await assert.rejects(async () => db.prepare('UPDATE wan_sla_claim_events SET motive=? WHERE claim_id=?').run('x', claimId), /append-only/);
  const v = await require('../services/auditChain').verify(db);
  assert.equal(v.tables.find((t) => t.table === 'wan_sla_claim_events').ok, true);
  const ed = await (await get(`${BASE}/${claimId}`, tok.editorA)).json();
  assert.ok(!JSON.stringify(ed.events).includes('9000'), 'the editor never reads amounts in the trail either');
});

test('stale vs evidence: an outage edited after the freeze flags the claim, the frozen figure is untouched', async () => {
  let c = (await (await get(`${BASE}/${claimId}`, tok.admin)).json()).claim;
  assert.equal(c.stale, false);
  await rdb.upsertWanOutage({ site_id: siteA.id, sub_site: '', uplink: 'wan1', detected_start: '2026-08-05T08:00:00.000Z', restored_end: '2026-08-05T09:00:00.000Z', duration_s: 3600, attribution: 'isp', source: 'meraki_event' });
  c = (await (await get(`${BASE}/${claimId}`, tok.admin)).json()).claim;
  assert.equal(c.stale, true);
  assert.equal(c.due_amount, 10000);
});

test('evidence pack: outages with their in-service-hours seconds, contract terms, hash; amounts masked for the editor', async () => {
  const csv = await (await get(`${BASE}/${claimId}/evidence.csv`, tok.admin)).text();
  assert.match(csv, /Contract target/); assert.match(csv, /Evidence hash/); assert.match(csv, /2026-08-03T08:00:00.000Z/);
  assert.match(csv, /"28800"/, 'Mon 08-17 minus lunch = 8 h counted');
  assert.match(csv, /10000 XOF/);
  assert.match(csv, /YES — outages or contract changed/);
  const ed = await (await get(`${BASE}/${claimId}/evidence.csv`, tok.editorA)).text();
  assert.ok(!/10000|9000|100000/.test(ed), 'no amount in the editor pack');
  assert.match(ed, /restricted/);
  const pdf = await get(`${BASE}/${claimId}/evidence.pdf`, tok.admin);
  assert.equal(pdf.status, 200);
  assert.ok(pdf.headers.get('x-pdf-fallback') === 'html-only' || /pdf/.test(pdf.headers.get('content-type')));
});

test('operator notification: dry run, second-person approval, never unarmed or under STOP; one send once armed', async () => {
  const before = sent.length;
  const pv = await (await post(`${BASE}/${claimId}/notify/preview`, tok.admin)).json();
  assert.equal(pv.dry_run, true); assert.equal(pv.sent, false); assert.equal(pv.message.to, 'noc@isp.example');
  assert.equal(pv.gate.reason, 'UNARMED');
  assert.equal((await post(`${BASE}/${claimId}/notify/send`, tok.admin)).status, 409, 'unapproved + unarmed');
  assert.equal((await post(`${BASE}/${claimId}/notify/request`, tok.admin)).status, 200);
  assert.equal((await post(`${BASE}/${claimId}/notify/approve`, tok.admin)).status, 403, 'the requester cannot approve');
  assert.equal((await post(`${BASE}/${claimId}/notify/approve`, tok.admin2)).status, 200);
  const unarmed = await post(`${BASE}/${claimId}/notify/send`, tok.admin);
  assert.equal(unarmed.status, 409); assert.equal((await unarmed.json()).reason, 'UNARMED');
  await setCfg({ sla_wan_config: slaCfg(true), notifications_stop: '1' });
  const stopped = await post(`${BASE}/${claimId}/notify/send`, tok.admin);
  assert.equal(stopped.status, 409); assert.equal((await stopped.json()).reason, 'NOTIFICATIONS_STOPPED');
  assert.equal(sent.length, before, 'nothing left while unarmed or stopped');
  await setCfg({ notifications_stop: '0' });
  const ok = await (await post(`${BASE}/${claimId}/notify/send`, tok.admin)).json();
  assert.equal(ok.sent, true); assert.equal(sent.length, before + 1);
  assert.equal(sent[sent.length - 1].to, 'noc@isp.example');
  assert.equal((await post(`${BASE}/${claimId}/notify/send`, tok.admin)).status, 409, 'never twice');
  const d = await (await get(`${BASE}/${claimId}`, tok.admin)).json();
  assert.deepEqual(d.events.filter((e) => e.action.startsWith('notify_')).map((e) => e.action), ['notify_requested', 'notify_approved', 'notify_sent']);
  await setCfg({ sla_wan_config: slaCfg(false) });
});

test('value metric + readiness: per-currency quarter totals for money readers; Teams alerts reported, never armed', async () => {
  const v = await (await get(`${BASE}/value?quarter=2026-Q3`, tok.finance)).json();
  const q = v.quarters.find((x) => x.quarter === '2026-Q3');
  assert.equal(q.currencies.XOF.due, 10000); assert.equal(q.currencies.XOF.claimed, 10000);
  assert.equal(q.currencies.XOF.recovered, 0, 'the claim was reopened: nothing counts as recovered');
  assert.equal(v.fx.certified, false);
  const s = await (await get(`${BASE}/status`, tok.admin)).json();
  assert.equal(s.teams_sla_alerts.armed, false); assert.equal(s.teams_sla_alerts.token_present, false);
  assert.equal(s.operator_notification.armed, false); assert.equal(s.can_write, true);
  assert.ok(!JSON.stringify(s).includes('noc@isp'), 'no contact or secret value in the readiness answer');
});

test('SLA summary: the circuit amount is hidden from a reader without the money right (invariant 2)', async () => {
  const ad = await (await get('/api/analytics/wan/sla/summary?month=2026-08', tok.admin)).json();
  const fin = await (await get('/api/analytics/wan/sla/summary?month=2026-08', tok.finance)).json();
  const ed = await (await get('/api/analytics/wan/sla/summary?month=2026-08', tok.editorA)).json();
  assert.ok(ad.circuits[0].amount > 0); assert.ok(fin.circuits[0].amount > 0);
  assert.equal(ed.circuits.length, 1); assert.equal(ed.circuits[0].amount, null); assert.equal(ed.circuits[0].amount_reason, 'restricted');
});
