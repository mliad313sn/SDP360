# Dossier de conception — Étape 08 — Cockpit de réunion, registre des décisions, portefeuille, demandes d'amélioration

Version 1 · 2026-10-19 · Auteur : agent IA · Relecteur : comité (à réceptionner) · Statut : **implémenté (volet agent) — volet humain (modèles d'ordre du jour par réunion, nomination des présidents/secrétaires, migration réelle du Roadmap Manager, première séance pilote) en attente**

## 1. Objectif et périmètre
Donner aux réunions de gouvernance (hebdo de site, mensuelle de site, mensuelle groupe, comité, CAB) un **cockpit** : un ordre du jour généré depuis les chiffres déjà calculés (dictionnaire des KPI, registre des actions, incidents majeurs, trackers, portefeuille), une séance en direct minutée et horodatée, des **décisions référencées** (`DEC-AAAA-NNN`) et des actions rattachées à leur source, un compte rendu produit à la clôture (HTML, PDF, e-mail). Tenir un **portefeuille** programmes → objectifs → projets → jalons → livrables → risques dont la preuve d'avancement est lue dans le dictionnaire, et un **registre des demandes d'amélioration** (`RFI-AAAA-NNN`) scoré par le comité. Aucune formule dans les routes ni les pages : `agendaBuilder`, `minutesRenderer`, `portfolioEvidence` sont purs et testés seuls.

**Hors périmètre agent** : le contenu métier des modèles d'ordre du jour (sections et KPI par type de réunion — défauts livrés), la désignation des présidents et secrétaires dans chaque cadence, l'exécution de la migration du Roadmap Manager en production, la première séance pilote et son retour d'expérience, le retrait de `itsm-roadmap.html`.

## 2. Existant touché
- **Nouveau** : `services/governanceStore.js` (+ `db/postgres/reports/018_governance.sql` appliquée par le migrateur ; `rfi_requests` était déjà créée par `016`), `services/agendaBuilder.js`, `services/minutesRenderer.js`, `services/portfolioEvidence.js`, `routes/governance.js`, `public/cockpit.html`, `public/portfolio.html`, `public/rfi.html`, aide §25 EN/FR, tests `governance-store`, `governance-pure`, `governance-routes.smoke`, `pg-governance-store`.
- **Modifié** : `reports-db.js` (rôle de fonction `committee-member`), `public/reports.html` (carte du rôle), `services/dashboardSeeds.js` (tableau de bord `governance`), `public/_shell.js` (Operations ▸ Cockpit / Portfolio / RFI, icônes `calendar`, `lightbulb`), `server.js` (montage, `initAtBoot`, 3 pages en cache — budget 8 260 respecté : 8 260, une ligne de commentaire retirée pour compenser), `tests/a11y-static.test.js` (3 pages), `tests/pg-dashboard-store.test.js` (le seed `governance` apparaît dans la liste publiée).
- **Inchangé, volontairement** : `routes/roadmap.js` et `public/itsm-roadmap.html` (outil personnel du manager) restent en place jusqu'à la migration réelle ; `services/roadmapEvidence.js` reste la preuve de l'ancien outil, `portfolioEvidence` le généralise sans le remplacer.

## 3. Modèle de données
`meeting_cadences` (clé, nom, type, site ou flotte, jour/heure/durée, participants JSON, président, secrétaire, modèle d'ordre du jour JSON, actif) · `meeting_sessions` (cadence, date prévue, statut planned/live/closed/cancelled, ordre du jour JSON figé à la préparation, items JSON `{id, started_at, ended_at, notes}`, présents, notes, `minutes_html` figé à la clôture, `minutes_sent_at`) · `decisions` (réf `DEC-AAAA-NNN` par année, séance, titre, texte, propriétaire, échéance, statut open/in_progress/done/cancelled, source, site) · `session_actions` (séance, titre, propriétaire, échéance, statut, source `kind/ref`, décision) · `rfi_requests` (réf `RFI-AAAA-NNN`, type, titre, problème, proposition, site, demandeur, impact/effort/risque 1..3, statut, décision, `decided_at`) · `portfolio_programmes` / `_objectives` (poids, cible, métrique de preuve + cible + sens, avancement manuel, preuve manuelle) / `_projects` (dates, référence de fin, budget, dépendances JSON) / `_milestones` / `_deliverables` (lien vers une action externe) / `_risks` (probabilité, impact, référence d'incident). Suppression en cascade. Journal `system_log` catégorie `governance` : `cadence_saved`, `session_prepared`, `session_started`, `decision_recorded`, `session_action_added`, `session_closed`, `minutes_sent`, `decision_updated`, `rfi_submitted`, `rfi_triaged`, `portfolio_saved`, `portfolio_removed`, `roadmap_migrated`.

## 4. API
Voir l'en-tête de `routes/governance.js`. Comité = palier admin ou `committee-member`. Conduite d'une séance = comité, président, secrétaire ou éditeur du site de la cadence (`services/userSites.hasSite`, jamais `user.site_id ===`). Décision = président, secrétaire ou admin. Lecture = toute session, bornée aux cadences/décisions de ses sites (les cadences de flotte sont visibles de tous). Migration du Roadmap Manager = super_admin, simulation par défaut (`?apply=1` pour écrire, 409 si déjà migré).

## 5. Écrans
- **Cockpit** : tuiles (cadences, séances tenues 30 j, planifiées, décisions ouvertes / en retard, RFI à trier), tableau des cadences (préparer, modifier), séances, décisions ouvertes (statut modifiable par le comité), formulaire de cadence (comité). **Séance en direct** plein écran : horloge, démarrer, points avec Start/Done/notes, décisions (DEC-), actions, présents et notes, clôturer → compte rendu HTML / PDF / e-mail.
- **Portefeuille** : tuiles, arbre programmes → objectifs (statut, confiance, preuve et sa source, glissement, projets), calendrier (début, fin, référence, glissement, jalons, alertes), risques (exposition, sévérité), formulaire d'édition (comité) par type d'élément, rapport mensuel, migration (super_admin).
- **RFI** : formulaire de soumission (tous), filtre par statut, registre trié par score ; le comité modifie impact/effort/risque, statut et décision en ligne.
- Maquettes designer : **à produire** (arbitrage 1) ; les trois pages passent le socle d'accessibilité (`a11y-static`) et l'interdiction des gestionnaires en ligne (CSP).

## 6. Règles métier
- Ordre du jour : sections par type de réunion (`DEFAULT_TEMPLATES`, surchargeables par `agenda_template` de la cadence), KPI par type (`KPI_SETS`, surchargeables par `agenda_template.kpis`), temps réparti à parts égales (minimum 5 min). Pour une cadence de flotte, une métrique de site est moyennée sur les sites actifs et nommée « (fleet mean) ».
- Un chiffre non mesuré est `null` et s'affiche « — » ; `summary.overdue_actions` est `null` sans registre d'actions (jamais 0).
- Horodatages des points = horloge du **serveur** ; un point inconnu de l'ordre du jour est ajouté, jamais ignoré ; une séance clôturée ne redémarre pas.
- Références séquentielles par année et par registre (`DEC-2026-001`, `RFI-2026-001`), calculées au moment de l'insertion.
- Score RFI = impact × 3 − effort − risque données (chaque note bornée 1..3 → −3..7), tri décroissant ; une note hors bornes est ramenée dans l'intervalle.
- Preuve d'objectif : métrique du dictionnaire ÷ cible, plafonnée 0..100 (sens inversé pris en charge : plus bas = mieux) ; sinon avancement manuel ; sinon moyenne des projets ; sinon `null` avec la source `none`. Le roll-up par programme **exclut** les objectifs non mesurés de la moyenne pondérée au lieu de les compter 0.
- Glissement = fin − référence de fin (≥ 0) ; retard = fin passée sans statut terminal ; dépendance = projet amont non terminé dont la fin dépasse le début ; exposition de risque = probabilité × impact, sévérité haute ≥ 6, moyenne ≥ 3.
- Les actions de séance et les décisions restent ouvertes dans leurs registres après la clôture de la séance ; la séance ne les ferme jamais seule.

## 7. Tests
`governance-store` (5 : validation et mise à jour partielle des cadences avec portée de site, séances et horodatages, références DEC + actions, RFI score/tri/bornes, portefeuille obligatoires/arbre/mise à jour/cascade), `governance-pure` (4 : sections et budget de l'ordre du jour, compte rendu échappé, preuve et repli, Gantt/risques/roll-up), `governance-routes.smoke` (4 : gardes 401/403/400, agenda généré, séance en direct avec président vs éditeur, clôture → compte rendu, RFI et portefeuille, rapport, migration super_admin), `pg-governance-store` (1, parité PostgreSQL migration 018), `a11y-static` + `csp-no-inline-handlers-new-pages` (3 pages), `authz-route-matrix`, `server-size-budget`.

## 8. Migration (Roadmap Manager → portefeuille)
1. **Simulation** (`POST /api/governance/roadmap-migration`, bouton *dry run* de la page Portefeuille) : programme `itsm-roadmap`, un objectif par objectif du Roadmap Manager (poids, avancement, statut, confiance, date cible, preuve manuelle), métrique de preuve proposée (`catalogue` → `helpdesk.closure_pct`, `platform` → `assets.completeness_pct`, `incidents` → `helpdesk.resolution_sla_pct`, `knowledge` → aucune), un projet « livrables » par objectif portant ses livrables.
2. **Application** (`?apply=1`) après lecture du plan ; refusée (409) si le programme existe déjà — supprimer le programme pour rejouer.
3. **Marche en parallèle** : le Roadmap Manager reste consultable ; le manager compare un mois puis le comité décide du retrait de `itsm-roadmap.html` (arbitrage 4).

## 9. Sécurité
Toutes les routes derrière la session et dans la matrice d'autorisation ; portée de site par `services/userSites` ; le compte rendu est du HTML **échappé** (texte libre des utilisateurs) ; l'e-mail part uniquement aux participants déclarés dans la cadence (adresses avec `@`) via `services/mailer` (configuration SMTP existante, mot de passe jamais exposé) ; les corps JSON sont bornés (1 Mo) et chaque champ texte tronqué ; aucune donnée personnelle au-delà des noms de propriétaires déjà saisis par les utilisateurs.

## 10. Exploitation
`SELECT action, count(*) FROM system_log WHERE category='governance' GROUP BY 1` répond à « combien de séances tenues avec compte rendu » (`session_closed`) et « combien de décisions référencées » (`decision_recorded`). Le PDF dépend de `services/reportRender` (503 explicite si indisponible, le HTML reste servi). Aucune tâche planifiée ajoutée.

## 11. Risques
- Ordre du jour vide pour un site sans code réunions/inspections (Exploration, Tanda) : les sections s'affichent avec « — » ; documenté, pas corrigé ici.
- La génération résout jusqu'à 7 KPI × sites actifs pour une cadence de flotte : acceptable à la demande, pas en cron.
- Les décisions ne sont pas encore liées aux actions du hub Site Actions (lien manuel par `source_ref`) : candidat pour l'étape 9 (moteur d'engagement).

## 12. Points d'arbitrage (défauts appliqués, à confirmer)
1. **Types de réunion et modèles d'ordre du jour** : 6 types livrés avec leurs sections et jeux de KPI par défaut, surchargeables par cadence — **appliqué**.
2. **Règles de rattachement des actions** : une action de séance porte `source_kind` + `source_ref` libres (décision, ticket, incident) ; pas d'écriture dans `md_actions` / `insp_actions` (les registres sources restent maîtres) — **appliqué**.
3. **Modèle du portefeuille** : programmes → objectifs → projets → jalons → livrables, risques au niveau projet, preuve d'objectif par métrique du dictionnaire — **appliqué**.
4. **Migration du Roadmap Manager** : simulation puis application par un super_admin ; retrait de l'ancienne page après un mois de double lecture (comité).
5. **Créateurs de décisions** : président, secrétaire ou admin ; les éditeurs du site conduisent la séance sans décider — **appliqué**.
