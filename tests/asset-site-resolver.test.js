'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { learnOuMap, topOu, resolveSite, TECHNICAL_OUS } = require('../services/assetSiteResolver');
const { learnPrefixMap } = require('../services/assetNameParser');

const AD = [
  { name: 'ITY-LAP-1', distinguishedName: 'CN=ITY-LAP-1,OU=Workstations,OU=Ity Mine,DC=edv-ops,DC=com' },
  { name: 'ITY-LAP-2', distinguishedName: 'CN=ITY-LAP-2,OU=Workstations,OU=Ity Mine,DC=edv-ops,DC=com' },
  { name: 'ITY-LAP-3', distinguishedName: 'CN=ITY-LAP-3,OU=Workstations,OU=Ity Mine,DC=edv-ops,DC=com' },
  { name: 'ITY-LAP-4', distinguishedName: 'CN=ITY-LAP-4,OU=Workstations,OU=Ity Mine,DC=edv-ops,DC=com' },
  { name: 'ITY-LAP-5', distinguishedName: 'CN=ITY-LAP-5,OU=Workstations,OU=Ity Mine,DC=edv-ops,DC=com' },
  { name: 'SEM-LAP-1', distinguishedName: 'CN=SEM-LAP-1,OU=SEMAFO,DC=edv-ops,DC=com' },
  { name: 'SEM-LAP-2', distinguishedName: 'CN=SEM-LAP-2,OU=SEMAFO,DC=edv-ops,DC=com' },
  { name: 'SEM-LAP-3', distinguishedName: 'CN=SEM-LAP-3,OU=SEMAFO,DC=edv-ops,DC=com' },
  { name: 'SEM-LAP-4', distinguishedName: 'CN=SEM-LAP-4,OU=SEMAFO,DC=edv-ops,DC=com' },
  { name: 'SEM-LAP-5', distinguishedName: 'CN=SEM-LAP-5,OU=SEMAFO,DC=edv-ops,DC=com' },
];
const SDP = [
  { asset_name: 'ITY-LAP-1', site: 'ITY' }, { asset_name: 'ITY-LAP-2', site: 'ITY' },
  { asset_name: 'ITY-LAP-3', site: 'ITY' }, { asset_name: 'ITY-LAP-4', site: 'ITY' },
  { asset_name: 'ITY-LAP-5', site: 'ITY' },
  { asset_name: 'SEM-LAP-1', site: 'MANA' }, { asset_name: 'SEM-LAP-2', site: 'MANA' },
  { asset_name: 'SEM-LAP-3', site: 'MANA' }, { asset_name: 'SEM-LAP-4', site: 'MANA' },
  { asset_name: 'SEM-LAP-5', site: 'MANA' },
];

test('topOu prend l OU la PLUS HAUTE sous le domaine', () => {
  // OU=Servers,OU=Computers,OU=Abidjan Office,DC=... -> "Abidjan Office" :
  // c'est la derniere avant le domaine qui porte le site, pas la premiere.
  assert.strictEqual(topOu('CN=X,OU=Servers,OU=Computers,OU=Abidjan Office,DC=edv-ops,DC=com'), 'Abidjan Office');
  assert.strictEqual(topOu('CN=X,OU=Domain Controllers,DC=edv-ops,DC=com'), 'Domain Controllers');
  assert.strictEqual(topOu('CN=X,CN=Computers,DC=edv-ops,DC=com'), null, 'un conteneur CN n est pas une OU');
  assert.strictEqual(topOu(''), null);
  assert.strictEqual(topOu(null), null);
});

test('la carte OU est apprise sur l intersection AD n SDP', () => {
  const m = learnOuMap(AD, SDP);
  assert.strictEqual(m.get('Ity Mine').site, 'ITY');
  assert.strictEqual(m.get('Ity Mine').purity, 1);
  // Un ancien nom de societe resout vers le site actuel, sans regle ecrite.
  assert.strictEqual(m.get('SEMAFO').site, 'MANA');
});

test('une OU technique n est jamais apprise comme site', () => {
  const m = learnOuMap(
    [{ name: 'X1', distinguishedName: 'CN=X1,OU=New Computers,DC=edv-ops,DC=com' }],
    [{ asset_name: 'X1', site: 'Sabodala' }]);
  assert.strictEqual(m.get('New Computers'), undefined,
    'une OU de transit apprendrait le site du dernier poste qui y est passe');
});

// ── La cascade ──────────────────────────────────────────────────────────────
test('1er niveau : carte OU apprise, quand elle est sure', () => {
  const r = resolveSite({ name: 'INCONNU-99', ouDn: 'CN=X,OU=Ity Mine,DC=edv-ops,DC=com' },
    { ouMap: learnOuMap(AD, SDP), prefixMap: learnPrefixMap(SDP) });
  assert.strictEqual(r.site, 'ITY');
  assert.strictEqual(r.source, 'ou_learned');
});

// LE niveau qui change tout : 453 des 545 ecarts sortaient en "indetermine"
// alors que leur OU disait Kalana, Ouaga ou Exploration Sites.
test('2e niveau : le LIBELLE d OU sert de site quand rien n a ete appris', () => {
  const r = resolveSite({ name: 'INCONNU-99', ouDn: 'CN=X,OU=Kalana,DC=edv-ops,DC=com' },
    { ouMap: learnOuMap(AD, SDP), prefixMap: learnPrefixMap(SDP) });
  assert.strictEqual(r.site, 'Kalana', 'Kalana est plus actionnable que "indetermine"');
  assert.strictEqual(r.source, 'ou_label');
});

test('3e niveau : le nom, quand l OU ne dit rien d exploitable', () => {
  // Un controleur de domaine n'est sous aucune OU de site.
  const r = resolveSite({ name: 'ITY-LAP-9', ouDn: 'CN=X,OU=Domain Controllers,DC=edv-ops,DC=com' },
    { ouMap: learnOuMap(AD, SDP), prefixMap: learnPrefixMap(SDP) });
  assert.strictEqual(r.site, 'ITY');
  assert.strictEqual(r.source, 'name');
});

test('4e niveau : indetermine, avec le motif', () => {
  const r = resolveSite({ name: 'WORKGROUP-PC', ouDn: null },
    { ouMap: learnOuMap(AD, SDP), prefixMap: learnPrefixMap(SDP) });
  assert.strictEqual(r.site, null);
  assert.ok(r.reason);
});

test('une OU technique ne devient jamais un site, meme en 2e niveau', () => {
  const r = resolveSite({ name: 'ZZZ-1', ouDn: 'CN=X,OU=New Computers,DC=edv-ops,DC=com' },
    { ouMap: new Map(), prefixMap: new Map() });
  assert.strictEqual(r.site, null, 'New Computers est une OU de transit, pas un site');
});

test('une carte OU peu sure ou peu fournie retombe sur le libelle', () => {
  // "Ouaga Office" avait 2 exemples et 50% de purete : inexploitable comme
  // carte apprise, mais le libelle reste juste.
  const weak = new Map([['Ouaga Office', { site: 'MANA', purity: 0.5, n: 2 }]]);
  const r = resolveSite({ name: 'X-1', ouDn: 'CN=X,OU=Ouaga Office,DC=edv-ops,DC=com' },
    { ouMap: weak, prefixMap: new Map() });
  assert.strictEqual(r.site, 'Ouaga Office');
  assert.strictEqual(r.source, 'ou_label');
});

test('TECHNICAL_OUS est compare sans tenir compte de la casse', () => {
  assert.ok(TECHNICAL_OUS.some((o) => o.toLowerCase() === 'new computers'));
  const r = resolveSite({ name: 'Z', ouDn: 'CN=X,OU=NEW COMPUTERS,DC=e,DC=com' },
    { ouMap: new Map(), prefixMap: new Map() });
  assert.strictEqual(r.site, null);
});
