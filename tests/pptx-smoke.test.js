'use strict';
// Force the sqlite backends: these suites boot the app against throwaway sqlite DBs and must stay
// green regardless of the dev .env (which points prod-like *_BACKEND=postgres).
for (const k of ['REPORTS_BACKEND','ASSETS_BACKEND','TRACKER_BACKEND','MEETINGS_BACKEND','INSPECTION_BACKEND']) process.env[k] = 'sqlite';

// PPTX generator smoke tests (audit 7.3) — depth B (deep OOXML validation
// via jszip), scope S1 (self-contained generators: tracker / inspection /
// meetings). For each generator we build a minimal fixture, generate, and
// assert the result is a non-empty, valid .pptx zip containing at least one
// slide in ppt/presentation.xml.
//
// Real lookups + a real tracker D come from the *-db modules pointed at a
// throwaway temp dir (SDP_DATA_DIR), so nothing touches dev/prod data/.

const { test, before } = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const JSZip  = require('jszip');

// Env must be set before the *-db modules load (they read DATA_DIR at require).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdp-pptx-smoke-'));
process.env.SDP_DATA_DIR = TMP;
process.env.DASH_USER = process.env.DASH_USER || 'smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'smoke-pass-0000';
// NOTE: tracker left in legacy mode (no TRACKER_PER_YEAR_EDITS) so loadTracker()
// returns a fully-seeded D (activeSites + activities) for the deck.

const trackerDb     = require('../tracker-db');
const inspectionDb  = require('../inspection-db');
const meetingsDb    = require('../meetings-db');
const trackerPptx   = require('../tracker-pptx');
const inspectionPptx = require('../inspection-pptx');
const meetingsPptx  = require('../meetings-pptx');

async function assertValidPptx(buf, label) {
  assert.ok(Buffer.isBuffer(buf), `${label}: not a Buffer`);
  assert.ok(buf.length > 0, `${label}: empty buffer`);
  assert.strictEqual(buf.slice(0, 2).toString('latin1'), 'PK', `${label}: not a zip (no PK signature)`);
  const zip  = await JSZip.loadAsync(buf);
  const pres = zip.file('ppt/presentation.xml');
  assert.ok(pres, `${label}: missing ppt/presentation.xml`);
  const xml = await pres.async('string');
  assert.match(xml, /sldId/, `${label}: presentation.xml has no slides`);
}

let D, inspLookups, mtgLookups;

before(async () => {
  D           = (await trackerDb.loadTracker());
  inspLookups = (await inspectionDb.loadLookups());
  mtgLookups  = (await meetingsDb.loadLookups());
});

test('tracker-pptx — generateTrackerPptx produces a valid deck', async () => {
  const yr    = (D.years && D.years[0]) || 2026;
  const mo    = D.currentMonth || D.current_month || 1;
  const sites = (D.activeSites || []).slice();
  assert.ok(sites.length, 'fixture: tracker seed has no active sites');
  const buf = await trackerPptx.generateTrackerPptx(D, sites, yr, mo);
  await assertValidPptx(buf, 'tracker');
});

test('inspection-pptx — generateInspectionPptx produces a valid deck', async () => {
  const rec = {
    header: {
      id: 'EM-IT-SMOKE-1', site_code: 'HGO', area_code: 'datacenter', area_text: 'Data Center',
      inspection_date: '2026-06-01', inspection_time: '09:00', inspection_type: 'Routine',
      inspector_name: 'Smoke Test', overall_risk: 'low', key_observations: 'none',
    },
    findings: [], actions: [], signatures: [], photos: [],
  };
  const buf = await inspectionPptx.generateInspectionPptx(rec, inspLookups);
  await assertValidPptx(buf, 'inspection');
});

test('meetings-pptx — generatePvPptx produces a valid deck', async () => {
  const meeting = {
    id: 1, reference: 'HGO_Maintenance_PV_2026-06', site_code: 'HGO', department: 'maintenance',
    status: 'signed', meeting_date: '2026-06-01', department_head: 'Smoke', site_it_lead: 'Smoke',
    priority_1: '', priority_2: '', priority_3: '',
    issues: [], actions: [], projects: [],
  };
  const buf = await meetingsPptx.generatePvPptx(meeting, mtgLookups);
  await assertValidPptx(buf, 'meetings-pv');
});

test('meetings-pptx — generateProgressPptx produces a valid deck', async () => {
  const progress = {
    site: 'HGO', department: 'maintenance', current: null, previous: null,
    standing: [], resolved: [], new_items: [],
    actions_standing: [], actions_resolved: [], actions_new: [],
    escalations: [], updates_since: [], meeting_history: [],
    summary: { standing_total: 0, standing_high: 0, resolved_total: 0, new_total: 0,
               escalated_open: 0, actions_standing: 0, actions_resolved: 0, actions_new: 0 },
  };
  const buf = await meetingsPptx.generateProgressPptx(progress, mtgLookups);
  await assertValidPptx(buf, 'meetings-progress');
});
