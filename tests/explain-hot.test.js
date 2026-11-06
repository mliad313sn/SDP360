'use strict';
// E-A05 — the EXPLAIN tool refuses any database that is not a throwaway one, and its plan summariser
// reads a FORMAT JSON plan correctly (node types, seq scans over 10k rows, timings). No database needed.
const { test } = require('node:test');
const assert = require('node:assert');
const { assertThrowaway, summarisePlan, renderMarkdown, HOT } = require('../tools/pg/explain-hot');

test('guard: only sdp_test_* databases are accepted', () => {
  assert.equal(assertThrowaway('postgres://u:p@localhost:5432/sdp_test_explain_20261105'), 'sdp_test_explain_20261105');
  for (const bad of ['postgres://u@localhost/sdp_dashboard', 'postgres://u@localhost/postgres', 'postgres://u@localhost/sdp_rehearsal_1', 'postgres://u@localhost/prod_sdp_test_x', 'postgres://u@localhost/', 'not a url', 'postgres://u@localhost/sdp_test_x;DROP']) {
    assert.throws(() => assertThrowaway(bad), /refused/, bad);
  }
});

const PLAN = [{ Plan: { 'Node Type': 'Aggregate', 'Actual Rows': 1, 'Actual Loops': 1, 'Shared Hit Blocks': 40, 'Shared Read Blocks': 2,
  Plans: [{ 'Node Type': 'Seq Scan', 'Relation Name': 'request_records', 'Actual Rows': 500, 'Actual Loops': 1, 'Rows Removed by Filter': 99500 },
    { 'Node Type': 'Seq Scan', 'Relation Name': 'sites', 'Actual Rows': 6, 'Actual Loops': 1, 'Rows Removed by Filter': 0 },
    { 'Node Type': 'Index Scan', 'Relation Name': 'weeks', 'Actual Rows': 52, 'Actual Loops': 1 }] },
  'Planning Time': 0.5, 'Execution Time': 21.3 }];

test('summarisePlan: node types, big seq scans only, timings and buffers', () => {
  const s = summarisePlan(PLAN);
  assert.equal(s.top_node, 'Aggregate');
  assert.deepEqual(s.node_types, ['Aggregate', 'Seq Scan', 'Index Scan']);
  assert.deepEqual(s.seq_scans_over_threshold, [{ relation: 'request_records', rows_scanned: 100000, rows_kept: 500 }]);
  assert.equal(s.execution_ms, 21.3); assert.equal(s.planning_ms, 0.5);
  assert.deepEqual([s.shared_hit, s.shared_read], [40, 2]);
  assert.throws(() => summarisePlan([{}]), /EXPLAIN/);
});

test('report: one row per hot reader, states synthetic and no index created', () => {
  const results = HOT.map((h) => Object.assign({ key: h.key, mirrors: h.mirrors }, summarisePlan(PLAN)));
  const md = renderMarkdown(results, { at: 'X', server: 'PostgreSQL 17', commit: 'abc', rows: 100000, reports: 10 });
  assert.match(md, /synthetic rows/); assert.match(md, /No index was created/);
  for (const h of HOT) assert.ok(md.includes(`| ${h.key} |`), h.key);
  assert.equal(HOT.length, 7);
  for (const h of HOT) assert.ok(!/\b(CREATE|DROP|ALTER|INSERT|UPDATE|DELETE)\b/i.test(h.sql), `${h.key} is read-only`);
});
