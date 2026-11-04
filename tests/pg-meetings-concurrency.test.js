'use strict';
// A-06 — optimistic concurrency on the PV save. A tab that opened the PV before an action
// was closed / added or an issue status changed elsewhere must get CONFLICT and change
// NOTHING (it used to UPDATE every row it carried and DELETE every action it did not know).
const { test, before } = require('node:test');
const assert = require('node:assert');
const mdb = require('../meetings-db');

let site;
before(async () => { const L = await mdb.loadLookups(); site = (L.sites[0] && L.sites[0].code) || 'MGO'; });

let n = 0;
async function seed() {
  n++;
  const month = String(n).padStart(2, '0');
  const out = await mdb.saveMeeting({
    header: { site_code: site, department: 'conc' + n, meeting_date: `2025-${month}-10`, intake_source: 'dept_meeting', status: 'draft' },
    issues: [{ title: 'Link down', category: 'CN', severity: 'HIGH', status: 'open' }],
    actions: [{ description: 'Replace switch', status: 'open', linked_issue_ord: 1 }],
  }, null, null);
  return out.id;
}
// What the PV page holds after GET: the record, with the token it was given.
async function openTab(id) {
  const rec = await mdb.getMeeting(id);
  return { id, header: { ...rec.header, expected_edit_token: rec.header.edit_token }, issues: rec.issues.map(i => ({ ...i })), actions: rec.actions.map(a => ({ ...a })) };
}
async function expectConflict(p) {
  await assert.rejects(p, (e) => { assert.equal(e.code, 'CONFLICT'); assert.ok(typeof e.current_token === 'string' && e.current_token); assert.ok(!/closed|cross-site/i.test(e.message), 'message must not trip the 403 regex'); return true; });
}

test('token is a stable string across two reads with no write (no false conflict)', async () => {
  const id = await seed();
  const a = (await mdb.getMeeting(id)).header.edit_token;
  const b = await mdb.editToken(id);
  assert.equal(typeof a, 'string');
  assert.match(a, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}\|\d+\|\d+$/);
  assert.equal(a, b);
  const tab = await openTab(id);
  await mdb.saveMeeting(tab, null, null);   // round-trip of the same token succeeds
});

test('stale save after addActionUpdate closed an action → CONFLICT, the action stays resolved', async () => {
  const id = await seed();
  const tab = await openTab(id);
  const actId = tab.actions[0].id;
  await mdb.addActionUpdate(actId, { status_change: 'resolved', body: 'done elsewhere' });
  tab.header.priority_1 = 'stale edit';
  await expectConflict(mdb.saveMeeting(tab, null, null));
  const rec = await mdb.getMeeting(id);
  const a = rec.actions.find(x => x.id === actId);
  assert.equal(a.status, 'resolved');
  assert.ok(a.closed_at);
  assert.notEqual(rec.header.priority_1, 'stale edit', 'nothing written');
});

test('stale save after addActionForIssue added an action → CONFLICT, the new action still exists', async () => {
  const id = await seed();
  const tab = await openTab(id);
  const added = await mdb.addActionForIssue(tab.issues[0].id, { description: 'Added from the hub' });
  await expectConflict(mdb.saveMeeting(tab, null, null));
  const rec = await mdb.getMeeting(id);
  assert.ok(rec.actions.some(a => a.id === added.id), 'hub action survived');
  assert.equal(rec.actions.length, 2);
});

test('stale save after addIssueUpdate changed an issue status → CONFLICT, issue unchanged', async () => {
  const id = await seed();
  const tab = await openTab(id);
  await mdb.addIssueUpdate(tab.issues[0].id, { status_change: 'in_progress', body: 'working' });
  await expectConflict(mdb.saveMeeting(tab, null, null));
  const rec = await mdb.getMeeting(id);
  assert.equal(rec.issues[0].status, 'in_progress');
});

test('save with the current token succeeds; the token changes afterwards', async () => {
  const id = await seed();
  const tab = await openTab(id);
  const before = tab.header.expected_edit_token;
  tab.header.priority_1 = 'fresh edit';
  const out = await mdb.saveMeeting(tab, null, null);
  assert.equal(out.id, id);
  const rec = await mdb.getMeeting(id);
  assert.equal(rec.header.priority_1, 'fresh edit');
  assert.notEqual(rec.header.edit_token, before);
  // the old token is now stale
  await expectConflict(mdb.saveMeeting(tab, null, null));
});

test('save with NO expected_edit_token behaves as today (F2 re-save keeps action ids)', async () => {
  const id = await seed();
  const tab = await openTab(id);
  await mdb.addActionUpdate(tab.actions[0].id, { status_change: 'in_progress' });
  delete tab.header.expected_edit_token;
  delete tab.header.edit_token;
  const ids = tab.actions.map(a => a.id);
  await mdb.saveMeeting(tab, null, null);
  const rec = await mdb.getMeeting(id);
  assert.deepEqual(rec.actions.map(a => a.id), ids);
});

test('two concurrent saves with the same token: exactly one wins, the other gets CONFLICT', async () => {
  const id = await seed();
  const t1 = await openTab(id), t2 = await openTab(id);
  t1.header.priority_1 = 'one'; t2.header.priority_1 = 'two';
  const res = await Promise.allSettled([mdb.saveMeeting(t1, null, null), mdb.saveMeeting(t2, null, null)]);
  const ok = res.filter(r => r.status === 'fulfilled');
  const ko = res.filter(r => r.status === 'rejected');
  assert.equal(ok.length, 1);
  assert.equal(ko.length, 1);
  assert.equal(ko[0].reason.code, 'CONFLICT');
});
