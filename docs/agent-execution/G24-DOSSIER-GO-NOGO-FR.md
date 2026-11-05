# SDP360 — dossier de décision GO / NO-GO (C-27, régénéré)

Date : **5 novembre 2026** · Base : commit **`b5e1309`** (tête d'intégration, branche de travail `goal/c-27`) ·
Rédigé par l'agent de développement (IA). Remplace la version du 29 octobre (commit `8d8a789`, 3 079 tests), devenue
périmée.

Ce dossier **recommande** ; il ne décide pas et ne porte **aucune signature**. Il se lit comme un **registre** : chaque
ligne est `réussi`, `échec`, `en attente` (attend une personne) ou `non exécuté` (pas joué ici), et renvoie à un fichier
de preuve du dépôt. Les colonnes « validé terrain », « déployé » et « accepté » restent **INCONNUES** : aucune personne
habilitée ne les a constatées. Les décisions du PO du 5 novembre (P1–P13, R1–R14,
`docs/decisions/2026-11-05-PO-DELEGATED-DECISIONS.md`) sont des **décisions déléguées et réversibles**, pas des
signatures ; elles fixent des valeurs de pilote, jamais les valeurs du code.

## 1. Verdict

| Décision | Recommandation | Pourquoi |
|---|---|---|
| **Pilote** sur l'instance de TEST d'Endeavour (1 à 2 sites, données réelles, utilisateurs nommés) | **GO sous conditions** | Le code est complet pour un pilote ; la suite complète et les parcours navigateur sont **presque** verts (section 4 : 1 test unitaire et 2 parcours navigateur rouges, listés, à corriger avant le pilote). Conditions préalables : (0) corriger ces 3 rouges (agent) ; puis, toutes humaines : (1) rotation du mot de passe superutilisateur PostgreSQL exposé dans l'historique git (SEC-01 F6) ; (2) installation + sauvegarde/restauration rejouées sur le serveur TEST, puis CAB ; (3) utilisateurs pilotes et approbateurs nommés ; (4) valeurs de pilote appliquées par un opérateur (`tools/reports/set-ui-policy.js` / carte Admin), interrupteur par interrupteur, sur TEST d'abord. |
| **Mise en production** | **NO-GO** | Aucune porte humaine de la section 6 n'est franchie : pas de recette avec de vrais utilisateurs (AMDEC AM-14, RPN 700), pas de session lecteur d'écran, pas d'exercice TEST, pas de CAB, secret historique non tourné, aucune signature de mise en production. |
| Diffusion hors d'Endeavour | **NO-GO** | Inchangé depuis le 29 octobre : licence « usage interne », redistribution EDB / Microsoft à revoir par le Juridique (`docs/sdp360/completion/RIGHTS-REGISTER.md`, inventaire des licences section 4.3). |

Rien dans ce dossier n'atteste qu'SDP360 est prêt pour la production, qu'une recette a eu lieu, ni qu'un site l'a
accepté (`.claude/rules/SDP360_BOUNDARIES.md`).

## 2. Registre par objectif

Légende statut : **CORRIGÉ** = le défaut ou le besoin est couvert par du code et un test ; **PARTIEL** = une partie
reste ouverte (raison dans `Limites`, section 7) ; **PORTE HUMAINE** = rien de plus ne peut être fait par le code.
« Tests » = résultat des fichiers cités dans l'exécution complète du 5 novembre (section 4). Trois `échec` existent
à cette date : `brand-buttons` (page C-31) et les parcours `u3`, `u4` (D-10) ; tout le reste est `réussi`. Terrain / déployé / accepté : **INCONNU** pour toutes les lignes.

### 2.1 Plan v3 (C-01 … C-31)

| Id | Objet | Statut | Interrupteur (défaut = aujourd'hui) | Preuve | Tests (5 nov.) |
|---|---|---|---|---|---|
| C-01 | Intégrité Analytics : ratios, null/inconnu, couleurs, échappement, course de filtres, erreurs | CORRIGÉ (G18 : persistance des filtres dans l'URL non construite → PARTIEL) | — (correctif, actif) | `C-01.md` | `analytics-logic` réussi |
| C-02 | Garde de périmètre des routes `/api/metrics/*` + matrice d'autorisation | CORRIGÉ | — (correctif) | `C-02.md` | `analytics-metrics-authz.smoke`, `authz-route-matrix` réussi |
| C-03 | Résolveur de rôles : ignorer titulaires/suppléants inactifs ou sans site | CORRIGÉ derrière interrupteur | `governance.skip_inactive_holders` (`false`) | `C-03.md` | `governance-roles`, `governance-roles.smoke` réussi |
| C-04 | Vérité des widgets (table, ragGrid, trackerRag, `series[]`, repli tableau) | CORRIGÉ | — | `C-04.md` | `dashboard-widget-truth`, `dashboards-routes.smoke` réussi |
| C-05 | Vérité du temps (fenêtre, cibles historiques, période partielle, « calculé à », réponse tardive) | CORRIGÉ (budget de performance non fixé) | — | `C-05.md` | `dashboard-time-truth`, `dashboards-routes.smoke` réussi |
| C-06 | Graphiques Analytics : panneaux empilés, états, palette, tableaux de données | CORRIGÉ | — | `C-06.md` | `analytics-charts`, `analytics-logic` réussi |
| C-07 | Graphiques accessibles partout, clavier PPM, mouvement réduit | CORRIGÉ ; preuve lecteur d'écran = PORTE HUMAINE | — | `C-07.md` | `chart-a11y`, `ppm-visuals` réussi |
| C-08 | Compositeur de tableaux de bord guidé | CORRIGÉ (aperçu : PARTIEL) | — | `C-08.md` | `composer-guide`, `dashboard-composer-page`, `dashboard-widgets` réussi |
| C-09 | Mesure d'usage `page_viewed`, matrice des pages direction, registre des interrupteurs, bandeau DEMO | PARTIEL (mesure et matrice faites ; décision garder/fusionner = humaine) | — (télémétrie interne toujours active) | `C-09.md`, `docs/ux/EXEC-PAGES-MATRIX.md`, `docs/ops/FLAG-REGISTER.md` | `page-usage`, `page-usage-routes.smoke`, `flag-register`, `it-review-tokens`, `dashboard-preview-demo` réussi |
| C-10 | En-tête de page commun (question, périmètre, fenêtre, fraîcheur) | CORRIGÉ sur 4 pages (G30 : PARTIEL côté écran) | — | `C-10.md` | `page-head` réussi |
| C-11 | Helpdesk : Pareto des catégories, classement par site, exploration | CORRIGÉ (clic navigateur non joué) | — | `C-11.md` | `helpdesk-pareto-ranking` réussi |
| C-12 | Actifs : tuile = liste détaillée, barres de complétude, Pareto des anomalies | CORRIGÉ | — | `C-12.md` | `assets-tile-drill-parity`, `asset-hygiene-visuals` réussi |
| C-13 | WAN : chronologie des coupures, fraîcheur par source, couverture | CORRIGÉ (contexte OpManager sur l'onglet WAN : hors périmètre) | — | `C-13.md` | `wan-timeline`, `wan-sla-routes.smoke` réussi |
| C-14 | PPM : matrice P×I, pression des ressources, clavier Gantt | CORRIGÉ | — | `C-14.md` | `ppm-visuals` réussi |
| C-15 | Gouvernance : décisions liées à leur séance, retards sur le cockpit | CORRIGÉ | — | `C-15.md` | `governance-links`, `governance-c15.smoke` réussi |
| C-16 | Parité des chiffres HTML/CSV/XLSX/PPTX(/PDF), « Autre (n) », tranche « Normal » | CORRIGÉ (PDF par construction ; extraction du monolithe : une étape) | `exec_deck_other_bucket` (`0`) | `C-16.md` | `report-figures-parity`, `exec-deck-payload` réussi |
| C-17 | Catalogue de capacités (ombre), service d'autorisation, « pourquoi refusé » | CORRIGÉ en mode ombre ; mode `enforce` non câblé | `authz_capability_mode` (`off`) | `C-17.md` | `capability-registry`, `authz-route-matrix`, `access-why.smoke` réussi |
| C-18 | Modèles d'accès, demandes, approbations, droits à échéance, fusion SSO, « Mes accès » | PARTIEL (assistant d'arrivée, campagne de recertification, recalcul au changement de site non construits) | `access_require_approval` (`0`), `access_grant_expiry_job` (`0`) | `C-18.md` | `access-store`, `access-request-lifecycle`, `access-routes.smoke`, `access-grant-expiry-job`, `sso-grant-merge` réussi |
| C-19 | Preuves de qualification + registre de séparation des tâches + règle d'approbateur R7 | PARTIEL (G43 : certains circuits gardent leur propre contrôle) | `qualification_check_enabled` (`0`), `qualification_requirements` (`{}`), `access_approver_policy` (règle R7) | `C-19.md` | `qualification-policy`, `qualification-routes.smoke`, `sod-policy`, `access-approver-policy` réussi |
| C-20 | Plannings de garde (saisie / CSV), moteur de couverture, page couverture | PARTIEL (A06/G48 partiels ; pas de connecteur RH, par décision R9) | — (page en lecture) | `C-20.md` | `duty-coverage`, `duty-routes.smoke` réussi |
| C-21 | Suppléants à périmètre, files de garde, passation de poste avec acceptation | PARTIEL (adresser une passation à une file exige une colonne non créée) | `governance.handoffs.queue_receivers` (`false`), `shift_handover_enabled` (`0`) | `C-21.md` | `scoped-deputies`, `shift-handover.smoke` réussi |
| C-22 | Accès d'urgence (24 h max, journalisé, revu par un autre super_admin) | CORRIGÉ derrière interrupteur | `emergency_access_enabled` (`0`), `emergency_access_max_hours` (`24`) | `C-22.md` | `emergency-access`, `emergency-access.smoke` réussi |
| C-23 | Parcours de bout en bout IAM et rotation de secret | CORRIGÉ (7 parcours `i1`…`i7`) | — | `C-23.md` | parcours e2e `i1`…`i7` réussi ; `e2e-harness` réussi |
| C-24 | Matrice de largeurs d'écran, course de filtres, exports de bout en bout | CORRIGÉ | — | `C-24.md` | parcours `v1`, `r1`, `x1` réussi |
| C-25 | Base de preuves : carte métrique→widget, empreintes, niveaux de preuve, carte persona→parcours | CORRIGÉ (carte persona : PARTIEL, 4 parcours non couverts) | — | `C-25.md`, `EVIDENCE-MANIFEST.md`, `docs/ops/PERSONA-JOURNEYS.md` | `evidence-baseline`, `flag-register` réussi |
| C-26 | Français sur les pages restantes du cadre + glossaire | CORRIGÉ (glossaire : PROPOSITION ; relecture francophone = humaine) | `ui_i18n_pages` (`0`) | `C-26.md`, `docs/ux/GLOSSARY-FR.md` | `i18n-coverage`, `i18n-shell-charts` réussi |
| C-27 | Ce dossier | voir `C-27.md` (G35 PARTIEL → CORRIGÉ côté code ; G34 PORTE HUMAINE) | — | `C-27.md` | `release-dossier` réussi |
| C-28 | Menu direction consolidé + accès au Deck Builder (P1, P12) | CORRIGÉ derrière interrupteurs | `ui_exec_nav` (`full`), `ui_deck_builder_roles` (`super_admin`) | `C-28.md` | `exec-nav-consolidated`, `deck-builder-gate`, `deck-builder-gate.smoke` réussi |
| C-29 | Polices hébergées sur place, aucune requête de police tierce (P5) | CORRIGÉ | — | `C-29.md` | `no-external-fonts`, `vendor-libs`, `e2e-harness` réussi |
| C-30 | Variantes de libellé de site regroupées ; même définition SLA tuile / classement / tendance (P7, P8) | CORRIGÉ | — (suit `helpdesk_sla_definition`, `flag`) | `C-30.md` | `site-fold-sla-definition`, `dashboard-shared-sla-rates` réussi |
| C-31 | Constructeur de politiques KPI pour le comité | CORRIGÉ (code) ; l'adoption d'une politique = comité | `kpi_policy_enforced` (`0`) | `C-31.md` | `kpi-policy-engine`, `kpi-policy-routes.smoke` réussi ; **`brand-buttons` échec** (`kpi-builder.html button.kb-primary` : texte blanc sur orange de marque, contraste) |

### 2.2 Contrôles transverses et suites AMDEC

| Id | Objet | Statut | Interrupteur (défaut) | Preuve | Tests (5 nov.) |
|---|---|---|---|---|---|
| SEC-01 | Passe de contrôle SDLC sécurisé (dépendances, secrets, routes, en-têtes, CI) | PARTIEL : F1–F5 corrigés ; **F6 (secret dans l'historique) et F7 (désactivation Entra) en attente d'une personne** | `auth_account_throttle_enabled` (`0`), `_max` (`10`), `_window_min` (`15`) | `SEC-01.md` | `login-next-redirect`, `route-matrix-probe-order`, `sec01-route-roles.smoke`, `login-account-throttle.smoke`, `field-ticket-site-scope`, `vendor-libs` réussi |
| AMDEC | Campagne de scénarios exécutée par un agent sur une organisation fictive (**pas une recette**) | 62 conçus · 36 exécutés par des tests neufs · 18 couverts par des suites existantes · **8 non exécutés** ; 4 défauts corrigés | — | `AMDEC.md`, `docs/audits/2026-11-05-amdec/` | `uat-amdec-org-models.smoke`, `uat-amdec-multinational-data`, `uat-amdec-workflows.smoke`, `assets-finance-readers` réussi ; parcours `u1`, `u2`, `u5` réussi, `u3`/`u4` échec (D-10) |
| D-01 | Refus d'écriture sous un code partagé par deux sites (Assafo/Tanda → `TND`) | CORRIGÉ derrière interrupteur (détection active ; choix du propriétaire = humain) | `site_code_shared_block` (`0`) | `D-0102.md` | `site-code-onboarding`, `uat-amdec-org-models.smoke` réussi |
| D-02 | Fiche d'ajout de site + plan de remplissage du registre (essai à blanc) | PARTIEL (appliquer le plan et activer le registre = super_admin) | — | `D-0102.md` | idem |
| D-03 | Une seule étiquette de semaine à l'écran | CORRIGÉ derrière interrupteur | `ui_week_labels` (`legacy`) | `D-030508.md` | `week-labels`, `uat-amdec-workflows.smoke` réussi |
| D-04 | Rôle inconnu refusé (création, modification, carte SSO) | CORRIGÉ | — (correctif) | `D-0406.md` | `uat-amdec-org-models.smoke`, `sso-provisioning` réussi |
| D-05 | Liste des rapports : filtres site/année/semaine + pagination | CORRIGÉ | — | `D-030508.md` | `uat-amdec-workflows.smoke` réussi |
| D-06 | La certification des montants compte les lignes exclues ; null jamais affiché 0 | CORRIGÉ | — (correctif) | `D-0406.md` | `money-coverage`, `assets-finance-readers` réussi |
| D-07 | Fuseau horaire par site (migration 066) | PARTIEL : derrière interrupteur, **lecteur mensuel du helpdesk seulement** | `site_local_calendar` (`0`) | `D-070910.md` | `site-time-zone`, `uat-amdec-multinational-data` réussi |
| D-08 | Balayage d'échappement de `reports.html` | CORRIGÉ | — (correctif) | `D-030508.md` | `reports-html-escape-sweep` réussi |
| D-09 | Fusion de l'accès d'urgence + scénario NE-01 | CORRIGÉ (joué ; reste désactivé) | `emergency_access_enabled` (`0`) | `D-070910.md` | `uat-amdec-workflows.smoke` réussi |
| D-10 | Parcours navigateur admin, direction « pire site », scorecard | CORRIGÉ (2 parcours super_admin + 2 parcours coordinateur restent non couverts) | — | `D-070910.md` | parcours `u5` réussi ; **`u3`, `u4` échec** (section 4) |

Massawa est désormais un **site à part entière** (il n'est plus replié dans Sabodala) : le périmètre de site le
distingue de Sabodala dans le même pays (AMDEC ORG-b), et sa fiche d'ajout liste les codes encore à enregistrer
(ORG-e1).

## 3. Interrupteurs ajoutés par ce programme

Tous livrés à la **valeur d'aujourd'hui**. La valeur de pilote est une **proposition** (ou une décision déléguée du
PO, réversible) ; elle n'est appliquée sur un serveur que par un opérateur, sur TEST d'abord. Source :
`docs/ops/pilot/PILOT-PROFILE.md` et `docs/ops/FLAG-REGISTER.md` (généré, vérifié par `tests/flag-register.test.js`).

| Interrupteur | Défaut | Valeur de pilote proposée | Qui décide de l'activer | Objectif |
|---|---|---|---|---|
| `governance.skip_inactive_holders` (politique de gouvernance) | `false` | `true` (PO R5) | Propriétaire (politique d'accès) | C-03 |
| `exec_deck_other_bucket` | `0` | `1` (PO P4) | Responsable du reporting | C-16 |
| `authz_capability_mode` | `off` | `shadow` (PO R6) ; `enforce` non câblé | Responsable sécurité | C-17 |
| `access_require_approval` | `0` | `1` une fois les approbateurs nommés | Responsable sécurité + Propriétaire | C-18 |
| `access_grant_expiry_job` | `0` | `1` | Responsable sécurité | C-18 |
| `access_approver_policy` | règle R7 encodée | la règle par défaut (R7) | Responsable sécurité + Propriétaire | C-19 |
| `qualification_check_enabled` | `0` | `0` tant que le responsable HSE de chaque site n'a pas saisi et fait vérifier les preuves | Responsable HSE + Responsable sécurité | C-19 |
| `qualification_requirements` | `{}` | `{}` (quelle capacité exige quelle qualification : décision humaine) | Responsable HSE | C-19 |
| `governance.handoffs.queue_receivers` (politique, par site) | `false` | `true` une fois le planning du site saisi | Responsable IT du site | C-21 |
| `shift_handover_enabled` | `0` | `1` sur le site pilote quand les équipes de poste sont au planning | Responsable IT du site + Propriétaire | C-21 |
| `shift_handover_flag_hours` | `8` | `8` | Responsable IT du site | C-21 |
| `emergency_access_enabled` | `0` | `1` une fois les super_admins habilités nommés | Responsable sécurité + Propriétaire | C-22 |
| `emergency_access_max_hours` | `24` | `24` (ne peut que baisser) | Responsable sécurité | C-22 |
| `ui_exec_nav` | `full` | `consolidated` (PO P1, à réexaminer après 30 jours de `page_viewed`) | Propriétaire (D-6) | C-28 |
| `ui_deck_builder_roles` | `super_admin` | `super_admin,report-author` (PO P12) | Propriétaire (D-6) | C-28 |
| `kpi_policy_enforced` | `0` | `0` tant que le comité KPI n'a pas adopté une politique (auteur ≠ adoptant) et lu la comparaison en ombre | Comité KPI + Propriétaire | C-31 |
| `auth_account_throttle_enabled` | `0` | `1` (attention : un compte nommé peut être bloqué volontairement pendant la fenêtre) | Responsable sécurité | SEC-01 |
| `auth_account_throttle_max` / `_window_min` | `10` / `15` | `10` / `15` | Responsable sécurité | SEC-01 |
| `site_code_shared_block` | `0` | `1` une fois chaque code partagé attribué à un seul site | Propriétaire des données + Propriétaire | D-01 |
| `ui_week_labels` | `legacy` | `explicit` (proposition) | Propriétaire (politique d'interface) | D-03 |
| `site_local_calendar` | `0` | `0` tant que tous les sites rapportés sont en UTC+0 | Propriétaire + Finance | D-07 |

Interrupteurs plus anciens que le pilote utilise aussi (`ui_i18n_pages`, `ui_nav_profile`, `meridian_enabled`,
`report_revert_policy`, `soft_delete_*`, `asset_money_certify_display`, `ppm_*`…) : voir `PILOT-PROFILE.md`.

## 4. Preuves de test (exécutées par l'agent le 5 novembre 2026, sur `b5e1309` + ce dossier)

| Contrôle | Commande | Résultat |
|---|---|---|
| Suite complète (PostgreSQL 16 local, bases jetables) | `npm test` avec `PG_ADMIN_URL` d'un rôle de test local | **584 fichiers · 4 134 tests · 4 122 réussis · 1 en échec (`brand-buttons`) · 11 ignorés avec raison (10 × « no prod-snapshot », 1 × python matplotlib/python-pptx absent)** — sur `b5e1309` avant les changements de cet objectif : 583 fichiers, 4 130 tests, 4 échecs (dont 3 `pg-reports-aggregates`, corrigés ici côté test) |
| Parcours navigateur (Playwright Chromium, trafic externe bloqué) | `node tools/test/run-e2e.js --runs=1` | **22 parcours : 20 réussis, 2 en échec (U3, U4), 0 ignoré ; 1 test navigateur unitaire réussi ; aucune requête externe** |
| Inventaire des licences | `node tools/release/licence-inventory.js --csv …` | sortie 0 ; 121 paquets de production (MIT 109, ISC 6, BSD-2 1, BSD-3 1, Apache-2.0 1, MIT-0 1, MIT AND Zlib 1, MIT OR GPL-3.0-or-later 1) ; identique à `docs/sdp360/completion/LICENCE-INVENTORY.csv` |
| SBOM | `node tools/release/sbom.js --out …` | sortie 0 ; CycloneDX 1.5, 132 composants (non versionné : fichier de sortie) |
| Empreintes des preuves | `node tools/agent/evidence-manifest.js --check` | à jour (`tests/evidence-baseline.test.js`) |

Détail des rouges (non corrigés dans cet objectif, qui ne touche pas au code produit) :

- `tests/brand-buttons.test.js` — « no CSS rule or inline style puts white text on brand orange » : `kpi-builder.html
  button.kb-primary` (page du constructeur de politiques KPI, C-31). Défaut de contraste, correction CSS à faire.
- Parcours **U3** (admin, helpdesk tous sites) : la tuile `#k-inbound` affiche `3` au lieu de `27` ; parcours **U4**
  (direction, pire site) : la ligne de classement lit `low sample | Hounde | 2 | 1 | 50%` au lieu de 6 tickets en
  retard. Les deux reposent sur le jeu de tickets fictif `tests/e2e/fixtures/tickets.js` (tickets répartis entre le
  début de la semaine Zoho courante et « maintenant ») ; reproduit deux fois le 5 novembre alors que le compte rendu
  D-070910 les donnait verts le même jour. Enquête (jeu de données ou fenêtre de semaine de la page) à ouvrir en suite
  de D-10.
- `tests/pg-reports-aggregates.test.js` (3 tests) était rouge sur `b5e1309` (`column "country" does not exist` : la
  base jetable du fichier n'était pas migrée alors que le lecteur D-07 lit `sites.country`). Corrigé ici, côté test
  seulement (le fichier lance désormais le migrateur, comme ses voisins) : 16/16.

Ce qui n'a **pas** été exécuté ici : CI GitHub et installeur Windows sur ce commit (pas de poussée depuis cet
espace) ; charge concurrente réelle ; connecteurs réels (SSO Entra, SMTP, Meraki, OpManager, Zoho) ; lecteur
d'écran ; tout essai sur un appareil ou un site réel.

### 4.1 Inventaire des licences — à revoir

- `PostgreSQL 17 (EDB)`, `IIS URL Rewrite`, `IIS ARR` : conditions de redistribution à revoir par le Juridique avant
  toute diffusion hors d'Endeavour.
- La ligne « Libre Franklin (Google Fonts) » de l'inventaire est **périmée** depuis C-29 : la police est désormais
  hébergée sous `public/vendor/fonts/libre-franklin/5.3.0/` (SIL OFL 1.1). Correction de la ligne `BUNDLED` de
  `tools/release/licence-inventory.js` à prévoir (non faite dans cet objectif).

## 5. Revue par discipline (préparation de G34 — tout est **en attente**)

| Discipline | À examiner | État |
|---|---|---|
| Produit / PO | décisions déléguées P1–P13, R1–R14 ; matrice des pages direction | en attente |
| UX / architecture de l'information | C-08, C-10, C-28 ; séances T1–T8 du protocole | en attente |
| BI / KPI | C-01, C-05, C-16, C-30, C-31 ; définitions D-01/02/03 | en attente |
| Visualisation de données | C-04, C-06, C-11, C-12, C-13, C-14 | en attente |
| Accessibilité | C-07, C-24 ; session lecteur d'écran | en attente |
| Sécurité / IAM | SEC-01, C-02, C-17 … C-23 ; F6, F7 | en attente |
| QA | section 4 ; AMDEC (8 scénarios non exécutés) | en attente |
| SRE / exploitation | exercice d'installation/restauration TEST, interrupteurs, rotation | en attente |
| ITIL / service desk | C-11, C-30, libellés CAB/risque inconnus (P9) | en attente |
| PMO / Finance | C-14, D-06, devises par site | en attente |
| IT de site / HSE | C-19, C-20, C-21, plannings, émetteurs de qualification | en attente |
| Métier / direction | recette pilote par pays et par modèle d'organisation | en attente |

## 6. Portes humaines (aucune n'est franchie ; l'IA ne peut en franchir aucune)

| # | Porte | Propriétaire (rôle) | Ce qui la débloque |
|---|---|---|---|
| 1 | **Rotation du mot de passe superutilisateur PostgreSQL** présent dans l'historique git (commits `214c0d1`, `92a6a68` — SEC-01 F6) et **décision sur la réécriture de l'historique** | Responsable sécurité + DBA | Rotation faite sur chaque cluster qui l'utilise ; décision écrite (réécrire ou non, par un opérateur autorisé) |
| 2 | Désactivation des comptes partis côté Entra (SEC-01 F7) : consentement à la permission Graph `User.Read.All` | Propriétaire du tenant Entra + Responsable sécurité | Consentement accordé ou refusé par écrit (si accordé : objectif de développement à ouvrir) |
| 3 | Branches GitHub périmées : `claude/sdp360-consolidation` (entièrement fusionnée) et `claude/confident-pascal-03veex` (ancienne lignée 1.11) | Propriétaire du dépôt | Suppression ou conservation décidée |
| 4 | 11 PR Dependabot ouvertes (évaluées dans SEC-01 : nodemailer, playwright, codeql sûres ; express 5, eslint 10, pptxgenjs 4 non sûres en l'état) | Propriétaire du dépôt + responsable QA | Fusion des PR sûres après CI ; objectifs de migration pour les autres |
| 5 | Exercice d'installation / sauvegarde / restauration sur l'instance TEST, puis **CAB** | Opérateur + CAB | Journal d'exécution TEST, procès-verbal de CAB |
| 6 | **Recette (UAT) avec de vrais utilisateurs pilotes**, par pays et par modèle d'organisation (G34, AM-14) | PO + responsables IT de site | Fiches de séance (`docs/ops/USABILITY-TEST-PROTOCOL.md`, T1–T8, SUS) |
| 7 | Session lecteur d'écran (NVDA / VoiceOver) | Référent accessibilité | Compte rendu de séance |
| 8 | Décision D-07 : activer `site_local_calendar` si un site hors UTC (ex. bureau de Londres) est rapporté, après confirmation de son fuseau | Propriétaire + Finance | Fuseau confirmé, décision écrite |
| 9 | Décision D-01 : attribuer le code tracker `TND` à Assafo **ou** Tanda, puis activer `site_code_shared_block` | Propriétaire des données | Code attribué ; interrupteur activé sur TEST |
| 10 | Activation du registre des codes de site (D-02, `PUT /api/governance/site-codes`) | Comité + super_admin | Plan de remplissage relu, appliqué |
| 11 | Composition du comité KPI (rôle `kpi-committee`), propriétaire des seuils, définitions D-01/02/03, adoption d'une politique (auteur ≠ adoptant) | Comité KPI | Membres nommés ; politique adoptée avec référence de séance |
| 12 | Devises et taux par site (`asset_site_currency`, `asset_currency_rates`) | Finance | Données fournies |
| 13 | Propriétaire de `TND` côté tracker (si distinct du point 9) et libellé source « **Fetekro Explorarion Office** » à corriger dans ServiceDesk Plus (AM-12) | Administrateur SDP | Libellé corrigé à la source |
| 14 | Activation du plafond d'échecs de connexion par compte (`auth_account_throttle_enabled`) | Responsable sécurité | Décision écrite |
| 15 | Approbateurs par rôle/site (R7), super_admins habilités à l'accès d'urgence, émetteurs HSE, données de planning et de qualification, couverture minimale par site | PO + responsables de site + HSE | Noms et données saisis |
| 16 | Garder / fusionner les pages direction (après 30 jours de `page_viewed`) ; Deck Builder vs Report Studio ; identité de l'IT Review ; périmètre de Site Awareness pour l'IT centrale (AM-11) | Propriétaire / PO | Décision écrite |
| 17 | Relecture des libellés français par un coordinateur francophone (P13) | Coordinateur francophone nommé | Relecture faite en semaine 1 |
| 18 | Application des valeurs de pilote sur TEST, puis **déploiement en production** et sa **signature GO/NO-GO** | Opérateur ; sponsor / CAB | Valeurs appliquées et journalisées ; signature |

## 7. Limites connues

- **D-07** ne couvre que le lecteur mensuel calendaire du helpdesk (`getCalendarMonthlyHelpdesk`). Restent en UTC : le
  Top-10 mensuel, la fenêtre hebdomadaire du rapport de site, l'historique sur 6 mois, la page Helpdesk (calcul côté
  navigateur), le SLA WAN ; aucun champ d'administration pour `sites.time_zone` (SQL seulement).
- **Assafo et Tanda** écrivent toujours dans le même tracker `TND` tant que la porte 9 n'est pas franchie.
- **C-17** : le catalogue tourne en ombre ; aucune route n'est encore protégée par `can()` (mode `enforce` non câblé).
- **C-18** : pas d'assistant d'arrivée, pas de campagne de recertification, pas de recalcul au changement de site.
- **C-21** : une passation ne peut pas encore être adressée à une file de garde (colonne manquante) ; file fixée à
  `site-it-support`.
- **C-20** : pas de connecteur RH (décision R9) ; sans planning, la couverture est « inconnue », jamais verte.
- **C-16** : la parité PDF est établie par construction (même HTML), pas par un test de chiffres sur le PDF.
- **C-13** : le contexte OpManager n'apparaît pas sur l'onglet WAN.
- **C-01 / G18** : les filtres d'Analytics ne sont pas persistés dans l'URL.
- **C-25 / D-10** : parcours navigateur non couverts — saisie du tracker et PV signé par un coordinateur, réglage de
  livraison / changement de rôle et lecture du journal de sécurité par un super_admin.
- **AMDEC** : 8 scénarios non exécutés (SSO réel, e-mail réel, données Meraki/OpManager réelles, parité PPTX/PDF dans la
  campagne, charge concurrente, lecteur d'écran, compréhension par les utilisateurs) ; l'IT centrale (palier admin)
  n'a pas accès à Site Awareness (AM-11, à confirmer).
- **SEC-01** : PBKDF2 à 100 000 itérations (sous la recommandation OWASP 2023, accepté pour l'instant) ; une partie des
  routes en lecture reste ouverte au lecteur simple par conception (classification des données à décider).
- Bénéfices métier : **non mesurés** ; le gabarit `TCO-TEMPLATE.csv` liste ce que le pilote doit mesurer.

## 8. Prochaines étapes proposées

1. Porte 1 (rotation), préalable à tout pilote.
2. Porte 5 (TEST + CAB), puis application des valeurs de pilote sur TEST, interrupteur par interrupteur.
3. Pilote de 4 semaines sur 1 à 2 sites : protocole d'utilisabilité, mesures TCO, journal des anomalies ; lecture
   hebdomadaire du journal `authz` en ombre (R6).
4. Décisions D-01, D-07, comité KPI et devises pendant le pilote ; nouveau dossier GO/NO-GO en fin de pilote.

---

## English summary

**Verdict (5 Nov 2026, head `b5e1309`): GO for a pilot on the Endeavour TEST instance under conditions; NO-GO for
production; NO-GO for distribution outside Endeavour.** The three red tests above must be fixed before the pilot (agent work); every other
condition is human. This dossier recommends; it carries no signature. Field
validation, deployment and business acceptance stay **UNKNOWN** for every goal. The PO decisions of 5 Nov (P1–P13,
R1–R14) are delegated and reversible, not signatures.

- **Ledger**: C-01…C-31, SEC-01, the AMDEC campaign and D-01…D-10 are listed in section 2 with status, default switch,
  evidence file and test proof. Every cited test file passed in today's full run except three, listed in section 4:
  `brand-buttons` (white text on brand orange on `kpi-builder.html`, C-31) and the browser journeys U3 and U4 (D-10
  fixture); `pg-reports-aggregates` was red on `b5e1309` (unmigrated test database) and is fixed test-side here. Partial items: C-09, C-18, C-19,
  C-20, C-21, SEC-01 (F6/F7), D-02, D-07; human-only: G34 (UAT), screen-reader evidence.
- **Tests (run by the agent today)**: full suite 584 files, 4 134 tests, 4 122 pass, 1 fail (`brand-buttons`), 11 skipped with a reason; browser journeys 22 journeys, 20 pass, 2 fail (U3, U4), 0 skipped; 1 browser unit test pass; no external request; licence inventory and
  SBOM regenerated (exit 0, 121 production packages, 132 SBOM components). Not run: GitHub CI and Windows installer on
  this commit, real connectors, real load, screen reader, any real site or device.
- **Switches**: 21 switches added by this programme, all defaulting to today's behaviour (section 3); pilot values are
  proposals applied only by an operator on TEST first.
- **Human gates** (section 6): rotate the PostgreSQL superuser password exposed in git history (commits `214c0d1`,
  `92a6a68`) and decide on a history rewrite; Graph `User.Read.All` consent for Entra deprovisioning; two stale
  branches and 11 open Dependabot PRs; TEST install/restore drill + CAB; UAT with pilot users; screen-reader session;
  D-07 and D-01 switch decisions; KPI committee membership; per-site currencies; `TND` owner; the SDP label
  "Fetekro Explorarion Office"; account throttle activation; approvers, emergency super_admins, HSE issuers, rosters;
  production deployment and its go/no-go signature.
- **Known limits** (section 7): D-07 covers only the calendar-month helpdesk reader; capability catalogue in shadow
  only; Assafo/Tanda still share `TND`; four browser journeys uncovered; the licence inventory still lists the Libre
  Franklin font as Google Fonts although it is self-hosted since C-29.
