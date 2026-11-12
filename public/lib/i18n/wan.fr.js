/* A-09b — French for public/wan.html (unified WAN module: Santé & Qualité + SLA & Refacturation).
 * The page is already largely French (tab names, explanations, filters); this dictionary covers the
 * English headings, buttons and table headers. Chart axis titles are drawn on a canvas and stay English.
 * Site / ISP / circuit names are data and never keys. Inert unless ui_i18n_pages='1'.
 * (wan-health.html and wan-sla.html are 0-second redirects to wan.html#health / #sla and carry no UI.)
 */
(function (root) {
  'use strict';
  const STATIC = {
    'Pending review': 'À revoir',
    'Not certified': 'Non certifié',
    '= no ISP contract reviewed by a second super_admin (or its MRC differs from the circuit) — the amount is an estimate, not a claim.': '= aucun contrat FAI revu par un second super_admin (ou sa redevance diffère du circuit) — le montant est une estimation, pas une réclamation.',
    '= outages never seen to recover (stale-closed) or with no attribution: they are excluded from the credit until someone reviews them.': '= coupures dont le rétablissement n’a jamais été vu (fermées par péremption) ou sans attribution : elles sont exclues du crédit tant que personne ne les a revues.',
    'WAN Health': 'Santé WAN', '⚡ Sync now': '⚡ Synchroniser', 'Sync now': 'Synchroniser',
    'Past Day': 'Dernier jour', 'Past Week': 'Dernière semaine', 'Past Month': 'Dernier mois',
    'No WAN snapshots yet. Set': 'Aucun instantané WAN pour l’instant. Renseignez',
    'in Admin → config and run the sync (nightly, or the': 'dans Admin → config et lancez la synchronisation (nocturne, ou le bouton',
    'button). Numbers become trustworthy once the calibration step is done.': '). Les chiffres deviennent fiables une fois l’étape de calibration faite.',
    'Trend': 'Tendance', 'SLA / Chargeback': 'SLA / Refacturation',
    'Contractual WAN SLA attainment, credit tiers & ISP chargeback — a management instrument on top of the WAN archive':
      'Respect du SLA WAN contractuel, paliers de crédit et refacturation FAI — un instrument de pilotage au-dessus de l’archive WAN',
    'Month': 'Mois', '⬇ Export CSV': '⬇ Exporter en CSV',
    'No SLA circuits configured yet — set them up in': 'Aucun circuit SLA configuré pour l’instant — configurez-les dans',
    'Circuits —': 'Circuits —', 'ISP': 'FAI', 'Circuit': 'Circuit', 'Site / Sub-site': 'Site / sous-site', 'Uplink': 'Lien',
    'Availability (contract)': 'Disponibilité (contrat)', 'Objective': 'Objectif', 'Credit tier': 'Palier de crédit', 'Credit due': 'Crédit dû',
    'Gap': 'Écart', 'Amount': 'Montant',
    "Availability is measured only within each circuit's service hours; the objective column is the detection-based upper bound.":
      'La disponibilité n’est mesurée que dans l’horaire de service de chaque circuit ; la colonne objectif est la borne haute fondée sur la détection.',
    'Unmapped circuits': 'Circuits non rattachés',
    '⚙ These outages could not be matched to a configured SLA circuit. Configure each in': '⚙ Ces coupures n’ont pu être rattachées à aucun circuit SLA configuré. Configurez chacun dans',
    'Outages': 'Coupures', 'Availability': 'Disponibilité', 'Evidence — outages this month': 'Preuves — coupures du mois',
    'Detected': 'Détectée', 'Restored': 'Rétablie', 'Notified': 'Notifiée', 'Reason': 'Motif', 'Duration': 'Durée',
    // C-13 (G21) — freshness strip, mapping coverage, outage timeline.
    'Mapping coverage': 'Couverture du rattachement',
    'Sites mapped = sites with a Meraki network (Admin → Infra WAN). Uplinks mapped = uplinks seen in the WAN archive or the outage log that resolve to an SLA circuit (Admin → SLA WAN).':
      'Sites rattachés = sites ayant un réseau Meraki (Admin → Infra WAN). Liens rattachés = liens vus dans l’archive WAN ou le journal des coupures qui correspondent à un circuit SLA (Admin → SLA WAN).',
    'Outage timeline —': 'Chronologie des coupures —', 'Site (both links / power)': 'Site (deux liens / électricité)',
    'Maintenance': 'Maintenance', 'Not attributed': 'Non attribuée', 'Still open': 'Toujours ouverte', 'Data freshness': 'Fraîcheur des données',
    // P8 (B1) — SLA credit claims tab + Teams SLA alerts readiness.
    'Réclamations': 'Réclamations', 'SLA credit claims': 'Réclamations de crédits SLA', 'From': 'De', 'due': 'dû', 'to': 'à',
    'recovered': 'récupéré',
    ": one claim per circuit × closed month. The due amount is the SLA engine's figure, frozen with an evidence hash; every status change carries a motive and is recorded in a tamper-evident trail.":
      ' : une réclamation par circuit × mois clos. Le montant dû est le chiffre du moteur SLA, figé avec une empreinte de preuve ; chaque changement de statut porte un motif et est consigné dans une piste infalsifiable.',
    'Quarter': 'Trimestre', 'Claimed': 'Réclamé', 'Credited': 'Crédité', 'Disputed': 'Contesté', 'Written off': 'Abandonné',
    'Quarter totals — due vs claimed vs recovered (per currency, never added together)':
      'Totaux du trimestre — dû, réclamé, récupéré (par devise, jamais additionnées)',
    'Currency': 'Devise', 'Recovered': 'Récupéré', 'Open claims': 'Réclamations ouvertes', 'Median age (days)': 'Âge médian (jours)',
    'Open a claim': 'Ouvrir une réclamation', 'Circuit (from the SLA tab)': 'Circuit (de l’onglet SLA)', 'Open claim': 'Ouvrir la réclamation',
    'Only a closed month with a credit due can be claimed; one claim per circuit and month.':
      'Seul un mois clos avec un crédit dû peut être réclamé ; une réclamation par circuit et par mois.',
    'Claims': 'Réclamations', 'Site / Uplink': 'Site / Lien', 'ISP · Circuit': 'FAI · Circuit', 'Days since due': 'Jours depuis l’échéance',
    'Days since claimed': 'Jours depuis la réclamation', 'Evidence': 'Preuves', 'Stale': 'Périmé',
    '= outages or contract terms changed after the amount was frozen — review before claiming. Amounts are shown to the admin tier and Finance only.':
      '= les coupures ou les termes du contrat ont changé après le gel du montant — à revoir avant de réclamer. Les montants ne sont visibles que du palier admin et de la Finance.',
    'Real-time Teams SLA alerts (SDP Cloud) — readiness': 'Alertes SLA Teams en temps réel (SDP Cloud) — état de préparation',
    'These alerts are switched on by a person, never from this page: OAuth client + refresh token for SDP Cloud, one Workflows webhook per Teams channel, then arm them in':
      'Ces alertes sont activées par une personne, jamais depuis cette page : client OAuth + jeton de rafraîchissement pour SDP Cloud, un webhook Workflows par canal Teams, puis armement dans',
    'Admin ▸ Intégration API ▸ Alertes SLA': 'Admin ▸ Intégration API ▸ Alertes SLA',
    '. Guide: docs/integration/2026-10-03-teams-sla-alerts-setup.md.': '. Guide : docs/integration/2026-10-03-teams-sla-alerts-setup.md.',
    'who chases the ISP': 'qui relance le FAI',
  };
  const RUNTIME_KEYS = {
    'no data for this site': 'pas de données pour ce site', '⏳ Syncing…': '⏳ Synchronisation…',
  };
  root.I18N_FR_WAN = Object.assign({}, STATIC, RUNTIME_KEYS);
  root.I18N_FR_WAN_RUNTIME = Object.keys(RUNTIME_KEYS);
})(typeof window !== 'undefined' ? window : globalThis);
