/* A-09b — French for public/wan.html (unified WAN module: Santé & Qualité + SLA & Refacturation).
 * The page is already largely French (tab names, explanations, filters); this dictionary covers the
 * English headings, buttons and table headers. Chart axis titles are drawn on a canvas and stay English.
 * Site / ISP / circuit names are data and never keys. Inert unless ui_i18n_pages='1'.
 * (wan-health.html and wan-sla.html are 0-second redirects to wan.html#health / #sla and carry no UI.)
 */
(function (root) {
  'use strict';
  const STATIC = {
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
  };
  const RUNTIME_KEYS = {
    'no data for this site': 'pas de données pour ce site', '⏳ Syncing…': '⏳ Synchronisation…',
  };
  root.I18N_FR_WAN = Object.assign({}, STATIC, RUNTIME_KEYS);
  root.I18N_FR_WAN_RUNTIME = Object.keys(RUNTIME_KEYS);
})(typeof window !== 'undefined' ? window : globalThis);
