---
title: "SDP Dashboard 2.0 — Rapport du comité d'évaluation"
subtitle: "Consolidation des 16 regards, prochains mouvements recommandés et bénéfices attendus"
author: "Product Owner (consolidation) — Comité d'évaluation SDP Dashboard 2.0"
date: "20 octobre 2026 — version 1.0"
lang: fr
---

> **Périmètre.** Dépôt `SDP360`, branche `claude/sdp-dashboard-analysis-55b1oy`, commit `c426b73`, version `2.0.0-alpha.11`. Les 10 étapes du programme décrit dans `docs/sdp360/08-ETUDE-SDP-DASHBOARD-2.0.md` (§9.1 à §9.10) sont livrées dans le code et couvertes par la suite de tests (2 592 tests, 0 échec, 11 ignorés pour des raisons d'environnement). Ce rapport ne juge pas « si c'est fini » : il juge **si c'est prêt à servir**, et ce qu'il faut faire avant.

# 1. Résumé exécutif

**Verdict du comité : la plateforme est techniquement complète mais pas encore exploitable en confiance.** Le socle (PostgreSQL unique, synchronisations supervisées, registre de KPI, SSO, installateur, trackers configurables, cockpit de gouvernance, studio de rapports, API, application terrain) existe et fonctionne dans les tests. Quatre familles de problèmes empêchent toutefois une mise en service sereine :

1. **Sécurité — une faille critique et quatre élevées** doivent être fermées avant toute exposition supplémentaire : la clé d'API du tableau de bord est injectée dans des pages HTML servies sans session ; plusieurs routes `/api` n'exigent que cette clé ; le serveur Node écoute sur toutes les interfaces ; la liaison de compte SSO se fait sur un e-mail modifiable ; la signature des paquets de mise à jour ne s'exécute jamais en CI.
2. **Adoption — rien n'a encore été validé par un utilisateur réel.** Aucun test d'utilisabilité n'a été conduit, aucun pilote terrain, aucune décision de comité n'est enregistrée dans le document 08. Les cinq modules livrés aux étapes 6 à 10 sont en anglais seulement, pour des sites francophones.
3. **Cohérence des chiffres — trop de vérités.** Trois à quatre scores de site cohabitent (modèle `sbDims` 70/45, `composite` 75/55, scoreboard opérationnel, tracker 90 % gelé contre 100 % en production), au moins sept politiques RAG différentes, et les pages héritées n'utilisent pas le registre des 46 métriques. Un directeur de site ne peut pas savoir pourquoi il est « rouge ».
4. **Gouvernance et conformité — la traçabilité a des trous.** Création, modification et suppression d'utilisateurs ne sont pas journalisées ; une même personne peut rédiger, relire et publier un rapport ; aucun registre des traitements (UK GDPR), aucune analyse d'impact pour l'envoi de données vers une IA cloud ; la restauration de sauvegarde n'a jamais été répétée.

**Ce qui est bien fait** (et qu'il faut protéger) : le périmètre par site via `services/userSites.js`, les secrets chiffrés et jamais renvoyés au navigateur, le PKCE SSO, le limiteur de connexion persistant, les jetons de partage stockés hachés, l'exécution obligatoire des tests PostgreSQL en CI, les garde-fous numériques sur le commentaire IA, le compte-rendu de réunion gelé à la clôture, la file d'attente idempotente de l'application terrain.

**Recommandation du PO : trois vagues sur douze semaines**, détaillées en §7 — (V1) fermer la sécurité et choisir un seul score, deux semaines ; (V2) franciser, tester avec des utilisateurs, piloter sur deux sites, six semaines ; (V3) gouvernance, conformité et consolidation technique, quatre semaines. Les bénéfices attendus sont chiffrés prudemment en §8 : l'essentiel est du **temps rendu aux coordinateurs** (ordre de grandeur 1 à 2 jours par mois et par site), des **décisions prises sur un chiffre unique**, et la **réduction d'un risque de fuite de données aujourd'hui réel**.

# 2. Composition du comité et méthode

Seize regards indépendants ont examiné le dépôt en lecture seule, chacun avec un angle et une grille de notation de 1 à 5. Chaque constat ci-dessous cite le fichier et, quand c'est possible, la ligne. Le Product Owner a ensuite **recoupé les constats contestables directement dans le code** avant de les retenir (voir §2.2).

| # | Regard | Angle principal |
|---|---|---|
| 1 | Métier / produit | Couverture des cas d'usage, valeur, doublons, prérequis humains |
| 2 | Sécurité & RBAC | Authentification, autorisation, secrets, entrées, journal |
| 3 | Architecture | Modularité, modèle de données, tests, exploitabilité, front |
| 4 | Données & KPI | Rigueur des formules, fraîcheur, cohérence, identité des sites |
| 5 | UX, accessibilité, adoption | Architecture d'information, bilinguisme, a11y, terrain |
| 6 | Exploitation & résilience | Déploiement, observabilité, sauvegardes, runbooks, CI |
| 7 | Design | Jetons, réutilisation, hiérarchie visuelle, marque |
| 8 | Ergonomie | Efficacité, prévention des erreurs, retour d'information, apprentissage |
| 9 | Technicien IT | Utilité quotidienne, rapidité, confiance, langue |
| 10 | Responsable IT de site | Clarté, effort, équité, actionnabilité |
| 11 | Group IT | Aide à la décision, source unique, alignement, temps gagné |
| 12 | Encadrement de site (non IT) | Pertinence, clarté, participation, confiance |
| 13 | Employé « simple » | Valeur, transparence, vie privée |
| 14 | Auditeur interne | Traçabilité, séparation des tâches, intégrité des chiffres, contrôle des changements |
| 15 | Expert sécurité (STRIDE) | Modèle de menace, intégrations, chaîne d'approvisionnement, SDLC |
| 16 | Expert GRC | ITSM, risque, protection des données, gouvernance, continuité |

## 2.1 Tableau des scores (1 = faible, 5 = excellent)

| Regard | Critères notés | Moyenne |
|---|---|---|
| Métier / produit | couverture 4 · clarté de la valeur 3 · adoption 2 · doublons 2 | **2,8** |
| Sécurité & RBAC | authn 2 · authz 3 · secrets 3 · entrées 3 · journal 4 | **3,0** |
| Architecture | modularité 2,5 · modèle de données 2 · tests 3,5 · exploitabilité 3 · front 1,5 | **2,5** |
| Données & KPI | rigueur 3,5 · fraîcheur 2 · cohérence 2 · identité des sites 2,5 | **2,5** |
| UX / a11y / adoption | IA 2 · bilinguisme 1,5 · cohérence 2,5 · a11y 2,5 · terrain 3 | **2,3** |
| Exploitation | déploiement 3 · observabilité 2 · résilience 2 · runbooks 3 · CI 3,5 | **2,7** |
| Design | jetons 3 · réutilisation 2 · hiérarchie 2,5 · marque 3,5 | **2,8** |
| Ergonomie | efficacité 3 · prévention 2,5 · retour 3,5 · apprentissage 2,5 | **2,9** |
| Technicien IT | utilité 2 · rapidité 3 · confiance 3 · langue 1 | **2,3** |
| Responsable IT site | clarté 2 · effort 3 · équité 3 · actionnabilité 3 | **2,8** |
| Group IT | décision 3 · source unique 2,5 · alignement 3 · temps gagné 3,5 | **3,0** |
| Encadrement de site | pertinence 3 · clarté 3,5 · participation 1,5 · confiance 2,5 | **2,6** |
| Employé | valeur 2 · transparence 3 · vie privée 3,5 | **2,8** |
| Auditeur interne | traçabilité 3 · séparation des tâches 2 · intégrité 2,5 · changements 3 | **2,6** |
| Expert sécurité | crypto 3,5 · intégrations 2,5 · injection 3,5 · chaîne d'appro 2 · SDLC 3 | **2,9** |
| Expert GRC | ITSM 3 · risque 2 · données perso 2 · gouvernance 3 · continuité 2,5 | **2,5** |
| **Moyenne générale** | | **2,7 / 5** |

Lecture : une plateforme **au-dessus de la moyenne sur la couverture fonctionnelle et la rigueur des tests**, **en dessous sur tout ce qui touche l'humain** (langue, adoption, participation) et **sur la cohérence des chiffres**. C'est le profil classique d'un produit construit vite et bien par une seule main, sans encore avoir rencontré ses utilisateurs.

## 2.2 Vérifications faites par le PO sur les constats sensibles

| Constat du relecteur | Vérification dans le code | Retenu ? |
|---|---|---|
| Clé d'API injectée dans le HTML sans session | `server.js` ~1307 : `sendHtmlPage` écrit `window.__ak='<clé>'` quand `injectApiKey` est vrai ; le commentaire ~1060 confirme que la redirection serveur vers la connexion a été retirée. Routes gardées par la seule clé : `/api/health/views` (628), `/api/orgs` (3748), `/api/workspaces` (3783), `/api/risk-register-export` (3961). | **Oui — critique** |
| Jetons de partage « porteurs » stockés en clair | `services/engagementStore.js` : colonne `token_hash`, SHA-256. Le jeton n'est en clair que dans l'URL. | **Non** (ramené à « jeton dans l'URL », moyen) |
| Dérive de documentation sur les sauvegardes | `services/backup.js` écrit `.sql` ; `docs/ops/EXPLOITATION.md:34` annonce `.sql.gz` et 03:00 ; `services/sync/jobs.js` planifie `db.backup` à 02:00. | **Oui** |
| Pages des étapes 6–10 en anglais seul | `public/dashboards.html`, `public/field/index.html` : 0 attribut `data-lng`, `lang="en"`. | **Oui** |
| Signature de release jamais exécutée | `.github/workflows/release.yml` : `if: ${{ env.PFX != '' }}` évalué avant que `env.PFX` soit défini dans la même étape → toujours ignoré. | **Oui — élevé** |

# 3. Constats transverses, du plus grave au moins grave

Chaque ligne porte un identifiant (C = critique, E = élevé, M = moyen, F = faible) repris dans la feuille de route du §7.

## 3.1 Critique (à corriger avant toute ouverture supplémentaire)

| ID | Constat | Preuve | Pourquoi c'est critique |
|---|---|---|---|
| **C1** | La clé d'API du tableau de bord (`DASH_API_KEY`) est injectée dans des pages HTML servies **sans vérifier la session**, et plusieurs routes `/api` acceptent cette clé seule. Toute personne qui atteint l'URL de la page lit la clé et accède aux données. | `server.js` ~1060, ~1307, 628, 3748, 3783, 3961 ; porte `/api/` ~1068–1089 | Contournement complet de l'authentification et du périmètre par site pour les routes concernées. |
| **C2** | Une clé de secours faible est utilisée quand `DASHBOARD_API_KEY` n'est pas défini. | `server.js:43-46` | Une installation incomplète est exploitable par défaut. |

## 3.2 Élevé

| ID | Constat | Preuve |
|---|---|---|
| **E1** | **Signature des paquets jamais exécutée** ; le manifeste de mise à jour n'est qu'un hachage SHA-256 non signé ; le mot de passe du certificat est écrit dans `GITHUB_ENV`. | `.github/workflows/release.yml`, `services/updatePackage.js:56-67`, `SIGNING.txt` « signed: NO » |
| **E2** | **Liaison de compte SSO par e-mail modifiable** : si l'`oid` est inconnu, on apparie sur `lower(email)` (issu de `email || preferred_username || upn`) et on **ré-estampille** `entra_oid`, y compris sur un compte déjà lié ou sur le compte de secours. | `reports-db.js:1897-1902`, `ssoEntra.js:148`, `server.js` ~5966 |
| **E3** | **Node écoute sur `0.0.0.0`** (contournable sans IIS/TLS), l'origine `http://10.225.99.173:<port>` reste dans la liste CORS, et le drapeau `secure` du cookie fait confiance à `x-forwarded-proto` envoyé par le client. | `server.js:101`, ~940, 5868, 5991 |
| **E4** | **TLS OpManager désactivé par défaut** et clé d'API dans la chaîne de requête (journaux proxy). | `services/reportConfig.js:86`, `services/opmanagerClient.js:13/28/36` |
| **E5** | **Jeton de session en `localStorage`** + CSP `script-src 'unsafe-inline'` : une seule faille XSS vole la session. | `public/auth.js`, en-têtes CSP `server.js` |
| **E6** | **Création / modification / suppression d'utilisateurs non journalisées** (rôles, mot de passe, désactivation) ; `demote-coordinators.js` n'écrit rien dans `system_log`. | `server.js:6105-6160` |
| **E7** | **Aucune validation utilisateur** : test d'utilisabilité jamais exécuté (script seul), pilote terrain non lancé, §10.1/§10.2 du document 08 vides, décisions de comité non enregistrées. | `docs/sdp360/design/ETAPE-06-test-utilisabilite.md`, `ETAPE-10-script-pilote.md`, doc 08 §10 |
| **E8** | **Modules 6 à 10 en anglais seulement** pour des sites francophones ; le technicien de terrain note la langue 1/5. | `public/dashboards.html`, `public/field/*`, `public/trackers*.html`, `public/governance*.html`, `public/report-studio*.html` |
| **E9** | **Plusieurs vérités pour un même site** : `sbDims` (70/45), `composite` (75/55), scoreboard 40/20/20/20 (75/55), tracker 90 % sur `main` contre 100 % en production ; ≥ 7 politiques RAG ; seuils d'alerte désalignés (SLA < 80 contre politique 90/70) ; `executive.html` porte 38 seuils en dur hors registre. | `services/siteScore.js`, `siteComposite.js`, `siteScoreboard.js`, `kpiRag.js`, `public/executive.html`, `metricRegistry.js` |
| **E10** | **Données personnelles publiées sans authentification** : `exec-view.html` expose sujets bruts de tickets et textes libres RCA/CA ; `06-COMPARATIF-EXECUTIF.md:166` affirme « PII retirées à l'ingestion » alors que demandeur et sujet sont stockés. Aucun registre des traitements, aucune base légale, aucune AIPD malgré UK GDPR (siège Londres) ; transfert vers une IA cloud non évalué. | `services/execSummary.js`, `aiCommentary.js:16-26` |
| **E11** | **Restauration jamais répétée** ; réplica documenté seulement ; sauvegardes sur le même hôte, non chiffrées, vérifiées par taille uniquement ; rollback = code seul. | `docs/ops/REPLICA-RESTORE.md`, `services/backup.js`, `ETAPE-04-securite.md:33` |

## 3.3 Moyen

| ID | Constat | Preuve |
|---|---|---|
| **M1** | Séparation des tâches absente : rien n'empêche `reviewed_by = created_by` dans le studio de rapports ; un rapport hebdo soumis peut être remis en brouillon par le même éditeur ; `reassign-week` autorisé sur un rapport soumis. | `routes/reportStudio.js:91-97`, `server.js:7140-7170` |
| **M2** | Chiffres publiés qui peuvent dériver : seuls les compteurs du parc sont gelés ; les autres KPI du rapport soumis sont recalculés à la volée ; aucun hachage ; `as_of` = heure de la requête, pas fraîcheur de la source. | `server.js:7154`, `services/reportStore.js`, `metricRegistry.js` |
| **M3** | Journal d'audit sans avant/après, écrit en « fire-and-forget » avec erreurs avalées, non infalsifiable ; changements de configuration et de seuils non journalisés. | `reports-db.js` ~8277–8297, `006_system_log.sql` |
| **M4** | Webhooks (Teams, engagement, publication) et `opmanager_base_url` postés tels quels : risque SSRF/exfiltration par un administrateur de configuration. | `services/engagementJobs.js:49-50, 96, 121` |
| **M5** | Application terrain : les refus (400/403/409) **suppriment** le travail de l'utilisateur ; le cache du service worker est par URL et survit à la déconnexion (téléphone partagé) ; clôture d'action en un geste sans annulation. | `public/field/app.js` (`obDel`), `public/field/sw.js:22` |
| **M6** | Téléversement terrain : `owner_id` non contrôlé contre les sites de l'utilisateur ; pas de quota par utilisateur ; limites de corps très larges (100 Mo). | `routes/field.js`, `server.js` parseurs |
| **M7** | Clé d'API acceptée en paramètre d'URL (`?api_key=`), base `@odata.context` construite depuis l'en-tête `Host`. | `routes/extApi.js:29, 54` |
| **M8** | Liens de partage : un partage de tableau de bord créé par un administrateur rend **tous les sites** ; jeton dans le chemin (journaux IIS, `Referer`) ; pas de `Referrer-Policy` ; échappement du HTML du rapport non confirmé. | `routes/engagement.js:84-100` |
| **M9** | Fuite de messages d'erreur internes : ~268 `e.message` renvoyés au client. | `server.js` (642, 1194…), `routes/extApi.js` |
| **M10** | Hygiène cryptographique : sel scrypt fixe, clé v1 `sha256` acceptée sans fin de vie, pas d'AAD liant la boîte au nom de clé, clé dans `.env` à côté de la base. | `services/configSecrets.js:32, 44, 77` |
| **M11** | Rendu PDF : Chromium `--no-sandbox` sur du HTML influençable, chemins temporaires prévisibles. | `services/reportRender.js:31-35` |
| **M12** | Architecture : fichiers « dieu » (`server.js` 8 259 lignes, `reports-db.js` 8 468), deux sources de DDL (sqlite dans `*-db.js` contre migrations pg), forks manuels sqlite/pg, JSON dans TEXT, cartes d'identité des sites dupliquées (`scoreboardAliases`, `_codeFromName`, `rr_site_aliases`), pages HTML de 11 000 lignes avec script inline, deux moteurs de score tracker. | `server.js`, `reports-db.js`, `public/executive.html` |
| **M13** | Doublons fonctionnels : 3 à 4 surfaces « direction », tracker livré deux fois (legacy + constructeur), reporting trois fois (hebdo, studio, decks PPTX), 13 enfants dans le menu Operations dont deux « Trackers ». | `public/_shell.js`, doc 08 §10.2 |
| **M14** | Exploitation : documentation de déploiement contradictoire (ZIP/marqueur de `CLAUDE.md` contre Manager 2.0 d'`EXPLOITATION.md`), lots gelés non tranchés, `/health` superficiel, alertes émises depuis le processus surveillé, pas de rotation de journaux ni de métriques, tas de 4 Go qui masque la fuite `_rawCache`. | `CLAUDE.md`, `docs/ops/EXPLOITATION.md`, `services/sync/jobs.js` |
| **M15** | Chaîne d'approvisionnement : versions `^` non épinglées, `xlsx` tiré d'un tarball CDN hors `npm audit`, actions GitHub épinglées par tag, pas de SBOM, pas de scan de secrets, pas de Dependabot. | `package.json`, `.github/workflows/*` |
| **M16** | Ergonomie : rapport hebdo à 5 onglets et ~269 contrôles, autosauvegarde silencieuse, PV de réunion sans autosauvegarde, triple saisie des actions (réunion, inspection, rapport), validation uniquement à la soumission, suppressions irréversibles, `prompt()/confirm()` natifs. | `public/reports.html`, `public/meeting.html` |
| **M17** | Design : couleurs RAG en dur hors palette (`#E87722` contre `#EF631A`), pas d'échelle typographique en jetons, styles par page, contraste insuffisant sur les pastilles ambre/vert, RAG transmis par la couleur seule. | `public/brand/components.css`, `public/field/styles.css` |
| **M18** | Gouvernance des données : registre des métriques sans version, propriétaire ni historique ; `KpiRag.aggregate([])` renvoie 0 au lieu de « non mesuré » ; export du registre des risques non traçable (compteurs sans identifiants, classifieur non versionné). | `services/metricRegistry.js`, `services/kpiRag.js`, `risk-register-export.js` |
| **M19** | Minimisation IA : seuls les noms de sites et le champ `owner` sont anonymisés ; les textes libres partent tels quels ; la sortie IA est rendue en HTML sans échappement confirmé. | `services/aiCommentary.js:16-64` |
| **M20** | Suppressions physiques en cascade dans la gouvernance (supprimer une cadence efface sessions, actions et comptes-rendus) ; suppression de rapport hebdo = suppression physique. | `db/postgres/reports/018_governance.sql` |

## 3.4 Faible

| ID | Constat |
|---|---|
| **F1** | Exemption du préfixe `/reports/` dans la porte globale : chaque route doit se garder elle-même. |
| **F2** | SMTP sans `requireTLS` quand il n'y a pas d'authentification, pas de `tls.minVersion`. |
| **F3** | `--test-force-exit` peut masquer des fuites de ressources ; `CLAUDE.md` est un journal chronologique de 3 000 lignes plutôt qu'un index. |
| **F4** | Regex de locataire SSO mal ancrée (`/^common|organizations|consumers$/`), fermée par le contrôle exact d'`iss` aujourd'hui. |
| **F5** | Jetons de dépassement de groupes Entra (`_claim_names`) non gérés : l'approvisionnement ne fait rien en silence. |
| **F6** | Les exports de journaux ne sont pas eux-mêmes journalisés ; `audit_log` et `share_views` sans politique de rétention. |

# 4. Cas d'usage : couverts, partiels, manquants

## 4.1 Couverts par le code (avec réserve d'adoption)

| Cas d'usage | Étape | Où | Réserve |
|---|---|---|---|
| Synchroniser SDP, Analytics, Meraki, OpManager, Assets avec supervision et reprise | 1 | `services/sync/*`, `routes/sync.js` | Fraîcheur de la source non exposée (`as_of` = heure de la requête) |
| Une seule base PostgreSQL, migrations versionnées, sauvegarde quotidienne | 2 | `db/migrate.js`, `services/backup.js` | Restauration jamais répétée, format `.sql` contre `.sql.gz` documenté |
| Dictionnaire de 46 KPI, politiques RAG, registre des sites | 3 | `services/metricRegistry.js`, `kpiRag.js` | Pages héritées non branchées dessus |
| SSO Entra avec PKCE, MFA côté Entra, limiteur de connexion, secrets chiffrés | 4 | `services/ssoEntra.js`, `configSecrets.js` | Liaison par e-mail (E2), prérequis Entra non faits |
| Installateur Inno + Manager, paquets versionnés, rollback de code | 5 | `tools/installer/*`, `services/updatePackage.js` | Signature inopérante (E1) |
| Composeur de tableaux de bord, espace direction, design system | 6 | `public/dashboards.html`, `services/dashboardStore.js` | Anglais seul, aucun test d'utilisabilité |
| Trackers configurables, grille de saisie, mois clôturés | 7 | `public/trackers*.html`, `services/trackerStore.js` | Coexiste avec le tracker legacy (deux moteurs) |
| Cockpit de réunion, registre des décisions, portefeuille, RFI, comptes-rendus gelés | 8 | `routes/governance.js`, `services/governanceStore.js` | Décisions non reliées aux résultats, suppressions en cascade |
| Studio de rapports, analyse déterministe, commentaire IA vérifié, alertes, liens de partage, API REST/OData | 9 | `routes/reportStudio.js`, `extApi.js`, `engagement.js` | Pas de séparation rédacteur/relecteur, partage tous-sites |
| Application terrain hors-ligne, file idempotente, photos fragmentées | 10 | `public/field/*`, `routes/field.js` | Refus destructifs, anglais, pas de file de tickets |

## 4.2 Partiellement couverts

- **Gestion des actions** : trois registres distincts (réunions, inspections, rapport hebdo) agrégés en lecture dans le hub « Site Actions », mais **saisis trois fois** et sans vue « mes actions » pour un technicien.
- **Suivi d'un ticket par un employé** : seule la vue publique `exec-view` existe ; pas de suivi de ticket, pas de tableau des SLA, pas de calendrier de maintenance, pas de contacts.
- **Participation de l'encadrement non IT** : la « signature » du PV est apposée par l'IT sans signataire ni hachage du contenu ; aucun espace département ; Engagement #4 (boucle de retour) reste à « — ».
- **Pilotage Group IT** : pas de budget réalisé/prévu, pas de registre fournisseurs/contrats, pas de posture risque/cyber/PRA, pas de capacité/effectifs ; le Roadmap Manager reste un outil personnel.
- **Équité entre sites** : aucun score n'est normalisé par la taille du site ou du parc (le seuil `MIN_RANKED_ASSETS` est la seule exception).

## 4.3 Manquants

- Registre des traitements, base légale, AIPD, procédure de notification de violation, étiquettes de classification, recertification périodique des accès.
- Registre des risques IT / SMSI, BIA, preuve de PRA, registre fournisseurs.
- Gestion des problèmes et de la connaissance (le « changement » n'est qu'un miroir de SDP).
- Tableau de bord d'adoption (qui ouvre quoi, quand) ; seuls `assets_viewed`/`asset_export` existent.
- Plan de formation et de conduite du changement ; modèle de rapport financier (étape « Finance Manager » jamais spécifiée).
- Réconciliation automatique et périodique avec Zoho (aujourd'hui manuelle, `FORMULA_RECONCILIATION.md`).

# 5. Ce que les utilisateurs diraient (synthèse des regards « personas »)

| Persona | Ce qu'il apprécierait | Ce qui le ferait décrocher |
|---|---|---|
| **Technicien de terrain** | Travailler hors-ligne, photos, actions rapides | Tout en anglais ; un refus efface sa saisie ; pas sa file de tickets ni ses SLA ; pas de recherche d'actif par QR ; création de ticket désactivée |
| **Responsable IT de site** | Hub des actions, rapport hebdo auto-rempli depuis Meraki/OpManager | Trois scores différents sans explication ; triple saisie ; pas de charge par technicien ; objectif « 20 minutes » jamais mesuré |
| **Group IT** | Registre des décisions, portefeuille, API pour Power BI | Pas de budget, pas de fournisseurs, pas de posture risque ; scores non comparables entre sites ; décisions sans suivi des effets |
| **Encadrement de site (non IT)** | Un PV par réunion, escalades vers le Council | Ne peut ni lever ni suivre une escalade ; signature sans valeur probante ; aucun avis de panne ou de changement ; pages en anglais |
| **Employé** | Une page publique « l'IT va bien » | Rien sur son ticket ; des sujets de tickets et des textes d'analyse publiés sans connexion |
| **Auditeur** | Journal central, matrice d'autorisation générée, compte-rendu gelé | Comptes non journalisés ; une personne fait tout ; chiffres qui dérivent ; exports non tracés |

# 6. Ce qui manque et ce qui peut être amélioré — par domaine

## 6.1 Sécurité (sans régression fonctionnelle)

1. Exiger une session valide avant d'injecter `window.__ak` ; faire basculer les quatre routes « clé seule » sur `requireReportSession` ; refuser le démarrage en production sans `DASHBOARD_API_KEY` (C1, C2).
2. `BIND_HOST=127.0.0.1` par défaut, retirer l'origine IP de CORS, cookie `secure` sur `req.secure` seulement, règle de pare-feu (E3).
3. SSO : apparier par `oid` seul quand il existe ; repli e-mail uniquement si `entra_oid IS NULL`, jamais sur `preferred_username`, jamais sur le compte de secours ni les super_admin (E2).
4. Corriger la condition de signature dans `release.yml`, passer le mot de passe par `env`, signer `manifest.json` et vérifier la signature dans le Manager (E1).
5. Cookie `httpOnly` pour la session au lieu de `localStorage` ; retirer `'unsafe-inline'` page par page en commençant par les pages publiques et de partage (E5).
6. TLS OpManager activé par défaut, clé hors de l'URL, redaction dans les erreurs (E4) ; liste blanche d'hôtes et blocage des adresses privées pour tous les webhooks (M4).
7. Gestionnaire d'erreurs central renvoyant un identifiant de corrélation (M9) ; `Referrer-Policy: no-referrer` et `site_id` obligatoire sur les partages (M8) ; retirer `?api_key=` et construire les liens OData depuis `public_base_url` (M7).

## 6.2 Un seul chiffre par site

1. **Décision du comité requise** : désigner le score de site de référence (recommandation PO : le scoreboard opérationnel 4 dimensions, qui est le seul porté par le registre et renormalisé sur les dimensions présentes), et reléguer `sbDims`/`composite` à l'IT Review avec mention « modèle de l'auteur ».
2. Faire lire `executive.html`, `index.html` et les decks PPTX dans `metricRegistry` + `kpiRag` ; supprimer les 38 seuils en dur.
3. Aligner les seuils d'alerte sur la politique RAG du registre ; versionner le registre (propriétaire, date, historique).
4. Trancher le gel tracker (90 % contre 100 %) à la fin du cycle, en une fois, et le déployer.
5. Exposer la fraîcheur réelle de chaque source (`last_success_at` des jobs) sur chaque tuile.

## 6.3 Adoption et langue

1. Franciser les cinq modules 6–10 avec le mécanisme `data-lng` déjà en place ; français par défaut sur les sites, anglais pour le groupe.
2. Exécuter le test d'utilisabilité existant (script SUS, étape 6) avec 5 coordinateurs ; exécuter le pilote terrain sur deux sites (script étape 10).
3. Rapport hebdo : autosauvegarde visible, validation au fil de l'eau, une seule saisie d'action réutilisée par les trois registres.
4. Application terrain : ne jamais supprimer une saisie refusée (la garder en « à corriger »), vider le cache à la déconnexion, ajouter « mes actions » et une recherche d'actif par QR.
5. Menu : fusionner les deux entrées « Trackers », regrouper les 13 enfants d'Operations en 4 ou 5 blocs.

## 6.4 Gouvernance, audit, conformité

1. Journaliser `user_created/updated/deleted`, `password_reset`, `config_saved`, `metric_changed` avec avant/après (E6, M3).
2. Imposer relecteur ≠ rédacteur dans le studio ; exiger une seconde personne pour remettre en brouillon un rapport soumis ; interdire `reassign-week` après soumission (M1).
3. Geler et hacher l'ensemble des chiffres d'un rapport à la soumission ; afficher la dérive éventuelle (M2).
4. Rôle `auditor` en lecture seule, distinct de `super_admin` ; export des décisions, RFI, comptes-rendus et `audit_log` ; journaliser les exports.
5. Rédiger le registre des traitements, la base légale et l'AIPD (IA cloud incluse) ; retirer des pages publiques les sujets de tickets et textes libres ; corriger l'affirmation du document 06 ; politique de rétention pour `request_records`, `share_views`, `api_calls`.
6. Suppressions logiques (tombstone) pour rapports, cadences, sessions, décisions (M20).
7. Revue d'accès mensuelle planifiée (`audit-roles.js` avec sortie archivée et visa).

## 6.5 Exploitation et consolidation technique

1. Répéter une restauration complète sur l'instance TEST et la dater ; chiffrer les sauvegardes et les copier hors hôte ; aligner code et documentation (`.sql.gz`, 03:00) (E11).
2. Une seule procédure de déploiement documentée (Manager 2.0) ; archiver le modèle ZIP/marqueur de `CLAUDE.md` ; trancher les lots gelés.
3. `/health` profond (base, dernier job, espace disque) + `/ready` sans authentification ; alertes depuis une tâche planifiée externe ; rotation de journaux ; `ecosystem.config`.
4. Épingler les dépendances, remplacer le tarball `xlsx`, épingler les actions par SHA, ajouter SBOM, scan de secrets et Dependabot (M15).
5. Découper `server.js` et `reports-db.js` route par route (le patron `routes/inspection.js` existe) ; une seule source de DDL ; une seule carte d'identité des sites.
6. Transformer `CLAUDE.md` en index + état courant + pièges, et déplacer le journal chronologique dans `docs/`.

# 7. Feuille de route recommandée — trois vagues, douze semaines

| Vague | Semaines | Contenu | IDs traités | Critère de sortie |
|---|---|---|---|---|
| **V1 — Fermer et trancher** | 1–2 | Correctifs sécurité C1, C2, E1–E5 ; décision du comité sur le score unique et le gel tracker ; journalisation des comptes (E6) ; restauration répétée une fois (E11) | C1 C2 E1 E2 E3 E4 E5 E6 E9 E11 M4 M7 M9 | Test de pénétration gris passé sans critique ni élevé ; une seule définition de « site rouge » écrite dans le registre |
| **V2 — Rencontrer les utilisateurs** | 3–8 | Francisation des modules 6–10 ; test d'utilisabilité (5 coordinateurs) ; pilote terrain 2 sites ; corrections ergonomie du rapport hebdo et de l'app terrain ; menu simplifié ; retrait des données personnelles des pages publiques ; branchement des pages héritées sur le registre | E7 E8 E10 M5 M6 M13 M16 M17 | SUS ≥ 70 ; temps de saisie du rapport hebdo mesuré ≤ 20 min ; pilote clos avec clinique ; 0 texte libre sur les pages publiques |
| **V3 — Gouverner et consolider** | 9–12 | Séparation des tâches, gel/hachage des chiffres, rôle auditeur, exports ; registre des traitements + AIPD ; revue d'accès planifiée ; suppressions logiques ; déploiement unique, santé profonde, chaîne d'approvisionnement ; début du découpage de `server.js` | M1 M2 M3 M8 M10 M11 M12 M14 M15 M18 M19 M20 F1–F6 | Audit interne blanc sans constat majeur ; dossier GDPR complet ; `server.js` < 5 000 lignes |

**Ce que le PO ne recommande pas maintenant** : de nouvelles fonctionnalités (file de tickets dans l'app terrain, budget Group IT, espace département). Elles sont légitimes et listées en §4.3, mais chaque semaine passée à en ajouter avant V1 et V2 augmente la surface à sécuriser et à franciser. Elles forment la **V4** à planifier après le pilote.

## 7.1 Décisions à prendre par le comité (bloquantes)

| # | Décision | Recommandation PO | Échéance |
|---|---|---|---|
| D1 | Score de site de référence | Scoreboard opérationnel 4 dimensions ; `sbDims`/`composite` conservés en lecture dans l'IT Review avec étiquette | V1 |
| D2 | Gel tracker 90 % contre 100 % | Déployer 90 % à la clôture du cycle mensuel en cours, en une seule fois | V1 |
| D3 | Langue par défaut | Français sur les sites, anglais au groupe, bascule par utilisateur | V1 |
| D4 | Données personnelles sur les pages publiques | Retirer sujets et textes libres ; ne garder que les agrégats | V1 |
| D5 | Base légale et AIPD, y compris l'IA cloud | Rédiger avant toute réactivation de `AI_PROVIDER` cloud ; sinon rester en local | V2 |
| D6 | Doublons à retirer | Tracker legacy et decks PPTX hérités après migration ; 3 surfaces direction → 1 | V2 |
| D7 | Rôle `auditor` et séparation rédacteur/relecteur | Oui, obligatoire pour le studio et les rapports soumis | V3 |
| D8 | Propriétaires des données par domaine | Un nom par domaine (helpdesk, parc, réunions, inspections, tracker) inscrit dans le registre | V2 |

# 8. Bénéfices attendus

Les ordres de grandeur ci-dessous sont **prudents et conditionnels** : ils supposent V1 et V2 réalisées et seront **mesurés** par le test d'utilisabilité et le pilote, pas supposés. Quand le dépôt ne permet pas de chiffrer, le bénéfice est qualitatif.

| Bénéfice | Pour qui | Mesure | Ordre de grandeur attendu | Condition |
|---|---|---|---|---|
| **Temps de production du rapport hebdomadaire** | 25 coordinateurs | Minutes par rapport (cible 20 min, aujourd'hui non mesurée) | Si l'auto-remplissage Meraki/OpManager et l'import d'actions tiennent leur promesse : de l'ordre de **1 à 2 heures par semaine et par site** rendues, soit 1 à 2 jours par mois et par site | V2 (ergonomie + mesure) |
| **Fin de la triple saisie des actions** | Coordinateurs, techniciens | Nombre d'actions saisies dans plus d'un registre | Division par 2 à 3 du volume de saisie d'actions | V2 |
| **Une décision sur un seul chiffre** | Direction, Group IT, sites | Nombre de scores de site affichés (aujourd'hui 3–4) | 1 score, 1 politique RAG, seuils d'alerte alignés ; disparition des contestations « pourquoi suis-je rouge » | V1 (D1) |
| **Réduction du risque de fuite** | Entreprise | Constats critiques/élevés du test de pénétration | De 2 critiques + 11 élevés à 0 critique, 0 élevé | V1 |
| **Confiance des auditeurs** | Audit interne, direction | Constats majeurs d'un audit blanc | Journal complet des comptes et configurations, séparation des tâches, chiffres gelés et hachés | V3 |
| **Conformité UK GDPR** | Entreprise | Registre, AIPD, rétention | Dossier existant au lieu d'une affirmation fausse dans la documentation | V2–V3 |
| **Reprise après sinistre** | Exploitation | RPO/RTO démontrés | RPO 15 min (réplica) et restauration répétée, datée, au lieu d'un document | V1 (répétition) + V3 |
| **Adoption sur les sites francophones** | Techniciens, encadrement | SUS, taux d'ouverture hebdomadaire par rôle | De « inutilisable sans anglais » à SUS ≥ 70 ; tableau d'adoption en place | V2 |
| **Coût de maintenance** | Équipe de développement | Lignes de `server.js`, temps de correction d'un bug transverse | Découpage progressif ; une seule source de DDL ; moins de régressions sqlite-vert / pg-rouge | V3 |
| **Valeur pour le groupe** | Group IT | Décisions reliées à un résultat mesuré | Registre des décisions branché sur les KPI ; chaque décision porte sa métrique de succès | V3 puis V4 |

## 8.1 Risques si rien n'est fait

- **Exposition réelle aujourd'hui** : toute personne qui atteint une page injectée lit la clé d'API (C1). Avec le serveur sur `0.0.0.0` (E3), cela ne nécessite pas de passer par IIS.
- **Perte de confiance dès la première réunion** : trois scores différents pour un même site, en anglais, devant des directeurs de site francophones.
- **Non-conformité documentée** : un document de direction affirme que les données personnelles sont retirées alors qu'elles sont stockées et partiellement publiées.
- **Dette qui se referme** : chaque nouveau module ajouté sur `server.js` à 8 259 lignes et deux sources de DDL coûte plus cher que le précédent.
- **Travail terrain perdu** : un technicien dont la saisie est refusée la perd aujourd'hui (M5) ; c'est le genre d'incident qui tue un pilote en une semaine.

# 9. Annexe A — Forces à préserver (consensus des 16 regards)

- Périmètre par site centralisé (`services/userSites.js`, garde central de lecture `_REPORT_ID_READ`), jamais `user.site_id === x` dans le code récent.
- Secrets en écriture seule, chiffrés AES-256-GCM, jamais renvoyés au navigateur, outil de rotation.
- SSO Entra : PKCE S256, `state`, `nonce`, RS256 seul, contrôles `iss/aud/exp/nbf`.
- Limiteur de connexion persistant, comparaison à temps constant, jetons de partage et clés d'API stockés hachés.
- CI : tests PostgreSQL obligatoires, migration, `build:check`, `npm audit`, CodeQL ; 2 592 tests à 0 échec.
- Garde-fous numériques sur le commentaire IA (vérification contre une liste canonique), anonymisation des sites.
- Compte-rendu de réunion gelé à la clôture ; compteurs du parc gelés à la première soumission ; signatures horodatées côté serveur.
- File d'attente idempotente de l'application terrain (`PUT /api/field/outbox/:uuid`) et photos fragmentées.
- Dossiers de conception par étape, scripts de test d'utilisabilité et de pilote déjà écrits (il ne reste qu'à les exécuter).

# 10. Annexe B — Méthode et limites de ce rapport

- Seize relecteurs indépendants, lecture seule, chacun citant fichiers et lignes ; le PO a recoupé dans le code les constats contestables (§2.2) et a **écarté** un constat (jetons de partage « en clair »).
- Les notes sont des jugements d'expert sur le code et la documentation, **pas** des mesures d'usage : aucun utilisateur n'a encore été observé. C'est précisément la première chose que la V2 doit corriger.
- Les bénéfices du §8 sont des ordres de grandeur conditionnels ; ils doivent être remplacés par les mesures du test d'utilisabilité et du pilote.
- Non couvert : test de pénétration réel, revue du code de l'installateur Windows en exécution, examen des données de production (le dépôt ne contient pas de copie de production).
