#!/usr/bin/env node
'use strict';

// ─────────────────────────────────────────────────────────────────────────
// One-shot migration: move inline base64 photos/signatures of EXISTING
// inspections out of inspection.db onto the filesystem blob store.
//
// New saves already externalize blobs automatically (inspection-db.js) and
// reads dual-read (filesystem first, inline b64 fallback) — so the app works
// correctly with or without this migration. This script is purely to SHRINK
// the existing DB by converting the historical backlog (submitted/old
// inspections that won't be re-saved).
//
// It reuses the already-tested code path:  getInspection() inflates legacy
// inline blobs into rec.state.*.dataUrl, then saveInspection() externalizes
// them to the filesystem and strips state_json + nulls the b64 columns. The
// row's original updated_at is restored afterwards so the migration does not
// look like an edit. Idempotent — rows with no inline data: URLs are skipped.
//
// Usage (run on the host that owns inspection.db):
//   node tools/migrate-inspection-blobs.js            # migrate
//   node tools/migrate-inspection-blobs.js --dry-run  # report only, no writes
//
// Honours SDP_DATA_DIR like the rest of the app.
// ─────────────────────────────────────────────────────────────────────────

const idb = require('../inspection-db');

const DRY = process.argv.includes('--dry-run');

function hasInlineBlobs(state) {
  if (!state || typeof state !== 'object') return false;
  for (const val of Object.values(state.items || {})) {
    if (val && Array.isArray(val.photos)) {
      for (const p of val.photos) {
        const u = (p && typeof p === 'object') ? p.dataUrl : p;
        if (typeof u === 'string' && u.startsWith('data:')) return true;
      }
    }
  }
  const sig = (state.signatures || {});
  for (const k of ['sig_inspector', 'sig_site']) {
    if (typeof sig[k] === 'string' && sig[k].startsWith('data:')) return true;
  }
  return false;
}

function main() {
  const db = idb.getDB();
  const rows = db.prepare('SELECT id, updated_at FROM insp_inspections ORDER BY id').all();
  console.log(`[migrate-blobs] ${rows.length} inspection(s) found. dry-run=${DRY}`);

  let migrated = 0, skipped = 0, failed = 0;
  for (const { id, updated_at } of rows) {
    let rec;
    try { rec = idb.getInspection(id); } catch (e) { console.error(`  ✗ ${id}: read failed — ${e.message}`); failed++; continue; }
    if (!rec || !hasInlineBlobs(rec.state)) { skipped++; continue; }

    if (DRY) { console.log(`  • ${id}: WOULD migrate (has inline blobs)`); migrated++; continue; }

    try {
      idb.saveInspection(rec.state, null, null);          // inflate→externalize
      if (updated_at) db.prepare('UPDATE insp_inspections SET updated_at=? WHERE id=?').run(updated_at, id);
      console.log(`  ✓ ${id}: migrated`);
      migrated++;
    } catch (e) {
      console.error(`  ✗ ${id}: migrate failed — ${e.message}`);
      failed++;
    }
  }

  console.log(`[migrate-blobs] done. migrated=${migrated} skipped=${skipped} failed=${failed}`);
  if (failed) process.exitCode = 1;
}

main();
