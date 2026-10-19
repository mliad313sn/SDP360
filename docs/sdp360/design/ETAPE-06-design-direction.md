# Dossier de conception — Étape 06 — Design system, espace direction, composeur de tableaux de bord

Version 1 · 2026-10-19 · Auteur : agent IA · Relecteur : comité + designer (à réceptionner) · Statut : **implémenté (volet agent) — volet humain (parcours et maquettes designer, tests d'utilisabilité, audit AA outillé) en attente**

## 1. Objectif et périmètre
Donner aux membres du comité le moyen de **composer et publier un tableau de bord sans développeur**, à partir du seul dictionnaire des KPI (étape 3), avec un rendu partagé (même grille, mêmes cartes, mêmes couleurs RAG) ; livrer l'**espace direction** comme première page remplacée par une définition ; étendre le design system (cartes de widgets, densités, mobile, plancher d'accessibilité). **Hors périmètre agent** : les parcours utilisateurs et maquettes (designer), les tests d'utilisabilité avec les membres du comité (SUS), l'audit AA outillé (axe) dans un navigateur — préparés ici (script de test, plancher statique en CI), exécutés par des humains.

## 2. Existant touché
- **Nouveau** : `services/dashboardStore.js` (brouillon → version publiée → retrait, sqlite + PostgreSQL via `016_dashboard_definitions.sql`), `services/dashboardSeeds.js` (4 définitions livrées : `exec-home`, `site-weekly`, `assets-hygiene`, `field-site`), `routes/dashboards.js` (liste, catalogue, définition, **données en un appel**, journal de vue, écriture éditeur), `public/lib/dashboardRender.js` (UMD pur : grille, formats, séries de fenêtres, plan de résolution), `public/dashboards.html` (liste + visionneuse), `public/dashboard-composer.html` (composeur), rôle `dashboard-publisher`, aide §23, `tests/{dashboard-store, dashboards-routes.smoke, pg-dashboard-store, a11y-static}`.
- **Modifié** : `public/brand/components.css` (section « dashboard widgets » : `.edv-dash`, `.edv-widget`, RAG, densités, repli une colonne < 720 px, lien d'évitement, `prefers-reduced-motion`), `public/_shell.js` (Executive ▸ *Executive Home*, Operations ▸ *Dashboards*), `public/reports.html` (carte de rôle), `reports-db.js` (`FEATURE_ROLES_KNOWN`), `server.js` (montage, DDL/seed sqlite immédiats, seed pg au boot, pages en cache).
- **Inchangé, volontairement** : `services/dashboardWidgets.js` (validateur de l'étape « fondations ») et `services/metricRegistry.js` — le composeur ne peut produire aucune formule.

## 3. Modèle de données
`dashboard_definitions` (clé, titre, audience, statut, définition JSON courante = brouillon, propriétaire, site, horodatages) ; `dashboard_definition_versions` (clé, version, instantané publié, note, auteur). La visionneuse lit **toujours** le dernier instantané publié ; le brouillon n'est visible que de l'éditeur (`?draft=1`). Journal : `system_log` catégorie `dashboards` (`dashboard_viewed` une fois par acteur et par jour, `dashboard_saved`, `dashboard_published`, `dashboard_retired`).

## 4. API / CLI
`GET /api/dashboards` · `GET /api/dashboards/catalogue` (éditeur) · `GET /api/dashboards/:key` · `GET /api/dashboards/:key/data?site=&window=[&draft=1]` · `POST /api/dashboards/:key/view` · `PUT /api/dashboards/:key` · `POST /api/dashboards/:key/publish` · `POST /api/dashboards/:key/retire` · `GET /api/dashboards/:key/versions` · `DELETE /api/dashboards/:key` (brouillon/retiré). Toutes derrière la session ; écritures = admin ou `dashboard-publisher` ; un éditeur limité à un site ne peut rattacher un tableau qu'à l'un de ses sites et ne modifie que les siens.

## 5. Écrans
- **Dashboards** : liste par audience (chips statut/version/portée), visionneuse (sélecteur de site borné au compte, période libre `YYYY-MM` / `YYYY-Www`, « Data as of », bouton *Edit in composer* pour l'éditeur).
- **Executive Home** = la définition `exec-home` rendue par la visionneuse : feux (kpi avec comparaison flotte), incidents majeurs / retards, tendance 13 semaines, « où en sommes-nous » par site (ragGrid), actions en retard.
- **Composeur** : formulaire tableau (clé, titre, audience, site), formulaire widget (type, KPI, politique RAG, fenêtre, x/y/w/h, options JSON), aperçu de la grille cliquable, liste des widgets, versions ; boutons *Save draft* / *Preview with data* / *Publish version* / *Retire*. **Maquettes designer : à produire** (arbitrage 1) — le composeur actuel est fonctionnel, pas habillé.

## 6. Règles métier
- Un widget ne porte qu'une **clé de KPI** ; `sql`/`query` sont refusés (validateur) ; un KPI inconnu est refusé.
- `null` ≠ 0 : un KPI non mesuré s'affiche « — » avec la mention *not measured* ; la comparaison flotte ne moyenne que les sites mesurés et dit sur combien.
- Les données « par site » n'énumèrent que les **sites du compte** ; le palier admin voit la flotte.
- Publication = version numérotée ; retrait conserve les versions ; suppression possible seulement d'un brouillon ou d'un tableau retiré.
- Audience `field` : ≤ 8 widgets, pas de heatmap, graphiques ≥ 6 colonnes, tables ≤ 10 lignes — sinon publication refusée (`fieldReadiness`).
- Accessibilité plancher (CI) : `lang`, viewport, lien d'évitement + `<main>`, contrôles étiquetés, images avec `alt`, pas de `tabindex` positif, pas de gestionnaire en ligne, zone `role="status"`.

## 7. Tests
`dashboard-store` (4), `dashboards-routes.smoke` (5 : liste/401, données en un appel + portée, garde éditeur + 400 + versions + retrait/suppression, terrain non publiable, journal de vue 1/jour), `pg-dashboard-store` (1, parité PostgreSQL), `a11y-static` (2), `dashboard-widgets` (existant), `csp-no-inline-handlers-new-pages` et `authz-route-matrix` (les 10 routes gardées).

## 8. Migration
Aucune donnée à migrer. Au premier démarrage, les 4 définitions sont publiées (version 1) si absentes ; une définition déjà présente n'est jamais réécrite. Les pages fixes historiques restent servies : le remplacement effectif (redirections) suit l'arbitrage 4.

## 9. Sécurité
Toutes les routes derrière la session et dans la matrice d'autorisation ; aucune valeur libre n'atteint SQL (la définition est du JSON validé, les métriques sont des clés) ; le texte des widgets est échappé avant rendu (`escapeHtml`, mini-Markdown restreint à gras/italique). Le rôle `dashboard-publisher` est un rôle de fonction : il ne donne aucun droit d'écriture ailleurs.

## 10. Exploitation
Usage réel : `SELECT actor, target, count(*) FROM system_log WHERE action='dashboard_viewed' GROUP BY 1,2` (ou System Logs ▸ dashboards) — c'est l'indicateur de réception « espace direction utilisé chaque semaine par ≥ 3 dirigeants ». Un tableau cassé se retire sans déploiement ; une version précédente se restaure en republiant l'instantané (fonction `version(key, n)` du store, bouton à ajouter au composeur si demandé).

## 11. Risques
- Le rendu `bar`/`table`/`heatmap`/`trackerRag` est **réduit** (liste par site ou message « non rendu ») en attendant les maquettes : fonctionnel, pas final.
- Un tableau avec de nombreux widgets « par site » multiplie les lectures (sites × widgets) : acceptable pour 11 sites ; un cache de 60 s côté route est le premier levier si la page dépasse 3 s.
- Sans maquettes, le risque est un composeur jugé « technique » par le comité : le script d'utilisabilité (§12, arbitrage 3) le mesure avant de généraliser.

## 12. Points d'arbitrage (défauts appliqués, à confirmer)
1. **Parcours et maquettes** (dirigeant, coordinateur, technicien, partie prenante externe) : à produire par le designer sur la base des 4 définitions livrées ; l'agent les intègre ensuite dans `components.css`.
2. **Droits de publication** : admin + rôle `dashboard-publisher` attribué aux membres du comité — **appliqué**.
3. **Tests d'utilisabilité** : script `docs/sdp360/design/ETAPE-06-test-utilisabilite.md` (FR, 5 tâches, SUS) à faire passer à 5 membres du comité ; cible SUS ≥ 75.
4. **Pages fixes remplacées** : proposition — `exec-view.html` (public, remplacé par `exec-home` + un lien partagé à l'étape 9), `wan-health.html`, `assets-hygiene.html` (déjà des redirections), puis `meetings-insights.html`, `inspections.html` (vue agrégée) ; chaque remplacement garde l'ancienne URL en redirection. Décision du comité page par page.
5. **Contenu de l'espace direction** : les 11 widgets livrés ; à confirmer la liste des « objectifs » (feux) avec la direction.
6. **Audit AA outillé** : axe-core dans Playwright sur les 2 pages nouvelles + l'espace direction, à l'intégration du navigateur en CI (étape 10) ; d'ici là, plancher statique.
