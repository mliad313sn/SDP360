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

before(() => { mdb.loadLookups(); });

test('fresh DB seeds the business_incubation intake_source', () => {
  const lk = mdb.loadLookups();
  const codes = (lk.intake_sources || []).map(r => r.code);
  assert.ok(codes.includes('business_incubation'), 'intake_sources should include business_incubation');
});

test('setMeetingIncubation → getMeeting round-trips the extras blob (parsed)', () => {
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
  const saved = mdb.saveMeeting(state, null, null);
  assert.ok(saved && saved.id, 'saveMeeting returns an id');

  const incubation = {
    roles: { incubator: 'VEH FREDERIC MAIKA', incubation_manager: 'GHISLAIN GOGOUA', it_manager: 'FEGBO ERIC' },
    business_description: 'La géologie minière…',
    flow: [{ incoming: 'Données de forage', activity: 'Analyse & planification', outgoing: 'Modèles géologiques' }],
    services: [{ service: 'Data Mobile', beneficiary: 'Tous les départements', status: 'Actif' }],
  };
  mdb.setMeetingIncubation(saved.id, incubation);

  const rec = mdb.getMeeting(saved.id);
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

test('a normal PV keeps incubation null (no distortion of the regular path)', () => {
  const saved = mdb.saveMeeting({
    header: { reference: 'HGO_Mining_PV_2026-08', site_code: 'HGO', department: 'mining', meeting_date: '2026-08-05', status: 'draft' },
    issues: [], actions: [],
  }, null, null);
  const rec = mdb.getMeeting(saved.id);
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

test('buildTemplate → parseBuffer round-trips all 4 sheets', () => {
  const lk = mdb.loadLookups();
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
  assert.ok(s.incubation.roles.incubation_manager);
});

test('parseBuffer rejects unknown site + commit refuses while errors present', async () => {
  const lk = mdb.loadLookups();
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
  const lk = mdb.loadLookups();
  const buf = inc.buildTemplate(lk);
  const parsed = inc.parseBuffer(buf, lk);
  const ref = parsed.sessions[0].header.reference;

  const r1 = await inc.commit(parsed, mdb, {});
  assert.equal(r1.created + r1.updated, 1);
  assert.equal(r1.challenges, 1);

  // fetch it back
  const list = mdb.listMeetings ? mdb.listMeetings({ q: ref }) : null;
  const found = (list && (list.rows || list) || []).find(m => m.reference === ref);
  assert.ok(found, 'the committed session is listable');
  const rec = mdb.getMeeting(found.id);
  assert.equal(rec.header.intake_source, 'business_incubation');
  assert.ok(rec.header.incubation && rec.header.incubation.services.length === 1);
  assert.equal(rec.issues.length, 1);

  // re-commit the SAME workbook → updates in place, no duplicate
  const r2 = await inc.commit(inc.parseBuffer(buf, lk), mdb, {});
  assert.equal(r2.created, 0, 're-commit creates nothing new');
  assert.equal(r2.updated, 1, 're-commit updates the existing session');
});
