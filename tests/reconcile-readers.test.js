'use strict';
process.env.ASSETS_BACKEND = 'sqlite';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// assets-db ouvre data/assets.db AU MOMENT DU require : on pointe SDP_DATA_DIR
// sur un dossier jetable AVANT de charger le module, sinon le test ecrirait
// dans la base de developpement.
process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sdp-rec-readers-'));
const db = require('../assets-db');

function dev(name, over) {
  return Object.assign({
    device_key: name.toUpperCase(), device_name: name, dns_name: null,
    os: 'Windows 11 Pro', os_version: null, last_seen: '2026-07-22T00:00:00Z',
    enabled: 1, join_type: null, ou_dn: null, model: null, raw_json: '{}',
  }, over || {});
}

test('replaceExternalDevices remplace la source ciblee et LAISSE l autre', () => {
  db.replaceExternalDevices('ad', [dev('A1')], 'imp-1');
  db.replaceExternalDevices('entra', [dev('E1')], 'imp-1');
  db.replaceExternalDevices('ad', [dev('A2')], 'imp-2');
  const all = db.listExternalDevices();
  assert.deepStrictEqual(all.map((r) => r.device_name).sort(), ['A2', 'E1'],
    'remplacer AD ne doit jamais toucher Entra');
});

test('un remplacement par une liste vide vide bien la source', () => {
  db.replaceExternalDevices('ad', [dev('X1')], 'imp-3');
  db.replaceExternalDevices('ad', [], 'imp-4');
  assert.strictEqual(db.listExternalDevices().filter((r) => r.source === 'ad').length, 0);
});

test('un doublon de cle DANS un meme import ne fait pas exploser l insertion', () => {
  db.replaceExternalDevices('ad', [dev('DUP'), dev('DUP'), dev('OK')], 'imp-5');
  const ad = db.listExternalDevices().filter((r) => r.source === 'ad');
  assert.strictEqual(ad.length, 2);
});

// raw_json est le filet : tant que les noms de colonnes reels d'AD et d'Entra
// ne sont pas connus, ce qui n'est pas mappe doit survivre a l'import, sinon un
// remappage ulterieur imposerait un re-import complet.
test('raw_json est conserve verbatim', () => {
  const payload = JSON.stringify({ colonneInconnue: 'valeur', autre: 42 });
  db.replaceExternalDevices('ad', [dev('R1', { raw_json: payload })], 'imp-6');
  const row = db.listExternalDevices().find((r) => r.device_name === 'R1');
  assert.strictEqual(row.raw_json, payload);
});

test('listImportRuns rend la fraicheur par source', () => {
  db.replaceExternalDevices('ad', [dev('F1')], 'imp-7');
  const runs = db.listImportRuns();
  const ad = runs.find((r) => r.source === 'ad');
  assert.strictEqual(ad.import_id, 'imp-7');
  assert.ok(ad.imported_at, 'horodatage present');
  assert.strictEqual(ad.n, 1);
});

test('setDecision est idempotent et impose un motif pour hors-perimetre', () => {
  db.setDecision('A1', 'out_of_scope', 'poste de pret', 'azize');
  db.setDecision('A1', 'out_of_scope', 'poste de pret', 'azize');
  assert.strictEqual(db.listDecisions().length, 1);
  assert.throws(() => db.setDecision('A2', 'out_of_scope', '', 'azize'), /motif/i);
});

test('une decision inconnue est refusee', () => {
  assert.throws(() => db.setDecision('A3', 'peut-etre', 'x', 'azize'), /decision/i);
});

test('traite n exige pas de motif', () => {
  db.setDecision('A4', 'handled', '', 'azize');
  const d = db.listDecisions().find((x) => x.device_key === 'A4');
  assert.strictEqual(d.decision, 'handled');
});

test('clearDecision retire la ligne', () => {
  db.setDecision('A5', 'handled', '', 'azize');
  db.clearDecision('A5');
  assert.strictEqual(db.listDecisions().find((x) => x.device_key === 'A5'), undefined);
});
