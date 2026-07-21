'use strict';
// Unit tests for the scheduled WEEKLY report sender CLI. Two surfaces:
//   (A) decideWeeklySend(cfg) — the PURE arm gate. Arm flag ALONE (recipients
//       come from the coordinator directory, not a config list). Default OFF.
//   (B) main(deps) — the CLI core. db / cfg / listRecipients / sendWeeklyReport /
//       getPreviousWeek ALL injectable, so it runs with no real DB and no SMTP.
//
// The per-site pipeline (recipients, dedup, PPTX, mail, log) belongs to
// services/sendWeeklyReport.js and is tested in tests/send-weekly-report.test.js.
// This file tests only what the CLI adds: the gate, the period, and the loop.
const test = require('node:test');
const assert = require('node:assert');
const cli = require('../tools/reports/send-weekly');
const { decideWeeklySend, main } = cli;

// Capture console output so the "each skip reason is logged verbatim" contract
// can be asserted — the Service Desk Manager reads exactly these lines.
async function captureLogs(fn) {
  const lines = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  const grab = (...a) => lines.push(a.join(' '));
  console.log = grab; console.warn = grab; console.error = grab;
  try {
    const result = await fn();
    return { result, lines: lines.join('\n') };
  } finally {
    console.log = orig.log; console.warn = orig.warn; console.error = orig.error;
  }
}

function stubDeps(over = {}) {
  const captured = { sent: [], listed: 0, periods: [] };
  const deps = {
    // Explicit so the runner's own process.argv never leaks into the parse.
    args: {},
    db: {},
    cfg: { weekly_report_send_enabled: '1' },
    listRecipients: async () => {
      captured.listed++;
      return [{ site_code: 'MGO' }, { site_code: 'SML' }];
    },
    // MGO sends; SML is refused BY THE SENDER (the loader's own words).
    sendWeeklyReport: async (opts) => {
      const { site, year, week } = opts;
      captured.sent.push(opts);          // whole opts — force/preview are asserted too
      captured.periods.push(`${year}-W${week}`);
      return site === 'MGO'
        ? { ok: true, to: 'coord.mgo@x.com', pptx: true }
        : { skipped: true, reason: 'report for site "SML" 2026-W28 is not finished (status: draft)' };
    },
    getPreviousWeek: () => ({ year: 2026, week: 28 }),
    ...over,
  };
  return { deps, captured };
}

// ── requiring the CLI is side-effect-free ────────────────────────────────────
// A CLI without the `require.main === module` guard executes on require and
// its process.exit(0) kills the runner — the file then "passes" having run
// zero tests. Reaching this assertion at all is the proof the guard is there.
test('requiring the CLI is side-effect-free and exports its core', () => {
  assert.strictEqual(typeof cli.decideWeeklySend, 'function');
  assert.strictEqual(typeof cli.main, 'function', 'main is exported, not auto-invoked');
  assert.deepStrictEqual(Object.keys(cli).sort(), ['decideWeeklySend', 'main']);
});

// ── (A) the pure gate — arm flag ALONE ───────────────────────────────────────
test('decideWeeklySend defaults to OFF when the key is missing', () => {
  assert.strictEqual(decideWeeklySend({}), false);
  assert.strictEqual(decideWeeklySend(undefined), false);
  assert.strictEqual(decideWeeklySend(null), false);
});
test('decideWeeklySend disarmed → false', () => {
  assert.strictEqual(decideWeeklySend({ weekly_report_send_enabled: '0' }), false);
  assert.strictEqual(decideWeeklySend({ weekly_report_send_enabled: '' }), false);
});
test('decideWeeklySend armed → true (no recipients list required)', () => {
  assert.strictEqual(decideWeeklySend({ weekly_report_send_enabled: '1' }), true);
});

// ── (B) main() with everything injected ──────────────────────────────────────
test('disarmed → gathers NOTHING, sends NOTHING (gate is FIRST)', async () => {
  const { deps, captured } = stubDeps({ cfg: { weekly_report_send_enabled: '0' } });
  let res;
  await captureLogs(async () => { res = await main(deps); });

  assert.strictEqual(captured.listed, 0, 'a disarmed run must not even read the directory');
  assert.strictEqual(captured.sent.length, 0, 'the sender is never invoked → nothing mailed or logged');
  assert.strictEqual(res.sent, 0);
  assert.strictEqual(res.reason, 'disabled');
});

test('period defaults to the PREVIOUS week, zero-padded', async () => {
  const { deps, captured } = stubDeps({ getPreviousWeek: () => ({ year: 2026, week: 3 }) });
  let res;
  await captureLogs(async () => { res = await main(deps); });
  assert.strictEqual(res.period, '2026-W03', 'weeks 1-9 must be zero-padded');
  assert.strictEqual(captured.sent[0].week, 3, 'the sender receives the raw week number');
  assert.strictEqual(captured.sent[0].year, 2026);
});

test('--year / --week override the previous-week default', async () => {
  const { deps, captured } = stubDeps({ args: { year: '2025', week: '52' } });
  let res;
  await captureLogs(async () => { res = await main(deps); });
  assert.strictEqual(res.period, '2025-W52');
  assert.strictEqual(captured.sent[0].year, 2025);
  assert.strictEqual(captured.sent[0].week, 52);
});

test('bare --preview is detected by PRESENCE, not truthiness', async () => {
  // `--preview` with no value parses to {preview: undefined} — a truthiness
  // test would read that as "not previewing" and MAIL a live run.
  const { deps, captured } = stubDeps({
    args: { preview: undefined },
    sendWeeklyReport: async (opts) => {
      captured.sent.push(opts);
      return { preview: true, subject: 'Weekly report', html: '<p>x</p>' };
    },
  });
  let res;
  await captureLogs(async () => { res = await main(deps); });
  assert.strictEqual(captured.sent.length, 2, 'both sites are composed');
  assert.strictEqual(captured.sent[0].preview, true, 'preview reached the sender');
  assert.strictEqual(res.previewed, true);
  assert.strictEqual(res.sent, 0, 'a preview sends nothing');
});

test('bare --force is detected by PRESENCE (and --force=0 is not force)', async () => {
  const a = stubDeps({ args: { force: undefined } });
  await captureLogs(() => main(a.deps));
  assert.strictEqual(a.captured.sent[0].force, true);

  const b = stubDeps({ args: { force: '0' } });
  await captureLogs(() => main(b.deps));
  assert.strictEqual(b.captured.sent[0].force, false, '--force=0 must not force');
});

test('armed run: one site sends, one is skipped → counts and the reason VERBATIM', async () => {
  const { deps, captured } = stubDeps();
  const { result: res, lines } = await captureLogs(() => main(deps));

  assert.strictEqual(res.sent, 1, 'exactly one site sent');
  assert.strictEqual(res.skipped, 1, 'exactly one site skipped');
  assert.strictEqual(res.failed, 0);
  assert.strictEqual(captured.sent.length, 2, 'every directory site was attempted');

  // The skip reason must survive verbatim — it is the loader's own operator-
  // facing wording and the SDM reads it to know who never submitted.
  assert.ok(lines.includes('is not finished (status: draft)'),
    'the sender\'s reason is logged verbatim, not reworded');
  assert.ok(/DONE/.test(lines) && /sent=1/.test(lines) && /skipped=1/.test(lines),
    'a DONE line reports the counts');

  assert.deepStrictEqual(res.skips, [{
    site: 'SML',
    reason: 'report for site "SML" 2026-W28 is not finished (status: draft)',
  }]);
});

test('one site THROWING does not abort the loop', async () => {
  const seen = [];
  const { deps } = stubDeps({
    sendWeeklyReport: async ({ site }) => {
      seen.push(site);
      if (site === 'MGO') throw new Error('SMTP exploded');
      return { ok: true, to: 'coord.sml@x.com' };
    },
  });
  let res;
  await captureLogs(async () => { res = await main(deps); });

  assert.deepStrictEqual(seen, ['MGO', 'SML'], 'the second site is still attempted');
  assert.strictEqual(res.failed, 1);
  assert.strictEqual(res.sent, 1, 'the healthy site still got its report');
});

test('an empty directory is a clean no-op, not a crash', async () => {
  const { deps, captured } = stubDeps({ listRecipients: async () => [] });
  let res;
  await captureLogs(async () => { res = await main(deps); });
  assert.strictEqual(res.sent, 0);
  assert.strictEqual(res.skipped, 0);
  assert.strictEqual(captured.sent.length, 0);
});
