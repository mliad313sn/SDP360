# 07 — Étude d'évolution : de SDP-Dashboard v1.11 à la plateforme de pilotage de nouvelle génération, et prompt de développement piloté par le comité

*Document d'étude et de commande · 2026-10-19 · Base : relecture complète de `samaziz679/SDP-Dashboard` v1.11 (HEAD `e74d4cf`, 9 164 lignes de `server.js`, 282 routes, 37 écrans, 2 372 tests), de `mliad313sn/SDP360` 2.0.0-alpha.1 (commits `214c0d1`, `7400145`) et des documents 00 à 06 de ce dossier.*

> **À qui s'adresse ce document.** À la direction et au comité d'experts IT Ops, pour comprendre ce que la plateforme sait faire aujourd'hui et ce qui lui manque ; à l'équipe de développement et à l'assistant IA qui l'épaulera, à qui le chapitre 6 fournit le **prompt de commande** complet. Chaque étape de ce prompt est **conçue, validée puis réceptionnée par le comité** : l'IA propose, le comité décide, l'IA exécute, le comité réceptionne.

---

## 1. Objet et méthode

Ce document répond à trois questions :

1. **Que sait faire SDP-Dashboard aujourd'hui ?** — capacités réelles, module par module, avec leurs limites (chapitre 2).
2. **Que lui manque-t-il, et qu'est-ce que SDP360 a déjà corrigé — ou mal corrigé ?** — manques du produit d'origine (chapitre 3) et bilan sans complaisance de la première livraison SDP360 (chapitre 4).
3. **Comment l'amener au niveau supérieur ?** — la cible (chapitre 5), puis le **prompt de développement en dix étapes** (chapitre 6), chacune avec son périmètre, ses règles, sa conception à faire valider par le comité, ses critères de réception et les gains obtenus (chapitre 7).

Méthode : lecture intégrale du code, des schémas, des tests et du journal de conception de 6 166 lignes (`CLAUDE.md`) ; exécution de la suite de tests ; vérification de ce qui est réellement branché dans SDP360 (recherche des usages de chaque nouveau module). Les chiffres cités sont mesurés sur le dépôt, pas estimés.

---

## 2. Ce que SDP-Dashboard sait faire aujourd'hui (capacités actuelles)

### 2.1 Vue d'ensemble

SDP-Dashboard est une plateforme d'exploitation IT **en production** pour les sites miniers d'Afrique de l'Ouest : un serveur Node/Express unique derrière IIS, PostgreSQL 17 (avec SQLite résiduel), 12 modules, six moteurs d'export, et des intégrations Zoho (ServiceDesk Plus Cloud, Analytics Plus), OpManager, Meraki et Teams. Elle est utilisée par 29 comptes dont 25 coordinateurs de site.

### 2.2 Capacités par module

| Module | Ce qu'il fait réellement | Niveau de maturité |
|---|---|---|
| **Helpdesk (tickets, changements, CAB, CSAT)** | Miroir horaire des tickets SDP via Analytics Plus ; KPI ITSM (SLA de résolution et de 1ʳᵉ réponse avec dénominateurs ITSM documentés, taux de réouverture, FCR, MTTR), vieillissement du backlog, incidents majeurs avec champs RCA/CA/PIR/LL, taux de succès des changements, CSAT/NPS ; scorecard exécutive, vue SharePoint publique, vue « IT Review » fidèle au modèle de la direction (tests oracle) | Élevé |
| **Rapports hebdo / mensuels de site** | Éditeur à 5 onglets (infra, helpdesk, feux, actions, parc), auto-remplissage WAN/infra depuis les snapshots, cycle brouillon → prêt → soumis, auto-sauvegarde avec verrou PostgreSQL contre les doubles écritures, **suivi des actions avec lignée** (reconduction automatique, fusion des doublons, import inter-semaines, justification obligatoire des transferts), decks PPTX par site et consolidés, e-mail hebdo rejoué depuis l'instantané signé | Élevé — point fort unique |
| **Réunions départementales (PV)** | 11 référentiels bilingues, PV à 7 sections, sessions d'incubation à 8 sections, escalades Conseil par thème, 5 Engagements mesurés, import Excel en masse, pré-brief « depuis la dernière réunion », signatures horodatées par le serveur, journal d'audit par problème et par action | Élevé |
| **Inspections de site** | Formulaire de 17 catégories / 173 points, photos et signatures, dictée vocale, sauvegarde locale puis « Enregistrer » explicite, file d'attente hors-ligne rudimentaire, registre des actions correctives, PPTX unitaire et consolidé, export Excel | Moyen (lourd : 60 à 100 Mo par envoi) |
| **Registre des actions de site** | Agrégation en lecture des trois sources (réunions, inspections, rapports), âge et retard, fermeture en ligne, fusion inter-sources, badge projet Meridian, bloc Business Incubation, problèmes ouverts sans action | Élevé |
| **Tracker d'activité IT** | Un programme figé : 4 piliers × 31 activités × 11 sites, 6 types de KPI, scores pondérés avec redistribution, tableau de bord React, heatmap, roadmap Gantt, verrouillage des mois clos, PPTX 2 diapositives, export CSV de preuve | Moyen (non paramétrable) |
| **Parc informatique (assets)** | 6 vues AssetExplorer synchronisées chaque nuit, hygiène CMDB (8 types d'exception), finance en USD, licences, conformité logicielle, santé matérielle, prévision d'investissement avec bannière de couverture, réconciliation AD × Entra × Defender avec historique, score d'effort par site, rappels par e-mail | Élevé (encore en SQLite) |
| **Infra et WAN** | Disponibilité device OpManager (REST), qualité WAN Meraki par lien avec « % Time Up » calibré, sous-sites Exploration, **SLA WAN contractuel** (calendrier d'horaire de service, crédits ISP, notification ISP armable), dashboard WAN Health | Élevé |
| **Alertes SLA Teams** | Lecture directe de l'API SDP v3 toutes les 5 minutes, cartes adaptatives par groupe, anti-doublon à vie, seul job protégé contre le chevauchement | Élevé |
| **Roadmap Manager** | Outil personnel super_admin : 4 objectifs pondérés, livrables, preuves automatiques (CMDB, incidents, formations, catalogue) | Faible (mono-utilisateur) |
| **Registre des risques** | Export Excel mensuel des occurrences par site × 5 domaines, précédence du champ « Services affectés » déclaré par le technicien, commentaires de risque | Moyen |
| **Administration & sécurité** | 5 rôles hiérarchiques + rôles fonctionnels, périmètre multi-sites imposé par le serveur, SSO Entra (OIDC + PKCE) dormant, secrets chiffrés AES-256-GCM (optionnel), sessions actives, System Logs, sauvegardes planifiées, installateur autonome | Moyen |
| **Restitution** | 6 générateurs PPTX, deck exécutif Python, e-mails planifiés (hebdo, mensuel, scoreboard, hygiène, parc), Excel, cartes Teams, vue SharePoint, commentaire déterministe « Analyze Lite », IA cloud/locale **désactivée** | Élevé pour les exports, faible pour l'analyse |

### 2.3 Forces à préserver absolument

- **Richesse fonctionnelle** rare pour un outil interne et **culture de test** (fixtures « golden », tests de fidélité aux modèles de la direction, tests de non-régression des audits).
- **Règles métier déjà arbitrées** : dénominateurs ITSM, « le plus récent fait foi » sur les lignées d'actions, statuts de transfert justifiés, comptages figés côté serveur, horodatages signés par le serveur, « jamais une date inventée », « null ≠ zéro mesuré ».
- **Périmètre de site imposé côté serveur** (`services/userSites.js`) et secrets en écriture seule.
- **Artefacts de gouvernance** déjà existants (CR ITIL, checklist de bascule, audit AMDEC avec bibliothèque `/goal`, registre des sites).

---

## 3. Ce qui manque à SDP-Dashboard (lacunes constatées)

| # | Lacune | Preuve dans le dépôt | Conséquence opérationnelle |
|---|---|---|---|
| L1 | **Synchronisations fragiles** : téléchargement CSV intégral chaque heure, un seul rejeu (401), aucun verrou de chevauchement sur 4 jobs sur 5, garde anti-vide uniquement sur le parc, aucune gestion du code 429 Meraki | `zoho-sync.js:10`, `assets-sync.js:41-46`, `tools/meraki/*` | Un export tronqué peut **supprimer en masse** les tickets ; une panne reste invisible |
| L2 | **Échecs silencieux** : erreurs dans `sync_metadata.last_error` et la console PM2 seulement | aucun miroir dans `system_log` | Personne n'est prévenu, les rapports partent avec des données périmées (cas réel du 2026-09-23 : aucun envoi planifié n'avait tourné pendant six semaines) |
| L3 | **Cinq échelles RAG et deux modèles « 6 dimensions »** divergents, seuils dupliqués écran / PPTX, dates d'ancrage codées en dur (`2026-07-14`) | `engine.js`, `siteScore.js`, `siteComposite.js`, `deckGovernanceV2.js`, `tracker-pptx.js` | Un même site peut être vert, orange et rouge selon l'écran |
| L4 | **Trois vocabulaires de codes site** sans clé étrangère commune, alias accent-foldés en dur | `tracker-db.js`, `scoreboardAliases.js`, `site-registry.csv` (« À CONFIRMER ») | Jointures inter-modules par nom, « non applicable » silencieux |
| L5 | **Double back-end inachevé** : SQLite « octet pour octet » à côté de chaque fork PostgreSQL, parc encore en SQLite, 9 lecteurs à ordre non déterministe | `PG_CUTOVER_RUNBOOK.md` | Deux fois le code à maintenir, risques de divergence sqlite-vert / pg-rouge (documentés 8 fois) |
| L6 | **Monolithe** : `server.js` 9 164 lignes, `reports-db.js` 8 394, `reports.html` 8 553, React compilé **dans le navigateur** par Babel, aucune intégration continue | — | Chaque modification est risquée, aucune vérification automatique avant mise en production |
| L7 | **Tracker figé** : un seul programme, année de 12 mois, types de KPI en if/else, activités « réunions » et « inspections » saisies à la main alors que les modules les comptent déjà | `tracker-init.json`, `engine.js` | Impossible de créer un tracker de déploiement, de maintenance ou de projet sans développeur |
| L8 | **Aucune capacité terrain** : pas de PWA, pas de file d'attente hors-ligne robuste, envoi d'inspection jusqu'à 100 Mo en une requête, photos base64 dans la base | `inspection.html`, `server.js:739` | Inutilisable sur 3G/VSAT, pertes de saisie signalées par les sites |
| L9 | **Sécurité à durcir** : CSP avec `'unsafe-inline'`, limiteur de débit en mémoire, chiffrement des secrets **optionnel**, clé dérivée sans KDF, clé OpManager dans l'URL avec TLS non vérifié, comparaison de clé non constante, `xlsx@0.18.5` non maintenu, **aucune MFA** | `server.js:139`, `services/opmanagerClient.js`, `routes/meridian.js` | Exposition en cas de compromission du serveur ou d'un compte |
| L10 | **Dérive production / dépôt** : ZIP manuel, marqueur `.git/last-deployed`, « lots gelés » empaquetés à la main | `tools/deploy/frozen-lots.json` | Personne ne sait exactement ce qui tourne en production |
| L11 | **Connaissance verrouillée** dans un journal chronologique de 6 166 lignes mêlant FR et EN | `CLAUDE.md` | Dépendance à une personne ; règles contradictoires entre sections anciennes et récentes |
| L12 | **Pas de pilotage de réunion ni de portefeuille** : les réunions ops se préparent dans PowerPoint, la roadmap est un outil mono-utilisateur, les décisions ne sont pas tracées | — | Pas de boucle décision → action → preuve |
| L13 | **Pas d'analyse automatique** : IA cloud désactivée, fournisseur local prévu mais jamais déployé, « Analyze Lite » purement déterministe et limité aux KPI helpdesk | `AI_PROVIDER=off` | Les commentaires de rapport sont rédigés à la main |
| L14 | **Diffusion rigide** : destinataires par site dans un annuaire, pas d'abonnement, pas de notification in-app, pas de partage sécurisé par lien, pas d'accusé de lecture | `reportDirectory.js` | L'information n'atteint pas les bons acteurs au bon moment |
| L15 | **Gouvernance projet absente** : pas de registre de décisions, pas de RFI, pas de lien commit ↔ décision, pas d'indicateurs de gouvernance | — | Les améliorations se décident en conversation, sans trace |

---

## 4. Bilan de la première livraison SDP360 : apports et défauts à corriger

### 4.1 Apports réels (à conserver)

| Apport | Fichiers | Valeur |
|---|---|---|
| Runner de synchronisation générique (verrou, rejeu exponentiel avec Retry-After, classification transitoire, watermark, dédoublonnage, garde anti-vide, nettoyage, journal) | `services/sync/syncRunner.js`, `syncStore.js`, `index.js` (17 tests) | Corrige L1 et L2 **sur le principe** |
| Journal des exécutions et santé des synchros | `routes/sync.js`, tables `sync_runs` / `sync_watermarks` / `sync_locks`, miroir `system_log` | Observabilité |
| Registre des politiques RAG et moteur de score générique | `services/kpiRag.js` (5 tests) | Corrige L3 sur le principe |
| Moteur de définition de trackers (validation, score, import du tracker 2026) | `services/trackerDefinitions.js` (5 tests) | Corrige L7 sur le principe |
| Validateur de tableaux de bord (9 widgets, grille, profil terrain, refus du SQL brut) | `services/dashboardWidgets.js` (4 tests) | Base de L12 |
| Schémas PostgreSQL des nouveaux objets | `002_tracker_definitions.sql`, `016_dashboard_definitions.sql` (métriques, politiques RAG, RFI) | Base de gouvernance |
| Intégration continue, `.env` d'exemple, nettoyage des 25 scripts à la racine | `.github/workflows/ci.yml`, `DOTENV.example`, `ops/legacy-scripts/` | Corrige L6 (CI) et L10 (début) |
| Corpus de gouvernance : évaluation, document stratégique, charte de comité, feuille de route, spécification, SOP, gabarits, comparatif | `docs/sdp360/00…06` | Corrige L11 et L15 sur le papier |

### 4.2 Défauts de SDP360 (constatés à la relecture, à corriger dans la prochaine version)

| # | Défaut | Preuve | Gravité |
|---|---|---|---|
| D1 | **Les fondations ne sont pas branchées** : aucun job existant ne passe par le runner (zéro référence à `services/sync` dans `zoho-sync.js`, `assets-sync.js`, les outils Meraki/OpManager/Teams) | `grep` sans résultat hors `routes/sync.js` | **Critique** — le risque L1 est toujours présent en production |
| D2 | **Les nouveaux schémas SQL ne sont exécutés par personne** : `tracker_definitions`, `dashboard_definitions`, `metric_registry`, `kpi_rag_policies`, `rfi_requests` n'existent que dans `db/postgres/**` ; aucun code ne les lit ni ne les crée au démarrage | aucune référence hors `db/` | Critique — la gouvernance « outillée » est encore sur papier |
| D3 | **Le registre RAG n'est consommé par aucun module** : les cinq échelles historiques tournent toujours ; `kpiRag.js` est un sixième jeu de seuils | — | Majeur — L3 aggravé tant que la convergence n'est pas faite |
| D4 | **Aucune interface** : ni builder de trackers, ni composeur de tableaux de bord, ni formulaire RFI ; le moteur n'est accessible qu'aux tests | — | Majeur — valeur invisible pour les métiers |
| D5 | **Validation sur SQLite seulement** : les 35 nouveaux tests tournent en SQLite ; `syncStore` sur PostgreSQL n'est pas testé ; la CI ne lance pas PostgreSQL | `ci.yml` | Majeur — la production est 100 % PostgreSQL |
| D6 | **Documentation en anglais** pour un terrain francophone ; les documents 00 à 05 ne sont pas lisibles par les coordinateurs | convention du `README.md` | Moyen |
| D7 | **Deux systèmes de suivi de synchro coexistent** (`sync_metadata` historique et `sync_runs` nouveau) sans plan de fusion | — | Moyen |
| D8 | **Rien sur les sept chantiers** (cockpit de réunion, portefeuille, rapports IA, engagement, sécurité, SSO + MFA, gouvernance projet) : décrits au document 06, aucune ligne de code | — | Attendu, mais à planifier |
| D9 | **Sécurité inchangée** : tous les points L9 sont toujours présents dans SDP360 | — | Majeur |
| D10 | **Pas de plan de migration des données** du tracker figé vers le moteur générique (l'importeur existe, le fonctionnement en parallèle et la bascule ne sont pas décrits en procédure) | — | Moyen |

**Conclusion du bilan** : SDP360 est une excellente **base documentaire et un socle technique testé**, mais c'est une livraison « alpha » : la production n'en bénéficie pas encore. La prochaine version doit **câbler, exposer, migrer, durcir** — pas réinventer.

---

## 5. La cible : « SDP360 v3 » — meilleure que SDP-Dashboard et que SDP360 alpha

### 5.1 Principes de conception (non négociables)

1. **Continuité** : 100 % des capacités de SDP-Dashboard conservées ; aucune régression sur les goldens, les tests de fidélité et les formules ITSM.
2. **Une donnée, une définition, une diffusion** : chaque chiffre vient d'un lecteur de métrique enregistré, sous une politique RAG unique, avec la date de ses données.
3. **Paramétrable par les métiers** : trackers, tableaux de bord, seuils, règles d'alerte, modèles de rapport et cadences de réunion sont des **données**, pas du code.
4. **Observable et résilient** : chaque job, chaque envoi, chaque génération laisse une trace consultable ; aucun échec silencieux.
5. **Terrain d'abord** : saisie possible hors-ligne, sur téléphone, en moins de 20 minutes par semaine et par site.
6. **Sécurisé par défaut** : SSO + MFA délégués à Entra, secrets chiffrés obligatoires, CSP stricte, dépendances auditées, journal d'audit complet.
7. **Gouverné** : chaque évolution est une RFI, chaque arbitrage une décision `DEC-`, chaque étape conçue et réceptionnée par le comité.
8. **Bilingue** : interface et documents EN/FR ; les documents de gouvernance destinés au terrain sont en français.

### 5.2 Capacités cibles (synthèse)

| Domaine | SDP-Dashboard v1.11 | SDP360 alpha | **SDP360 v3 (cible)** |
|---|---|---|---|
| Synchronisation | intégrale, 1 rejeu, silencieuse | runner livré, non branché | **tous les jobs** sur le runner, delta, 429 géré, santé affichée, alerte en cas d'échec, `sync_metadata` fusionné |
| Base de données | SQLite + PG | idem | **PostgreSQL seul**, schémas appliqués au démarrage par un migrateur, réplica et sauvegardes testées |
| KPI et seuils | dispersés, 5 échelles | registre non consommé | **dictionnaire KPI publié** (≥ 40 métriques), ≤ 3 politiques RAG, tous les modules et exports lisent le registre |
| Trackers | 1 programme figé | moteur sans interface | **builder** pour les métiers, n trackers versionnés, liaison automatique aux sources (réunions, inspections, tickets), tracker 2026 migré |
| Tableaux de bord | 37 pages figées | validateur sans rendu | **composeur** + rendu sur le shell commun, 3 audiences (site, direction, terrain), templates |
| Réunions ops | PowerPoint manuel | — | **cockpit de réunion** : agenda généré, mode séance, décisions et actions en direct, PV automatique, suivi inter-réunions |
| Roadmap et projets | outil personnel | — | **portefeuille partagé** : programmes → objectifs → projets → jalons → actions, preuves automatiques, Gantt, risques, revue mensuelle générée |
| Rapports | 6 PPTX + e-mails, commentaire déterministe | idem | **générateur de rapports** par modèle et audience, **analyse IA** (locale par défaut) avec chiffres canoniques imposés et relecture humaine, journal des versions |
| Engagement | annuaire par site | idem | **règles d'alerte**, abonnements, centre de notifications in-app, digest, partage par lien signé, accusés de lecture, Teams / e-mail / SharePoint |
| Sécurité | moyenne, pas de MFA | idem | **SSO Entra `only` + MFA par accès conditionnel**, provisionnement des groupes, secrets obligatoires, CSP stricte, SCA/SAST en CI, journal 12 mois, test d'intrusion |
| Terrain | aucun | aucun | **PWA hors-ligne** : inspections et tracker sur téléphone, photos compressées et envoyées par morceaux, file d'attente idempotente, mode bas débit |
| Gouvernance | journal chronologique | documents + tables non créées | **RFI et décisions dans la plateforme**, tableau de bord de gouvernance, indicateurs projet, ADR, `CLAUDE.md` réduit à un pointeur |
| Qualité logicielle | 2 372 tests, pas de CI | CI SQLite | CI **SQLite + PostgreSQL**, lint, couverture, paquets de livraison signés produits par la CI, `server.js` < 3 000 lignes |

---

## 6. Le prompt de développement — dix étapes validées par le comité

### 6.1 Mode d'emploi

Ce chapitre est un **prompt complet** à remettre à l'assistant IA de développement (Claude Code, Codex ou équivalent) au début de chaque étape. Il se compose d'un **préambule** (6.2, identique pour toutes les étapes) et d'une **fiche par étape** (6.3). Le comité conduit la boucle suivante pour chaque étape :

```
 ① L'IA produit un DOSSIER DE CONCEPTION (design) à partir de la fiche :
    périmètre, modèle de données, API, écrans, règles, plan de tests, plan de migration, risques.
 ② Le comité (Triage puis Review Board) examine le dossier, pose ses questions, tranche
    les points d'arbitrage listés → décision DEC-YYYY-NNN, dossier amendé.
 ③ L'IA IMPLÉMENTE en petits incréments (une RFI = une branche = une PR), tests en CI verts,
    documentation mise à jour, démonstration enregistrée.
 ④ Le comité RÉCEPTIONNE sur les critères de sortie de la fiche ; les techniciens testent sur site
    pour tout ce qui touche la saisie ; les écarts deviennent des RFI.
 ⑤ Le CAB autorise la mise en production du paquet produit par la CI ; l'IA rédige la note de version.
```

Aucune étape ne commence tant que la précédente n'est pas réceptionnée, sauf la conception (①) qui peut être anticipée d'une étape.

### 6.2 Préambule du prompt (à copier en tête de chaque commande)

> **Rôle.** Tu es l'architecte-développeur principal de SDP360, plateforme de pilotage des opérations IT d'Endeavour Mining (Node 22, Express, PostgreSQL 17, pages HTML/JS avec Chart.js, React pour le tracker, pptxgenjs, nodemailer, intégrations Zoho SDP Cloud / Analytics Plus, OpManager, Meraki, Microsoft 365). Le dépôt est `mliad313sn/SDP360` ; l'historique et les règles métier sont dans `CLAUDE.md` et `docs/sdp360/`.
>
> **Mission.** Faire évoluer SDP360 vers la cible décrite au chapitre 5 du document `docs/sdp360/07-ETUDE-EVOLUTION-ET-PROMPT.md`, étape par étape, **sans jamais régresser** sur les capacités existantes de SDP-Dashboard v1.11.
>
> **Règles de travail.**
> 1. Avant tout code : livre un **dossier de conception** (`docs/sdp360/design/ETAPE-NN-<sujet>.md`, en français) listant explicitement les **points d'arbitrage** que le comité doit trancher. N'implémente qu'après la décision `DEC-` du comité, référencée dans chaque commit.
> 2. Respecte les règles maison de `docs/sdp360/05 §7` et de `CLAUDE.md`, notamment : ne jamais écrire `user.site_id === x` (utiliser `services/userSites.js`) ; mettre à jour par identifiant, jamais supprimer puis réinsérer ; recalculer à partir des compteurs, jamais moyenner des scores ; `null` = non mesuré ≠ `0` ; jamais une date inventée ; un nouveau statut terminal rejoint `StatusTransfer.DONE` et les listes SQL ; `CAST(? AS TEXT)` pour un `?` seul sur PostgreSQL ; les pollers ne lèvent jamais et ne se chevauchent jamais ; les secrets sont en écriture seule et chiffrés ; les PPTX passent par `fixComboChartAxes` ; les montants du parc restent admin+ ; les goldens ne se régénèrent qu'après une décision de changement visuel.
> 3. **Tests obligatoires** : unitaires pour tout module pur, smoke pour toute route (démarrage sur SQLite via `tests/_http-fetch.js`), et **parité PostgreSQL** pour tout lecteur ou écrivain dual (la CI exécute les deux). `npm test` vert avant chaque PR. Un test qui lit un fichier du dépôt normalise les fins de ligne.
> 4. **Documentation obligatoire** : chaque étape met à jour `docs/sdp360/` (spécification, SOP, ADR dans `docs/adr/`), le `CHANGELOG.md`, l'aide en ligne `public/help.html` **en anglais et en français**, et réduit `CLAUDE.md` au lieu de l'allonger.
> 5. **Sécurité par défaut** : aucun secret dans une URL, un log, un test ou un commit ; aucune nouvelle page avec `onclick` inline ; toute nouvelle route derrière `requireReportSession` et un contrôle de rôle explicite ; toute entrée utilisateur validée côté serveur.
> 6. **Continuité** : toute capacité existante touchée garde son contrat (routes, formats d'export, fixtures golden) ; une migration de données comporte une simulation (`--dry-run`), une sauvegarde, un fonctionnement en parallèle mesuré et une procédure de retour arrière.
> 7. **Livraison** : une RFI = une branche = une PR avec description, captures ou enregistrement de démonstration, et note de version. Les paquets de production sont produits par la CI, jamais à la main.
> 8. **Honnêteté** : si un critère de sortie n'est pas atteint, dis-le et propose un plan ; ne contourne jamais un test ; ne marque rien « fait » sans preuve.
> 9. **Langue** : code et commits en anglais ; dossiers de conception, aide terrain et comptes rendus en français ; interface bilingue.

### 6.3 Les dix étapes

Chaque fiche suit le même plan : **Objectif · Périmètre · Conception à soumettre au comité (points d'arbitrage) · Critères de réception · Gain obtenu**.

---

#### Étape 1 — Câbler le runner et rendre les synchronisations fiables (corrige L1, L2, D1, D7)

**Objectif.** Faire passer les sept familles de jobs (Zoho tickets, changements/CAB, enquête CSAT, parc, OpManager, Meraki, alertes SLA Teams, plus la sauvegarde `pg_dump`) par `services/sync/`, en mode delta là où la source le permet.

**Périmètre.** Adaptateur par job (`fetch`, `apply`, `dedupe`, `key`) ; filtre « modifié depuis » (`deltaSince` sur *Last Updated Time*) pour les tickets et changements ; suppression logique gardée pour le parc ; rejeu exponentiel sur 429 Meraki avec `Retry-After` ; fusion de `sync_metadata` dans `sync_runs` avec vue de compatibilité ; écran « Santé des synchronisations » dans System Logs ; alerte Teams/e-mail quand un job échoue deux fois de suite ou dépasse sa fenêtre de fraîcheur.

**Conception à soumettre.** Cadence par source (quota Zoho, repli bulk 8133) · seuil de « fraîcheur » par job · politique de rétention des runs · comportement sur export tronqué (garde anti-vide : % minimal de lignes attendues) · destinataires des alertes.

**Critères de réception.** 100 % des jobs visibles dans `/api/sync/health` ; un export tronqué simulé ne supprime aucune ligne ; taux de succès ≥ 99 % sur 4 semaines ; alerte reçue en test lors d'un échec provoqué ; tests de parité PostgreSQL verts.

**Gain.** Fin du risque de suppression massive ; pannes visibles en moins de 10 minutes ; charge Zoho divisée par 5 à 10 grâce au delta.

---

#### Étape 2 — PostgreSQL seul, migrateur de schéma et CI à parité (corrige L5, D2, D5)

**Objectif.** Une seule base en production, des schémas appliqués automatiquement, une CI qui prouve la parité.

**Périmètre.** Migrateur `db/migrate.js` (journal `schema_migrations`, idempotent, exécuté au démarrage et en CI) qui applique `db/postgres/**` y compris les scripts SDP360 non exécutés aujourd'hui ; bascule du parc vers PostgreSQL (`copy-assets.js` durci) ; `ORDER BY` déterministes sur les 9 lecteurs ; retrait des forks SQLite module par module, SQLite conservé pour les tests unitaires purs ; service PostgreSQL dans la CI (`PG_TESTS_REQUIRED=1`) ; sauvegarde quotidienne chiffrée via le runner et exercice de restauration trimestriel documenté.

**Conception à soumettre.** Ordre de retrait des forks (parc → tracker → inspections → réunions → rapports) · fenêtre de bascule du parc · stratégie de sauvegarde (rétention, clé hors sauvegarde) · réplica (étape 10 ou ici).

**Critères de réception.** Zéro SQLite en production ; CI verte sur SQLite **et** PostgreSQL ; migrateur rejouable sans effet ; restauration testée sur une instance jetable ; `tests/pg-*` passent sans saut.

**Gain.** Moitié moins de code de persistance ; fin des bugs « vert en SQLite, rouge en PostgreSQL » ; schéma versionné.

---

#### Étape 3 — Dictionnaire KPI, convergence RAG, référentiel site unique (corrige L3, L4, D3)

**Objectif.** Un chiffre = une définition = une couleur.

**Périmètre.** Chargement de `metric_registry` et `kpi_rag_policies` au démarrage ; API `GET /api/metrics/registry` et `GET /api/metrics/:key?site=&window=` dispatchant vers les lecteurs existants ; enregistrement des ≥ 40 KPI existants (helpdesk D1–D4, CSAT, WAN, parc, 5 Engagements, scores de site, tracker) avec formule, fenêtre, propriétaire, source ; tous les modules et exports (écrans, PPTX, e-mails) lisent `kpiRag` ; suppression des seuils dupliqués ; `sites` + `site_module_codes` comme clé unique, suppression de `scoreboardAliases.js` et des alias d'inspection ; dictionnaire KPI publié dans l'aide, bilingue.

**Conception à soumettre.** **Décision majeure** : convergence des cinq échelles vers ≤ 3 politiques (tracker, score programme, SLA) avec tableau avant/après par site ; sort des deux modèles « 6 dimensions » ; dates d'ancrage remplacées par des fenêtres glissantes ; fermeture des cases « À CONFIRMER » du registre des sites (Massawa, Exploration, Tanda).

**Critères de réception.** Chaque widget et chaque cellule PPTX résout vers une métrique enregistrée ; aucune échelle RAG hors registre (test statique) ; rapport d'impact de la convergence approuvé ; tests de fidélité mis à jour par décision explicite.

**Gain.** Fin des contradictions entre écrans ; le comité gouverne réellement les KPI ; les nouveaux tableaux de bord se construisent sans code.

---

#### Étape 4 — Sécurité, SSO et MFA (corrige L9, D9)

**Objectif.** Plateforme sécurisée par défaut, authentification d'entreprise.

**Périmètre.** `SDP_CONFIG_KEY` obligatoire en production avec dérivation scrypt et script de re-chiffrement ; clés API hors URL ; TLS vérifié vers OpManager (autorité interne) ; comparaison de clés en temps constant ; remplacement de `xlsx@0.18.5` ; CSP sans `'unsafe-inline'` sur toute nouvelle page et plan de retrait des `onclick` existants ; HSTS, cookies `Secure/HttpOnly/SameSite`, limiteur de débit persistant ; `npm audit` + SCA + SAST en CI, branches protégées, revue obligatoire ; activation SSO Entra en mode `available` puis `only` ; **MFA déléguée aux politiques d'accès conditionnel Entra** ; synchronisation des groupes Entra → rôles et sites ; désactivation automatique au départ ; compte de secours local journalisé ; journal d'audit étendu (exports, accès aux montants, changements de rôle) conservé 12 mois ; procédure de réponse à incident ; test d'intrusion planifié.

**Conception à soumettre.** Correspondance groupes Entra ↔ rôles/sites · durée de session · politique MFA (appareils, localisation) · calendrier de la fenêtre `available` · plan de rotation des secrets · périmètre du test d'intrusion.

**Critères de réception.** Scan SCA/SAST sans vulnérabilité haute ; 100 % des comptes actifs en SSO, MFA imposée, break-glass testé ; aucun secret en clair dans une sauvegarde ; tests d'autorisation par rôle sur chaque route (générateur automatique).

**Gain.** Conformité aux bonnes pratiques, plus de mots de passe locaux, traçabilité complète des accès.

---

#### Étape 5 — Modularisation, qualité logicielle et paquets de livraison (corrige L6, L10, L11)

**Objectif.** Un code maintenable par une équipe, livré par la CI.

**Périmètre.** Extraction de `server.js` vers `routes/*` (budget ≥ 600 lignes par sprint, cible < 3 000 lignes) ; registre unique des tâches cron ; découpage de `reports-db.js` et `reports.html` par domaine ; étape de build (esbuild) pour les applications React, fin de Babel dans le navigateur ; lint et formatage en CI ; paquet de livraison versionné et signé produit par la CI à partir d'un tag, `_apply_on_prod` lisant le paquet ; retrait du registre des lots gelés après la première livraison CI ; extraction des règles de `CLAUDE.md` vers `docs/sdp360/05 §7` et `docs/adr/`, `CLAUDE.md` réduit à un index et un état courant.

**Conception à soumettre.** Découpage par domaine · convention de nommage des routes · format du paquet · politique de version (SemVer) · liste des ADR initiaux.

**Critères de réception.** `server.js` < 3 000 lignes ; aucune compilation dans le navigateur ; première mise en production depuis un paquet CI ; `CLAUDE.md` < 800 lignes ; tous les tests verts.

**Gain.** Onboarding d'un second développeur en jours au lieu de semaines ; production identique au tag déployé.

---

#### Étape 6 — Moteur de trackers et de tableaux de bord avec interfaces (corrige L7, L12 partiel, D4, D10)

**Objectif.** Les métiers créent leurs trackers et leurs tableaux de bord sans développeur.

**Périmètre.** **Tracker Builder** (période, unités, groupes, items, types de KPI, pondérations, cibles, validation en ligne, score à blanc, revue → publication versionnée) ; runtime de saisie par unité × période, verrouillage des mois clos, import xlsx, items **liés automatiquement** aux sources (réunions, inspections, tickets) ; **migration du tracker 2026** : import, fonctionnement en parallèle un mois, comparaison des scores à ±0,1 pt, bascule, retrait des tables `tracker_*` ; **Dashboard Builder** (grille, catalogue de widgets, filtres, aperçu par audience, publication versionnée) et moteur de rendu sur le shell commun ; templates (dispatch terrain, déploiement matériel, maintenance de site, conformité réunions ; hebdo site, mensuel direction, quotidien terrain) ; PPTX et Excel lisent le même moteur de score et la même API de métriques.

**Conception à soumettre.** Expérience du builder (maquettes) · droits de publication · format de version et de retour arrière · plan de migration du tracker 2026 (dates, responsables, critères) · liste des 10 premiers tableaux de bord remplaçant les pages figées.

**Critères de réception.** ≥ 3 trackers et ≥ 5 tableaux de bord créés par des membres du comité sans développeur ; tracker 2026 migré sans écart ; ≥ 10 pages figées remplacées par des définitions ; aucune formule hors du moteur.

**Gain.** Nouveau tracker en une heure au lieu d'un sprint ; tableaux de bord cohérents par construction ; dette de 37 pages figées réduite.

---

#### Étape 7 — Cockpit de réunion opérationnelle et portefeuille roadmap / projets (corrige L12, L15)

**Objectif.** Les réunions ops et la roadmap se pilotent **dans** la plateforme et laissent une trace.

**Périmètre.** Table `meeting_cadences` (type, site, jour, participants, préparateur) ; agenda généré par cadence (KPI, actions en retard, incidents majeurs, décisions en attente, RFI) ; **mode séance** plein écran, horodatage de chaque point, saisie en direct des décisions `DEC-` et des actions rattachées à leur source (elles rejoignent le Registre des actions) ; PV automatique (HTML, PDF, e-mail) ; suivi inter-réunions généralisé à partir de `compareDepartment` ; **portefeuille** `programmes → objectifs → projets → jalons → livrables → actions` avec propriétaires, statut, confiance, dates, budget, risques ; preuves automatiques par métrique (généralisation de `roadmapEvidence`) ; Gantt avec dépendances et alertes de glissement ; registre des risques projet relié aux incidents SDP ; rapport mensuel « état du portefeuille » généré ; traçabilité commit ↔ RFI ↔ DEC ; indicateurs de gouvernance projet (% jalons à l'heure, dérive moyenne, % objectifs avec preuve, délai RFI → décision).

**Conception à soumettre.** Types de réunions et agendas types · règles de rattachement des actions · modèle de portefeuille (niveaux, champs obligatoires) · migration du Roadmap Manager personnel · qui peut créer une décision.

**Critères de réception.** Trois cadences réelles tenues pendant un mois dans le cockpit avec PV automatique ; portefeuille 2027 saisi avec preuves automatiques sur ≥ 50 % des objectifs ; tableau de bord de gouvernance publié.

**Gain.** Plus de diapositives préparées à la main ; décisions tracées et suivies ; roadmap partagée reliée au terrain.

---

#### Étape 8 — Générateur de rapports avec analyse IA embarquée (corrige L13)

**Objectif.** Rapports produits automatiquement par modèle et audience, avec un commentaire analytique vérifié.

**Périmètre.** Modèles de rapport (site, direction, Conseil, finance) composés de widgets ; sorties HTML, PDF, PPTX, CSV via les générateurs existants ; couche d'analyse déterministe (variations significatives, pires sites/catégories, séries 13 semaines, règles héritées ±1/±3/±10 pts) toujours disponible ; couche IA alimentée **uniquement** par les chiffres canoniques du rapport (clause anti-hallucination existante), ton par audience, bilingue, produisant synthèse, points d'attention, causes probables, recommandations, questions pour la réunion ; fournisseur **local par défaut** (Ollama, Mistral Nemo déjà qualifié) avec option cloud anonymisée ; commentaire marqué « brouillon IA » jusqu'à relecture humaine obligatoire pour la direction ; journal de version (modèle, horodatage, relecteur) ; jeu de rapports golden (zéro divergence de chiffres) ; planification via `report_schedules` et le runner.

**Conception à soumettre.** **Décision souveraineté** (local / cloud, données autorisées) · liste des modèles de rapport · règles de relecture par audience · budget matériel pour l'inférence locale · indicateurs de qualité du commentaire évalués trimestriellement par le comité.

**Critères de réception.** Pack exécutif mensuel produit sans saisie manuelle ; zéro divergence entre chiffres du rapport et registre KPI ; commentaire IA jugé « utile » par ≥ 80 % des relecteurs sur un trimestre ; aucune donnée PII envoyée hors site.

**Gain.** Des heures de rédaction économisées chaque mois ; analyses homogènes et sourcées ; direction informée plus tôt.

---

#### Étape 9 — Moteur d'engagement : notifications, abonnements, partage (corrige L14)

**Objectif.** La bonne information atteint le bon acteur, au bon moment, sur le bon canal.

**Périmètre.** Table `alert_rules` (métrique, périmètre, comparateur, seuil, rémanence, canal, destinataires par rôle/site) ; alertes de fraîcheur des synchros, dépassement SLA, WAN coupé, tracker rouge deux mois ; abonnements utilisateur (site, module, fréquence) respectant les adresses confirmées ; centre de notifications in-app ; digest quotidien/hebdomadaire par acteur ; canaux Teams (webhooks existants), e-mail, SharePoint ; partage de rapport par lien signé expirable ; registre des envois étendu avec accusés de lecture ; commentaire et accusé depuis la notification, alimentant le suivi inter-réunions ; cartes SLA quasi temps réel (API SDP v3, ≤ 10 min).

**Conception à soumettre.** Catalogue initial de ≥ 10 règles · politique anti-bruit (rémanence, digest) · durée de validité des liens · conservation des accusés · qui gère les abonnements des autres.

**Critères de réception.** ≥ 10 règles actives avec < 5 % de faux positifs sur un mois ; taux d'ouverture des digests mesuré ; partage par lien utilisé par ≥ 3 parties prenantes externes à l'IT.

**Gain.** Fin des rapports non lus ; réaction aux dérives en heures et non en semaines ; diffusion maîtrisée.

---

#### Étape 10 — Expérience terrain hors-ligne et résilience (corrige L8)

**Objectif.** Saisie sur téléphone, hors connexion, sur tous les sites.

**Périmètre.** PWA installable (service worker, boîte d'envoi IndexedDB, estampille « données au ») ; capture d'inspection hors-ligne (photos compressées ≤ 300 Ko, envoi par morceaux vers le blob store, `PUT /api/field/outbox/:uuid` idempotent) ; saisie de tracker hors-ligne ; actions rapides (ticket SDP depuis un constat via l'API v3 en écriture — nouveau scope OAuth passé en CAB ; clôture ou transfert justifié) ; mode bas débit (charges pré-agrégées, tableaux de bord `audience: field` ≤ 8 widgets, cache 24 h) ; rôle `field-tech` ; pilote sur 3 sites, 6 semaines, cliniques terrain ; réplica PostgreSQL en flux (RPO 15 min) et exercice de restauration.

**Conception à soumettre.** Sites pilotes · appareils cibles · politique de conflit (dernière écriture, verrou mensuel) · taille maximale d'une inspection · périmètre du scope d'écriture SDP.

**Critères de réception.** Inspection de 10 photos synchronisée en ≤ 2 min à 1 Mbit/s ; zéro perte de saisie sur coupures pendant le pilote ; saisie hebdo ≤ 20 min mesurée sur 3 sites ; NPS techniciens ≥ +30 ; RPO 15 min démontré.

**Gain.** Données terrain complètes et à jour ; fin des pertes de saisie ; techniciens libérés de la re-saisie.

---

### 6.4 Séquencement recommandé

| Trimestre | Étapes | Jalon comité |
|---|---|---|
| T1 | 1 · 2 · 3 (conception de 4 anticipée) | Réception « socle fiable » : synchros, base, KPI |
| T2 | 4 · 5 · 6 (conception) | Réception « sécurisé et modulaire » ; décision souveraineté IA ; SSO `only` |
| T3 | 6 · 7 · 8 (conception) | Réception « pilotage » : builders, cockpit, portefeuille |
| T4 | 8 · 9 · 10 | Réception « automatisé et terrain » : rapports IA, engagement, PWA |

Les étapes 1 à 3 sont **prérequis stricts** ; 4 et 5 peuvent avancer en parallèle de 6 ; 7, 8 et 9 dépendent du registre KPI et du moteur de tableaux de bord ; 10 dépend de 6.

---

## 7. Capacités et gains obtenus une fois les dix étapes livrées

### 7.1 Tableau avant / après

| Indicateur | SDP-Dashboard v1.11 | SDP360 v3 livrée | Comment on le mesure |
|---|---|---|---|
| Jobs de synchronisation observables | 1 sur 7 (alertes SLA) | 7 sur 7 + sauvegarde | `/api/sync/health` |
| Risque de suppression massive sur export tronqué | présent | éliminé | test de garde anti-vide en CI |
| Délai de détection d'une panne de synchro | jours (6 semaines constatées) | < 10 min | alerte Teams/e-mail |
| Appels Zoho par jour | ~72 exports intégraux | ~15 exports delta | journal des runs |
| Back-ends de base de données | 2 | 1 | code et production |
| Échelles RAG | 5 (+1 non branchée) | ≤ 3, dans un registre | test statique |
| KPI documentés avec formule et propriétaire | 4 (D1–D4) | ≥ 40 | `metric_registry` |
| Vocabulaires de codes site | 3 | 1 | `site_module_codes` |
| Trackers possibles sans développeur | 0 | illimité, versionnés | builder |
| Tableaux de bord | 37 pages figées | définitions versionnées, 3 audiences | composeur |
| Réunions ops outillées | 0 | toutes les cadences, PV automatique | cockpit |
| Décisions tracées | 0 | 100 % (`DEC-`) | registre |
| Roadmap | personnelle, 4 objectifs | portefeuille partagé avec preuves automatiques | module portefeuille |
| Rapports avec analyse rédigée | 0 (déterministe limité) | tous les modèles, IA locale, relus | générateur |
| Règles d'alerte paramétrables | 0 (SLA Teams codé) | ≥ 10, par les métiers | `alert_rules` |
| Partage sécurisé et accusés de lecture | non | oui | registre des envois |
| MFA | aucune | obligatoire via Entra | accès conditionnel |
| Vulnérabilités hautes connues | plusieurs (L9) | 0 | SCA/SAST en CI |
| Saisie hors-ligne sur téléphone | non | inspections + tracker | PWA |
| Taille d'une inspection envoyée | jusqu'à 100 Mo en une requête | morceaux ≤ 300 Ko | blob store |
| Lignes de `server.js` | 9 164 | < 3 000 | `wc -l` |
| Compilation dans le navigateur | oui (Babel) | non | build CI |
| CI | aucune | SQLite + PostgreSQL + lint + SCA + paquet signé | GitHub Actions |
| Connaissance opérationnelle | journal de 6 166 lignes | SOP + ADR + dictionnaire KPI, `CLAUDE.md` < 800 lignes | dépôt |
| Temps de saisie hebdo par site | non mesuré | ≤ 20 min | pilote terrain |

### 7.2 Capacités nouvelles pour chaque acteur

| Acteur | Ce qu'il gagne |
|---|---|
| **Direction** | un pack mensuel généré avec analyse IA relue, une roadmap partagée avec preuves, un tableau de bord de gouvernance, une vue SharePoint à jour |
| **Comité / Conseil IT** | un dictionnaire KPI qu'il gouverne, des RFI et décisions tracées dans l'outil, des trackers et tableaux de bord qu'il publie lui-même |
| **Coordinateurs de site** | un cockpit de réunion avec agenda pré-rempli et PV automatique, des alertes ciblées, un digest hebdo, moins de 20 minutes de saisie |
| **Techniciens terrain** | une application hors-ligne sur téléphone, des photos légères, la création d'un ticket en un geste, un rôle dédié |
| **Équipe plateforme** | une base unique, un code modulaire, une CI complète, des paquets signés, une sécurité conforme, une documentation lisible |
| **Parties prenantes externes à l'IT** | des rapports partagés par lien sécurisé, des accusés de lecture, un abonnement à ce qui les concerne |

---

## 8. Gouvernance de l'exécution

- **Instances** : Triage bimensuel (RFI, santé des synchros), Review Board mensuel (conception et réception des étapes), Planning trimestriel (jalons du §6.4), CAB pour chaque mise en production, cliniques terrain mensuelles pour les étapes 6 et 10.
- **Artefacts** : un dossier de conception par étape (`docs/sdp360/design/`), une décision `DEC-` par point d'arbitrage, un compte rendu par séance (`docs/sdp360/minutes/`), une note de version par paquet.
- **Mesures du programme** (revues chaque mois) : étapes réceptionnées / planifiées, délai conception → décision, écarts de réception ouverts, couverture de tests, dette sécurité ouverte, adoption (vues par rôle via le journal `*_viewed`).
- **Conditions d'arrêt d'une étape** : critère de réception non atteint après deux itérations → retour au comité avec plan corrigé ; régression sur un golden ou un test de fidélité → blocage de la PR.

---

## 9. Décisions demandées à la direction avant le lancement

1. Ratifier la charte du comité (document 02) et nommer les sièges, y compris les deux techniciens terrain.
2. Valider le séquencement du §6.4 et le budget d'équipe sur 12 mois (1 architecte, 1 développeur front à partir du T2, 1 ingénieur données à mi-temps, 1 analyste métier).
3. Autoriser l'enregistrement d'application Entra, l'activation du SSO et la politique MFA par accès conditionnel (étape 4).
4. Trancher la souveraineté IA (inférence locale par défaut, cloud optionnel anonymisé) et le budget matériel associé (étape 8).
5. Désigner les trois sites pilotes de l'étape 10.

---

## Annexe A — Gabarit de dossier de conception (à produire par l'IA à chaque étape)

```
# Dossier de conception — Étape NN — <sujet>            Version · Date · Auteur (IA) · Relecteur

1. Objectif et périmètre (rappel de la fiche, écarts éventuels)
2. État existant touché (fichiers, tables, routes, tests, goldens)
3. Modèle de données (DDL idempotent, migration, retour arrière)
4. API et contrats (routes, rôles, validation, erreurs)
5. Écrans (maquettes, audiences, bilingue, accessibilité, mobile)
6. Règles métier (nouvelles et réaffirmées, référence 05 §7)
7. Plan de tests (unitaires, smoke, parité PG, golden, terrain)
8. Plan de migration et de fonctionnement en parallèle
9. Sécurité et données personnelles
10. Risques et mitigations
11. POINTS D'ARBITRAGE pour le comité (numérotés, avec option recommandée)
12. Critères de réception (copiés de la fiche, mesurables)
```

## Annexe B — Gabarit de commande d'une étape (à envoyer à l'IA)

```
[Préambule 6.2]

Étape NN — <sujet>. Décisions du comité : DEC-2026-0xx (…), DEC-2026-0yy (…).
Dossier de conception approuvé : docs/sdp360/design/ETAPE-NN-<sujet>.md v<k>.

Travail demandé :
 1. Implémente l'incrément <RFI-...> décrit au §<n> du dossier, sur la branche <nom>.
 2. Ajoute les tests listés au §7, dont la parité PostgreSQL.
 3. Mets à jour docs/sdp360/<document>, public/help.html (EN + FR) et CHANGELOG.md.
 4. Fournis : résumé des changements, résultat de `npm test`, captures ou enregistrement
    de démonstration, liste des critères de réception couverts et non couverts.
N'élargis pas le périmètre ; signale tout point non prévu au dossier comme nouvelle RFI.
```
