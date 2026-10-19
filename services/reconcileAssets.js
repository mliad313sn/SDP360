'use strict';
/**
 * reconcileAssets — compare l'inventaire SDP à ce que voient Active Directory
 * et Entra ID, et produit les deux listes qui en découlent :
 *
 *   • les ÉCARTS — machines vues récemment ailleurs, absentes de SDP. C'est
 *     l'angle mort de SelfScan : un inventaire ne peut pas signaler ce qu'il
 *     ignore.
 *   • les CANDIDATS AU RETRAIT — actifs SDP que plus personne n'a vus depuis
 *     `staleDays`. Pendant du `ghost` existant, mais avec une preuve externe au
 *     lieu d'une absence de scan : un `ghost` peut être une machine qui tourne
 *     sans agent, celui-ci est probablement une machine qui n'existe plus.
 *
 * PUR — ne connaît ni CSV, ni Microsoft Graph, ni base de données. Il opère sur
 * deux listes en mémoire, ce qui est précisément ce qui permettra de brancher
 * Graph plus tard sans y toucher.
 */

/**
 * La jointure. C'est la fonction que rien en aval ne rattrape si elle est fausse.
 *
 * Trois formes de la même machine circulent :
 *   SDP    EDVSABLT409112
 *   AD     edvsablt409112.edv-ops.com  (dNSHostName)  et  EDVSABLT409112$
 *   Entra  EDVSABLT409112
 * Comparées brutes, elles font trois machines distinctes.
 *
 * Rend `null` — jamais la chaîne vide — quand il ne reste rien d'exploitable :
 * une chaîne vide se comparerait avec succès à une autre chaîne vide et
 * fusionnerait des machines sans rapport.
 */
function normaliseKey(name) {
  let s = String(name == null ? '' : name).trim().toUpperCase();
  if (!s) return null;
  const dot = s.indexOf('.');
  if (dot >= 0) s = s.slice(0, dot);          // FQDN → hôte
  if (s.endsWith('$')) s = s.slice(0, -1);    // compte machine AD
  s = s.trim();
  return s.length ? s : null;
}

/** Date comparable, ou null. Une date illisible vaut une date absente. */
function _ts(v) {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/**
 * `asOf` compte comme la FIN de sa journée.
 *
 * Load-bearing : `'2026-07-23'` se lit minuit. Une machine vue le même jour à
 * 8 h serait donc à −1 jour, c'est-à-dire « dans le futur », et la règle qui
 * exclut les observations postérieures à `asOf` l'écarterait — les machines du
 * jour même, exactement celles qui comptent le plus.
 */
function _endOfDay(asOf) {
  const t = _ts(asOf);
  if (t == null) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(asOf).trim()) ? t + 86400000 - 1 : t;
}

/** Jours écoulés entre `iso` et `asOf`, ou null si l'un des deux manque. */
function _daysBetween(iso, asOf) {
  const a = _ts(iso);
  const b = _endOfDay(asOf);
  if (a == null || b == null) return null;
  return Math.floor((b - a) / 86400000);
}

/**
 * Une ligne par (source, clé) : la plus récemment vue.
 *
 * Indispensable, pas cosmétique. Une machine réenregistrée apparaît plusieurs
 * fois dans Entra sous le même displayName — 21 413 lignes n'égalent pas
 * 21 413 machines, et sans dédup le compteur d'écarts gonfle sans qu'une seule
 * machine supplémentaire n'existe.
 *
 * Une ligne sans date perd toujours contre une ligne datée : c'est la seule
 * dont on sait quelque chose.
 */
function dedupeBySource(rows) {
  const best = new Map();
  for (const r of rows || []) {
    const key = normaliseKey(r && r.device_name);
    if (!key) continue;
    const source = String((r && r.source) || '').trim() || 'inconnu';
    const id = source + '|' + key;
    const cur = best.get(id);
    if (!cur) { best.set(id, { ...r, device_key: key, source }); continue; }
    const a = _ts(r.last_seen);
    const b = _ts(cur.last_seen);
    if (a != null && (b == null || a > b)) best.set(id, { ...r, device_key: key, source });
  }
  return [...best.values()];
}

/**
 * reconcile({ sdpAssets, externalDevices, asOf, recentDays, staleDays })
 *
 * `asOf` est INJECTÉ. Une horloge interne re-daterait le rapport à chaque
 * ouverture — deux lectures du même import donneraient deux résultats — et
 * rendrait la fenêtre de fraîcheur intestable.
 *
 * → { gaps, retirementCandidates, excluded, counts }
 */
function reconcile(opts) {
  const o = opts || {};
  const asOf = o.asOf || null;
  const recentDays = Number.isFinite(+o.recentDays) ? +o.recentDays : 30;
  const staleDays = Number.isFinite(+o.staleDays) ? +o.staleDays : 90;
  const sdpAssets = Array.isArray(o.sdpAssets) ? o.sdpAssets : [];
  const externalRaw = Array.isArray(o.externalDevices) ? o.externalDevices : [];

  // Index SDP par clé NORMALISÉE — des deux côtés, sinon un actif enregistré en
  // FQDN ne reconnaîtrait pas la forme courte d'AD et serait compté comme un
  // écart alors qu'il est inventorié.
  const sdpByKey = new Map();
  for (const a of sdpAssets) {
    const k = normaliseKey(a && a.asset_name);
    if (k && !sdpByKey.has(k)) sdpByKey.set(k, a);
  }

  const external = dedupeBySource(externalRaw);

  // Les trois clés sont TOUJOURS présentes, même à zéro : un objet dont les
  // clés apparaissent et disparaissent casse l'affichage qui les lit.
  const excluded = { disabled: 0, stale: 0, no_date: 0, future: 0 };

  // Une machine peut être vue par plusieurs sources : on regroupe par clé.
  const byKey = new Map();
  for (const d of external) {
    const k = d.device_key;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(d);
  }

  const gaps = [];
  const seenRecently = new Set();   // clés vues récemment, toutes sources, pour le sens inverse
  const seenAtAll = new Map();      // clé → date de vue la plus récente (compte activé uniquement)

  for (const [key, rows] of byKey) {
    // Un compte désactivé n'est pas une preuve de présence — ni pour un écart,
    // ni pour écarter un candidat au retrait.
    const live = rows.filter((r) => r.enabled !== false && r.enabled !== 0);
    if (!live.length) { excluded.disabled++; continue; }

    const dated = live.filter((r) => _ts(r.last_seen) != null);
    if (!dated.length) { excluded.no_date++; continue; }

    let newest = dated[0];
    for (const r of dated) if (_ts(r.last_seen) > _ts(newest.last_seen)) newest = r;
    seenAtAll.set(key, newest.last_seen);

    const age = _daysBetween(newest.last_seen, asOf);
    // Une observation POSTÉRIEURE à `asOf` n'existait pas à `asOf`. Sans cette
    // règle, un rapport rejoué sur une date passée compte comme « écart
    // courant » des machines apparues depuis — un anachronisme muet.
    if (age != null && age < 0) { excluded.future++; continue; }
    if (age == null || age > recentDays) { excluded.stale++; continue; }
    seenRecently.add(key);

    if (sdpByKey.has(key)) continue;   // connue de SDP : pas un écart

    gaps.push({
      device_key: key,
      device_name: newest.device_name,
      dns_name: newest.dns_name || null,
      os: newest.os || null,
      os_version: newest.os_version || null,
      join_type: newest.join_type || null,
      ou_dn: newest.ou_dn || null,
      model: newest.model || null,
      last_seen: newest.last_seen,
      age_days: age,
      sources: [...new Set(live.map((r) => r.source))],
    });
  }

  // Sens inverse : dans SDP, plus vue nulle part depuis staleDays.
  //
  // ⚠ FILTRE OBLIGATOIRE. Un switch, une borne Wi-Fi ou un pare-feu ne rejoint
  // JAMAIS un domaine : il est absent d'AD par nature, donc « jamais vu », donc
  // candidat au retrait — à tort, et pour toujours. Mesuré sur le parc réel :
  // 194 des 965 candidats bruts étaient du matériel réseau, soit 20 % de faux
  // positifs permanents qui auraient discrédité la liste dès le premier envoi.
  //
  // Le prédicat est INJECTÉ pour que ce module reste pur et ignore la
  // classification. Par défaut tout est éligible, ce qui préserve le
  // comportement des appelants qui ne le fournissent pas.
  // ⚠ GATE D'APPLICABILITÉ. « Vu nulle part » ne veut rien dire quand on n'a
  // regardé nulle part. Sans une seule source importée, CHAQUE actif SDP
  // remplit la condition « jamais vu » et le rapport annonce un parc entier à
  // retirer — un verdict confiant sur zéro donnée, exactement la faute que ce
  // dépôt documente ailleurs (`overall_risk:'low'` fabriqué, dimensions
  // inversées qui font passer l'absence de mesure pour l'excellence).
  //
  // null = pas mesuré ≠ 0 = mesuré à zéro.
  //
  // Le seuil est « au moins une OBSERVATION DATÉE », pas « au moins une ligne
  // ingérée ». La nuance est celle qui compte en vrai : un opérateur qui dépose
  // le mauvais fichier — l'export Entra dans la case AD, un CSV sans colonne de
  // dernière connexion — écrit bien des lignes, et un garde sur « des lignes
  // existent » se laisserait convaincre. Sans une seule date, on ne sait
  // toujours RIEN de la présence de quoi que ce soit.
  //
  // Volontairement INDÉPENDANT de `enabled` et de la fraîcheur. Un compte
  // désactivé mais daté est une observation réelle — la machine existe, son
  // compte est fermé, ce qui va VERS le retrait. Une source entièrement périmée
  // aussi : on a regardé, les machines sont anciennes.
  const sourcesPresent = [...new Set(external.map((d) => d.source))];
  const datedObservations = external.filter((d) => _ts(d.last_seen) != null).length;
  const retirementApplicable = datedObservations > 0;

  const eligible = typeof o.retirementEligible === 'function' ? o.retirementEligible : () => true;
  const retirementCandidates = [];
  let excludedNotJoinable = 0;
  for (const a of retirementApplicable ? sdpAssets : []) {
    const k = normaliseKey(a && a.asset_name);
    if (!k) continue;
    if (!eligible(a)) { excludedNotJoinable++; continue; }
    const last = seenAtAll.get(k) || null;
    const age = last ? _daysBetween(last, asOf) : null;
    if (age != null && age <= staleDays) continue;   // vue assez récemment
    retirementCandidates.push({
      device_key: k,
      asset_name: a.asset_name,
      site: a.site || null,
      last_seen_external: last,
      age_days: age,
    });
  }

  // Les plus en retard d'abord — cet ordre EST la liste de travail.
  gaps.sort((x, y) => (x.age_days || 0) - (y.age_days || 0) || String(x.device_name).localeCompare(String(y.device_name)));
  retirementCandidates.sort((x, y) => (y.age_days || 1e9) - (x.age_days || 1e9));

  return {
    gaps,
    retirementCandidates,
    excluded,
    counts: {
      sdp_total: sdpByKey.size,
      external_total: byKey.size,
      external_kept: seenRecently.size,
      gaps: gaps.length,
      retirement_candidates: retirementCandidates.length,
      // Affiché, pas seulement soustrait : un chiffre qui baisse sans explication
      // se lit comme une perte de données.
      retirement_excluded_not_joinable: excludedNotJoinable,
      // `false` = on n'a rien mesuré. L'interface DOIT dire « non applicable »
      // et non « 0 candidat », qui se lirait « parc entièrement sain ».
      retirement_applicable: retirementApplicable,
      // « Vu nulle part » n'a de sens qu'accompagné de « où a-t-on regardé ».
      sources_present: sourcesPresent,
    },
    window: { as_of: asOf, recent_days: recentDays, stale_days: staleDays },
  };
}

module.exports = { normaliseKey, dedupeBySource, reconcile };
