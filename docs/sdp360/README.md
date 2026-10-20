# SDP360 document set

| # | Document | Audience | Status |
|---|---|---|---|
| 00 | [Assessment & map of the inherited platform](00-ASSESSMENT.md) | Architects, committee | v1 — 2026-10-19 |
| 01 | [Strategic Master Document](01-STRATEGIC-MASTER-DOCUMENT.md) — vision, blueprint, unified data model, ingestion pipeline | Sponsors, architects | v1 |
| 02 | [Committee Charter & Operational Review Framework](02-COMMITTEE-CHARTER.md) — roles, cadence, rubrics, RFI workflow | Committee members | v1 — for ratification at the first session |
| 03 | [Four-phase Execution Roadmap](03-ROADMAP.md) | Sponsors, delivery team | v1 |
| 04 | [Functional Specification — Custom Tracker & Dynamic Dashboard Engine](04-TRACKER-DASHBOARD-ENGINE-SPEC.md) | Developers, committee | v1 |
| 05 | [SOP — creating, validating & publishing trackers and dashboards; UX standards](05-SOP-DASHBOARDS-AND-TRACKERS.md) | Site managers, authors | v1 |
| 06 | [Comparatif exécutif SDP-Dashboard → SDP360 et cible « plateforme de pilotage »](06-COMPARATIF-EXECUTIF.md) (français) | Direction, sponsors | v1 |
| 07 | [Étude d'évolution et prompt de développement piloté par le comité](07-ETUDE-EVOLUTION-ET-PROMPT.md) (français) | Direction, comité, équipe de développement | v1 |
| 08 | [Étude de l'existant et commande de la version 2.0 — version autonome pour un lecteur de SDP-Dashboard](08-ETUDE-SDP-DASHBOARD-2.0.md) (français) | Direction, comité produit, agent IA | v1 |
| R | [Rapport du comité d'évaluation — 16 regards, feuille de route et bénéfices attendus](review/2026-10-20-RAPPORT-COMITE-EVALUATION.md) (français, [PDF](review/2026-10-20-RAPPORT-COMITE-EVALUATION.pdf)) | Direction, comité produit, sponsors | v1.0 — 2026-10-20 |
| P | [Plan de remédiation complet (v1.1, exécution IA §8) — un prompt exécutable par constat, explication, bénéfice, critère d'acceptation](review/2026-10-20-PLAN-DE-REMEDIATION-PROMPTS.md) (français, [PDF](review/2026-10-20-PLAN-DE-REMEDIATION-PROMPTS.pdf)) | Équipe de développement, agent IA, comité | v1.0 — 2026-10-20 |
| T | [Templates](templates/) — RFI form, KPI definition sheet, tracker definition, dashboard definition, review minutes | Everyone | v1 |

Conventions: documents are written in English (the platform's UI language since 2026-10-16); French terms used on the mine sites are kept in brackets the first time they appear. Every normative statement uses *must / should / may*. File paths refer to this repository.
- `design/ETAPE-03-kpi.md` — dossier de conception de l'étape 3 (dictionnaire des KPI, politiques RAG, registre des sites).
- `design/ETAPE-04-securite.md` — dossier de conception de l'étape 4 (sécurité, SSO, MFA) ; procédure `docs/ops/INCIDENT-RESPONSE.md`, matrice `docs/ops/AUTHZ-MATRIX.md`.
- `design/ETAPE-05-installateur.md` — dossier de conception de l'étape 5 (installateur Inno, Manager, paquets versionnés, modularisation) ; guides `docs/ops/INSTALLATION.md`, `docs/ops/EXPLOITATION.md` ; ADR-002…005 dans `docs/adr/`.
- `design/ETAPE-07-trackers.md` — dossier de conception de l'étape 7 (constructeur de trackers, grille de saisie, liaisons aux sources, migration du tracker 2026).
- `design/ETAPE-08-cockpit-portefeuille.md` — dossier de conception de l'étape 8 (cockpit de réunion, registre des décisions, portefeuille, demandes d'amélioration, migration du Roadmap Manager).
- `design/ETAPE-09-rapports-engagement-publication.md` — dossier de conception de l'étape 9 (studio de rapports avec analyse déterministe et commentaire IA vérifié, règles d'alerte et notifications, liens de partage, API REST/OData et connecteurs).
- `design/ETAPE-10-terrain.md` — dossier de conception de l'étape 10 (application terrain hors-ligne, file d'attente idempotente, photos fragmentées, actions rapides, rôle `field-tech`) ; `design/ETAPE-10-script-pilote.md` — script du pilote sur deux sites et clinique de fin ; `../ops/REPLICA-RESTORE.md` — réplica PostgreSQL (RPO 15 min) et exercice de restauration.
- `design/ETAPE-06-design-direction.md` — dossier de conception de l'étape 6 (composeur, espace direction, design system) ; script `design/ETAPE-06-test-utilisabilite.md`.
