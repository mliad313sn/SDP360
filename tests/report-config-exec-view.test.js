'use strict';
// A-08 — the two Exec View switches must be DEFAULTS keys (setConfig drops unknown
// keys silently) and default to TODAY's behaviour: full MI detail (2026-07-02
// decision "option a") and the SDP-status change-success formula (KPI D-01 open).
const test = require('node:test');
const assert = require('node:assert');
const cfg = require('../services/reportConfig');

async function freshDb() { return require('./_pg-fresh').fresh(['report_config']); }

test('DEFAULTS carry exec_view_mi_detail="full" and exec_view_change_formula="status"', () => {
  assert.strictEqual(cfg.DEFAULTS.exec_view_mi_detail, 'full');
  assert.strictEqual(cfg.DEFAULTS.exec_view_change_formula, 'status');
  assert.ok(cfg.KEYS.includes('exec_view_mi_detail'));
  assert.ok(cfg.KEYS.includes('exec_view_change_formula'));
});

test('setConfig persists both keys (not silently dropped)', async () => {
  const db = await freshDb();
  await cfg.setConfig(db, { exec_view_mi_detail: 'summarized_only', exec_view_change_formula: 'deck' }, 'u');
  const c = await cfg.getConfig(db);
  assert.strictEqual(c.exec_view_mi_detail, 'summarized_only');
  assert.strictEqual(c.exec_view_change_formula, 'deck');
});
