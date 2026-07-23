'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  parseCsv, parseAdCsv, parseEntraCsv, parseDefenderCsv, MissingColumnError,
} = require('../services/reconcileImport');

// ── Le CSV lui-meme ─────────────────────────────────────────────────────────
test('les guillemets protegent les virgules — un DN reste entier', () => {
  // Un distinguishedName contient des virgules par construction. Un split(',')
  // naif le decoupe en cinq colonnes et decale TOUT le reste de la ligne.
  const rows = parseCsv('a,b\r\n"CN=X,OU=Y,DC=z",2\r\n').rows;
  assert.deepStrictEqual(rows[0], { a: 'CN=X,OU=Y,DC=z', b: '2' });
});

test('un guillemet double a l interieur d un champ est un guillemet litteral', () => {
  const rows = parseCsv('a\r\n"il dit ""bonjour"""\r\n').rows;
  assert.strictEqual(rows[0].a, 'il dit "bonjour"');
});

test('un saut de ligne DANS un champ entre guillemets ne coupe pas la ligne', () => {
  const rows = parseCsv('a,b\r\n"deux\nlignes",fin\r\n').rows;
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].a, 'deux\nlignes');
});

test('LF seul et CRLF donnent le meme resultat', () => {
  assert.deepStrictEqual(parseCsv('a,b\nx,y\n').rows, parseCsv('a,b\r\nx,y\r\n').rows);
});

test('une ligne vide en fin de fichier ne produit pas une ligne fantome', () => {
  assert.strictEqual(parseCsv('a\r\nx\r\n\r\n').rows.length, 1);
});

// ── Lecture par en-tete ─────────────────────────────────────────────────────
test('les colonnes sont lues par en-tete, dans le desordre', () => {
  // L'operateur peut laisser toutes les colonnes du portail, dans l'ordre
  // qu'il veut. Lire par position serait un contrat qu'on ne controle pas.
  const csv = 'operatingSystem,name,lastLogonTimestamp,enabled,distinguishedName\r\n'
            + 'Windows 11 Pro,HGO-LAP-645,2026-07-21T08:00:00Z,True,"CN=HGO-LAP-645,OU=Hounde,DC=edv-ops,DC=com"\r\n';
  const r = parseAdCsv(csv);
  assert.strictEqual(r.rows.length, 1);
  assert.strictEqual(r.rows[0].device_name, 'HGO-LAP-645');
  assert.strictEqual(r.rows[0].os, 'Windows 11 Pro');
  assert.strictEqual(r.rows[0].enabled, true);
  assert.strictEqual(r.rows[0].ou_dn, 'CN=HGO-LAP-645,OU=Hounde,DC=edv-ops,DC=com');
  assert.strictEqual(r.rows[0].source, 'ad');
});

test('la casse et les espaces de l en-tete sont ignores', () => {
  const csv = ' NAME , Operating System \r\nX1,Windows 11\r\n';
  assert.strictEqual(parseAdCsv(csv).rows[0].device_name, 'X1');
});

test('une colonne requise manquante est NOMMEE, pas signalee vaguement', () => {
  // "colonne manquante" sans le nom oblige l'operateur a deviner laquelle,
  // devant un export de 12 colonnes.
  const csv = 'operatingSystem,enabled\r\nWindows 11 Pro,True\r\n';
  assert.throws(() => parseAdCsv(csv), (e) => e instanceof MissingColumnError && /name/.test(e.message));
});

test('MissingColumnError porte la colonne dans un champ, pas seulement dans le texte', () => {
  try { parseAdCsv('operatingSystem\r\nWindows\r\n'); assert.fail('aurait du jeter'); }
  catch (e) { assert.strictEqual(e.column, 'name'); assert.strictEqual(e.source, 'ad'); }
});

test('le BOM UTF-8 en tete de fichier ne casse pas le premier en-tete', () => {
  // Meme piege qu'Assets.csv : non retire, columns['name'] est undefined et
  // TOUTES les lignes sont rejetees, en silence. Ici la 1re colonne EST le nom
  // de machine, donc le fichier entier partirait a la poubelle sans un mot.
  const csv = '﻿name,operatingSystem,lastLogonTimestamp,enabled\r\nX1,Windows 11,2026-07-21T08:00:00Z,True\r\n';
  assert.strictEqual(parseAdCsv(csv).rows[0].device_name, 'X1');
});

test('un fichier vide ou sans ligne de donnees ne jette pas', () => {
  for (const csv of ['', '\r\n', 'name,enabled\r\n']) {
    const r = parseAdCsv(csv);
    assert.strictEqual(r.rows.length, 0);
  }
});

// ── Valeurs ─────────────────────────────────────────────────────────────────
test('enabled accepte les formes que produisent PowerShell, Graph et Excel', () => {
  const mk = (v) => parseAdCsv('name,enabled\r\nX,' + v + '\r\n').rows[0].enabled;
  for (const v of ['True', 'true', 'TRUE', '1', 'VRAI', 'yes']) assert.strictEqual(mk(v), true, v);
  for (const v of ['False', 'false', '0', 'FAUX', 'no']) assert.strictEqual(mk(v), false, v);
});

test('un enabled illisible vaut null, PAS false', () => {
  // reconcileAssets traite null comme "actif". Un false invente exclurait la
  // machine du rapport en silence — c'est-a-dire la ferait disparaitre.
  assert.strictEqual(parseAdCsv('name,enabled\r\nX,peut-etre\r\n').rows[0].enabled, null);
});

test('une ligne sans nom de machine est comptee comme ignoree, pas gardee', () => {
  const r = parseAdCsv('name,enabled\r\n,True\r\nOK-1,True\r\n');
  assert.strictEqual(r.rows.length, 1);
  assert.strictEqual(r.skipped_no_name, 1);
});

test('un FILETIME brut est converti ET signale', () => {
  // Le collecteur convertit deja. Mais un export fait a la main avec
  // Get-ADComputer sortirait 133000000000000000 : une comparaison de
  // fraicheur sur cet entier est fausse, donc tout le rapport avec.
  const r = parseAdCsv('name,lastLogonTimestamp\r\nX,133654776000000000\r\n');
  assert.match(r.rows[0].last_seen, /^20\d\d-\d\d-\d\dT/);
  assert.strictEqual(r.warnings.length, 1);
  assert.match(r.warnings[0], /FILETIME/i);
});

test('une date illisible devient null et est signalee une seule fois', () => {
  const r = parseAdCsv('name,lastLogonTimestamp\r\nX,pas une date\r\nY,pas une date non plus\r\n');
  assert.strictEqual(r.rows[0].last_seen, null);
  assert.strictEqual(r.warnings.filter((w) => /date/i.test(w)).length, 1,
    'un avertissement par TYPE de probleme, pas par ligne — sinon 500 lignes illisibles');
});

test('une date jj/mm ambigue est refusee, pas devinee', () => {
  // Le collecteur emet desormais de l ISO, mais les exports deja faits a la
  // main portent le format regional de la machine collectrice. '01/02/2024'
  // est janvier pour un poste US et fevrier pour un poste FR, sans aucun signe
  // distinctif. La deviner, c est se tromper une fois sur deux en silence.
  const r = parseAdCsv('name,whenCreated\r\nX,01/02/2024 11:05:01\r\n');
  assert.strictEqual(r.rows[0].created, null);
  assert.match(r.warnings.join(' '), /ambig/i);
});

test('une date jj/mm NON ambigue est acceptee', () => {
  // 16 ne peut etre qu un jour : l ordre est determine, on ne perd rien.
  const r = parseAdCsv('name,whenCreated\r\nX,12/16/2022 13:54:36\r\n');
  assert.match(r.rows[0].created, /^2022-12-16T/);
});

// ── Entra ───────────────────────────────────────────────────────────────────
test('Entra : trustType et derniere connexion sont lus', () => {
  const csv = 'displayName,accountEnabled,operatingSystem,trustType,approximateLastSignInDateTime\r\n'
            + 'EDVSABLT409112,true,Windows,Hybrid Azure AD joined,2026-07-21T06:12:00Z\r\n';
  const r = parseEntraCsv(csv);
  assert.strictEqual(r.rows[0].device_name, 'EDVSABLT409112');
  assert.strictEqual(r.rows[0].join_type, 'Hybrid Azure AD joined');
  assert.strictEqual(r.rows[0].enabled, true);
  assert.strictEqual(r.rows[0].source, 'entra');
});

test('Entra : joinType est accepte comme alias de trustType', () => {
  // Le portail a renomme la colonne selon les versions. Les deux doivent
  // marcher, sinon l'operateur voit "colonne manquante" sur un export valide.
  const csv = 'displayName,accountEnabled,joinType\r\nX,true,Azure AD joined\r\n';
  assert.strictEqual(parseEntraCsv(csv).rows[0].join_type, 'Azure AD joined');
});

test('une colonne optionnelle absente ne fait pas echouer', () => {
  const csv = 'displayName,accountEnabled,operatingSystem,trustType,approximateLastSignInDateTime\r\n'
            + 'X,true,Windows,Azure AD joined,2026-07-21T06:12:00Z\r\n';
  assert.strictEqual(parseEntraCsv(csv).rows[0].model, null);
});

// ── Defender ────────────────────────────────────────────────────────────────
test('Defender : Model et Vendor arrivent — c est ce que cette source apporte', () => {
  // Pour une machine ABSENTE de SDP, le type ne pouvait venir que du nom et de
  // l'OS. Model + Vendor redonnent au classificateur sa meilleure source.
  const csv = 'DeviceName,HostName,LastSeen,OSPlatform,DeviceType,Model,Vendor,JoinType,PrimaryUser\r\n'
            + 'hgo-lap-645.edv-ops.com,HGO-LAP-645,2026-07-21T08:00:00Z,Windows11,Workstation,'
            + 'EliteBook 840 G8,HP,Hybrid Azure AD joined,jdupont\r\n';
  const r = parseDefenderCsv(csv);
  assert.strictEqual(r.rows[0].device_name, 'HGO-LAP-645', 'HostName prime sur le FQDN');
  assert.strictEqual(r.rows[0].model, 'EliteBook 840 G8');
  assert.strictEqual(r.rows[0].vendor, 'HP');
  assert.strictEqual(r.rows[0].user_name, 'jdupont');
  assert.strictEqual(r.rows[0].source, 'defender');
});

test('Defender : sans HostName on retombe sur DeviceName', () => {
  // La requete livree projette HostName, mais un export plus ancien ou
  // retouche a la main ne l'aura pas.
  const csv = 'DeviceName,LastSeen,OSPlatform\r\nX1.edv-ops.com,2026-07-21T08:00:00Z,Windows11\r\n';
  assert.strictEqual(parseDefenderCsv(csv).rows[0].device_name, 'X1.edv-ops.com');
});

test('Defender : enabled n existe pas et vaut null, jamais false', () => {
  // Defender n'a pas de notion de compte desactive. Un false par defaut
  // exclurait toute la source du rapport.
  const csv = 'DeviceName,LastSeen\r\nX1,2026-07-21T08:00:00Z\r\n';
  assert.strictEqual(parseDefenderCsv(csv).rows[0].enabled, null);
});

// ── Contrat commun ──────────────────────────────────────────────────────────
test('les trois sources produisent EXACTEMENT la meme forme', () => {
  // reconcileAssets lit une seule forme. Une cle presente chez l'un et absente
  // chez l'autre se lirait "undefined" et se comparerait sans jeter.
  const ad = parseAdCsv('name\r\nX\r\n').rows[0];
  const entra = parseEntraCsv('displayName\r\nX\r\n').rows[0];
  const def = parseDefenderCsv('DeviceName\r\nX\r\n').rows[0];
  const keys = (o) => Object.keys(o).sort();
  assert.deepStrictEqual(keys(entra), keys(ad));
  assert.deepStrictEqual(keys(def), keys(ad));
});

test('raw conserve la ligne d origine — l escape hatch quand une colonne manque', () => {
  const r = parseAdCsv('name,colonneInattendue\r\nX,valeur\r\n');
  assert.strictEqual(r.rows[0].raw.colonneInattendue, 'valeur');
});
