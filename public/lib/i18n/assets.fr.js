/* A-09b — French for public/assets.html (IT Assets: inventory, hygiene, finance & licences, hardware,
 * progress, investment, reconciliation). The Réconciliation tab and its guide are already authored in
 * French (skipped by tests/i18n-coverage.test.js with that reason). Static markup first, then RUNTIME_KEYS:
 * drill-modal column headers, empty states and messages built in JS. Chart legends and axis titles are
 * drawn on a canvas and stay English. Asset / site / software names are data, never keys.
 * Inert unless ui_i18n_pages='1'.
 */
(function (root) {
  'use strict';
  const STATIC = {
    'IT Assets': 'Parc informatique',
    'Hardware inventory, data-quality hygiene, and finance & licences across all sites': 'Inventaire matériel, qualité des données, finances et licences sur tous les sites',
    // tabs and shared filter bar
    'Inventory': 'Inventaire', 'Hygiene': 'Hygiène', 'Finance & Licences': 'Finances et licences', 'Hardware': 'Matériel', 'Investment': 'Investissement',
    'All sites': 'Tous les sites', 'State': 'État', 'Any': 'Tous', 'Product type': 'Type de produit', 'Manufacturer': 'Fabricant',
    'Search (name / serial)': 'Recherche (nom / n° de série)', 'Reset': 'Réinitialiser', 'Sync assets now': 'Synchroniser le parc maintenant',
    'Type to filter…': 'Tapez pour filtrer…', 'Re-sync all asset data from AssetExplorer now (admin)': 'Resynchroniser maintenant toutes les données du parc depuis AssetExplorer (admin)',
    // inventory
    'Hardware & configuration inventory across all sites': 'Inventaire matériel et configuration sur tous les sites', 'Export Excel': 'Exporter en Excel',
    'Download the current inventory (with the filters applied) as an Excel workbook (admin only)': 'Télécharger l’inventaire courant (filtres appliqués) en classeur Excel (admin seulement)',
    'Assets': 'Actifs', 'Asset name': 'Nom de l’actif', 'Product': 'Produit', 'RAM (GB)': 'RAM (Go)', 'C: free %': '% libre sur C:', 'Monitors': 'Écrans',
    'Acquisition': 'Acquisition', 'User': 'Utilisateur', 'Purchase (USD)': 'Achat (USD)', 'Book value (USD)': 'Valeur comptable (USD)', 'TCO (USD)': 'Coût total (USD)',
    'Serial': 'N° de série', 'Last scan': 'Dernier scan', 'No assets match these filters.': 'Aucun actif ne correspond à ces filtres.',
    'If this is unexpected, an asset sync may not have run yet.': 'Si c’est inattendu, la synchronisation du parc n’a peut-être pas encore tourné.',
    // hygiene
    'Inventory data-quality worklist — completeness & scan staleness across the fleet': 'Liste de travail qualité de l’inventaire — complétude et ancienneté des scans sur le parc',
    'Export all': 'Tout exporter', 'Download every hygiene worklist (one sheet per kind, current filters) as Excel': 'Télécharger toutes les listes d’hygiène (une feuille par type, filtres courants) en Excel',
    'Your role as site / office asset manager — asset management is control, not just an inventory': 'Votre rôle de responsable parc du site / bureau — gérer un parc, c’est contrôler, pas seulement inventorier',
    'Validate what the probe discovers': 'Validez ce que la sonde découvre', '— auto-discovery only detects a device; move it out of': '— la découverte automatique ne fait que détecter un appareil ; sortez-le de',
    'Discovered': 'Discovered', 'into In Store / In Use once you confirm the site, owner, cost and tag.': 'vers In Store / In Use une fois le site, le responsable, le coût et l’étiquette confirmés.',
    'Tag everything': 'Étiquetez tout', '— no asset should reach In Store or In Use without an asset tag and QR code (the bridge between the register and the field).':
      '— aucun actif ne doit passer en In Store ou In Use sans étiquette et QR code (le lien entre le registre et le terrain).',
    'Complete the record': 'Complétez la fiche', '— fill the owner (': '— renseignez le responsable (', 'user & department': 'utilisateur et département',
    '), acquisition date and purchase cost. A blank record is detected, not': '), la date d’acquisition et le coût d’achat. Une fiche vide est détectée, pas', 'managed': 'gérée',
    'Keep it audited': 'Gardez-le audité', '— run the quarterly audit and clear': '— faites l’audit trimestriel et traitez les appareils', 'Never scanned': 'Jamais scannés', 'and': 'et',
    'Ghost': 'Fantômes', '(healthy but stale > 90 days) devices; document the gaps and corrective actions.': '(sains mais sans scan depuis plus de 90 jours) ; documentez les écarts et les actions correctives.',
    'Every movement leaves proof': 'Chaque mouvement laisse une preuve',
    '— receive, deploy, repair, loan, dispose: record the evidence (vendor, user, fault, data-wipe certificate…) at each step.':
      '— réception, déploiement, réparation, prêt, mise au rebut : enregistrez la preuve (fournisseur, utilisateur, panne, certificat d’effacement…) à chaque étape.',
    'Golden rule — for every asset the register must answer:': 'Règle d’or — pour chaque actif, le registre doit répondre :',
    'what · where · who · what state · since when · what cost · with what proof': 'quoi · où · qui · quel état · depuis quand · quel coût · avec quelle preuve',
    '. This dashboard measures exactly that.': '. Ce tableau de bord mesure exactement cela.',
    'Fleet completeness': 'Complétude du parc', 'Assets in scope': 'Actifs dans le périmètre', 'Newly seen, never brought into inventory state': 'Vus récemment, jamais passés en état d’inventaire',
    'No successful audit on record': 'Aucun audit réussi enregistré', 'Was healthy, now stale > 90 days': 'Sain auparavant, sans scan depuis plus de 90 jours',
    'No owner': 'Sans responsable', 'No acquisition date': 'Sans date d’acquisition', 'No cost data': 'Sans coût', 'No QR code': 'Sans QR code',
    'In repair / expired / lost': 'En réparation / expiré / perdu', 'Completeness by site': 'Complétude par site', 'Scan freshness': 'Fraîcheur des scans',
    'State distribution': 'Répartition par état', 'Select a worklist above': 'Choisissez une liste ci-dessus', 'Export this list': 'Exporter cette liste',
    'Download this worklist (current filters) as Excel': 'Télécharger cette liste (filtres courants) en Excel',
    'Days since scan': 'Jours depuis le scan', 'Last audit status': 'Statut du dernier audit', 'Last scan source': 'Source du dernier scan',
    'Click a worklist tile to see the affected assets.': 'Cliquez sur une tuile pour voir les actifs concernés.',
    // finance & licences
    'Fleet value, depreciation & refresh (USD) and software licence compliance': 'Valeur du parc, amortissement et renouvellement (USD) et conformité des licences logicielles',
    'Fleet finance': 'Finances du parc', 'Fleet book value (USD)': 'Valeur comptable du parc (USD)', 'Purchase cost (USD)': 'Coût d’achat (USD)',
    'Total cost of ownership (USD)': 'Coût total de possession (USD)', 'USD (approx)': 'USD (approx.)', 'Book value by site (USD)': 'Valeur comptable par site (USD)',
    'Fleet net book value over time (USD)': 'Valeur nette comptable du parc dans le temps (USD)', 'Per-site finance (USD)': 'Finances par site (USD)',
    'Download the per-site finance summary (USD) as Excel': 'Télécharger la synthèse financière par site (USD) en Excel',
    'Book value (computed)': 'Valeur comptable (calculée)', 'Book value (SDP)': 'Valeur comptable (SDP)', '% depreciated': '% amorti', 'Refresh due': 'Renouvellement dû',
    'Computed by the dashboard from the configured depreciation method / useful-life / salvage (Admin ▸ Assets ▸ Depreciation).':
      'Calculée par le tableau de bord depuis la méthode d’amortissement, la durée de vie et la valeur résiduelle configurées (Admin ▸ Assets ▸ Depreciation).',
    'Current Book Value as reported by SDP AssetExplorer — shown for cross-check only.': 'Valeur comptable actuelle telle que remontée par SDP AssetExplorer — affichée pour contrôle seulement.',
    'No finance data for the current filter.': 'Aucune donnée financière pour ce filtre.', 'Software licences': 'Licences logicielles', 'Licences by family': 'Licences par famille',
    'Expiry status': 'Statut d’expiration', 'Expired': 'Expirées', 'Expiring ≤ 90d': 'Expirent ≤ 90 j', 'OK': 'OK', 'No expiry': 'Sans expiration',
    'Download every licence exception list (one sheet per kind) as Excel': 'Télécharger toutes les listes d’exceptions de licences (une feuille par type) en Excel',
    'Select an expiry status above': 'Choisissez un statut d’expiration ci-dessus', 'Download this licence list (current filters) as Excel': 'Télécharger cette liste de licences (filtres courants) en Excel',
    'Licence': 'Licence', 'Family': 'Famille', 'Vendor': 'Éditeur', 'Expiry': 'Expiration', 'Cost (USD)': 'Coût (USD)',
    'Click an expiry tile to see the affected licences.': 'Cliquez sur une tuile d’expiration pour voir les licences concernées.',
    'Software compliance': 'Conformité logicielle', 'Fleet-wide · site filter N/A': 'Tout le parc · filtre site non applicable',
    "The software catalogue has no site dimension — this section is fleet-wide. The shared Site filter does not apply here; only Manufacturer + Search do.":
      'Le catalogue logiciel n’a pas de dimension site — cette section couvre tout le parc. Le filtre Site ne s’applique pas ici ; seuls Fabricant et Recherche s’appliquent.',
    "Purchased vs installed — SDP's": 'Acheté vs installé — le verdict', 'Compliance Type': 'Compliance Type', 'verdict.': 'de SDP.',
    'Under-Licensed = audit / compliance risk': 'Sous-licencié = risque d’audit / de conformité',
    '(more installs than entitlements). Counts only — no cost is shown. This catalogue is': '(plus d’installations que de droits). Comptages seulement — aucun coût affiché. Ce catalogue couvre',
    'fleet-wide': 'tout le parc', '(no per-site dimension) — the Site filter does not apply; Manufacturer and Search do.': '(pas de dimension site) — le filtre Site ne s’applique pas ; Fabricant et Recherche oui.',
    'Download every software compliance list (one sheet per kind) as Excel': 'Télécharger toutes les listes de conformité logicielle (une feuille par type) en Excel',
    'Under Licensed · risk': 'Sous-licencié · risque', 'Over Licensed · waste': 'Sur-licencié · gaspillage', 'Compliant': 'Conforme', 'Managed titles': 'Titres gérés',
    'Titles with more installations than entitlements — audit / compliance risk': 'Titres avec plus d’installations que de droits — risque d’audit / de conformité',
    'Titles with more entitlements than installations — licence waste': 'Titres avec plus de droits que d’installations — licences gaspillées',
    'Metered titles that match their entitlements': 'Titres suivis conformes à leurs droits', 'The metered universe — managed titles of the total software catalogue': 'L’univers suivi — titres gérés du catalogue logiciel total',
    'Compliance — metered titles only': 'Conformité — titres suivis seulement', 'Excludes not-metered titles (they dwarf the metered universe).': 'Exclut les titres non suivis (ils écrasent l’univers suivi).',
    'Top manufacturers (by risk)': 'Principaux fabricants (par risque)', 'Managed': 'Gérés', 'Under': 'Sous', 'Over': 'Sur',
    'Select a compliance status above': 'Choisissez un statut de conformité ci-dessus', 'Download this software list (current filter) as Excel': 'Télécharger cette liste de logiciels (filtre courant) en Excel',
    'Installed': 'Installés', 'Allowed': 'Autorisés', 'Compliance': 'Conformité', 'Click a compliance tile to see the affected software titles.': 'Cliquez sur une tuile de conformité pour voir les logiciels concernés.',
    // hardware
    'Fleet hardware health — low RAM, full disks, refresh-due machines & missing monitors': 'Santé matérielle du parc — RAM faible, disques pleins, machines à renouveler et écrans manquants',
    'Download every hardware health list (one sheet per kind, current filters) as Excel': 'Télécharger toutes les listes de santé matérielle (une feuille par type, filtres courants) en Excel',
    'With a real monitor': 'Avec un vrai écran', 'Avg real monitors': 'Moyenne de vrais écrans', 'Low RAM': 'RAM faible', 'Under 8 GB installed memory': 'Moins de 8 Go de mémoire installée',
    'Full disk': 'Disque plein', 'C: drive under 10% free': 'Lecteur C: à moins de 10 % libre', 'Past its replacement cycle': 'Au-delà de son cycle de renouvellement',
    'No real monitor': 'Sans vrai écran', 'Workstation with no real display': 'Poste de travail sans vrai écran',
    'Monitor count denylists cameras / virtual devices (Intel AVStream Camera, Integrated Webcam, HyperVMonitor, Parallels Vu, No Monitor);':
      'Le comptage des écrans exclut caméras et appareils virtuels (Intel AVStream Camera, Integrated Webcam, HyperVMonitor, Parallels Vu, No Monitor) ;',
    '“No real monitor”': '« Sans vrai écran »', 'is scoped to workstation-type devices so headless servers aren’t flagged.': 'ne vise que les postes de travail, pour ne pas signaler les serveurs sans écran.',
    'Health issues by kind': 'Problèmes de santé par type', 'Health issues by site': 'Problèmes de santé par site', 'No monitor': 'Sans écran',
    'Select a health tile above': 'Choisissez une tuile de santé ci-dessus', 'Download this list (current filters) as Excel': 'Télécharger cette liste (filtres courants) en Excel',
    'Real monitors': 'Vrais écrans', 'Months since acq.': 'Mois depuis l’acq.', 'Click a health tile to see the affected machines.': 'Cliquez sur une tuile de santé pour voir les machines concernées.',
    // C-12 — hygiene completeness bullets + anomaly Pareto
    'Completeness by field and site': 'Complétude par champ et par site', 'Data-quality anomalies — Pareto': 'Anomalies de qualité des données — Pareto',
    'Bars: assets flagged per worklist (click a bar to open the same list as its tile). Line: cumulative share of flagged occurrences — one asset can sit in several worklists.':
      'Barres : actifs signalés par liste (cliquez une barre pour ouvrir la même liste que sa tuile). Courbe : part cumulée des signalements — un actif peut figurer dans plusieurs listes.',
    // progress
    'Per-site effort trend — data-quality progress over time': 'Tendance de l’effort par site — progrès de la qualité des données dans le temps',
    'Capture snapshot now': 'Capturer un instantané maintenant', 'Capture an effort snapshot for today (admin)': 'Capturer un instantané d’effort pour aujourd’hui (admin)',
    'Composite': 'Le score', 'effort score': 'd’effort composite', '= mean of six good-state rates (cost · age · owner · scan · tag · enrolled).': '= moyenne de six taux de bon état (coût · âge · responsable · scan · étiquette · inscription).',
    'Δ vs ~30 days ago': 'Δ vs il y a ~30 jours', '= effort made.': '= effort fourni.',
    'Effort trends build up as nightly snapshots accumulate — check back after a few days. Admins can capture a baseline now.':
      'Les tendances se construisent au fil des instantanés nocturnes — revenez dans quelques jours. Un admin peut capturer une ligne de base maintenant.',
    'Most improved': 'Plus forte progression', 'Needs attention': 'À surveiller', 'Effort leaderboard': 'Classement de l’effort', 'Rank': 'Rang',
    'Effort score': 'Score d’effort', 'Δ (vs ~30d)': 'Δ (vs ~30 j)', 'Effort score over time': 'Score d’effort dans le temps', 'Site detail': 'Détail du site',
    'Show all sites': 'Afficher tous les sites', 'Component': 'Composante', 'Good-state rate': 'Taux de bon état',
    'Latest-in-window good-state rate per component for this site (higher = cleaner register).': 'Dernier taux de bon état de la fenêtre par composante pour ce site (plus haut = registre plus propre).',
    'Effort is a per-site metric — only the': 'L’effort est un indicateur par site — seul le filtre', 'filter applies on this tab.': 's’applique sur cet onglet.',
    // investment
    'Investment — historical spend & forward forecast by equipment type': 'Investissement — dépenses passées et prévision par type d’équipement',
    'Download history + hardware + software forecast (current filters & horizon) as Excel': 'Télécharger l’historique et les prévisions matériel + logiciel (filtres et horizon courants) en Excel',
    'Horizon': 'Horizon', '3 years': '3 ans', '5 years': '5 ans', '10 years': '10 ans',
    'Not enough dated/costed records to forecast yet — fill acquisition date + cost on the Inventory / Hygiene tabs, then come back.':
      'Pas encore assez de fiches datées et chiffrées pour prévoir — renseignez date d’acquisition et coût depuis les onglets Inventaire / Hygiène, puis revenez.',
    'Hardware forecast coverage —': 'Couverture de la prévision matériel —', 'Software renewal coverage —': 'Couverture du renouvellement logiciel —',
    'Historical spend (USD)': 'Dépenses passées (USD)', 'Forward forecast — replacement & renewal (USD)': 'Prévision — remplacement et renouvellement (USD)',
    'Software honours': 'Le logiciel ne suit que', 'site / state / search': 'site / état / recherche', 'only — the licence table has no product type or manufacturer.': '— la table des licences n’a ni type de produit ni fabricant.',
    '= each asset replaced at its depreciation end-of-life, budgeted at original cost × uplift.': '= chaque actif remplacé en fin d’amortissement, budgété au coût d’origine × majoration.',
    'Software': 'Logiciel', '= licence renewals at expiry (no depreciation).': '= renouvellements de licences à échéance (sans amortissement).',
  };
  const RUNTIME_KEYS = {
    // drill modal / exception tables (column headers built from arrays)
    'Asset': 'Actif', 'Machines': 'Machines', 'Free %': '% libre', 'Age (mo)': 'Âge (mois)', 'Completeness %': 'Complétude %',
    'Hardware (USD)': 'Matériel (USD)', 'Software (USD)': 'Logiciel (USD)', 'Cumulative (USD)': 'Cumul (USD)', 'Net book value (USD)': 'Valeur nette comptable (USD)',
    'Hardware replacement (USD)': 'Remplacement matériel (USD)', 'Software renewal (USD)': 'Renouvellement logiciel (USD)',
    'Hardware-health worklist': 'Liste santé matérielle', 'Installed vs allowed — no cost shown': 'Installé vs autorisé — aucun coût affiché',
    'Cost is USD-native (per-licence, not summed)': 'Coût en USD natif (par licence, non additionné)',
    // empty / error states
    'No assets in this worklist for the current filters. 🎉': 'Aucun actif dans cette liste pour ces filtres. 🎉',
    'No machines in this list for the current filters. 🎉': 'Aucune machine dans cette liste pour ces filtres. 🎉',
    'No licences in this bucket for the current filter. 🎉': 'Aucune licence dans cette catégorie pour ce filtre. 🎉',
    'No titles in this bucket for the current filter. 🎉': 'Aucun titre dans cette catégorie pour ce filtre. 🎉',
    'Could not load this worklist.': 'Impossible de charger cette liste.', 'Could not load this list.': 'Impossible de charger cette liste.',
    'Could not load this licence list.': 'Impossible de charger cette liste de licences.', 'Could not load this software list.': 'Impossible de charger cette liste de logiciels.',
    'No / unparseable expiry': 'Expiration absente / illisible', 'No real monitor (workstation)': 'Sans vrai écran (poste de travail)', 'Expiring within 90 days': 'Expirent sous 90 jours',
  };
  root.I18N_FR_ASSETS = Object.assign({}, STATIC, RUNTIME_KEYS);
  root.I18N_FR_ASSETS_RUNTIME = Object.keys(RUNTIME_KEYS);
})(typeof window !== 'undefined' ? window : globalThis);
