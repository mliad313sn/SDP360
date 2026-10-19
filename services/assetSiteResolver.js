'use strict';
/**
 * assetSiteResolver — à quel site rattacher une machine que SDP ne connaît pas.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI CE MODULE EXISTE : le nom seul ne suffit pas
 *
 * `assetNameParser` attribue un site par le nom, appris sur SDP. Confronté au
 * VRAI export AD, il rend « indéterminé » pour **453 des 545 écarts (83 %)** —
 * et la raison est mécanique : les machines absentes de SDP sont précisément
 * celles qui ne suivent pas sa convention de nommage. Une carte apprise sur SDP
 * ne peut pas reconnaître ce que SDP n'a jamais vu.
 *
 * L'OU d'Active Directory, elle, les couvre : `Exploration Sites` (186 écarts),
 * `Ouaga Office` (77), `Kalana` (54). D'où une cascade à quatre niveaux, du plus
 * fiable au moins fiable, chacun annoncé par `source`.
 *
 * Le deuxième niveau est celui qui change tout : quand rien n'a pu être appris,
 * on affiche **le libellé d'OU brut**. « Kalana » est infiniment plus actionnable
 * qu'« indéterminé » — un coordonnateur sait ce qu'est Kalana même si SDP
 * l'ignore. C'est d'ailleurs le vrai enseignement de la mesure : Exploration
 * Sites, Ouaga et Kalana totalisent ~317 machines actives, soit des sites
 * ENTIERS hors inventaire, pas quelques SelfScan ratés.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PUR : aucune base de données, aucune horloge.
 */

/**
 * OU qui ne désignent pas un site. Liste d'EXCLUSION et non liste blanche : un
 * nouveau site doit apparaître sans qu'on touche à la configuration, alors que
 * les OU techniques sont peu nombreuses et stables.
 *
 * `New Computers` est une OU de transit — mesurée à 29 % de pureté, elle
 * apprendrait le site du dernier poste qui y est passé.
 * `Domain Controllers` ne porte aucun site : un DC n'est sous aucune OU de site,
 * et la cascade retombe alors sur son nom (`ABJ-DC-001` → ABIDJAN).
 */
const TECHNICAL_OUS = [
  'New Computers', 'Domain Controllers', 'Computers', 'Servers',
  'Workstations', 'Laptops', 'Desktops', 'Disabled', 'Quarantine',
];

/** Seuils au-dessus desquels une OU apprise l'emporte sur son propre libellé. */
const OU_MIN_N = 5;
const OU_MIN_PURITY = 0.8;

function _isTechnical(ou) {
  const s = String(ou || '').trim().toLowerCase();
  return TECHNICAL_OUS.some((t) => t.toLowerCase() === s);
}

/**
 * L'OU la PLUS HAUTE sous le domaine — c'est elle qui porte le site.
 *   CN=X,OU=Servers,OU=Computers,OU=Abidjan Office,DC=… → « Abidjan Office »
 * Prendre la première donnerait « Servers » pour tout le monde.
 */
function topOu(dn) {
  const m = String(dn || '').match(/OU=([^,]+)/gi);
  if (!m || !m.length) return null;
  const ou = m[m.length - 1].slice(3).trim();
  return ou || null;
}

/**
 * Apprend OU → site sur l'INTERSECTION AD ∩ SDP : ces machines portent à la
 * fois l'OU et le site réel, donc l'intersection est un jeu étiqueté.
 *
 * adRows : [{ name, distinguishedName }] · sdpAssets : [{ asset_name, site }]
 * → Map(OU → { site, purity, n })
 */
function learnOuMap(adRows, sdpAssets) {
  const siteByKey = new Map();
  for (const a of sdpAssets || []) {
    const k = String((a && a.asset_name) || '').toUpperCase().split('.')[0].replace(/\$$/, '');
    const s = String((a && a.site) || '').trim();
    if (k && s && !siteByKey.has(k)) siteByKey.set(k, s);
  }
  const acc = new Map();
  for (const r of adRows || []) {
    const k = String((r && r.name) || '').toUpperCase().split('.')[0].replace(/\$$/, '');
    const site = siteByKey.get(k);
    if (!site) continue;
    const ou = topOu(r && r.distinguishedName);
    if (!ou || _isTechnical(ou)) continue;   // une OU de transit n'apprend rien de fiable
    if (!acc.has(ou)) acc.set(ou, new Map());
    const m = acc.get(ou);
    m.set(site, (m.get(site) || 0) + 1);
  }
  const out = new Map();
  for (const [ou, m] of acc) {
    let best = null, bn = 0, tot = 0;
    for (const [s, n] of m) { tot += n; if (n > bn) { best = s; bn = n; } }
    out.set(ou, { site: best, purity: bn / tot, n: tot });
  }
  return out;
}

/**
 * resolveSite({ name, ouDn }, { ouMap, prefixMap })
 * → { site, source, confidence, reason }
 *
 * `source` : ou_learned | ou_label | name | null — l'interface DOIT l'afficher.
 * Un site venant du libellé d'OU n'a pas la même valeur qu'un site appris, et
 * présenter les deux à l'identique serait mentir par omission.
 *
 * ⚠ Le site rendu reste un site PRÉSUMÉ : le site réel suit l'utilisateur, que
 * SDP ne connaît pas encore pour une machine absente de son inventaire.
 */
function resolveSite(device, maps) {
  const d = device || {};
  const m = maps || {};
  const ou = topOu(d.ouDn || d.ou_dn);

  if (ou && !_isTechnical(ou)) {
    const e = m.ouMap && typeof m.ouMap.get === 'function' ? m.ouMap.get(ou) : null;
    if (e && e.site && e.n >= OU_MIN_N && e.purity >= OU_MIN_PURITY) {
      return { site: e.site, source: 'ou_learned', confidence: e.purity, reason: 'ok' };
    }
    // Rien d'appris, ou trop peu sûr : le libellé lui-même reste juste.
    return { site: ou, source: 'ou_label', confidence: null, reason: 'ou_not_learned' };
  }

  if (m.prefixMap) {
    const { parseAssetName } = require('./assetNameParser');
    const p = parseAssetName(d.name || d.device_name, m.prefixMap);
    if (p.site) return { site: p.site, source: 'name', confidence: p.purity, reason: 'ok' };
    return { site: null, source: null, confidence: null, reason: p.reason };
  }
  return { site: null, source: null, confidence: null, reason: ou ? 'ou_technical' : 'no_signal' };
}

module.exports = { learnOuMap, topOu, resolveSite, TECHNICAL_OUS, OU_MIN_N, OU_MIN_PURITY };
