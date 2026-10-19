# Dossier de conception — Étape 07 — Constructeur de trackers, saisie, liaisons aux sources, migration du tracker 2026

Version 1 · 2026-10-19 · Auteur : agent IA · Relecteur : comité (à réceptionner) · Statut : **implémenté (volet agent) — volet humain (maquettes du constructeur, création de ≥ 3 trackers par les métiers, fenêtre de bascule, retrait des tables héritées) en attente**

## 1. Objectif et périmètre
Permettre à un responsable de site ou à un membre du comité de **créer un tracker sans développeur** (période, unités, groupes, items, types de KPI, poids, cibles), de le valider avec un score à blanc, de le publier en version numérotée, de le **remplir** (grille unité × période, verrou des périodes clôturées, import xlsx) et de laisser certains items se remplir **automatiquement** depuis le dictionnaire des KPI (réunions, inspections, tickets, parc). Migrer le **IT Activity Tracker 2026** vers ce moteur avec une marche en parallèle contrôlée (± 0,1 pt), puis basculer. Aucune formule hors du moteur : pages, Excel, PPTX et tableaux de bord lisent `services/trackerDefinitions.score`.

**Hors périmètre agent** : les maquettes du constructeur (designer), la création des ≥ 3 trackers métier (utilisateurs), la date de bascule et le retrait physique des tables `tracker_*` héritées (comité, après signature du rapport de comparaison).

## 2. Existant touché
- **Nouveau** : `services/trackerStore.js` (définitions / versions / saisies / cibles, sqlite + PostgreSQL via `db/postgres/tracker/002_tracker_definitions.sql` appliquée par le migrateur), `services/trackerSources.js` (liaisons item → KPI du registre, fenêtre par créneau), `services/trackerLegacy.js` (import du `D` hérité, marche en parallèle, CSV), `services/trackerTemplates.js` (4 modèles), `services/trackerExport.js` (Excel 3 feuilles + import de la feuille `Entries`, PPTX 2 diapositives via `fixComboChartAxes`), `routes/trackers.js`, `public/trackers.html` (liste + grille de saisie + scores), `public/tracker-builder.html` (constructeur), aide §24 EN/FR, tests `tracker-store`, `tracker-sources`, `trackers-routes.smoke`, `pg-tracker-store`.
- **Modifié** : `services/trackerDefinitions.js` — (a) l'agrégation unité = **moyenne des groupes pondérée par le poids du groupe, sur les groupes qui ont un score** (sémantique de `tracker-pptx.ss`), (b) un COUNT démarré sans cible vaut 0 (jamais N/A — sémantique héritée), (c) `source` n'exige plus qu'une clé de métrique ; `services/reportConfig.js` (`tracker_engine_cutover`) ; `public/_shell.js` (Operations ▸ Trackers) ; `server.js` (+5 lignes : parseur brut de l'import, montage, seed au boot, pages en cache — budget 8 260 respecté : 8 257).
- **Inchangé, volontairement** : `tracker-db.js`, `tracker-pptx.js`, `public/activity-tracker/*` — le tracker 2026 continue de tourner tel quel jusqu'à la bascule ; la comparaison lit les deux moteurs côte à côte.

## 3. Modèle de données
`tracker_definitions` (clé, nom, version, statut draft/review/published/retired, définition JSON = brouillon, propriétaire, référence RFI), `tracker_definition_versions` (instantané publié par version, note, auteur), `tracker_entries` (clé, unité, item, créneau 1..N, valeur, note, source `manual` / `import` / `import:legacy` / `sync:registry`, auteur, horodatage), `tracker_unit_targets` (cible et activation par unité × item). Le score lit **toujours** l'instantané publié s'il existe (sinon le brouillon pour le constructeur). Journal `system_log` catégorie `trackers` : `tracker_draft_saved`, `tracker_published`, `tracker_rolled_back`, `tracker_entries_saved`, `tracker_synced`, `tracker_export`, `tracker_legacy_imported`, `tracker_cutover`.

## 4. API
Voir l'en-tête de `routes/trackers.js`. Constructeur = admin ou `tracker-admin` ; saisie = constructeur ou `tracker-editor` sur les unités dont le code est le code tracker d'un de ses sites (`services/userSites.codesFor`) ; lecture = toute session (publiés seulement) ; bascule = super_admin. Routes statiques (`catalogue`, `templates`, `legacy/*`) enregistrées **avant** `/:key`.

## 5. Écrans
- **Trackers** : cartes (statut, version, période, unités × items) ; modèles visibles des seuls constructeurs ; visionneuse = tableau des scores (groupes, score, RAG, moyenne flotte) + grille de saisie par unité (périodes clôturées grisées, items liés en lecture seule, totaux), sélecteur « période atteinte », export Excel/PPTX, import xlsx.
- **Constructeur** : identité et période, tableau des unités, tableau groupes/items (code, nom, type, poids, cible, début, fin, partagé, source), *Validate & dry-run*, *Save draft*, *Publish*, *Retire*, *Delete draft*, *Versions* + *Roll back*, *Sync sources*, panneau **Migration** (comparer, CSV, importer, bascule). **Maquettes designer : à produire** (arbitrage 1).

## 6. Règles métier
- Poids des groupes = 1 ; codes uniques ; types de KPI du registre (`kpiRag.KPI_TYPES`) ; politique RAG parmi les politiques en données.
- Score d'unité = Σ(poids de groupe × score de groupe) / Σ poids des groupes ayant un score ; score de groupe = moyenne des atteintes plafonnées à 1, pondérée par le poids des items actifs. Un item non commencé est N/A (exclu), un COUNT commencé sans cible vaut 0 (hérité).
- Périodes clôturées : règle `public/lib/trackerMonthLock.js` (mois courant + précédent jusqu'au 5) ; le serveur garde la valeur stockée et compte les cellules bloquées ; super_admin non verrouillé ; l'import hérité et la synchronisation écrivent sans verrou (sources de vérité externes).
- Liaison : une lecture `null` est **ignorée** (non mesuré ≠ 0) ; une métrique hebdomadaire ne se lie pas à un tracker mensuel (créneau non traduisible → ignoré et compté).
- `null` ≠ 0 partout (scores « — »).

## 7. Tests
`tracker-definitions` (moteur, inchangé), `tracker-store` (4 : cycle de vie, verrou + portée + cibles + score, modèles, **import hérité + marche en parallèle ± 0,1 pt sur le programme 2026 livré**), `tracker-sources` (3 : fenêtres par créneau, liaisons, aller-retour Excel + PPTX), `trackers-routes.smoke` (4 : gardes, 400, publication/versions/rollback, saisie bornée + export/import, migration + bascule super_admin), `pg-tracker-store` (1, parité PostgreSQL), `a11y-static` et `csp-no-inline-handlers-new-pages` (2 pages), `authz-route-matrix` (routes gardées), `server-size-budget`.

## 8. Migration (tracker 2026)
1. **Comparer** (constructeur ▸ Migration) : résultat attendu PASS, écart max ≤ 0,1 pt sur 5 sites × 12 mois — mesuré sur le programme livré : **0,1 pt** (arrondis d'affichage), après alignement du moteur sur la sémantique héritée (§2).
2. **Importer** : définition `it-activity-2026` (4 groupes P1..P4, 31 items `P<g>-<nn>`, unités = sites actifs), 341 cibles, saisies non nulles ; brouillon → relecture → publication.
3. **Marche en parallèle un mois** : les coordinateurs saisissent dans l'ancien écran ; chaque semaine, *Compare* + CSV joint au compte rendu ; critère : aucun écart > 0,1 pt.
4. **Bascule** : interrupteur `tracker_engine_cutover` = 1 (super_admin) ; le nouvel écran devient la saisie de référence ; l'ancien écran passe en lecture seule (étape suivante : rediriger `activity-tracker.html` vers `trackers.html?key=it-activity-2026` — arbitrage 4).
5. **Retrait des tables héritées** : après signature ; sauvegarde `sdp-manager backup` préalable ; script de suppression à écrire au moment du retrait, jamais avant.

## 9. Sécurité
Toutes les routes derrière la session et dans la matrice d'autorisation ; la définition est du JSON validé (aucune formule, aucune requête) ; les valeurs de saisie sont numériques ou nulles ; l'import xlsx est lu par SheetJS en mémoire, borné à 10 Mo, et ne crée rien hors des unités/items de la définition ; l'export n'embarque aucune donnée personnelle (codes d'unité, noms d'items, chiffres).

## 10. Exploitation
`SELECT action, target, count(*) FROM system_log WHERE category='trackers' GROUP BY 1,2` répond à « combien de trackers créés sans développeur » (cible ≥ 3). Un tracker cassé se retire sans déploiement ; une version précédente se restaure par *Roll back* + *Publish*.

## 11. Risques
- Les métiers créent des trackers avec des cibles absentes → scores « — » : le dry-run le montre avant publication.
- La synchronisation lit le registre par unité × créneau : pour 12 créneaux × 5 unités × 3 items = 180 lectures ; acceptable, à lancer à la demande, pas en cron tant que les volumes ne sont pas connus.
- Le code d'unité doit égaler le code tracker du site pour la portée des éditeurs : documenté dans le constructeur ; un code libre reste possible (saisie par le constructeur seulement).

## 12. Points d'arbitrage (défauts appliqués, à confirmer)
1. **Maquettes du constructeur** : à produire par le designer ; version fonctionnelle livrée.
2. **Droits** : constructeur = admin + `tracker-admin` ; saisie = `tracker-editor` sur ses sites ; bascule = super_admin — **appliqué**.
3. **Versionnement et retour arrière** : version numérotée à chaque publication, retour par recopie dans le brouillon puis republication (jamais d'écrasement d'une version) — **appliqué**.
4. **Plan de migration** : fenêtre d'un mois de marche en parallèle à dater par le comité (proposition : le mois suivant la publication de `it-activity-2026`) ; propriétaire : Service & Support Manager ; critère : rapport CSV sans écart > 0,1 pt ; retrait des tables un mois après la bascule.
5. **Modèles** : les 4 livrés ; unités et cibles à ajuster par les métiers avant publication.
