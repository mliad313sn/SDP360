'use strict';
// Roadmap Manager Phase 2 — Objective-2 (Plateforme ITSM & actifs) evidence, server side.
//   (a) pure composer `platformEvidence` — CMDB completeness = mean over 4 gaps, null-not-zero
//       when hygiene.total is 0, missing kind → 0 gap (attribute 100%), sdp_total passthrough.
//   (b) glue `loadPlatformEvidence` with injected stub deps — awaits the 3 readers, composes.
//   (c) reader `getAssetCountsByType` against a temp sqlite (SDP_DATA_DIR + ASSETS_BACKEND=sqlite).
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'roadmap-evidence-'));
process.env.ASSETS_BACKEND = 'sqlite';
process.env.REPORTS_BACKEND = process.env.REPORTS_BACKEND || 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'roadmap-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'roadmap-pass-0000';

const { test } = require('node:test');
const assert = require('node:assert');

const ev = require('../services/roadmapEvidence');

// ── (a) pure composer ──────────────────────────────────────────────────
test('platformEvidence: completeness = mean of (1 - gap/total) over the 4 gaps', () => {
  const hygiene = { total: 100, by_kind: [
    { kind: 'no_owner', n: 10 }, { kind: 'no_age', n: 20 },
    { kind: 'no_cost', n: 0 }, { kind: 'never_scanned', n: 10 },
  ] };
  const byType = [{ product_type: 'Laptop', count: 40 }, { product_type: 'Desktop', count: 30 }];
  const out = ev.platformEvidence({ hygiene, sdpTotal: 2471, byType });
  // mean(90, 80, 100, 90) = 90
  assert.equal(out.cmdb_completeness_pct, 90);
  assert.equal(out.sdp_total, 2471, 'sdp_total passthrough');
  assert.equal(out.asset_class_count, 2, 'asset_class_count from byType length');
  assert.deepEqual(out.asset_classes, byType, 'asset_classes = byType as given');
});

test('platformEvidence: hygiene.total === 0 → cmdb_completeness_pct is null, NOT 0', () => {
  const out = ev.platformEvidence({ hygiene: { total: 0, by_kind: [] }, sdpTotal: 0, byType: [] });
  assert.strictEqual(out.cmdb_completeness_pct, null);
  assert.equal(out.sdp_total, 0);
  assert.equal(out.asset_class_count, 0);
});

test('platformEvidence: a missing kind defaults to 0 gap (that attribute = 100%)', () => {
  // only no_owner present at 50/100; the other three absent → 100% each.
  const hygiene = { total: 100, by_kind: [{ kind: 'no_owner', n: 50 }] };
  const out = ev.platformEvidence({ hygiene, sdpTotal: 100, byType: [] });
  // mean(50, 100, 100, 100) = 87.5 → round → 88
  assert.equal(out.cmdb_completeness_pct, 88);
});

test('platformEvidence: reads by_kind whether it is an array OR the real object shape', () => {
  const arr = ev.platformEvidence({ hygiene: { total: 100, by_kind: [{ kind: 'no_owner', n: 10 }, { kind: 'no_age', n: 20 }, { kind: 'no_cost', n: 0 }, { kind: 'never_scanned', n: 10 }] }, sdpTotal: 1, byType: [] });
  const obj = ev.platformEvidence({ hygiene: { total: 100, by_kind: { no_owner: 10, no_age: 20, no_cost: 0, never_scanned: 10 } }, sdpTotal: 1, byType: [] });
  assert.equal(arr.cmdb_completeness_pct, 90);
  assert.equal(obj.cmdb_completeness_pct, 90, 'object shape (the REAL getHygieneSummary shape) composes identically');
});

// ── (b) glue with injected stub deps (await-safe, DB-free) ─────────────
test('loadPlatformEvidence: composes from injected async stub readers', async () => {
  const deps = {
    getHygieneSummary: async () => ({ total: 200, by_kind: { no_owner: 20, no_age: 40, no_cost: 0, never_scanned: 20 } }),
    getAssetSummary: async () => ({ total: 2471, by_state: {} }),
    getAssetCountsByType: async () => [{ product_type: 'Laptop', count: 900 }, { product_type: 'Unknown', count: 100 }],
  };
  const out = await ev.loadPlatformEvidence(deps);
  // gaps 20/200,40/200,0,20/200 → rates 90,80,100,90 → mean 90
  assert.equal(out.cmdb_completeness_pct, 90);
  assert.equal(out.sdp_total, 2471);
  assert.equal(out.asset_class_count, 2);
  assert.equal(out.asset_classes[1].product_type, 'Unknown');
});

// ── (c) reader against a temp sqlite ───────────────────────────────────
test('getAssetCountsByType: grouped by product_type desc, null/empty folds to Unknown', () => {
  const assetsDb = require('../assets-db');
  const cols = ['asset_id', 'product_type'];
  assetsDb.replaceTable('assets', cols, [
    { asset_id: 1, product_type: 'Laptop' },
    { asset_id: 2, product_type: 'Laptop' },
    { asset_id: 3, product_type: 'Laptop' },
    { asset_id: 4, product_type: 'Desktop' },
    { asset_id: 5, product_type: 'Desktop' },
    { asset_id: 6, product_type: null },
    { asset_id: 7, product_type: '' },
  ]);
  const rows = assetsDb.getAssetCountsByType();
  assert.ok(Array.isArray(rows));
  assert.equal(rows[0].product_type, 'Laptop', 'ordered by count desc');
  assert.equal(rows[0].count, 3);
  const unknown = rows.find(r => r.product_type === 'Unknown');
  assert.ok(unknown, "null and '' fold to Unknown");
  assert.equal(unknown.count, 2);
});

// ── Obj-3: incidents & CAB governance evidence ─────────────────────────
// (a) pure composer `incidentsEvidence`

test('incidentsEvidence: RCA/CA/PIR/LL conformity across MIXED variant keys', () => {
  const majorIncidents = [
    // all-4 filled, canonical trailing-space+colon variants
    { 'UDF:RCA:': 'root', 'UDF:Corrective Action:': 'fix', 'UDF:PIR Required:': 'Yes', 'UDF:Lessons Learned:': 'learned' },
    // all-4 filled, NO-prefix short variants
    { 'Root Cause Analysis': 'root', 'CA': 'fix', 'PIR': 'Yes', 'LL': 'learned' },
    // all-4 filled, another mix of canonical variants
    { 'UDF:Root Cause Analysis :': 'root', 'UDF:Corrective action:': 'fix', 'UDF:PIR Required': 'Yes', 'UDF:Lessons Learned': 'learned' },
    // none filled
    {},
  ];
  const out = ev.incidentsEvidence({ majorIncidents, changeMetrics: null });
  assert.equal(out.total_mi, 4, 'total_mi = array length');
  assert.equal(out.conformity_pct, 75, '3 of 4 have ALL of rca/ca/pir/ll → 75');
  assert.equal(out.rca_pct, 75, 'per-field rca count = 3/4');
  assert.equal(out.ca_pct, 75);
  assert.equal(out.pir_pct, 75);
  assert.equal(out.ll_pct, 75);
});

test('incidentsEvidence: empty MI array → conformity + all *_pct are null (NOT 0)', () => {
  const out = ev.incidentsEvidence({ majorIncidents: [], changeMetrics: { change_success_rate: 91.4, total: 5 } });
  assert.equal(out.total_mi, 0);
  assert.strictEqual(out.conformity_pct, null);
  assert.strictEqual(out.rca_pct, null);
  assert.strictEqual(out.ca_pct, null);
  assert.strictEqual(out.pir_pct, null);
  assert.strictEqual(out.ll_pct, null);
  // change fields still resolve — they are independent of the MI window
  assert.equal(out.change_success_rate, 91.4);
  assert.equal(out.changes_count, 5);
});

test('incidentsEvidence: variant tolerance — RCA blank in canonical key but filled via a variant counts', () => {
  const majorIncidents = [
    { 'UDF:Root Cause Analysis :': '   ', 'RCA': 'the actual root cause' },
  ];
  const out = ev.incidentsEvidence({ majorIncidents, changeMetrics: null });
  assert.equal(out.total_mi, 1);
  assert.equal(out.rca_pct, 100, 'blank canonical + non-blank variant → filled');
  // ca/pir/ll are absent → 0%, and conformity requires ALL four → 0
  assert.equal(out.ca_pct, 0);
  assert.equal(out.conformity_pct, 0);
});

test('incidentsEvidence: change_success_rate + changes_count from changeMetrics, null when absent', () => {
  const withCm = ev.incidentsEvidence({ majorIncidents: [{}], changeMetrics: { change_success_rate: 91.4, total: 42 } });
  assert.equal(withCm.change_success_rate, 91.4);
  assert.equal(withCm.changes_count, 42);
  const noCm = ev.incidentsEvidence({ majorIncidents: [{}], changeMetrics: null });
  assert.strictEqual(noCm.change_success_rate, null);
  assert.strictEqual(noCm.changes_count, null);
});

// (b) glue with injected async stub deps (await-safe, DB-free)
test('loadIncidentsEvidence: composes from injected async stub readers', async () => {
  const deps = {
    getMajorIncidentsHistory: async () => ([
      { 'UDF:RCA:': 'r', 'UDF:Corrective Action:': 'c', 'UDF:PIR Required:': 'Yes', 'UDF:Lessons Learned:': 'l' },
      { 'RCA': 'r' }, // only rca filled
    ]),
    getChangeMetrics: async () => ({ change_success_rate: 88.5, total: 12 }),
  };
  const out = await ev.loadIncidentsEvidence(deps);
  assert.equal(out.total_mi, 2);
  assert.equal(out.conformity_pct, 50, '1 of 2 fully conformant');
  assert.equal(out.rca_pct, 100, 'both have rca');
  assert.equal(out.ca_pct, 50);
  assert.equal(out.change_success_rate, 88.5);
  assert.equal(out.changes_count, 12);
});

// ── Obj-1: catalogue & forms evidence (form adoption + request precision) ──
// (a) pure composer `catalogueEvidence`

test('catalogueEvidence: pct = round(100*n/total) per measure, by_mode passthrough', () => {
  const by_mode = [{ mode: 'Web Portal', n: 120 }, { mode: 'Email', n: 80 }];
  const out = ev.catalogueEvidence({ total: 200, web_form: 120, categorized: 180, subcategorized: 150, by_mode });
  assert.equal(out.total, 200);
  assert.equal(out.web_form_pct, 60, 'form/portal adoption');
  assert.equal(out.categorized_pct, 90, 'request precision (category)');
  assert.equal(out.subcategorized_pct, 75);
  assert.deepEqual(out.by_mode, by_mode, 'by_mode passthrough (already desc)');
});

test('catalogueEvidence: total 0 → all *_pct are null, NOT 0', () => {
  const out = ev.catalogueEvidence({ total: 0, web_form: 0, categorized: 0, subcategorized: 0, by_mode: [] });
  assert.equal(out.total, 0);
  assert.strictEqual(out.web_form_pct, null);
  assert.strictEqual(out.categorized_pct, null);
  assert.strictEqual(out.subcategorized_pct, null);
  assert.deepEqual(out.by_mode, []);
});

test('catalogueEvidence: by_mode sorted desc by n when handed out of order', () => {
  const out = ev.catalogueEvidence({ total: 3, web_form: 1, categorized: 3, subcategorized: 2, by_mode: [{ mode: 'Email', n: 1 }, { mode: 'Web Portal', n: 2 }] });
  assert.equal(out.by_mode[0].mode, 'Web Portal', 'highest n first');
  assert.equal(out.by_mode[1].mode, 'Email');
});

// (b) glue: awaits reader, passes since ~90d before nowMs (ISO), labels window_days
test('loadCatalogueEvidence: composes + passes since = 90d before nowMs (ISO), window_days=90', async () => {
  const nowMs = Date.parse('2026-08-18T00:00:00.000Z');
  let capturedArg = null;
  const deps = {
    nowMs,
    getCatalogueStats: async (arg) => {
      capturedArg = arg;
      return { total: 200, web_form: 120, categorized: 180, subcategorized: 150, by_mode: [{ mode: 'Web Portal', n: 120 }, { mode: 'Email', n: 80 }] };
    },
  };
  const out = await ev.loadCatalogueEvidence(deps);
  assert.equal(out.web_form_pct, 60);
  assert.equal(out.categorized_pct, 90);
  assert.equal(out.subcategorized_pct, 75);
  assert.equal(out.window_days, 90, 'window label for the UI');
  const expectedSince = new Date(nowMs - 90 * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(capturedArg.since, expectedSince, 'since = 90 days before nowMs, ISO');
});

// (c) reader `getCatalogueStats` against a temp sqlite — mode classification IN JS
test('getCatalogueStats: web_form via JS /web|portal|self-service/, categorized counts, window + by_mode', () => {
  const Database = require('better-sqlite3');
  const rdb = require('../reports-db'); // ensures request_records table exists
  const raw = new Database(_path.join(process.env.SDP_DATA_DIR, 'reports.db'));
  raw.prepare('DELETE FROM request_records').run();
  const ins = raw.prepare(
    `INSERT INTO request_records (request_id, created_time, mode, category, sub_category) VALUES (?,?,?,?,?)`
  );
  const rows = [
    ['c1', '2026-08-01T00:00:00Z', 'Web Portal', 'Network', 'WAN'],
    ['c2', '2026-08-02T00:00:00Z', 'Web Portal', 'Network', ''],   // no sub_category
    ['c3', '2026-08-03T00:00:00Z', 'Email', 'Hardware', 'Laptop'],
    ['c4', '2026-08-04T00:00:00Z', 'Phone', '', null],             // no category/sub
    ['c5', '2026-08-05T00:00:00Z', 'Self Service', 'Software', 'Office'],
    ['c6', '2020-01-01T00:00:00Z', 'Web Portal', 'Old', 'Old'],    // BEFORE the window
  ];
  for (const r of rows) ins.run(...r);
  raw.close();

  const stats = rdb.getCatalogueStats({ since: '2026-01-01T00:00:00Z' });
  assert.equal(stats.total, 5, 'only rows within created_time >= since');
  assert.equal(stats.web_form, 3, 'Web Portal(2) + Self Service(1) — classified in JS');
  assert.equal(stats.categorized, 4, 'non-empty category: c1,c2,c3,c5');
  assert.equal(stats.subcategorized, 3, 'non-empty sub_category: c1,c3,c5');
  assert.ok(Array.isArray(stats.by_mode));
  const wp = stats.by_mode.find((m) => m.mode === 'Web Portal');
  assert.equal(wp.n, 2);
  // by_mode descending by n
  for (let i = 1; i < stats.by_mode.length; i++) {
    assert.ok(Number(stats.by_mode[i - 1].n) >= Number(stats.by_mode[i].n), 'by_mode desc by n');
  }
});
