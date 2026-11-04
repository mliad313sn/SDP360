'use strict';
// A-19b — soft delete for PVs (switch soft_delete_enabled, default '0' = hard delete).
const { test, before } = require('node:test');
const assert = require('node:assert');
const mdb = require('../meetings-db');
const ops = require('../services/softDeleteOps');

const SITE = 'SGO';
function pv(dept, date, extra = {}) {
  return {
    header: { site_code: SITE, department: dept, meeting_date: date, status: 'submitted', submitted_at: date + ' 10:00:00', ...extra },
    issues: [{ ord: 1, title: 'Issue ' + dept, category: 'CN', severity: 'HIGH', status: 'open', escalate: 1, escalation_reason: 'budget', council_theme: 'connectivity', target_date: '2020-01-01' }],
    actions: [{ ord: 1, description: 'Action ' + dept, owner_it: 'Bob', status: 'open', target_date: '2020-01-01' }],
  };
}
const ids = (rows, key = 'id') => rows.map((r) => Number(r[key]));

before(async () => { await mdb.loadLookups(); });

test('switch off: delete removes the PV and its children (today\'s behaviour)', async () => {
  const r = await mdb.saveMeeting(pv('Mining', '2026-03-10'), null, 1);
  assert.equal(await mdb.deleteMeeting(r.id), true);
  assert.equal(await mdb.getMeetingTrashRow(r.id), null);
});

test('switch on: a deleted PV disappears from list, issues log, actions register, insights, compliance and score inputs', async () => {
  const r = await mdb.saveMeeting(pv('Processing', '2026-04-10'), null, 1);
  const rec = await mdb.getMeeting(r.id);
  const actionId = Number(rec.actions[0].id), issueId = Number(rec.issues[0].id);
  const snap = async () => ({
    list: ids(await mdb.listMeetings({ site: SITE })),
    count: Number(await mdb.countMeetings({ site: SITE })),
    issues: ids(await mdb.listIssues({ site: SITE })),
    actions: ids(await mdb.listActions({ site: SITE })),
    agg: Number((await mdb.aggregate({ site: SITE })).meetings.total_meetings),
    ins: (await mdb.insights({ from: '2026-04-01', to: '2026-04-30', site: SITE })).monthly.reduce((n, m) => n + Number(m.meetings), 0),
    comp: ((await mdb.compliance({ month: '2026-04' })).per_site.find((x) => x.site_code === SITE) || { meetings_this_month: 0 }).meetings_this_month,
    score: (await mdb.getSiteScoreInputs(SITE, '2026-01-01', '2026-12-31')),
  });
  const b = await snap();
  assert.ok(b.list.includes(r.id) && b.issues.includes(issueId) && b.actions.includes(actionId));
  assert.equal(await mdb.deleteMeeting(r.id, { soft: true, by: 3, reason: 'wrong department' }), true);
  const a = await snap();
  assert.ok(!a.list.includes(r.id), 'list');
  assert.equal(a.count, b.count - 1, 'count');
  assert.ok(!a.issues.includes(issueId), 'issues log');
  assert.ok(!a.actions.includes(actionId), 'actions register');
  assert.equal(a.agg, b.agg - 1, 'aggregate');
  assert.equal(a.ins, b.ins - 1, 'insights');
  assert.equal(Number(a.comp), Number(b.comp) - 1, 'compliance');
  assert.notDeepEqual(a.score, b.score, 'score inputs change');
  assert.equal(await mdb.getMeeting(r.id), null, 'getMeeting 404s');
  assert.equal(await mdb.getMeetingStatus(r.id), null);
  assert.equal(await mdb.getActionParent(actionId), null);
  assert.equal(await mdb.getIssueParent(issueId), null);
  const row = await mdb.getMeetingTrashRow(r.id);
  assert.equal(row.delete_reason, 'wrong department');
  assert.equal(Number(row.deleted_by), 3);
  assert.ok((await mdb.listDeletedMeetings()).some((x) => Number(x.id) === r.id));
  const ex = await mdb.exportRows({});
  assert.ok(!ex.meetings.some((m) => Number(m.id) === r.id) && !ex.actions.some((x) => Number(x.id) === actionId));
});

test('saving a PV whose id / reference / month matches a deleted PV is refused with CONFLICT naming the restore path', async () => {
  const r = await mdb.saveMeeting(pv('HR', '2026-05-12'), null, 1);
  await mdb.deleteMeeting(r.id, { soft: true });
  const conflict = (e) => e.code === 'CONFLICT' && /deleted on .* ask an administrator to restore it/.test(e.message);
  await assert.rejects(() => mdb.saveMeeting({ id: r.id, ...pv('HR', '2026-05-12') }, null, 1), conflict, 'by id');
  await assert.rejects(() => mdb.saveMeeting(pv('HR', '2026-05-20', { reference: r.reference }), null, 1), conflict, 'by reference');
  await assert.rejects(() => mdb.saveMeeting(pv('HR', '2026-05-28'), null, 1), conflict, 'by month fallback / generated reference');
  assert.equal(await mdb.getMeeting(r.id), null, 'not resurrected');
});

test('restore brings the PV back with the same action ids (origin_id references resolve again)', async () => {
  const r = await mdb.saveMeeting(pv('Finance', '2026-06-08'), null, 1);
  const actionId = Number((await mdb.getMeeting(r.id)).actions[0].id);
  await mdb.deleteMeeting(r.id, { soft: true });
  assert.equal(await mdb.restoreMeeting(r.id), true);
  const back = await mdb.getMeeting(r.id);
  assert.equal(Number(back.actions[0].id), actionId, 'same action id');
  assert.ok(await mdb.getActionParent(actionId));
  assert.ok(ids(await mdb.listActions({ site: SITE })).includes(actionId));
  assert.equal(await mdb.restoreMeeting(r.id), false, 'restoring a live PV is a no-op');
});

test('purge: dry run lists, apply hard-deletes PVs past retention only', async () => {
  const r = await mdb.saveMeeting(pv('Security', '2026-07-08'), null, 1);
  await mdb.deleteMeeting(r.id, { soft: true });
  const later = new Date(Date.now() + 40 * 86400000);
  const dry = await ops.purge({ cfg: {}, now: later, modules: ['meetings'] });
  assert.ok(dry.modules.meetings.ids.includes(r.id));
  assert.ok(await mdb.getMeetingTrashRow(r.id));
  const now = await ops.purge({ apply: true, cfg: {}, modules: ['meetings'] });
  assert.ok(!now.modules.meetings.ids.includes(r.id), 'fresh stamp kept');
  const run = await ops.purge({ apply: true, cfg: {}, now: later, modules: ['meetings'] });
  assert.ok(run.modules.meetings.purged >= 1);
  assert.equal(await mdb.getMeetingTrashRow(r.id), null);
});
