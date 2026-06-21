'use strict';

// Inspection blobs-on-filesystem: round-trip transparency + DB slimming +
// legacy dual-read. Proves the externalize/inflate change keeps the
// save/load contract byte-identical (the frontend hydrates rec.state; the
// PPTX uses rec.photos/rec.signatures) while removing base64 from SQLite.

const { test, before } = require('node:test');
const assert = require('node:assert');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sdp-insp-blob-'));
process.env.DASH_USER = process.env.DASH_USER || 'smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'smoke-pass-0000';

const idb  = require('../inspection-db');
const blob = require('../services/blobStore');

// 1x1 px PNG + a 1x1 JPEG-ish payload (content doesn't matter, only round-trip).
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wgARCAABAAEDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhADEAAAAT8H/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQI//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwE//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwE//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwI//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/hABr/2gAIAQEAAT8hP//aAAwDAQACAAMAAAAQ/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxA//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxA//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA//9k=';

const INSP_ID = 'EM-IT-20260621-BLOB1';
let rec;

before(() => {
  idb.loadLookups(); // force DB init/seed
  const state = {
    meta: { f_id: INSP_ID, f_site: 'HGO', f_inspector: 'Test Inspector', f_area: 'Server Room',
            sign_insp_name: 'Test Inspector', sign_insp_date: '2026-06-21' },
    items: {
      'net-04': { status: 'major', notes: 'WAN down', photos: [
        { dataUrl: PNG, caption: 'front' }, { dataUrl: JPG, caption: 'back' },
      ] },
      'srv-01': { status: 'ok', notes: '', photos: [ { dataUrl: PNG, caption: 'rack' } ] },
    },
    signatures: { sig_inspector: PNG },
  };
  idb.saveInspection(state, null, 1);
  rec = idb.getInspection(INSP_ID);
});

test('round-trip: rec.state photos/signatures re-inflate to original dataUrls', () => {
  assert.strictEqual(rec.state.items['net-04'].photos[0].dataUrl, PNG);
  assert.strictEqual(rec.state.items['net-04'].photos[1].dataUrl, JPG);
  assert.strictEqual(rec.state.items['srv-01'].photos[0].dataUrl, PNG);
  assert.strictEqual(rec.state.signatures.sig_inspector, PNG);
  // captions + sibling fields preserved
  assert.strictEqual(rec.state.items['net-04'].photos[0].caption, 'front');
  // no leaked __blob markers
  assert.ok(!('__blob' in rec.state.items['net-04'].photos[0]));
});

test('round-trip: rec.photos / rec.signatures re-inflate b64 for the PPTX path', () => {
  assert.strictEqual(rec.photos.length, 3);
  const b64png = PNG.split(',')[1];
  const b64jpg = JPG.split(',')[1];
  const got = rec.photos.map(p => p.data_b64).sort();
  assert.ok(got.includes(b64png), 'png b64 present in rec.photos');
  assert.ok(got.includes(b64jpg), 'jpg b64 present in rec.photos');
  const insp = rec.signatures.find(s => s.signer_type === 'inspector');
  assert.strictEqual(insp.signature_b64, b64png);
});

test('DB is slimmed: state_json carries refs not data: URLs; columns NULL', () => {
  const row = idb.getDB().prepare('SELECT state_json FROM insp_inspections WHERE id=?').get(INSP_ID);
  assert.ok(!/data:image/.test(row.state_json), 'state_json still has inline data: URLs');
  assert.ok(/__blob/.test(row.state_json), 'state_json has no __blob refs');
  const photos = idb.getDB().prepare('SELECT data_b64, file_ref FROM insp_photos WHERE inspection_id=?').all(INSP_ID);
  assert.ok(photos.every(p => p.data_b64 === null && p.file_ref), 'photo b64 not moved out of DB');
  const sigs = idb.getDB().prepare('SELECT signature_b64, file_ref FROM insp_signatures WHERE inspection_id=?').all(INSP_ID);
  assert.ok(sigs.every(s => s.signature_b64 === null && s.file_ref), 'sig b64 not moved out of DB');
});

test('blob files exist on disk under blobs/inspection/<id>/', () => {
  const dir = path.join(blob.BLOB_ROOT, 'inspection', INSP_ID);
  const files = fs.readdirSync(dir);
  assert.ok(files.length >= 4, `expected >=4 blob files, got ${files.length}: ${files}`);
});

test('legacy dual-read: a row with inline b64 + no file_ref still loads', () => {
  const LEG = 'EM-IT-20250101-LEGACY';
  const b64 = PNG.split(',')[1];
  const legacyState = { meta: { f_id: LEG }, items: { 'net-01': { photos: [{ dataUrl: PNG, caption: 'x' }] } }, signatures: { sig_inspector: PNG } };
  // Insert "old-style" directly: state_json keeps inline dataUrl, columns keep b64, file_ref NULL.
  idb.getDB().prepare(`INSERT INTO insp_inspections (id, state_json, status) VALUES (?,?,?)`)
    .run(LEG, JSON.stringify(legacyState), 'submitted');
  idb.getDB().prepare(`INSERT INTO insp_photos (inspection_id, finding_key, caption, mime_type, data_b64, file_ref, size_bytes) VALUES (?,?,?,?,?,?,?)`)
    .run(LEG, 'net-01', 'x', 'image/png', b64, null, b64.length);
  idb.getDB().prepare(`INSERT INTO insp_signatures (inspection_id, signer_type, signature_b64, file_ref) VALUES (?,?,?,?)`)
    .run(LEG, 'inspector', b64, null);
  const got = idb.getInspection(LEG);
  assert.strictEqual(got.state.items['net-01'].photos[0].dataUrl, PNG, 'legacy state dataUrl preserved');
  assert.strictEqual(got.photos[0].data_b64, b64, 'legacy photo b64 preserved');
  assert.strictEqual(got.signatures[0].signature_b64, b64, 'legacy sig b64 preserved');
});

test('delete removes the filesystem blobs', () => {
  const dir = path.join(blob.BLOB_ROOT, 'inspection', INSP_ID);
  assert.ok(fs.existsSync(dir), 'precondition: blob dir exists');
  idb.deleteInspection(INSP_ID);
  assert.ok(!fs.existsSync(dir), 'blob dir should be gone after delete');
});
