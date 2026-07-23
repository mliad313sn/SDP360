'use strict';
/**
 * assetTypeClassifier — le type d'un équipement, par cascade à quatre sources
 * dans l'ordre de fiabilité MESURÉ sur le parc réel (spec §2) :
 *
 *   1. product_type quand il est SPÉCIFIQUE — SDP est autoritaire à 100 % sur
 *      le réseau (`Cisco Switch`, `Wireless Access Point`) et les VM. Il n'est
 *      inutile que sur son fourre-tout « Computer », qui écrase 2 000+ lignes.
 *   2. product (le modèle) — classe 78 % du parc à lui seul, sépare virtuel de
 *      physique, et survit à un nom d'hôte illisible (`5`, hexadécimal).
 *   3. le nom — dernier recours interne, et plus précis que l'OS quand il porte
 *      un jeton (`LT` dit portable là où l'OS ne dirait que « poste »).
 *   4. l'OS — la SEULE source disponible pour un écart AD/Entra, où ni product
 *      ni product_type n'existent.
 *
 * PUR. Tout résultat est normalisé vers TYPES : faire confiance à product_type
 * verbatim importerait l'incohérence de SDP (« Laptop » à Londres, « Computer »
 * ailleurs) et dédoublerait filtres et totaux.
 */

/** Vocabulaire canonique. Aucun libellé de SDP ne doit fuir tel quel. */
const TYPES = {
  LAPTOP:   'Portable',
  DESKTOP:  'Fixe',
  SERVER:   'Serveur',
  VM:       'Serveur virtuel',
  SWITCH:   'Switch',
  AP:       'Point d’accès',
  FIREWALL: 'Firewall',
  PRINTER:  'Imprimante',
  OTHER:    'Autre',
};

/** product_type de SDP → vocabulaire canonique. Absent d'ici = générique. */
const PT_MAP = [
  [/^cisco switch$|^switch$/i,                    TYPES.SWITCH],
  [/wireless access point|^access point$/i,       TYPES.AP],
  [/wireless controller/i,                        TYPES.AP],
  [/^virtual machine$|^virtual host$/i,           TYPES.VM],
  [/^firewall$/i,                                 TYPES.FIREWALL],
  [/^printer$/i,                                  TYPES.PRINTER],
  [/^laptop$|^notebook$/i,                        TYPES.LAPTOP],
  [/^desktop$|^workstation$/i,                    TYPES.DESKTOP],
  [/^server$/i,                                   TYPES.SERVER],
];

/** Les valeurs qui ne disent rien : on passe à la source suivante. */
const GENERIC_PT = /^(computer|unknown computer|)$/i;

/**
 * ORDRE SIGNIFICATIF, et c'est le piège du module.
 * « Precision Tower 3620 » doit heurter /tower/ AVANT que la règle
 * Precision-mobile ne le réclame comme portable. Déplacer une ligne d'ici
 * change silencieusement le type de dizaines de machines.
 */
const MODEL_MAP = [
  [/vmware|virtual platform|hyper-?v|parallels|^virtual machine$/i,                 TYPES.VM],
  [/proliant|poweredge|thinksystem|primergy|blade/i,                                TYPES.SERVER],
  [/meraki\s*mr|access point/i,                                                     TYPES.AP],
  [/meraki\s*ms|catalyst|switch/i,                                                  TYPES.SWITCH],
  [/fortigate|firewall|\bfgt\b/i,                                                   TYPES.FIREWALL],
  // AVANT la règle « fixe », qui contient `workstation` : sans cette ligne
  // « HP ZBook Fury Mobile Workstation PC » serait classé fixe alors que c'est
  // un portable. L'inverse de la même erreur que Precision Tower.
  [/mobile workstation|zbook/i,                                                     TYPES.LAPTOP],
  [/tower|microtower|\bmt\b|\btwr\b|desktop|prodesk|elitedesk|optiplex|\bsff\b|all-?in-?one|mini\s*pc|workstation|\bz\d{3}\b/i, TYPES.DESKTOP],
  [/latitude|probook|elitebook|zbook|notebook|\bxps\b|alienware|thinkpad|macbook|yoga|vostro|inspiron|surface\s*pro|mobile workstation|toughbook|\bfz\d/i, TYPES.LAPTOP],
  [/precision\s*7\d{3}|dell pro \d+/i,                                              TYPES.LAPTOP],
];

/** Jetons de nom. Volontairement plus étroit que TYPE_TOKENS du parser. */
const NAME_MAP = [
  [/[-_](SRV|SQL)(?![A-Z])|SRV[0-9]/i,                            TYPES.SERVER],
  [/[-_](LTOP|LPT|LTP|LAP|LT)(?![A-Z])|(LTOP|LPT|LTP|LAP|LT)[0-9]/i, TYPES.LAPTOP],
  [/[-_](DSK|DESK|WS)(?![A-Z])|(DSK|WS)[0-9]/i,                   TYPES.DESKTOP],
  [/[-_]SW(?![A-Z])/i,                                            TYPES.SWITCH],
  [/[-_]AP(?![A-Z])/i,                                            TYPES.AP],
];

/**
 * → { type, source } ; `type === null` signifie « inconnu », jamais « Autre ».
 * `source` vaut product_type | product | name | os | null.
 */
function classifyType(row) {
  const r = row || {};

  const pt = String(r.product_type || '').trim();
  if (pt && !GENERIC_PT.test(pt)) {
    for (const [re, t] of PT_MAP) if (re.test(pt)) return { type: t, source: 'product_type' };
    // product_type spécifique mais hors vocabulaire connu : on le reconnaît
    // comme du matériel identifié sans inventer une famille.
    return { type: TYPES.OTHER, source: 'product_type' };
  }

  const product = String(r.product || '').trim();
  if (product) {
    for (const [re, t] of MODEL_MAP) if (re.test(product)) return { type: t, source: 'product' };
  }

  const name = String(r.asset_name || r.device_name || '').trim();
  if (name) {
    for (const [re, t] of NAME_MAP) if (re.test(name)) return { type: t, source: 'name' };
  }

  // Seule source disponible pour un écart AD/Entra.
  const os = String(r.os || r.operatingSystem || '').trim();
  if (/windows server/i.test(os)) return { type: TYPES.SERVER, source: 'os' };
  if (/windows\s*(10|11)|macos|mac os|windows$/i.test(os)) return { type: TYPES.DESKTOP, source: 'os' };

  return { type: null, source: null };
}

module.exports = { classifyType, TYPES, PT_MAP, MODEL_MAP, NAME_MAP };
