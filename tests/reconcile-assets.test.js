'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { normaliseKey, dedupeBySource, reconcile } = require('../services/reconcileAssets');

// ── La jointure. Rien en aval ne rattrape une cle fausse. ────────────────────
test('trois formes du meme nom donnent une seule cle', () => {
  assert.strictEqual(normaliseKey('EDVSABLT409112'), 'EDVSABLT409112');
  assert.strictEqual(normaliseKey('edvsablt409112.edv-ops.com'), 'EDVSABLT409112');
  assert.strictEqual(normaliseKey('EDVSABLT409112$'), 'EDVSABLT409112');
  assert.strictEqual(normaliseKey('  edvsablt409112  '), 'EDVSABLT409112');
});

test('une cle vide ou absente ne devient jamais une chaine vide exploitable', () => {
  assert.strictEqual(normaliseKey(''), null);
  assert.strictEqual(normaliseKey(null), null);
  assert.strictEqual(normaliseKey(undefined), null);
  assert.strictEqual(normaliseKey('   '), null);
  assert.strictEqual(normaliseKey('.edv-ops.com'), null, 'un FQDN sans hote n est pas une machine');
});

// 21 413 lignes Entra ne sont pas 21 413 machines : une machine reenregistree
// apparait plusieurs fois. Sans dedup le compteur d'ecarts gonfle sans qu'une
// seule machine supplementaire n'existe.
test('la dedup garde la ligne la plus recente par cle ET par source', () => {
  const rows = [
    { source: 'entra', device_name: 'PC1', last_seen: '2026-01-01T00:00:00Z' },
    { source: 'entra', device_name: 'pc1', last_seen: '2026-07-20T00:00:00Z' },
    { source: 'ad', device_name: 'PC1', last_seen: '2026-03-01T00:00:00Z' },
  ];
  const out = dedupeBySource(rows);
  assert.strictEqual(out.length, 2, 'une par source, pas une par ligne');
  assert.strictEqual(out.find((r) => r.source === 'entra').last_seen, '2026-07-20T00:00:00Z');
});

test('une ligne sans date perd toujours contre une ligne datee', () => {
  const out = dedupeBySource([
    { source: 'ad', device_name: 'PC1', last_seen: null },
    { source: 'ad', device_name: 'PC1', last_seen: '2026-07-20T00:00:00Z' },
  ]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].last_seen, '2026-07-20T00:00:00Z');
});

// ── Les ecarts ──────────────────────────────────────────────────────────────
test('un ecart = vu recemment ailleurs, absent de SDP', () => {
  const sdp = [{ asset_name: 'HGO-LAP-001', site: 'HOUNDE' }];
  const ext = [
    { source: 'ad', device_name: 'HGO-LAP-001', last_seen: '2026-07-22T00:00:00Z', enabled: true },
    { source: 'ad', device_name: 'HGO-LAP-999', last_seen: '2026-07-22T00:00:00Z', enabled: true },
  ];
  const r = reconcile({ sdpAssets: sdp, externalDevices: ext, asOf: '2026-07-23', recentDays: 30 });
  assert.deepStrictEqual(r.gaps.map((g) => g.device_name), ['HGO-LAP-999']);
});

test('la correspondance SDP est normalisee des DEUX cotes', () => {
  // Un actif SDP enregistre en FQDN doit reconnaitre la forme courte d'AD,
  // sinon la machine est comptee comme un ecart alors qu'elle est inventoriee.
  const sdp = [{ asset_name: 'hgo-lap-001.edv-ops.com', site: 'HOUNDE' }];
  const ext = [{ source: 'ad', device_name: 'HGO-LAP-001', last_seen: '2026-07-22T00:00:00Z', enabled: true }];
  const r = reconcile({ sdpAssets: sdp, externalDevices: ext, asOf: '2026-07-23', recentDays: 30 });
  assert.strictEqual(r.gaps.length, 0);
});

test('une machine ancienne ou desactivee n est pas un ecart', () => {
  const ext = [
    { source: 'ad', device_name: 'OLD-1', last_seen: '2025-01-01T00:00:00Z', enabled: true },
    { source: 'ad', device_name: 'OFF-1', last_seen: '2026-07-22T00:00:00Z', enabled: false },
    { source: 'ad', device_name: 'NODATE-1', last_seen: null, enabled: true },
  ];
  const r = reconcile({ sdpAssets: [], externalDevices: ext, asOf: '2026-07-23', recentDays: 30 });
  assert.strictEqual(r.gaps.length, 0);
  assert.strictEqual(r.excluded.stale, 1);
  assert.strictEqual(r.excluded.disabled, 1);
  assert.strictEqual(r.excluded.no_date, 1);
});

// La ventilation des exclusions est aussi importante que le resultat : sans
// elle personne ne fera confiance au chiffre retenu.
test('les exclusions portent toujours leurs trois cles, meme a zero', () => {
  const r = reconcile({ sdpAssets: [], externalDevices: [], asOf: '2026-07-23', recentDays: 30 });
  assert.deepStrictEqual(Object.keys(r.excluded).sort(), ['disabled', 'no_date', 'stale']);
  assert.strictEqual(r.excluded.stale, 0);
});

test('vue par les deux sources est un signal plus fort, et il est conserve', () => {
  const ext = [
    { source: 'ad', device_name: 'X1', last_seen: '2026-07-22T00:00:00Z', enabled: true },
    { source: 'entra', device_name: 'X1', last_seen: '2026-07-21T00:00:00Z', enabled: true },
  ];
  const r = reconcile({ sdpAssets: [], externalDevices: ext, asOf: '2026-07-23', recentDays: 30 });
  assert.strictEqual(r.gaps.length, 1, 'une machine, pas deux');
  assert.deepStrictEqual(r.gaps[0].sources.sort(), ['ad', 'entra']);
  assert.strictEqual(r.gaps[0].last_seen, '2026-07-22T00:00:00Z', 'la vue la plus recente des deux');
});

// ── Le sens inverse ─────────────────────────────────────────────────────────
test('sens inverse : dans SDP, invisible ailleurs depuis staleDays', () => {
  const sdp = [{ asset_name: 'GONE-1', site: 'ITY' }, { asset_name: 'HERE-1', site: 'ITY' }];
  const ext = [{ source: 'ad', device_name: 'HERE-1', last_seen: '2026-07-22T00:00:00Z', enabled: true }];
  const r = reconcile({ sdpAssets: sdp, externalDevices: ext, asOf: '2026-07-23', recentDays: 30, staleDays: 90 });
  assert.deepStrictEqual(r.retirementCandidates.map((x) => x.asset_name), ['GONE-1']);
});

test('sens inverse : une machine vue il y a peu n est PAS candidate au retrait', () => {
  const sdp = [{ asset_name: 'SEEN-1', site: 'ITY' }];
  const ext = [{ source: 'entra', device_name: 'SEEN-1', last_seen: '2026-06-01T00:00:00Z', enabled: true }];
  const r = reconcile({ sdpAssets: sdp, externalDevices: ext, asOf: '2026-07-23', recentDays: 30, staleDays: 90 });
  assert.strictEqual(r.retirementCandidates.length, 0, 'vue il y a 52 j, sous le seuil de 90');
});

test('sens inverse : une machine desactivee cote AD compte comme non vue', () => {
  // Un compte machine desactive n'est pas une preuve de presence.
  const sdp = [{ asset_name: 'OFF-1', site: 'ITY' }];
  const ext = [{ source: 'ad', device_name: 'OFF-1', last_seen: '2026-07-22T00:00:00Z', enabled: false }];
  const r = reconcile({ sdpAssets: sdp, externalDevices: ext, asOf: '2026-07-23', recentDays: 30, staleDays: 90 });
  assert.strictEqual(r.retirementCandidates.length, 1);
});

// ── asOf ────────────────────────────────────────────────────────────────────
test('asOf est injecte — aucune horloge interne', () => {
  const ext = [{ source: 'ad', device_name: 'X', last_seen: '2026-06-01T00:00:00Z', enabled: true }];
  const a = reconcile({ sdpAssets: [], externalDevices: ext, asOf: '2026-06-10', recentDays: 30 });
  const b = reconcile({ sdpAssets: [], externalDevices: ext, asOf: '2026-09-10', recentDays: 30 });
  assert.strictEqual(a.gaps.length, 1);
  assert.strictEqual(b.gaps.length, 0, 'la meme donnee, trois mois plus tard, n est plus un ecart');
});

test('les compteurs de tete resument sans qu on ait a compter les lignes', () => {
  const ext = [
    { source: 'ad', device_name: 'A', last_seen: '2026-07-22T00:00:00Z', enabled: true },
    { source: 'ad', device_name: 'B', last_seen: '2020-01-01T00:00:00Z', enabled: true },
  ];
  const r = reconcile({ sdpAssets: [], externalDevices: ext, asOf: '2026-07-23', recentDays: 30 });
  assert.strictEqual(r.counts.external_total, 2);
  assert.strictEqual(r.counts.external_kept, 1);
  assert.strictEqual(r.counts.gaps, 1);
  assert.strictEqual(r.counts.sdp_total, 0);
});

test('une entree externe sans nom exploitable est ignoree, pas comptee', () => {
  const ext = [
    { source: 'entra', device_name: '', last_seen: '2026-07-22T00:00:00Z', enabled: true },
    { source: 'entra', device_name: 'OK-1', last_seen: '2026-07-22T00:00:00Z', enabled: true },
  ];
  const r = reconcile({ sdpAssets: [], externalDevices: ext, asOf: '2026-07-23', recentDays: 30 });
  assert.strictEqual(r.gaps.length, 1);
  assert.strictEqual(r.gaps[0].device_name, 'OK-1');
});

test('entrees vides ou absentes : aucun jet, des compteurs a zero', () => {
  for (const arg of [{}, { sdpAssets: null, externalDevices: null, asOf: '2026-07-23' }]) {
    const r = reconcile(arg);
    assert.strictEqual(r.gaps.length, 0);
    assert.strictEqual(r.retirementCandidates.length, 0);
  }
});
