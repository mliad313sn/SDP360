'use strict';
// A-03 — `node tools/pg/check-secrets.js --verify` is the decrypt check the upgrade CI job runs on the
// installed tree: exit 0 when every enc: value opens with SDP_CONFIG_KEY, non-zero (2) and the KEY NAME —
// never the value — when one does not. Runs the real CLI against this file's throwaway database.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');
const { Client } = require('pg');
const cs = require('../services/configSecrets');

const CLI = path.join(__dirname, '..', 'tools', 'pg', 'check-secrets.js');
const RIGHT = 'right-passphrase-for-verify-0001';
const WRONG = 'another-passphrase-not-this-one-02';

async function setRows(rows) {
  const c = new Client({ connectionString: process.env.PG_URL });
  await c.connect();
  try {
    await c.query("DELETE FROM report_config WHERE key IN ('smtp_pass','meraki_api_key')");
    for (const [k, v] of rows) await c.query('INSERT INTO report_config (key, value) VALUES ($1, $2)', [k, v]);
  } finally { await c.end(); }
}
function runVerify() {
  const env = { ...process.env, SDP_CONFIG_KEY: RIGHT, NODE_OPTIONS: '' };
  return spawnSync(process.execPath, [CLI, '--verify'], { encoding: 'utf8', env, cwd: path.join(__dirname, '..') });
}

test('--verify exits 0 when every enc: value opens with SDP_CONFIG_KEY', async () => {
  await setRows([['smtp_pass', cs.encryptValue('smtp-secret-value', cs.keyFrom(RIGHT))]]);
  const r = runVerify();
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /illisibles : 0/);
});

test('--verify exits non-zero and names the key (not the value) when one box does not open', async () => {
  await setRows([
    ['smtp_pass', cs.encryptValue('smtp-secret-value', cs.keyFrom(RIGHT))],
    ['meraki_api_key', cs.encryptValue('meraki-secret-value', cs.keyFrom(WRONG))],
  ]);
  const r = runVerify();
  assert.strictEqual(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stdout, /meraki_api_key/);
  assert.ok(!/smtp-secret-value|meraki-secret-value/.test(r.stdout + r.stderr), 'never a value');
});
