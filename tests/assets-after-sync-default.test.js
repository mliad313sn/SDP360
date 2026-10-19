'use strict';
// afterAssetsSync with sendAlerts:true through the DEFAULT deps path (no override):
// the real snapshotEffort / recordAssetSightings run against a throwaway sqlite, and
// the real send-asset-reminders core is called IN-PROCESS with the alert disarmed
// (default config). It must resolve, never throw, never log an error, and never
// process.exit (which would kill the server's nightly chain).
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sdp-after-sync-'));
for (const k of ['REPORTS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND', 'ASSETS_BACKEND']) process.env[k] = 'sqlite';
// A fresh reports.db seeds a default admin from these (throwaway dir, dummy values).
process.env.DASH_USER = process.env.DASH_USER || 'test-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'test-only-pass-123';

const test = require('node:test');
const assert = require('node:assert');
const sync = require('../assets-sync');

test('default deps + sendAlerts:true + alert disarmed → resolves, no error, no exit', async () => {
  const errors = [];
  const origErr = console.error;
  const origExit = process.exit;
  let exited = false;
  console.error = (...a) => { errors.push(a.join(' ')); };
  process.exit = () => { exited = true; };
  let out;
  try {
    out = await sync.afterAssetsSync([{ name: 'assets', rows: 0 }], { sendAlerts: true });
  } finally {
    console.error = origErr;
    process.exit = origExit;
  }
  assert.deepStrictEqual(errors, [], 'nothing logged as an error');
  assert.strictEqual(exited, false, 'the in-process call never calls process.exit');
  assert.ok(out && out.alerts, 'the alert step ran');
  assert.strictEqual(out.alerts.reason, 'disabled');
  assert.strictEqual(out.alerts.sent, 0);
});
