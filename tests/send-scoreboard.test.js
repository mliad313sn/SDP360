'use strict';
// Unit tests for the scheduled PER-COORDINATOR scoreboard sender. Two surfaces:
//   (A) decideScoreboardSend(cfg) — the PURE arm gate (arm flag ALONE; recipients
//       come from the coordinator directory, not a config list). Default OFF.
//   (B) main(deps) — the CLI core. db / cfg / loadScoreboardData / resolveRecipient
//       / alreadySentToday / record / mailer ALL injectable, so it runs with no
//       real DB and no SMTP.
//
// Unlike the GROUP hygiene digest, this loops the sites and mails EACH confirmed
// coordinator a board with THEIR site highlighted. Unconfirmed → skipped.
// Per-(period, site) dedup. Armed-OFF composes/mails/logs NOTHING.
const test = require('node:test');
const assert = require('node:assert');
const cli = require('../tools/reports/send-scoreboard');
const { decideScoreboardSend, main } = cli;

// perSite for a two-site scoreboard: MGO applicable, SML applicable.
const PERSITE = () => ([
  { code: 'MGO', name: 'Mana', helpdesk: 70, inspections: 60, meetings: 50, assets: 40 },
  { code: 'SML', name: 'Lafigué', helpdesk: 90, inspections: 80, meetings: 70, assets: 60 },
]);

function stubDeps(over = {}) {
  const captured = { sends: [], records: [], resolved: [], loaded: 0 };
  const deps = {
    db: {},
    cfg: { scoreboard_send_enabled: '1' },
    loadScoreboardData: async () => { captured.loaded++; return { perSite: PERSITE(), prev: {} }; },
    // Confirmed for MGO, unconfirmed (null) for everyone else.
    resolveRecipient: async (db, siteCode, kind) => {
      captured.resolved.push({ siteCode, kind });
      return siteCode === 'MGO' ? { to: 'coord.mgo@x.com', cc: [] } : null;
    },
    alreadySentToday: async () => false,
    record: async (db, row) => { captured.records.push(row); },
    mailerSend: async (msg) => { captured.sends.push(msg); return { ok: true }; },
    now: new Date('2026-07-15'),
    ...over,
  };
  return { deps, captured };
}

// ── requiring the CLI is side-effect-free ────────────────────────────────────
test('requiring the CLI is side-effect-free and exports its core', () => {
  assert.strictEqual(typeof cli.decideScoreboardSend, 'function');
  assert.strictEqual(typeof cli.main, 'function', 'main is exported, not auto-invoked');
});

// ── (A) the pure gate — arm flag ALONE ───────────────────────────────────────
test('decideScoreboardSend defaults to OFF', () => {
  assert.strictEqual(decideScoreboardSend({}), false);
});
test('decideScoreboardSend disarmed → false', () => {
  assert.strictEqual(decideScoreboardSend({ scoreboard_send_enabled: '0' }), false);
});
test('decideScoreboardSend armed → true (no recipients list required)', () => {
  assert.strictEqual(decideScoreboardSend({ scoreboard_send_enabled: '1' }), true);
});

// ── (B) main() with everything injected ──────────────────────────────────────
test('disarmed → composes / mails / logs NOTHING', async () => {
  const { deps, captured } = stubDeps({ cfg: { scoreboard_send_enabled: '0' } });
  const res = await main(deps);
  assert.strictEqual(captured.loaded, 0, 'a disarmed run must not even gather the board');
  assert.strictEqual(captured.sends.length, 0, 'nothing mailed');
  assert.strictEqual(captured.records.length, 0, 'nothing logged');
  assert.strictEqual(res.sent, 0);
  assert.strictEqual(res.reason, 'disabled');
});

test('armed + one CONFIRMED coordinator → composes, mails, records that site only', async () => {
  const { deps, captured } = stubDeps();
  const res = await main(deps);

  assert.strictEqual(captured.sends.length, 1, 'exactly the confirmed site is mailed');
  assert.strictEqual(captured.sends[0].to, 'coord.mgo@x.com');
  assert.ok(String(captured.sends[0].subject).length > 0, 'a subject is composed');

  assert.strictEqual(captured.records.length, 1, 'one send logged');
  assert.strictEqual(captured.records[0].report_type, 'scoreboard');
  assert.strictEqual(captured.records[0].site_code, 'MGO');
  assert.strictEqual(captured.records[0].period, '2026-07');
  assert.strictEqual(res.sent, 1);
});

test('an UNCONFIRMED coordinator is skipped (never mailed)', async () => {
  const { deps, captured } = stubDeps();
  await main(deps);
  // SML resolves to null → never appears in sends/records.
  assert.ok(!captured.sends.some(s => /sml/i.test(s.to || '')), 'SML never mailed');
  assert.ok(captured.resolved.some(r => r.siteCode === 'SML' && r.kind === 'coordinator'),
    'SML coordinator recipient WAS looked up (and returned null → skipped)');
});

test('per-(period, site) dedup — already sent today → not re-sent', async () => {
  const { deps, captured } = stubDeps({ alreadySentToday: async () => true });
  const res = await main(deps);
  assert.strictEqual(captured.sends.length, 0, 'a same-day repeat must not send');
  assert.strictEqual(res.sent, 0);
});

test('--preview composes but never mails or logs', async () => {
  const { deps, captured } = stubDeps({ preview: true });
  const res = await main(deps);
  assert.strictEqual(captured.sends.length, 0, 'preview must not send');
  assert.strictEqual(captured.records.length, 0, 'preview must not log');
  assert.strictEqual(res.previewed, true);
});

// ── disarmed + PREVIEW → composes a dry-run, never mails/logs (Preview unarmed) ──
test('disarmed + preview → composes a dry-run, mails/logs NOTHING', async () => {
  const { deps, captured } = stubDeps({ cfg: { scoreboard_send_enabled: '0' }, preview: true });
  const res = await main(deps);
  assert.notStrictEqual(res.reason, 'disabled', 'preview must NOT be gated by the arm flag');
  assert.ok(captured.loaded > 0, 'preview gathered the board');
  assert.strictEqual(captured.sends.length, 0, 'preview never mails');
  assert.strictEqual(captured.records.length, 0, 'preview never logs');
});
