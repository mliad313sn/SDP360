'use strict';
/**
 * reconcileView — assemble le rapport de réconciliation à partir des pièces
 * pures : la comparaison (`reconcileAssets`), la résolution de site
 * (`assetSiteResolver`) et la classification de type (`assetTypeClassifier`).
 *
 * PUR. On lui passe deux tableaux ; il ne lit ni base ni fichier. C'est ce qui
 * permet de le faire tourner contre l'export réel avant qu'une seule route
 * n'existe — et c'est comme ça que trois défauts ont été trouvés (attribution
 * du site à 83 % d'échec, switches candidats au retrait, dates ambiguës).
 *
 * Le même assemblage écrit dans un handler de route ne serait vérifiable que
 * par un smoke test HTTP, c'est-à-dire pas vérifiable contre les vraies
 * données.
 */

const { reconcile } = require('./reconcileAssets');
const { learnPrefixMap } = require('./assetNameParser');
const { learnOuMap, resolveSite, topOu } = require('./assetSiteResolver');
const { classifyType, TYPES } = require('./assetTypeClassifier');

/**
 * Le matériel qui ne rejoint JAMAIS un domaine. Absent d'AD par nature, donc
 * « jamais vu », donc candidat au retrait à tort et pour toujours. Mesuré sur
 * le parc réel : 214 des 965 candidats bruts, soit 22 % de faux positifs
 * permanents qui auraient discrédité la liste dès le premier envoi.
 */
const NOT_DOMAIN_JOINABLE = new Set([TYPES.SWITCH, TYPES.AP, TYPES.FIREWALL, TYPES.PRINTER]);

/**
 * Le CONTENEUR DIRECT de la machine — c'est à lui qu'on rattache une GPO.
 * `topOu` rend l'OU de tête (le site) ; ici on veut la feuille.
 */
function _parentDn(dn) {
  const s = String(dn || '');
  const i = s.indexOf(',');
  return i < 0 ? null : s.slice(i + 1);
}

function _num(v, dflt) { return Number.isFinite(+v) ? +v : dflt; }

// ── Tri des VRAIS retraits contre les artefacts de fiche SDP ─────────────────
// « Absent d'AD » ne veut pas dire « machine partie ». SDP identifie une machine
// par son SERVICE TAG en priorité (doc ManageEngine : Service Tag → Nom → MAC),
// donc un renommage ou une réinstallation crée une fiche « _old » ou un doublon
// de tag — pas un retrait. Et un actif « In Store » / « Disposed » est
// délibérément hors réseau. On écarte ces cas de la liste de retrait et on les
// range dans une liste « à vérifier » (ils NE disparaissent PAS — un chiffre qui
// baisse sans explication se lit comme une perte de données).

const { normaliseKey } = require('./reconcileAssets');

function _serialKey(a) { return String((a && a.serial_number) || '').trim().toUpperCase(); }

/** Un tag partagé par une AUTRE fiche = la machine vit ailleurs (renommage). */
function _isRenamed(a, serialCount) {
  if (/_old$/i.test(String((a && a.asset_name) || ''))) return true;   // marqueur SDP lui-même
  const s = _serialKey(a);
  return !!s && (serialCount.get(s) || 0) > 1;
}

/** État hors « In Use » = délibérément hors réseau (In Store, Disposed, …). */
function _isOffNetwork(a) {
  const st = String((a && a.state) || '').trim().toLowerCase();
  return st !== '' && st !== 'in use';
}

/**
 * Jamais scanné avec succès — présence jamais confirmée par SelfScan.
 * Miroir du prédicat hygiène `_NEVER_SCANNED_WHERE`. Ne décide QUE si le champ
 * existe : sur des fixtures sans métadonnée, on ne sur-écarte pas.
 */
function _isNeverScanned(a) {
  if (!a) return false;
  const hasFields = ('last_successful_audit_time' in a) || ('last_audit_status' in a);
  if (!hasFields) return false;
  const t = a.last_successful_audit_time;
  const s = a.last_audit_status;
  const noTime = t == null || String(t).trim() === '';
  const noSuccess = s == null || !/success/i.test(String(s));
  return noTime || noSuccess;
}

/**
 * Motif d'écartement d'un candidat au retrait, ou null (= vrai candidat).
 * Ordre = explication la plus forte d'abord : un renommage/doublon prime sur
 * l'état, qui prime sur l'absence de scan.
 */
function _retirementReason(asset, serialCount) {
  if (_isRenamed(asset, serialCount)) return 'renamed';
  if (_isOffNetwork(asset)) return 'off_network';
  if (_isNeverScanned(asset)) return 'never_scanned';
  return null;
}

/**
 * Clé de regroupement d'un site — casse et accents neutralisés.
 *
 * NÉCESSAIRE, pas cosmétique : `resolveSite` rend le site SDP sur le chemin
 * `ou_learned` (« KALANA ») et le libellé d'OU brut sur `ou_label`
 * (« Kalana »). Groupés tels quels, le même site apparaît DEUX FOIS et un
 * coordinateur lit deux problèmes là où il n'y en a qu'un. Le libellé affiché
 * reste le premier rencontré — on ne force pas une casse que SDP n'utilise pas
 * (« Sabodala », « HOUNDE » cohabitent dans ses propres données).
 */
function _siteKey(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
}

/**
 * buildReconcileView({ sdpAssets, externalDevices, decisions, asOf, recentDays, staleDays })
 *
 * `asOf` est INJECTÉ jusqu'au bout. Une horloge interne re-daterait le rapport
 * à chaque ouverture : deux lectures du même import donneraient deux résultats.
 */
function buildReconcileView(opts) {
  const o = opts || {};
  const sdpAssets = Array.isArray(o.sdpAssets) ? o.sdpAssets : [];
  const externalDevices = Array.isArray(o.externalDevices) ? o.externalDevices : [];
  const decisions = Array.isArray(o.decisions) ? o.decisions : [];
  const asOf = o.asOf || null;
  const recentDays = _num(o.recentDays, 30);
  const staleDays = _num(o.staleDays, 90);

  const base = reconcile({
    sdpAssets, externalDevices, asOf, recentDays, staleDays,
    retirementEligible: (a) => !NOT_DOMAIN_JOINABLE.has(classifyType(a).type),
  });

  // Les deux cartes s'apprennent du parc SDP lui-même — aucun dictionnaire
  // écrit à la main ne resterait juste après une réorganisation d'annuaire.
  const prefixMap = learnPrefixMap(sdpAssets);
  const ouMap = learnOuMap(
    externalDevices.map((d) => ({ name: d.device_name, distinguishedName: d.ou_dn })),
    sdpAssets,
  );

  const byKey = new Map();
  for (const d of decisions) {
    const k = String((d && d.device_key) || '').toUpperCase();
    if (k) byKey.set(k, d);
  }

  const gaps = base.gaps.map((g) => {
    const s = resolveSite({ name: g.device_name, ouDn: g.ou_dn }, { ouMap, prefixMap });
    // `model` côté Defender/Entra joue le rôle de `product` côté SDP : c'est la
    // chaîne commerciale que MODEL_MAP sait lire.
    const t = classifyType({ product: g.model, device_name: g.device_name, os: g.os });
    const d = byKey.get(g.device_key) || null;
    return Object.assign({}, g, {
      site: s.site,
      site_source: s.source,
      site_confidence: s.confidence,
      type: t.type,
      type_source: t.source,
      ou: topOu(g.ou_dn),
      container_dn: _parentDn(g.ou_dn),
      decision: d ? d.decision : null,
      reason: d ? (d.reason || null) : null,
      decided_by: d ? (d.decided_by || null) : null,
    });
  });

  // Une machine tranchée sort du compteur À TRAITER mais RESTE dans la liste :
  // la faire disparaître empêcherait de revenir sur la décision, et deux
  // rapports successifs deviendraient inexplicablement différents.
  const open = gaps.filter((g) => !g.decision);

  // Groupement par site. Le seau des indéterminés (site null) est conservé —
  // le masquer transformerait « je ne sais pas » en « rien à signaler ».
  const siteAcc = new Map();
  for (const g of open) {
    const k = g.site ? _siteKey(g.site) : '';        // '' = indéterminé
    if (!siteAcc.has(k)) siteAcc.set(k, { site: g.site || null, n: 0, sources: new Set() });
    const e = siteAcc.get(k);
    e.n++;
    if (g.site_source) e.sources.add(g.site_source);
  }
  const by_site = [...siteAcc.values()]
    .map((e) => ({ site: e.site, n: e.n, site_sources: [...e.sources].sort() }))
    .sort((a, b) => b.n - a.n || String(a.site).localeCompare(String(b.site)));

  // Groupement par OU. C'est l'unité d'ACTION : une GPO se rattache à une OU,
  // pas à un site — et un site couvre plusieurs OU (« Exploration Sites »
  // porte Tanda, Ity et Hounde dans trois conteneurs distincts).
  //
  // Le total AD du conteneur accompagne le nombre d'écarts : 2 sur 2 et 2 sur
  // 400 n'appellent pas la même action. Sur le parc réel c'est ce rapport qui
  // a montré que HGO (2 % non couvert) est le témoin prouvant que les 45-100 %
  // ailleurs sont un défaut de déploiement, pas une mesure douteuse.
  const totalByDn = new Map();
  for (const d of externalDevices) {
    const p = _parentDn(d.ou_dn);
    if (p) totalByDn.set(p, (totalByDn.get(p) || 0) + 1);
  }
  const ouAcc = new Map();
  for (const g of open) {
    // Entra et Defender ne portent pas d'OU : les verser dans un seau
    // « (aucune) » ferait croire à un conteneur à rattacher qui n'existe pas.
    if (!g.container_dn) continue;
    if (!ouAcc.has(g.container_dn)) ouAcc.set(g.container_dn, { ou_dn: g.container_dn, gaps: 0, site: g.site, sample: g.device_name });
    ouAcc.get(g.container_dn).gaps++;
  }
  const by_ou = [...ouAcc.values()]
    .map((e) => Object.assign(e, { total: totalByDn.get(e.ou_dn) || 0 }))
    .sort((a, b) => b.gaps - a.gaps || String(a.ou_dn).localeCompare(String(b.ou_dn)));

  const by_type = {};
  for (const g of open) { const k = g.type || 'inconnu'; by_type[k] = (by_type[k] || 0) + 1; }

  // ── Tri des candidats au retrait ───────────────────────────────────────────
  // Carte SERVICE TAG → nombre de fiches, sur tout le parc SDP : un tag partagé
  // trahit un renommage (la machine vit sous une autre fiche).
  const serialCount = new Map();
  for (const a of sdpAssets) { const s = _serialKey(a); if (s) serialCount.set(s, (serialCount.get(s) || 0) + 1); }
  // Retrouver la fiche SDP complète derrière chaque candidat (elle porte état,
  // service tag et statut de scan ; le candidat, lui, n'a que l'identité).
  const sdpByKey = new Map();
  for (const a of sdpAssets) { const k = normaliseKey(a && a.asset_name); if (k && !sdpByKey.has(k)) sdpByKey.set(k, a); }

  const retire = [];
  const review = [];
  const exCounts = { renamed: 0, off_network: 0, never_scanned: 0 };
  for (const c of base.retirementCandidates) {
    const asset = sdpByKey.get(c.device_key) || null;
    const reason = _retirementReason(asset, serialCount);
    if (!reason) { retire.push(c); continue; }
    exCounts[reason]++;
    // Écarté du compteur À RETIRER, mais CONSERVÉ dans « à vérifier » : la fiche
    // reste actionnable (un renommage se corrige, il ne se retire pas).
    review.push(Object.assign({}, c, {
      reason,
      state: asset ? (asset.state || null) : null,
      serial_number: asset ? (asset.serial_number || null) : null,
    }));
  }

  return {
    gaps,
    by_site,
    by_ou,
    by_type,
    // Ne contient plus que les VRAIS candidats : In Use, scannés, tag unique.
    retirement_candidates: retire,
    // Les écartés, avec leur motif — rien ne disparaît en silence.
    retirement_review: review,
    excluded: base.excluded,
    counts: Object.assign({}, base.counts, {
      gaps_open: open.length,
      gaps_decided: gaps.length - open.length,
      // Les indéterminés ne comptent pas comme un site : « 3 sites touchés »
      // doit vouloir dire trois sites nommés.
      sites_touched: by_site.filter((r) => r.site).length,
      ous_touched: by_ou.length,
      // Le compteur reflète maintenant la liste triée.
      retirement_candidates: retire.length,
      retirement_excluded_renamed: exCounts.renamed,
      retirement_excluded_off_network: exCounts.off_network,
      retirement_excluded_never_scanned: exCounts.never_scanned,
    }),
    window: base.window,
  };
}

module.exports = { buildReconcileView, NOT_DOMAIN_JOINABLE };
