'use strict';

// Business Incubation — DB layer. A fresh meetings DB must (a) seed the
// `business_incubation` intake_source, and (b) round-trip the incubation extras
// blob through setMeetingIncubation → getMeeting (header.incubation parsed).

const { test, before } = require('node:test');
const assert = require('node:assert');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sdp-mtg-inc-'));
process.env.DASH_USER = process.env.DASH_USER || 'smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'smoke-pass-0000';

const mdb = require('../meetings-db');

before(async () => { (await mdb.loadLookups()); });

test('fresh DB seeds the business_incubation intake_source', async () => {
  const lk = (await mdb.loadLookups());
  const codes = (lk.intake_sources || []).map(r => r.code);
  assert.ok(codes.includes('business_incubation'), 'intake_sources should include business_incubation');
});

test('setMeetingIncubation → getMeeting round-trips the extras blob (parsed)', async () => {
  const state = {
    header: {
      reference: 'SMI_MINERAL_RESOURCES_INC_2026-08', site_code: 'SMI', department: 'mineral_resources',
      meeting_date: '2026-08-20', intake_source: 'business_incubation', status: 'signed',
    },
    issues: [
      { ord: 0, title: 'Radio coverage in the pit', category: 'CN', severity: 'HIGH', status: 'open', champion: 'IT Team' },
    ],
    actions: [],
  };
  const saved = (await mdb.saveMeeting(state, null, null));
  assert.ok(saved && saved.id, 'saveMeeting returns an id');

  const incubation = {
    roles: { incubator: 'VEH FREDERIC MAIKA', incubation_manager: 'GHISLAIN GOGOUA', it_manager: 'FEGBO ERIC' },
    business_description: 'La géologie minière…',
    flow: [{ incoming: 'Données de forage', activity: 'Analyse & planification', outgoing: 'Modèles géologiques' }],
    services: [{ service: 'Data Mobile', beneficiary: 'Tous les départements', status: 'Actif' }],
  };
  (await mdb.setMeetingIncubation(saved.id, incubation));

  const rec = (await mdb.getMeeting(saved.id));
  assert.equal(rec.header.intake_source, 'business_incubation');
  assert.ok(rec.header.incubation, 'header.incubation is present (parsed)');
  assert.equal(rec.header.incubation.roles.incubator, 'VEH FREDERIC MAIKA');
  assert.equal(rec.header.incubation.flow[0].outgoing, 'Modèles géologiques');
  assert.equal(rec.header.incubation.services[0].service, 'Data Mobile');
  // the Défis row became a normal, trackable issue
  assert.equal(rec.issues.length, 1);
  assert.equal(rec.issues[0].title, 'Radio coverage in the pit');
  assert.equal(rec.issues[0].severity, 'HIGH');
});

test('a normal PV keeps incubation null (no distortion of the regular path)', async () => {
  const saved = (await mdb.saveMeeting({
    header: { reference: 'HGO_Mining_PV_2026-08', site_code: 'HGO', department: 'mining', meeting_date: '2026-08-05', status: 'draft' },
    issues: [], actions: [],
  }, null, null));
  const rec = (await mdb.getMeeting(saved.id));
  assert.equal(rec.header.incubation_json, null);
  assert.equal(rec.header.incubation, undefined);
});

// ── Import parser / template / commit ────────────────────────────────────────
const inc = require('../meetings-import-incubation');

test('priority + category mapping (FR/EN labels → codes)', () => {
  assert.equal(inc._priority('Haute'), 'HIGH');
  assert.equal(inc._priority('High'), 'HIGH');
  assert.equal(inc._priority('Moyenne'), 'MEDIUM');
  assert.equal(inc._priority('Basse'), 'LOW');
  const set = new Set(['CN','IN','OT','AP','SC','DR','HW','LV','SD']);
  assert.equal(inc._mapCategory('Radio System', set).code, 'CN');
  assert.equal(inc._mapCategory('4G Network', set).code, 'CN');
  assert.equal(inc._mapCategory('OT', set).code, 'OT');            // exact code wins
  assert.equal(inc._mapCategory('', set).code, 'CN');              // default
  assert.equal(inc._buildRef('SMI', 'mineral_resources', '2026-08-20'), 'SMI_mineral_resources_INC_2026-08');
});

test('buildTemplate → parseBuffer round-trips all 4 sheets', async () => {
  const lk = (await mdb.loadLookups());
  const buf = inc.buildTemplate(lk);
  const parsed = inc.parseBuffer(buf, lk);
  assert.equal(parsed.errors.length, 0, 'template parses clean: ' + JSON.stringify(parsed.errors));
  assert.equal(parsed.sessions.length, 1);
  const s = parsed.sessions[0];
  assert.equal(s.header.intake_source, 'business_incubation');
  assert.equal(s.issues.length, 1);
  assert.equal(s.issues[0].category, 'CN');       // "Radio coverage…" mapped
  assert.equal(s.issues[0].severity, 'HIGH');     // "Haute"
  assert.equal(s.incubation.flow.length, 1);
  assert.equal(s.incubation.services.length, 1);
  assert.equal(s.incubation.services[0].status, 'active', 'template "Active" → closed-list code (2026-10-03)');
  assert.ok(s.incubation.roles.incubation_manager);
});

test('parseBuffer rejects unknown site + commit refuses while errors present', async () => {
  const lk = (await mdb.loadLookups());
  // hand-build a minimal workbook with a bad site
  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['reference','site_code','department','session_start','status'],
    ['', 'NOPE', 'mining', '2026-08-20', 'submitted'],
  ]), 'Session');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const parsed = inc.parseBuffer(buf, lk);
  assert.ok(parsed.errors.some(e => e.field === 'site_code'), 'bad site flagged');
  const res = await inc.commit(parsed, mdb, {});
  assert.equal(res.created, 0);
  assert.ok(res.errors.some(e => /Refusing to commit/.test(e.msg)));
});

test('commit persists a session as meeting + issues + incubation; re-commit is idempotent', async () => {
  const lk = (await mdb.loadLookups());
  const buf = inc.buildTemplate(lk);
  const parsed = inc.parseBuffer(buf, lk);
  const ref = parsed.sessions[0].header.reference;

  const r1 = await inc.commit(parsed, mdb, {});
  assert.equal(r1.created + r1.updated, 1);
  assert.equal(r1.challenges, 1);

  // fetch it back
  const list = mdb.listMeetings ? (await mdb.listMeetings({ q: ref })) : null;
  const found = (list && (list.rows || list) || []).find(m => m.reference === ref);
  assert.ok(found, 'the committed session is listable');
  const rec = (await mdb.getMeeting(found.id));
  assert.equal(rec.header.intake_source, 'business_incubation');
  assert.ok(rec.header.incubation && rec.header.incubation.services.length === 1);
  assert.equal(rec.issues.length, 1);

  // re-commit the SAME workbook → updates in place, no duplicate
  const r2 = await inc.commit(inc.parseBuffer(buf, lk), mdb, {});
  assert.equal(r2.created, 0, 're-commit creates nothing new');
  assert.equal(r2.updated, 1, 're-commit updates the existing session');
});

// 2026-10-03 — an incubation entered by hand (no reference) must NEVER land on the
// month's PV: the auto-reference used to be SITE_Dept_PV_YYYY-MM for both, and the
// reference match then UPDATED the PV with the incubation (audit F1 class).
test('a hand-entered incubation gets its own _INC_ reference and never overwrites the PV', async () => {
  const pv  = (await mdb.saveMeeting({ header: { site_code: 'HGO', department: 'finance', meeting_date: '2026-10-05', status: 'draft', priority_1: 'keep me' } }, null, null));
  const inc = (await mdb.saveMeeting({ header: { site_code: 'HGO', department: 'finance', meeting_date: '2026-10-20', intake_source: 'business_incubation', status: 'draft' } }, null, null));
  assert.notEqual(inc.id, pv.id, 'a distinct record');
  const pvRec = (await mdb.getMeeting(pv.id)).header, incRec = (await mdb.getMeeting(inc.id)).header;
  assert.match(incRec.reference, /^HGO_Finance_INC_2026-10$/);
  assert.match(pvRec.reference, /_PV_2026-10$/);
  assert.equal(pvRec.intake_source || 'dept_meeting', 'dept_meeting', 'the PV is untouched');
  assert.equal(pvRec.priority_1, 'keep me');
  // re-saving the incubation updates itself, not the PV
  const again = (await mdb.saveMeeting({ id: inc.id, header: { id: inc.id, site_code: 'HGO', department: 'finance', meeting_date: '2026-10-20', intake_source: 'business_incubation', status: 'submitted' } }, null, null));
  assert.equal(again.id, inc.id);
});

// 2026-10-05 — « + Action » from the Site Actions hub: an action created FROM an issue is
// linked to it, lands in the issue's own session, and leaves a trace on the issue.
test('addActionForIssue creates a linked action in the issue meeting + an issue audit row', async () => {
  const saved = (await mdb.saveMeeting({ header: { site_code: 'HGO', department: 'hr', meeting_date: '2026-11-05', status: 'draft' },
    issues: [{ ord: 0, title: 'Badges KO', category: 'HW', severity: 'HIGH', status: 'open' }],
    actions: [{ description: 'existing', status: 'open' }] }, null, null));
  const rec = (await mdb.getMeeting(saved.id));
  const issueId = rec.issues[0].id;
  const out = (await mdb.addActionForIssue(issueId, { description: 'Remplacer le lecteur', owner_it: 'Awa', target_date: '2026-11-20' }, { author_name: 'Tester' }));
  assert.ok(out.id);
  const after = (await mdb.getMeeting(saved.id));
  const a = after.actions.find(x => x.id === out.id);
  assert.equal(a.linked_issue_id, issueId);
  assert.equal(a.status, 'open');
  assert.equal(a.owner_it, 'Awa');
  const existing = after.actions.find(x => x.description === 'existing');
  assert.ok(a.ord > existing.ord, 'appended after the existing actions');
  assert.equal(after.actions.length, 2, 'existing actions untouched');
  const upd = (after.updates || []).find(u => u.issue_id === issueId);
  assert.ok(upd && /Remplacer le lecteur/.test(upd.body), 'trace on the issue');
  await assert.rejects(async () => (await mdb.addActionForIssue(issueId, { description: '' })), /description/i);
  await assert.rejects(async () => (await mdb.addActionForIssue(999999, { description: 'x' })), /not found/i);
});
