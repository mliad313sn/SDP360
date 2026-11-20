# Check-list de mise en service (go-live) — les 21 portes

> **Préparé par IA — à valider par les responsables nommés.** Généré par `node tools/release/business-readiness-check.js --write` à partir de
> `tools/release/gate-dossiers.source.js` et de `docs/sdp360/completion/RELEASE-GATES.md`. Ce document ne remplit
> **aucune** case de décision : une porte est **NO-GO** tant que son approbateur n'a pas rempli sa ligne dans
> RELEASE-GATES.md. Les preuves citées existent dans le dépôt ; ce qu'elles ne prouvent pas est dans le dossier
> de chaque porte (section 3).

État au moment de la génération : **0 ligne(s) sur 21 renseignée(s)** dans RELEASE-GATES.md.

## Vue d'ensemble

| Porte | Objet | Approbateur (rôle) | Bloque | Preuves disponibles | Ce que seuls des humains fournissent | État RELEASE-GATES | Dossier |
|---|---|---|---|---|---|---|---|
| G01 | Sécurité : politique d'accès et matrice d'autorisation | Sécurité de l'information | pilote | 7 | 3 | vide → NO-GO | `docs/agent-execution/gate-dossiers/fr/G01-security-access-policy.md` |
| G02 | Sécurité : modèle de menace et constats | Sécurité de l'information | pilote | 6 | 3 | vide → NO-GO | `docs/agent-execution/gate-dossiers/fr/G02-threat-model-findings.md` |
| G03 | CAB : mise à jour des dépendances et passage à PostgreSQL seul | CAB | pilote | 7 | 3 | vide → NO-GO | `docs/agent-execution/gate-dossiers/fr/G03-cab-dependencies-postgres-only.md` |
| G05 | Sauvegarde et restauration (RPO/RTO) | CAB + SRE | pilote | 7 | 3 | vide → NO-GO | `docs/agent-execution/gate-dossiers/fr/G05-backup-restore-rpo-rto.md` |
| G11 | Sites pilotes et recette terrain | Sponsor + IT Groupe | pilote | 7 | 3 | vide → NO-GO | `docs/agent-execution/gate-dossiers/fr/G11-pilot-sites-field-uat.md` |
| G12 | Propriétaire des données : données anonymisées et historique 2026 | Propriétaires des données | pilote | 5 | 3 | vide → NO-GO | `docs/agent-execution/gate-dossiers/fr/G12-data-owner-fixtures-history.md` |
| G19 | QA : CI verte et tests sautés revus | Responsable QA | pilote | 5 | 1 | vide → NO-GO | `docs/agent-execution/gate-dossiers/fr/G19-qa-ci-green.md` |
| G21 | Projet témoin métier | PMO | pilote | 4 | 1 | vide → NO-GO | `docs/agent-execution/gate-dossiers/fr/G21-business-witness-project.md` |
| G07 | Politique de clôture des engagements | Responsables métier/contrôle + Comité | pilote si la fonction est au périmètre | 6 | 3 | vide → NO-GO | `docs/agent-execution/gate-dossiers/fr/G07-closure-policy-commitments.md` |
| G08 | Passations entre départements | Sponsor / PO + Comité | pilote si la fonction est au périmètre | 3 | 2 | vide → NO-GO | `docs/agent-execution/gate-dossiers/fr/G08-handoffs.md` |
| G09 | Relecteurs des tableaux de bord et trackers | Comité | pilote si la fonction est au périmètre | 4 | 1 | vide → NO-GO | `docs/agent-execution/gate-dossiers/fr/G09-dashboard-tracker-reviewers.md` |
| G13 | Connecteurs et clients à clé | Responsables plateforme/infra | pilote si la fonction est au périmètre | 6 | 2 | vide → NO-GO | `docs/agent-execution/gate-dossiers/fr/G13-connectors-dashkey-clients.md` |
| G14 | Finance : budgets et bénéfices | Finance | pilote si la fonction est au périmètre | 5 | 2 | vide → NO-GO | `docs/agent-execution/gate-dossiers/fr/G14-finance-budgets-benefits.md` |
| G04 | Clé de signature et actions CI épinglées | Sécurité de l'information + responsable CI | déploiement général | 5 | 2 | vide → NO-GO | `docs/agent-execution/gate-dossiers/fr/G04-signing-key-ci-shas.md` |
| G06 | Définitions des indicateurs, seuils et score | Comité des indicateurs | déploiement général | 7 | 2 | vide → NO-GO | `docs/agent-execution/gate-dossiers/fr/G06-kpi-definitions-thresholds.md` |
| G10 | Autorité des rapports et canaux | Responsable des rapports | déploiement général | 6 | 2 | vide → NO-GO | `docs/agent-execution/gate-dossiers/fr/G10-report-authority-channels.md` |
| G15 | Produit : acceptation métier | Sponsor / PO | déploiement général | 4 | 1 | vide → NO-GO | `docs/agent-execution/gate-dossiers/fr/G15-product-business-acceptance.md` |
| G17 | Mise en production | CAB | déploiement général | 5 | 1 | vide → NO-GO | `docs/agent-execution/gate-dossiers/fr/G17-production-deployment.md` |
| G18 | Test d'intrusion | Sécurité de l'information | déploiement général | 3 | 1 | vide → NO-GO | `docs/agent-execution/gate-dossiers/fr/G18-penetration-test.md` |
| G20 | Capacité : charge et endurance | SRE + DBA | déploiement général | 5 | 2 | vide → NO-GO | `docs/agent-execution/gate-dossiers/fr/G20-capacity-load-soak.md` |
| G16 | Juridique et commercial | Juridique + responsable commercial | diffusion externe | 4 | 1 | vide → NO-GO | `docs/agent-execution/gate-dossiers/fr/G16-legal-commercial.md` |

## G01 — Sécurité : politique d'accès et matrice d'autorisation

- Ligne RELEASE-GATES : « Security — access policy CG-01/CG-02, authz matrix (G-03…G-08) »
- Approbateur : Sécurité de l'information · bloque : pilote · à décider après : G19

**Preuves déjà disponibles (dépôt)**

- `docs/ops/authz-matrix.json` — Matrice route × garde × capacité lisible par machine, régénérée depuis le code
- `docs/ops/AUTHZ-MATRIX.md` — Matrice lisible de chaque route d'API et du rôle exigé
- `tests/authz-route-matrix.test.js` — Échoue si une route est ajoutée ou si sa garde change sans régénérer la matrice
- `tests/authz-enforce.test.js` — Comportement de l'application des capacités
- `docs/sdp360/completion/AUTHZ-OBJECT-MATRIX.csv` — Matrice d'accès par objet (qui lit ou écrit quel objet)
- `docs/ops/PORTFOLIO-ACCESS-MATRIX.md` — Règles d'accès portefeuille/projet
- `docs/sdp360/consolidation/02-GAP-AND-RISK-REGISTER.md` — Constats CG-01 et CG-02 et leur état de correction

**Ce que seuls des humains peuvent fournir**

| Élément attendu | Décision | Nom | Date | Signature |
|---|---|---|---|---|
| Nom et date dans la ligne de RELEASE-GATES. | | | | |
| La liste des comptes pilotes et de leurs rôles. | | | | |
| Si l'accès par département (D-14) est exigé avant ou après le pilote. | | | | |

## G02 — Sécurité : modèle de menace et constats

- Ligne RELEASE-GATES : « Security — threat model and findings register (G27) »
- Approbateur : Sécurité de l'information · bloque : pilote · à décider après : G01

**Preuves déjà disponibles (dépôt)**

- `docs/security/THREAT-MODEL.md` — Modèle de menace STRIDE construit depuis le code, avec le responsable de chaque risque résiduel
- `docs/agent-execution/SEC-01.md` — Constats de la revue de sécurité et avis sur les dépendances
- `docs/security/EX-01-CREDENTIAL-INCIDENT.md` — Identifiant historique dans la configuration de l'installeur — porte humaine ouverte
- `docs/security/ROTATION-RECORD.md` — Où une rotation est consignée une fois faite par une personne
- `tools/security/secret-scan.js` — Scanner de secrets sur l'arbre
- `docs/security/CSP-JOURNEYS.md` — Observations de Content-Security-Policy par parcours

**Ce que seuls des humains peuvent fournir**

| Élément attendu | Décision | Nom | Date | Signature |
|---|---|---|---|---|
| Confirmation datée de la rotation d'EX-01 (ligne dans ROTATION-RECORD.md). | | | | |
| Le responsable qui accepte chaque risque résiduel. | | | | |
| Décision sur la liste des pages CSP strictes après une période en mode rapport. | | | | |

## G03 — CAB : mise à jour des dépendances et passage à PostgreSQL seul

- Ligne RELEASE-GATES : « CAB — dependency release D-11 (CG-05) and PostgreSQL-only cutover PO-08 »
- Approbateur : CAB · bloque : pilote · à décider après : G19

**Preuves déjà disponibles (dépôt)**

- `docs/agent-execution/DEPS-TRIAGE.md` — Registre de tri des dépendances (propositions, rien de fusionné par l'agent)
- `tests/postgres-only.test.js` — Prouve qu'il ne reste ni dépendance ni branche SQLite
- `services/backendGuard.js` — Le serveur refuse de démarrer sans PG_URL
- `tests/dependency-sources.test.js` — Contrôles de l'origine des dépendances
- `tests/pg-migrate.test.js` — Les migrations s'appliquent dans l'ordre et sont journalisées
- `docs/ops/rehearsals/2026-10-29-local-pg16.md` — Répétition PostgreSQL locale sur données synthétiques
- `docs/sdp360/consolidation/03-DECISIONS-AND-ASSUMPTIONS.md` — PO-08 et D-11 tels que consignés

**Ce que seuls des humains peuvent fournir**

| Élément attendu | Décision | Nom | Date | Signature |
|---|---|---|---|---|
| Référence et date du CAB. | | | | |
| Le SHA cible approuvé pour TEST. | | | | |
| La fenêtre d'installation. | | | | |

## G05 — Sauvegarde et restauration (RPO/RTO)

- Ligne RELEASE-GATES : « Backup / restore RPO-RTO (G-11) »
- Approbateur : CAB + SRE · bloque : pilote · à décider après : G03

**Preuves déjà disponibles (dépôt)**

- `docs/ops/restore-drills/2026-10-21.md` — Exercice de restauration : comptes de lignes égaux sur la copie restaurée (base synthétique)
- `tools/pg/restore-drill.js` — Outil d'exercice
- `tests/restore-drill.test.js` — Comportement de l'outil d'exercice
- `tests/backup-encrypt.test.js` — Comportement de la sauvegarde chiffrée
- `docs/ops/REPLICA-RESTORE.md` — Procédure réplica et restauration
- `docs/ops/rehearsals/2026-10-29-local-pg16-g04.md` — Répétition locale avec durées
- `docs/ops/SLO-PROPOSAL.md` — Indicateurs proposés ; chaque cible INCONNUE

**Ce que seuls des humains peuvent fournir**

| Élément attendu | Décision | Nom | Date | Signature |
|---|---|---|---|---|
| Valeurs de RPO et RTO. | | | | |
| Emplacement des sauvegardes et son responsable. | | | | |
| Date de l'exercice sur TEST. | | | | |

## G11 — Sites pilotes et recette terrain

- Ligne RELEASE-GATES : « Pilot sites D-05 and field UAT (G-16/G-35) »
- Approbateur : Sponsor + IT Groupe · bloque : pilote · à décider après : G01, G02, G05, G12

**Preuves déjà disponibles (dépôt)**

- `docs/ops/pilot/PILOT-PROFILE.md` — Valeurs d'interrupteurs proposées pour le pilote (non approuvées)
- `docs/ops/pilot/FIELD-DEVICE-UAT.md` — Protocole de recette des appareils terrain
- `docs/ops/pilot/PILOT-MEASUREMENT.md` — Ce que le pilote mesure et comment
- `docs/ops/pilot/TEST-INSTANCE.md` — Description de l'instance de TEST
- `tests/field-no-silent-loss.test.js` — La saisie terrain hors ligne ne perd jamais un enregistrement en silence
- `tests/pilot-metrics.test.js` — Outil de mesure du pilote
- `docs/sdp360/completion/UAT-PANEL-2026-10-29.md` — Panel de revue IA (pas de vrais utilisateurs)

**Ce que seuls des humains peuvent fournir**

| Élément attendu | Décision | Nom | Date | Signature |
|---|---|---|---|---|
| Deux noms de sites et un site optionnel de préparation hors ligne. | | | | |
| Utilisateurs pilotes nommés. | | | | |
| Critères de succès pour le GO/NO-GO du pilote. | | | | |

## G12 — Propriétaire des données : données anonymisées et historique 2026

- Ligne RELEASE-GATES : « Data owner — anonymised fixtures (G-15), 2026 history D-10 »
- Approbateur : Propriétaires des données · bloque : pilote · à décider après : G02

**Preuves déjà disponibles (dépôt)**

- `docs/ops/ANONYMISED-SNAPSHOT.md` — Procédure d'anonymisation ; aucun extrait n'existe
- `tests/anonymize-snapshot.test.js` — Comportement de l'anonymiseur sur données synthétiques
- `tests/.skip-allowlist.json` — Tests sautés faute d'extrait approuvé
- `docs/ops/RETENTION-INVENTORY.md` — Inventaire de conservation
- `docs/sdp360/2027/02-DECISION-LOG.md` — Décision D-10 sur les chiffres historiques (ouverte)

**Ce que seuls des humains peuvent fournir**

| Élément attendu | Décision | Nom | Date | Signature |
|---|---|---|---|---|
| Propriétaire par source. | | | | |
| Approbation des règles d'anonymisation. | | | | |
| Responsable du rapprochement D-10. | | | | |

## G19 — QA : CI verte et tests sautés revus

- Ligne RELEASE-GATES : « QA lead — CI green on the target SHA, skipped tests reviewed (E-B05) »
- Approbateur : Responsable QA · bloque : pilote

**Preuves déjà disponibles (dépôt)**

- `.github/workflows/ci.yml` — Tâches CI (unitaires, parcours navigateur)
- `tests/.suite-manifest.json` — Recensement revu des tests par fichier
- `tests/.skip-allowlist.json` — Chaque saut autorisé et sa raison
- `tools/test/run-all.js` — Lanceur de la suite complète
- `docs/agent-execution/DELIVERY-QUALITY.md` — Indicateurs de qualité de livraison

**Ce que seuls des humains peuvent fournir**

| Élément attendu | Décision | Nom | Date | Signature |
|---|---|---|---|---|
| Lien vers l'exécution CI verte sur le SHA cible. | | | | |

## G21 — Projet témoin métier

- Ligne RELEASE-GATES : « Business witness project (E-B05) »
- Approbateur : PMO · bloque : pilote · à décider après : G11

**Preuves déjà disponibles (dépôt)**

- `docs/audits/2026-11-12-ppm-parity/README.md` — Audit de parité PPM
- `docs/ppm/W2-ENGINE-CONTRACT.md` — Contrat du moteur de planification
- `docs/ai-decisions/ADR-G11-native-ppm.md` — Décision PPM natif
- `tests/ppm-evm.test.js` — Comportement de la valeur acquise

**Ce que seuls des humains peuvent fournir**

| Élément attendu | Décision | Nom | Date | Signature |
|---|---|---|---|---|
| Nom du projet, chef de projet, critères de certification. | | | | |

## G07 — Politique de clôture des engagements

- Ligne RELEASE-GATES : « Closure policy D-04 (G-17/G-18) — incl. who is told about A01/A02 escalations »
- Approbateur : Responsables métier/contrôle + Comité · bloque : pilote si la fonction est au périmètre · à décider après : G06

**Preuves déjà disponibles (dépôt)**

- `docs/sdp360/completion/GOVERNANCE-POLICIES.md` — Chaque règle de gouvernance comme paramètre, avec sa valeur par défaut
- `docs/sdp360/completion/GOVERNANCE-LIFECYCLE.md` — Cycle de vie des engagements
- `tests/commitment-lifecycle.test.js` — Règles du cycle de vie
- `tests/commitment-escalation.test.js` — Règles d'escalade
- `tests/commitments-routes.smoke.test.js` — Les routes répondent 404 tant que l'interrupteur est éteint
- `docs/ops/FLAG-REGISTER.json` — Registre des interrupteurs : défaut, responsable (à nommer)

**Ce que seuls des humains peuvent fournir**

| Élément attendu | Décision | Nom | Date | Signature |
|---|---|---|---|---|
| Rôles vérificateurs par site. | | | | |
| Destinataires des escalades A01/A02. | | | | |
| Fenêtre de service avant escalade. | | | | |

## G08 — Passations entre départements

- Ligne RELEASE-GATES : « Handoffs (G-22) — enable, notification recipients, user↔department mapping if wanted »
- Approbateur : Sponsor / PO + Comité · bloque : pilote si la fonction est au périmètre · à décider après : G07

**Preuves déjà disponibles (dépôt)**

- `docs/sdp360/completion/HANDOFF-STATE-MACHINE.md` — Machine d'états des passations ; statut IMPLÉMENTÉ · TESTÉ
- `tests/handoff-lifecycle.test.js` — Règles du cycle de vie
- `tests/handoffs.smoke.test.js` — Comportement des routes et de l'interrupteur

**Ce que seuls des humains peuvent fournir**

| Élément attendu | Décision | Nom | Date | Signature |
|---|---|---|---|---|
| Destinataires. | | | | |
| Source de la correspondance si voulue. | | | | |

## G09 — Relecteurs des tableaux de bord et trackers

- Ligne RELEASE-GATES : « Dashboard and tracker reviewers (G-23/G-24, DEC-6.x) — who reviews which audience »
- Approbateur : Comité · bloque : pilote si la fonction est au périmètre · à décider après : G06

**Preuves déjà disponibles (dépôt)**

- `tests/publish-gate.test.js` — Comportement de la porte de publication
- `docs/sdp360/05-SOP-DASHBOARDS-AND-TRACKERS.md` — Procédure des tableaux de bord et trackers
- `docs/ops/WIDGET-CATALOGUE.md` — Catalogue des widgets
- `tests/dashboard-design.test.js` — Contrôles de conception des définitions

**Ce que seuls des humains peuvent fournir**

| Élément attendu | Décision | Nom | Date | Signature |
|---|---|---|---|---|
| Relecteur par public. | | | | |

## G13 — Connecteurs et clients à clé

- Ligne RELEASE-GATES : « Connectors D-07/D-08/D-09, dash-key clients D-15 (D-06 Meraki: kept by requester decision) »
- Approbateur : Responsables plateforme/infra · bloque : pilote si la fonction est au périmètre · à décider après : G01

**Preuves déjà disponibles (dépôt)**

- `docs/sdp360/completion/CONNECTOR-REGISTER.csv` — Registre des connecteurs
- `docs/agent-execution/CONNECTOR-QUALIFICATION-2026-11-12.md` — Qualification des connecteurs
- `docs/sdp360/completion/DASHKEY-CLIENTS.md` — Les 16 routes à clé seule
- `tests/dashkey-only-routes.smoke.test.js` — Fige la liste des routes à clé seule
- `tests/connector-register.test.js` — Audit des connecteurs exclus
- `docs/ai-decisions/ADR-A20-meridian-retirement.md` — Proposition de retrait de Meridian

**Ce que seuls des humains peuvent fournir**

| Élément attendu | Décision | Nom | Date | Signature |
|---|---|---|---|---|
| Liste des appelants de la clé. | | | | |
| Décision par connecteur. | | | | |

## G14 — Finance : budgets et bénéfices

- Ligne RELEASE-GATES : « Finance — budgets and benefits (G14) »
- Approbateur : Finance · bloque : pilote si la fonction est au périmètre · à décider après : G06

**Preuves déjà disponibles (dépôt)**

- `docs/ops/FINANCE-CURRENCY-RULES.md` — Chaque chemin monétaire et la décision Finance en attente
- `docs/ai-decisions/ADR-P2-finance-certification-and-actuals.md` — Conception de la certification financière
- `tests/finance-certification.test.js` — Comportement de la certification
- `tests/portfolio-benefits.test.js` — Comportement du suivi des bénéfices
- `docs/sdp360/completion/TCO-TEMPLATE.csv` — Modèle de coût total

**Ce que seuls des humains peuvent fournir**

| Élément attendu | Décision | Nom | Date | Signature |
|---|---|---|---|---|
| Source du taux. | | | | |
| Rôle certificateur. | | | | |

## G04 — Clé de signature et actions CI épinglées

- Ligne RELEASE-GATES : « Signing key and CI action SHAs D-12 (G-09) »
- Approbateur : Sécurité de l'information + responsable CI · bloque : déploiement général · à décider après : G03

**Preuves déjà disponibles (dépôt)**

- `tests/update-package-signature.test.js` — Comportement de la vérification de signature des paquets
- `tools/manifest-public.pem` — Clé publique actuellement livrée (pas une décision de clé de production)
- `.github/workflows/ci.yml` — Workflow CI et ses références d'actions
- `tests/ci-config.test.js` — Contrôles de la configuration CI
- `tools/release/sbom.js` — Générateur de nomenclature logicielle (SBOM)

**Ce que seuls des humains peuvent fournir**

| Élément attendu | Décision | Nom | Date | Signature |
|---|---|---|---|---|
| Nom du détenteur de la clé et lieu de stockage (jamais la clé). | | | | |
| Liste des SHA vérifiés. | | | | |

## G06 — Définitions des indicateurs, seuils et score

- Ligne RELEASE-GATES : « KPI definitions, thresholds, score D-01/02/03 (G-12) »
- Approbateur : Comité des indicateurs · bloque : déploiement général

**Preuves déjà disponibles (dépôt)**

- `docs/ops/SCORE-METHODOLOGY.md` — Méthodologie du score générée depuis le code ; D-03 ouverte
- `docs/ops/METRIC-LINEAGE.md` — D'où vient chaque indicateur
- `docs/sdp360/completion/KPI-DISPUTES.md` — Désaccords connus entre formules
- `services/metricRegistry.js` — Dictionnaire des indicateurs
- `tests/kpi-policy-engine.test.js` — Comportement du moteur de politiques de seuils
- `tests/kpi-rag.test.js` — Seuils RAG côté serveur
- `docs/ai-decisions/ADR-C31-kpi-policy-builder.md` — Décision technique du constructeur de politiques

**Ce que seuls des humains peuvent fournir**

| Élément attendu | Décision | Nom | Date | Signature |
|---|---|---|---|---|
| Définition et seuil approuvés par indicateur. | | | | |
| Choix du score de site de référence (D-03). | | | | |

## G10 — Autorité des rapports et canaux

- Ligne RELEASE-GATES : « Report authority and channels D-13 (G-13/G-25) »
- Approbateur : Responsable des rapports · bloque : déploiement général · à décider après : G06

**Preuves déjà disponibles (dépôt)**

- `docs/sdp360/completion/REPORT-ALERT-CATALOGUE.md` — Catalogue des rapports et alertes (R01–R16)
- `tests/report-release.smoke.test.js` — Comportement de la diffusion des rapports
- `tests/publish-sharepoint-mock.test.js` — Publication SharePoint contre une simulation uniquement
- `tests/e2e-outbound-guard.test.js` — Rien ne sort du serveur pendant les tests
- `docs/ai-decisions/ADR-G16-outbound-alerts-armed-off.md` — Les alertes sortantes sont livrées désarmées
- `docs/ai-decisions/ADR-P9-export-policy.md` — Politique d'export

**Ce que seuls des humains peuvent fournir**

| Élément attendu | Décision | Nom | Date | Signature |
|---|---|---|---|---|
| Autorité par rapport. | | | | |
| Identifiants des canaux (saisis par une personne, jamais par l'agent). | | | | |

## G15 — Produit : acceptation métier

- Ligne RELEASE-GATES : « Product — business acceptance »
- Approbateur : Sponsor / PO · bloque : déploiement général · à décider après : G11, G21, G06

**Preuves déjà disponibles (dépôt)**

- `docs/sdp360/completion/TRUTH-MATRIX.md` — Matrice de vérité : ce qui est implémenté, testé, validé
- `docs/ops/PERSONA-JOURNEYS.md` — Correspondance persona-parcours
- `docs/audits/2026-11-12-enterprise-review/UAT-COMITE-UTILISATEURS.md` — Revue d'un comité utilisateurs IA (pas de vrais utilisateurs)
- `docs/agent-execution/G24-DOSSIER-GO-NOGO-FR.md` — Dossier GO/NO-GO antérieur (pilote conditionnel, production NO-GO)

**Ce que seuls des humains peuvent fournir**

| Élément attendu | Décision | Nom | Date | Signature |
|---|---|---|---|---|
| Critères d'acceptation et revue du rapport de pilote. | | | | |

## G17 — Mise en production

- Ligne RELEASE-GATES : « Production deployment GO/NO-GO »
- Approbateur : CAB · bloque : déploiement général · à décider après : G01, G02, G03, G04, G05, G15, G18, G19, G20

**Preuves déjà disponibles (dépôt)**

- `docs/sdp360/completion/RELEASE-RUNBOOK-2026-10-29.md` — Procédure de mise en production
- `docs/INSTALLER.md` — Guide de l'installeur
- `docs/ops/INSTALLATION.md` — Procédure d'installation
- `docs/ops/EXPLOITATION.md` — Guide d'exploitation
- `docs/agent-execution/G24-DOSSIER-GO-NOGO-FR.md` — Dossier antérieur : production NO-GO

**Ce que seuls des humains peuvent fournir**

| Élément attendu | Décision | Nom | Date | Signature |
|---|---|---|---|---|
| Référence CAB, fenêtre, responsable du retour arrière. | | | | |

## G18 — Test d'intrusion

- Ligne RELEASE-GATES : « Penetration test / accepted analysis (E-B05, X-B-03) »
- Approbateur : Sécurité de l'information · bloque : déploiement général · à décider après : G01, G02

**Preuves déjà disponibles (dépôt)**

- `docs/security/PENTEST-SCOPE.md` — Règles d'engagement et scénarios proposés
- `docs/security/THREAT-MODEL.md` — Modèle de menace
- `tools/qa/route-matrix.js` — Inventaire des routes pour les testeurs

**Ce que seuls des humains peuvent fournir**

| Élément attendu | Décision | Nom | Date | Signature |
|---|---|---|---|---|
| Testeurs, dates, environnement, comptes de TEST. | | | | |

## G20 — Capacité : charge et endurance

- Ligne RELEASE-GATES : « Capacity — load / soak result accepted (E-B05) »
- Approbateur : SRE + DBA · bloque : déploiement général · à décider après : G03

**Preuves déjà disponibles (dépôt)**

- `docs/ops/LOAD-TEST.md` — Banc de charge ; aucun seuil fixé
- `tests/load-harness.test.js` — Comportement du banc
- `docs/agent-execution/PERF-BASELINE.md` — Observation de performance sur données synthétiques
- `docs/ops/CAPACITY-DATA-CONTRACT.md` — Contrat de données de capacité
- `docs/agent-execution/EXPLAIN-SYNTHETIC.md` — Plans de requêtes sur données synthétiques

**Ce que seuls des humains peuvent fournir**

| Élément attendu | Décision | Nom | Date | Signature |
|---|---|---|---|---|
| Budgets de latence et d'erreurs. | | | | |
| Nombre d'utilisateurs attendu par site. | | | | |

## G16 — Juridique et commercial

- Ligne RELEASE-GATES : « Legal / commercial (G-38/G-39) »
- Approbateur : Juridique + responsable commercial · bloque : diffusion externe

**Preuves déjà disponibles (dépôt)**

- `docs/sdp360/completion/RIGHTS-REGISTER.md` — Registre des droits ; usage interne tant que le Juridique n'a pas tranché
- `docs/sdp360/completion/LICENCE-INVENTORY.csv` — Inventaire des licences tierces
- `tests/licence-inventory.test.js` — L'inventaire reste aligné sur le lockfile
- `LICENSE` — Licence actuelle (usage interne)

**Ce que seuls des humains peuvent fournir**

| Élément attendu | Décision | Nom | Date | Signature |
|---|---|---|---|---|
| Avis juridique et choix de licence. | | | | |
