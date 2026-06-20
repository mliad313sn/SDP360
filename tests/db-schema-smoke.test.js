'use strict';

// DB schema boot smoke tests (audit 3.5).
// Each *-db.js module builds its DB path from DATA_DIR, which now honours
// the SDP_DATA_DIR env override. We point it at a throwaway temp dir BEFORE
// requiring the modules, so requiring them creates + initialises fresh DBs
// there — never touching data/ (dev or prod). We then assert the key tables
// exist. This proves "module boots, schema initialises, no throw".

const { test, before, after } = require('node:test');
const assert   = require('node:assert');
const fs       = require('fs');
const os       = require('os');
const path     = require('path');
const Database = require('better-sqlite3');

// Must be set BEFORE the modules are required (they read DATA_DIR at load).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdp-db-smoke-'));
process.env.SDP_DATA_DIR = TMP;
// Exercise the current prod tracker mode (per-year) — skips the legacy mirror.
process.env.TRACKER_PER_YEAR_EDITS = '1';
// reports-db refuses first boot without these (it seeds a default admin).
// Throwaway values for the temp DB.
process.env.DASH_USER = process.env.DASH_USER || 'smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'smoke-pass-0000';

function tablesOf(dbFile) {
  const full = path.join(TMP, dbFile);
  assert.ok(fs.existsSync(full), dbFile + ' was not created in the temp dir');
  const db = new Database(full, { readonly: true });
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  db.close();
  return new Set(rows.map(r => r.name));
}

function assertHas(tables, expected, label) {
  for (const t of expected) assert.ok(tables.has(t), `${label}: missing table ${t}`);
}

before(() => {
  // reports-db opens its DB eagerly at require() time. The other three use a
  // lazy connection, so we call one cheap read each to force the connection +
  // schema init against the temp DB.
  require('../reports-db');
  require('../tracker-db').loadTracker();
  require('../inspection-db').loadLookups();
  require('../meetings-db').loadLookups();
});

after(() => {
  // Best-effort cleanup; better-sqlite3 may still hold file handles on
  // Windows, so ignore failures (it's an OS temp dir).
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
});

test('reports-db boots and creates core auth/report tables', () => {
  assertHas(tablesOf('reports.db'),
    ['users', 'sites', 'sessions', 'user_roles', 'audit_log'], 'reports.db');
});

test('tracker-db boots with the v2 per-year schema', () => {
  assertHas(tablesOf('tracker.db'),
    ['tracker_years', 'tracker_pillars', 'tracker_activities', 'tracker_targets_v2', 'tracker_inputs_v2'],
    'tracker.db');
});

test('inspection-db boots with inspection + action-audit tables', () => {
  assertHas(tablesOf('inspection.db'),
    ['insp_inspections', 'insp_findings', 'insp_actions', 'insp_action_updates'], 'inspection.db');
});

test('meetings-db boots with meeting + action-audit tables', () => {
  assertHas(tablesOf('meetings.db'),
    ['md_meetings', 'md_issues', 'md_actions', 'md_action_updates', 'md_departments'], 'meetings.db');
});
