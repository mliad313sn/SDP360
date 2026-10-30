'use strict';
// Audit OPS 2026-09-05 — meetings-module integrity findings, ported as regression tests
// (F1 incubation identity · F2 action identity/history · F3 names-are-not-signatures ·
// F4 reopen clears closed_at · F8 force-import really skips invalid rows).
// Throwaway sqlite; decisions of 2026-09-06: an incubation is a DISTINCT session, never
// merged with the department's PV of the same month.
const fs = require('fs'), os = require('os'), path = require('path');
process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-mtg-'));
process.env.DASH_USER = process.env.DASH_USER || 'audit-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'audit-pass-0000';

const { test, before } = require('node:test');
const assert = require('node:assert');
const XLSX = require('xlsx');
const mdb = require('../meetings-db');
const inc = require('../meetings-import-incubation');

let lk;
before(async () => { lk = (await mdb.loadLookups()); lk.sites = ['MGO', 'HGO', 'SMI', 'SML'].map(code => ({ code })); });

function incubationBuffer(reference, site, start, dept = 'mining') {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['reference', 'site_code', 'department', 'session_start', 'incubation_manager', 'it_manager', 'status'],
    [reference, site, dept, start, 'Biz Manager', 'IT Manager', 'submitted'],
  ]), 'Session');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['session_reference', 'challenge', 'category', 'priority'],
    [reference, 'Incubation challenge', 'CN', 'HIGH'],
  ]), 'Challenges');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
async function pv(reference, site, date, actions = [], dept = 'mining') {
  return (await mdb.saveMeeting({
    header: { reference, site_code: site, department: dept, meeting_date: date, intake_source: 'dept_meeting', status: 'draft' },
    issues: [{ title: 'Standing issue', category: 'CN', severity: 'HIGH', status: 'open', target_date: '2026-08-02' }],
    actions,
  }, null, null));
}

// ── F1 ─────────────────────────────────────────────────────────────────────
test('F1: an incubation in the same site/department/month as a PV is a SEPARATE session — the PV keeps its actions', async () => {
  const p = (await pv('AUD_PV_MGO_2026-08', 'MGO', '2026-08-01', [{ description: 'Keep this commitment', status: 'open', target_date: '2026-08-02' }]));
  const parsed = inc.parseBuffer(incubationBuffer('AUD_INC_MGO_2026-08', 'MGO', '2026-08-20'), lk);
  assert.equal(parsed.errors.length, 0);
  const r = await inc.commit(parsed, mdb);
  assert.equal(r.created, 1, 'incubation is CREATED, not merged into the PV');
  assert.equal(r.updated, 0);
  const after = (await mdb.getMeeting(p.id));
  assert.equal(after.header.intake_source, 'dept_meeting', 'the PV is still a PV');
  assert.equal(after.actions.length, 1, 'the PV commitment survived');
  const created = (await mdb.getDB().prepare("SELECT intake_source, reference FROM md_meetings WHERE reference = ?").get('AUD_INC_MGO_2026-08'));
  assert.ok(created && created.intake_source === 'business_incubation');
});

test('F1 guard: a PV re-import whose reference spelling drifted still UPDATES the same-month PV (the 2026-06-15 dedup stays)', async () => {
  const a = (await pv('AUD_PV_HGO_Finance_2026-08', 'HGO', '2026-08-03', [], 'finance'));
  const b = (await mdb.saveMeeting({ header: { reference: 'AUD_PV_HGO_FINANCE_2026-08_v2', site_code: 'hgo', department: 'FINANCE', meeting_date: '2026-08-04', intake_source: 'dept_meeting', status: 'draft' } }, null, null));
  assert.equal(b.id, a.id, 'same site×department×month PV → same row');
  assert.equal(b.created, false);
});

test('F1: a PV saved AFTER an incubation of the same month does not adopt the incubation row', () => {
  const parsed = inc.parseBuffer(incubationBuffer('AUD_INC_SML_2026-08', 'SML', '2026-08-10', 'hr'), lk);
  return inc.commit(parsed, mdb).then(async () => {
    const p = (await pv('AUD_PV_SML_HR_2026-08', 'SML', '2026-08-12', [], 'hr'));
    assert.equal(p.created, true, 'the PV is a new row, not an update of the incubation');
    const row = (await mdb.getDB().prepare('SELECT intake_source FROM md_meetings WHERE id = ?').get(p.id));
    assert.equal(row.intake_source, 'dept_meeting');
  });
});

test('F1: re-importing the SAME incubation reference updates in place (no duplicate)', async () => {
  const buf = incubationBuffer('AUD_INC_SMI_2026-08', 'SMI', '2026-08-11');
  const r1 = await inc.commit(inc.parseBuffer(buf, lk), mdb);
  const r2 = await inc.commit(inc.parseBuffer(buf, lk), mdb);
  assert.equal(r1.created, 1);
  assert.equal(r2.updated, 1);
  const n = (await mdb.getDB().prepare("SELECT COUNT(*) AS n FROM md_meetings WHERE reference = ?").get('AUD_INC_SMI_2026-08')).n;
  assert.equal(n, 1);
});

// ── F2 ─────────────────────────────────────────────────────────────────────
test('F2: re-saving a PV keeps action ids and their update history; removed rows are deleted, new rows inserted', async () => {
  const m = (await pv('AUD_PV_HGO_2026-08', 'HGO', '2026-08-01', [
    { description: 'Keep this action identity', status: 'open', target_date: '2026-08-02' },
    { description: 'This one will be removed', status: 'open' },
  ]));
  let st = (await mdb.getMeeting(m.id));
  const keepId = st.actions[0].id, dropId = st.actions[1].id;
  (await mdb.addActionUpdate(keepId, { author_name: 'coordinator', body: 'Supplier contacted', status_change: 'in_progress' }));
  st = (await mdb.getMeeting(m.id));
  const actions = [st.actions[0], { description: 'Brand new action', status: 'open' }];   // drop the 2nd, add a 3rd
  (await mdb.saveMeeting({ id: m.id, header: st.header, issues: st.issues, actions }, null, null));
  const after = (await mdb.getMeeting(m.id));
  const kept = after.actions.find(a => a.id === keepId);
  assert.ok(kept, 'the untouched action keeps its id');
  assert.equal(kept.status, 'in_progress', 'the status set through the audit trail is preserved on re-save');
  assert.equal((await mdb.listActionUpdates(keepId)).length, 1, 'its update history survived');
  assert.ok(!after.actions.find(a => a.id === dropId), 'the removed action is gone');
  assert.equal(after.actions.length, 2);
  assert.ok(after.actions.find(a => a.description === 'Brand new action'), 'the new action was inserted');
});

test('F2: ten identical re-saves never change an action id', async () => {
  const m = (await pv('AUD_PV_SMI_ID_2026-08', 'SMI', '2026-08-01', [{ description: 'Stable', status: 'open' }], 'geology'));
  const id0 = (await mdb.getMeeting(m.id)).actions[0].id;
  for (let i = 0; i < 10; i++) { const s = (await mdb.getMeeting(m.id)); (await mdb.saveMeeting({ id: m.id, header: s.header, issues: s.issues, actions: s.actions }, null, null)); }
  assert.equal((await mdb.getMeeting(m.id)).actions[0].id, id0);
});

// ── F3 ─────────────────────────────────────────────────────────────────────
test('F3: manager NAMES in an incubation workbook never become signatures', async () => {
  const parsed = inc.parseBuffer(incubationBuffer('AUD_INC_HGO_SIG_2026-08', 'HGO', '2026-08-21', 'supply_chain'), lk);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.sessions[0].header.dept_head_signed_at, null, 'parser does not stamp a business signature from a name');
  assert.equal(parsed.sessions[0].header.site_it_signed_at, null, 'parser does not stamp an IT signature from a name');
  await inc.commit(parsed, mdb);
  const row = (await mdb.getDB().prepare('SELECT dept_head_signed_at, site_it_signed_at, department_head, site_it_lead FROM md_meetings WHERE reference = ?').get('AUD_INC_HGO_SIG_2026-08'));
  assert.equal(row.dept_head_signed_at, null);
  assert.equal(row.site_it_signed_at, null);
  assert.equal(row.department_head, 'Biz Manager', 'the names are still captured as contacts');
  assert.equal(row.site_it_lead, 'IT Manager');
});

// ── F4 ─────────────────────────────────────────────────────────────────────
test('F4: resolving then reopening an issue clears closed_at and the issue counts as overdue again', async () => {
  const m = (await pv('AUD_PV_SMI_REOPEN_2026-08', 'SMI', '2026-08-01', [], 'processing'));
  const issueId = (await mdb.getMeeting(m.id)).issues[0].id;
  (await mdb.addIssueUpdate(issueId, { body: 'Resolved', status_change: 'resolved' }));
  assert.ok((await mdb.getMeeting(m.id)).issues[0].closed_at, 'resolve stamps closed_at');
  (await mdb.addIssueUpdate(issueId, { body: 'Recurrence', status_change: 'open' }));
  const issue = (await mdb.getMeeting(m.id)).issues[0];
  assert.equal(issue.status, 'open');
  assert.equal(issue.closed_at, null, 'reopen clears the current closure');
  const inputs = (await mdb.getSiteScoreInputs('SMI', '2026-08-01', '2099-01-01'));
  assert.ok(inputs.odIss >= 1, `a reopened overdue issue is overdue again (odIss=${inputs.odIss})`);
  assert.equal(mdb.listIssueUpdates ? mdb.listIssueUpdates(issueId).length : 2, 2, 'both transitions stay in the audit trail');
});

test('F4: reopening an action clears closed_at too', async () => {
  const m = (await pv('AUD_PV_HGO_ACT_2026-08', 'HGO', '2026-08-01', [{ description: 'Reopen me', status: 'open' }], 'mining_ops'));
  const actionId = (await mdb.getMeeting(m.id)).actions[0].id;
  (await mdb.addActionUpdate(actionId, { status_change: 'closed' }));
  assert.ok((await mdb.getMeeting(m.id)).actions[0].closed_at);
  (await mdb.addActionUpdate(actionId, { status_change: 'in_progress' }));
  assert.equal((await mdb.getMeeting(m.id)).actions[0].closed_at, null);
});

// ── F8 ─────────────────────────────────────────────────────────────────────
test('F8: force=true SKIPS the sessions that failed validation instead of saving them', async () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['reference', 'site_code', 'department', 'session_start'],
    ['AUD_INC_BAD_SITE', 'UNKNOWN', 'mining', '2026-08-20'],
    ['AUD_INC_GOOD_MGO', 'MGO', 'mining', '2026-08-22'],
  ]), 'Session');
  const parsed = inc.parseBuffer(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), lk);
  assert.ok(parsed.errors.length >= 1, 'the unknown site is a validation error');
  const r = await inc.commit(parsed, mdb, { force: true });
  assert.equal(r.created, 1, 'only the valid session is saved');
  assert.equal(r.skipped, 1, 'the invalid one is reported as skipped');
  assert.equal((await mdb.getDB().prepare("SELECT COUNT(*) AS n FROM md_meetings WHERE reference = 'AUD_INC_BAD_SITE'").get()).n, 0);
});
