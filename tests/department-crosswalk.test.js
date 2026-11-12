'use strict';
// F-PRODUCT-05 — department crosswalk: pure rules (services/departmentCrosswalk), the seed of migration 082 and the
// --check tool against a real PostgreSQL (tests/_pg-boot.mjs provisions + migrates it).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const X = require('../services/departmentCrosswalk');
const { makeDepartmentCrosswalkStore } = require('../services/departmentCrosswalkStore');
const cli = require('../tools/governance/department-crosswalk');

const MD = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meetings-init.json'), 'utf8')).departments;
const ACTION = ['Mining', 'Technical Service', 'Processing', 'Maintenance', 'Supply Chain', 'Security', 'Finance', 'Human Resource', 'Social performance', 'General Manager'];
const SEED = [
  { md_code: 'mining', action_department_name: 'Mining', status: 'proposed' }, { md_code: 'maintenance', action_department_name: 'Maintenance', status: 'proposed' },
  { md_code: 'supply_chain', action_department_name: 'Supply Chain', status: 'proposed' }, { md_code: 'finance', action_department_name: 'Finance', status: 'proposed' },
  { md_code: 'security', action_department_name: 'Security', status: 'proposed' },
  { md_code: 'process', action_department_name: null, status: 'unmapped' }, { md_code: 'mill', action_department_name: null, status: 'unmapped' },
  { md_code: 'hr', action_department_name: null, status: 'unmapped' }, { md_code: null, action_department_name: 'Processing', status: 'unmapped' },
  { md_code: null, action_department_name: 'Human Resource', status: 'unmapped' },
];
const mdNames = Object.fromEntries(MD.map((d) => [d.code, d.name_en]));

test('only exact pairs are proposed: the five identical labels, nothing that merely looks alike', () => {
  const pairs = X.proposeExactPairs(MD, ACTION);
  assert.deepEqual(pairs.map((p) => [p.md_code, p.action_department_name]).sort(),
    [['finance', 'Finance'], ['maintenance', 'Maintenance'], ['mining', 'Mining'], ['security', 'Security'], ['supply_chain', 'Supply Chain']]);
  assert.ok(pairs.every((p) => p.status === 'proposed'));
  for (const code of ['process', 'mill', 'hr', 'mobile_maint', 'geology', 'hse', 'exploration', 'other_dept']) assert.ok(!pairs.some((p) => p.md_code === code), code);
  for (const name of ['Processing', 'Human Resource', 'Technical Service', 'Social performance', 'General Manager']) assert.ok(!pairs.some((p) => p.action_department_name === name), name);
});

test('norm folds case, accents and separators only — it never shortens a word', () => {
  assert.equal(X.norm('Supply_Chain'), X.norm('supply chain')); assert.equal(X.norm(' Sécurité '), 'securite');
  assert.notEqual(X.norm('Process'), X.norm('Processing')); assert.notEqual(X.norm('HR'), X.norm('Human Resource'));
});

test('roll-up: a pair groups both vocabularies; Process / Mill / Processing are NOT merged; blank is "not set", not unmapped', () => {
  const index = X.makeIndex(SEED, { mdNames });
  const r = X.rollup([
    { source: 'pv_issues', department: 'mining', n: 3 }, { source: 'report_actions', department: 'Mining', n: 2 }, { source: 'commitments', department: ' MINING ' },
    { source: 'pv_issues', department: 'process', n: 4 }, { source: 'pv_issues', department: 'mill', n: 1 }, { source: 'report_actions', department: 'Processing', n: 5 },
    { source: 'commitments', department: 'Plant ops', n: 2 }, { source: 'commitments', department: null, n: 7 }, { source: 'handoffs_to', department: '  ' },
  ], index);
  assert.equal(r.total, 26);
  assert.deepEqual(r.groups.map((g) => [g.key, g.total]), [['mining', 6]]);
  assert.deepEqual(r.groups[0].by_source, { pv_issues: 3, report_actions: 2, commitments: 1 });
  assert.equal(r.groups[0].label, 'Mining'); assert.equal(r.groups[0].status, 'proposed');
  assert.equal(r.unmapped.total, 12);
  assert.deepEqual(r.unmapped.values.map((v) => [v.value, v.total, v.known]), [['Processing', 5, true], ['process', 4, true], ['Plant ops', 2, false], ['mill', 1, true]]);
  assert.deepEqual(r.not_set, { total: 8, by_source: { commitments: 7, handoffs_to: 1 } });
});

test('approvedOnly ignores proposed pairs; check() counts what the crosswalk does not map', () => {
  const strict = X.makeIndex(SEED, { mdNames, approvedOnly: true });
  assert.equal(X.resolve(strict, 'Mining').mapped, false);
  const approved = X.makeIndex(SEED.map((r) => (r.md_code === 'mining' ? { ...r, status: 'approved' } : r)), { mdNames, approvedOnly: true });
  assert.equal(X.resolve(approved, 'Mining').key, 'mining'); assert.equal(X.resolve(approved, 'Finance').mapped, false);
  const c = X.check([{ source: 'commitments', department: 'Finance', n: 2 }, { source: 'commitments', department: 'Mill', n: 1 }, { source: 'commitments', department: '', n: 4 }], X.makeIndex(SEED, { mdNames }));
  assert.deepEqual([c.total, c.mapped, c.not_set, c.unmapped_total], [7, 2, 4, 1]); assert.equal(c.unmapped[0].value, 'Mill');
});

// ── PostgreSQL: migration 082 seed + the --check tool ──────────────────────────────────────────────────────────────
const handle = (c) => ({ prepare: (sql) => ({ all: async () => (await c.query(sql)).rows }) });

test('pg: migration 082 seeds five proposed exact pairs and leaves every other value alone', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL set by _pg-boot');
  const c = new Client({ connectionString: process.env.PG_URL }); await c.connect();
  try {
    const rows = (await c.query(`SELECT md_code, action_department_name, status FROM department_crosswalk`)).rows;
    const pairs = rows.filter((r) => r.md_code && r.action_department_name);
    assert.deepEqual(pairs.map((p) => p.md_code).sort(), ['finance', 'maintenance', 'mining', 'security', 'supply_chain']);
    assert.ok(pairs.every((p) => p.status === 'proposed'), 'no pair is approved by a migration');
    assert.deepEqual(rows.filter((r) => r.md_code).map((r) => r.md_code).sort(), MD.map((d) => d.code).sort(), 'every meeting department is listed');
    assert.deepEqual(rows.filter((r) => r.action_department_name).map((r) => r.action_department_name).sort(), [...ACTION].sort(), 'every action department is listed');
    for (const r of rows.filter((x) => ['process', 'mill', 'hr'].includes(x.md_code) || ['Processing', 'Human Resource'].includes(x.action_department_name))) { assert.equal(r.status, 'unmapped'); assert.ok(!(r.md_code && r.action_department_name)); }
    // a one-sided row cannot be marked as a pair
    await assert.rejects(c.query(`INSERT INTO department_crosswalk (md_code, status) VALUES ('zz_test', 'proposed')`));
    // the seed does not run twice
    const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'postgres', 'reports', '082_department_crosswalk.sql'), 'utf8');
    await c.query(sql); assert.equal((await c.query(`SELECT COUNT(*)::int AS n FROM department_crosswalk`)).rows[0].n, rows.length);
  } finally { await c.end(); }
});

test('pg: --check lists the unmapped values found in data, per source, and writes nothing', async () => {
  const c = new Client({ connectionString: process.env.PG_URL }); await c.connect();
  try {
    const t = '2026-11-12T08:00:00Z';
    for (const [uid, dep] of [['dx-1', 'Mining'], ['dx-2', 'mining'], ['dx-3', 'Mill'], ['dx-4', 'Plant ops'], ['dx-5', null]])
      await c.query(`INSERT INTO commitments (uid, kind, title, department, created_at, updated_at) VALUES ($1, 'issue', 'dx', $2, $3, $3) ON CONFLICT (uid) DO NOTHING`, [uid, dep, t]);
    await c.query(`INSERT INTO handoffs (ref, title, site_id, from_department, to_department, requested_by, receiver_id, created_at, updated_at)
                   VALUES ('HND-DX-1', 'dx', 1, 'Processing', 'Finance', 1, 2, $1, $1) ON CONFLICT (ref) DO NOTHING`, [t]);
    const before = (await c.query(`SELECT COUNT(*)::int AS n FROM department_crosswalk`)).rows[0].n;
    const store = makeDepartmentCrosswalkStore({ reports: handle(c), meetings: handle(c) });
    const lines = [];
    const r = await cli.run({ argv: ['--check'], store, log: (s) => lines.push(s) });
    assert.equal(r.code, 0);
    const un = Object.fromEntries(r.report.unmapped.map((v) => [v.value, v]));
    assert.equal(un.Mill.by_source.commitments, 1); assert.equal(un.Mill.known, true, '"Mill" is the listed code mill, which has no pair: reported, not merged with Processing');
    assert.equal(un['Plant ops'].total, 1); assert.equal(un.Processing.by_source.handoffs_from, 1); assert.equal(un.Processing.known, true);
    assert.ok(!un.Mining && !un.mining && !un.Finance, 'mapped values are not reported');
    assert.ok(r.report.mapped >= 3); assert.ok(r.report.not_set >= 1); assert.deepEqual(r.report.not_measured, []);
    const text = lines.join('\n');
    assert.match(text, /Unmapped values found in data \(never merged\)/); assert.match(text, /"Processing" × \d+ \[handoffs_from 1\] \(listed, no pair\)/); assert.match(text, /"Plant ops" × 1 \[commitments 1\] \(not in the crosswalk\)/);
    assert.match(text, /Nothing was changed/);
    assert.equal((await cli.run({ argv: ['--check', '--strict'], store, log: () => {} })).code, 1, '--strict fails while a value is unmapped');
    assert.equal((await cli.run({ argv: [], store, log: () => {} })).code, 2);
    assert.equal((await c.query(`SELECT COUNT(*)::int AS n FROM department_crosswalk`)).rows[0].n, before, 'the tool never writes a pair');
    // a store that cannot be read is "not measured", never 0
    const noMeet = await cli.check({ store: makeDepartmentCrosswalkStore({ reports: handle(c), meetings: null }) });
    assert.deepEqual(noMeet.not_measured.map((m) => m.source), ['pv_issues']);
  } finally { await c.end(); }
});
