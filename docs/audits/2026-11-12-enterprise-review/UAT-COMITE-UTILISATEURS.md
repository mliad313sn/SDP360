# Comité représentatif des utilisateurs — plan F, vague 3 (12 novembre 2026)

> **Simulation par agents IA — ne remplace pas une recette utilisateur réelle.**
> Huit « sièges » ont été tenus par des agents IA sur une **organisation synthétique** (sites Hounde / Mana / Sabodala
> d'une base PostgreSQL jetable, comptes générés, données fictives). Aucun utilisateur réel n'a participé. Rien ici
> n'est une approbation, une signature, une recette terrain, ni une déclaration d'aptitude à la production.

## 1. Objet, méthode et limites

**Objet.** Avant de proposer un pilote, rejouer les tâches que huit profils d'utilisateurs font chaque semaine, dans
deux configurations, et dire pour chacun ce qui marche, ce qui bloque et ce qui manque.

**Méthode.**
- Chaque siège = un fichier de parcours navigateur `tests/e2e/uat-sN-*.spec.js` (Playwright Chromium, tout trafic
  externe du navigateur bloqué) qui démarre la vraie application sur une base PostgreSQL **jetable**, crée les comptes
  synthétiques, puis exécute ses parcours **deux fois** :
  - **Passe A — réglages livrés** : tous les interrupteurs du plan F à `0` (comportement d'aujourd'hui) ;
  - **Passe B — « profil pilote »** : les interrupteurs du plan F de `docs/ops/pilot/PILOT-PROFILE.md` mis à `1`,
    **dans la base jetable uniquement** (liste au §3).
- Chaque parcours est noté **PASS** (se comporte comme attendu), **FAIL** (défaut), **BLOQUÉ** (impossible sans une
  décision ou une donnée extérieure) ou **NON TESTABLE** (fonction éteinte dans cette passe : le comportement « éteint »
  — 404 / masqué — a été vérifié, mais la personne ne peut pas faire la tâche).
- Chaque personne se connecte **une fois** puis garde sa session (comme dans la vraie vie, et parce que la limite de
  connexion bloque au-delà de 10 connexions par 15 min, UAT-OI-02).
- Les 32 parcours navigateur existants (`tests/e2e/*.spec.js`) ont aussi été rejoués dans les deux passes
  (variable `UAT_PILOT_PROFILE=1` du harnais, §6).
- Les captures d'écran restent dans un répertoire de travail privé, hors dépôt.

**Limites (à lire avant toute conclusion).**
- Ce sont des **agents** qui « jouent » les personnes : ils ne ressentent ni la fatigue, ni la lenteur d'un réseau de
  mine, ni l'ambiguïté d'un libellé. Les verdicts « utile / compréhensible » sont des **hypothèses** à confirmer.
- Le réseau terrain est **simulé** (bascule hors ligne de Chromium), pas un vrai lien VSAT / 4G ; la recette terrain sur
  vrais téléphones (E-F04) reste à faire.
- Données synthétiques : aucun chiffre réel, aucune source réelle (Zoho, Meraki, OpManager non connectés) ; un
  indicateur dépendant d'une source s'affiche « jamais synchronisé ».
- Les temps, l'effort et la confiance ne sont **pas** mesurés.

## 2. Les huit sièges

| Siège | Persona | Compte synthétique (rôles, site) | Parcours |
|---|---|---|---|
| 1 | Coordinateur IT de site | `editor`, Hounde (HGO) | `tests/e2e/uat-s1-site-coordinator.spec.js` |
| 2 | Coordinateur de deux sites | `editor` + `tracker-editor`, Hounde + Sabodala | `tests/e2e/uat-s2-multisite-coordinator.spec.js` |
| 3 | Responsable IT Groupe / PMO | `viewer` + `committee-member` (+ un 2ᵉ membre pour l'approbation indépendante) | `tests/e2e/uat-s3-pmo.spec.js` |
| 4 | Lecteur Finance | `viewer` + `finance-viewer` | `tests/e2e/uat-s4-finance.spec.js` |
| 5 | Direction | `executive` | `tests/e2e/uat-s5-executive.spec.js` |
| 6 | Technicien terrain | `field-tech`, Hounde, téléphone 390 px | `tests/e2e/uat-s6-field-technician.spec.js` |
| 7 | Super-admin / exploitation IT | `super_admin` | `tests/e2e/uat-s7-super-admin.spec.js` |
| 8 | Utilisateur métier du site | `site-business`, Hounde | `tests/e2e/uat-s8-site-business.spec.js` |

## 3. Profil pilote utilisé en passe B

`tests/e2e/fixtures/uat.js` (`PILOT_PROFILE`) — chaque clé existe dans `services/reportConfig.js` avec la valeur
livrée `0` et une ligne dans `PILOT-PROFILE.md` (vérifié par `tests/uat-committee.test.js`) :
`workspace_profiles_enabled`, `ui_home_queue`, `ui_nav_active_from_url`, `ui_nav_carry_site`, `ui_home_blocks`,
`ui_exec_charts_v2`, `ui_kpi_definition_drawer`, `dashboard_decision_kpis_seed`, `metric_programme_readers`,
`portfolio_views_enabled`, `ppm_project_team_enabled`, `ppm_time_entries_enabled`, `ppm_change_requests_enabled`,
`roadmap_publication_enabled`, `decision_lifecycle_enforced`, `department_rollup_enabled`,
`mywork_awaiting_me_enabled`, `benefit_value_class_enabled`, `finance_currency_required`, plus deux interrupteurs
existants sans lesquels l'établi du plan F n'est pas utilisable : `ppm_budget_periods_enabled` (réels) et
`ppm_rebaseline_enabled` (appliquer une demande de changement).
**Laissés à leur valeur livrée** (décision humaine nécessaire) : `ux_event_telemetry`, `csp_strict_pages`,
`ppm_alloc_unspecified`, `benefit_money_verifier_role`, `restore_drill_*`, et `ui_i18n_pages` (voir UAT-OI-01).

## 4. Tableau des parcours (passe A / passe B)

Résultat final, après correction des défauts du §7 : 57 parcours × 2 passes.

| Passe | PASS | FAIL | BLOQUÉ | NON TESTABLE (switch off) |
|---|---|---|---|---|
| A — réglages livrés | 39 | 1 (S7-08, connu) | 0 | 17 |
| B — profil pilote | 56 | 1 (S7-08, connu) | 0 | 0 |

Avant les corrections : S1-07 était FAIL dans les deux passes (accueil à 320 px), S8-06 BLOQUÉ en passe B (profil
métier refusé) et S2-02 BLOQUÉ dans les deux passes tant que le compte n'avait que `editor` (le tracker exige
`tracker-editor` ; le compte du siège a reçu ce rôle, comme les coordinateurs réels depuis le 2026-10-02).

| Parcours | Tâche | Passe A | Passe B |
|---|---|---|---|
| S1-01 | Ouvrir l’accueil et voir son travail du jour (site A seulement) | PASS — accueil « Mon travail » sans file S1 (switch off) | PASS — file S1 visible, action du site A en retard listée |
| S1-02 | Retrouver le rapport hebdo de son site ; celui du site B est refusé | PASS — propre rapport 200, rapport site B 403 | PASS — propre rapport 200, rapport site B 403 |
| S1-03 | Registre d’actions du site : l’action en retard apparaît, le site B est refusé | PASS — HGO 200 avec l’action en retard ; MGO 403 | PASS — HGO 200 avec l’action en retard ; MGO 403 |
| S1-04 | Passer l’action « en cours » (auteur conservé) | PASS — statut changé, ligne d’historique écrite | PASS — statut changé, ligne d’historique écrite |
| S1-05 | Créer un PV sur son site ; refus sur un autre site | PASS — PV HGO créé, PV MGO refusé (403) | PASS — PV HGO créé, PV MGO refusé (403) |
| S1-06 | Lister les inspections de son site | PASS — liste 200 | PASS — liste 200 |
| S1-07 | Téléphone 320 px en français : accueil et registre d’actions lisibles sans défilement horizontal | PASS — /home.html lang=fr · /site-actions.html?site=HGO lang=en | PASS — /home.html lang=fr · /site-actions.html?site=HGO lang=en |
| S1-08 | « Mon travail » : ses éléments, sans ceux du site B | PASS — Mon travail 200 (sans bloc « En attente de moi ») | PASS — bloc « En attente de moi » présent |
| S1-09 | Réglages d’espace : choisir son profil, sans changer ses droits | NON TESTABLE (switch off) — workspace_profiles_enabled=0 → 404 vérifié | PASS — profil coordinator enregistré, rôles inchangés, page OK |
| S2-01 | Voir les rapports hebdo de ses deux sites, jamais MANA | PASS — Hounde + Sabodala | PASS — Hounde + Sabodala |
| S2-02 | Tracker : les deux codes de site sont proposés | PASS — scopes=["HGO","SGO"] (le compte porte aussi tracker-editor, comme les coordinateurs réels) | PASS — scopes=["HGO","SGO"] (le compte porte aussi tracker-editor, comme les coordinateurs réels) |
| S2-03 | Écrire un PV sur le 2ᵉ site ; MANA refusé | PASS — SGO 200, MGO 403 | PASS — SGO 200, MGO 403 |
| S2-04 | Accueil : file de travail des deux sites (jamais MANA) | PASS — pas de file S1 (switch off) — accueil sans liste d’actions agrégée | PASS — actions Hounde ET Sabodala dans la file |
| S2-05 | Le menu garde le site courant (Sabodala) quand on navigue | NON TESTABLE (switch off) — ui_nav_carry_site=0 : le lien du menu ne garde pas ?site=SGO | PASS — lien du menu = site-actions.html?site=SGO |
| S2-06 | Site par défaut : seuls ses deux sites sont proposés ; MANA refusé | NON TESTABLE (switch off) — workspace_profiles_enabled=0 → 404 | PASS — sites proposés = Hounde, Sabodala ; MANA 400 ; Sabodala enregistré |
| S2-07 | Page Rapports à 320 px sans défilement horizontal | PASS — OK | PASS — OK |
| S3-01 | Lire le portefeuille en liste / tableau / chronologie | NON TESTABLE (switch off) — portfolio_views_enabled=0 : chronologie seule, ?view=board ignoré | PASS — sélecteur 3 vues, une seule active (board) |
| S3-02 | Ouvrir un projet, onglet Plan | PASS — Plan lisible ; onglet Changes masqué | PASS — Plan lisible ; onglet Changes visible |
| S3-03 | Déclarer un membre d’équipe (rôle + allocation) ; 150 % refusé | NON TESTABLE (switch off) — ppm_project_team_enabled=0 → 404 | PASS — membre ajouté (60 %), 150 % refusé 400 ; le nom reste du texte libre |
| S3-04 | Saisir des heures réelles sur une tâche ; 25 h refusées | NON TESTABLE (switch off) — ppm_time_entries_enabled=0 → 404 | PASS — 4 h enregistrées, 25 h refusées, heures réelles lisibles |
| S3-05 | Demande de changement : proposer, évaluer, faire approuver par un AUTRE membre | NON TESTABLE (switch off) — ppm_change_requests_enabled=0 → 404 (seul substitut : une RFI) | PASS — proposée → évaluée → auto-approbation refusée (403) → approuvée par un tiers → appliquée (version de référence 1) |
| S3-06 | Préparer une séance du comité et faire évoluer une décision | PASS — sans présidence: 403 ; comme président: décision créée ; passage à done → 200 done ; cycle de vie imposé = false | PASS — sans présidence: 403 ; comme président: décision créée ; passage à done → 200 done ; cycle de vie imposé = true |
| S3-07 | Vue par département (consolidation) | NON TESTABLE (switch off) — department_rollup_enabled=0 → 404 | PASS — rollup 200, correspondances proposées=true |
| S3-08 | Exporter le classeur du portefeuille | PASS — xlsx 27636 octets | PASS — xlsx 32556 octets |
| S3-09 | Cockpit des réunions de gouvernance | PASS — cockpit OK | PASS — cockpit OK |
| S4-01 | Voir le budget d’un projet (un simple lecteur ne le voit pas) | PASS — budget visible pour Finance, masqué pour un lecteur | PASS — budget visible pour Finance, masqué pour un lecteur |
| S4-02 | Montants des actifs : la page Finance s’ouvre et dit « non certifié » | PASS — certification=false | PASS — certification=false |
| S4-03 | Bénéfice : classer la valeur (trésorerie réalisée / coût évité estimé) et lire les totaux par classe | NON TESTABLE (switch off) — benefit_value_class_enabled=0 : la classe est ignorée, pas de totaux par classe | PASS — classe enregistrée, totaux par classe présents (aucune valeur réalisée inventée) |
| S4-04 | Un montant sans devise est signalé (avertissement) ou refusé (pilote) | PASS — enregistré avec l’avertissement CURRENCY_DEFAULTED (« USD par défaut, non confirmé ») | PASS — refusé 400 : devise obligatoire |
| S4-05 | Finance ne peut rien modifier dans le portefeuille | PASS — écriture refusée 403 | PASS — écriture refusée 403 |
| S4-06 | Classeur : feuille des périodes budgétaires visible pour Finance seulement | NON TESTABLE (switch off) — ppm_budget_periods_enabled=0 : pas de feuille ; feuilles=Projects,Tasks,Milestones,RAID,Baselines,Exceptions,Benefits,Capacity | PASS — feuille présente pour Finance, absente pour un lecteur |
| S5-01 | IT Review : les données du comité se chargent | PASS — review-data 200, page sans erreur | PASS — review-data 200, page sans erreur |
| S5-02 | Executive Scorecard : graphiques au standard exécutif (pilote) | NON TESTABLE (switch off) — ui_exec_charts_v2=0 : graphiques d’aujourd’hui (double axe, anneaux) | PASS — politique exec_charts_v2=1 reçue, graphiques au standard exécutif |
| S5-03 | Tableaux de bord publiés ; définition d’un KPI à portée de clic (pilote) | NON TESTABLE (switch off) — 5 tableau(x) rendus sans erreur ; tiroir « Définition » absent (switch off) | PASS — tiroir « Définition » présent sur 8 tuile(s) (assets-hygiene) |
| S5-04 | Lire le portefeuille | PASS — portefeuille 200 | PASS — portefeuille 200 |
| S5-05 | Vue flotte des sites (Site Awareness) | PASS — flotte 200 | PASS — flotte 200 |
| S5-06 | Scorecard sur téléphone 390 px | PASS — OK | PASS — OK |
| S5-07 | Profil d’espace « executive » proposé, sans droit supplémentaire | NON TESTABLE (switch off) — workspace_profiles_enabled=0 → 404 ; écriture portefeuille (palier admin) = 200 | PASS — profil=executive ; droit d’écriture portefeuille identique au passage A (200) |
| S6-01 | Ouvrir l’application terrain sur téléphone (390 px), en français | PASS — sites proposés=Hounde | PASS — sites proposés=Hounde |
| S6-02 | Saisir une inspection rapide hors ligne puis synchroniser sans perte | PASS — file 1 → 0, inspection stockée sur HGO (réseau SIMULÉ) | PASS — file 1 → 0, inspection stockée sur HGO (réseau SIMULÉ) |
| S6-03 | Le compte terrain ne peut pas écrire le rapport hebdo ni les PV | PASS — rapport 403, PV 403 | PASS — rapport 403, PV 403 |
| S6-04 | Accueil du technicien | PASS — accueil sans erreur à 390 px | PASS — accueil sans erreur à 390 px |
| S6-05 | Profil d’espace « terrain » proposé | NON TESTABLE (switch off) — workspace_profiles_enabled=0 → 404 | PASS — profil=field destinations=home,field,inspections,site-actions |
| S7-01 | Console d’administration | PASS — console sans erreur | PASS — console sans erreur |
| S7-02 | Journal de sécurité : connexions visibles et exportables | PASS — 9 évènements | PASS — 9 évènements |
| S7-03 | Fraîcheur des sources : jamais synchronisé ≠ zéro mesuré | PASS — statut sync 200 ; états vus : "ok","never synced" | PASS — statut sync 200 ; états vus : "ok","never synced" |
| S7-04 | Utilisateurs et configuration : secrets jamais renvoyés | PASS — liste utilisateurs + config 200, secrets vides | PASS — liste utilisateurs + config 200, secrets vides |
| S7-05 | Publication contrôlée de la feuille de route (simulation d’abord) | NON TESTABLE (switch off) — roadmap_publication_enabled=0 → 404 (API de migration seule) | PASS — état {"ok":true,"migrated":false,"programme":null,"read_only":false,"soft_delete":false,"parity":"not_mig ; simulation 200 |
| S7-06 | Correspondance des départements (lecture seule, proposée) | PASS — lecture seule=true ; roll-up activé=false ; paires=20 | PASS — lecture seule=true ; roll-up activé=true ; paires=20 |
| S7-07 | Page Réglages d’espace (sans effet sur les droits) | NON TESTABLE (switch off) — page 404 (switch off) | PASS — 10 profils proposés au super_admin |
| S7-08 | Admin à 320 px | FAIL (connu, UAT-OI-03) — défilement horizontal : la carte « Users » (#ap-users) fait 684 px | FAIL (connu, UAT-OI-03) — idem |
| S8-01 | Voir l’état IT de son site (Site Awareness) | PASS — résumé HGO 200, page OK | PASS — résumé HGO 200, page OK |
| S8-02 | Le site voisin (MANA) est refusé | PASS — MGO 403 | PASS — MGO 403 |
| S8-03 | Aucune écriture et aucune liste interne | PASS — PV 403, registre interne 403 | PASS — PV 403, registre interne 403 |
| S8-04 | Accueil : la file interne n’est jamais interrogée | PASS — URL finale /site-awareness.html ; appels internes=0 | PASS — URL finale /site-awareness.html ; appels internes=0 |
| S8-05 | Site Awareness sur téléphone 320 px en français | PASS — lang=fr | PASS — lang=fr |
| S8-06 | Profil d’espace « métier » | NON TESTABLE (switch off) — workspace_profiles_enabled=0 → 404 | PASS — profil=business (corrigé : la route était refusée par la frontière métier) ; registre interne toujours 403 |

Preuve : chaque ligne est une assertion du fichier de siège cité au §2 ; le résultat brut (`uat-<siège>.json`) est écrit
dans le répertoire d'artefacts du parcours (`E2E_ARTIFACT_DIR`).

## 5. Verdict par siège (simulation)

**Siège 1 — coordinateur IT de site.** *Utile ?* Oui : rapport, registre d'actions, PV et inspections sont joignables
et bornés à son site (site B refusé partout). *Compréhensible ?* En passe A, l'accueil ne montre pas une file de
travail unique : il faut aller chercher les actions module par module ; la passe B (file S1) répond à « que dois-je
faire aujourd'hui ». *Ce qui bloque le travail :* sur téléphone 320 px l'accueil débordait (corrigé, D1) ; en
français, le registre d'actions reste en anglais tant que `ui_i18n_pages` est éteint (UAT-OI-01).

**Siège 2 — coordinateur de deux sites.** *Utile ?* Oui : ses deux sites et jamais un troisième, dans les rapports, les
PV, le tracker et la file. *Compréhensible ?* En passe B le menu garde le site courant et le site par défaut se choisit
parmi ses deux sites seulement. *Bloquant :* le tracker exige `tracker-editor` en plus d'`editor` — à vérifier sur
chaque compte réel.

**Siège 3 — PMO.** *Utile ?* En passe A le portefeuille se lit (chronologie, plan, export, cockpit) mais l'établi projet
est incomplet : pas d'équipe, pas d'heures réelles, pas de demande de changement native, pas de vue par département.
En passe B tout cela fonctionne, avec séparation des tâches (l'auteur d'une demande ne peut pas l'approuver).
*Bloquant :* consigner une décision exige d'être président ou secrétaire de la cadence (UAT-OI-06) ; les membres
d'équipe restent du texte libre (UAT-OI-08) ; saisir une clé de programme déjà prise renvoyait une erreur interne
(corrigé, D2).

**Siège 4 — Finance.** *Utile ?* Oui pour lire : budget visible pour Finance, masqué pour un lecteur ; les montants
d'actifs sont dits « non certifiés ». En passe B, la classe de valeur des bénéfices (trésorerie réalisée / coût évité
estimé), le refus d'un montant sans devise et la feuille des périodes budgétaires répondent à « quel argent est réel ».
*Bloquant :* aucune valeur ne peut être certifiée sans vérificateur Finance désigné (`benefit_money_verifier_role`
vide — décision humaine).

**Siège 5 — Direction.** *Utile ?* IT Review, scorecard, tableaux de bord et flotte des sites se chargent sans erreur, y
compris à 390 px. En passe B la définition d'un KPI (formule, fenêtre, dénominateur, source) est à un clic (8 tuiles).
*Remarque :* le palier `executive` peut écrire dans le portefeuille (règle actuelle : palier admin = comité) — décision
PO (UAT-OI-05).

**Siège 6 — technicien terrain.** *Utile ?* Saisie hors ligne puis synchronisation sans perte (réseau **simulé**),
écran 390 px correct, aucune écriture hors de son périmètre. *Bloquant :* rien dans la simulation ; la vraie preuve est
la recette sur vrais téléphones et vrai réseau (E-F04), non faite. Le parcours « réseau contraint » existant (f1) a
échoué 1 fois sur 4 exécutions (UAT-OI-04).

**Siège 7 — super-admin.** *Utile ?* Console, journal de sécurité, fraîcheur des sources (« jamais synchronisé »
distinct de « ok »), secrets jamais renvoyés, correspondance des départements en lecture seule. En passe B la
publication contrôlée de la feuille de route démarre bien par une simulation. *Bloquant :* la console d'administration
déborde à 320 px (UAT-OI-03) ; la limite de connexion compte aussi les connexions réussies (UAT-OI-02).

**Siège 8 — utilisateur métier.** *Utile ?* Il voit l'état IT de son site, jamais le voisin, n'écrit rien, et l'accueil
le renvoie vers Site Awareness sans jamais interroger la file interne. *Bloquant :* en passe B son profil d'espace
« métier » lui était refusé par la frontière des comptes métier (corrigé, D3).

## 6. Parcours existants rejoués (32 fichiers)

| Passe | Premier passage | Après corrections |
|---|---|---|
| A | 30 / 32 : `x1-exports` rouge (en-tête CSV figé avant F-DATA-05), `f1-field-network` rouge une fois | 32 / 32 ; `f1` vert sur les 3 exécutions suivantes (instabilité, UAT-OI-04) |
| B | 31 / 32 : `v1-viewport-layout` rouge (erreur console 404 sur l'accueil) | 32 / 32 (défaut D4 corrigé ; `v1` et `r2` rejoués dans les deux passes) |

## 7. Défauts corrigés dans cette branche

| # | Défaut trouvé par le comité | Correction | Test qui échoue avant / passe après |
|---|---|---|---|
| D1 (S1-07) | Accueil à 320 px : la carte de site dépassait l'écran (347 px) — une piste de grille `1fr` ne descend pas sous la largeur de son contenu | `public/home.html` : piste `minmax(0, 1fr)`, paire libellé/valeur qui passe à la ligne | `tests/uat-committee.test.js` (S1-07) + parcours `uat-s1` S1-07 |
| D2 (S5-07) | Créer un programme / objectif / projet avec une clé déjà utilisée renvoyait **500** (nom de contrainte dans le journal) | `services/governanceStore.js` : doublon → **409 CONFLICT** « already exists — open it to edit it, or choose another key » | `tests/portfolio-duplicate-key.smoke.test.js` (500 avant, 409 après) |
| D3 (S8-06) | Profil d'espace « métier » inaccessible : `/api/workspace/me` et `/prefs` hors de la liste des routes permises aux comptes métier → 403 | `services/businessGuard.js` : ces deux routes seulement (présentation, clé = la session ; 404 tant que l'interrupteur est éteint) | `tests/uat-committee.test.js` (S8-06) + `uat-s8` S8-06 en passe B |
| D4 (`v1`, passe B) | File d'accueil : la source « Engagements » appelait `/api/commitments` même module éteint → 404 et erreur console à chaque chargement | `services/uiPolicy.js` expose `commitments` ; `public/lib/homeQueue.js` ne fait plus l'appel et affiche « désactivé » ; `public/lib/home-page.js` passe l'option | `tests/home-queue.test.js` (cas UAT-F) + `v1-viewport-layout` en passe B |
| D5 (`x1`) | Parcours d'export rouge : en-tête CSV figé avant l'ajout des colonnes partial / n / target / low_sample / error | `tests/e2e/x1-exports.spec.js` lit l'en-tête de `services/dashboardCsv.js` (source unique) | le parcours lui-même |

Règles respectées : aucun nouvel interrupteur, comportement livré inchangé quand les interrupteurs sont éteints, erreurs
par `httpFail` (ratchet d'erreurs 444 inchangé), aucune couleur hexadécimale ajoutée, `server.js` non modifié. Les deux
tests qui figent la forme exacte de la politique d'interface (`tests/ui-policy*.test.js`) ont reçu la clé `commitments`.

## 8. Problèmes ouverts (avec prompt /goal)

**UAT-OI-01 — Le français ne couvre pas les pages tant que `ui_i18n_pages` est éteint** (S1-07 : accueil `lang=fr`,
registre d'actions `lang=en`). Décision PO : l'ajouter au profil pilote ou non.
> /goal — SDP360 / UAT-OI-01 : sur une base jetable avec `ui_i18n_pages='1'`, parcourir les pages des huit sièges en
> français à 320 px ; lister chaque texte resté en anglais et chaque page dont la langue du document ne suit pas ;
> compléter les dictionnaires `public/lib/i18n/<page>.fr.js` (pas de nouvel interrupteur) ; étendre
> `tests/i18n-coverage.test.js`. Preuve : tableau page × textes manquants avant / après.

**UAT-OI-02 — La limite de connexion compte les connexions réussies** (10 par 15 min et par adresse, `loginLimiter`
de `server.js`) : un poste partagé, ou plusieurs personnes vues sous une même adresse, sont bloqués « Too many login
attempts » après 10 connexions **réussies**. Décision du responsable sécurité.
> /goal — SDP360 / UAT-OI-02 : derrière un nouvel interrupteur `auth_login_limit_failures_only` (défaut `'0'` =
> aujourd'hui), ne compter que les tentatives échouées dans le limiteur de `/api/reports/auth/login`
> (`services/rateLimit.js`) ; garder `auth_account_throttle_*` inchangé ; tests : 11 connexions réussies passent avec
> l'interrupteur, 11 échecs sont refusés dans les deux cas ; ligne PILOT-PROFILE + FLAG-REGISTER ; activation
> seulement après décision du responsable sécurité.

**UAT-OI-03 — Console d'administration à 320 px** : la carte « Users » (`#ap-users`) fait 684 px (S7-08, marqué KNOWN
dans le parcours du siège 7).
> /goal — SDP360 / UAT-OI-03 : dans `public/reports.html`, placer les tableaux d'administration (`#ap-users` puis les
> autres cartes) dans un conteneur à défilement horizontal propre ; ajouter l'administration à 320 px au parcours
> `v1-viewport-layout` ; retirer l'entrée KNOWN de `tests/e2e/uat-s7-super-admin.spec.js`. Pas de couleur
> hexadécimale.

**UAT-OI-04 — Parcours `f1-field-network` instable** : 1 échec sur 4 exécutions en passe A (« (c) inspection stored
once 0 !== 1 » — expiration de session au milieu d'une photo).
> /goal — SDP360 / UAT-OI-04 : exécuter `tests/e2e/f1-field-network.spec.js` 20 fois ; si l'échec (c) se reproduit,
> établir s'il s'agit d'une course du test ou d'une perte réelle dans `public/field/app.js` ; corriger la cause (jamais
> en allongeant seulement un délai). Preuve : 20 / 20.

**UAT-OI-05 — Le palier `executive` peut modifier le portefeuille** (S5-07 : création d'un programme = 200). C'est la
règle actuelle (palier admin = comité). Décision PO / IAM : la direction doit-elle être en lecture seule ?
> /goal — SDP360 / UAT-OI-05 (seulement après décision) : interrupteur `portfolio_executive_read_only` (défaut `'0'`) ;
> à `'1'`, `PUT /api/governance/portfolio/*` refuse un compte dont le seul rôle d'écriture est `executive` ; matrice
> d'autorisation régénérée ; tests 403 / 200.

**UAT-OI-06 — Consigner une décision exige la présidence ou le secrétariat de la cadence** (S3-06 : un membre du comité
non président reçoit 403 ; la cadence des parcours n'a pas de président). Paramétrage + décision de gouvernance.
> /goal — SDP360 / UAT-OI-06 : dans `public/cockpit.html`, quand une cadence n'a ni président ni secrétaire, le dire
> (« aucun président désigné — personne ne peut consigner de décision ») avec le lien de modification ; vérifier que
> la démonstration synthétique (`tools/demo/seed-demo.js`) nomme un président synthétique.

**UAT-OI-07 — Le serveur tente des appels Zoho pendant les parcours** : ouvrir le scorecard sur une base vide déclenche
un rafraîchissement de jeton (`invalid_client` dans le journal) ; le harnais ne bloque que le trafic du navigateur.
> /goal — SDP360 / UAT-OI-07 : dans `tests/e2e/fixtures/server.js`, empêcher les appels sortants du serveur (variable
> d'environnement dédiée lue par le rafraîchissement du jeton, défaut = aujourd'hui) et compter toute tentative comme
> « externe inattendue » dans l'artefact du parcours. Preuve : 0 tentative sur les 40 parcours.

**UAT-OI-08 — Identité des personnes dans l'établi projet** : membres d'équipe et propriétaires restent du texte libre
(S3-03) — déjà décrit dans `WORKBENCH-GAPS.md` (item 5) ; prérequis à tout arbitrage de capacité entre sites (E07).
> /goal — SDP360 / UAT-OI-08 : lier `ppm_project_members` et les propriétaires de tâche à un identifiant d'utilisateur
> optionnel (le libellé historique conservé), derrière l'interrupteur existant `ppm_project_team_enabled` ; la capacité
> par site ne somme que les allocations liées à une personne connue et affiche la couverture.

## 9. Couverture des écarts de la demande

Le document d'écarts fourni (« SDP360 — Analyse comparative et trajectoire entreprise », 12 nov. 2026) numérote ses
écarts **E01 à E10**. Les libellés **F01–F09** cités dans la demande **ne figurent ni dans ce document ni dans le
dépôt**, à deux exceptions près reprises par `REBUILD-SPEC.md` : **F02 = E03** (démonstration de bout en bout) et
**F03** (fraîcheur des sources). La couverture est donc donnée sur E01–E10 ; **F01 et F04–F09 sont « définition non
fournie »** et doivent être transmis pour être évalués.

| Écart | Couverture par le comité simulé | Preuve |
|---|---|---|
| E01 Base et provenance | Non couvert (hors du champ d'une recette) | — |
| E02 Accès multisite (site A/B, groupe, Finance, révocation) | **Couvert (simulation)** : site B refusé partout, deux sites jamais un troisième, Finance voit l'argent et le lecteur non, compte métier borné à son site ; la révocation est couverte par `c5`. Validation IAM / PMO humaine requise | S1-02/03/05, S2-01/03/04/06, S4-01/05, S8-02/03, `deny-cross-site`, `c5` |
| E03 = F02 Démonstration de bout en bout | **Partiel** : `demo-journey` vert dans les deux passes ; l'établi complet (équipe, heures, changement, export) passe en B | `demo-journey`, S3-01…08 |
| E04 Intégrations / F03 Fraîcheur | **Partiel** : « jamais synchronisé » distinct de « ok » (S7-03) ; aucune source réelle (pas d'identifiants) | S7-03 |
| E05 Continuité (installeur, reprise) | Non couvert | — |
| E06 Profils et design | **Couvert (simulation)** : profils d'espace pour 6 sièges sans changement de droits, une seule destination active, 320 / 390 px, français ; 2 défauts trouvés et corrigés (D1, D3), 2 ouverts (UAT-OI-01, -03) | S1-07/09, S2-05/06, S5-06/07, S6-01/05, S7-07/08, S8-05/06 |
| E07 Portefeuille / allocation | **Partiel** : allocation de membre bornée (150 % refusé) ; la convention « allocation inconnue » reste une décision PMO | S3-03 |
| E08 Décisions et KPI | **Partiel** : cycle de vie imposé en B, définition des KPI en B ; les deux KPI de décision restent à choisir par un comité réel | S3-06, S5-03 |
| E09 Adoption et bénéfices | **Non couvert** : exige des personnes réelles (Q1–Q4 appariés) ; seule la classe de valeur des bénéfices est exercée | S4-03 |
| E10 Durcissement | **Partiel** : frontière des comptes métier corrigée (D3), limite de connexion signalée (UAT-OI-02) | S8-03/06 |

**Unités métier.** Le document cite 14 usages départementaux (la demande en évoque 22) ; aucun parcours propre à un
département n'a été simulé. Seules la vue de consolidation par département (S3-07, passe B) et la table de
correspondance en lecture seule (S7-06, 20 paires **proposées**) ont été exercées. Chaque responsable d'unité doit
confirmer ses usages en séance réelle.

## 10. Ce que les vrais utilisateurs doivent encore faire

Séances avec de vraies personnes (protocole `docs/ops/USABILITY-TEST-PROTOCOL.md`, fiche
`docs/ops/pilot/FIRST-CLICK-SHEET.csv`) :
1. **Coordinateur d'un site** (deux sites différents) : rapport hebdo, file d'accueil, PV signé, en français, sur son
   téléphone.
2. **Coordinateur multi-sites** : vérifier sur son vrai compte les rôles (`tracker-editor`) et ses deux sites.
3. **PMO + un second membre du comité** : un vrai projet de bout en bout (équipe, heures, demande de changement
   approuvée par un tiers, décision en séance).
4. **Finance** : lire un projet et un bénéfice ; dire si « non certifié » et les classes de valeur sont compréhensibles.
5. **Direction** : IT Review et scorecard en comité réel ; dire si la définition d'un KPI aide à décider.
6. **Technicien terrain** : recette sur vrais téléphones et vrai réseau de mine (`FIELD-DEVICE-UAT.md`, E-F04).
7. **Utilisateur métier** (GM / FM de site) : Site Awareness, en français.
8. **Exploitation IT** : console, journal, fraîcheur des sources après branchement réel des connecteurs.

**Décisions pour le PO** (aucune n'est prise ici) :
- activer ou non chaque interrupteur du §3 sur le pilote, et y ajouter ou non `ui_i18n_pages` (UAT-OI-01) ;
- politique de limite de connexion (UAT-OI-02, avec le responsable sécurité) ;
- direction en lecture seule sur le portefeuille ou non (UAT-OI-05) ;
- qui préside / consigne les décisions de chaque cadence (UAT-OI-06) ;
- convention d'allocation (`ppm_alloc_unspecified`), vérificateur Finance des bénéfices, membres du comité KPI et les
  deux KPI de décision ;
- liste réelle des unités métier et de leurs usages (14 ou 22), à faire confirmer par leurs responsables ;
- transmettre la définition des écarts F01–F09.

---

> **Simulation par agents IA — ne remplace pas une recette utilisateur réelle.** Aucun utilisateur réel n'a
> participé ; aucune approbation, signature, recette terrain ni déclaration de mise en production n'est faite ici.
