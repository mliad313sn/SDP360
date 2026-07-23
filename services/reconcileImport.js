'use strict';
/**
 * reconcileImport — lit les exports CSV des trois sources externes et les rend
 * dans UNE SEULE forme, celle que `reconcileAssets` sait comparer.
 *
 *   ad        Collect-ADComputers.ps1 (fourni), ou un Get-ADComputer maison
 *   entra     export « Appareils » du portail Entra
 *   defender  export du portail Defender XDR (requete tools/reconcile/DeviceInfo.kql)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DEUX RÈGLES QUI PORTENT TOUT LE RESTE
 *
 * 1. LECTURE PAR NOM D'EN-TÊTE, JAMAIS PAR POSITION. L'opérateur exporte
 *    depuis un portail dont on ne contrôle ni l'ordre ni le nombre de
 *    colonnes ; Microsoft en ajoute et en renomme au fil des versions. Lire
 *    par position, c'est signer un contrat qu'on ne tient pas.
 *
 * 2. UNE COLONNE ABSENTE EST NOMMÉE, ET LA LECTURE S'ARRÊTE. C'est ce qui
 *    rend acceptable de deviner les en-têtes d'un portail dont on n'a pas
 *    encore vu d'export : le pari, s'il est faux, échoue immédiatement et dit
 *    lequel. Un parseur silencieux rendrait « 0 écart » — c'est-à-dire la
 *    meilleure nouvelle possible — sur un fichier qu'il n'a pas su lire.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PUR — ne lit aucun fichier, ne connaît aucune base. On lui passe le texte.
 */

class MissingColumnError extends Error {
  constructor(column, source, seen) {
    super('Colonne « ' + column + ' » absente de l\'export ' + source
      + '. Colonnes trouvées : ' + (seen.length ? seen.join(', ') : '(aucune)'));
    this.name = 'MissingColumnError';
    this.column = column;
    this.source = source;
    this.seen = seen;
  }
}

/**
 * Découpe un CSV. Écrit à la main plutôt que `split(',')` pour une raison
 * précise : un `distinguishedName` CONTIENT des virgules
 * (`CN=X,OU=Y,DC=z`). Un split naïf le coupe en trois colonnes et décale
 * toute la fin de la ligne — les dates atterrissent dans le champ OS et rien
 * ne proteste.
 *
 * Gère : BOM, CRLF et LF, guillemets, `""` littéral, sauts de ligne à
 * l'intérieur d'un champ entre guillemets.
 */
function parseCsv(text) {
  let s = String(text == null ? '' : text);
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);   // BOM — cf. le piège Assets.csv
  if (!s.trim()) return { header: [], rows: [] };

  const records = [];
  let field = '';
  let record = [];
  let quoted = false;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }   // "" → un guillemet
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { record.push(field); field = ''; continue; }
    if (c === '\r') continue;                          // CRLF → traité par le \n
    if (c === '\n') { record.push(field); records.push(record); field = ''; record = []; continue; }
    field += c;
  }
  if (field.length || record.length) { record.push(field); records.push(record); }

  // Une ligne vide en fin de fichier n'est pas un enregistrement.
  const clean = records.filter((r) => r.some((v) => String(v).trim().length));
  if (!clean.length) return { header: [], rows: [] };

  const header = clean[0].map((h) => String(h).trim());
  const rows = clean.slice(1).map((cells) => {
    const o = {};
    header.forEach((h, i) => { o[h] = cells[i] == null ? '' : cells[i]; });
    return o;
  });
  return { header, rows };
}

/** Clé d'en-tête tolérante : casse, espaces, tirets et soulignés ignorés. */
function _hkey(h) {
  return String(h == null ? '' : h).replace(/^﻿/, '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

/**
 * Le contrat de sortie. TOUTES les sources rendent ces clés, même à null :
 * `reconcileAssets` lit une seule forme, et une clé présente chez l'une et
 * absente chez l'autre se lirait `undefined` sans que rien ne proteste.
 */
const FIELDS = ['device_name', 'dns_name', 'os', 'os_version', 'last_seen',
  'enabled', 'join_type', 'ou_dn', 'model', 'vendor', 'user_name', 'created'];

/**
 * Candidats d'en-tête par champ, dans l'ordre de préférence. Le premier
 * trouvé gagne ; le premier de la liste est aussi le nom cité par
 * `MissingColumnError` quand le champ est requis.
 */
const SPECS = {
  ad: {
    required: ['device_name'],
    map: {
      device_name: ['name', 'cn', 'computername'],
      dns_name: ['dnshostname'],
      os: ['operatingsystem'],
      os_version: ['operatingsystemversion'],
      last_seen: ['lastlogontimestamp', 'lastlogondate', 'lastlogon'],
      enabled: ['enabled'],
      join_type: [],
      ou_dn: ['distinguishedname', 'dn'],
      model: [],
      vendor: [],
      user_name: [],
      created: ['whencreated'],
    },
  },
  entra: {
    required: ['device_name'],
    map: {
      device_name: ['displayname', 'name', 'devicename'],
      dns_name: [],
      os: ['operatingsystem'],
      os_version: ['operatingsystemversion'],
      // Le portail a porté plusieurs noms selon les versions ; tous acceptés.
      last_seen: ['approximatelastsignindatetime', 'lastsignindatetime', 'activitydatetime', 'lastactivity'],
      enabled: ['accountenabled', 'enabled'],
      join_type: ['trusttype', 'jointype'],
      ou_dn: [],
      model: ['model'],
      vendor: ['manufacturer', 'vendor'],
      user_name: ['owner', 'registeredowner', 'userprincipalname'],
      created: ['registrationtime', 'registrationdatetime', 'createddatetime'],
    },
  },
  defender: {
    required: ['device_name'],
    map: {
      // HostName d'abord : c'est la clé de jointure que DeviceInfo.kql projette.
      // DeviceName est le FQDN et sert de repli pour un export retouché.
      device_name: ['hostname', 'devicename'],
      dns_name: ['devicename'],
      os: ['osplatform', 'ostype'],
      os_version: ['osversion'],
      last_seen: ['lastseen', 'timestamp'],
      // Defender n'a AUCUNE notion de compte désactivé — cf. _val() plus bas.
      enabled: [],
      join_type: ['jointype'],
      ou_dn: [],
      model: ['model'],
      vendor: ['vendor', 'manufacturer'],
      user_name: ['primaryuser', 'loggedonusers'],
      created: [],
    },
  },
};

const _TRUE = new Set(['true', '1', 'yes', 'y', 'oui', 'vrai', 'enabled', 'actif']);
const _FALSE = new Set(['false', '0', 'no', 'n', 'non', 'faux', 'disabled', 'inactif']);

/**
 * Un booléen illisible rend `null`, JAMAIS `false`.
 * `reconcileAssets` traite `null` comme « actif » et `false` comme « désactivé,
 * donc exclu ». Un `false` inventé ferait disparaître la machine du rapport
 * sans un mot — l'inverse exact du service rendu.
 */
function _bool(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return null;
  if (_TRUE.has(s)) return true;
  if (_FALSE.has(s)) return false;
  return null;
}

const _AMBIGUOUS_SLASH = /^(\d{1,2})[/](\d{1,2})[/](\d{4})/;

/**
 * Rend une date ISO, ou null.
 *
 * `warn(clé, message)` — la CLÉ est ce qui dédoublonne, pas le message. Le
 * message porte le premier exemple rencontré, ce qui reste utile pour
 * diagnostiquer ; sans clé séparée, deux valeurs illisibles différentes
 * produiraient deux messages différents et un export à 500 lignes fautives
 * rendrait 500 avertissements que personne ne lira.
 */
function _date(v, warn) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;

  // FILETIME 64 bits. Le collecteur convertit déjà, mais un Get-ADComputer
  // fait à la main sort 133654776000000000 : toute comparaison de fraîcheur
  // sur cet entier est fausse, donc tout le rapport d'écarts avec.
  if (/^\d{17,19}$/.test(s)) {
    const ms = Number(s) / 10000 - 11644473600000;
    if (Number.isFinite(ms) && ms > 0) {
      warn('filetime', 'Des dates arrivent en FILETIME brut et ont été converties. '
        + 'Utilisez Collect-ADComputers.ps1, qui le fait à la source.');
      return new Date(ms).toISOString();
    }
  }

  // jj/mm/aaaa contre mm/jj/aaaa : indiscernables dès que les deux premiers
  // nombres sont <= 12. Deviner, c'est se tromper une fois sur deux en
  // silence — on refuse la valeur et on le dit.
  const m = _AMBIGUOUS_SLASH.exec(s);
  if (m && +m[1] <= 12 && +m[2] <= 12) {
    warn('ambigu', 'Des dates au format jj/mm/aaaa ou mm/jj/aaaa sont ambiguës et ont été '
      + 'ignorées (ex. « ' + s + ' '.trim() + ' »). Relancez Collect-ADComputers.ps1, qui émet de l\'ISO.');
    return null;
  }

  const t = Date.parse(s);
  if (!Number.isFinite(t)) {
    warn('illisible', 'Des dates n\'ont pas pu être lues et valent « inconnue » (ex. « ' + s + ' »).');
    return null;
  }
  return new Date(t).toISOString();
}

/** Première colonne présente parmi les candidats, sinon null. */
function _pick(row, keys, index) {
  for (const k of keys) {
    const real = index.get(k);
    if (real !== undefined) {
      const v = String(row[real] == null ? '' : row[real]).trim();
      if (v) return v;
    }
  }
  return null;
}

function _parse(text, source) {
  const spec = SPECS[source];
  const { header, rows } = parseCsv(text);

  const seen = new Map();                                  // clé → message (le 1er rencontré)
  const warn = (k, m) => { if (!seen.has(k)) seen.set(k, m); };

  // Un fichier VIDE et un fichier MAL FORMÉ sont deux problèmes différents, et
  // les confondre envoie l'opérateur chercher une colonne dans un fichier qui
  // n'a rien du tout. Pas d'en-tête du tout → 0 ligne et un avertissement ;
  // un en-tête présent mais incomplet → l'erreur nommée, plus bas.
  if (!header.length) {
    warn('vide', 'Le fichier est vide : aucune ligne d\'en-tête n\'a été trouvée.');
    return { source, rows: [], warnings: [...seen.values()], skipped_no_name: 0, header: [] };
  }

  // Index clé normalisée → nom réel de la colonne.
  const index = new Map();
  for (const h of header) { const k = _hkey(h); if (!index.has(k)) index.set(k, h); }

  // Colonnes requises : vérifiées AVANT de lire la moindre ligne, pour que
  // l'échec soit immédiat et nommé plutôt que dilué en lignes rejetées.
  for (const f of spec.required) {
    const cands = spec.map[f] || [];
    if (!cands.some((k) => index.has(k))) throw new MissingColumnError(cands[0], source, header);
  }

  const out = [];
  let skippedNoName = 0;

  for (const r of rows) {
    const name = _pick(r, spec.map.device_name, index);
    if (!name) { skippedNoName++; continue; }

    const rec = { source, raw: r };
    for (const f of FIELDS) {
      const cands = spec.map[f] || [];
      if (!cands.length) { rec[f] = null; continue; }
      if (f === 'enabled') { rec[f] = _bool(_pick(r, cands, index)); continue; }
      if (f === 'last_seen' || f === 'created') { rec[f] = _date(_pick(r, cands, index), warn); continue; }
      rec[f] = _pick(r, cands, index);
    }
    rec.device_name = name;
    out.push(rec);
  }

  return { source, rows: out, warnings: [...seen.values()], skipped_no_name: skippedNoName, header };
}

const parseAdCsv = (text) => _parse(text, 'ad');
const parseEntraCsv = (text) => _parse(text, 'entra');
const parseDefenderCsv = (text) => _parse(text, 'defender');

module.exports = {
  parseCsv, parseAdCsv, parseEntraCsv, parseDefenderCsv,
  MissingColumnError, FIELDS, SPECS,
};
