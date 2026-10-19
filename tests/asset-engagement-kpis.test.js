'use strict';
// G-07 (audit 2026-09-24) — the printable asset-engagement KPI report.
//
// The audit's baseline numbers were produced by ad-hoc SQL, so the 30-day re-measure
// the engine asks for would not have been comparable. This is the pure half: the
// shaping and the wording, testable without a database.
//
// Three rules it must not break, all learned elsewhere in this codebase:
//   - a share needs a denominator: 0 active assets prints '—', never 0 % or NaN;
//   - "not measured" is not "measured zero" (null last_sync → "jamais synchronisé");
//   - no money is ever printed in an assets worklist surface.
const test = require('node:test');
const assert = require('node:assert');
const { formatKpiReport } = require('../services/assetEngagementKpis');

const SAMPLE = {
  as_of: '2026-09-24',
  last_sync: '2026-09-24 04:31:02',
  sites: [
    { site: 'MANA',     active: 471, no_tag: 252, no_date: 245, no_cost: 245, no_user: 468 },
    { site: 'Sabodala', active: 414, no_tag: 35,  no_date: 414, no_cost: 414, no_user: 414 },
  ],
  effort: [
    { site: 'MANA', effort_score: 54, delta: 3, rank: 1 },
    { site: 'Sabodala', effort_score: 32, delta: null, rank: 2 },
  ],
  engagement: { viewers_30d: 4, exports_30d: 11 },
};

test('prints one line per site with the share of the fleet', () => {
  const out = formatKpiReport(SAMPLE);
  assert.match(out, /MANA/);
  assert.match(out, /471/);
  assert.match(out, /99 ?%/, 'no_user 468/471 shows as a share, not a bare count');
});

test('a site with no active asset shows a dash, never 0 % or NaN', () => {
  const out = formatKpiReport({ ...SAMPLE, sites: [{ site: 'Ghost', active: 0, no_tag: 0, no_date: 0, no_cost: 0, no_user: 0 }] });
  assert.ok(!/NaN/.test(out), 'no NaN reaches the report');
  assert.match(out, /Ghost.*—/, 'an empty site prints a dash for its shares');
});

test('a missing Δ prints as unknown, not as zero effort', () => {
  const out = formatKpiReport(SAMPLE);
  const line = out.split('\n').find(l => /Sabodala/.test(l) && /32/.test(l));
  assert.ok(line, 'the effort line exists');
  assert.ok(!/\b0\b/.test(line.replace(/32/, '')), `a null delta must not render as 0: ${line}`);
});

test('an unsynced register says so instead of showing a date', () => {
  const out = formatKpiReport({ ...SAMPLE, last_sync: null });
  assert.match(out, /jamais synchronis/i);
});

test('no data at all is stated, not rendered as an empty success', () => {
  const out = formatKpiReport({ as_of: '2026-09-24', last_sync: null, sites: [], effort: [], engagement: {} });
  assert.match(out, /aucun site/i);
});

test('engagement counters are reported, and an unmeasurable one reads as such', () => {
  assert.match(formatKpiReport(SAMPLE), /4 .*(ouvert|lecteur|utilisateur)/i);
  assert.match(formatKpiReport({ ...SAMPLE, engagement: {} }), /non mesur/i);
});

test('never prints money', () => {
  const out = formatKpiReport(SAMPLE);
  assert.ok(!out.includes('$'), 'no currency glyph');
  assert.ok(!/USD|XOF/.test(out), 'no currency label');
});

// The CLI half. Two static guarantees, both drift-prevention:
//   - .env first, or a standalone run reads the frozen SQLite archives (the 2026-09-21
//     trap: the backfill dry-run listed W27 as every site's latest report);
//   - the worklist predicates are REUSED from assets-db, never re-typed, so the KPI can
//     never quietly measure something different from what the module shows.
const fsx = require('node:fs'), pathx = require('node:path');
const CLI = pathx.join(__dirname, '..', 'tools', 'pg', 'asset-engagement-kpis.js');

test('the CLI loads .env before any app module', () => {
  const src = fsx.readFileSync(CLI, 'utf8');
  const dot = src.indexOf("require('dotenv').config(");
  assert.ok(dot >= 0, 'loads dotenv');
  const firstApp = src.search(/require\(['"]\.\.\/\.\.\/[a-z]/);
  assert.ok(firstApp === -1 || dot < firstApp, '.env is loaded before the first app module');
});

test('the CLI reuses the exported FOLLOWUP_* predicates instead of re-typing SQL', () => {
  const src = fsx.readFileSync(CLI, 'utf8');
  for (const k of ['FOLLOWUP_ACTIVE_STATES', 'FOLLOWUP_NO_TAG', 'FOLLOWUP_NO_DATE', 'FOLLOWUP_NO_COST', 'FOLLOWUP_UNASSIGNED']) {
    assert.ok(src.includes(k), `uses ${k}`);
  }
  assert.ok(!/'In Use'\s*,\s*'In Store'/.test(src), 'the active-state list is not hand-copied');
});

test('the CLI is read-only', () => {
  const src = fsx.readFileSync(CLI, 'utf8');
  assert.ok(!/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i.test(src), 'no write statement anywhere');
});

// The delta rule, extracted because the CLI got it wrong on the first run: with only
// one snapshot in the ~30-day window the baseline RESOLVES TO THE LATEST SNAPSHOT, and
// score − score = 0 printed "Δ 0 pts" for every site — i.e. "this site made no effort"
// asserted on no measurement at all. _buildLeaderboard already carries this rule; the
// KPI report must agree with it.
const { effortDelta } = require('../services/assetEngagementKpis');

test('no baseline at all → null, never 0', () => {
  assert.strictEqual(effortDelta({ date: '2026-09-24', score: 54 }, null), null);
});

test('the baseline IS the latest snapshot → null (nothing to compare against)', () => {
  assert.strictEqual(effortDelta({ date: '2026-08-10', score: 54 }, { date: '2026-08-10', score: 54 }), null);
});

test('a genuinely older baseline → the signed difference, including a real 0', () => {
  assert.strictEqual(effortDelta({ date: '2026-09-24', score: 54 }, { date: '2026-08-20', score: 51 }), 3);
  assert.strictEqual(effortDelta({ date: '2026-09-24', score: 51 }, { date: '2026-08-20', score: 54 }), -3);
  assert.strictEqual(effortDelta({ date: '2026-09-24', score: 54 }, { date: '2026-08-20', score: 54 }), 0,
    'a measured no-change is 0 — that one is honest');
});
