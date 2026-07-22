'use strict';
// Unit tests for the scheduled "Assets — Groupe" management digest sender. Two surfaces:
//   (A) decideAssetGroupSend(cfg) — the PURE arm/recipient gate. Default OFF.
//   (B) main(deps) — the CLI core, with db / cfg / assetsDb / mailer / dedup / record
//       ALL injectable, so it runs with no real DB and no SMTP.
//
// Safety first: NOTHING may gather, compose or mail unless the config is explicitly
// armed (asset_group_send_enabled === '1') AND at least one recipient is on file.
// It is a GROUP sender (site_code='GROUP') like send-hygiene, NOT per-coordinator.
const test = require('node:test');
const assert = require('node:assert');
const cli = require('../tools/reports/send-asset-group');
const { decideAssetGroupSend, main } = cli;

// Minimal reader-shaped fixtures — the composer is robust to these partials.
const LEADERBOARD = () => ({
  rows: [{ site: 'HGO', effort_score: 82, baseline_score: 70, delta: 12, rank: 1 }],
  most_improved: { site: 'HGO', delta: 12 },
  needs_attention: { site: 'SGO', delta: -5 },
});
const FORECAST = () => ({
  hardware: { years: [{ year: 2027, replacement_usd: 1000, count: 2 }], due_now: { replacement_usd: 0, count: 0 },
    beyond_horizon: { count: 1 }, total_forecast_usd: 1000, coverage: { eligible: 3, total: 100, pct: 3, excluded: {} } },
  software: { years: [], due_now: { renewal_usd: 0, count: 0 }, beyond_horizon: { count: 0 },
    total_forecast_usd: 0, coverage: { eligible: 5, total: 5, pct: 100, excluded: {} } },
});

// A deps builder that captures every side effect and touches no real module. The
// assetsDb stub also records whether it was called at all — used to prove the gate
// fires FIRST (a disarmed run must not gather).
function stubDeps(over = {}) {
  const captured = { sends: [], records: [], gathered: false };
  const deps = {
    db: {},
    cfg: {
      asset_group_send_enabled: '1',
      asset_group_recipients: 'mgmt@x.com, board@x.com',
      xof_usd_rate: '0.00165',
      asset_replacement_uplift_pct: '0',
    },
    assetsDb: {
      getEffortLeaderboard: async () => { captured.gathered = true; return LEADERBOARD(); },
      getInvestmentForecast: async () => { captured.gathered = true; return FORECAST(); },
    },
    mailerSend: async (msg) => { captured.sends.push(msg); return { ok: true }; },
    alreadySentToday: async () => false,
    record: async (db, row) => { captured.records.push(row); },
    now: new Date('2026-07-15'),
    ...over,
  };
  return { deps, captured };
}

// ── requiring the CLI is side-effect-free ────────────────────────────────────
test('requiring the CLI is side-effect-free and exports its core', () => {
  assert.strictEqual(typeof cli.decideAssetGroupSend, 'function');
  assert.strictEqual(typeof cli.main, 'function', 'main is exported, not auto-invoked');
});

// ── (A) the pure gate ────────────────────────────────────────────────────────
test('decideAssetGroupSend defaults to OFF — empty config never sends', () => {
  assert.deepStrictEqual(decideAssetGroupSend({}), { send: false, reason: 'disabled' });
});

test('decideAssetGroupSend armed but no recipients → reason mentions recipients', () => {
  const out = decideAssetGroupSend({ asset_group_send_enabled: '1' });
  assert.strictEqual(out.send, false);
  assert.match(out.reason, /recipients/i);
});

test('decideAssetGroupSend armed + recipients → send, trimmed + split + blanks dropped', () => {
  const out = decideAssetGroupSend({ asset_group_send_enabled: '1', asset_group_recipients: ' a@x.com , ,, b@x.com ' });
  assert.strictEqual(out.send, true);
  assert.deepStrictEqual(out.recipients, ['a@x.com', 'b@x.com']);
});

test('decideAssetGroupSend — the arm flag governs even when recipients exist', () => {
  assert.deepStrictEqual(decideAssetGroupSend({ asset_group_send_enabled: '0', asset_group_recipients: 'a@x.com' }),
    { send: false, reason: 'disabled' });
});

// ── (B) main() — gate FIRST ──────────────────────────────────────────────────
test('disarmed → returns {sent:0, reason:disabled} and never gathers/mails/logs', async () => {
  const { deps, captured } = stubDeps({ cfg: { asset_group_send_enabled: '0', asset_group_recipients: 'a@x.com' } });
  const res = await main(deps);
  assert.deepStrictEqual(res, { sent: 0, reason: 'disabled' });
  assert.strictEqual(captured.gathered, false, 'gate must fire before gathering the readers');
  assert.strictEqual(captured.sends.length, 0, 'nothing mailed');
  assert.strictEqual(captured.records.length, 0, 'nothing logged');
});

// ── (B) main() — happy path ──────────────────────────────────────────────────
test('armed + recipients + not-already-sent → composes and mails exactly once', async () => {
  const { deps, captured } = stubDeps();
  const res = await main(deps);

  assert.strictEqual(captured.gathered, true, 'readers were gathered');
  assert.strictEqual(captured.sends.length, 1, 'mailer called exactly once');
  const msg = captured.sends[0];
  assert.strictEqual(msg.to, 'mgmt@x.com,board@x.com', 'to = the recipient list');
  assert.ok(String(msg.subject).includes('2026-07'), `subject carries the period, got: ${msg.subject}`);
  assert.ok(String(msg.html).length > 0, 'html composed');

  assert.strictEqual(captured.records.length, 1, 'send is logged once');
  assert.strictEqual(captured.records[0].report_type, 'asset_group');
  assert.strictEqual(captured.records[0].site_code, 'GROUP');
  assert.strictEqual(captured.records[0].result, 'ok');
  assert.strictEqual(res.sent, 1);
});

test('bare --preview (present but valueless) composes but never mails or logs', async () => {
  const { deps, captured } = stubDeps({ preview: undefined, args: { preview: undefined } });
  const res = await main(deps);
  assert.strictEqual(captured.sends.length, 0, 'preview must not send');
  assert.strictEqual(captured.records.length, 0, 'preview must not log');
  assert.strictEqual(res.preview, true);
  assert.ok(String(res.subject).includes('2026-07'), 'preview returns the composed subject');
  assert.ok(String(res.html).length > 0, 'preview returns the composed html');
});

test('dedup — already sent today and no --force → skipped, no mail', async () => {
  const { deps, captured } = stubDeps({ alreadySentToday: async () => true });
  const res = await main(deps);
  assert.strictEqual(captured.sends.length, 0, 'a same-day repeat must not send');
  assert.strictEqual(res.sent, 0);
});

test('dedup — --force overrides the same-day guard and logs result=resent', async () => {
  const { deps, captured } = stubDeps({ alreadySentToday: async () => true, force: true });
  const res = await main(deps);
  assert.strictEqual(captured.sends.length, 1, 'force sends despite the dedup guard');
  assert.strictEqual(captured.records[0].result, 'resent', 'a forced re-send is logged as resent');
  assert.strictEqual(res.sent, 1);
});
