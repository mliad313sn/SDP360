'use strict';
// Chunk 3 — inspection.db → PostgreSQL. TDD suite. Runs the postgres backend
// against a throwaway DB; skips cleanly when Postgres is unreachable.
// Verifies the byte-identical blob contract: photos/signatures externalize to
// the filesystem (blobStore) and re-inflate on read exactly as on sqlite.
process.env.INSPECTION_BACKEND = 'postgres';
// loadLookups/listPeople require reports-db.js, which opens its sqlite DB +
// seeds a default admin at module-load (FATAL without these). Isolate + supply
// throwaway creds + a temp DATA_DIR (also where blobStore writes its files).
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'insp-'));
process.env.DASH_USER = process.env.DASH_USER || 'pgtest-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'pgtest-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');
const SCHEMA = _fs.readFileSync(_path.join(__dirname, '../db/postgres/inspection/001_init.sql'), 'utf8');

// Boot an inspection pg handle against a fresh test DB (schema + seed applied).
async function boot() {
  const ctx = await provisionTestDb();
  if (!ctx) return null;
  process.env.PG_URL = ctx.url;
  const idb = require('../inspection-db');
  await idb.initPgInspection();
  return { ctx, idb };
}

// A minimal valid data: URL (bytes are irrelevant — blobStore just stores them).
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const SIG = 'data:image/png;base64,c2lnbmF0dXJl';

function sampleState(overrides = {}) {
  return {
    meta: {
      f_site: 'Hounde (HGO) — Burkina Faso', f_area: 'Server Room',
      f_date: '2026-05-10', f_label: 'May inspection', f_inspector: 'Alice',
      f_risk: 'Critical', sign_insp_name: 'Alice', sign_insp_date: '2026-05-10',
    },
    items: {
      'net__0': { status: 'major', notes: 'switch down', photos: [{ dataUrl: PNG, caption: 'rack' }] },
      'net__1': { status: 'ok', notes: '' },
    },
    actions: [{ desc: 'Replace switch', owner: 'Bob', priority: 'High', due: '2020-01-01', status: 'Open' }],
    signatures: { sig_inspector: SIG },
    status: 'submitted',
    ...overrides,
  };
}

// ── schema + seed + lookups ──────────────────────────────────────────────
test('inspection pg: schema idempotent + lookups seeded + loadLookups', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, idb } = b;
  try {
    await idb.pgHandle().exec(SCHEMA);                  // re-apply schema (IF NOT EXISTS → idempotent)
    const lk = await idb.loadLookups();
    assert.ok(lk.areas.length > 0, 'areas seeded');
    assert.ok(lk.types.length > 0, 'types seeded');
    assert.ok(lk.categories.length > 0, 'categories from INIT');
    const h = idb.pgHandle();
    assert.ok(Number((await h.prepare('SELECT COUNT(*) AS n FROM insp_sites').get()).n) > 0, 'sites seeded');
    assert.ok(Number((await h.prepare('SELECT COUNT(*) AS n FROM insp_categories').get()).n) > 0, 'categories seeded');
  } finally { try { await idb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

// ── saveInspection round-trip + blob externalize/inflate + cross-site ──────
test('inspection pg: save round-trip + blob contract + cross-site guard', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, idb } = b;
  try {
    const r = await idb.saveInspection(sampleState(), null, 1);
    assert.ok(r.id); assert.equal(r.created, true);

    const full = await idb.getInspection(r.id);
    assert.equal(full.header.status, 'submitted');
    assert.ok(full.header.submitted_at, 'submitted_at stamped');
    assert.equal(full.findings.length, 2);
    assert.equal(full.actions.length, 1);
    assert.equal(full.actions[0].owner, 'Bob');
    // Blob contract: photo stored as filesystem ref, re-read as b64; state
    // inflated back to a data: URL — both must look exactly like sqlite.
    assert.equal(full.photos.length, 1);
    assert.ok(full.photos[0].data_b64, 'photo b64 re-read from filesystem blob');
    assert.equal(full.signatures.length, 1);
    assert.ok(full.signatures[0].signature_b64, 'signature b64 re-read');
    assert.ok(full.state.items['net__0'].photos[0].dataUrl.startsWith('data:'),
      'state photo re-inflated to a data: URL');
    // The persisted state_json must NOT carry the heavy inline data: URL.
    const raw = await idb.pgHandle().prepare('SELECT state_json FROM insp_inspections WHERE id = ?').get(r.id);
    assert.ok(!raw.state_json.includes('data:image'), 'state_json carries __blob ref, not inline data:');

    // Re-save (update) preserves the same id + flips created:false.
    const r2 = await idb.saveInspection(sampleState({ meta: { ...sampleState().meta, f_id: r.id, f_label: 'edited' } }), null, 1);
    assert.equal(r2.id, r.id); assert.equal(r2.created, false);
    assert.equal((await idb.getInspection(r.id)).header.label, 'edited');

    await assert.rejects(idb.saveInspection({ meta: { f_site: 'Mana (MGO)' } }, 'HGO', 1), /Cross-site/);
  } finally { try { await idb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

// ── list + status + aggregate ──────────────────────────────────────────────
test('inspection pg: listInspections + getInspectionStatus + aggregate', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, idb } = b;
  try {
    const r = await idb.saveInspection(sampleState(), null, 1);
    const list = await idb.listInspections({ site: 'HGO' });
    assert.equal(list.length, 1); assert.equal(list[0].id, r.id);
    assert.equal(await idb.getInspectionStatus(r.id), 'submitted');

    const agg = await idb.aggregate({ site: 'HGO' });
    assert.equal(agg.counts.total, 1); assert.equal(typeof agg.counts.total, 'number');
    assert.equal(agg.counts.critical_count, 1, 'overall_risk Critical counted');
    assert.equal(agg.open_actions, 1);
    assert.equal(agg.overdue_actions, 1, 'due 2020 is overdue');
    assert.ok(agg.monthly.find(m => m.ym === '2026-05'));
  } finally { try { await idb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

// ── actions register: listActions + addActionUpdate + parent + thread ──────
test('inspection pg: listActions + addActionUpdate closes + parent + updates', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, idb } = b;
  try {
    const r = await idb.saveInspection(sampleState(), null, 1);
    const acts = await idb.listActions({ site: 'hgo' });          // lower() case-insensitive
    assert.equal(acts.length, 1); assert.ok(acts[0].inspection_label);
    assert.equal((await idb.listActions({ overdue: true })).length, 1, 'overdue flagged');
    assert.equal((await idb.listActions({ q: 'switch' })).length, 1, 'ILIKE q match');

    const actionId = acts[0].id;
    const parent = await idb.getActionParent(actionId);
    assert.equal(parent.site_code, 'HGO'); assert.equal(parent.inspection_status, 'submitted');

    await idb.addActionUpdate(actionId, { author_name: 'me', body: 'fixed', status_change: 'Closed' });
    const after = await idb.getInspection(r.id);
    assert.equal(after.actions[0].status, 'Closed');
    assert.ok(after.actions[0].closed_at, 'closed_at stamped on terminal status');
    assert.ok((await idb.listActionUpdates(actionId)).length >= 1);
  } finally { try { await idb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

// ── delete cascade + resetLookups ──────────────────────────────────────────
test('inspection pg: deleteInspection cascade + resetLookups', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, idb } = b;
  try {
    const r = await idb.saveInspection(sampleState(), null, 1);
    const h = idb.pgHandle();
    assert.equal(await idb.deleteInspection(r.id), true);
    assert.equal(await idb.getInspection(r.id), null);
    // FK CASCADE wiped children too.
    assert.equal(Number((await h.prepare('SELECT COUNT(*) AS n FROM insp_findings WHERE inspection_id = ?').get(r.id)).n), 0);
    assert.equal(Number((await h.prepare('SELECT COUNT(*) AS n FROM insp_photos WHERE inspection_id = ?').get(r.id)).n), 0);

    await idb.resetLookups();
    assert.ok((await idb.loadLookups()).areas.length > 0, 'lookups reseeded after reset');
  } finally { try { await idb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});
