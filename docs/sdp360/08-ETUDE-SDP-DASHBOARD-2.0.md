# SDP-Dashboard — Étude de l'existant et commande de la version 2.0

*Document d'étude et de commande · 2026-10-19 · Base d'analyse : dépôt `SDP-Dashboard` v1.11 (HEAD `e74d4cf`) — relecture complète du code (`server.js` 9 164 lignes, 282 routes, 37 écrans), des schémas, des 2 372 tests et du journal de conception (`CLAUDE.md`, 6 166 lignes).*

> **Destinataires.** La direction, le futur comité produit (experts, utilisateurs, designer) et l'équipe de développement épaulée par un assistant IA. Les chapitres 1 à 4 expliquent ce que la plateforme sait faire et ce qui lui manque ; le chapitre 5 décrit la cible « SDP-Dashboard 2.0 » ; le chapitre 6 est le **prompt de commande** à remettre à l'IA de développement, étape par étape, chaque étape étant conçue, décidée et réceptionnée par le comité ; le chapitre 7 chiffre les gains.

## Fiche documentaire

| Champ | Valeur |
|---|---|
| Référence | SDP-DASH-2.0-ETUDE |
| Version | 1.2 — 2026-10-19 |
| Statut | Pour décision (direction) · Pour exécution (comité, agent IA) |
| Propriétaire | Service & Support Manager (présidence du comité produit) |
| Destinataires | Direction · comité produit (experts, utilisateurs, designer) · équipe et agent IA de développement |
| Confidentialité | Interne — usage Endeavour Mining |
| Base d'analyse | Dépôt SDP-Dashboard v1.11, HEAD `e74d4cf` ; relecture complète du code, des schémas, des 2 372 tests et du journal de conception |

**Historique des versions**

| Version | Date | Auteur | Changement |
|---|---|---|---|
| 1.0 | 2026-10-19 | Agent IA | Étude de l'existant, lacunes, cible 2.0, prompt en dix étapes, gains |
| 1.1 | 2026-10-19 | Agent IA | Ajout du mode de développement par agent IA (§6.5) et du kit de prompts en anglais (chapitre 9) |
| 1.2 | 2026-10-19 | Agent IA | Fiche documentaire, guide de lecture, chapitre de suivi (tableau d'avancement, registres), glossaire ; mise en page pour adoption |

## Comment utiliser ce document

| Vous êtes… | Lisez | Temps | Ce que l'on attend de vous |
|---|---|---|---|
| **Direction / sponsor** | Chapitre 1, §5.3, chapitre 7, chapitre 8 | 20 min | Les six décisions du chapitre 8 ; la nomination du comité |
| **Membre du comité produit** | Chapitres 2 à 6, §5.5, chapitre 10 | 1 h 30 | Trancher les points d'arbitrage de chaque étape (`DEC-`), réceptionner sur les critères de sortie, tenir le tableau de suivi (§10.1) |
| **Designer** | §5.1, §5.5, étapes 5, 6, 7, 10 du chapitre 6 | 45 min | Parcours, maquettes et validation d'accessibilité avant toute implémentation d'écran |
| **Agent IA / équipe de développement** | Chapitre 6 (règles), chapitre 9 (prompts), annexes A et B | 1 h | Produire le dossier de conception, implémenter après décision, livrer avec preuves |
| **Coordinateur ou technicien de site** | Chapitre 2, §5.3, étapes 6, 8 et 10 | 30 min | Participer aux cliniques terrain et aux tests d'utilisabilité ; remonter les RFI |

Conventions : **doit / devrait / peut** ont leur sens normatif ; un identifiant `DEC-AAAA-NNN` désigne une décision du comité, `RFI-NNN` une demande d'amélioration ; les chemins de fichiers renvoient au dépôt.

---

## 1. Résumé pour la direction

SDP-Dashboard est, sept mois après sa première mise en service, une **plateforme d'exploitation IT complète** pour les sites miniers : miroir du helpdesk ServiceDesk Plus, rapports hebdomadaires et mensuels de site, réunions départementales, inspections, parc informatique, disponibilité réseau et WAN, alertes Teams, exports PowerPoint, Excel et e-mail. Vingt-neuf comptes l'utilisent, dont vingt-cinq coordinateurs de site. Sa valeur fonctionnelle est élevée et sa culture de test est rare pour un outil interne.

Ses limites sont d'une autre nature que fonctionnelle : **hétérogénéité** (cinq échelles de couleur RAG, trois vocabulaires de codes de site, deux bases de données en parallèle), **fragilité des synchronisations** (téléchargement intégral horaire, presque aucun rejeu, échecs silencieux — six semaines d'envois planifiés jamais partis sans que personne ne le voie), **absence de capacité terrain** (rien hors-ligne, envois de 100 Mo), **sécurité incomplète** (pas de MFA, chiffrement des secrets optionnel), **installation artisanale** (ZIP copié à la main, « lots gelés »), et **pilotage non outillé** (réunions préparées dans PowerPoint, roadmap personnelle, décisions non tracées, aucune analyse automatique des chiffres).

La version 2.0 proposée transforme l'outil en **produit d'entreprise** : une plateforme de pilotage où la direction consulte en direct l'avancement, où les réunions d'exploitation se tiennent dans l'outil et laissent une trace, où les rapports sont générés avec une analyse rédigée par IA et relue par un humain, où chaque partie prenante reçoit ce qui la concerne sur le canal qu'elle lit, où les statistiques se publient vers SharePoint, Power BI ou tout système de reporting externe, le tout installé et administré par un **installateur et gestionnaire Windows moderne** et gouverné par un **comité d'experts, d'utilisateurs et de design**. Durée : douze mois en dix étapes. Décisions attendues : chapitre 8.

---

## 2. Ce que SDP-Dashboard sait faire aujourd'hui

### 2.1 Architecture actuelle

```
Navigateurs (LAN, IIS 443) ──► IIS (reverse proxy) ──► Node/Express :3456 (PM2)
                                                            │
      reports-db · tracker-db · meetings-db · inspection-db · assets-db · services/*
                   SQLite ou PostgreSQL 17 selon un drapeau par module
                                                            │
   cron interne ──► Zoho Analytics Plus (CSV) · SDP Cloud API v3 · OpManager · Meraki · Microsoft 365
   sorties ──► 6 générateurs PPTX · deck exécutif Python · e-mails planifiés · Excel · cartes Teams · vue SharePoint
```

Un seul processus Node ; 37 pages HTML autonomes (React compilé **dans le navigateur** pour le tracker) ; déploiement par archive ZIP appliquée à la main sur le serveur, redémarrage PM2 manuel, marqueur git « dernier déployé » et registre de « lots gelés » pour les fichiers retenus hors production.

### 2.2 Capacités par module

| Module | Ce qu'il fait réellement | Maturité |
|---|---|---|
| **Helpdesk** (tickets, changements, CAB, CSAT) | Miroir horaire de ServiceDesk Plus ; KPI ITSM avec dénominateurs documentés (SLA résolution et 1ʳᵉ réponse, réouverture, FCR, MTTR), vieillissement, incidents majeurs avec RCA/CA/PIR/LL, succès des changements, CSAT/NPS ; scorecard exécutive ; vue SharePoint publique ; « IT Review » fidèle au modèle de la direction | Élevée |
| **Rapports de site** (hebdo, mensuel) | Éditeur à 5 onglets, auto-remplissage infra/WAN, cycle brouillon → prêt → soumis, auto-sauvegarde verrouillée, suivi des actions avec lignée (reconduction, fusion des doublons, import inter-semaines, justification des transferts), PPTX par site et consolidés, e-mail hebdo rejoué depuis l'instantané signé | Élevée — point fort unique |
| **Réunions départementales** (PV) | 11 référentiels bilingues, PV à 7 sections, sessions d'incubation, escalades Conseil, 5 Engagements mesurés, import Excel, pré-brief « depuis la dernière réunion », signatures horodatées par le serveur, journal d'audit | Élevée |
| **Inspections** | 17 catégories / 173 points, photos, signatures, dictée vocale, sauvegarde locale puis envoi explicite, registre des actions correctives, PPTX, Excel | Moyenne (60 à 100 Mo par envoi) |
| **Registre des actions de site** | Agrégation des trois sources (réunions, inspections, rapports), âge, retard, fermeture en ligne, fusion inter-sources, problèmes ouverts sans action | Élevée |
| **Tracker d'activité IT** | Un programme figé : 4 piliers × 31 activités × 11 sites, 6 types de KPI, scores pondérés, tableau de bord React, heatmap, Gantt, verrouillage des mois clos, PPTX | Moyenne (non paramétrable) |
| **Parc informatique** | 6 vues AssetExplorer synchronisées la nuit, hygiène CMDB (8 exceptions), finance USD, licences, conformité logicielle, santé matérielle, prévision d'investissement, réconciliation AD × Entra × Defender, score d'effort par site, rappels | Élevée (encore en SQLite) |
| **Infra et WAN** | Disponibilité OpManager, qualité WAN Meraki calibrée, sous-sites, SLA WAN contractuel avec crédits ISP et notification armable, dashboard WAN Health | Élevée |
| **Alertes SLA Teams** | API SDP v3 toutes les 5 minutes, cartes adaptatives par groupe, anti-doublon | Élevée |
| **Roadmap Manager** | Outil personnel du manager : 4 objectifs pondérés, livrables, preuves automatiques | Faible (mono-utilisateur) |
| **Registre des risques** | Export Excel mensuel par site × 5 domaines, précédence du champ « Services affectés » | Moyenne |
| **Administration et sécurité** | 5 rôles + rôles fonctionnels, périmètre multi-sites imposé par le serveur, SSO Entra dormant, secrets chiffrés (optionnel), sessions actives, System Logs, sauvegardes, installateur PowerShell autonome | Moyenne |
| **Restitution** | 6 générateurs PPTX, deck exécutif, e-mails planifiés, Excel, Teams, SharePoint, commentaire déterministe « Analyze Lite » ; IA désactivée | Élevée pour les exports, faible pour l'analyse |

### 2.3 Forces à préserver

- Couverture fonctionnelle et **culture de test** (fixtures « golden », tests de fidélité aux modèles de la direction, tests de non-régression issus des audits).
- **Règles métier déjà arbitrées** : dénominateurs ITSM, « le plus récent fait foi » sur les lignées d'actions, statuts de transfert justifiés, comptages figés côté serveur, horodatages signés par le serveur, « jamais une date inventée », « null n'est pas zéro ».
- Périmètre de site **imposé côté serveur**, secrets en écriture seule, schéma PostgreSQL idempotent.
- Artefacts de gouvernance existants : demande de changement ITIL, checklist de bascule, audit AMDEC, registre des sites.

---

## 3. Ce qui manque (lacunes constatées, avec preuves)

| # | Lacune | Preuve | Conséquence |
|---|---|---|---|
| L1 | **Synchronisations fragiles** : CSV intégral chaque heure, un seul rejeu (401), pas de verrou de chevauchement sur 4 jobs sur 5, garde anti-vide seulement sur le parc, pas de gestion du code 429 Meraki | `zoho-sync.js:10`, `assets-sync.js:41-46` | Un export tronqué peut **supprimer en masse** les tickets |
| L2 | **Échecs silencieux** : erreurs dans `sync_metadata.last_error` et la console PM2 seulement | aucun miroir dans le journal système, aucune alerte | Six semaines d'envois planifiés jamais partis (constat du 2026-09-23) |
| L3 | **Cinq échelles RAG** et deux modèles « 6 dimensions » divergents, seuils dupliqués écran / PPTX, dates d'ancrage codées en dur | `engine.js`, `siteScore.js`, `siteComposite.js`, `tracker-pptx.js` | Un site vert, orange ou rouge selon l'écran |
| L4 | **Trois vocabulaires de codes de site**, alias en dur, cases « À CONFIRMER » dans le registre | `tracker-db.js`, `scoreboardAliases.js`, `site-registry.csv` | Jointures par nom, « non applicable » silencieux |
| L5 | **Deux bases en parallèle**, bascule inachevée, parc encore en SQLite, 9 lecteurs à ordre non déterministe | `PG_CUTOVER_RUNBOOK.md` | Double code, bugs « vert en SQLite, rouge en PostgreSQL » |
| L6 | **Monolithe** : `server.js` 9 164 lignes, `reports.html` 8 553, React compilé dans le navigateur, **aucune intégration continue** | — | Chaque modification est un risque non vérifié |
| L7 | **Tracker figé** : un seul programme, types de KPI en dur, activités comptées à la main alors que les modules les comptent déjà | `tracker-init.json` | Impossible de créer un nouveau tracker sans développeur |
| L8 | **Rien pour le terrain** : pas d'application installable, pas de hors-ligne robuste, photos base64, envois jusqu'à 100 Mo | `inspection.html` | Pertes de saisie sur 3G/VSAT |
| L9 | **Sécurité incomplète** : CSP `'unsafe-inline'`, limiteur de débit en mémoire, chiffrement des secrets optionnel, clé OpManager dans l'URL avec TLS non vérifié, bibliothèque Excel non maintenue, **aucune MFA** | `server.js:139` | Exposition en cas de compromission |
| L10 | **Installation et déploiement artisanaux** : ZIP manuel, scripts `.cmd`, marqueur git, lots gelés, installateur PowerShell en console | `tools/deploy`, `tools/installer` | Personne ne sait exactement ce qui tourne en production ; installation réservée à l'auteur |
| L11 | **Connaissance verrouillée** dans un journal chronologique de 6 166 lignes | `CLAUDE.md` | Dépendance à une personne |
| L12 | **Pas de pilotage de réunion ni de portefeuille** | — | Réunions dans PowerPoint, décisions non tracées |
| L13 | **Pas d'analyse automatique** : IA désactivée, commentaire déterministe limité | `AI_PROVIDER=off` | Commentaires rédigés à la main |
| L14 | **Diffusion rigide** : annuaire par site, pas d'abonnement, pas de notification in-app, pas de partage par lien, pas d'accusé de lecture | `reportDirectory.js` | L'information n'atteint pas les bons acteurs |
| L15 | **Pas de publication vers l'extérieur** : une seule vue SharePoint figée, pas d'API de métriques, pas de connecteur Power BI / Excel / Teams | — | Les statistiques se recopient à la main |
| L16 | **Pas d'accès direction autonome** : la direction dépend d'un deck envoyé ; aucun espace exécutif en libre consultation | — | Décisions prises sur des données datées |
| L17 | **Pas de démarche design** : 37 pages construites au fil de l'eau, densité « poste de travail », pas de parcours utilisateur formalisé, pas d'accessibilité vérifiée | `public/*.html` | Adoption inégale, formation lourde |
| L18 | **Pas de gouvernance produit** : pas de registre de demandes ni de décisions, pas de comité, pas d'indicateurs d'adoption | — | Les évolutions se décident en conversation |

---

## 4. Diagnostic : pourquoi une version 2.0 et non des correctifs

Les dix-huit lacunes se regroupent en quatre causes racines : (1) **l'outil a grandi par accrétion** sans socle commun (données, seuils, codes, base) ; (2) **l'exploitation n'a jamais été industrialisée** (pas de CI, pas d'installateur graphique, pas d'observabilité) ; (3) **le produit n'a pas été pensé pour ses publics** (direction, terrain, parties prenantes externes à l'IT) mais pour son auteur ; (4) **il n'existe aucune instance de décision** sur ce que la plateforme mesure et montre.

Des correctifs ponctuels ne traitent aucune de ces causes. La version 2.0 les traite toutes, **en conservant 100 % des capacités existantes** et en les faisant passer sur un socle commun.

---

## 5. La cible : SDP-Dashboard 2.0, produit d'entreprise de pilotage des opérations IT

### 5.1 Principes non négociables

1. **Continuité** : aucune régression sur les goldens, les tests de fidélité et les formules ITSM ; toutes les données migrées avec simulation, sauvegarde et retour arrière.
2. **Une donnée, une définition, une diffusion** : chaque chiffre vient d'un registre de métriques, sous une politique RAG unique, avec la date de ses données.
3. **Paramétrable par les métiers** : trackers, tableaux de bord, seuils, règles d'alerte, modèles de rapport, cadences de réunion et connecteurs de publication sont des données, pas du code.
4. **Observable et résilient** : chaque job, envoi, génération et publication laisse une trace ; aucun échec silencieux.
5. **Terrain d'abord** : saisie hors-ligne sur téléphone en moins de 20 minutes par semaine et par site.
6. **Ouvert** : API de métriques documentée, connecteurs de publication (SharePoint, Power BI, Teams, e-mail, webhook), vues embarquables.
7. **Sécurisé par défaut** : SSO + MFA délégués à Entra, secrets chiffrés obligatoires, CSP stricte, dépendances auditées, journal d'audit complet.
8. **Installable par un administrateur système** en vingt minutes, avec un gestionnaire graphique pour l'exploitation quotidienne.
9. **Conçu avec ses utilisateurs** : un comité d'experts, d'utilisateurs et de design conçoit, décide et réceptionne chaque étape.
10. **Bilingue** EN/FR, accessible (WCAG 2.2 AA sur les écrans direction et terrain).

### 5.2 Architecture cible

```
   Direction · Comité · Coordinateurs · Techniciens · Parties prenantes (lien partagé)
          │                 │                │              │
   ┌──────▼─────────────────▼────────────────▼──────────────▼──────────────────────────┐
   │ ESPACE DIRECTION · COCKPIT DE RÉUNION · PORTEFEUILLE · RAPPORTS IA · NOTIFICATIONS │
   │ BUILDER DE TRACKERS · COMPOSEUR DE TABLEAUX DE BORD · APPLICATION TERRAIN (PWA)   │
   ├──────────────────────────────────────────────────────────────────────────────────────┤
   │ Registre KPI · Politiques RAG · Référentiel sites · Registre des actions · RFI/DEC  │
   │ API de métriques (REST, OData) · Connecteurs de publication (SharePoint, Power BI,  │
   │ Teams, e-mail, webhook, Excel) · Vues embarquables signées                           │
   ├──────────────────────────────────────────────────────────────────────────────────────┤
   │ Runner de synchronisation (SDP · Analytics Plus · OpManager · Meraki · M365)        │
   │ PostgreSQL seul · Migrateur de schéma · Audit · Sécurité · Sauvegardes · Réplica    │
   ├──────────────────────────────────────────────────────────────────────────────────────┤
   │ INSTALLATEUR WINDOWS (.exe, assistant graphique) · GESTIONNAIRE (.exe, service,     │
   │ mises à jour, sauvegardes, diagnostics, santé)                                       │
   └──────────────────────────────────────────────────────────────────────────────────────┘
```

### 5.3 Capacités cibles

| Domaine | v1.11 aujourd'hui | **2.0 cible** |
|---|---|---|
| Synchronisation | intégrale, 1 rejeu, silencieuse | runner unique : verrou, rejeu exponentiel, delta, garde anti-vide, journal, santé affichée, alerte d'échec |
| Base de données | SQLite + PostgreSQL | PostgreSQL seul, schéma versionné appliqué automatiquement, réplica, sauvegardes testées |
| KPI et seuils | dispersés, 5 échelles | dictionnaire KPI publié (≥ 40 métriques), ≤ 3 politiques RAG lues par tous les écrans et exports |
| Trackers | 1 programme figé | builder métier, trackers versionnés, items liés automatiquement aux sources |
| Tableaux de bord | 37 pages figées | composeur, 3 audiences (direction, site, terrain), templates |
| Espace direction | deck envoyé | espace exécutif en libre accès : feux par objectif, tendances, décisions en attente, « où en est-on », sur ordinateur et mobile |
| Réunions ops | PowerPoint | cockpit : agenda généré, mode séance, décisions et actions en direct, PV automatique |
| Roadmap et projets | outil personnel | portefeuille partagé : programmes → objectifs → projets → jalons → actions, preuves automatiques, Gantt, risques |
| Rapports | PPTX + e-mails, commentaire limité | générateur par modèle et audience, analyse IA (locale par défaut) relue, journal des versions |
| Engagement | annuaire par site | règles d'alerte, abonnements, centre de notifications, digest, partage par lien signé, accusés de lecture |
| Publication externe | une vue SharePoint | API de métriques REST + OData, connecteurs SharePoint / Power BI / Teams / e-mail / webhook, vues embarquables |
| Sécurité | moyenne, sans MFA | SSO Entra `only` + MFA par accès conditionnel, provisionnement des groupes, secrets obligatoires, CSP stricte, SCA/SAST, journal 12 mois |
| Terrain | rien | PWA hors-ligne : inspections et tracker sur téléphone, photos compressées envoyées par morceaux |
| Installation | ZIP + scripts | **installateur `.exe`** avec assistant graphique et **gestionnaire `.exe`** (service, mises à jour, sauvegardes, diagnostics) |
| Design | au fil de l'eau | système de design unifié, parcours utilisateurs validés par un designer, accessibilité AA |
| Gouvernance | conversation | comité produit, RFI et décisions dans l'outil, tableau de bord de gouvernance |
| Qualité | 2 372 tests, pas de CI | CI SQLite + PostgreSQL, lint, SCA, paquets signés produits par la CI, `server.js` < 3 000 lignes |

### 5.4 L'installateur et le gestionnaire Windows

L'installateur PowerShell en console existant (`tools/installer/`) est remplacé par deux exécutables modernes, construits par la CI et signés :

| Composant | Rôle | Technologie recommandée |
|---|---|---|
| **SDP-Dashboard Setup.exe** | Assistant graphique en 7 écrans : accueil et licence, détection de l'existant (version, base, service), choix du mode (installation neuve, mise à jour, réparation, réinstallation), dossiers et port, PostgreSQL (embarqué ou existant, mot de passe masqué), compte de service et certificat IIS/TLS, résumé et progression ; sauvegarde automatique avant toute mise à jour, retour arrière automatique en cas d'échec, journal d'installation lisible | Inno Setup ou WiX v4 (MSI) avec interface moderne ; Node, PM2, PostgreSQL et Python embarqués comme aujourd'hui ; aucune dépendance réseau |
| **SDP-Dashboard Manager.exe** | Application de bureau pour l'administrateur : état du service et redémarrage, santé des synchronisations, sauvegardes et restauration avec écran rouge de confirmation, mises à jour (vérification, téléchargement du paquet signé, application, retour arrière), diagnostics (ports, certificats, espace disque, versions), rotation des secrets, export du dossier de support ; icône de zone de notification | Application .NET (WinUI 3 / WPF) ou Electron-Tauri ; s'appuie sur les mêmes scripts que l'installateur et sur l'API de santé de la plateforme |
| **Paquet de mise à jour** | Produit par la CI à partir d'un tag, signé, avec manifeste (version, fichiers, migrations, note de version) ; appliqué par le Manager ou par Setup en mode mise à jour | ZIP signé + manifeste JSON |

Exigences : installation neuve en moins de vingt minutes par un administrateur système sans connaissance du code ; mise à jour en moins de cinq minutes avec retour arrière ; désinstallation propre conservant les données sur demande ; compatibilité Windows Server 2019+ ; documentation d'exploitation bilingue intégrée au Manager.

### 5.5 Le comité produit

| Siège | Nombre | Profil | Responsabilité |
|---|---|---|---|
| **Présidence** | 1 | Service & Support Manager (propriétaire des opérations IT) | ordre du jour, décisions, arbitrages, escalade au sponsor |
| **Experts** | 3 | architecte / développeur principal ; ingénieur données / DBA ; expert sécurité | faisabilité, modèle de données, sécurité, effort |
| **Utilisateurs** | 4 | deux coordinateurs de site (rotation semestrielle), un technicien terrain, un représentant de la direction (lecteur des tableaux de bord exécutifs) | réalité terrain, utilité, temps de saisie, lisibilité direction |
| **Designer expert** | 1 | UX/UI (interne ou prestataire) | parcours utilisateurs, système de design, accessibilité, maquettes, tests d'utilisabilité |
| **Analyste métier / reporting** | 1 | propriétaire des rapports exécutifs | pertinence des KPI, fidélité des decks, SOP |
| **Secrétariat** (non votant) | 1 | PMO | comptes rendus, registre RFI/DEC, suivi des actions |

Cadence : triage bimensuel (RFI, santé des synchros), revue mensuelle (conception et réception des étapes), planification trimestrielle, clinique terrain mensuelle sur site, atelier design à chaque étape touchant un écran. Quorum : présidence + un expert + un utilisateur + le designer pour tout sujet d'interface. Chaque décision porte un identifiant `DEC-AAAA-NNN` cité dans les commits qui l'appliquent.

---

## 6. Le prompt de développement — dix étapes conçues, décidées et réceptionnées par le comité

### 6.1 Boucle de travail

```
 ① CONCEPTION — l'IA produit un dossier de conception (annexe A) avec maquettes du designer
    et points d'arbitrage numérotés.
 ② DÉCISION — le comité examine, tranche chaque point (DEC-), amende le dossier.
 ③ RÉALISATION — l'IA implémente par petits incréments (une RFI = une branche = une PR),
    tests en CI verts, documentation et aide bilingues à jour, démonstration enregistrée.
 ④ RÉCEPTION — le comité vérifie les critères de sortie ; utilisateurs et designer testent ;
    les écarts deviennent des RFI.
 ⑤ MISE EN PRODUCTION — le CAB autorise ; le paquet signé produit par la CI est appliqué
    par le Manager ; l'IA rédige la note de version.
```

Aucune étape ne démarre avant la réception de la précédente ; la conception de l'étape suivante peut être anticipée.

### 6.2 Préambule du prompt (à placer en tête de chaque commande)

> **Rôle.** Tu es l'architecte-développeur principal de SDP-Dashboard, plateforme de pilotage des opérations IT d'Endeavour Mining : Node 22, Express, PostgreSQL 17, pages HTML/JS avec Chart.js, React pour le tracker, pptxgenjs, nodemailer ; intégrations Zoho ServiceDesk Plus Cloud et Analytics Plus, OpManager, Meraki, Microsoft 365. L'historique et les règles métier sont dans `CLAUDE.md` et dans `docs/`.
>
> **Mission.** Construire la version 2.0 décrite au chapitre 5 du document d'étude, en dix étapes, **sans jamais régresser** sur les capacités de la v1.11.
>
> **Règles de travail.**
> 1. Avant tout code : livre un **dossier de conception** en français (`docs/design/ETAPE-NN-<sujet>.md`, plan en annexe A) avec les **points d'arbitrage** que le comité doit trancher et, pour tout écran, les maquettes à soumettre au designer. N'implémente qu'après la décision `DEC-`, citée dans chaque commit.
> 2. Respecte les règles maison : ne jamais écrire `user.site_id === x` (passer par `services/userSites.js`) ; mettre à jour par identifiant, jamais supprimer puis réinsérer ; recalculer depuis les compteurs, jamais moyenner des scores ; `null` = non mesuré ≠ `0` ; jamais une date inventée ; tout nouveau statut terminal rejoint `StatusTransfer.DONE` et les listes SQL ; `CAST(? AS TEXT)` pour un `?` seul sur PostgreSQL ; les jobs planifiés ne lèvent jamais et ne se chevauchent jamais ; secrets en écriture seule et chiffrés ; PPTX via `fixComboChartAxes` ; montants du parc réservés à admin+ ; les goldens ne se régénèrent qu'après une décision de changement visuel.
> 3. **Tests obligatoires** : unitaires pour tout module pur ; smoke pour toute route (démarrage sur SQLite via `tests/_http-fetch.js`) ; **parité PostgreSQL** pour tout lecteur ou écrivain ; `npm test` vert sur SQLite et PostgreSQL avant chaque PR ; tout test qui lit un fichier du dépôt normalise les fins de ligne.
> 4. **Documentation obligatoire** : spécification et SOP dans `docs/`, ADR dans `docs/adr/`, `CHANGELOG.md`, aide en ligne `public/help.html` **en anglais et en français** ; `CLAUDE.md` est réduit, jamais allongé.
> 5. **Sécurité par défaut** : aucun secret dans une URL, un log, un test ou un commit ; aucune nouvelle page avec script inline ; toute route derrière une session et un contrôle de rôle explicite ; toute entrée validée côté serveur.
> 6. **Continuité** : toute capacité touchée garde son contrat (routes, formats d'export, fixtures) ; toute migration de données comporte une simulation, une sauvegarde, un fonctionnement en parallèle mesuré et un retour arrière.
> 7. **Design** : toute interface respecte le système de design (`public/_tokens.css`, `public/brand`) étendu par le designer ; responsive ; WCAG 2.2 AA sur les écrans direction et terrain ; bilingue EN/FR.
> 8. **Livraison** : une RFI = une branche = une PR avec description, captures ou enregistrement, note de version ; les paquets de production sont produits et signés par la CI, jamais à la main.
> 9. **Honnêteté** : si un critère de sortie n'est pas atteint, dis-le et propose un plan ; ne contourne jamais un test ; ne marque rien « fait » sans preuve.
> 10. **Langue** : code et commits en anglais ; dossiers de conception, aide terrain et comptes rendus en français.

### 6.3 Les dix étapes

Chaque fiche : **Objectif · Périmètre · Conception à soumettre (points d'arbitrage) · Critères de réception · Gain**.

---

#### Étape 1 — Synchronisations fiables et observables (L1, L2)

**Objectif.** Un moteur de synchronisation unique pour les sept familles de jobs (tickets, changements/CAB, enquête CSAT, parc, OpManager, Meraki, alertes SLA) et la sauvegarde.

**Périmètre.** Module `services/sync/` : verrou de chevauchement, rejeu exponentiel avec `Retry-After`, classification des erreurs transitoires, filtre « modifié depuis » (watermark) pour tickets et changements, dédoublonnage, garde anti-vide (part minimale de lignes attendues), nettoyage PII, journal `sync_runs`, santé `/api/sync/health` ; adaptateur par job ; suppression logique gardée pour le parc ; gestion du 429 Meraki ; miroir des échecs dans le journal système ; écran « Santé des synchronisations » ; alerte Teams/e-mail après deux échecs consécutifs ou dépassement de la fenêtre de fraîcheur.

**Conception à soumettre.** Cadence par source (quota Zoho, repli bulk) · seuils de fraîcheur · rétention des runs · comportement sur export tronqué · destinataires des alertes.

**Critères de réception.** 100 % des jobs visibles dans la santé ; un export tronqué simulé ne supprime rien ; succès ≥ 99 % sur 4 semaines ; alerte reçue lors d'un échec provoqué ; parité PostgreSQL verte.

**Gain.** Fin du risque de suppression massive ; pannes visibles en moins de 10 minutes ; charge Zoho divisée par 5 à 10.

---

#### Étape 2 — PostgreSQL seul, migrateur de schéma, CI complète (L5, L6 partiel)

**Objectif.** Une seule base, un schéma versionné appliqué automatiquement, une CI qui prouve la parité.

**Périmètre.** Migrateur `db/migrate.js` (journal `schema_migrations`, idempotent, exécuté au démarrage, par l'installateur et en CI) ; bascule du parc vers PostgreSQL ; `ORDER BY` déterministes ; retrait des forks SQLite module par module (SQLite réservé aux tests unitaires) ; GitHub Actions avec service PostgreSQL, lint, couverture ; sauvegarde quotidienne chiffrée via le runner ; exercice de restauration trimestriel documenté.

**Conception à soumettre.** Ordre de retrait des forks · fenêtre de bascule du parc · stratégie de sauvegarde (rétention, clé hors sauvegarde) · réplica (ici ou étape 10).

**Critères de réception.** Zéro SQLite en production ; CI verte sur les deux bases ; migrateur rejouable sans effet ; restauration testée sur instance jetable.

**Gain.** Moitié moins de code de persistance ; fin des divergences entre bases ; schéma auditable.

---

#### Étape 3 — Dictionnaire KPI, convergence RAG, référentiel sites (L3, L4)

**Objectif.** Un chiffre = une définition = une couleur, partout.

**Périmètre.** Tables `metric_registry` et `kpi_rag_policies` ; API `GET /api/metrics/registry` et `GET /api/metrics/:key?site=&window=` dispatchant vers les lecteurs existants ; enregistrement des ≥ 40 KPI existants (formule, fenêtre, propriétaire, source) ; module `services/kpiRag.js` lu par tous les écrans et exports ; suppression des seuils dupliqués ; `sites` + `site_module_codes` comme clé unique, suppression des alias en dur ; dictionnaire KPI publié dans l'aide, bilingue.

**Conception à soumettre.** **Décision majeure** : convergence des cinq échelles vers ≤ 3 politiques, avec tableau d'impact avant/après par site · sort des deux modèles « 6 dimensions » · fenêtres glissantes à la place des dates d'ancrage · fermeture des cases « À CONFIRMER ».

**Critères de réception.** Chaque widget et chaque cellule PPTX résout vers une métrique enregistrée ; aucune échelle hors registre (test statique) ; rapport d'impact approuvé.

**Gain.** Fin des contradictions entre écrans ; le comité gouverne les KPI.

---

#### Étape 4 — Sécurité, SSO et MFA (L9)

**Objectif.** Plateforme sécurisée par défaut, authentification d'entreprise.

**Périmètre.** Clé de chiffrement obligatoire en production avec dérivation scrypt et re-chiffrement ; clés API hors URL ; TLS vérifié vers OpManager ; comparaison de clés en temps constant ; remplacement de la bibliothèque Excel non maintenue ; CSP sans script inline sur toute nouvelle page et plan de retrait sur l'existant ; HSTS, cookies `Secure/HttpOnly/SameSite`, limiteur de débit persistant ; `npm audit`, SCA et SAST en CI, branches protégées, revue obligatoire ; SSO Entra en mode `available` puis `only` ; **MFA déléguée aux politiques d'accès conditionnel Entra** ; synchronisation des groupes Entra → rôles et sites ; désactivation automatique au départ ; compte de secours journalisé ; journal d'audit étendu, conservé 12 mois ; procédure de réponse à incident ; test d'intrusion.

**Conception à soumettre.** Correspondance groupes Entra ↔ rôles/sites · durée de session · politique MFA · calendrier de la fenêtre `available` · rotation des secrets · périmètre du test d'intrusion.

**Critères de réception.** Aucune vulnérabilité haute ; 100 % des comptes en SSO avec MFA ; break-glass testé ; aucun secret en clair dans une sauvegarde ; tests d'autorisation par rôle sur chaque route.

**Gain.** Conformité, fin des mots de passe locaux, traçabilité complète.

---

#### Étape 5 — Installateur et gestionnaire Windows, modularisation, paquets signés (L6, L10, L11)

**Objectif.** Un produit installable et exploitable par un administrateur système ; un code maintenable par une équipe.

**Périmètre.** **Setup.exe** et **Manager.exe** décrits au §5.4, construits et signés par la CI ; paquet de mise à jour avec manifeste ; migrateur de schéma appelé par l'installateur ; retour arrière automatique ; retrait des scripts `.cmd` et du registre de lots gelés après la première livraison CI ; extraction de `server.js` vers `routes/*` (≥ 600 lignes par sprint, cible < 3 000) ; registre unique des tâches planifiées ; étape de build (esbuild), fin de la compilation dans le navigateur ; extraction des règles de `CLAUDE.md` vers les SOP et ADR, `CLAUDE.md` réduit à un index.

**Conception à soumettre.** Technologie de l'installateur (Inno Setup / WiX) et du Manager (.NET / Tauri) · écrans de l'assistant (maquettes designer) · format et signature du paquet · politique de version · découpage par domaine du code · liste des ADR initiaux.

**Critères de réception.** Installation neuve < 20 min par un administrateur sans connaissance du code, sur une machine vierge ; mise à jour < 5 min avec retour arrière démontré ; première mise en production depuis un paquet CI ; `server.js` < 3 000 lignes ; aucune compilation dans le navigateur.

**Gain.** Produit livrable à un autre site ou une autre entité ; exploitation sans l'auteur ; production identique au tag.

---

#### Étape 6 — Système de design, espace direction et composeur de tableaux de bord (L16, L17, L12 partiel)

**Objectif.** Une expérience cohérente par audience ; la direction consulte l'avancement en libre accès.

**Périmètre.** Atelier design : parcours utilisateurs (direction, coordinateur, technicien, partie prenante), système de design étendu (composants, états, densités, mode mobile, accessibilité AA), bibliothèque de maquettes ; **espace direction** : page d'accueil exécutive (feux par objectif, tendances 13 semaines, incidents majeurs, décisions en attente, « où en est-on » par site et par programme), consultation sur mobile, aucune saisie, données datées ; **composeur de tableaux de bord** (grille, catalogue de widgets — KPI, tendance, barres, table, heatmap, grille RAG, tracker, texte, actions —, filtres, aperçu par audience, publication versionnée) et moteur de rendu sur le shell commun ; remplacement progressif des 37 pages figées par des définitions ; tests d'utilisabilité avec les utilisateurs du comité.

**Conception à soumettre.** Parcours et maquettes validés par le designer · contenu de l'espace direction · droits de publication · liste des 10 premières pages remplacées.

**Critères de réception.** Espace direction utilisé chaque semaine par ≥ 3 membres de la direction (journal des vues) ; ≥ 5 tableaux de bord publiés par des membres du comité sans développeur ; score d'utilisabilité (SUS) ≥ 75 ; audit AA sans défaut bloquant.

**Gain.** La direction n'attend plus un deck ; cohérence visuelle ; adoption facilitée.

---

#### Étape 7 — Builder de trackers et migration du tracker 2026 (L7)

**Objectif.** Les métiers créent et versionnent leurs trackers ; le tracker historique est migré sans écart.

**Périmètre.** Modèle de définition (période, unités, groupes, items, types de KPI, pondérations, cibles) validé ; builder avec validation en ligne, score à blanc, revue → publication versionnée ; runtime de saisie par unité × période, verrouillage des mois clos, import xlsx ; **items liés automatiquement** aux sources (réunions, inspections, tickets) ; importeur du tracker 2026, fonctionnement en parallèle un mois, comparaison à ±0,1 pt, bascule, retrait des anciennes tables ; PPTX et Excel lisent le même moteur de score ; templates (dispatch terrain, déploiement matériel, maintenance de site, conformité réunions).

**Conception à soumettre.** Expérience du builder (maquettes) · droits · versionnage et retour arrière · plan de migration (dates, responsables, critères).

**Critères de réception.** ≥ 3 trackers créés sans développeur ; tracker 2026 migré sans écart ; aucune formule hors du moteur.

**Gain.** Nouveau tracker en une heure au lieu d'un sprint.

---

#### Étape 8 — Cockpit de réunion et portefeuille roadmap / projets (L12, L18)

**Objectif.** Réunions d'exploitation et roadmap pilotées dans l'outil, avec trace.

**Périmètre.** Cadences de réunion (type, site, jour, participants, préparateur) ; agenda généré (KPI, actions en retard, incidents majeurs, décisions en attente, RFI) ; mode séance plein écran, horodatage par point, saisie en direct des décisions et des actions rattachées à leur source ; PV automatique (HTML, PDF, e-mail) ; suivi inter-réunions ; **portefeuille** programmes → objectifs → projets → jalons → livrables → actions (propriétaires, statut, confiance, dates, budget, risques), preuves automatiques par métrique, Gantt avec dépendances et alertes de glissement, risques projet reliés aux incidents, rapport mensuel « état du portefeuille » ; **registre RFI et décisions dans l'outil** (formulaire, triage, scoring) ; tableau de bord de gouvernance (% jalons à l'heure, dérive moyenne, délai RFI → décision, adoption par rôle).

**Conception à soumettre.** Types de réunions et agendas types · rattachement des actions · modèle de portefeuille · migration du Roadmap Manager · qui crée une décision.

**Critères de réception.** Trois cadences réelles tenues un mois dans le cockpit avec PV automatique ; portefeuille saisi avec preuves automatiques sur ≥ 50 % des objectifs ; registre RFI utilisé par le comité.

**Gain.** Plus de diapositives manuelles ; décisions tracées ; roadmap reliée au terrain.

---

#### Étape 9 — Générateur de rapports IA, moteur d'engagement, publication externe (L13, L14, L15)

**Objectif.** Rapports générés avec analyse rédigée ; la bonne information au bon acteur ; statistiques publiées vers les systèmes externes.

**Périmètre.** Modèles de rapport par audience composés de widgets ; sorties HTML, PDF, PPTX, CSV ; couche d'analyse déterministe toujours disponible ; couche IA alimentée **uniquement** par les chiffres canoniques (clause anti-hallucination existante), ton par audience, bilingue, fournisseur **local par défaut** (Ollama, Mistral Nemo) avec option cloud anonymisée, brouillon jusqu'à relecture humaine, journal des versions, rapports golden ; **engagement** : règles d'alerte (métrique, périmètre, seuil, rémanence, canal, destinataires), abonnements, centre de notifications in-app, digest, partage par lien signé expirable, accusés de lecture, commentaire depuis la notification ; **publication externe** : API de métriques REST + OData documentée (clés d'API par consommateur, quotas, journal), connecteurs de publication vers SharePoint (listes et pages), Power BI (flux OData), Teams (cartes), e-mail, webhook, Excel planifié ; vues embarquables signées (iframe SharePoint) ; planification via le runner.

**Conception à soumettre.** **Décision souveraineté IA** (local / cloud, données autorisées, budget matériel) · modèles de rapport · règles de relecture · catalogue initial de ≥ 10 règles d'alerte · politique anti-bruit · connecteurs prioritaires et droits d'accès par consommateur externe · durée de validité des liens.

**Critères de réception.** Pack exécutif mensuel produit sans saisie manuelle, zéro divergence de chiffres, commentaire jugé utile par ≥ 80 % des relecteurs ; ≥ 10 règles actives avec < 5 % de faux positifs ; au moins un tableau de bord SharePoint et un rapport Power BI alimentés automatiquement ; aucune donnée PII hors site.

**Gain.** Heures de rédaction économisées ; réaction aux dérives en heures ; statistiques publiées sans recopie.

---

#### Étape 10 — Application terrain hors-ligne et résilience (L8)

**Objectif.** Saisie sur téléphone, hors connexion, sur tous les sites.

**Périmètre.** PWA installable (service worker, boîte d'envoi IndexedDB, estampille « données au ») ; inspections hors-ligne (photos ≤ 300 Ko, envoi par morceaux, `PUT` idempotent) ; saisie de tracker hors-ligne ; actions rapides (ticket SDP depuis un constat via l'API v3 en écriture — nouveau scope passé en CAB ; clôture ou transfert justifié) ; mode bas débit ; rôle `field-tech` ; pilote sur 3 sites, 6 semaines, cliniques terrain ; réplica PostgreSQL (RPO 15 min) et exercice de restauration.

**Conception à soumettre.** Sites pilotes · appareils · politique de conflit · taille maximale d'une inspection · scope d'écriture SDP.

**Critères de réception.** Inspection de 10 photos synchronisée en ≤ 2 min à 1 Mbit/s ; zéro perte sur coupures ; saisie hebdo ≤ 20 min sur 3 sites ; NPS techniciens ≥ +30 ; RPO 15 min démontré.

**Gain.** Données terrain complètes ; fin des pertes de saisie ; techniciens libérés de la re-saisie.

---

### 6.4 Séquencement

| Trimestre | Étapes | Jalon comité |
|---|---|---|
| T1 | 1 · 2 · 3 (conception de 4 et 5 anticipée) | « Socle fiable » : synchros, base, KPI |
| T2 | 4 · 5 · 6 (conception) | « Produit installable et sécurisé » ; SSO `only` ; premier paquet CI appliqué par le Manager |
| T3 | 6 · 7 · 8 | « Pilotage » : espace direction, builders, cockpit, portefeuille |
| T4 | 9 · 10 | « Automatisé, ouvert et terrain » : rapports IA, engagement, publication externe, PWA |

Étapes 1 à 3 : prérequis stricts. 4 et 5 en parallèle de 6. 7, 8 et 9 dépendent du registre KPI et du composeur. 10 dépend de 6.

### 6.5 Mode de développement : tout est réalisé par un agent IA

La version 2.0 est **développée intégralement par un agent IA** (Claude Code ou équivalent) ; les humains conçoivent, décident, testent et réceptionnent. Ce choix impose un cadre précis.

| Sujet | Règle |
|---|---|
| **Autonomie** | L'agent travaille par incréments courts (une RFI = une branche = une PR) et ne demande une décision humaine que sur les points d'arbitrage listés dans le dossier de conception. Hors arbitrage, il choisit l'option recommandée et la documente. |
| **Garde-fous techniques** | CI obligatoire (tests SQLite + PostgreSQL, lint, SCA/SAST) : une PR rouge ne se fusionne pas ; branches protégées ; aucun accès de l'agent à la production ni aux secrets réels (`.env` d'exemple seulement) ; les paquets sont produits par la CI, jamais par l'agent. |
| **Preuves** | Chaque PR contient la sortie de `npm test`, les captures ou l'enregistrement de démonstration, la liste des critères de réception couverts et non couverts. L'agent ne déclare rien « fait » sans preuve et ne contourne jamais un test. |
| **Revue** | Une seconde IA de revue indépendante (revue adversariale des chemins d'échec, de la sécurité et des régressions) est exécutée sur chaque PR avant la revue humaine ; ses constats sont traités ou motivés. |
| **Mémoire du projet** | L'agent lit `docs/` et les ADR au début de chaque session ; il met à jour `CLAUDE.md` (état courant, index) et jamais un journal chronologique ; chaque décision `DEC-` est citée dans les commits. |
| **Design** | L'agent produit les maquettes (HTML statique ou images) soumises au designer ; il n'implémente un écran qu'après validation ; il applique le système de design et vérifie l'accessibilité par outillage (axe) en CI. |
| **Terrain** | L'agent ne peut pas tester sur site : les critères terrain (temps de saisie, coupures réseau, appareils) sont réceptionnés par les utilisateurs du comité, et leurs écarts reviennent à l'agent sous forme de RFI. |
| **Limites déclarées** | L'agent signale explicitement ce qu'il ne peut pas faire seul : enregistrement d'application Entra, signature de code, achat de matériel d'inférence, accès aux API de production, tests sur appareils réels. Ces actions sont assignées à un humain dans le dossier de conception. |
| **Cadence** | L'agent avance en continu ; le comité réceptionne par étape. Le sponsor peut à tout moment demander un état d'avancement : l'agent le produit à partir du registre RFI/DEC et de la CI, jamais de mémoire. |


---

## 7. Capacités et gains une fois les dix étapes livrées

| Indicateur | v1.11 | 2.0 livrée | Mesure |
|---|---|---|---|
| Jobs de synchronisation observables | 1 sur 7 | 7 sur 7 + sauvegarde | écran de santé |
| Risque de suppression massive sur export tronqué | présent | éliminé | test en CI |
| Délai de détection d'une panne de synchro | semaines | < 10 min | alerte |
| Appels Zoho par jour | ~72 intégraux | ~15 delta | journal des runs |
| Bases de données | 2 | 1 | production |
| Échelles RAG | 5 | ≤ 3, dans un registre | test statique |
| KPI documentés (formule, propriétaire) | 4 | ≥ 40 | registre |
| Vocabulaires de codes de site | 3 | 1 | référentiel |
| Trackers sans développeur | 0 | illimité, versionnés | builder |
| Tableaux de bord | 37 pages figées | définitions versionnées, 3 audiences | composeur |
| Accès direction | deck envoyé | espace exécutif en libre accès, mobile | journal des vues |
| Réunions ops outillées | 0 | toutes les cadences, PV automatique | cockpit |
| Décisions tracées | 0 | 100 % | registre DEC |
| Roadmap | personnelle | portefeuille partagé avec preuves | module |
| Rapports avec analyse rédigée | 0 | tous les modèles, IA locale relue | générateur |
| Règles d'alerte paramétrables | 0 | ≥ 10 | règles |
| Publication externe | 1 vue SharePoint | API + OData + connecteurs SharePoint / Power BI / Teams / e-mail / webhook | connecteurs |
| Partage sécurisé, accusés de lecture | non | oui | registre des envois |
| MFA | aucune | obligatoire via Entra | accès conditionnel |
| Vulnérabilités hautes connues | plusieurs | 0 | SCA/SAST |
| Installation | ZIP + scripts, par l'auteur | Setup.exe < 20 min, par un administrateur | pilote d'installation |
| Mise à jour | manuelle, sans retour arrière | Manager.exe < 5 min, retour arrière | démonstration |
| Saisie hors-ligne sur téléphone | non | inspections + tracker | PWA |
| Taille d'une inspection envoyée | jusqu'à 100 Mo | morceaux ≤ 300 Ko | blob store |
| Accessibilité | non vérifiée | AA sur direction et terrain | audit |
| `server.js` | 9 164 lignes | < 3 000 | `wc -l` |
| Compilation dans le navigateur | oui | non | build CI |
| CI | aucune | SQLite + PostgreSQL + lint + SCA + paquet signé | GitHub Actions |
| Connaissance opérationnelle | journal de 6 166 lignes | SOP, ADR, dictionnaire, `CLAUDE.md` < 800 lignes | dépôt |
| Temps de saisie hebdo par site | non mesuré | ≤ 20 min | pilote |

**Pour chaque acteur** : la direction obtient un espace exécutif en libre accès, un pack mensuel avec analyse relue et une roadmap avec preuves ; le comité gouverne KPI, trackers, tableaux de bord et décisions dans l'outil ; les coordinateurs disposent d'un cockpit de réunion, d'alertes ciblées et d'un digest ; les techniciens d'une application hors-ligne ; l'équipe plateforme d'une base unique, d'un code modulaire, d'une CI et d'un installateur ; les parties prenantes externes de rapports partagés, d'abonnements et de connecteurs vers leurs propres outils de reporting.

---

## 8. Décisions demandées à la direction

1. Créer le comité produit (§5.5) et nommer ses sièges, dont le designer expert et le représentant de la direction.
2. Valider le séquencement (§6.4) et l'équipe sur 12 mois : 1 architecte, 1 développeur front à partir du T2, 1 ingénieur données à mi-temps, 1 analyste métier, 1 designer (prestation ou interne), 2 techniciens à 10 %.
3. Autoriser l'enregistrement d'application Entra, l'activation du SSO et la politique MFA par accès conditionnel (étape 4).
4. Trancher la souveraineté IA et le budget matériel associé (étape 9).
5. Choisir les connecteurs de publication prioritaires (SharePoint, Power BI, autres) et les consommateurs externes autorisés (étape 9).
6. Désigner les trois sites pilotes (étape 10).

---

---

## 9. Prompt kit (English) — copy-paste `/goal` and `/instruction` blocks, step by step

This chapter is the operational version of chapter 6 for the AI development agent. Use it in this order: paste **9.1** once at the start of every session; then, for each step, paste the **`/goal`** block to obtain the design dossier, let the committee decide, and paste the **`/instruction`** block (filled with the `DEC-` ids) to build. Every block is self-contained.

### 9.1 Session preamble (paste first, every session)

```
/goal
You are the lead architect-developer of SDP-Dashboard, the IT operations platform of Endeavour
Mining (Node 22, Express, PostgreSQL 17, HTML/JS pages with Chart.js, React for the tracker,
pptxgenjs, nodemailer; integrations: Zoho ServiceDesk Plus Cloud + Analytics Plus, OpManager,
Meraki, Microsoft 365). Read CLAUDE.md, docs/ and docs/adr/ before anything else.

Mission: build SDP-Dashboard 2.0 as described in docs/08 (chapter 5), in ten committee-gated
steps, never regressing v1.11 capabilities.

Working rules (binding):
1. Before any code, deliver a design dossier in French at docs/design/ETAPE-NN-<topic>.md using
   the Annex A template, with numbered ARBITRATION POINTS (recommended option stated) and, for any
   screen, mock-ups for the designer. Implement only after the committee's DEC- decisions; cite
   them in every commit.
2. House rules: never `user.site_id === x` (use services/userSites.js); update by id, never
   delete+reinsert; recompute from counters, never average scores; null = not measured ≠ 0; never
   invent a date; a new terminal status joins StatusTransfer.DONE and the SQL lists;
   `CAST(? AS TEXT)` for a lone `?` on PostgreSQL; scheduled jobs never throw and never overlap;
   secrets are write-only and encrypted; PPTX goes through fixComboChartAxes; asset money is
   admin+ only; goldens are regenerated only after a visual-change decision.
3. Tests: unit tests for every pure module; smoke tests for every route (boot on SQLite via
   tests/_http-fetch.js); PostgreSQL parity for every reader/writer; `npm test` green on both
   before any PR; tests that read repository files normalise line endings.
4. Docs: update docs/ (spec, SOP), docs/adr/, CHANGELOG.md and public/help.html in EN and FR;
   shrink CLAUDE.md, never grow it.
5. Security by default: no secret in a URL, log, test or commit; no inline script on new pages;
   every route behind a session and an explicit role check; server-side validation of all input.
6. Continuity: keep every touched contract (routes, export formats, fixtures); every data
   migration has a dry run, a backup, a measured parallel run and a rollback.
7. Design: apply the design system (public/_tokens.css, public/brand) as extended by the
   designer; responsive; WCAG 2.2 AA on executive and field screens; bilingual EN/FR.
8. Delivery: one RFI = one branch = one PR with description, screenshots or recording, release
   note; production packages are built and signed by CI, never by hand.
9. Honesty: if an acceptance criterion is not met, say so and propose a plan; never bypass a
   test; never mark anything done without evidence.
10. Language: code and commits in English; design dossiers, field help and minutes in French.
```

### 9.2 Step 1 — Reliable, observable synchronisation

```
/goal
Step 1. Make all scheduled jobs (Zoho requests / changes-CAB / survey, assets, Meridian,
OpManager, Meraki WAN sync + events + poller, Teams SLA poll, plus the DB backup) run through one
sync runner with overlap lock, exponential retry honouring Retry-After, transient-error
classification, client-side delta, truncation/empty-fetch guard, run log, failure mirrored to
system_log, consecutive-failure and staleness alerts (e-mail + Teams), and one merged health view
in System Logs. Produce docs/design/ETAPE-01-synchronisations.md with arbitration points:
cadence per source and Zoho quota, freshness window per job, truncation tolerance, alert
threshold and recipients, run-log retention. Acceptance: 100 % of jobs visible in
/api/sync/health; a simulated truncated export deletes nothing; alert received on a forced
failure; success ≥ 99 % over 4 weeks; PostgreSQL parity green.
```

```
/instruction
Step 1 — build. Decisions: DEC-2026-001 (tolerance 20 %), DEC-2026-002 (alert after 2
consecutive failures), DEC-2026-003 (freshness windows 3 h / 30 h / 1 h). Dossier approved:
docs/design/ETAPE-01-synchronisations.md v1.
1. Implement services/sync/jobs.js (registry + legacy wrapper), schedule.js (cron binding +
   hourly staleness sweep), alerts.js; wire server.js to schedule.start() and remove the
   per-job cron lines.
2. Add assertNotTruncated before every Zoho reconciliation and countTable in reports-db.
3. Merge sync_metadata into GET /api/sync/health with status ok|stale|error|never|idle; add the
   "Sync health" tab to public/system-logs.html.
4. Tests: registry, guard, schedule, smoke; run npm test on SQLite and PostgreSQL.
5. Update CHANGELOG.md, help.html (EN+FR), the dossier §13 checklist. Deliver the PR with evidence.
```

### 9.3 Step 2 — PostgreSQL only, schema migrator, full CI

```
/goal
Step 2. One database in production. Build db/migrate.js (schema_migrations journal, idempotent,
run at boot, by the installer and in CI) applying every db/postgres/** script; move assets to
PostgreSQL; add deterministic ORDER BY to the 9 non-deterministic readers; retire the SQLite forks
module by module (SQLite stays for unit tests); add a PostgreSQL service, lint and coverage to
GitHub Actions; schedule an encrypted nightly pg_dump through the runner; document a quarterly
restore drill. Dossier docs/design/ETAPE-02-postgresql.md with arbitration points: fork retirement
order, assets cut-over window, backup retention and key custody, replica now or in step 10.
Acceptance: zero SQLite in production; CI green on both engines; migrator replayable with no
effect; restore tested on a throwaway instance.
```

```
/instruction
Step 2 — build. Decisions: DEC-2026-0xx (fork order: assets → tracker → inspections → meetings →
reports), DEC-2026-0xx (backup retention), DEC-2026-0xx (replica deferred to step 10). Dossier
approved v1.
1. Implement db/migrate.js and call it from server boot and from the CI workflow; add the
   PostgreSQL service to .github/workflows/ci.yml with PG_TESTS_REQUIRED=1.
2. Cut assets over to PostgreSQL with a hardened copy script (dry run, counts before/after).
3. Fix the 9 readers' ordering; retire the SQLite forks in the decided order, one PR each.
4. Add the db.backup job to the registry; write docs/ops/RESTORE-DRILL.md (FR).
5. Tests, docs, CHANGELOG, PR with evidence.
```

### 9.4 Step 3 — KPI dictionary, RAG convergence, single site registry

```
/goal
Step 3. One figure = one definition = one colour. Load metric_registry and kpi_rag_policies at
boot; expose GET /api/metrics/registry and GET /api/metrics/:key?site=&window= dispatching to the
existing readers; register the ≥ 40 existing KPIs (formula, window, owner, source); make every
screen and export read services/kpiRag.js; delete duplicated thresholds; make sites +
site_module_codes the only key and delete hard-coded aliases; publish the bilingual KPI
dictionary in help. Dossier docs/design/ETAPE-03-kpi.md with arbitration points: convergence of
the five RAG scales to ≤ 3 policies with a before/after impact table per site; fate of the two
"6-dimension" models; rolling windows replacing anchor dates; closing "TO CONFIRM" site rows.
Acceptance: every widget and PPTX cell resolves to a registered metric; no scale outside the
registry (static test); impact report approved.
```

```
/instruction
Step 3 — build. Decisions: DEC-2026-0xx (RAG policies kept: tracker, programme score, SLA),
DEC-2026-0xx (6-dimension model retained: …), DEC-2026-0xx (site registry closed). Dossier
approved v1.
1. Boot-time loading of the registry tables; metrics API with reader contract and tests.
2. Register the KPIs from docs/templates/KPI-DEFINITION-TEMPLATE.md, one PR per module.
3. Replace each hard-coded threshold with kpiRag; add the static "no scale outside the registry"
   test; update the fidelity tests only where a DEC- changed the expected numbers.
4. Site registry: migration script with dry run; delete scoreboardAliases.js and inspection aliases.
5. Help ▸ KPI dictionary (EN+FR), CHANGELOG, PR with the impact table attached.
```

### 9.5 Step 4 — Security, SSO and MFA

```
/goal
Step 4. Secure by default. Mandatory config encryption key in production with scrypt derivation
and a re-encrypt script; API keys out of URLs; verified TLS to OpManager; constant-time key
comparison; replace the unmaintained Excel library; CSP without inline scripts on new pages and a
removal plan for existing ones; HSTS, Secure/HttpOnly/SameSite cookies, persistent rate limiter;
npm audit + SCA + SAST in CI, protected branches, mandatory review; Entra SSO `available` then
`only`; MFA delegated to Entra conditional access; Entra group → role/site provisioning; automatic
deactivation on leave; logged break-glass account; extended audit log kept 12 months; incident
response procedure; penetration test plan. Dossier docs/design/ETAPE-04-securite.md with
arbitration points: group ↔ role/site mapping, session duration, MFA policy, `available` window,
secret rotation, pentest scope. Acceptance: no high vulnerability; 100 % accounts on SSO with MFA;
break-glass tested; no plaintext secret in a backup; per-role authorisation test on every route.
```

```
/instruction
Step 4 — build. Decisions: DEC-2026-0xx (group mapping), DEC-2026-0xx (session 8 h), DEC-2026-0xx
(available window 3 weeks). Dossier approved v1. Human prerequisites completed: Entra app
registration (client id/secret in Admin), conditional-access policy created.
1. Hardening PRs in this order: secrets (key + scrypt + re-encrypt), transport (TLS, keys out of
   URLs, constant-time compare), HTTP headers and cookies, dependency replacement, CI gates.
2. SSO: group sync job in the registry, provisioning rules, deactivation, break-glass audit.
3. Generate the per-route authorisation test matrix from the route table; make it a CI gate.
4. Write docs/ops/INCIDENT-RESPONSE.md (FR), update help (EN+FR), CHANGELOG, PR with SCA/SAST
   reports attached.
```

### 9.6 Step 5 — Windows installer and manager, modular code, signed packages

```
/goal
Step 5. Ship SDP-Dashboard Setup.exe (7-screen graphical wizard: welcome/licence, detection of
the existing install, mode new/update/repair/reinstall, folders and port, PostgreSQL embedded or
existing with masked password, service account and IIS/TLS certificate, summary and progress;
automatic backup before update, automatic rollback on failure, readable log) and SDP-Dashboard
Manager.exe (service state and restart, sync health, backups and restore with red confirmation
screen, update check/download/apply/rollback of CI-signed packages, diagnostics, secret
rotation, support bundle, tray icon), both built and signed by CI; a versioned update package
with manifest; schema migrator called by the installer; removal of the .cmd scripts and the
frozen-lot register; extraction of server.js into routes/* (≥ 600 lines per sprint, target
< 3 000); one cron registry; esbuild build step ending in-browser Babel; extraction of CLAUDE.md
rules into SOP/ADR. Dossier docs/design/ETAPE-05-installateur.md with arbitration points:
installer technology (Inno Setup vs WiX), Manager technology (.NET WinUI/WPF vs Tauri), wizard
screens (designer mock-ups), package format and signing, versioning policy, domain split of the
code, initial ADR list. Acceptance: fresh install < 20 min by a sysadmin on a clean machine;
update < 5 min with demonstrated rollback; first production release from a CI package;
server.js < 3 000 lines; no in-browser compilation.
```

```
/instruction
Step 5 — build. Decisions: DEC-2026-0xx (Inno Setup), DEC-2026-0xx (Manager in .NET WPF),
DEC-2026-0xx (SemVer, signed ZIP + manifest.json). Dossier and wizard mock-ups approved.
Human prerequisites: code-signing certificate available to CI as a secret.
1. tools/installer-v2/: Inno script, embedded runtimes, migrator call, backup/rollback; CI job
   building and signing Setup.exe on tag.
2. tools/manager/: WPF app consuming /api/sync/health and the installer scripts; update flow
   with manifest verification and rollback.
3. Modularisation PRs (routes/*, cron registry already in place), esbuild for the React apps.
4. docs/ops/INSTALLATION.md and docs/ops/EXPLOITATION.md (FR) embedded in the Manager help;
   CHANGELOG; PR with install/update recordings.
```

### 9.7 Step 6 — Design system, executive space, dashboard composer

```
/goal
Step 6. With the designer: user journeys (executive, coordinator, technician, external
stakeholder), extended design system (components, states, densities, mobile, AA accessibility),
mock-up library. Build the executive space (home page with objective lights, 13-week trends,
major incidents, pending decisions, "where are we" per site and programme; mobile; read-only;
dated data) and the dashboard composer (grid, widget catalogue: kpi, trend, bar, table, heatmap,
ragGrid, trackerRag, text, actions; filters; preview per audience; versioned publish) with a
renderer on the shared shell; replace the first 10 fixed pages by definitions; usability tests
with committee users. Dossier docs/design/ETAPE-06-design-direction.md with arbitration points:
journeys and mock-ups, executive space content, publishing rights, first 10 pages replaced.
Acceptance: executive space used weekly by ≥ 3 executives (view log); ≥ 5 dashboards published by
committee members without a developer; SUS ≥ 75; AA audit without blocking defect.
```

```
/instruction
Step 6 — build. Decisions: DEC-2026-0xx (mock-ups approved), DEC-2026-0xx (publishers = admin +
committee role), DEC-2026-0xx (pages replaced: …). Dossier approved v1.
1. Design-system extension in public/brand + tokens; axe accessibility checks in CI.
2. Executive space: routes /api/metrics consumers only, no new formulas; page on the shared shell.
3. Composer: definitions stored in dashboard_definitions (versioned), validator already in
   services/dashboardWidgets.js, renderer, publish flow, view log.
4. Replace the decided pages; keep old URLs redirecting.
5. Usability test script (FR) for the committee; help (EN+FR); CHANGELOG; PR with screenshots.
```

### 9.8 Step 7 — Tracker builder and 2026 tracker migration

```
/goal
Step 7. Tracker builder for business users (period, units, groups, items, KPI types, weights,
targets; inline validation; dry-run score; review → versioned publish), entry runtime (unit ×
period grid, closed-month lock, xlsx import), items automatically bound to sources (meetings,
inspections, tickets), import of the 2026 IT Activity Tracker, one-month parallel run with
score comparison at ±0.1 pt, cut-over and retirement of the old tables, PPTX/Excel reading the
same scorer, templates (field dispatch, hardware deployment, site maintenance, meetings
compliance). Dossier docs/design/ETAPE-07-trackers.md with arbitration points: builder UX
(mock-ups), rights, versioning and rollback, migration plan (dates, owners, criteria).
Acceptance: ≥ 3 trackers created without a developer; 2026 tracker migrated with no deviation;
no formula outside the engine.
```

```
/instruction
Step 7 — build. Decisions: DEC-2026-0xx (mock-ups), DEC-2026-0xx (migration window), DEC-2026-0xx
(retire tracker_* tables after sign-off). Dossier approved v1.
1. Persist definitions in tracker_definitions/_versions; builder UI; runtime grid with month lock.
2. Source bindings: readers for meetings count, inspections count, ticket metrics.
3. Migration: fromLegacyInit import, parallel-run comparison report (CSV), cut-over switch.
4. PPTX/Excel on the engine scorer; templates seeded; help (EN+FR); CHANGELOG; PR with the
   comparison report attached.
```

### 9.9 Step 8 — Meeting cockpit, portfolio, RFI/decision register

```
/goal
Step 8. Meeting cadences (type, site, day, participants, preparer); generated agenda (KPIs,
overdue actions, major incidents, pending decisions, RFIs); full-screen session mode with
per-item timestamps, live decisions (DEC-) and actions linked to their source; automatic minutes
(HTML, PDF, e-mail); between-meetings follow-up; portfolio programmes → objectives → projects →
milestones → deliverables → actions with owners, status, confidence, dates, budget, risks;
automatic evidence per metric; Gantt with dependencies and slippage alerts; project risks linked
to incidents; monthly portfolio report; in-app RFI and decision register (form, triage,
scoring); governance dashboard. Dossier docs/design/ETAPE-08-cockpit-portefeuille.md with
arbitration points: meeting types and agendas, action attachment rules, portfolio model,
migration of the personal Roadmap Manager, who may create a decision. Acceptance: three real
cadences held one month in the cockpit with automatic minutes; portfolio with automatic
evidence on ≥ 50 % of objectives; RFI register used by the committee.
```

```
/instruction
Step 8 — build. Decisions: DEC-2026-0xx (cadences), DEC-2026-0xx (portfolio model),
DEC-2026-0xx (decision creators = chair + secretary). Dossier approved v1.
1. Tables meeting_cadences, meeting_sessions, decisions; agenda generator on the metrics API and
   the Site Actions register; session mode page; minutes generator reusing reportRender.
2. Portfolio tables and screens; evidence bindings generalising roadmapEvidence; Gantt; risks.
3. RFI/decision register UI on rfi_requests; governance dashboard definition.
4. Migrate Roadmap Manager data (dry run); help (EN+FR); CHANGELOG; PR with a recorded session.
```

### 9.10 Step 9 — AI report generator, engagement engine, external publishing

```
/goal
Step 9. Report templates per audience composed of widgets; HTML/PDF/PPTX/CSV outputs; always-on
deterministic analysis layer; AI commentary fed only by the canonical figures (anti-hallucination
clause), tone per audience, bilingual, local provider by default (Ollama, Mistral Nemo) with
optional anonymised cloud, draft until human review, version log, golden reports; engagement:
alert rules (metric, scope, threshold, cool-down, channel, recipients), subscriptions, in-app
notification centre, digest, signed expiring share links, read receipts, comment from the
notification; external publishing: documented REST + OData metrics API with per-consumer keys,
quotas and log; connectors to SharePoint (lists/pages), Power BI (OData feed), Teams cards,
e-mail, webhook, scheduled Excel; signed embeddable views; all scheduled through the runner.
Dossier docs/design/ETAPE-09-rapports-engagement-publication.md with arbitration points: AI
sovereignty and hardware budget, report templates, review rules, initial ≥ 10 alert rules,
anti-noise policy, priority connectors and external consumers, link validity. Acceptance:
monthly executive pack with zero manual entry and zero figure deviation; commentary rated useful
by ≥ 80 % of reviewers; ≥ 10 rules live with < 5 % false positives; one SharePoint dashboard and
one Power BI report fed automatically; no PII leaves the site.
```

```
/instruction
Step 9 — build. Decisions: DEC-2026-0xx (local inference, no cloud), DEC-2026-0xx (templates:
site weekly, exec monthly, council), DEC-2026-0xx (connectors: SharePoint + Power BI first).
Dossier approved v1. Human prerequisites: inference server available, SharePoint app
registration, Power BI workspace.
1. Report templates and generator on the dashboard definitions; deterministic analysis module;
   AI adapter behind AI_PROVIDER with canonical-figures prompt and review workflow; golden tests.
2. alert_rules, subscriptions, notification centre, digest job, share links, receipts.
3. Metrics API keys/quotas; OData endpoint; SharePoint and Power BI connectors as registry jobs;
   embeddable signed views.
4. Help (EN+FR), CHANGELOG, PR with a generated pack and connector evidence.
```

### 9.11 Step 10 — Offline field app and resilience

```
/goal
Step 10. Installable PWA (service worker, IndexedDB outbox, "data as of" stamp); offline
inspection capture (photos ≤ 300 KB, chunked upload to the blob store, idempotent PUT
/api/field/outbox/:uuid); offline tracker entry; quick actions (SDP ticket from a finding via API
v3 write scope — new OAuth scope through CAB; close/transfer with justification); low-bandwidth
mode; field-tech role; 3-site, 6-week pilot with field clinics; PostgreSQL streaming replica
(RPO 15 min) and restore drill. Dossier docs/design/ETAPE-10-terrain.md with arbitration points:
pilot sites, devices, conflict policy, maximum inspection size, SDP write scope. Acceptance:
10-photo inspection synced ≤ 2 min at 1 Mbit/s; zero loss across connectivity drops; weekly site
entry ≤ 20 min on 3 sites; technician NPS ≥ +30; RPO 15 min demonstrated.
```

```
/instruction
Step 10 — build. Decisions: DEC-2026-0xx (pilot sites), DEC-2026-0xx (last-write-wins + month
lock), DEC-2026-0xx (SDP write scope approved by CAB). Dossier approved v1.
1. esbuild field bundle under public/field/; service worker; outbox with idempotent sync.
2. Chunked photo upload to services/blobStore; inspection and tracker offline forms.
3. Quick actions; field-tech role through services/userSites.js; low-bandwidth dashboards
   (audience: field).
4. Replica and restore drill documented; pilot test script (FR) for the clinics; help (EN+FR);
   CHANGELOG; PR with device recordings.
```

### 9.12 Status request (paste any time)

```
/instruction
Produce a status report from the repository only (RFI/DEC register, docs/design/*, CI results,
CHANGELOG.md): for each of the ten steps give state (not started / designing / awaiting decision
/ building / awaiting acceptance / accepted), open arbitration points, acceptance criteria met
and not met with evidence, blockers assigned to humans. French, one page, no figure from memory.
```

---

## 10. Suivi de l'exécution et adoption

Ce chapitre est l'outil de pilotage du programme. Il est mis à jour par le secrétariat du comité à chaque revue mensuelle et republié avec le document ; l'agent IA le régénère à la demande à partir du dépôt (§9.12).

### 10.1 Tableau d'avancement des dix étapes

États : ⬜ non démarré · 🟦 en conception · 🟨 en attente de décision · 🟧 en réalisation · 🟪 en attente de réception · 🟩 réceptionné.

| # | Étape | État au 2026-10-19 | Dossier de conception | Décisions | Propriétaire comité | Jalon cible | Réception |
|---|---|---|---|---|---|---|---|
| 1 | Synchronisations fiables et observables | 🟪 implémenté, en attente de réception | `docs/design/ETAPE-01-synchronisations.md` v1 | à émettre (4 points) | Ingénieur données | T1 | — |
| 2 | PostgreSQL seul, migrateur, CI | 🟧 socle livré ; retrait des forks en cours | `docs/design/ETAPE-02-postgresql.md` v1 | à émettre (3 points) | Ingénieur données | T1 | — |
| 3 | Dictionnaire KPI, RAG, référentiel sites | 🟦 en conception | — | — | Analyste métier | T1 | — |
| 4 | Sécurité, SSO, MFA | ⬜ | — | — | Expert sécurité | T2 | — |
| 5 | Installateur et gestionnaire, modularisation | ⬜ | — | — | Architecte | T2 | — |
| 6 | Design, espace direction, composeur | ⬜ | — | — | Designer | T2–T3 | — |
| 7 | Builder de trackers, migration 2026 | ⬜ | — | — | Coordinateur de site | T3 | — |
| 8 | Cockpit de réunion, portefeuille, RFI | ⬜ | — | — | Présidence | T3 | — |
| 9 | Rapports IA, engagement, publication | ⬜ | — | — | Analyste métier | T4 | — |
| 10 | Terrain hors-ligne, résilience | ⬜ | — | — | Technicien terrain | T4 | — |

### 10.2 Registre des décisions (modèle)

| Id | Date | Étape | Point d'arbitrage | Décision | Option recommandée suivie ? | Votes / dissidence | Commits |
|---|---|---|---|---|---|---|---|
| DEC-2026-001 | | 1 | Tolérance de troncature | | | | |
| DEC-2026-002 | | 1 | Seuil d'alerte (échecs consécutifs) | | | | |
| DEC-2026-003 | | 1 | Fenêtres de fraîcheur par job | | | | |
| DEC-2026-004 | | 1 | Destinataires des alertes | | | | |
| DEC-2026-005 | | 2 | Ordre de retrait des forks SQLite | | | | |
| DEC-2026-006 | | 2 | Rétention des sauvegardes et garde de la clé | | | | |
| DEC-2026-007 | | 2 | Réplica maintenant ou à l'étape 10 | | | | |

### 10.3 Calendrier des revues

| Instance | Cadence | Prochaine séance | Ordre du jour type |
|---|---|---|---|
| Triage | bimensuel (semaines impaires, mardi) | à fixer | RFI nouvelles, santé des synchronisations, qualité des données |
| Revue mensuelle (Review Board) | 1ᵉʳ jeudi du mois | à fixer | Dossiers de conception, décisions, réceptions, tableau 10.1 |
| Planification trimestrielle | trimestre | à fixer | Jalons §6.4, charte, budget |
| Clinique terrain | mensuelle, sur site | à fixer | Démonstrations, irritants, RFI terrain |
| CAB | à chaque mise en production | — | Paquet CI signé, note de version, retour arrière |

### 10.4 Indicateurs du programme (revus chaque mois)

| Indicateur | Cible | Source |
|---|---|---|
| Étapes réceptionnées / planifiées | selon §6.4 | tableau 10.1 |
| Délai conception → décision | ≤ 14 jours | registre 10.2 |
| Écarts de réception ouverts | 0 au-delà de deux itérations | RFI |
| Suite de tests (SQLite + PostgreSQL) | 0 échec | CI |
| Dette sécurité ouverte (vulnérabilités hautes) | 0 à partir de l'étape 4 | SCA/SAST |
| Adoption : vues hebdomadaires par rôle | direction ≥ 3, sites 100 % | journal `*_viewed` |
| Temps de saisie hebdo par site | ≤ 20 min (étape 10) | pilote |

### 10.5 Risques du programme

| Risque | Probabilité | Impact | Mitigation | Propriétaire |
|---|---|---|---|---|
| Décisions du comité en retard → agent IA bloqué | moyenne | élevé | options recommandées par défaut, revue mensuelle tenue, décision par courriel entre deux séances | Présidence |
| Quota Zoho dépassé | faible | moyen | delta côté client, surveillance des replis, cadence par vue | Ingénieur données |
| Résistance au changement des coordinateurs | moyenne | élevé | sièges utilisateurs, cliniques terrain, migration à l'identique du tracker 2026 | Coordinateurs |
| Commentaire IA erroné transmis | faible | élevé | chiffres canoniques imposés, relecture humaine, journal des versions | Analyste métier |
| Prérequis humains non livrés (Entra, certificat de signature, matériel d'inférence) | moyenne | élevé | listés par étape dans chaque dossier, suivis au tableau 10.1 | Sponsor |
| Dépendance à un seul développeur humain | élevée | moyen | tout est documenté, CI, agent IA reproductible, dossiers de conception | Architecte |

## Annexe A — Gabarit de dossier de conception

```
# Dossier de conception — Étape NN — <sujet>        Version · Date · Auteur (IA) · Relecteur · Designer
1. Objectif et périmètre (rappel de la fiche, écarts)
2. Existant touché (fichiers, tables, routes, tests, goldens)
3. Modèle de données (DDL idempotent, migration, retour arrière)
4. API et contrats (routes, rôles, validation, erreurs)
5. Écrans : parcours, maquettes validées par le designer, audiences, bilingue, accessibilité, mobile
6. Règles métier (nouvelles et réaffirmées)
7. Plan de tests (unitaires, smoke, parité PostgreSQL, golden, utilisabilité, terrain)
8. Plan de migration et de fonctionnement en parallèle
9. Sécurité et données personnelles
10. Exploitation : installation, mise à jour, sauvegarde, supervision
11. Risques et mitigations
12. POINTS D'ARBITRAGE pour le comité (numérotés, option recommandée)
13. Critères de réception (mesurables, repris de la fiche)
```

## Annexe B — Gabarit de commande d'une étape

```
[Préambule 6.2]

Étape NN — <sujet>. Décisions du comité : DEC-2026-0xx (…), DEC-2026-0yy (…).
Dossier de conception approuvé : docs/design/ETAPE-NN-<sujet>.md v<k> ; maquettes validées le <date>.

Travail demandé :
 1. Implémente l'incrément <RFI-…> décrit au §<n> du dossier, sur la branche <nom>.
 2. Ajoute les tests du §7, dont la parité PostgreSQL et, pour un écran, les captures de référence.
 3. Mets à jour la documentation, l'aide en ligne (EN + FR) et CHANGELOG.md.
 4. Fournis : résumé des changements, résultat de `npm test`, captures ou enregistrement,
    liste des critères de réception couverts et non couverts.
N'élargis pas le périmètre ; signale tout point non prévu au dossier comme nouvelle RFI.
```

## Annexe C — Glossaire

| Terme | Définition |
|---|---|
| **CAB** | Change Advisory Board : instance qui autorise une mise en production |
| **CI** | Intégration continue : tests et contrôles automatiques exécutés à chaque modification du dépôt |
| **DEC-** | Identifiant d'une décision du comité produit, cité dans les commits qui l'appliquent |
| **Golden (test)** | Test comparant une sortie (deck, e-mail) à une référence figée ; un écart signale un changement visuel |
| **KPI** | Indicateur clé de performance, décrit dans le registre des métriques (formule, fenêtre, propriétaire) |
| **MFA** | Authentification multifacteur, ici déléguée à Microsoft Entra ID |
| **OData** | Protocole standard de consommation de données tabulaires, lu nativement par Power BI et Excel |
| **PV** | Procès-verbal d'une réunion départementale |
| **PWA** | Application web installable fonctionnant hors connexion |
| **RAG** | Échelle rouge / orange / vert appliquée à un indicateur selon une politique de seuils |
| **RFI** | Request for Improvement : demande d'amélioration soumise au comité |
| **RPO** | Perte de données maximale admise en cas de sinistre (ici 15 minutes) |
| **Runner de synchronisation** | Module unique exécutant chaque job planifié avec verrou, rejeu, journal et alertes |
| **SCA / SAST** | Analyse des dépendances / analyse statique du code, exécutées en CI |
| **SDP** | ManageEngine ServiceDesk Plus Cloud, l'outil de helpdesk source |
| **SSO** | Authentification unique d'entreprise (Microsoft Entra ID, OIDC) |
| **Tracker** | Suivi d'activités ou de projets paramétré par les métiers (périodes, unités, cibles, score) |
