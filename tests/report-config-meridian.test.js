'use strict';
// F1 Task A1 — Meridian federation config: base_url + two API keys present in
// DEFAULTS (so setConfig's KEYS filter accepts them) + the two keys are secrets,
// blank-kept on save like smtp_pass / entra_client_secret.
const os = require('os'), fs = require('fs'), path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'rcfg-mer-'));
process.env.DASH_USER = process.env.DASH_USER || 'rcfg-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'rcfg-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const cfg = require('../services/reportConfig');

const KEYS = ['meridian_base_url', 'meridian_out_key', 'meridian_in_key'];

test('Meridian keys are in DEFAULTS + KEYS (so setConfig accepts them)', () => {
  for (const k of KEYS) {
    assert.ok(k in cfg.DEFAULTS, `${k} missing from DEFAULTS`);
    assert.ok(cfg.KEYS.includes(k), `${k} missing from KEYS`);
  }
});

test('blank meridian_out_key / meridian_in_key are kept (not wiped), like smtp_pass', async () => {
  const db = await require('./_pg-fresh').fresh(['report_config']);
  (await cfg.setConfig(db, { meridian_out_key: 'OUT-1', meridian_in_key: 'IN-1', meridian_base_url: 'https://m' }, 'u'));
  (await cfg.setConfig(db, { meridian_out_key: '', meridian_in_key: '', meridian_base_url: 'https://m2' }, 'u')); // blank = keep
  const c = (await cfg.getConfig(db));
  assert.equal(c.meridian_out_key, 'OUT-1', 'blank out key must keep the stored value');
  assert.equal(c.meridian_in_key, 'IN-1', 'blank in key must keep the stored value');
  assert.equal(c.meridian_base_url, 'https://m2', 'non-secret base_url still updates');
});
