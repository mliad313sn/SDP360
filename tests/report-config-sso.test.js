'use strict';
// F2a Task 1 — Entra SSO keys in report_config: present in DEFAULTS (so setConfig's
// KEYS filter accepts them) + entra_client_secret is blank-kept on save like smtp_pass.
const os = require('os'), fs = require('fs'), path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'rcfg-sso-'));
process.env.REPORTS_BACKEND = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'rcfg-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'rcfg-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const cfg = require('../services/reportConfig');

const SSO_KEYS = ['sso_mode', 'entra_tenant_id', 'entra_client_id', 'entra_client_secret',
  'entra_redirect_uri', 'sso_breakglass_user'];

test('SSO keys are in DEFAULTS + KEYS (so setConfig accepts them)', () => {
  for (const k of SSO_KEYS) {
    assert.ok(k in cfg.DEFAULTS, `${k} missing from DEFAULTS`);
    assert.ok(cfg.KEYS.includes(k), `${k} missing from KEYS`);
  }
});

test('blank entra_client_secret is kept (not wiped), like smtp_pass', () => {
  const db = new Database(':memory:');
  cfg.setConfig(db, { entra_client_secret: 'SECRET-1', entra_client_id: 'cid' }, 'u');
  cfg.setConfig(db, { entra_client_secret: '', entra_client_id: 'cid2' }, 'u'); // blank = keep
  const c = cfg.getConfig(db);
  assert.equal(c.entra_client_secret, 'SECRET-1', 'blank secret must keep the stored value');
  assert.equal(c.entra_client_id, 'cid2', 'other fields still update');
});
