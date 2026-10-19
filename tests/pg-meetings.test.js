'use strict';
// Chunk 2 — meetings.db → PostgreSQL. TDD suite. Runs the postgres backend
// against a throwaway DB; skips cleanly when Postgres is unreachable.
process.env.MEETINGS_BACKEND = 'postgres';
// loadLookups requires reports-db.js, which opens its sqlite DB + seeds a default
// admin at module-load (FATAL without these). Isolate + supply throwaway creds.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'mtg-'));
process.env.DASH_USER = process.env.DASH_USER || 'pgtest-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'pgtest-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');
const SCHEMA = require('fs').readFileSync(
  require('path').join(__dirname, '../db/postgres/meetings/001_init.sql'), 'utf8');

// Boot a meetings pg handle against a fresh test DB (schema + seed applied).
async function boot() {
  const ctx = await provisionTestDb();
  if (!ctx) return null;
  process.env.PG_URL = ctx.url;
  const mdb = require('../meetings-db');
  await mdb.initPgMeetings();
  return { ctx, mdb };
}

test('meetings pg: schema idempotent + lookups seeded + survey relabel', async (t) => {
  const b = await boot();
  if (!b) return t.skip('Postgres not reachable');
  const { ctx, mdb } = b;
  const h = mdb.pgHandle();
  try {
    await h.exec(SCHEMA);   // re-apply schema through the same handle — must be idempotent
    const tbls = await h.prepare(
      `SELECT count(*)::int n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name LIKE 'md_%'`).get();
    assert.ok(tbls.n >= 18, `expected >=18 md_ tables, got ${tbls.n}`);
    const cats = await h.prepare('SELECT count(*)::int n FROM md_categories').get();
    assert.ok(cats.n > 0, 'lookups seeded');
    const sv = await h.prepare(`SELECT name_en FROM md_intake_sources WHERE code='survey'`).get();
    if (sv) assert.equal(sv.name_en, 'IT Survey', 'survey relabel applied');
  } finally { try { await h.close(); } catch {} await dropTestDb(ctx); }
});

// ── Read-path forks: loadLookups + getMeeting/list/count/status/idByRef ─────
test('pg meetings read-path (seed via pgHandle)', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, mdb } = b; const h = mdb.pgHandle();
  try {
    const lk = await mdb.loadLookups();
    assert.ok(lk.categories.length > 0 && lk.statuses.length > 0, 'lookups seeded');
    const m = await h.prepare(`INSERT INTO md_meetings (reference, site_code, department, meeting_date, status, department_head)
                               VALUES ('HGO_Maintenance_PV_2026-05','HGO','Maintenance','2026-05-10','submitted','Chef')`).run();
    const mid = m.lastID;
    await h.prepare(`INSERT INTO md_issues (meeting_id, title, category, severity, escalate, status) VALUES (?,?,?,?,?,?)`)
      .run(mid, 'Net down', 'CN', 'HIGH', 1, 'open');
    await h.prepare(`INSERT INTO md_actions (meeting_id, description, status) VALUES (?,?,?)`).run(mid, 'Fix it', 'open');
    const full = await mdb.getMeeting(mid);
    assert.equal(full.header.reference, 'HGO_Maintenance_PV_2026-05');
    assert.equal(full.issues.length, 1); assert.equal(full.actions.length, 1);
    const list = await mdb.listMeetings({ site: 'HGO' });
    assert.equal(list.length, 1);
    assert.equal(list[0].issue_count, 1); assert.equal(typeof list[0].issue_count, 'number');
    assert.equal(list[0].high_issue_count, 1); assert.equal(list[0].escalated_count, 1);
    assert.equal(await mdb.countMeetings({ site: 'HGO' }), 1);
    assert.equal((await mdb.listMeetings({ q: 'maintenance' })).length, 1, 'ILIKE q is case-insensitive');
    assert.equal((await mdb.getMeetingStatus(mid)).status, 'submitted');
    assert.equal(await mdb.getMeetingIdByReference('HGO_Maintenance_PV_2026-05'), mid);
  } finally { try { await mdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

// ── saveMeeting fork: round-trip + defensive children + dedup + cross-site ──
test('pg saveMeeting: create round-trip + header-only preserves children + dedup + cross-site', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, mdb } = b;
  try {
    const r = await mdb.saveMeeting({
      header: { site_code: 'HGO', department: 'Maintenance', meeting_date: '2026-05-10', status: 'submitted', department_head: 'Chef' },
      issues: [{ title: 'Net down', category: 'CN', severity: 'HIGH', escalate: 1, status: 'open' }],
      actions: [{ description: 'Fix it', status: 'open', linked_issue_ord: 1 }],
    }, null, 1);
    assert.ok(r.id && r.created, 'created');
    let full = await mdb.getMeeting(r.id);
    assert.equal(full.issues.length, 1); assert.equal(full.actions.length, 1);
    assert.equal(full.actions[0].linked_issue_id, full.issues[0].id, 'linked_issue_ord → id');
    assert.equal(full.updates.length, 1, 'issue-created audit row');
    // header-only PATCH (no issues/actions arrays) preserves children
    await mdb.saveMeeting({ id: r.id, header: { ...full.header, status: 'signed' } }, null, 1);
    full = await mdb.getMeeting(r.id);
    assert.equal(full.header.status, 'signed');
    assert.equal(full.issues.length, 1, 'children preserved on header-only save');
    assert.equal(full.actions.length, 1);
    // logical-identity dedup: same site/dept/month → UPDATE, not duplicate
    const r2 = await mdb.saveMeeting({ header: { site_code: 'HGO', department: 'Maintenance', meeting_date: '2026-05-20', status: 'draft' }, issues: [] }, null, 1);
    assert.equal(r2.id, r.id, 'logical-identity dedup → same row');
    assert.equal(await mdb.countMeetings({ site: 'HGO' }), 1, 'no duplicate row');
    // cross-site guard (editor scoped to MGO cannot write HGO)
    await assert.rejects(mdb.saveMeeting({ id: r.id, header: { site_code: 'HGO', department: 'Maintenance', meeting_date: '2026-05-20' } }, 'MGO', 1), /Cross-site/);
  } finally { try { await mdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

// ── issue/action updates + parents + list/escalations ───────────────────────
test('pg issues/actions: updates + parents + list + escalations', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, mdb } = b;
  try {
    const r = await mdb.saveMeeting({
      header: { site_code: 'HGO', department: 'IT', meeting_date: '2026-05-10', status: 'submitted' },
      issues: [{ title: 'VPN flaky', category: 'CN', severity: 'HIGH', escalate: 0, status: 'open' }],
      actions: [{ description: 'Replace router', status: 'open' }],
    }, null, 1);
    const full = await mdb.getMeeting(r.id);
    const issueId = full.issues[0].id, actionId = full.actions[0].id;
    await mdb.addIssueUpdate(issueId, { author_name: 'me', body: 'escalating', status_change: 'in_progress', escalate_change: 1 });
    const af = await mdb.getMeeting(r.id);
    assert.equal(af.issues[0].status, 'in_progress'); assert.equal(af.issues[0].escalate, 1);
    assert.ok(af.updates.length >= 2, 'audit rows accrue');
    const high = await mdb.listIssues({ site: 'HGO', severity: 'HIGH' });
    assert.equal(high.length, 1); assert.equal(high[0].meeting_reference, full.header.reference);
    assert.equal((await mdb.listEscalations({ site: 'HGO' })).length, 1, 'escalated issue shows in escalations');
    assert.equal((await mdb.getIssueParent(issueId)).site_code, 'HGO');
    assert.equal((await mdb.getActionParent(actionId)).site_code, 'HGO');
    await mdb.addActionUpdate(actionId, { author_name: 'me', status_change: 'resolved' });
    assert.ok((await mdb.listActionUpdates(actionId)).length >= 1);
    const af2 = await mdb.getMeeting(r.id);
    assert.equal(af2.actions[0].status, 'resolved'); assert.ok(af2.actions[0].closed_at, 'closed_at stamped');
  } finally { try { await mdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

// ── Audit 2026-09-05 (F1/F2/F4) — pg parity of the integrity fixes ─────────
test('pg audit parity: action ids survive a re-save, reopen clears closed_at, incubation is a distinct session', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, mdb } = b;
  try {
    // F2 — upsert by id: the untouched action keeps its id + audit trail; removed → deleted; new → inserted
    const r = await mdb.saveMeeting({
      header: { site_code: 'HGO', department: 'IT', meeting_date: '2026-08-05', status: 'draft', intake_source: 'dept_meeting' },
      issues: [{ title: 'Standing', category: 'CN', severity: 'HIGH', status: 'open', target_date: '2026-08-02' }],
      actions: [{ description: 'Keep me', status: 'open' }, { description: 'Drop me', status: 'open' }],
    }, null, 1);
    let st = await mdb.getMeeting(r.id);
    const keepId = st.actions[0].id, dropId = st.actions[1].id;
    await mdb.addActionUpdate(keepId, { author_name: 'me', body: 'note', status_change: 'in_progress' });
    st = await mdb.getMeeting(r.id);
    await mdb.saveMeeting({ id: r.id, header: st.header, issues: st.issues, actions: [st.actions[0], { description: 'New one', status: 'open' }] }, null, 1);
    const after = await mdb.getMeeting(r.id);
    const kept = after.actions.find(a => Number(a.id) === Number(keepId));
    assert.ok(kept, 'action id preserved across the re-save');
    assert.equal(kept.status, 'in_progress');
    assert.equal((await mdb.listActionUpdates(keepId)).length, 1, 'its audit trail survived');
    assert.ok(!after.actions.find(a => Number(a.id) === Number(dropId)), 'removed action deleted');
    assert.equal(after.actions.length, 2);
    // F4 — reopen clears closed_at (issue + action)
    const issueId = after.issues[0].id;
    await mdb.addIssueUpdate(issueId, { status_change: 'resolved' });
    assert.ok((await mdb.getMeeting(r.id)).issues[0].closed_at);
    await mdb.addIssueUpdate(issueId, { status_change: 'open' });
    assert.equal((await mdb.getMeeting(r.id)).issues[0].closed_at, null, 'issue reopen clears closed_at');
    await mdb.addActionUpdate(keepId, { status_change: 'closed' });
    await mdb.addActionUpdate(keepId, { status_change: 'open' });
    assert.equal((await mdb.getMeeting(r.id)).actions.find(a => Number(a.id) === Number(keepId)).closed_at, null, 'action reopen clears closed_at');
    // F1 — an incubation in the same site/department/month is a DISTINCT row; a later PV does not adopt it
    const inc = await mdb.saveMeeting({ header: { reference: 'HGO_IT_INC_2026-08', site_code: 'HGO', department: 'IT', meeting_date: '2026-08-20', status: 'submitted', intake_source: 'business_incubation' }, issues: [], actions: [] }, null, 1);
    assert.equal(inc.created, true, 'incubation created, not merged into the PV');
    assert.notEqual(inc.id, r.id);
    const pv2 = await mdb.saveMeeting({ header: { reference: 'HGO_IT_PV_2026-08_bis', site_code: 'hgo', department: 'it', meeting_date: '2026-08-25', status: 'draft', intake_source: 'dept_meeting' } }, null, 1);
    assert.equal(pv2.id, r.id, 'the PV month-fallback still dedups PV↔PV');
    assert.ok((await mdb.getMeeting(r.id)).actions.length === 2, 'header-only PV re-save preserved the actions');
  } finally { try { await mdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

// ── lookup CRUD + deleteMeeting + resetLookups ──────────────────────────────
test('pg lookups CRUD + deleteMeeting cascade + resetLookups', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, mdb } = b;
  try {
    await mdb.addLookupRow('md_categories', { code: 'ZZ', name_en: 'Zeta', name_fr: 'Zêta', display_order: 99 });
    assert.ok((await mdb.listLookupTable('md_categories', { includeInactive: true })).find(r => r.code === 'ZZ'), 'added row appears');
    await assert.rejects(mdb.addLookupRow('md_categories', { code: 'ZZ', name_en: 'Dup' }), /already exists/);
    await mdb.updateLookupRow('md_categories', 'ZZ', { name_en: 'Zeta2', active: 0 });
    const zz = (await mdb.listLookupTable('md_categories', { includeInactive: true })).find(r => r.code === 'ZZ');
    assert.equal(zz.name_en, 'Zeta2'); assert.equal(zz.active, 0);
    assert.ok(!(await mdb.listLookupTable('md_categories')).find(r => r.code === 'ZZ'), 'inactive hidden by default');
    const r = await mdb.saveMeeting({ header: { site_code: 'HGO', department: 'IT', meeting_date: '2026-05-10', status: 'draft' }, issues: [{ title: 'x', category: 'CN' }] }, null, 1);
    assert.equal(await mdb.deleteMeeting(r.id), true);
    assert.equal(await mdb.getMeeting(r.id), null);
    await mdb.resetLookups();
    assert.ok((await mdb.listLookupTable('md_categories', { includeInactive: true })).length > 0, 'reseeded');
    assert.ok(!(await mdb.listLookupTable('md_categories', { includeInactive: true })).find(r => r.code === 'ZZ'), 'custom ZZ gone after reset');
  } finally { try { await mdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

// ── analytics: listActions + aggregate + compliance ─────────────────────────
test('pg analytics: listActions + aggregate + compliance', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, mdb } = b;
  try {
    await mdb.saveMeeting({ header: { site_code: 'HGO', department: 'IT', meeting_date: '2026-05-10', status: 'signed', submitted_at: '2026-05-11 09:00:00' },
      issues: [{ title: 'A', category: 'CN', severity: 'HIGH', escalate: 1, escalation_reason: 'R', council_theme: 'T', status: 'open' }],
      actions: [{ description: 'Do X', owner_it: 'Bob', status: 'open', target_date: '2020-01-01' }] }, null, 1);
    const acts = await mdb.listActions({ site: 'hgo' });            // lower() case-insensitive
    assert.equal(acts.length, 1); assert.ok(acts[0].meeting_reference);
    assert.equal((await mdb.listActions({ overdue: true })).length, 1, 'overdue (target 2020) flagged');
    const agg = await mdb.aggregate({ site: 'HGO' });
    assert.equal(agg.meetings.total_meetings, 1); assert.equal(typeof agg.meetings.total_meetings, 'number');
    assert.equal(agg.issues.high_issues, 1); assert.equal(agg.issues.total_escalated, 1);
    assert.equal(agg.by_category[0].category, 'CN');
    const comp = await mdb.compliance({ month: '2026-05' });
    assert.equal(comp.per_site.length, 1); assert.equal(comp.per_site[0].site_code, 'HGO');
    assert.equal(comp.per_site[0].diffused_in_48h, 1, 'submitted within 48h');
    assert.equal(comp.escalations.total_escalated, 1); assert.equal(comp.escalations.missing_reason, 0);
  } finally { try { await mdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

// ── analytics: previousMeeting + compareDepartment + monthly summary + insights ─
test('pg analytics: previousMeeting + compareDepartment + getSiteMonthlyMeetingSummary + insights', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, mdb } = b;
  try {
    // Previous PV (April) with one standing-open + one resolved issue.
    await mdb.saveMeeting({
      header: { site_code: 'HGO', department: 'IT', meeting_date: '2026-04-10', status: 'signed', submitted_at: '2026-04-11 09:00:00' },
      issues: [
        { title: 'standing',    category: 'CN', severity: 'HIGH', status: 'open' },
        { title: 'will-resolve', category: 'HW', severity: 'MEDIUM', status: 'resolved', closed_at: '2026-04-20' },
      ] }, null, 1);
    // Current PV (May) with a brand-new open issue.
    const cur = await mdb.saveMeeting({
      header: { site_code: 'HGO', department: 'IT', meeting_date: '2026-05-10', status: 'draft' },
      issues: [{ title: 'new-issue', category: 'CN', severity: 'LOW', status: 'open' }] }, null, 1);

    // previousMeeting — case-insensitive site/dept, before the current date.
    const prev = await mdb.previousMeeting('hgo', 'it', '2026-05-10');
    assert.equal(prev.meeting_date, '2026-04-10', 'previousMeeting picks the April PV');

    // compareDepartment — standing/resolved/new split relative to the previous PV.
    const cmp = await mdb.compareDepartment({ site: 'HGO', department: 'IT', current_id: cur.id });
    assert.equal(cmp.previous.meeting_date, '2026-04-10');
    assert.equal(cmp.summary.standing_total, 2, 'two open issues (April standing + May new)');
    assert.equal(cmp.summary.standing_high, 1, 'one HIGH standing');
    assert.equal(cmp.summary.resolved_total, 1, 'one resolved since previous');
    assert.equal(cmp.summary.new_total, 1, 'one new issue raised after previous PV');

    // getSiteMonthlyMeetingSummary — May snapshot.
    const sm = await mdb.getSiteMonthlyMeetingSummary('HGO', 2026, 5);
    assert.equal(sm.available, true);
    assert.equal(sm.kpis.pvs_held, 1, 'one PV held in May');
    assert.equal(sm.kpis.open_issues, 2);
    assert.equal(sm.kpis.high_open, 1);
    const it = sm.departments.find(d => d.department === 'IT');
    assert.equal(it.status, 'blocked', 'IT has an open HIGH → blocked');
    assert.equal(sm.trend.months.length, 3, '3-month trend window');

    // insights — explicit window so the assertion is run-date independent.
    const ins = await mdb.insights({ from: '2026-01-01', to: '2026-12-31', site: 'HGO' });
    assert.equal(ins.monthly.length, 12, 'backfilled to 12 months');
    assert.ok(ins.by_category.find(c => c.category === 'CN'));
    const lb = ins.site_leaderboard.find(s => s.site === 'HGO');
    assert.equal(lb.meetings, 2, 'two meetings in window');
    const hm = ins.compliance_heatmap.find(h => h.site === 'HGO');
    assert.equal(hm.meetings_count, 2);
    assert.equal(hm.diffused_48h, 1, 'April PV diffused within 48h, May draft not');
  } finally { try { await mdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

// 2026-10-03 — parity: a hand-entered incubation gets an _INC_ reference on pg too and
// never overwrites the month's PV.
test('pg: a hand-entered incubation never overwrites the month PV (_INC_ reference)', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, mdb } = b; const h = mdb.pgHandle();
  try {
    await mdb.loadLookups();
    const pv  = await mdb.saveMeeting({ header: { site_code: 'HGO', department: 'finance', meeting_date: '2026-10-05', status: 'draft', priority_1: 'keep me' } }, null, null);
    const inc = await mdb.saveMeeting({ header: { site_code: 'HGO', department: 'finance', meeting_date: '2026-10-20', intake_source: 'business_incubation', status: 'draft' } }, null, null);
    assert.notEqual(inc.id, pv.id);
    assert.equal((await mdb.getMeeting(inc.id)).header.reference, 'HGO_Finance_INC_2026-10');
    assert.equal((await mdb.getMeeting(pv.id)).header.priority_1, 'keep me');
  } finally { try { await h.close(); } catch {} await dropTestDb(ctx); }
});

test('pg: addActionForIssue creates a linked action + issue audit row', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, mdb } = b; const h = mdb.pgHandle();
  try {
    await mdb.loadLookups();
    const saved = await mdb.saveMeeting({ header: { site_code: 'HGO', department: 'hr', meeting_date: '2026-11-05', status: 'draft' },
      issues: [{ ord: 0, title: 'Badges KO', category: 'HW', severity: 'HIGH', status: 'open' }] }, null, null);
    const issueId = (await mdb.getMeeting(saved.id)).issues[0].id;
    const out = await mdb.addActionForIssue(issueId, { description: 'Remplacer le lecteur', owner_it: 'Awa' }, { author_name: 'T' });
    const after = await mdb.getMeeting(saved.id);
    const a = after.actions.find(x => x.id === out.id);
    assert.equal(a.linked_issue_id, issueId);
    const n = await h.prepare("SELECT count(*)::int n FROM md_issue_updates WHERE issue_id = ? AND body LIKE 'Action ajout%'").get(issueId);
    assert.equal(n.n, 1);
  } finally { try { await h.close(); } catch {} await dropTestDb(ctx); }
});

test('pg: transfer statuses — note + ticket stored, closed like cancelled, reopen clears (2026-10-16)', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, mdb } = b; const h = mdb.pgHandle();
  try {
    const lk = await mdb.loadLookups();
    assert.ok(lk.statuses.some(s => s.code === 'helpdesk_ticket'), 'status seeded on pg');
    const saved = await mdb.saveMeeting({ header: { site_code: 'HGO', department: 'it', meeting_date: '2026-12-05', status: 'draft' },
      issues: [{ ord: 0, title: 'Wifi slow', category: 'CN', status: 'open', target_date: '2026-01-01' }],
      actions: [{ ord: 0, description: 'New laptop', status: 'demand', status_note: 'Hardware request' }] }, null, null);
    const rec = await mdb.getMeeting(saved.id);
    assert.equal(rec.actions[0].status_note, 'Hardware request');
    assert.ok(rec.actions[0].closed_at, 'demand closes the action');
    const audit = await h.prepare('SELECT count(*)::int n FROM md_action_updates WHERE action_id = ?').get(rec.actions[0].id);
    assert.equal(audit.n, 1, 'justification kept in the action audit trail');
    const iss = rec.issues[0];
    await mdb.addIssueUpdate(iss.id, { body: 'SDP 311587', status_change: 'helpdesk_ticket', helpdesk_ticket: '#311587' });
    let i2 = (await mdb.getMeeting(saved.id)).issues[0];
    assert.equal(i2.helpdesk_ticket, '311587'); assert.equal(i2.status_note, 'SDP 311587'); assert.ok(i2.closed_at);
    const sum = await mdb.aggregate({ site: 'HGO' });
    assert.ok(sum, 'aggregate still runs with the new status list');
    await mdb.addIssueUpdate(iss.id, { body: 'reopened', status_change: 'open' });
    i2 = (await mdb.getMeeting(saved.id)).issues[0];
    assert.equal(i2.helpdesk_ticket, null); assert.equal(i2.status_note, null); assert.equal(i2.closed_at, null);
  } finally { try { await h.close(); } catch {} await dropTestDb(ctx); }
});
