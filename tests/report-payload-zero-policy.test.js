'use strict';

// A-17b — exec_payload_zero_policy switch on the Group IT deck payload merge.
// keep_server (default) = the 2026-06-04 behaviour: a browser 0 does not override a
// positive server count for the KEEP_SERVER keys. browser_wins = the browser value is
// trusted even at 0, and a verdict KPI nobody knows becomes null + _unknown_as_dash.

const { test } = require('node:test');
const assert = require('node:assert');
const rp = require('../services/reportPayload');
const cfg = require('../services/reportConfig');

test('DEFAULTS carry helpdesk_sla_definition="flag" and exec_payload_zero_policy="keep_server"', () => {
  assert.strictEqual(cfg.DEFAULTS.helpdesk_sla_definition, 'flag');
  assert.strictEqual(cfg.DEFAULTS.exec_payload_zero_policy, 'keep_server');
  assert.ok(cfg.KEYS.includes('helpdesk_sla_definition'));
  assert.ok(cfg.KEYS.includes('exec_payload_zero_policy'));
});

test('keep_server (default): browser total=0 with server total=16 keeps 16 (today)', () => {
  const e = rp.mergeBrowserKpis({ total: 16, fcr_rate: 0, sla_compliance: 91 }, { total_tickets: 0, sla_res_pct: 0 });
  assert.strictEqual(e.total, 16);
  assert.strictEqual(e.sla_compliance, 0, 'percentages trust the browser, as today');
  assert.strictEqual(e.fcr_rate, 0, 'unknown fcr stays the server 0, as today');
  assert.strictEqual(e._unknown_as_dash, undefined);
  const e2 = rp.mergeBrowserKpis({ total: 16 }, { total_tickets: 0 }, 'keep_server');
  assert.strictEqual(e2.total, 16);
  const e3 = rp.mergeBrowserKpis({ total: 16 }, { total_tickets: 0 }, 'nonsense');
  assert.strictEqual(e3.total, 16, 'unknown policy falls back to keep_server');
});

test('browser_wins: browser total=0 wins; fcr_rate unknown → null and _unknown_as_dash true', () => {
  const e = rp.mergeBrowserKpis({ total: 16, fcr_rate: 0 }, { total_tickets: 0 }, 'browser_wins');
  assert.strictEqual(e.total, 0);
  assert.strictEqual(e.fcr_rate, null);
  assert.strictEqual(e._unknown_as_dash, true);
  const k = rp.mergeBrowserKpis({ fcr_rate: 0 }, { fcr_rate: 0 }, 'browser_wins');
  assert.strictEqual(k.fcr_rate, 0, 'a 0 the browser computed is trusted');
});
