'use strict';
// CISO review 2026-10-29 (P1) — inspection photo and signature files cannot be read or overwritten across sites:
// a saved {__blob} reference is kept only when it belongs to the same inspection (or to its stored record, or is a
// completed upload the server hands over), and no file is written before the cross-site check of a reused id.
const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sdp-insp-refs-'));
process.env.DASH_USER = process.env.DASH_USER || 'smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'smoke-pass-0000';
const idb = require('../inspection-db');
const blob = require('../services/blobStore');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const OTHER = 'data:image/png;base64,' + Buffer.from('attacker bytes').toString('base64');
const A = 'EM-IT-20261029-REFA';
let aRef, aBytes;

before(async () => {
  await idb.loadLookups();
  await idb.saveInspection({ meta: { f_id: A, f_site: 'Hounde (HGO)', f_inspector: 'Site HGO' }, items: { 'net-04': { status: 'major', photos: [{ dataUrl: PNG }] } }, signatures: { sig_inspector: PNG } }, null, 1);
  aRef = `inspection/${A}/net-04-0.png`;
  aBytes = blob.getB64(aRef);
});

test('another site cannot attach (and later read) a foreign photo or signature reference', async () => {
  const B = 'EM-IT-20261029-REFB';
  await assert.rejects(idb.saveInspection({ meta: { f_id: B, f_site: 'Mana (MGO)' }, items: { 'net-04': { status: 'ok', photos: [{ __blob: `inspection/${A}/net-04-0.png` }] } } }, ['MGO'], 2), /reference not allowed/);
  await assert.rejects(idb.saveInspection({ meta: { f_id: B, f_site: 'Mana (MGO)' }, items: {}, signatures: { sig_inspector: { __blob: `inspection/${A}/sig-inspector.png` } } }, ['MGO'], 2), /reference not allowed/);
  await assert.rejects(idb.saveInspection({ meta: { f_id: B, f_site: 'Mana (MGO)' }, items: { x: { photos: [{ __blob: 'field/u1/9-abc.jpg' }] } } }, ['MGO'], 2), /reference not allowed/, 'another user\'s field upload');
});

test('reusing another site\'s inspection id is refused BEFORE any file is written', async () => {
  await assert.rejects(idb.saveInspection({ meta: { f_id: A, f_site: 'Mana (MGO)' }, items: { 'net-04': { status: 'ok', photos: [{ dataUrl: OTHER }] } } }, ['MGO'], 2), /Cross-site/);
  assert.strictEqual(blob.getB64(`inspection/${A}/net-04-0.png`), aBytes, 'site HGO photo bytes unchanged');
});

test('the owner re-saving its own inspection keeps its references; a server-handed upload is accepted', async () => {
  const rec = await idb.getInspection(A);
  const st = JSON.parse(JSON.stringify(rec.state));
  for (const it of Object.values(st.items)) for (const ph of it.photos || []) { delete ph.dataUrl; ph.__blob = ph.__blob || `inspection/${A}/net-04-0.png`; }
  await idb.saveInspection(st, ['HGO'], 1);
  const up = blob.putB64('field', 'u1', '5-xyz', 'image/png', PNG.split(',')[1]);
  st.items['srv-01'] = { status: 'ok', photos: [{ __blob: up.ref }] };
  await idb.saveInspection(st, ['HGO'], 1, { allowRefs: new Set([up.ref]) });
  assert.strictEqual((await idb.getInspection(A)).state.items['srv-01'].photos[0].dataUrl, PNG, 'the handed-over upload is attached and read back');
});
