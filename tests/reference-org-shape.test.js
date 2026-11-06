'use strict';
// E-D06 — the SYNTHETIC reference organisation (tests/fixtures/reference-org) loaded into this process's
// throwaway PostgreSQL, then the review-data and site-window readers run on it. This checks the SHAPE the
// readers return on a multi-country, multi-currency, partial-month organisation — not fidelity: the ten
// "no prod-snapshot" tests stay skipped until the data owner approves an anonymised extract.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const FX = require('./fixtures/reference-org/reference-org.json');
const GEN = require('./fixtures/reference-org/generate');

let c, q; const siteId = {};
before(async () => {
  const { Client } = require('pg');
  c = new Client({ connectionString: process.env.PG_URL }); await c.connect();
  q = async (sql, params = []) => { let i = 0; return (await c.query(sql.replace(/\?/g, () => '$' + (++i)), params)).rows; };
  for (const s of FX.sites) siteId[s.name] = (await q('INSERT INTO sites (name, zoho_group, active) VALUES (?, ?, 1) RETURNING id', [s.name, s.zoho_group]))[0].id;
  const mid = {};
  for (const m of FX.meetings) mid[m.reference] = (await q('INSERT INTO md_meetings (reference, site_code, department, meeting_date, status, intake_source) VALUES (?, ?, ?, ?, ?, ?) RETURNING id', [m.reference, m.site_code, m.department, m.meeting_date, m.status, m.intake_source]))[0].id;
  for (const i of FX.issues) await q('INSERT INTO md_issues (meeting_id, title, category, severity, status, target_date, closed_at, champion) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [mid[i.meeting], i.title, i.category, i.severity, i.status, i.target_date, i.closed_at, i.champion]);
  for (const a of FX.actions) await q('INSERT INTO md_actions (meeting_id, description, status, target_date) VALUES (?, ?, ?, ?)', [mid[a.meeting], a.description, a.status, a.target_date]);
  for (const p of FX.projects) await q('INSERT INTO md_meeting_projects (meeting_id, project_name, phase, target_end) VALUES (?, ?, ?, ?)', [mid[p.meeting], p.project_name, p.phase, p.target_end]);
  for (const x of FX.inspections) await q('INSERT INTO insp_inspections (id, site_code, inspection_date, status) VALUES (?, ?, ?, ?)', [x.id, x.site_code, x.inspection_date, x.status]);
  for (const f of FX.findings) await q('INSERT INTO insp_findings (inspection_id, category, item_index, status) VALUES (?, ?, ?, ?)', [f.inspection_id, f.category, f.item_index, f.status]);
  for (const a of FX.inspActions) await q('INSERT INTO insp_actions (inspection_id, ord, description, priority, status) VALUES (?, ?, ?, ?, ?)', [a.inspection_id, a.ord, a.description, a.priority, a.status]);
  for (const t of FX.tickets) await q('INSERT INTO request_records (request_id, display_id, subject, tech_group, site, request_status, pending_status, overdue_status, request_type, created_time, resolved_time) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [t.request_id, t.display_id, t.subject, t.tech_group, t.site, t.request_status, t.pending_status, t.overdue_status, t.request_type, t.created_time, t.resolved_time]);
  for (const x of FX.changes) await q('INSERT INTO change_records (change_id, display_id, subject, status, group_name, created_time, udf_json) VALUES (?,?,?,?,?,?,?)', [x.change_id, x.display_id, x.subject, x.status, x.group_name, x.created_time, x.udf_json]);
});
after(async () => { if (c) await c.end(); });

test('the committed fixture is what the generator writes (synthetic, deterministic)', () => {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(GEN.build())), FX);
  assert.match(FX.note, /SYNTHETIC/);
  assert.equal(new Set(FX.sites.map((s) => s.country)).size, 5);
  assert.deepStrictEqual([...new Set(FX.sites.map((s) => s.currency))].sort(), ['GBP', 'XOF']);
  assert.ok(FX.sites.some((s) => s.tz === 'Europe/London'));
  assert.ok(FX.meetings.filter((m) => m.meeting_date.startsWith('2026-09')).every((m) => m.meeting_date <= '2026-09-10'), 'partial last month');
});

test('loadReviewData returns the 7 arrays with the fields the model reads, on the synthetic org', async () => {
  const D = await require('../services/reviewData').loadReviewData('2026-09-10');
  assert.deepStrictEqual(Object.keys(D).sort(), ['actions', 'findings', 'inspActions', 'inspections', 'issues', 'meetings', 'projects']);
  const mine = (rows) => rows.filter((r) => String(r.site_code || '').startsWith('R') && FX.sites.some((s) => s.code === r.site_code));
  assert.equal(mine(D.meetings).length, FX.meetings.length);
  assert.equal(mine(D.issues).length, FX.issues.length);
  assert.equal(mine(D.actions).length, FX.actions.length);
  assert.equal(mine(D.projects).length, FX.projects.length);
  assert.equal(mine(D.inspections).length, FX.inspections.length);
  assert.equal(mine(D.findings).length, FX.findings.length);
  assert.equal(mine(D.inspActions).length, FX.inspActions.length);
  for (const k of ['id', 'reference', 'site_code', 'department', 'meeting_date', 'status', 'intake_source']) assert.ok(k in D.meetings[0], 'meetings.' + k);
  for (const k of ['status', 'closed_at', 'target_date', 'severity', 'site_code', 'meeting_date', 'updated_at']) assert.ok(k in D.issues[0], 'issues.' + k);
  for (const i of mine(D.issues)) assert.match(String(i.updated_at), /^\d{4}-\d{2}-\d{2}/, 'updated_at is an ISO string (to_char cast)');
  for (const f of mine(D.findings)) assert.ok(f.site_code && f.inspection_date, 'findings carry their parent site/date');
});

test('site-window readers: group-scoped shape per site, BST-edge ticket counted on its UTC date', async () => {
  const rdb = require('../reports-db');
  for (const s of FX.sites) {
    const hd = await rdb.getSiteHelpdeskWindow(siteId[s.name], '2026-08-01', '2026-08-31');
    for (const k of ['created', 'resolved', 'backlog', 'sla_overdue', 'major_incidents', 'top_categories', 'avg_resolution_h', 'scoped']) assert.ok(k in hd, s.name + ' ' + k);
    assert.equal(hd.scoped, true);
    const expect = FX.tickets.filter((t) => t.tech_group === s.zoho_group && t.created_time.slice(0, 10) >= '2026-08-01' && t.created_time.slice(0, 10) <= '2026-08-31').length;
    assert.equal(hd.created, expect, s.name);
    const ch = await rdb.getSiteChangesWindow(siteId[s.name], '2026-06-01', '2026-09-10');
    assert.ok(ch && typeof ch === 'object', s.name + ' changes');
  }
  const lon = await rdb.getSiteHelpdeskWindow(siteId['Ref London Office'], '2026-09-01', '2026-09-30');
  assert.equal(lon.created, FX.tickets.filter((t) => t.tech_group === 'Ref London Office IT Agents' && t.created_time >= '2026-09').length, 'UTC bucketing today: the 23:30 UTC ticket stays in August');
  const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date('2026-08-31T23:30:00.000Z'));
  assert.equal(local, '2026-09-01', 'the same ticket is 1 September in London local time (BST)');
});

test('currency map resolves both site currencies', () => {
  const CUR = require('../services/currency');
  const m = CUR.parseCurrencyMap(JSON.stringify(FX.currency_map));
  assert.equal(CUR.resolveSiteCurrency('Ref London Office', m), 'GBP');
  assert.equal(CUR.resolveSiteCurrency('Ref Sabodala', m), 'XOF');
});
