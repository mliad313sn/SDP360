'use strict';
// E-B03 — the audit §9 value table: every value null / UNKNOWN when unsourced (never 0), measured rows with n.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const P = require('../services/pilotMetrics');
const cli = require('../tools/pilot/pilot-metrics');

const NOW = Date.parse('2026-11-09T00:00:00Z');

test('empty inputs: every row is UNKNOWN with its missing source named, no value is 0', () => {
  const t = P.buildValueTable({ from: '2026-11-02', to: '2026-11-08', nowMs: NOW });
  assert.ok(t.rows.length >= 14);
  for (const r of t.rows) {
    assert.equal(r.value, null, r.key); assert.equal(r.state, 'UNKNOWN', r.key); assert.ok(r.missing && r.missing.length > 5, r.key);
    for (const k of ['definition', 'formula', 'source', 'owner_role', 'validator_role']) assert.ok(r[k], `${r.key}.${k}`);
    assert.ok(/proposed/.test(r.definition), `${r.key} definition is labelled proposed`);
  }
  for (const k of ['certified_resolution_sla', 'kpi_reliability', 'project_benefits', 'service_availability', 'delivery_rate', 'usability', 'duplicate_entry_reduction'])
    assert.ok(t.rows.some((r) => r.key === k), k);
  assert.match(t.note, /constant scope/); assert.doesNotMatch(JSON.stringify(t), /"target"/);
});

test('measured rows: adoption on a targeted list, freshness on active sources, commitments, field time, stopwatch', () => {
  const t = P.buildValueTable({ from: '2026-11-02', to: '2026-11-08', nowMs: NOW,
    events: [{ user_id: 1, ts: '2026-11-03T10:00:00Z' }, { user_id: 9, ts: '2026-11-03T10:00:00Z' }, { user_id: 2, ts: '2026-10-01T10:00:00Z' }],
    targetedUserIds: [1, 2, 3, 4],
    lastOk: { 'zoho.requests': '2026-11-08T23:00:00Z', 'assets.sync': '2026-10-01T00:00:00Z' },
    commitmentsEnabled: true,
    commitments: [{ status: 'verified_closed', created_at: '2026-11-01T00:00:00Z', technical_completed_at: '2026-11-03T00:00:00Z', verified_at: '2026-11-04T00:00:00Z' },
      { status: 'awaiting_verification', created_at: '2026-11-01T00:00:00Z', technical_completed_at: '2026-11-05T00:00:00Z' }],
    fieldTiming: [{ ts: '2026-11-03T10:00:00Z', task_ms: 60000 }, { ts: '2026-11-04T10:00:00Z', task_ms: 120000 }],
    stopwatch: [{ phase: 'baseline', active_minutes: '40' }, { phase: 'baseline', active_minutes: '' }, { phase: 'pilot', active_minutes: '' }] });
  const by = Object.fromEntries(t.rows.map((r) => [r.key, r]));
  assert.equal(by.active_adoption.value, 25); assert.equal(by.active_adoption.n, 4);
  assert.equal(by.data_freshness.value, 50); assert.equal(by.data_freshness.n, 2); assert.match(by.data_freshness.population, /never synced/);
  assert.equal(by.verified_closure_delay.value, 72); assert.equal(by.verified_action_share.value, 50); assert.equal(by.verified_action_share.n, 2);
  assert.equal(by.field_task_time.value, 90);
  assert.equal(by.report_preparation_baseline.value, 40); assert.equal(by.report_preparation_baseline.n, 1);
  assert.equal(by.report_preparation_pilot.value, null, 'a blank stopwatch cell is UNKNOWN, never 0');
});

test('commitment model off → verified rows UNKNOWN even with rows present; empty targeted list → UNKNOWN', () => {
  const t = P.buildValueTable({ commitmentsEnabled: false, commitments: [{ status: 'verified_closed', created_at: '2026-11-01', verified_at: '2026-11-02', technical_completed_at: '2026-11-02' }], targetedUserIds: [] });
  const by = Object.fromEntries(t.rows.map((r) => [r.key, r]));
  assert.equal(by.verified_closure_delay.value, null); assert.match(by.verified_closure_delay.missing, /commitments_enabled = 0/);
  assert.equal(by.active_adoption.value, null); assert.match(by.active_adoption.missing, /empty/);
});

test('markdown / CSV render UNKNOWN as text and neutralise formula injection', () => {
  const t = P.buildValueTable({});
  assert.match(P.valueTableMarkdown(t), /UNKNOWN — /);
  const csv = P.valueTableCsv({ ...t, rows: [{ ...t.rows[0], indicator: '=cmd()' }] });
  assert.match(csv, /'=cmd\(\)/);
});

test('CLI: --value parsed; targeted / stopwatch files read; a sheet without the columns is refused', () => {
  assert.equal(cli.parseArgs(['--value', '--targeted=a.txt']).value, true);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-'));
  fs.writeFileSync(path.join(dir, 't.txt'), '1\n2, 3\nalice\n'); assert.deepEqual(cli.readTargeted(path.join(dir, 't.txt')), [1, 2, 3]);
  assert.equal(cli.readTargeted(null), null);
  const sw = cli.readStopwatch(path.join(__dirname, '..', 'docs', 'ops', 'pilot', 'WEEKLY-REPORT-STOPWATCH.csv'));
  assert.ok(sw.length > 0 && sw.every((r) => 'phase' in r));
  fs.writeFileSync(path.join(dir, 'bad.csv'), 'a,b\n1,2\n'); assert.throws(() => cli.readStopwatch(path.join(dir, 'bad.csv')), /phase and active_minutes/);
});

test('pg: --value on a database with no pilot data → every value null, read-only session', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL set by _pg-boot');
  const { Client } = require('pg');
  const r = new Client({ connectionString: process.env.PG_URL }); await r.connect();
  try {
    let out = '';
    const res = await cli.run({ argv: ['--from=1999-01-04', '--to=1999-01-10', '--value', '--stopwatch=' + path.join(__dirname, '..', 'docs', 'ops', 'pilot', 'WEEKLY-REPORT-STOPWATCH.csv')],
      env: {}, client: r, now: new Date('1999-01-11T00:00:00Z'), write: (s) => { out += s; } });
    assert.equal(res.ok, true);
    for (const row of res.valueTable.rows) {
      if (row.key === 'data_freshness') continue;   // sync_runs is shared by the test database: checked separately
      assert.equal(row.value, null, row.key);
    }
    assert.match(out, /# Value table 1999-01-04/);
    await assert.rejects(r.query('CREATE TABLE vt_should_fail (x int)'), /read-only/);
  } finally { await r.end(); }
});
