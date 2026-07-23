'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { learnPrefixMap, parseAssetName, head, typeToken, HEAD_MIN } = require('../services/assetNameParser');

// Extrait du parc REEL, avec les proportions mesurees dans
// docs/superpowers/specs/2026-07-23-assets-reconciliation-design.md §2.1.
// Les tetes rares sont volontairement laissees rares : c'est le cas que le
// seuil HEAD_MIN doit refuser d'attribuer.
const ESTATE = [
  ...Array(5).fill({ asset_name: 'HGO-LAP-645', site: 'HOUNDE' }),
  ...Array(4).fill({ asset_name: 'HGO-DSK-604', site: 'HOUNDE' }),
  ...Array(5).fill({ asset_name: 'EDVSABWS281033', site: 'Sabodala' }),
  ...Array(3).fill({ asset_name: 'TGZSABWS408047', site: 'Sabodala' }),
  ...Array(4).fill({ asset_name: 'BFLTP440', site: 'MANA' }),
  { asset_name: 'FGT-MANA-300d-2.edv-ops.com', site: 'MANA' },
];

test('la tete alphabetique ignore separateurs et chiffres', () => {
  assert.strictEqual(head('HGO-LAP-645'), 'HGOLAP');
  assert.strictEqual(head('EDVSABWS281033'), 'EDVSABWS');
  assert.strictEqual(head('TGZSABWS703009'), 'TGZSABWS');
  assert.strictEqual(head('BFDSK397'), 'BFDSK');
});

test('deux eres du meme site restent deux tetes pointant vers le meme site', () => {
  // TGZSAB (Teranga historique) et EDVSAB (Endeavour actuel) designent Sabodala.
  // Aucune regle ne les fusionne : la carte apprise les resout independamment.
  const m = learnPrefixMap(ESTATE);
  assert.strictEqual(m.get('EDVSABWS').site, 'Sabodala');
  assert.strictEqual(m.get('TGZSABWS').site, 'Sabodala');
});

test('la purete est remontee, pas seulement le site dominant', () => {
  const mixed = [
    ...Array(7).fill({ asset_name: 'EDVDKRLT201001', site: 'Sabodala' }),
    ...Array(2).fill({ asset_name: 'EDVDKRLT201002', site: 'Dakar' }),
  ];
  const e = learnPrefixMap(mixed).get('EDVDKRLT');
  assert.strictEqual(e.site, 'Sabodala');
  assert.ok(e.purity > 0.7 && e.purity < 0.8,
    'purete ~78% exposee, jamais arrondie a une certitude qui n existe pas');
});

// LE test qui protege la promesse du module : ne jamais inventer un site.
test('une tete portant moins de HEAD_MIN machines n attribue aucun site', () => {
  const m = learnPrefixMap(ESTATE);
  const r = parseAssetName('FGT-MANA-999', m);
  assert.strictEqual(r.site, null, 'site indetermine, pas une supposition');
  assert.strictEqual(r.reason, 'head_too_rare');
});

test('un nom inconnu ou vide rend site null sans lever', () => {
  const m = learnPrefixMap(ESTATE);
  assert.strictEqual(parseAssetName('WORKGROUP-PC', m).site, null);
  assert.strictEqual(parseAssetName('', m).site, null);
  assert.strictEqual(parseAssetName(null, m).site, null);
  assert.strictEqual(parseAssetName('12345', m).site, null);
});

test('le jeton de type est extrait quand il est reconnaissable', () => {
  const m = learnPrefixMap(ESTATE);
  assert.strictEqual(parseAssetName('HGO-LAP-999', m).typeToken, 'LAP');
  assert.strictEqual(parseAssetName('EDVSABWS999999', m).typeToken, 'WS');
});

// Cinq graphies de "portable" coexistent dans le parc. Le jeton le plus LONG
// doit gagner, sinon LT rafle LTOP et LTP et le type devient faux.
test('le jeton le plus long gagne : LTOP avant LT', () => {
  assert.strictEqual(typeToken('ITY-LTOP-5441'), 'LTOP');
  assert.strictEqual(typeToken('BFLTP440'), 'LTP');
  assert.strictEqual(typeToken('EDV-LT-104'), 'LT');
  assert.strictEqual(typeToken('EDVSABLT408004'), 'LT');
});

test('un actif sans site ne pollue pas la carte apprise', () => {
  // Un actif SDP dont la colonne site est vide ne doit pas creer une tete
  // pointant vers la chaine vide, qui passerait ensuite pour un site connu.
  const m = learnPrefixMap([
    ...Array(4).fill({ asset_name: 'ZZZ-LAP-1', site: '' }),
    ...Array(3).fill({ asset_name: 'ZZZ-LAP-2', site: 'ITY' }),
  ]);
  assert.strictEqual(m.get('ZZZLAP').site, 'ITY');
  assert.strictEqual(m.get('ZZZLAP').n, 3, 'seuls les actifs avec un site comptent');
});

test('HEAD_MIN est exporte pour que l appelant puisse expliquer le refus', () => {
  assert.strictEqual(typeof HEAD_MIN, 'number');
  assert.ok(HEAD_MIN >= 2);
});
