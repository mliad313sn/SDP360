# 06 — Comparatif exécutif SDP-Dashboard → SDP360 et cible « plateforme de pilotage »

*Document de direction · 2026-10-19 · Base d'analyse : `samaziz679/SDP-Dashboard` v1.11 (HEAD `e74d4cf`) et `mliad313sn/SDP360` 2.0.0-alpha.1 (commit `214c0d1`).*

---

## 1. Synthèse pour la direction

SDP-Dashboard est aujourd'hui une **plateforme d'exploitation IT complète** (12 modules, 37 écrans, ~260 routes API, 6 moteurs d'export, ~2 300 tests) construite en sept mois pour les sites miniers. Sa valeur fonctionnelle est élevée ; ses faiblesses sont **l'hétérogénéité** (cinq échelles RAG, trois vocabulaires de codes site, deux bases en parallèle), **la fragilité des synchronisations** (téléchargement intégral horaire, quasi aucun rejeu, aucune alerte en cas d'échec) et **l'absence de gouvernance outillée** (pas de CI, règles métier enfouies dans un journal de 6 000 lignes, aucune fonction terrain hors-ligne).

SDP360 reprend 100 % du périmètre fonctionnel et y ajoute, dès cette première livraison, les **fondations** qui manquaient : un moteur de synchronisation unique et observable, un registre central des KPI et des seuils RAG, un moteur de trackers et de tableaux de bord paramétrables par les métiers, une intégration continue, et un corpus de gouvernance (charte de comité, flux RFI, feuille de route en quatre phases, SOP).

Ce qu'il **reste à construire** pour faire de SDP360 l'outil unique de pilotage des opérations se résume à sept chantiers, détaillés au §4 : (1) cockpit de réunion opérationnelle, (2) gestion de roadmap et de projets, (3) générateur de rapports à commentaire IA, (4) moteur d'engagement et de diffusion, (5) suite sécurité logicielle, (6) SSO + MFA, (7) gouvernance et reporting projet. Estimation globale : **9 à 12 mois** avec l'équipe prévue dans la feuille de route (1 architecte, 1 développeur front à partir de la phase 2, 1 ingénieur données à mi-temps, 1 analyste métier).

---

## 2. Comparatif fonctionnel détaillé

Légende : ✅ présent · ◐ partiel / fondation posée · ✗ absent.

### 2.1 Données et intégrations

| Fonction | SDP-Dashboard v1.11 | SDP360 2.0-alpha | Commentaire |
|---|---|---|---|
| Miroir tickets / changements / CAB / CSAT (Zoho Analytics Plus) | ✅ horaire, CSV intégral | ✅ identique, prêt pour le delta | Le filtre « modifié depuis » existe côté client (`deltaSince`) ; le câblage des jobs sur le runner est le lot P1-3 |
| Inventaire des actifs (6 vues) | ✅ quotidien, DELETE + INSERT, garde anti-vide | ✅ identique | Toujours en SQLite en production ; bascule PostgreSQL = P1-5 |
| Disponibilité infra (OpManager) et WAN (Meraki) | ✅ snapshots, SLA WAN, refacturation ISP | ✅ identique | Pas de gestion du code 429 Meraki : à corriger via le runner |
| Alertes SLA Teams (API SDP v3, 5 min) | ✅ seul job verrouillé contre le chevauchement | ✅ identique | Modèle à généraliser |
| **Runner de synchronisation unique** (verrou, rejeu exponentiel, Retry-After, watermark, dédoublonnage, garde anti-vide, journal des exécutions) | ✗ | ✅ `services/sync/` (17 tests) | Corrige le risque de **suppression massive** sur export tronqué |
| Observabilité des synchros | ◐ `sync_metadata.last_error` + console PM2 | ✅ `sync_runs`, `/api/sync/runs`, `/api/sync/health`, miroir `system_log` | Les échecs deviennent visibles dans l'écran System Logs |
| Référentiel site unique | ✗ (3 vocabulaires, alias en dur) | ◐ décision comité + table `site_module_codes` ciblée | P1-4 |
| Base de données | SQLite + PostgreSQL en parallèle, bascule inachevée | PostgreSQL seul visé, SQLite réservé aux tests | P1-5 / P1-6 |

### 2.2 Modules natifs (saisie terrain)

| Module | SDP-Dashboard | SDP360 | Commentaire |
|---|---|---|---|
| Rapports hebdo / mensuels de site, suivi des actions (lignée, fusion, import) | ✅ très complet | ✅ identique | Point fort à préserver |
| Réunions départementales (PV), incubation, escalades Conseil, 5 Engagements | ✅ | ✅ identique | |
| Inspections de site (17 catégories, photos, signatures) | ✅ | ✅ identique | Photos encore en base64 inline côté formulaire |
| Registre des actions de site (agrégation 3 sources) | ✅ | ✅ identique | |
| Tracker d'activité IT | ✅ un seul programme figé (4 piliers × 31 activités, 12 mois, types KPI codés en dur) | ◐ moteur générique : définition JSON validée, période libre, unités libres, types KPI et seuils en données, import du tracker 2026 (`services/trackerDefinitions.js`) | Interface « Tracker Builder » = P2-3 |
| Roadmap Manager | ✅ outil personnel super_admin, 4 objectifs, preuves auto | ✅ identique | À transformer en gestion de portefeuille (voir §4.2) |
| Registre des risques (export mensuel) | ✅ | ✅ identique | |

### 2.3 Restitution, KPI et exports

| Fonction | SDP-Dashboard | SDP360 | Commentaire |
|---|---|---|---|
| Tableaux de bord | ✅ 37 pages HTML figées, une par usage | ◐ moteur de tableaux de bord dynamiques : validateur de définition, catalogue de 9 widgets, grille, liaison à un registre de métriques, règle « terrain » (`services/dashboardWidgets.js`) | Composeur et rendu = P2-8 |
| Définition des KPI | ✗ formules dispersées dans ~15 fichiers | ✅ `metric_registry` (formule, fenêtre, lecteur, propriétaire, RFI) | Dictionnaire v1 = P1-11 |
| Seuils RAG | ✗ cinq jeux de seuils codés en dur, duplication écran / PPTX | ✅ registre `kpiRag` + table `kpi_rag_policies` (seuils hérités à l'identique) | Convergence = décision comité (02 §6.5) |
| Exports PPTX (6 générateurs), Excel, e-mail planifié, cartes Teams, vue SharePoint | ✅ | ✅ identique | Points forts |
| Commentaire automatique | ◐ moteur déterministe « Analyze Lite », IA cloud désactivée (`AI_PROVIDER=off`), fournisseur local Ollama prévu mais non déployé | ◐ identique | Voir §4.3 |

### 2.4 Sécurité, accès, exploitation

| Fonction | SDP-Dashboard | SDP360 | Commentaire |
|---|---|---|---|
| Authentification | ✅ sessions locales + SSO Entra (OIDC + PKCE) dormant, pas de MFA propre | ✅ identique | Voir §4.6 |
| Autorisation | ✅ 5 rôles hiérarchiques + rôles fonctionnels, périmètre multi-sites serveur | ✅ identique | Point fort |
| Secrets | ◐ chiffrement AES-256-GCM **optionnel**, clé dérivée sans KDF, clé OpManager dans l'URL, TLS OpManager non vérifié | ◐ identique, durcissement planifié | P1-8 |
| En-têtes HTTP / CSP | ◐ CSP avec `'unsafe-inline'`, limiteur de débit en mémoire | ◐ identique | P1-8 |
| Journal d'audit | ✅ `system_log` (auth, rapports) | ✅ + catégorie `sync` | |
| Intégration continue | ✗ | ✅ GitHub Actions à chaque push | |
| Déploiement | ZIP manuel + marqueur git + « lots gelés » | identique, paquet CI prévu | P1-9 |
| Mobilité / hors-ligne | ✗ (pages réactives par endroits, aucun PWA ni file d'attente) | ✗ (conception §4.4 du document 01) | Phase 3 |
| Documentation de gouvernance | ◐ CR ITIL, checklist de bascule, audit AMDEC, mais règles dans un journal chronologique | ✅ charte comité, flux RFI, feuille de route, spécification moteur, SOP, gabarits | |

### 2.5 Forces et faiblesses

**SDP-Dashboard — forces** : couverture fonctionnelle rare pour un outil interne ; culture de test (fixtures « golden », tests de fidélité aux modèles de la direction) ; schéma PostgreSQL idempotent ; périmètre de site imposé côté serveur ; divergences ITSM documentées ; artefacts de gouvernance déjà existants (CR ITIL, AMDEC).

**SDP-Dashboard — faiblesses** : un seul nombre peut avoir cinq définitions selon l'écran ; échec silencieux des synchronisations ; monolithe de 9 000 lignes et pages de 8 500 lignes ; React compilé dans le navigateur ; aucune capacité terrain hors-ligne ; dérive production / dépôt (lots gelés) ; connaissance opérationnelle verrouillée dans `CLAUDE.md`.

**SDP360 — forces** : conserve l'intégralité des acquis ; corrige les deux risques les plus graves (suppression massive sur export tronqué, échecs invisibles) ; rend les KPI, seuils, trackers et tableaux de bord **paramétrables par les métiers** ; installe la gouvernance (comité, RFI, SOP) et l'intégration continue.

**SDP360 — limites actuelles** : les fondations sont livrées, pas encore les interfaces (builder de trackers, composeur de tableaux de bord) ; les jobs existants ne passent pas encore par le runner ; le durcissement sécurité et la bascule PostgreSQL complète restent à exécuter.

---

## 3. Vision cible : SDP360 comme plateforme unique de pilotage

```
          Réunion d'exploitation            Comité / Conseil             Direction
          (hebdo, site)                      (mensuel)                    (mensuel, trimestriel)
                │                                 │                            │
   ┌────────────▼─────────────────────────────────▼────────────────────────────▼────────────┐
   │  COCKPIT DE RÉUNION  ·  PORTEFEUILLE ROADMAP & PROJETS  ·  RAPPORTS IA  ·  DIFFUSION   │
   ├─────────────────────────────────────────────────────────────────────────────────────────┤
   │  Registre KPI · Seuils RAG · Trackers · Tableaux de bord · Registre des actions · RFI   │
   ├─────────────────────────────────────────────────────────────────────────────────────────┤
   │  Runner de synchronisation (SDP · OpManager · Meraki · M365)  ·  Audit  ·  Sécurité     │
   └─────────────────────────────────────────────────────────────────────────────────────────┘
```

Principe directeur : **une donnée, une définition, une diffusion**. Tout chiffre présenté en réunion, dans un rapport ou dans une alerte provient du même lecteur de métrique, sous la même politique RAG, et porte la date de ses données.

---

## 4. Ce qu'il faut mettre en place — sept chantiers

### 4.1 Cockpit de réunion opérationnelle (piloter les réunions ops)

**Besoin** : qu'une réunion hebdomadaire de site ou mensuelle de direction se tienne **dans** SDP360, sans diapositive préparée à la main, et laisse une trace exploitable.

| Composant | Description | Dépend de |
|---|---|---|
| Ordre du jour généré | Agenda type par cadence (hebdo site / mensuel direction / Conseil IT) alimenté automatiquement : KPI de la semaine, actions en retard, incidents majeurs, décisions en attente, RFI à trancher | Registre KPI (P1-11), Registre des actions |
| Mode « réunion » | Vue plein écran, navigation par point d'agenda, chaque point = un widget de tableau de bord + ses actions ; horodatage de la revue de chaque point | Moteur de tableaux de bord (P2-8) |
| Décisions et actions en séance | Saisie d'une décision (`DEC-`) ou d'une action pendant la réunion, rattachée au point et à la source (ticket, réunion, inspection) ; les actions rejoignent le Registre des actions existant | `md_actions` / `action_items` existants |
| Compte rendu automatique | Génération du PV (HTML, PDF, e-mail) : participants, points revus, décisions, actions avec responsable et échéance, écarts KPI commentés | Générateur de rapports (§4.3) |
| Suivi inter-réunions | Écran « depuis la dernière réunion » généralisé à partir de l'existant des PV départementaux (`compareDepartment`) : clos, nouveaux, en retard | Existant |
| Calendrier de cadence | Table `meeting_cadences` (type, site, jour, participants, préparateur) ; rappel J-1 avec lien vers l'agenda pré-rempli | Moteur d'engagement (§4.4) |

**Pré-requis** : les 5 Engagements et le score de site (`siteScore`) deviennent des métriques du registre pour être affichés en séance avec leur seuil officiel.

### 4.2 Conception et suivi de la roadmap (et gouvernance de projets)

**Besoin** : passer de l'outil personnel « Roadmap Manager » à une **gestion de portefeuille** partagée, reliée aux actions terrain et aux KPI.

| Composant | Description |
|---|---|
| Modèle de portefeuille | `programmes → objectifs (pondérés) → initiatives/projets → jalons → livrables → actions` ; chaque niveau avec propriétaire, statut, confiance, dates cible / réelles, budget prévu / consommé, risques liés |
| Preuves automatiques | Généralisation du mécanisme existant (`roadmapEvidence`) : chaque objectif référence des métriques du registre qui mesurent sa progression (adoption, conformité, disponibilité) |
| Vue Gantt et chemin critique | Jalons et dépendances inter-projets ; alertes de glissement (jalon dépassé, confiance en baisse deux mois de suite) |
| Registre des risques projet | Probabilité × impact, propriétaire, plan de mitigation, lien vers les incidents SDP qui matérialisent le risque (réutilise la logique du Registre des risques) |
| Revue mensuelle | Rapport « état du portefeuille » généré : feux par objectif, jalons du mois, écarts, décisions demandées ; intégré au cockpit de réunion |
| Gouvernance du changement | Les projets qui modifient la plateforme passent par le flux RFI du comité (02 §5) ; les déploiements par le CAB ; traçabilité commit ↔ RFI ↔ DEC |

**Indicateurs de gouvernance projet** : % jalons à l'heure, dérive moyenne (jours), % objectifs avec preuve automatique, % projets avec risque documenté, délai moyen RFI → décision.

### 4.3 Générateur de rapports avec IA embarquée

**Besoin** : rapports hebdo / mensuels / Conseil produits automatiquement, avec une **analyse rédigée** (tendances, causes probables, recommandations) que l'humain valide avant envoi.

| Composant | Description |
|---|---|
| Modèles de rapport | Gabarits par public (site, direction, Conseil, finance) composés de widgets du moteur de tableaux de bord ; sortie HTML, PDF, PPTX, CSV ; réutilise `reports-pptx-shared`, `reportRender`, `report_schedules` |
| Couche d'analyse déterministe | Détection de variations significatives (règles héritées : ±1 pt flotte, ±3 pts pilier, ±10 pts site), classement des pires sites / catégories, séries 13 semaines ; toujours disponible, sans IA |
| Couche IA (commentaire) | Modèle de langage alimenté **uniquement** par les chiffres canoniques du rapport (clause anti-hallucination déjà rédigée dans le dépôt), ton par audience (direction / opérationnel / technique), bilingue EN/FR ; produit : synthèse, points d'attention, causes probables, recommandations, questions à poser en réunion |
| Fournisseur et souveraineté | Deux modes : local on-premise (Ollama, modèle Mistral Nemo déjà qualifié dans le dépôt) pour la confidentialité des données ITSM ; API cloud en option avec anonymisation des champs PII (déjà en place à l'ingestion). Décision de l'entreprise par RFI `governance` |
| Validation humaine | Le commentaire IA est un **brouillon** marqué comme tel ; relecture obligatoire pour les rapports de direction ; journalisation de la version envoyée (modèle, horodatage, relecteur) |
| Qualité | Jeu de rapports « golden » : fidélité des chiffres (zéro divergence tolérée), lisibilité du commentaire notée par le comité chaque trimestre |

### 4.4 Moteur d'engagement : notifications et partage

**Besoin** : que la bonne information arrive au bon acteur, au bon moment, sur le canal qu'il lit (Teams pour les techniciens, e-mail pour les coordinateurs, SharePoint pour la direction).

| Composant | Description |
|---|---|
| Règles d'alerte | Table `alert_rules` : métrique, périmètre, comparateur, seuil, délai de rémanence, canal, destinataires par rôle/site ; réutilise les cartes adaptatives Teams existantes |
| Abonnements | Chaque utilisateur choisit ses abonnements (site, module, fréquence) ; respect strict des adresses confirmées de l'annuaire (règle existante) |
| Canaux | Teams (webhook Workflows, existant), e-mail (SMTP existant), notifications in-app (cloche, centre de notifications), SharePoint (vue exécutive existante, étendue) |
| Partage de rapports | Lien de consultation signé et expirable vers un rapport publié ; export vers SharePoint / Teams ; registre des envois (`report_sent_log` étendu) avec accusés de lecture |
| Boucle de retour | Commentaire et accusé sur un rapport ou une action depuis la notification ; alimente le suivi inter-réunions |
| Digest intelligent | Un seul envoi quotidien ou hebdomadaire regroupant alertes et actions par acteur, au lieu de notifications unitaires |

### 4.5 Suite sécurité logicielle et bonnes pratiques

| Domaine | Mesures |
|---|---|
| Secrets | Clé `SDP_CONFIG_KEY` obligatoire en production, dérivation scrypt, rotation documentée ; aucune clé en URL ; TLS vérifié avec autorité interne (OpManager) |
| Durcissement HTTP | CSP sans `'unsafe-inline'` sur les nouvelles pages (suppression des `onclick` inline), HSTS, cookies `Secure`/`HttpOnly`/`SameSite`, limiteur de débit persistant |
| Dépendances | Remplacement de `xlsx@0.18.5` (non maintenu), audit `npm audit` et SCA en CI, analyse statique (SAST) sur chaque PR, revue des licences |
| Données | Chiffrement au repos PostgreSQL, sauvegardes chiffrées testées trimestriellement, rétention et purge (RGPD : PII déjà retirées à l'ingestion) |
| Journalisation | `system_log` étendu : accès aux données sensibles, exports, changements de rôle, échecs de synchro ; conservation 12 mois ; export SIEM |
| Tests sécurité | Tests d'autorisation par rôle sur chaque route (existant à généraliser), test d'intrusion annuel, scan de vulnérabilités du serveur |
| Processus | Revue de code obligatoire, branches protégées, signature des paquets de déploiement produits par la CI, procédure de réponse à incident, matrice RACI sécurité |

### 4.6 SSO et MFA

| Élément | État | Cible |
|---|---|---|
| SSO Microsoft Entra ID (OIDC + PKCE) | Code complet, dormant, paramétrable depuis l'administration | Activation en mode `available` (double méthode) 2 à 4 semaines, puis `only` |
| MFA | Absente côté plateforme | **Déléguée à Entra ID** via politiques d'accès conditionnel (MFA obligatoire, appareils conformes, localisation) : aucune MFA maison à maintenir |
| Compte de secours | Un `super_admin` local « break-glass » | Conservé, mot de passe fort, journalisé, revu trimestriellement |
| Provisionnement | Pré-provisionnement manuel des comptes | Synchronisation des groupes Entra → rôles et sites SDP360 (SCIM ou lecture Graph), désactivation automatique au départ |
| Sessions | Jeton local 24 h | Durée alignée sur la politique Entra, révocation depuis l'écran Sessions actives (existant) |
| Rôles | 5 rôles + rôles fonctionnels | Ajout `field-tech` (phase 3) et `committee` ; revue d'habilitations trimestrielle outillée (`audit-roles.js` existant) |

### 4.7 Gouvernance et reporting projet (synthèse)

| Instance | Cadence | Alimentée par |
|---|---|---|
| Comité d'experts IT Ops (triage RFI, dictionnaire KPI) | bimensuel / mensuel | Registre RFI, registre KPI, santé des synchros |
| Revue de portefeuille | mensuelle | Portefeuille roadmap (§4.2), rapport généré (§4.3) |
| CAB (déploiements) | selon changements | Paquets CI, CR ITIL existants |
| Direction | mensuelle / trimestrielle | Pack exécutif IA, vue SharePoint, feux par objectif |

Tableau de bord de gouvernance (dans SDP360 lui-même) : état des phases de la feuille de route, délais RFI, couverture KPI documentés, dette sécurité ouverte, taux de disponibilité des synchros, adoption (vues par rôle, grâce au journal `*_viewed` existant).

---

## 5. Séquencement et effort indicatif

| Chantier | Phase feuille de route | Effort indicatif | Pré-requis |
|---|---|---|---|
| Runner câblé sur tous les jobs, PostgreSQL seul, durcissement sécurité, CI → paquets | P1 (mois 1-3) | 3 mois, 1 architecte + 0,5 ingénieur données | — |
| SSO `available` → `only`, MFA via Entra, provisionnement | P1-P2 | 4 à 6 semaines (dépend de l'administration M365) | Enregistrement d'application Entra |
| Builder de trackers, composeur de tableaux de bord, registre KPI v1 | P2 (mois 3-6) | 3 mois, + 1 développeur front | P1 |
| Cockpit de réunion, calendrier de cadence | P2-P3 | 6 à 8 semaines | Moteur de tableaux de bord |
| Portefeuille roadmap & projets | P2-P3 | 8 semaines | Registre KPI |
| Moteur d'engagement (règles, abonnements, digest, partage) | P3-P4 | 6 à 8 semaines | Registre KPI, SSO |
| Générateur de rapports IA (local puis cloud optionnel) | P4 (mois 9-12) | 8 à 10 semaines | Modèles de rapport, décision souveraineté |

**Décisions attendues de la direction** : (1) ratification de la charte du comité et nomination des sièges ; (2) choix du mode IA (local / cloud) ; (3) autorisation d'activer le SSO et la politique MFA Entra ; (4) validation du budget équipe sur 12 mois.

---

## 6. Risques et mitigations

| Risque | Impact | Mitigation |
|---|---|---|
| Quota Zoho dépassé en augmentant la fréquence des synchros | Données périmées | Appliquer le delta seulement, surveiller les replis bulk (code 8133), ajuster la cadence par vue |
| Résistance au changement des coordinateurs (nouveaux écrans) | Adoption faible | Sièges terrain au comité, cliniques terrain mensuelles, migration du tracker 2026 à l'identique |
| Commentaire IA erroné transmis à la direction | Perte de confiance | Chiffres canoniques imposés, relecture humaine obligatoire, journal des versions |
| Dépendance à un seul développeur | Continuité | CI, documentation `docs/sdp360`, règles maison extraites de `CLAUDE.md`, revue de code |
| Fuite de secrets dans les sauvegardes | Sécurité | Chiffrement au repos obligatoire, clé hors sauvegarde, rotation |
