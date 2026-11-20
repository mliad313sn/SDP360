# Registre des décisions humaines en attente — SDP360

> **Préparé par IA — à valider par les responsables nommés.** Document généré par `node tools/release/business-readiness-check.js --write` à partir de
> `tools/release/business-readiness.source.js` — ne pas éditer à la main. Chaque « Recommandation IA » est une recommandation d'un agent IA,
> **pas une décision**. Les colonnes Décision, Nom, Date et Signature sont **vides par construction** : elles se
> remplissent dans la copie tenue par le comité de mise en production (et, pour une porte, dans
> `docs/sdp360/completion/RELEASE-GATES.md`). Aucune décision, approbation ou signature n'a été prise par l'IA.

Total : **110 décisions en attente**. Sources consolidées : dossiers des portes (`docs/agent-execution/gate-dossiers/`), ADR au statut PROPOSED (`docs/ai-decisions/`), journal de décisions 2027, rapport P11 (tours 1 à 4), profil pilote, revue d'adoption, plan de lots d'interrupteurs.

## Décomptes par décideur

| Décideur (rôle) | Décisions en attente |
|---|---|
| Sponsor | 5 |
| Sponsor + IT Groupe | 1 |
| Product owner | 9 |
| Responsable du pilote | 3 |
| Sécurité de l'information | 16 |
| Sécurité de l'information + Finance | 1 |
| Finance | 9 |
| Comité KPI | 15 |
| Comité de gouvernance | 7 |
| PMO | 14 |
| CAB | 2 |
| CAB + SRE | 1 |
| SRE | 3 |
| DBA | 2 |
| SRE + DBA | 1 |
| Propriétaires des données | 2 |
| Responsable QA | 2 |
| Responsable des rapports | 2 |
| Responsable plateforme / intégrations | 5 |
| Responsable réseau | 1 |
| Responsable inspections / GRC | 2 |
| Responsable incidents / problèmes | 1 |
| Coordination de site | 3 |
| DPO | 1 |
| HSE | 1 |
| Juridique + commercial | 1 |
| **Total** | **110** |

Légende de la colonne « Bloque » : `Lnn` = lot d'interrupteurs (`docs/ops/switch-lots.json`), `Gnn` = porte de mise en production (`docs/agent-execution/gate-dossiers/INDEX.md`), `K:` suivi d'un nom = groupe gardé éteint par le plan de lots.

## Sponsor (5)

| Id | À trancher | Options | Recommandation IA | Bloque | Source | Décision | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|---|---|
| HD-G15 | Porte G15 — critères d'acceptation métier et revue du rapport de pilote. | Accepter · Accepter sous conditions · Refuser | Décider à partir des mesures du pilote seulement (PILOT-MEASUREMENT.md). | G15 | `docs/agent-execution/gate-dossiers/fr/G15-product-business-acceptance.md` | | | | |
| HD-U04 | D-P09-2 / D-P09-3 — cohorte (participants codés P01…), facilitateur, observateur, dates (référence, mise en route, fin). | Nommer · Pas maintenant | Facilitateur extérieur à la construction des écrans. | G11 | `docs/ops/pilot/PILOT-RUNBOOK.md` | | | | |
| HD-U05 | D-P09-6 — fusions et retraits de pages (lot C de la revue d'adoption). | Après 30 jours d'usage · Jamais | Après 30 jours de données d'usage. | G15 | `docs/ux/adoption-review-2026-11-20/ADOPTION-REVIEW.md` | | | | |
| HD-U07 | D-P09-8 — détenteur de la clé de pseudonymisation du pilote (`PILOT_PSEUDONYM_KEY`). | Nommer · Pas de lignes par utilisateur | Nommer une personne hors de l'équipe de livraison. | G11 | `docs/ops/pilot/PILOT-MEASUREMENT.md` | | | | |
| HD-U09 | D5 — nouvelle présentation des graphiques exécutifs (`ui_exec_charts_v2`) après revue navigateur. | Adopter · Inchangé | Revue avec le sponsor exécutif en semaine 3. | K:committee_policy | `docs/ops/pilot/PILOT-PROFILE.md` | | | | |

## Sponsor + IT Groupe (1)

| Id | À trancher | Options | Recommandation IA | Bloque | Source | Décision | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|---|---|
| HD-G11 | Porte G11 / D-05 — les deux sites pilotes, le site optionnel de préparation hors ligne, les utilisateurs nommés et les critères de succès du GO/NO-GO. | Deux sites · Un site d'abord · Pas maintenant | Deux sites contrastés : un site minier francophone (coordinateur + technicien terrain) et un bureau ; critères = section 6 de PLAN-PILOTE.md. | G11 | `docs/agent-execution/gate-dossiers/fr/G11-pilot-sites-field-uat.md`<br>`docs/ops/pilot/PILOT-RUNBOOK.md` | | | | |

## Product owner (9)

| Id | À trancher | Options | Recommandation IA | Bloque | Source | Décision | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|---|---|
| HD-S12 | Direction en lecture seule sur le portefeuille (`portfolio_executive_readonly`). | Lecture seule · Inchangé | Décision IAM + PO ; sans effet sur le pilote si aucun compte executive n'écrit. | L12 | `docs/ops/pilot/PILOT-PROFILE.md` | | | | |
| HD-C04 | Retour en brouillon d'un rapport soumis (`report_revert_policy` : « site_editor » ou « second_person », `report_reassign_submitted`). | Inchangé · Deuxième personne | Deuxième personne (proposition du profil pilote). | L10 | `docs/ops/pilot/PILOT-PROFILE.md` | | | | |
| HD-O08 | Personne qui répond aux retours utilisateurs (`ui_feedback_enabled`). | Nommer · Pas maintenant | Nommer avant la vague 1. | L01 | `docs/ops/pilot/RACI-TEMPLATE.md` | | | | |
| HD-U01 | D-2 — glossaire français validé par un coordinateur francophone, langue par défaut (`ui_lang_default`), pages traduites (`ui_i18n_pages`). | Français par défaut au pilote · Inchangé | Français par défaut sur les sites francophones. | L09 | `docs/ai-decisions/ADR-A09-ui-language-policy.md` | | | | |
| HD-U02 | Palier de rôle du technicien terrain (viewer + field-tech ou editor) — conditionne F-9/F-10. | viewer + field-tech · editor | viewer + field-tech (moindre privilège). | L11, G11 | `docs/agent-execution/p11/round4-e43d11d5/r4-ux-field.md` | | | | |
| HD-U06 | D-P09-7 — destination d'un compte audit-viewer seul ou dashboard-publisher seul (page qu'il ne peut pas ouvrir). | Changer la destination · Changer le profil par défaut | Changer la destination (présentation seule). | L15 | `docs/ops/pilot/PILOT-RUNBOOK.md` | | | | |
| HD-U12 | Résolution des entrées terrain bloquées par un admin (`field_outbox_resolve_enabled`) après les séances sur vrais appareils. | Après les séances · Jamais | Après les séances sur appareils. | K:external_precondition | `docs/ops/pilot/PILOT-PROFILE.md` | | | | |
| HD-U14 | Calendrier local d'un site non UTC (`site_local_calendar`). | Activer à l'ajout d'un site non UTC · Inchangé | Inchangé tant que tous les sites sont en UTC+0. | K:external_precondition | `docs/ops/pilot/PILOT-PROFILE.md` | | | | |
| HD-U16 | Politique d'alerte : regroupement par règle (`alert_group_by_rule`) et heures de silence (`alert_quiet_hours`). | Adopter · Inchangé | Regroupement par règle en vague 3. | L10 | `docs/ops/pilot/PILOT-PROFILE.md` | | | | |

## Responsable du pilote (3)

| Id | À trancher | Options | Recommandation IA | Bloque | Source | Décision | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|---|---|
| HD-U03 | D-P09-4 — les trois tâches par profil (proposition IA), à confirmer par la cohorte. | Confirmer · Amender | Confirmer en séance de formation. | G11 | `docs/ops/pilot/PILOT-RUNBOOK.md` | | | | |
| HD-U10 | D-6 — profil de menu (`ui_nav_profile`), menu exécutif (`ui_exec_nav`), rôles du constructeur de dossiers (`ui_deck_builder_roles`). | Valeurs du profil pilote · Inchangé | Valeurs du profil pilote, à revoir après les séances T1–T8. | G11 | `docs/ops/pilot/PILOT-PROFILE.md` | | | | |
| HD-U11 | L15 (atterrissage par profil) aux sites pilotes : avis panel IA du tour 6 — sécurité et UX GO PILOT, `ui_helpdesk_site_default` et classement des sites CONDITIONAL (F-21, F-26 corrigés dans le code par les correctifs 28 et 25, non revérifiés). | Activer en vague 2 après revue · Pas maintenant | Activer en vague 2 après vérification des graphies de site du filtre Helpdesk aux sites pilotes. | L15 | `docs/ai-decisions/ADR-ADOPTION-LOTB-profile-landing.md` | | | | |

## Sécurité de l'information (16)

| Id | À trancher | Options | Recommandation IA | Bloque | Source | Décision | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|---|---|
| HD-G01 | Porte G01 — politique d'accès (périmètre de site CG-01/CG-02), liste des comptes pilotes et de leurs rôles, accès par département D-14 avant ou après le pilote ; qui peut réinitialiser les identifiants d'un super_admin, et quels super_admins peuvent émettre un jeton opérateur pour `activate-switches` (P11 tour 6, R6-A1). | GO avec le modèle par site · GO sous conditions (routes à restreindre d'abord) · NO-GO | GO pour le pilote avec le modèle par site ; D-14 après le pilote. | G01, L02, L03, L12 | `docs/agent-execution/gate-dossiers/fr/G01-security-access-policy.md`<br>`docs/ops/AUTHZ-MATRIX.md` | | | | |
| HD-G02 | Porte G02 — rotation datée du secret EX-01, acceptation nominative de chaque risque résiduel, liste des pages en CSP stricte après une période en mode rapport. | GO · GO sous conditions · NO-GO | Signer la rotation EX-01 avant tout compte pilote ; accepter les P2 restants nommément (registre résiduel du rapport P11). | G02 | `docs/agent-execution/gate-dossiers/fr/G02-threat-model-findings.md`<br>`docs/agent-execution/P11-readiness-report.md` | | | | |
| HD-G04 | Porte G04 / D-12 — détenteur de la clé de signature (jamais la clé) et SHA des actions CI vérifiés. | GO · NO-GO | Remplacer la clé publique de démonstration avant la première release signée. | G04 | `docs/agent-execution/gate-dossiers/fr/G04-signing-key-ci-shas.md` | | | | |
| HD-G18 | Porte G18 — test d'intrusion : testeurs, dates, environnement, comptes de TEST. | Test d'intrusion externe · Analyse acceptée sans test · Pas maintenant | Test externe sur l'instance de TEST après le pilote, avant G17. | G18 | `docs/agent-execution/gate-dossiers/fr/G18-penetration-test.md` | | | | |
| HD-S02 | Élargissement d'accès `portfolio_editor_plan_writes` (les éditeurs de site écrivent les plans de leurs projets), contenu dans L03. | Accepter dans L03 · Sortir l'interrupteur de L03 (révision du plan de lots) · Garder éteint | Sortir l'interrupteur dans un lot séparé ; activer L03 sans lui. | L03 | `docs/agent-execution/p11/round4-e43d11d5/r4-audit.md`<br>`docs/ai-decisions/ADR-G15-portfolio-site-scope.md` | | | | |
| HD-S03 | Périmètre de lecture du compte audit-viewer (voit 0 réunion aujourd'hui, item 9 de la revue d'adoption). | Lecture de toute la flotte en lecture seule · Liste de sites nommés · Inchangé | Liste de sites nommés pour l'auditeur du pilote. | L01 | `docs/ux/adoption-review-2026-11-20/ADOPTION-REVIEW.md` | | | | |
| HD-S04 | Centre de contrôle des politiques (`policy_center_enabled`) : peut-on s'appuyer sur son double contrôle ? Tour 6 du panel IA : les contournements des tours 4 et 5 sont refusés, reste N-R6-1 (correctif 26, non fusionné ici). Depuis le correctif 29 (R6-A1), c'est le SEUL chemin par lequel un interrupteur « quatre yeux » des lots L03, L08, L11, L12, L14 peut être activé (demande déposée avec un jeton opérateur, approuvée par un second super_admin). | Activer après revérification de N-R6-1 et du correctif 29 · Activer sans s'appuyer sur le double contrôle · Garder éteint (les lots « quatre yeux » restent alors éteints) | Activer sur TEST après revérification de N-R6-1 (correctif 26) et de R6-A1 (correctif 29) par un nouveau passage du panel ou une revue humaine ; d'ici là, garder éteint et ne pas appliquer les lots « quatre yeux ». | L13 | `docs/agent-execution/P11-readiness-report.md`<br>`docs/agent-execution/p11/round4-e43d11d5/r4-audit.md`<br>`docs/ai-decisions/ADR-POLICY-CENTER.md` | | | | |
| HD-S05 | Clé de tableau de bord injectée dans les pages (SEC-F3) : passer `ui_inject_dash_key` à 0 et `dashkey_scope_mode` de `open` à `shadow` puis `restrict`. | Shadow pendant le pilote · Restrict après recensement · Inchangé | Shadow pendant le pilote, `ui_inject_dash_key` à 0 après un passage navigateur sur TEST. | G13 | `docs/ops/pilot/PILOT-PROFILE.md`<br>`docs/agent-execution/P11-readiness-report.md` | | | | |
| HD-S06 | Mode d'application des capacités : `authz_capability_mode` (`off` → `shadow` → `enforce`) et liste `authz_enforce_caps`. | Shadow deux semaines · Inchangé | Shadow pendant le pilote ; enforce seulement après deux semaines sans divergence inexpliquée. | G01 | `docs/ops/pilot/PILOT-PROFILE.md`<br>`docs/ai-decisions/ADR-P02-authz-outcomes.md` | | | | |
| HD-S07 | Approbation des droits et accès d'urgence : matrice d'approbateurs (`access_require_approval`), super_admins habilités pour `emergency_access_enabled`, `breakglass_timebox_enabled`, exercice de break-glass. | Nommer et activer L12 au pilote · Pas maintenant | Nommer deux super_admins et faire l'exercice de break-glass sur TEST avant L12. | L12 | `docs/ops/pilot/PILOT-PROFILE.md`<br>`docs/agent-execution/p11/round4-e43d11d5/r4-security.md` | | | | |
| HD-S08 | Limitation des connexions : `login_limit_failures_only` et `auth_account_throttle_enabled` (verrouillage volontaire possible d'un compte nommé). | Activer · Inchangé | Activer `login_limit_failures_only` : il corrige le verrouillage d'un site vu derrière une seule adresse. | L12 | `docs/ops/pilot/PILOT-PROFILE.md` | | | | |
| HD-S09 | Coût de hachage des mots de passe (`auth_pbkdf2_iterations`, 100000 aujourd'hui). | Garder 100000 · Cible d'une revue cryptographique | Garder 100000 jusqu'à une revue cryptographique ; la valeur n'est pas pour l'IA. | G02 | `docs/ops/pilot/PILOT-PROFILE.md` | | | | |
| HD-S10 | Désactivation des départs Entra : consentement Graph `User.Read.All` (administrateur du locataire), puis `entra_deprovision_enabled` en essai et `entra_deprovision_apply`. | Consentir et essayer sur TEST · Pas maintenant | Hors pilote : nécessite le consentement du locataire et un essai relu. | L13, K:irreversible_or_destructive | `docs/ops/pilot/PILOT-PROFILE.md` | | | | |
| HD-S11 | Matrice de sensibilité des exports (`export_policy_strict`, `export_watermark_enabled`, ADR-P9). | Adopter la matrice proposée · Inchangé | Adopter en vague 3 avec L12 ; les lecteurs perdent certains exports, à annoncer. | L12 | `docs/ai-decisions/ADR-P9-export-policy.md` | | | | |
| HD-S13 | Partage public des feuilles de route et projets sensibles (`roadmap_audience_publication_enabled`, `portfolio_sensitive_projects`). | Activer avec un test de partage montants semés · Pas maintenant | Hors pilote tant que le test de partage avec montants n'est pas exécuté. | L07 | `docs/agent-execution/p11/round4-e43d11d5/r4-security.md` | | | | |
| HD-S15 | Activation du fournisseur d'IA (`AI_PROVIDER`) — aucune donnée de production vers un modèle sans accord du propriétaire. | Rester éteint · Fournisseur local · Fournisseur cloud | Rester éteint pendant le pilote. | K:external_precondition | `docs/ops/FLAG-REGISTER.md` | | | | |

## Sécurité de l'information + Finance (1)

| Id | À trancher | Options | Recommandation IA | Bloque | Source | Décision | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|---|---|
| HD-S01 | SEC-F2 / R1-F2 — les membres du comité lisent les montants du portefeuille (6 routes). | Accepter et amender l'invariant · Restreindre aux paliers admin + lecteur finance · Totaux seulement pour le comité | Totaux seulement pour le comité pendant le pilote ; montants détaillés pour admin + finance-viewer. | L02, L05, L14 | `docs/agent-execution/P11-readiness-report.md`<br>`docs/agent-execution/p11/round4-e43d11d5/r4-security.md` | | | | |

## Finance (9)

| Id | À trancher | Options | Recommandation IA | Bloque | Source | Décision | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|---|---|
| HD-G14 | Porte G14 — source des taux de change, rôle certificateur des montants, certification des budgets et bénéfices. | GO · GO sous conditions · NO-GO (L05 reste hors pilote) | Ne pas mettre L05 au pilote avant cette signature. | G14, L05, L11 | `docs/agent-execution/gate-dossiers/fr/G14-finance-budgets-benefits.md` | | | | |
| HD-F01 | Règles de devise : devise par site (`asset_site_currency`), taux (`asset_currency_rates`), devise obligatoire (`finance_currency_required`), lecture des montants (`asset_amount_parser`). | Fournir les tables · Inchangé (XOF par défaut) | Fournir les tables avant tout montant présenté au comité. | L05, G14 | `docs/ops/FINANCE-CURRENCY-RULES.md` | | | | |
| HD-F02 | Seuils de certification des montants du parc (`asset_money_certify_min_sites`, `asset_money_certify_min_pct`) avant `asset_money_certify_display`. | 3 sites / 50 % · Autres seuils | Garder 3 / 50 pendant le pilote. | L11 | `docs/ops/pilot/PILOT-PROFILE.md` | | | | |
| HD-F03 | Grille des périodes budgétaires et certification EVM (`ppm_budget_periods_enabled`, `ppm_evm_enabled`, `finance_certification_enabled`). | Certifier · Pas maintenant | Pas au pilote. | L05 | `docs/ai-decisions/ADR-P2-finance-certification-and-actuals.md` | | | | |
| HD-F04 | R4-1 (montants réels perdus à la suppression) : corrigé par le correctif 15, pas encore revérifié par un panel. | Faire revérifier · Accepter | Faire revérifier avant L05. | L05 | `docs/agent-execution/p11/round4-e43d11d5/r4-ppm.md` | | | | |
| HD-F05 | Rôle vérificateur des bénéfices monétaires (`benefit_money_verifier_role`) et classes de valeur (`benefit_value_class_enabled`). | Nommer un rôle · Pas maintenant | Avec L05 seulement. | L05 | `docs/ops/pilot/PILOT-PROFILE.md` | | | | |
| HD-F06 | Import des réalisés (`actuals_import_enabled`). | Activer · Pas maintenant | Pas au pilote. | L05 | `docs/ops/pilot/PILOT-PROFILE.md` | | | | |
| HD-F07 | Preuve contractuelle exigée pour les réclamations SLA WAN (`wan_sla_require_contract_evidence`, puis `wan_sla_claims_enabled`). | Exiger après dépôt des contrats · Pas maintenant | Exiger dès que les contrats sont déposés. | L11 | `docs/ai-decisions/ADR-P8-sla-credit-claims.md` | | | | |
| HD-F08 | Dossier annuel : enveloppes et arbitrages (`ppm_annual_pack_enabled`). | Activer avant le comité annuel · Pas maintenant | Hors pilote. | L05 | `docs/ops/pilot/PILOT-PROFILE.md` | | | | |

## Comité KPI (15)

| Id | À trancher | Options | Recommandation IA | Bloque | Source | Décision | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|---|---|
| HD-G06 | Porte G06 — définition et seuil approuvés par indicateur, choix du score de site de référence (D-03). | Adopter · Adopter une partie · Pas maintenant (aucun chiffre officiel) | Le pilote peut tourner sans G06 : chaque chiffre reste marqué « non certifié ». | G06, K:committee_policy | `docs/agent-execution/gate-dossiers/fr/G06-kpi-definitions-thresholds.md` | | | | |
| HD-K01 | D-01 — dictionnaire des indicateurs : définitions, numérateurs/dénominateurs, règles N/A et fraîcheur des cinq dimensions (poids proposés 20/20/25/20/15). | Adopter · Amender · Pas maintenant | Adopter les définitions avant les poids. | G06 | `docs/sdp360/2027/02-DECISION-LOG.md` | | | | |
| HD-K02 | D-02 — seuils RAG et signaux anti-manipulation (proposé ≥ 80 / 60–79 / < 60). | Adopter · Amender · Pas maintenant | Adopter après un mois de lecture du pilote. | G06 | `docs/sdp360/2027/02-DECISION-LOG.md` | | | | |
| HD-K03 | D-03 — score de site de référence (`site_score_published_model` : `legacy` ou `programme`) et seuil vert du tracker. | legacy · programme · Pas maintenant | Garder `legacy` pendant le pilote, comparer les deux. | G06 | `docs/sdp360/2027/02-DECISION-LOG.md`<br>`docs/ai-decisions/ADR-A11-published-site-score-switch.md` | | | | |
| HD-K04 | Définition du SLA helpdesk et du chiffre de tête (`helpdesk_sla_definition`, `sla_headline_definition`) et alignement des écrans (Houndé 60 % vs 50 %, item 19). | flag / closed_only (aujourd'hui) · due_vs_resolved / incl_open | Garder les valeurs actuelles et afficher la définition sous chaque chiffre (L09). | G06, L09 | `docs/ops/pilot/PILOT-PROFILE.md`<br>`docs/ux/adoption-review-2026-11-20/ADOPTION-REVIEW.md` | | | | |
| HD-K05 | Politique des zéros du dossier exécutif (`exec_payload_zero_policy`) et formule des changements de la vue publique (`exec_view_change_formula`). | Valeurs actuelles · Valeurs alternatives | Garder les valeurs actuelles pendant le pilote. | G06 | `docs/ops/pilot/PILOT-PROFILE.md` | | | | |
| HD-K06 | Taille minimale d'échantillon affichée par `ui_kpi_sample_size` (sans elle, aucun avertissement). | Fixer un minimum · Pas maintenant | Fixer un minimum avant d'activer L09. | L09 | `docs/ops/pilot/PILOT-PROFILE.md` | | | | |
| HD-K07 | Règle des mois partiellement saisis du tracker (item 2 de la revue d'adoption). | Proportionnel · Non saisi tant que le mois n'est pas complet | Non saisi tant que le mois n'est pas complet. | G06 | `docs/ux/adoption-review-2026-11-20/ADOPTION-REVIEW.md` | | | | |
| HD-K08 | Les deux indicateurs de décision du tableau de bord (`dashboard_decision_kpis_seed`). | Choisir deux indicateurs · Pas maintenant | Choisir après le pilote. | K:committee_policy | `docs/ops/pilot/PILOT-PROFILE.md` | | | | |
| HD-K09 | Adoption d'une politique de SLA de résolution dans le constructeur (`kpi_policy_enforced`, auteur ≠ adoptant). | Adopter · Pas maintenant | Lire la comparaison en ombre pendant le pilote, adopter ensuite. | K:committee_policy | `docs/ai-decisions/ADR-C31-kpi-policy-builder.md` | | | | |
| HD-K10 | Lecteurs du score programme sur tableaux de bord et API (`metric_programme_readers`). | Activer · Pas maintenant | Pas maintenant (non certifié). | K:committee_policy | `docs/ops/pilot/PILOT-PROFILE.md` | | | | |
| HD-K11 | Seuil de récurrence des candidats problèmes (`problem_candidate_min`). | Fixer un seuil · Pas maintenant | Fixer avec le responsable problèmes avant `problem_candidates_enabled`. | L08 | `docs/ops/pilot/PILOT-PROFILE.md` | | | | |
| HD-K12 | Sens proposés de priorité / effort / risque du registre d'intake (L14). | Adopter · Amender | Adopter avant d'utiliser les scores en comité. | L14 | `docs/agent-execution/p11/round4-e43d11d5/r4-ppm.md` | | | | |
| HD-K13 | Codes de site depuis le registre (`site_codes_from_registry` : shadow puis 1). | Shadow deux semaines · Pas maintenant | Shadow pendant le pilote. | K:committee_policy | `docs/ops/pilot/PILOT-PROFILE.md` | | | | |
| HD-K14 | Décision de maintien pour les changements de chiffres livrés actifs (lot d'adoption A, sans interrupteur). | Maintenir · Revenir en arrière | Maintenir : les inconnus deviennent « — » au lieu de 0. | G06 | `docs/agent-execution/p11/round4-e43d11d5/r4-audit.md`<br>`docs/ai-decisions/ADR-ADOPTION-LOTA-truth-no-dead-ends.md` | | | | |

## Comité de gouvernance (7)

| Id | À trancher | Options | Recommandation IA | Bloque | Source | Décision | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|---|---|
| HD-G07 | Porte G07 / D-04 — politique de clôture : rôles vérificateurs par site, destinataires des escalades A01/A02, fenêtre de service avant escalade. | Adopter · Adopter sous conditions · Pas maintenant (le registre des engagements reste éteint) | Adopter avant la vague 1 si `commitments_enabled` est voulu au pilote ; sinon L01 attend. | G07, L01, L08, L09 | `docs/agent-execution/gate-dossiers/fr/G07-closure-policy-commitments.md`<br>`docs/sdp360/2027/02-DECISION-LOG.md` | | | | |
| HD-G08 | Porte G08 — passations : destinataires des notifications, correspondance utilisateur ↔ département si voulue. | Activer sans notification · Activer avec notification · Pas maintenant | Activer `handoffs_enabled` sans notification au pilote ; `handoff_notify_enabled` reste éteint (envoi sortant). | G08, L08 | `docs/agent-execution/gate-dossiers/fr/G08-handoffs.md` | | | | |
| HD-G09 | Porte G09 — relecteur par public des tableaux de bord et trackers publiés. | Nommer les relecteurs · Publication par l'admin seulement pendant le pilote | Pendant le pilote, publication par l'admin seulement ; nommer les relecteurs avant le déploiement général. | G09 | `docs/agent-execution/gate-dossiers/fr/G09-dashboard-tracker-reviewers.md` | | | | |
| HD-C01 | Cycle de vie des décisions (`decision_lifecycle_enforced`, `decision_motive_required`) et décisions dans les obligations (`obligations_include_decisions`). | Activer en vague 3 · Pas maintenant | Activer en vague 3 avec L08. | L08 | `docs/ops/pilot/PILOT-PROFILE.md` | | | | |
| HD-C02 | Préparation automatique des ordres du jour en brouillon (`agenda_cron_enabled`) — rien n'est envoyé. | Activer · Pas maintenant | Activer en vague 3. | L08 | `docs/ops/pilot/PILOT-PROFILE.md` | | | | |
| HD-C03 | Gouvernance du re-baselining : qui peut re-baseliner et seuils d'exception (ADR-G11b). | Comité seul · Chef de projet sous seuil | Comité seul pendant le pilote. | L03 | `docs/ai-decisions/ADR-G11b-baseline-versions.md` | | | | |
| HD-C05 | Rétention de la corbeille (`soft_delete_enabled`, 30 jours) et purge (`soft_delete_purge_enabled`). | 30 jours sans purge · Autre durée | 30 jours, purge éteinte pendant le pilote. | L07 | `docs/ai-decisions/ADR-A19-soft-delete.md` | | | | |

## PMO (14)

| Id | À trancher | Options | Recommandation IA | Bloque | Source | Décision | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|---|---|
| HD-G21 | Porte G21 — nom du projet témoin, chef de projet, critères de certification. | Un projet réel du portefeuille · Pas maintenant | Choisir un projet en exécution, avec budget en une seule devise et une équipe nommée. | G21, L02, L14 | `docs/agent-execution/gate-dossiers/fr/G21-business-witness-project.md` | | | | |
| HD-P01 | Listes de référence du registre d'intake du portefeuille (statuts budgétaires, catégories) — PROPOSÉES. | Adopter · Amender | Revoir en atelier PMO avant L14. | L14 | `docs/ai-decisions/ADR-PORTFOLIO-LOT1-intake-register.md` | | | | |
| HD-P02 | Règles de qualité des données du portefeuille (19 contrôles, bandes 100/80) et blocage de soumission (`ppm_dq_gate_enforced`). | Adopter, blocage éteint · Adopter avec blocage | Adopter les règles, blocage éteint les deux premières semaines (révision du plan de lots si besoin). | L14 | `docs/ai-decisions/ADR-PORTFOLIO-LOT2-data-quality.md` | | | | |
| HD-P03 | Définitions des rapports du registre et seuil « bloqué » du tableau exécutif (L14 lot 3). | Adopter · Amender | Adopter pour le pilote, réviser après. | L14 | `docs/ai-decisions/ADR-PORTFOLIO-LOT3-register-dashboard.md` | | | | |
| HD-P04 | Validateurs des modèles de projet (`ppm_templates_enabled`). | Nommer · Pas maintenant | Nommer un validateur différent de l'auteur. | L03 | `docs/ops/pilot/PILOT-PROFILE.md` | | | | |
| HD-P05 | Modèle de phases et approbateurs des jalons (ADR-W3). | Adopter · Amender | Adopter le mappage proposé pour le pilote. | L03, L08 | `docs/ai-decisions/ADR-W3-GOVERNANCE-executive-governance.md` | | | | |
| HD-P06 | Responsable capacité et contrat de données de capacité ; allocation non précisée (`ppm_alloc_unspecified`). | Nommer et signer le contrat · Pas maintenant | Nommer avant `ppm_capacity_view`. | L04 | `docs/ops/CAPACITY-DATA-CONTRACT.md` | | | | |
| HD-P07 | Performance du nivellement (PPM-F4, 8,8–18,7 s) et budgets de performance (perf-budgets.json, PROPOSÉS). | Accepter pour le pilote · Attendre une optimisation | Accepter pour le pilote avec l'avertissement aux utilisateurs. | L04 | `docs/agent-execution/P11-readiness-report.md`<br>`docs/ops/perf-budgets.json` | | | | |
| HD-P08 | Commentaires de projet ouverts à tout lecteur (`ppm_comments_enabled`, élargit l'écriture). | Tout lecteur · Membres de l'équipe seulement | Tout lecteur sauf rôle client (proposition ADR-W4). | L04 | `docs/ai-decisions/ADR-W4-ENTERPRISE-project-roles-collab-offline.md` | | | | |
| HD-P09 | Politique d'approbation des feuilles de temps (ADR-P7B). | Règle d'écriture du plan · Responsable hiérarchique | Règle d'écriture du plan. | L05 | `docs/ai-decisions/ADR-P7B-timesheets-cr-simulation.md` | | | | |
| HD-P10 | Lien des propriétaires de bénéfices aux utilisateurs (`benefit_owner_link_enabled`). | Activer · Pas maintenant | Avec L05 seulement. | L05 | `docs/ops/pilot/PILOT-PROFILE.md` | | | | |
| HD-P11 | Critères de score des RFI nées de l'incubation (`incubation_rfi_link_enabled`). | Adopter des critères · Score provisoire | Score provisoire. | L07 | `docs/ops/pilot/PILOT-PROFILE.md` | | | | |
| HD-P12 | Redirection de la feuille de route vers le portefeuille (`roadmap_redirect_to_portfolio`) après un cycle de parité propre ; suppression des données = CAB. | Après parité · Jamais | Éteinte pendant le pilote. | K:irreversible_or_destructive | `docs/ops/pilot/PILOT-PROFILE.md` | | | | |
| HD-P13 | Portefeuille phase 2 (L16 : dépendances structurées, demande de ressources et capacité, documents, score d'effort, scénarios, export BI `ext_api_portfolio_enabled`) — absent du plan de pilote tant que le PMO, la sécurité (stockage des documents sans antivirus, export vers un outil tiers) et le propriétaire des données ne l'ont pas planifié. | Hors pilote · Planifier une vague dédiée après revue | Hors pilote ; à replanifier après une revue humaine (avis panel IA du tour 6 : sécurité GO PILOT, PPM CONDITIONAL — R6-1 avant toute vague ; consolidé CONDITIONAL). | L16 | `docs/ai-decisions/ADR-PORTFOLIO-LOT6-phase2.md` | | | | |

## CAB (2)

| Id | À trancher | Options | Recommandation IA | Bloque | Source | Décision | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|---|---|
| HD-G03 | Porte G03 — référence CAB, SHA cible approuvé pour TEST, fenêtre d'installation ; mise à jour des dépendances D-11 et passage à PostgreSQL seul PO-08. | GO pour TEST · GO sous conditions · NO-GO | Approuver d'abord l'installation sur TEST uniquement ; la production reste une décision G17 distincte. | G03 | `docs/agent-execution/gate-dossiers/fr/G03-cab-dependencies-postgres-only.md` | | | | |
| HD-G17 | Porte G17 — mise en production : référence CAB, fenêtre, responsable du retour arrière. | GO · NO-GO | Ne décider qu'après G01, G02, G03, G04, G05, G15, G18, G19 et G20. | G17 | `docs/agent-execution/gate-dossiers/fr/G17-production-deployment.md` | | | | |

## CAB + SRE (1)

| Id | À trancher | Options | Recommandation IA | Bloque | Source | Décision | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|---|---|
| HD-G05 | Porte G05 — valeurs RPO et RTO, emplacement et responsable des sauvegardes, date de l'exercice de restauration sur TEST. | Valeurs proposées ci-contre · Autres valeurs · NO-GO | Proposition IA : RPO 24 h (sauvegarde nocturne) et RTO 2 h (déjà la cible mesurée dans TEST-INSTANCE.md) ; copie hors site obligatoire. | G05, L13 | `docs/agent-execution/gate-dossiers/fr/G05-backup-restore-rpo-rto.md`<br>`docs/ops/pilot/TEST-INSTANCE.md` | | | | |

## SRE (3)

| Id | À trancher | Options | Recommandation IA | Bloque | Source | Décision | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|---|---|
| HD-O02 | Politique de rétrécissement des synchronisations (confirmation opérateur ou N confirmations) et dérogation de sauvegarde en clair (`SDP_BACKUP_ALLOW_PLAINTEXT`). | Confirmation opérateur · N confirmations | Confirmation opérateur ; aucune dérogation en clair. | L13, G05 | `docs/agent-execution/p11/round4-e43d11d5/r4-operations.md` | | | | |
| HD-O03 | Objectifs de service (SLO) : toutes les cibles sont UNKNOWN. | Fixer après le pilote · Fixer maintenant | Fixer après quatre semaines de lecture. | G20 | `docs/ops/SLO-PROPOSAL.md` | | | | |
| HD-O05 | Copie hors site des sauvegardes (`backup_offsite_path`). | Chemin UNC · Local seulement | Chemin UNC sur un autre serveur. | G05 | `docs/ops/EXPLOITATION.md` | | | | |

## DBA (2)

| Id | À trancher | Options | Recommandation IA | Bloque | Source | Décision | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|---|---|
| HD-O01 | Durcissement des droits d'audit (`tools/pg/harden-audit-grants.sql`) : à exécuter par un DBA, après sauvegarde, dans une fenêtre CAB. | TEST puis production · Pas maintenant | L'exécuter sur TEST avant la vague 1, en production dans la fenêtre G17. | G02, G17 | `docs/ops/EXPLOITATION.md`<br>`tools/pg/harden-audit-grants.sql` | | | | |
| HD-O06 | Index proposés (ADR-E-A05). | Créer · Attendre la charge | Attendre le résultat de charge G20. | G20 | `docs/ai-decisions/ADR-E-A05-index-proposals.md` | | | | |

## SRE + DBA (1)

| Id | À trancher | Options | Recommandation IA | Bloque | Source | Décision | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|---|---|
| HD-G20 | Porte G20 — budgets de latence et d'erreurs, nombre d'utilisateurs attendus par site. | Accepter le résultat de charge · Rejouer sur un environnement proche de la production | Rejouer la charge sur Windows Server + PostgreSQL 17 au volume de production avant G17. | G20 | `docs/agent-execution/gate-dossiers/fr/G20-capacity-load-soak.md`<br>`docs/ops/LOAD-TEST.md` | | | | |

## Propriétaires des données (2)

| Id | À trancher | Options | Recommandation IA | Bloque | Source | Décision | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|---|---|
| HD-G12 | Porte G12 — propriétaire par source, règles d'anonymisation, responsable du rapprochement de l'historique 2026 (D-10). | GO · GO sous conditions · NO-GO | Nommer un propriétaire par source avant le pilote ; le rapprochement D-10 peut suivre. | G12 | `docs/agent-execution/gate-dossiers/fr/G12-data-owner-fixtures-history.md`<br>`docs/sdp360/2027/02-DECISION-LOG.md` | | | | |
| HD-O07 | Responsable par source pour le tableau de qualité des données (`ui_data_quality_page`). | Nommer · Pas maintenant | Nommer avant la vague 1. | L01 | `docs/ops/pilot/PILOT-PROFILE.md` | | | | |

## Responsable QA (2)

| Id | À trancher | Options | Recommandation IA | Bloque | Source | Décision | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|---|---|
| HD-G19 | Porte G19 — CI verte sur le SHA cible du pilote, tests sautés revus. | GO pour le SHA nommé · GO sous conditions (liste de tests à rejouer) · NO-GO | Rejouer la CI sur le SHA qui sera installé sur TEST et ne signer que ce SHA. | G19 | `docs/agent-execution/gate-dossiers/fr/G19-qa-ci-green.md` | | | | |
| HD-O12 | Exécuter les contrôles statiques à chaque fusion (ADR-P09). | Adopter · Pas maintenant | Adopter. | G19 | `docs/ai-decisions/ADR-P09-static-merge-gate.md` | | | | |

## Responsable des rapports (2)

| Id | À trancher | Options | Recommandation IA | Bloque | Source | Décision | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|---|---|
| HD-G10 | Porte G10 / D-13 — autorité par rapport du catalogue et identifiants des canaux de diffusion. | Nommer · Pas maintenant (aucune diffusion externe) | Aucune diffusion externe pendant le pilote ; décider avant le déploiement général. | G10, K:outbound | `docs/agent-execution/gate-dossiers/fr/G10-report-authority-channels.md` | | | | |
| HD-O09 | Maintien des quatre envois enregistrés comme armés en production (`weekly_report_send_enabled`, `scoreboard_send_enabled`, `hygiene_send_enabled`, `asset_group_send_enabled`). | Maintenir · Désarmer | Enregistrer une décision de maintien ; sur TEST, les laisser éteints. | K:armed_in_production | `docs/ops/SWITCH-LOTS.md` | | | | |

## Responsable plateforme / intégrations (5)

| Id | À trancher | Options | Recommandation IA | Bloque | Source | Décision | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|---|---|
| HD-G13 | Porte G13 — liste des appelants de la clé de tableau de bord (D-15) et décision par connecteur (D-07 Meridian, D-08 4MyPeople, D-09 calendrier M365). | Décision par connecteur · Pas maintenant (connecteurs inchangés) | Recenser les appelants avec `dashkey_scope_mode` en `shadow` deux semaines avant toute restriction. | G13, L06 | `docs/agent-execution/gate-dossiers/fr/G13-connectors-dashkey-clients.md`<br>`docs/sdp360/2027/02-DECISION-LOG.md` | | | | |
| HD-S14 | Ancrage externe de la tête de chaîne d'audit (AUD-2) et pouvoir d'un seul super_admin d'activer n'importe quel interrupteur (AUD-4). | Ancrage externe + double contrôle · Accepter le risque nommément | Accepter nommément pour le pilote (instance de TEST) ; traiter avant G17. | G02, G17 | `docs/agent-execution/P11-readiness-report.md` | | | | |
| HD-O04 | Destinataires des alertes de synchronisation (`sync_alert_recipients`) et seuils de dérive par flux (`sync_drift_drop_pct`, `sync_drift_spike_pct`). | Nommer · Pas maintenant | Nommer avant d'armer `sync_drift_alerts` (sortant). | L13, G10 | `docs/ops/pilot/PILOT-PROFILE.md` | | | | |
| HD-O10 | Retrait de Meridian (D-07, `meridian_enabled` à 0). | Retirer (CAB) · Dormant | Retirer via CAB. | G13 | `docs/sdp360/2027/02-DECISION-LOG.md`<br>`docs/ai-decisions/ADR-A20-meridian-retirement.md` | | | | |
| HD-O13 | Durée maximale d'un interrupteur allumé sans décision (`expiry` de switch-lots.json, null aujourd'hui) et champs de décision des interrupteurs éteints (flag-decisions.json, 0 entrée). | Fixer N jours et remplir les champs · Pas maintenant | N = 60 jours ; remplir les champs des interrupteurs des vagues 1 et 2. | L01, L02, L03, L09, L14, L15 | `docs/ops/switch-lots.json`<br>`docs/ops/FLAG-DECISIONS-GAPS.md` | | | | |

## Responsable réseau (1)

| Id | À trancher | Options | Recommandation IA | Bloque | Source | Décision | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|---|---|
| HD-O14 | Calibration du % Time Up (`wan_timeup_loss_pct`) et fermeture des coupures périmées (`wan_stale_close_at`). | Valeurs proposées (5 / last_seen) · Inchangé | Valeurs proposées du profil pilote. | L11 | `docs/ops/pilot/PILOT-PROFILE.md` | | | | |

## Responsable inspections / GRC (2)

| Id | À trancher | Options | Recommandation IA | Bloque | Source | Décision | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|---|---|
| HD-U17 | Fenêtre des constats répétés (`insp_repeat_window`) et vérification indépendante des actions critiques (`insp_action_verify_enabled`). | Fixer N et activer · Pas maintenant | Fixer N avant L11. | L11 | `docs/ops/pilot/PILOT-PROFILE.md` | | | | |
| HD-U18 | Personne qui adopte les contrôles du registre (`controls_register_enabled`). | Nommer · Pas maintenant | Nommer avant L08. | L08 | `docs/ops/pilot/PILOT-PROFILE.md` | | | | |

## Responsable incidents / problèmes (1)

| Id | À trancher | Options | Recommandation IA | Bloque | Source | Décision | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|---|---|
| HD-U19 | Signataires des revues post-incident et sponsor métier par incident majeur (`pir_reviews_enabled`) ; responsable problèmes (`problem_candidates_enabled`). | Nommer · Pas maintenant | Nommer avant L08. | L08 | `docs/ops/pilot/PILOT-PROFILE.md` | | | | |

## Coordination de site (3)

| Id | À trancher | Options | Recommandation IA | Bloque | Source | Décision | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|---|---|
| HD-O11 | Statuts d'actions d'inspection erronés (UX-F-5) : lancer `node tools/field/inspection-action-status-check.js` sur la base réelle, les propriétaires ferment ou annulent les lignes listées. | Faire · Reporter | Faire avant la vague 1 sur les sites pilotes. | G12 | `docs/agent-execution/P11-readiness-report.md` | | | | |
| HD-U15 | Délais des rappels de planification (`schedule_reminder_lead_days`, `schedule_inspection_interval_days`). | Fixer · Pas maintenant | Fixer avant `schedule_reminders_enabled` (L10). | L10 | `docs/ops/pilot/PILOT-PROFILE.md` | | | | |
| HD-U20 | Tableau de service pour la passation de quart (`shift_handover_enabled`). | Activer au site pilote · Pas maintenant | Activer au site pilote minier en vague 3. | L08 | `docs/ops/pilot/PILOT-PROFILE.md` | | | | |

## DPO (1)

| Id | À trancher | Options | Recommandation IA | Bloque | Source | Décision | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|---|---|
| HD-U08 | D3 — avis de confidentialité et rétention de la télémétrie d'usage (`ux_event_telemetry`). | Accepter · Pas maintenant | Pas maintenant : la mesure `page_viewed` suffit au pilote. | K:external_precondition | `docs/ops/pilot/PILOT-PROFILE.md` | | | | |

## HSE (1)

| Id | À trancher | Options | Recommandation IA | Bloque | Source | Décision | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|---|---|
| HD-U13 | Preuves de qualification HSE par site (`qualification_check_enabled`, `qualification_requirements`). | Enregistrer · Pas maintenant | Hors pilote. | K:external_precondition | `docs/ops/pilot/PILOT-PROFILE.md` | | | | |

## Juridique + commercial (1)

| Id | À trancher | Options | Recommandation IA | Bloque | Source | Décision | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|---|---|
| HD-G16 | Porte G16 — avis juridique et choix de licence (diffusion hors d'Endeavour uniquement). | Avis rendu · Hors périmètre (usage interne seulement) | Hors du chemin critique du pilote interne. | G16 | `docs/agent-execution/gate-dossiers/fr/G16-legal-commercial.md` | | | | |
