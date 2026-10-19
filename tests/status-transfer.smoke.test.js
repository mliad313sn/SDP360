'use strict';
const fetch = require('./_http-fetch');   // core-http shim — undici keep-alive aborts the process at --test-force-exit on Windows
// Transfer statuses (2026-10-16, user request) on meetings issues and actions:
//   demand / helpdesk_ticket / cancelled need a justification comment, helpdesk_ticket also
//   the SDP ticket number; they close the item like "cancelled" (out of the open lists, never
//   counted as resolved). Throwaway sqlite; boots the app in-process.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'st-transfer-'));
for (const k of ['REPORTS_BACKEND', 'ASSETS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND']) process.env[k] = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'st-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'st-super-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'st-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const ST = require('../public/lib/statusTransfer');

let server, base, rdb, mdb, tok, code, dept, mid;
const H = (t) => ({ 'Content-Type': 'application/json', 'x-report-token': t });
const post = (p, b) => fetch(base + p, { method: 'POST', headers: H(tok), body: JSON.stringify(b) });

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  mdb = require('../meetings-db');
  const L = await mdb.loadLookups();
  dept = L.departments[0].code;
  code = L.sites[0].code;
  await rdb.createUser({ username: 'st-admin', full_name: 'ST Admin', password: 'st-admin-0000', roles: ['admin'] });
  tok = (await rdb.login('st-admin', 'st-admin-0000')).token;
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await post('/api/meetings/save', { state: {
    header: { site_code: code, department: dept, meeting_date: '2026-09-10', status: 'draft' },
    issues: [
      { title: 'Printer down', category: L.categories[0].code, status: 'open', target_date: '2026-01-01' },
      { title: 'New laptop asked', category: L.categories[0].code, status: 'open', target_date: '2026-01-01' },
    ],
    actions: [{ description: 'Order toner', status: 'open', target_date: '2026-01-01' }],
  } });
  mid = (await r.json()).id;
  assert.ok(mid, 'fixture PV saved');
});
after(() => { try { server && server.close(); } catch {} });

const meeting = () => mdb.getMeeting(mid);

test('the rule: comment for the three transfer statuses, ticket number for helpdesk_ticket', () => {
  assert.equal(ST.validate('in_progress', '', null), null);
  assert.match(ST.validate('demand', '  ', null), /comment/i);
  assert.match(ST.validate('cancelled', '', null), /comment/i);
  assert.equal(ST.label('in_progress'), 'In progress', 'English label, never the raw code');
  assert.equal(ST.label('cancelled'), 'Cancelled');
  assert.equal(ST.label('In Progress'), 'In progress', 'inspection spelling aligned');
  assert.equal(ST.label('Weird'), 'Weird', 'unknown codes pass through');
  assert.match(ST.validate('helpdesk_ticket', 'moved', ''), /ticket/i);
  assert.equal(ST.validate('helpdesk_ticket', 'moved', '#311 587'), null);
  assert.equal(ST.normalizeTicket('INC #311587'), '311587');
  assert.equal(ST.isDone('demand'), true);
  assert.equal(ST.isDone('in_progress'), false);
});

test('the two codes are seeded in the statuses lookup', async () => {
  const L = await mdb.loadLookups();
  const codes = L.statuses.map(s => s.code);
  assert.ok(codes.includes('demand') && codes.includes('helpdesk_ticket'), codes.join(','));
});

test('issue update: refused without a comment, stored with it, closes the issue', async () => {
  const iss = (await meeting()).issues.find(i => i.title === 'Printer down');
  const no = await post(`/api/meetings/issues/${iss.id}/update`, { status_change: 'helpdesk_ticket', body: 'moved to SDP' });
  assert.equal(no.status, 400, 'ticket number missing');
  const ok = await post(`/api/meetings/issues/${iss.id}/update`, { status_change: 'helpdesk_ticket', body: 'Moved to SDP', helpdesk_ticket: '#311587' });
  assert.equal(ok.status, 200, await ok.text());
  const after = (await meeting()).issues.find(i => i.id === iss.id);
  assert.equal(after.status, 'helpdesk_ticket');
  assert.equal(after.helpdesk_ticket, '311587');
  assert.equal(after.status_note, 'Moved to SDP');
  assert.ok(after.closed_at, 'closed like cancelled');
  const open = await mdb.listIssues({ site: code });
  assert.equal(open[open.length - 1].id, iss.id, 'sorted with the closed ones');
});

test('reopening clears the note and the ticket', async () => {
  const iss = (await meeting()).issues.find(i => i.title === 'Printer down');
  const r = await post(`/api/meetings/issues/${iss.id}/update`, { status_change: 'in_progress', body: 'back' });
  assert.equal(r.status, 200);
  const after = (await meeting()).issues.find(i => i.id === iss.id);
  assert.equal(after.status_note, null);
  assert.equal(after.helpdesk_ticket, null);
  assert.equal(after.closed_at, null);
});

test('action update: demand without a comment is refused; cancelled with one is stored', async () => {
  const a = (await meeting()).actions[0];
  assert.equal((await post(`/api/meetings/actions/${a.id}/update`, { status_change: 'demand' })).status, 400);
  const ok = await post(`/api/meetings/actions/${a.id}/update`, { status_change: 'cancelled', body: 'Duplicate of an SDP request' });
  assert.equal(ok.status, 200);
  const after = (await meeting()).actions.find(x => x.id === a.id);
  assert.equal(after.status, 'cancelled');
  assert.equal(after.status_note, 'Duplicate of an SDP request');
});

test('PV save: a transition without its justification is refused, with it accepted and audited', async () => {
  const rec = await meeting();
  const issues = rec.issues.map(i => i.title === 'New laptop asked' ? { ...i, status: 'demand' } : i);
  const no = await post('/api/meetings/save', { state: { id: mid, header: rec.header, issues } });
  assert.equal(no.status, 400);
  assert.match((await no.json()).error, /New laptop asked/);
  const withNote = rec.issues.map(i => i.title === 'New laptop asked' ? { ...i, status: 'demand', status_note: 'Hardware request, not an IT issue' } : i);
  const ok = await post('/api/meetings/save', { state: { id: mid, header: rec.header, issues: withNote } });
  assert.equal(ok.status, 200, await ok.text());
  const after = (await meeting()).issues.find(i => i.title === 'New laptop asked');
  assert.equal(after.status, 'demand');
  assert.equal(after.status_note, 'Hardware request, not an IT issue');
  const again = await post('/api/meetings/save', { state: { id: mid, header: rec.header, issues: (await meeting()).issues } });
  assert.equal(again.status, 200, 'an unchanged transfer status re-saves without a new comment');
});

test('Site Actions hub: the transferred items leave the open groups', async () => {
  const r = await fetch(base + '/api/reports/site-actions?site=' + encodeURIComponent(code), { headers: H(tok) });
  assert.equal(r.status, 200);
  const j = await r.json();
  const issues = (j.groups.issues && j.groups.issues.items) || [];
  assert.ok(!issues.some(i => i.title === 'New laptop asked'), 'demand issue not listed as open');
  const acts = [].concat((j.groups.meetings || {}).items || [], (j.groups.incubation || {}).items || []);
  assert.ok(!acts.some(a => a.title === 'Order toner'), 'cancelled action not listed');
});

test('the pages load the shared rule', () => {
  for (const f of ['site-actions.html', 'meetings-issues.html', 'meetings-actions.html', 'meeting.html']) {
    const src = _fs.readFileSync(_p.join(__dirname, '..', 'public', f), 'utf8');
    assert.match(src, /src="lib\/statusTransfer\.js"/, f);
    assert.match(src, /StatusTransfer|ST\.ask|ST && ST\.isTransfer/, f);
  }
});

// ── 2026-10-16 (later): report follow-ups, Undo, "Show closed / cancelled" ──────────────────
test('report follow-up: cancelling needs a justification (hub /status and report save)', async () => {
  const sid = (await rdb.getSiteIdByModuleCode('meetings', code)).site_id;
  const rep = await rdb.ensureReport(sid, 2026, 40);
  const put = (body) => fetch(base + `/api/reports/${rep.id}/actions`, { method: 'PUT', headers: H(tok), body: JSON.stringify(body) });
  const dept = (await (await fetch(base + '/api/reports/action-departments', { headers: H(tok) })).json());
  const d = (Array.isArray(dept) ? dept : (dept.rows || dept.departments || []))[0];
  const deptName = d ? (d.name || d.code || d) : 'Finance';
  let r = await put([{ task: 'Replace core switch', department: deptName, priority: 'Medium', status: 'open' }]);
  assert.equal(r.status, 200, await r.text());
  const uid = (await rdb.getReport(rep.id)).action_items[0].uid;
  r = await put([{ uid, task: 'Replace core switch', department: deptName, priority: 'Medium', status: 'cancelled' }]);
  assert.equal(r.status, 400, 'report save refuses a cancellation without comment');
  r = await post(`/api/reports/action/${uid}/status`, { status: 'cancelled' });
  assert.equal(r.status, 400, 'hub refuses a cancellation without note');
  r = await post(`/api/reports/action/${uid}/status`, { status: 'cancelled', note: 'Done by the vendor contract' });
  assert.equal(r.status, 200, await r.text());
  const a = (await rdb.getReport(rep.id)).action_items[0];
  assert.equal(a.status, 'cancelled');
  assert.match(a.comment, /Cancelled: Done by the vendor contract/);
});

test('hub ?closed=1 lists what was closed in 30 days, and a reopen brings it back', async () => {
  const get = async () => (await (await fetch(base + '/api/reports/site-actions?site=' + encodeURIComponent(code) + '&closed=1', { headers: H(tok) })).json());
  let j = await get();
  const titles = (j.recent_closed || []).map(x => x.source + ':' + x.title);
  assert.ok(titles.includes('report:Replace core switch'), titles.join(' | '));
  assert.ok(titles.includes('issue:New laptop asked'), 'the demand issue is listed');
  assert.ok(titles.includes('meetings:Order toner'), 'the cancelled action is listed');
  const rpt = j.recent_closed.find(x => x.title === 'Replace core switch');
  const r = await post(`/api/reports/action/${rpt.uid}/status`, { status: 'open' });   // reopen / undo needs no note
  assert.equal(r.status, 200);
  j = await get();
  assert.ok(!(j.recent_closed || []).some(x => x.title === 'Replace core switch'), 'gone from the closed list');
  assert.ok((j.groups.report.items || []).some(x => x.title === 'Replace core switch'), 'back in the open follow-ups');
});

test('pages: closed toggle + Undo on the hub, cancellation window in the report editor', () => {
  const hub = _fs.readFileSync(_p.join(__dirname, '..', 'public', 'site-actions.html'), 'utf8');
  assert.match(hub, /id="saClosed"/);
  assert.match(hub, /&closed=1/);
  assert.match(hub, /toastUndo\(msg, \(\) => undoStatus\(/);
  const rpt = _fs.readFileSync(_p.join(__dirname, '..', 'public', 'reports.html'), 'utf8');
  assert.match(rpt, /src="lib\/statusTransfer\.js"/);
  assert.match(rpt, /StatusTransfer\.ask\('cancelled'/);
});
