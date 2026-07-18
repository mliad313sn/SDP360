'use strict';
// Unit tests for the scheduled CMDB-hygiene sender. Two surfaces:
//   (A) decideHygieneSend(cfg) — the PURE arm/recipient gate. Default OFF.
//   (B) main(deps) — the CLI core, with db / cfg / summary / exceptions / mailer
//       / dedup / record ALL injectable, so it runs with no real DB and no SMTP.
//
// Safety first: NOTHING may compose or mail unless the config is explicitly armed
// (hygiene_send_enabled === '1') AND at least one recipient is on file.
const test = require('node:test');
const assert = require('node:assert');
const cli = require('../tools/reports/send-hygiene');
const { decideHygieneSend, main } = cli;

// A minimal getHygieneSummary-shaped fixture, plus the caller-attached sync block
// (so main's freshness step is a no-op — it must NOT read a real sync row here).
const SUMMARY = () => ({
  total: 10,
  by_kind: { discovered: 1, never_scanned: 2, ghost: 0, no_owner: 3, no_age: 4, no_cost: 5 },
  by_site: [{ site: 'HGO', total: 10, owner_pct: 70, scan_pct: 80, completeness: 75 }],
  scan_freshness: { never: 2, over90: 1, d30_90: 1, d7_30: 1, under7: 5 },
  by_state: {},
  sync: { last_success: '2026-07-14', age_days: 1 },
});

const KINDS = ['discovered', 'never_scanned', 'ghost', 'no_owner', 'no_age', 'no_cost'];

// A deps builder that captures every side effect and touches no real module.
function stubDeps(over = {}) {
  const captured = { sends: [], records: [] };
  const deps = {
    db: {},
    cfg: { hygiene_send_enabled: '1', hygiene_recipients: 'a@x.com, b@x.com' },
    kinds: KINDS,
    loadSummary: async () => SUMMARY(),
    loadExceptions: async (kind) => [{ asset_id: kind + '-1', asset_name: 'x' }],
    // Task 7 — finance + licence fetches stubbed so main() stays DB-free.
    loadFinance: async (rate) => ({ fleet: { book_value_usd: 100, purchase_cost_usd: 200, refresh_due: 1 }, rate }),
    loadLicences: async () => ({ total: 3, expiry: { expired: 1, expiring_90: 1, ok: 1, no_expiry: 0 }, by_family: { User: 3 } }),
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
  assert.strictEqual(typeof cli.decideHygieneSend, 'function');
  assert.strictEqual(typeof cli.main, 'function', 'main is exported, not auto-invoked');
});

// ── (A) the pure gate ────────────────────────────────────────────────────────
test('decideHygieneSend defaults to OFF — empty config never sends', () => {
  assert.deepStrictEqual(decideHygieneSend({}), { send: false, reason: 'disabled' });
});

test('decideHygieneSend armed but no recipients → no recipients', () => {
  assert.deepStrictEqual(decideHygieneSend({ hygiene_send_enabled: '1' }), { send: false, reason: 'no recipients' });
});

test('decideHygieneSend armed + recipients → send, trimmed + split + blanks dropped', () => {
  const out = decideHygieneSend({ hygiene_send_enabled: '1', hygiene_recipients: ' a@x.com , b@x.com ' });
  assert.strictEqual(out.send, true);
  assert.deepStrictEqual(out.recipients, ['a@x.com', 'b@x.com']);
});

test('decideHygieneSend — the arm flag governs even when recipients exist', () => {
  assert.deepStrictEqual(decideHygieneSend({ hygiene_send_enabled: '0', hygiene_recipients: 'a@x.com' }),
    { send: false, reason: 'disabled' });
});

test('decideHygieneSend drops blank/whitespace-only recipient entries', () => {
  const out = decideHygieneSend({ hygiene_send_enabled: '1', hygiene_recipients: 'a@x.com, ,, b@x.com,' });
  assert.deepStrictEqual(out.recipients, ['a@x.com', 'b@x.com']);
});

// ── (B) main() with everything injected ──────────────────────────────────────
test('armed + recipients + not-already-sent → composes and mails exactly once', async () => {
  const { deps, captured } = stubDeps();
  const res = await main(deps);

  assert.strictEqual(captured.sends.length, 1, 'mailer called exactly once');
  const msg = captured.sends[0];
  assert.strictEqual(msg.to, 'a@x.com,b@x.com', 'to = the recipient list');
  assert.ok(String(msg.subject).includes('2026-07'), `subject carries the period, got: ${msg.subject}`);
  assert.ok(Buffer.isBuffer(msg.attachments[0].content), 'workbook attachment is a Buffer');

  assert.strictEqual(captured.records.length, 1, 'send is logged once');
  assert.strictEqual(captured.records[0].report_type, 'hygiene');
  assert.strictEqual(captured.records[0].site_code, 'GROUP');
  assert.strictEqual(res.sent, 1);
});

test('--preview composes the digest but never mails', async () => {
  const { deps, captured } = stubDeps({ preview: true });
  const res = await main(deps);

  assert.strictEqual(captured.sends.length, 0, 'preview must not send');
  assert.strictEqual(captured.records.length, 0, 'preview must not log a send');
  assert.strictEqual(res.previewed, true);
  assert.deepStrictEqual(res.recipients, ['a@x.com', 'b@x.com']);
  assert.ok(String(res.subject).includes('2026-07'), 'preview returns the composed subject');
});

test('disarmed → never composes or mails, and does not log', async () => {
  const { deps, captured } = stubDeps({ cfg: { hygiene_send_enabled: '0', hygiene_recipients: 'a@x.com' } });
  let loaded = false;
  deps.loadSummary = async () => { loaded = true; return SUMMARY(); };
  const res = await main(deps);

  assert.strictEqual(captured.sends.length, 0, 'nothing sent');
  assert.strictEqual(captured.records.length, 0, 'nothing logged');
  assert.strictEqual(loaded, false, 'a disarmed run must not even compose');
  assert.strictEqual(res.sent, 0);
  assert.strictEqual(res.reason, 'disabled');
});

test('dedup — already sent today and no --force → skipped, no mail', async () => {
  const { deps, captured } = stubDeps({ alreadySentToday: async () => true });
  const res = await main(deps);

  assert.strictEqual(captured.sends.length, 0, 'a same-day repeat must not send');
  assert.strictEqual(res.sent, 0);
});

test('dedup — --force overrides the same-day guard and sends', async () => {
  const { deps, captured } = stubDeps({ alreadySentToday: async () => true, force: true });
  const res = await main(deps);

  assert.strictEqual(captured.sends.length, 1, 'force sends despite the dedup guard');
  assert.strictEqual(res.sent, 1);
});
