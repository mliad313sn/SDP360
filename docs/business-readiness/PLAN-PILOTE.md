# Plan de pilote sur deux sites — SDP360

> **Préparé par IA — à valider par les responsables nommés.** Version 1 · 2026-11-20 · SHA de référence de la
> rédaction : `2fd10fe5` (branche de travail). Ce plan **propose** un ordre d'activation ; il ne décide rien.
> Les recommandations par lot viennent du **panel IA** du rapport P11 (sièges IA, pas une revue humaine
> indépendante). Aucun propriétaire, site, date, seuil ou résultat n'est rempli : chaque champ humain est vide.
> Les décisions qui conditionnent chaque vague sont numérotées `HD-…` dans `docs/business-readiness/REGISTRE-DECISIONS-HUMAINES.md`.

## 0. En une page

| | |
|---|---|
| Où | **Instance de TEST** uniquement (`docs/ops/pilot/TEST-INSTANCE.md`). La production n'est touchée qu'après la porte G17. |
| Qui | Deux sites (décision HD-G11), une cohorte codée P01… (HD-U04). Les interrupteurs valent pour **toute l'instance** : le périmètre du pilote est tenu par l'instance de TEST et par les comptes de la cohorte, pas par l'interrupteur. |
| Quoi | Le produit tel que livré (interrupteurs par défaut), puis des **lots** d'interrupteurs (`docs/ops/switch-lots.json`) en trois vagues. |
| Comment | `node tools/ops/activate-switches.js` : plan (`--plan`), puis simulation (`--dry-run`), puis application, avec un fichier de retour arrière signé à chaque application. |
| Combien de temps | Proposition IA : 2 semaines de référence + 6 semaines de pilote (3 vagues × 2 semaines). Dates : champ humain. |
| Ce qui reste interdit | Lot L05 (NO-GO), envois sortants (`K:outbound`), écriture dans ServiceDesk Plus (`K:source_system_write`, refusé par l'outil), Centre de contrôle des politiques (`policy_center_enabled`). |

### Champs à remplir par les responsables (laisser vides tant que non décidés)

| Champ | Valeur | Décideur (rôle) | Décision | Nom | Date | Signature |
|---|---|---|---|---|---|---|
| Site pilote 1 | | Sponsor + IT Groupe (HD-G11) | | | | |
| Site pilote 2 | | Sponsor + IT Groupe (HD-G11) | | | | |
| Site optionnel de préparation hors ligne | | Sponsor + IT Groupe (HD-G11) | | | | |
| Responsable du pilote | | Sponsor | | | | |
| Opérateur de l'instance de TEST (exécute `activate-switches`) | | SRE | | | | |
| Facilitateur (hors équipe de construction) | | Sponsor (HD-U04) | | | | |
| Observateur | | Sponsor (HD-U04) | | | | |
| Détenteur de `PILOT_PSEUDONYM_KEY` | | Sponsor (HD-U07) | | | | |
| Début de la période de référence | | Responsable du pilote | | | | |
| Mise en route vague 1 | | Responsable du pilote | | | | |
| Fin du pilote | | Responsable du pilote | | | | |

## 1. Recommandation consolidée par lot (panel IA, tours 3 et 4)

Règle de consolidation : on retient **l'avis le plus prudent** des sièges qui ont évalué le lot au tour 4
(`docs/agent-execution/p11/round4-e43d11d5/`), et le tableau du tour 3 sinon (`docs/agent-execution/P11-readiness-report.md`).
Les correctifs 14 à 18, fusionnés après le tour 4, **n'ont pas été revérifiés par un panel** : un constat « corrigé
dans le code » n'est pas « vérifié ».

| Lot | Titre | Avis consolidé (IA) | Condition exacte | Décisions (registre) | Vague proposée |
|---|---|---|---|---|---|
| — | Produit par défaut (aucun interrupteur changé) | **GO PILOT** | aucune au-delà des portes du pilote | HD-G19, HD-G01, HD-G03, HD-G02, HD-G05, HD-G12, HD-G11, HD-G21 | 1 |
| L01 | Parcours du travail quotidien | **GO PILOT conditionnel** | la politique de clôture G07 est adoptée (le lot ouvre le registre des engagements `commitments_enabled`) ; un responsable du tableau de qualité des données et une personne qui répond aux retours sont nommés | HD-G07, HD-O07, HD-O08, HD-S03 | 1 |
| L02 | PMO — lecture du portefeuille | **CONDITIONAL** | SEC-F2 / R1-F2 tranché (montants lus par le comité) et consigné | HD-S01, HD-G21 | 2 |
| L03 | PMO — maîtrise des changements, baselines, jalons | **CONDITIONAL** | le responsable de la politique d'accès accepte `portfolio_editor_plan_writes` (élargit l'écriture) ou le sort du lot | HD-S02, HD-C03, HD-P04, HD-P05 | 2 |
| L09 | Confiance dans les indicateurs (lecture seule) | **CONDITIONAL** | minimum d'échantillon fixé ; aucun chiffre présenté comme certifié avant G06 ; L01 activé avant (dépendance `dashboard_red_action_links` → `commitments_enabled`) | HD-K06, HD-K04, HD-U01 | 2 |
| L14 | PMO — registre d'intake, qualité, tableau exécutif | **CONDITIONAL** | listes de référence et règles de qualité revues par le PMO ; décision SEC-F2 ; le retour arrière ne restaure que la configuration, pas les données saisies entre-temps (F-18) | HD-P01, HD-P02, HD-P03, HD-K12, HD-S01 | 2 |
| L15 | Atterrissage par profil (lot d'adoption B) | **NON ÉVALUÉ** par le panel (fusionné après le tour 4) | revue humaine ou nouveau passage du panel avant activation | HD-U11, HD-U06 | 2 |
| L04 | PMO — planification, ressources, collaboration | **CONDITIONAL** | le PMO accepte la lenteur du nivellement (PPM-F4) sans budget de performance approuvé ; un responsable capacité est nommé | HD-P06, HD-P07, HD-P08 | 3 |
| L08 | Cadence de gouvernance | **CONDITIONAL** | G07 adopté (dépendance `a01_missing_due_date` → `commitments_enabled`) ; G08 si les passations sont voulues ; signataires PIR et responsable problèmes nommés | HD-G07, HD-G08, HD-C01, HD-C02, HD-U18, HD-U19, HD-U20, HD-K11 | 3 |
| L10 | Rythme de reporting | **CONDITIONAL** | N-09 (fraîcheur) corrigé dans le code par le correctif 17, à revérifier ; délais de rappel fixés | HD-U15, HD-U16, HD-C04 | 3 |
| L11 | Preuves des opérations de site | **CONDITIONAL** | sondes « argent » sur les montants certifiés (R1-F5) ; seuils de certification Finance ; palier de rôle du technicien terrain | HD-F02, HD-F07, HD-U17, HD-U02, HD-O14 | 3 |
| L12 | Durcissement des accès | **CONDITIONAL** | exercice de break-glass sur TEST ; porte InfoSec ; N-R4-1 corrigé (correctif 14) à revérifier | HD-S07, HD-S08, HD-S11, HD-S12 | 3 |
| L05 | PMO — temps, argent, bénéfices | **NO-GO pour le pilote** | porte Finance G14 signée + SEC-F2 tranché + R4-1 revérifié ou accepté par la Finance | HD-G14, HD-S01, HD-F01, HD-F03, HD-F04, HD-F05 | exclu |
| L06 | Échange de plans (extras) | **CONDITIONAL**, hors pilote | porte connecteurs G13 ; Jira / Azure DevOps restent des appels sortants sautés par l'outil | HD-G13 | exclu |
| L07 | Publication de la feuille de route, sensibilité | **CONDITIONAL**, hors pilote | test de partage avec montants semés exécuté ; à activer avec L05 seulement (corbeille) | HD-S13, HD-C05 | exclu |
| L13 | Résilience des opérations | **CONDITIONAL**, hors pilote ; **NO-GO** pour activer `policy_center_enabled` | R4-A2 / N-10 revérifiés ; G05 signée ; deux interrupteurs sortants (`sync_drift_alerts`, `delivery_failure_alert_enabled`) | HD-S04, HD-O02, HD-O04, HD-G05 | exclu |

Groupes gardés éteints pendant tout le pilote : `K:outbound`, `K:armed_in_production` (maintien décidé à part,
HD-O09), `K:committee_policy` (G06), `K:external_precondition`, `K:irreversible_or_destructive`. L'outil refuse en
tout cas `K:source_system_write`, `K:kill_switch` et `K:not_a_switch`.

## 2. Prérequis avant la vague 1 (dans cet ordre)

| # | Prérequis | Preuve observable | Qui (rôle) | Fait le | Nom | Visa |
|---|---|---|---|---|---|---|
| P1 | Portes du chemin critique signées : G19 → G01 → G03 → G02 → G05 → G12 → G11 → G21 (`docs/agent-execution/gate-dossiers/INDEX.md`) | lignes remplies dans `docs/sdp360/completion/RELEASE-GATES.md` | approbateurs des portes | | | |
| P2 | Instance de TEST installée et mise à jour avec le paquet signé du SHA approuvé | `node tools\sdp-manager.js status` : service RUNNING, version = SHA approuvé | SRE | | | |
| P3 | Exercice de restauration réussi sur TEST | `node tools\pg\restore-drill.js --backup-first` → PASS, rapport daté dans `docs/ops/restore-drills/` | SRE | | | |
| P4 | Durcissement des droits d'audit appliqué sur TEST | sorties de contrôle du script `tools/pg/harden-audit-grants.sql` (propriétaire `sdp_audit_owner`) | DBA | | | |
| P5 | Statuts d'actions d'inspection corrigés sur les sites pilotes | `node tools/field/inspection-action-status-check.js` ne liste plus de ligne | Coordination de site | | | |
| P6 | Comptes de la cohorte créés avec le bon site et le bon rôle | liste nominative tenue hors dépôt ; contrôle `node tools/pg/audit-roles.js` : `blocked` = 0 | Sécurité de l'information | | | |
| P7 | Champs de décision remplis pour chaque interrupteur des vagues 1 et 2 | `docs/ops/flag-decisions.json` (fichier tenu par les décideurs) ; `docs/ops/FLAG-DECISIONS-GAPS.md` régénéré | décideurs par interrupteur | | | |
| P8 | Référence mesurée (4 semaines avant la mise en route) | sorties de `node tools/pilot/pilot-metrics.js` par site + instantané du tableau de valeur + chronomètre `baseline` | Responsable du pilote | | | |

## 3. Commandes par vague (TEST d'abord, toujours)

Règles communes :
- `--db-url=env` lit `PG_URL` dans le `.env` de l'instance de TEST : le mot de passe n'apparaît jamais sur une ligne de commande.
- `--reason` cite la référence de la décision du registre (au moins 10 caractères) ; `--operator` nomme la personne qui exécute.
- L'outil écrit un fichier de retour arrière signé (empreinte enregistrée dans `system_log`) **avant** la première écriture,
  dans le dossier `data/switch-rollbacks` de l'instance. Conserver le chemin affiché à la fin.
- Un lot est refusé en entier si un prérequis n'est pas allumé (exemple : L09 sans L01).
- Le retour arrière **ne restaure que la configuration** : les données saisies pendant que l'interrupteur était allumé restent en base.
- Ne jamais ajouter `--include-outbound` pendant le pilote.

### Vague 1 — produit par défaut + L01

Le produit par défaut ne demande aucune commande. Pour L01 (seulement si HD-G07 est adopté) :

```
node tools/ops/activate-switches.js --plan --lots=L01 --db-url=env
node tools/ops/activate-switches.js --apply --dry-run --lots=L01 --db-url=env --reason="Pilote vague 1 — HD-G07, réf. comité <réf.>" --operator=<opérateur>
node tools/ops/activate-switches.js --apply --lots=L01 --db-url=env --reason="Pilote vague 1 — HD-G07, réf. comité <réf.>" --operator=<opérateur>
```

Répétition obligatoire du retour arrière sur TEST avant la mise en route (puis ré-application) :

```
node tools/ops/activate-switches.js --rollback=<chemin du fichier affiché à l application> --db-url=env --operator=<opérateur> --reason="Répétition du retour arrière vague 1"
```

### Vague 2 — L02, L03, L09, L14, L15 (chacun seulement si ses conditions du §1 sont levées)

Appliquer lot par lot, pas en bloc, pour qu'un retour arrière ne touche qu'un lot :

```
node tools/ops/activate-switches.js --plan --lots=L02,L03,L09,L14,L15 --db-url=env
node tools/ops/activate-switches.js --apply --lots=L02 --db-url=env --reason="Pilote vague 2 — HD-S01 tranché, réf. <réf.>" --operator=<opérateur>
node tools/ops/activate-switches.js --apply --lots=L03 --db-url=env --reason="Pilote vague 2 — HD-S02 tranché, réf. <réf.>" --operator=<opérateur>
node tools/ops/activate-switches.js --apply --lots=L09 --db-url=env --reason="Pilote vague 2 — HD-K06 fixé, réf. <réf.>" --operator=<opérateur>
node tools/ops/activate-switches.js --apply --lots=L14 --db-url=env --reason="Pilote vague 2 — HD-P01/P02/P03 revus, réf. <réf.>" --operator=<opérateur>
node tools/ops/activate-switches.js --apply --lots=L15 --db-url=env --reason="Pilote vague 2 — HD-U11 revue faite, réf. <réf.>" --operator=<opérateur>
```

Si HD-S02 conclut « sortir `portfolio_editor_plan_writes` de L03 », le plan de lots est révisé (édition revue de
`docs/ops/switch-lots.json`, puis `node tools/agent/switch-lots.js --check`) **avant** d'appliquer L03.

### Vague 3 — L04, L08, L10, L11, L12

```
node tools/ops/activate-switches.js --plan --lots=L04,L08,L10,L11,L12 --db-url=env
node tools/ops/activate-switches.js --apply --lots=L04 --db-url=env --reason="Pilote vague 3 — HD-P06/P07 acceptés, réf. <réf.>" --operator=<opérateur>
node tools/ops/activate-switches.js --apply --lots=L08 --db-url=env --reason="Pilote vague 3 — HD-G07/HD-G08, réf. <réf.>" --operator=<opérateur>
node tools/ops/activate-switches.js --apply --lots=L10 --db-url=env --reason="Pilote vague 3 — HD-U15/HD-U16, réf. <réf.>" --operator=<opérateur>
node tools/ops/activate-switches.js --apply --lots=L11 --db-url=env --reason="Pilote vague 3 — HD-F02/HD-U17, réf. <réf.>" --operator=<opérateur>
node tools/ops/activate-switches.js --apply --lots=L12 --db-url=env --reason="Pilote vague 3 — exercice break-glass fait, réf. <réf.>" --operator=<opérateur>
```

L12 resserre les accès (refus 403 visibles par les utilisateurs) : prévenir la cohorte la veille.

## 4. Journal d'activation (à remplir par l'opérateur)

| Vague | Lot | Commande `--apply` exécutée le | Fichier de retour arrière | Réf. registre | Opérateur | Nom | Signature |
|---|---|---|---|---|---|---|---|
| 1 | L01 | | | HD-G07 | | | |
| 2 | L02 | | | HD-S01 | | | |
| 2 | L03 | | | HD-S02 | | | |
| 2 | L09 | | | HD-K06 | | | |
| 2 | L14 | | | HD-P01 | | | |
| 2 | L15 | | | HD-U11 | | | |
| 3 | L04 | | | HD-P07 | | | |
| 3 | L08 | | | HD-G08 | | | |
| 3 | L10 | | | HD-U15 | | | |
| 3 | L11 | | | HD-F02 | | | |
| 3 | L12 | | | HD-S07 | | | |

## 5. Ce qui se mesure, et avec quel instrument existant

Aucune cible chiffrée n'est posée ici : les cibles se fixent **à la fin**, par le sponsor, contre la référence
(`docs/ops/pilot/PILOT-MEASUREMENT.md` §3–§4). Une mesure non prise reste « non mesuré », jamais 0.

| Indicateur | Instrument (déjà dans le dépôt) | Comment le lire | Fréquence |
|---|---|---|---|
| Usage des pages de chaque profil | journal `page_viewed` → mesure `page_usage` de `node tools/pilot/pilot-metrics.js --from=… --to=… --site=… --format=both` | pages ouvertes par profil et par semaine, référence vs pilote | chaque lundi |
| Utilisateurs actifs sur des événements métier | même rapport | par site × rôle × semaine ISO | chaque lundi |
| Délai rapport hebdomadaire créé → soumis (proxy) | même rapport + `docs/ops/pilot/WEEKLY-REPORT-STOPWATCH.csv` (l'effort réel) | médiane ; le chronomètre est la vraie mesure d'effort | chaque semaine |
| Délai action créée → fermée (réunions, inspections, suivis) | même rapport | médiane par source | chaque lundi |
| Saisie terrain : appliquées / refusées / en échec / en attente | même rapport ; conflits 409 = « non enregistrés » par construction | toute ligne perdue ou dupliquée sur la fiche appareils = arrêt | chaque lundi |
| Part des indicateurs à source inconnue ou périmée | même rapport (section registre des métriques) ; `GET /api/sync/health` ; Admin ▸ System Logs ▸ Sync health | baisse attendue si les synchronisations sont saines | chaque lundi |
| Qualité des données du portefeuille (avec L14) | score de qualité du registre d'intake (page portefeuille, `ppm_data_quality_enabled`) | évolution du score des projets des sites pilotes | chaque semaine |
| Qualité des données des sources (avec L01) | page `data-quality.html` (`ui_data_quality_page`, admin) | nombre d'écarts ouverts par source | chaque semaine |
| Refus d'accès | `system_log` catégorie api (écritures + 403), export CSV de System Logs | un pic après L02 / L12 = régression d'accès probable | après chaque application |
| Erreurs serveur | identifiants `correlation_id` dans `pm2 logs` (`docs/ops/EXPLOITATION.md` §4) ; SLI `sli_30d` via `GET /api/health/deps` | tendance, pas de cible | chaque jour |
| Réussite des tâches et premier clic | séances T1–T8 et premier clic (`docs/ops/pilot/T1-T8-SHEET.csv`, `docs/ops/pilot/FIRST-CLICK-SHEET.csv`) résumées par `node tools/pilot/pilot-observed.js --sheets=…` | taux par tâche et par profil (moins de 3 lignes = échantillon insuffisant) | semaines 2–3 |
| Utilisabilité | SUS (`docs/ops/pilot/SUS-FORM.md` → `docs/ops/pilot/SUS-SHEET.csv`) | score par participant, médiane | semaines 2–3 |
| Fiabilité terrain sur vrais appareils | `docs/ops/pilot/FIELD-DEVICE-UAT.md` → `docs/ops/pilot/FIELD-DEVICE-SHEET.csv` | une ligne `lost` ou `duplicate` arrête la partie terrain | chaque semaine terrain |

### Critères de succès proposés (IA) — à adopter, amender ou rejeter par le sponsor

| Critère | Proposition IA (non approuvée) | Décision | Nom | Date | Signature |
|---|---|---|---|---|---|
| Sécurité | zéro lecture ou écriture d'un autre site observée | | | | |
| Données terrain | zéro ligne `lost` / `duplicate` sur la fiche appareils | | | | |
| Usage | chaque profil de la cohorte ouvre ses trois pages de tâches en semaine 3 et 4 (`page_usage`) | | | | |
| Tâches | chaque tâche T1–T8 réussie seule par au moins les deux tiers des participants qui l'ont tentée | | | | |
| Effort | temps actif du rapport hebdomadaire en pilote inférieur à la référence pour les participants mesurés dans les deux phases | | | | |
| Vérité des chiffres | aucun indicateur affiché en vert sur une source jamais synchronisée | | | | |

## 6. Critères d'arrêt et déclencheurs de retour arrière

| Observation | Action immédiate | Qui décide de reprendre |
|---|---|---|
| Lecture ou écriture d'un autre site constatée par un participant | **arrêt du pilote**, incident P0 (`docs/ops/INCIDENT-RESPONSE.md`), retour arrière du dernier lot appliqué | Sécurité de l'information |
| Ligne `lost` ou `duplicate` sur la fiche appareils | arrêt de la partie terrain (`docs/ops/pilot/FIELD-DEVICE-UAT.md` §4) | Responsable du pilote + IT Groupe |
| Pic de refus 403 dans `system_log` juste après un lot qui resserre (L02, L08, L11, L12) | retour arrière **de ce lot seulement** avec son fichier | décideur du lot |
| Événement de risque `audit_chain_broken` (job `audit.chain_verify`) | gel des activations, enquête DBA | DBA + Sécurité de l'information |
| Exercice de restauration en échec, ou sauvegarde refusée (clé absente) | gel des activations ; incident de sévérité 2 | CAB + SRE |
| Synchronisation refusée par la garde de troncature | pas de retour arrière d'interrupteur : traiter la source (`docs/ops/EXPLOITATION.md`) ; les chiffres de la semaine sont marqués périmés | SRE + propriétaire de la source |
| `/ready` en échec ou erreurs 503 répétées | redémarrage stop → attente → start ; si répété, gel | SRE |
| Un chiffre du tableau de bord contredit la source sans explication | retour arrière de L09 si l'affichage est en cause ; sinon signalement au comité KPI | Comité KPI |
| Plainte bloquante d'un profil (ne trouve plus sa page) après L15 | retour arrière de L15 | Responsable du pilote |

## 7. Fin du pilote

La comparaison référence / pilote peut être rédigée par l'IA (étiquetée « revue IA ») ; la décision d'étendre,
d'ajuster ou d'arrêter appartient au product owner et au sponsor (porte G15), puis la mise en production au CAB
(porte G17). Voir `docs/business-readiness/CHECKLIST-GO-LIVE.md`.
