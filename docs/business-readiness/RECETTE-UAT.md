# Recette utilisateur (UAT) — scénarios par profil et par lot

> **Préparé par IA — à valider par les responsables nommés.** Version 1 · 2026-11-20. Les scénarios et les
> résultats attendus sont **rédigés par un agent IA** à partir de l'aide intégrée, des fiches de formation
> (`docs/ops/pilot/training/`) et des dossiers de conception ; ils doivent être relus par le responsable du pilote
> avant la première séance. **Aucun scénario n'a été joué par une personne.** Les colonnes « Résultat obtenu »,
> « Nom », « Date » et « Signature » restent vides : seule la personne qui joue le scénario les remplit, sur la copie
> de recette tenue par le responsable du pilote (pas dans ce dépôt).

## Mode d'emploi

- Jouer sur l'**instance de TEST**, avec les comptes de la cohorte (site et rôle vérifiés, prérequis P6 du plan).
- Un scénario se joue avec le jeu d'interrupteurs de sa section : « produit par défaut » = aucun lot activé ;
  une section de lot = ce lot activé (`docs/business-readiness/PLAN-PILOTE.md` §3).
- Résultat obtenu : `OK`, `KO` (décrire), `Bloqué` (prérequis manquant) ou `Non joué`. Ne jamais écrire `OK` pour
  un scénario non joué.
- Un `KO` de sécurité (donnée d'un autre site visible ou modifiable) arrête la recette (plan §6).
- Les identifiants de participants sont codés P01…, sans nom dans les fiches de mesure.

Profils couverts : coordinateur de site (`editor` + `report-author`, un site), technicien terrain (`field-tech`,
un site), PMO (`committee-member`), finance (`finance-viewer`), comité (`committee-member`, `audit-viewer`,
`kpi-committee`), direction (`executive`), administrateur d'exploitation (`admin`), super administrateur (`super_admin`).

## A. Produit par défaut (aucun lot activé)

### A1. Coordinateur de site

| Id | Scénario | Étapes | Résultat attendu | Résultat obtenu | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|
| A1-01 | Connexion et page d'arrivée | Se connecter avec le compte du coordinateur | Arrivée sur le tableau Helpdesk ; menu en français pour l'enveloppe (menu, recherche) | | | | |
| A1-02 | Rapport hebdomadaire | Rapports ▸ Rapports de site ▸ ouvrir la semaine précédente, remplir les 5 onglets, attendre l'enregistrement automatique, soumettre | Chaque onglet se marque terminé ; statut « ready » puis « submitted » ; rien n'est perdu en rechargeant la page | | | | |
| A1-03 | Actions du site | Ouvrir le registre des actions du site, passer une action réunion à « resolved » | Le statut change et reste après rechargement ; l'historique de l'action garde la transition | | | | |
| A1-04 | Statut de transfert justifié | Passer une action réunion à « Ticket Helpdesk » sans commentaire, puis avec commentaire et un numéro de ticket en chiffres | Refus sans justification ; accepté avec commentaire + numéro | | | | |
| A1-05 | Inspection | Inspections ▸ nouvelle inspection, cocher un constat « major », laisser l'action corrective sans responsable ni date, tenter de soumettre | Soumission bloquée tant que responsable et date cible manquent ; acceptée ensuite | | | | |
| A1-06 | PV de réunion | Réunions ▸ nouveau PV de département, cliquer « Tamponner la signature » | Le PV est enregistré au clic ; l'heure de signature est celle du serveur ; un second tampon ne la change pas | | | | |
| A1-07 | Périmètre de site (négatif) | Ouvrir directement l'adresse d'un rapport d'un autre site | Refus (403) ; aucune donnée de l'autre site affichée | | | | |
| A1-08 | Aide | Ouvrir l'aide, section 4 (Rapports de site) en français | L'aide s'ouvre sur la bonne section | | | | |

### A2. Technicien terrain

| Id | Scénario | Étapes | Résultat attendu | Résultat obtenu | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|
| A2-01 | Inspection hors ligne | Sur le téléphone, ouvrir l'application terrain, passer en mode avion, saisir une inspection avec 3 photos | La saisie est enregistrée localement avec un message « non envoyé » | | | | |
| A2-02 | Reprise du réseau | Rétablir le réseau | La file s'envoie une seule fois ; l'inspection apparaît côté serveur, sans doublon | | | | |
| A2-03 | Session expirée | Laisser la session expirer pendant l'envoi d'une photo | Message « Session expirée », l'envoi s'arrête avant l'entrée, rien n'est marqué envoyé | | | | |
| A2-04 | Téléphone partagé | P01 met une saisie en file, P02 se connecte sur le même téléphone | Les entrées de P01 ne sont pas envoyées sous P02 | | | | |
| A2-05 | Action d'un autre site (négatif) | Tenter de clôturer une action d'un autre site depuis l'application | Refus générique, sans nommer le site propriétaire | | | | |
| A2-06 | Réouverture (négatif) | Tenter de rouvrir une action réunion déjà résolue depuis l'application terrain | Refus : seules les fins d'action (résolu, ticket, demande, annulé) sont acceptées | | | | |

### A3. PMO

| Id | Scénario | Étapes | Résultat attendu | Résultat obtenu | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|
| A3-01 | Revoir le portefeuille | Ouvrir le portefeuille | Liste des projets ; une valeur inconnue s'affiche « — », jamais 0 | | | | |
| A3-02 | Conduire le comité | Ouvrir le cockpit, choisir une cadence, préparer l'ordre du jour | L'ordre du jour reprend les chiffres des tableaux de bord ; rien n'est envoyé automatiquement | | | | |
| A3-03 | Rapport mensuel | Ouvrir le studio de rapports, produire le rapport du portefeuille | Le rapport se génère ; un chiffre non certifié est étiqueté comme tel | | | | |

### A4. Finance

| Id | Scénario | Étapes | Résultat attendu | Résultat obtenu | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|
| A4-01 | Finance du parc | Ouvrir Assets ▸ Finance | Valeurs en USD avec le taux affiché ; mention « non certifié » tant que la Finance n'a pas certifié | | | | |
| A4-02 | Montants masqués (négatif) | Avec un compte `viewer`, ouvrir l'inventaire du parc | Inventaire visible **sans** montants ; onglets Finance et Investment absents | | | | |

### A5. Comité (gouvernance, audit, indicateurs)

| Id | Scénario | Étapes | Résultat attendu | Résultat obtenu | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|
| A5-01 | PV signés | Avec `audit-viewer`, ouvrir Réunions | Les PV de son périmètre et leur état de signature ; si aucun site : message « aucun site dans votre périmètre », pas « 0 » trompeur | | | | |
| A5-02 | Politiques | Ouvrir les politiques de gouvernance | Lecture des politiques et de leur historique | | | | |
| A5-03 | Politique d'indicateur à quatre yeux | Avec `kpi-committee`, rédiger une politique dans le constructeur d'indicateurs, puis tenter de l'adopter avec le même compte | Adoption refusée à l'auteur ; acceptée par un second membre | | | | |

### A6. Direction

| Id | Scénario | Étapes | Résultat attendu | Résultat obtenu | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|
| A6-01 | Accueil direction | Ouvrir le tableau de bord exec-home | Indicateurs groupe ; une source jamais synchronisée s'affiche sans couleur verte | | | | |
| A6-02 | Revue IT mensuelle | Ouvrir la revue IT | Page réservée à la direction ; le score indique sa fenêtre de calcul | | | | |

### A7. Administrateur d'exploitation (`admin`)

| Id | Scénario | Étapes | Résultat attendu | Résultat obtenu | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|
| A7-01 | Helpdesk tous sites | Ouvrir le Helpdesk, choisir « Tous les sites » | Chiffres de tous les sites, définitions du SLA identiques à l'aide §9 | | | | |
| A7-02 | Hygiène du parc | Ouvrir Assets ▸ Hygiène, exporter une liste | Export Excel des actifs concernés, sans montant | | | | |
| A7-03 | Réglages réservés (négatif) | Ouvrir les réglages d'administration (SMTP, SSO) | Refus : réservé au super administrateur | | | | |

### A8. Super administrateur

| Id | Scénario | Étapes | Résultat attendu | Résultat obtenu | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|
| A8-01 | Fraîcheur des intégrations | Ouvrir Intégrations puis System Logs ▸ Sync health | Chaque source avec sa dernière synchronisation réussie ; « jamais » plutôt qu'une date inventée | | | | |
| A8-02 | Exercice de restauration | Admin ▸ Restore drill | Date du dernier exercice et PASS/FAIL avec les comptages | | | | |
| A8-03 | Plan d'activation | Sur le serveur : `node tools/ops/activate-switches.js --plan --lots=L01 --db-url=env` | Liste des interrupteurs, valeurs actuelles, classement accès / argent / sortant ; aucune écriture | | | | |
| A8-04 | Application sans motif (négatif) | `node tools/ops/activate-switches.js --apply --lots=L01 --db-url=env --reason="court"` | Refus : motif de moins de 10 caractères ; rien n'est écrit | | | | |

## B. Lots du pilote

### B-L01. Parcours du travail quotidien (vague 1)

| Id | Profil | Scénario | Résultat attendu | Résultat obtenu | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|
| L01-01 | Coordinateur | Se connecter (`ui_role_landing`) | Arrivée sur Accueil « Mon travail » | | | | |
| L01-02 | Coordinateur | Lire la file de travail (`ui_home_queue`, `ui_home_blocks`) | Une seule file avec actions de réunion, d'inspection, suivis et engagements ; chaque bloc dit disponible / inconnu / périmé / refusé ; aucun chiffre inventé | | | | |
| L01-03 | Coordinateur | Créer un engagement à sévérité haute sans responsable (`commitments_enabled`) | Refus de passer en « committed » sans responsable, échéance et plan | | | | |
| L01-04 | Responsable de l'engagement | Tenter de vérifier son propre engagement | Refus : seul le vérificateur désigné (ou le palier admin) vérifie ; jamais le responsable | | | | |
| L01-05 | Vérificateur | Ouvrir « En attente de moi » (`mywork_awaiting_me_enabled`) | L'engagement à vérifier y figure | | | | |
| L01-06 | Admin | Ouvrir la page qualité des données (`ui_data_quality_page`) | Écarts par source ; page refusée à un coordinateur | | | | |
| L01-07 | Tous | Bouton de retour utilisateur (`ui_feedback_enabled`) | Le message part vers la personne nommée (HD-O08) ; le bouton ne se lit pas comme « revenir en arrière » | | | | |
| L01-08 | Coordinateur | Suivre un lien portant `?site=` (`ui_nav_carry_site`, `ui_nav_active_from_url`) | Le menu garde le site ; une seule entrée active ; la page vérifie toujours le droit | | | | |

### B-L02. PMO — lecture du portefeuille (vague 2)

| Id | Profil | Scénario | Résultat attendu | Résultat obtenu | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|
| L02-01 | Éditeur de site | Ouvrir le portefeuille (`portfolio_site_scope_reads`) | Seuls les projets de ses sites | | | | |
| L02-02 | PMO | Basculer liste / tableau, « Mes projets » (`portfolio_views_enabled`, `portfolio_my_projects_default`) | Les vues s'affichent ; « Mes projets » vide le dit clairement | | | | |
| L02-03 | PMO | Nommer l'équipe et les rôles d'un projet (`ppm_project_team_enabled`, `ppm_project_roles_enabled`) | Les membres liés gagnent les capacités de leur rôle de projet, rien de plus | | | | |
| L02-04 | PMO | Matrice RACI d'une tâche sans « A » (`ppm_raci_enabled`) | Refus : exactement un A par tâche | | | | |
| L02-05 | PMO | RAID, RAG du projet, rapport à la demande, vue simplifiée (`ppm_raid_enabled`, `ppm_project_rag_enabled`, `ppm_project_report_enabled`, `ppm_simplified_view_enabled`) | Chaque vue s'ouvre ; les montants suivent la décision HD-S01 | | | | |

### B-L03. Maîtrise des changements (vague 2)

| Id | Profil | Scénario | Résultat attendu | Résultat obtenu | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|
| L03-01 | PMO | Enregistrer une baseline puis re-baseliner (`ppm_baseline_versions`, `ppm_rebaseline_enabled`) | Versions conservées ; une date impossible est refusée | | | | |
| L03-02 | PMO | Demande de changement avec simulation (`ppm_change_requests_enabled`, `ppm_cr_simulation_enabled`) | La simulation est rejouée sur le plan courant à l'évaluation | | | | |
| L03-03 | PMO | Passer un jalon avec une liste de contrôle incomplète (`ppm_gate_checklist_enabled`) | Refus (409) ; rien ne change d'étape automatiquement | | | | |
| L03-04 | Comité | Modèle de projet (`ppm_templates_enabled`) | Brouillon tant qu'un second membre ne l'approuve pas ; seul un modèle approuvé crée un projet | | | | |
| L03-05 | Éditeur de site | Modifier le plan d'un projet de son site (`portfolio_editor_plan_writes`, seulement si HD-S02 l'accepte) | Écriture acceptée sur son site, refusée ailleurs | | | | |

### B-L09. Confiance dans les indicateurs (vague 2)

| Id | Profil | Scénario | Résultat attendu | Résultat obtenu | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|
| L09-01 | Direction | Lire une tuile (`ui_kpi_base_line`, `ui_kpi_definition_drawer`) | Population de base sous la valeur ; le tiroir montre formule, fenêtre, dénominateur et source, sans prétendre certifier | | | | |
| L09-02 | Comité KPI | Petit échantillon (`ui_kpi_sample_size`) | Avertissement seulement si un minimum a été adopté (HD-K06) | | | | |
| L09-03 | Analyste | Explication et petits multiples (`metric_explain_enabled`, `ui_small_multiples`) | Comptes par site, ratios numérateur / dénominateur ; aucune cause affirmée | | | | |
| L09-04 | Analyste | Lien partageable (`ui_url_filters`) et annotation (`chart_annotations_enabled`) | Le lien recharge les mêmes filtres ; une annotation exige une source | | | | |
| L09-05 | Coordinateur francophone | Pages en français (`ui_i18n_pages`) | Les pages quotidiennes passent en français ; les restes en anglais sont notés pour HD-U01 | | | | |
| L09-06 | Direction | Tuile rouge avec lien d'action (`dashboard_red_action_links`) | Le lien ouvre la création d'un engagement ; aucune action n'est créée automatiquement | | | | |

### B-L14. Registre d'intake du portefeuille (vague 2)

| Id | Profil | Scénario | Résultat attendu | Résultat obtenu | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|
| L14-01 | PMO | Créer une demande dans le registre (`ppm_intake_register_enabled`) | Référence générée par le serveur, jamais réutilisée | | | | |
| L14-02 | PMO | Lire le score de qualité (`ppm_data_quality_enabled`) | Score par projet et par site, avertissements en français | | | | |
| L14-03 | PMO | Soumettre une fiche incomplète (`ppm_dq_gate_enforced`) | Refus avec la liste des champs à compléter | | | | |
| L14-04 | Direction | Tableau exécutif et export (`ppm_portfolio_dashboard_v2_enabled`) | Le chiffre d'une carte égale le nombre de lignes du registre filtré ; un lecteur sans droit « argent » n'a pas de montant dans l'export | | | | |

### B-L15. Atterrissage par profil (vague 2, après revue HD-U11)

| Id | Profil | Scénario | Résultat attendu | Résultat obtenu | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|
| L15-01 | Comité, finance, audit | Se connecter (`ui_role_landing_profiles`) | Comité → portefeuille ; finance → finance du parc ; audit → cockpit ; la page garde son contrôle d'accès | | | | |
| L15-02 | Direction sans site | Ouvrir Accueil (`ui_home_group_variant`) | Carte groupe (sites les plus en retard, projets en retard, décisions dues) au lieu de « aucun site » | | | | |
| L15-03 | Admin | Bandeau de fraîcheur (`ui_home_freshness_strip`) | Une ligne par source ; « jamais synchronisé » en ambre | | | | |
| L15-04 | Coordinateur | Ouvrir le Helpdesk (`ui_helpdesk_site_default`) | Ouverture sur son site ; « Tous les sites » à un clic | | | | |

### B-L04. Planification et collaboration (vague 3)

| Id | Profil | Scénario | Résultat attendu | Résultat obtenu | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|
| L04-01 | PMO | Gantt interactif et calendriers (`ppm_gantt_v2_enabled`, `ppm_calendars_enabled`) | Le chemin critique s'affiche ; les jours chômés sont respectés | | | | |
| L04-02 | PMO | Nivellement des ressources (`ppm_resources_enabled`, `ppm_leveling_enabled`) | Résultat proposé, jamais appliqué sans validation ; temps d'attente noté (PPM-F4) | | | | |
| L04-03 | PMO | Charge des équipes (`ppm_capacity_view`) | Conflits triés ; une réaffectation exige un motif | | | | |
| L04-04 | Lecteur du projet | Commentaire (`ppm_comments_enabled`) | Commentaire ajouté, non modifiable ensuite | | | | |

### B-L08. Cadence de gouvernance (vague 3)

| Id | Profil | Scénario | Résultat attendu | Résultat obtenu | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|
| L08-01 | Comité | Clore une décision sans motif (`decision_lifecycle_enforced`, `decision_motive_required`) | Refus sans motif | | | | |
| L08-02 | Secrétaire | Lundi : ordre du jour préparé (`agenda_cron_enabled`) | Brouillon créé, rien n'est envoyé | | | | |
| L08-03 | GRC | Registre des contrôles (`controls_register_enabled`) | Les contrôles restent « candidats » jusqu'à adoption motivée par une personne | | | | |
| L08-04 | Responsable incidents | Revue post-incident (`pir_reviews_enabled`) | Signature par une autre personne que l'auteur | | | | |
| L08-05 | Responsable problèmes | Candidats problèmes (`problem_candidates_enabled`) | Mention « causalité non validée » ; rien sans seuil (HD-K11) | | | | |
| L08-06 | Équipe de quart | Passation (`shift_handover_enabled`, `handoffs_enabled`) | La passation doit être acceptée par l'entrant, jamais automatiquement | | | | |
| L08-07 | Comité | Engagement grave sans échéance (`a01_missing_due_date`) | Escalade A01 comme pour un responsable manquant | | | | |

### B-L10. Rythme de reporting (vague 3)

| Id | Profil | Scénario | Résultat attendu | Résultat obtenu | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|
| L10-01 | Coordinateur | Rapport soumis puis données modifiées (`report_drift_banner`) | Bandeau d'écart sur le rapport | | | | |
| L10-02 | Rédacteur de rapports | Dossier exécutif (`exec_deck_other_bucket`) | « Autres (n) » sur les graphiques top-N | | | | |
| L10-03 | Coordinateur | Rappels (`schedule_reminders_enabled`, `weekly_report_nudges_enabled`, `action_aging_reminders_enabled`) | Rappels dans l'application uniquement, aux délais décidés (HD-U15) | | | | |
| L10-04 | Admin | Santé des connecteurs (`connector_health_page_enabled`) | Une source en échec avant sa première réussite n'est pas affichée à 100 % | | | | |

### B-L11. Preuves des opérations de site (vague 3)

| Id | Profil | Scénario | Résultat attendu | Résultat obtenu | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|
| L11-01 | Coordinateur | Constats répétés (`insp_repeat_findings`) | Liste des points notés mineur / majeur / critique dans au moins 2 des N dernières inspections (N décidé, HD-U17) | | | | |
| L11-02 | Coordinateur | Fermer une action critique (`insp_action_verify_enabled`) | « En attente de vérification » jusqu'à vérification par une autre personne | | | | |
| L11-03 | Technicien terrain | Étape de relecture et temps de saisie (`field_review_step`, `field_task_timing`) | Écran de résumé avant la file ; « Corriger » ne met rien en file ; temps mesuré sans nom | | | | |
| L11-04 | Finance | Montants certifiés du parc (`asset_money_certify_display`) | Certification affichée seulement au-delà des seuils Finance | | | | |
| L11-05 | Finance | Réclamation SLA WAN sans contrat (`wan_sla_require_contract_evidence`, `wan_sla_claims_enabled`) | Refus sans contrat déposé | | | | |

### B-L12. Durcissement des accès (vague 3)

| Id | Profil | Scénario | Résultat attendu | Résultat obtenu | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|
| L12-01 | Tous | Échecs de connexion répétés (`auth_account_throttle_enabled`, `login_limit_failures_only`) | Blocage après le nombre d'échecs fixé ; une connexion réussie remet à zéro ; un site derrière une seule adresse n'est pas bloqué par les réussites | | | | |
| L12-02 | Admin | Attribution d'un rôle (`access_require_approval`) | Demande soumise à approbation ; jamais approuvée par le demandeur ni le bénéficiaire | | | | |
| L12-03 | Super admin | Accès d'urgence (`emergency_access_enabled`, `breakglass_timebox_enabled`) | 24 h maximum, motif obligatoire, revue par un autre super administrateur | | | | |
| L12-04 | Direction | Écriture dans le portefeuille (`portfolio_executive_readonly`) | Refus 403 pour un compte executive seul | | | | |
| L12-05 | Lecteur | Export (`export_policy_strict`, `export_watermark_enabled`) | Exports réservés selon la matrice ; fichiers marqués | | | | |

## C. Lots exclus du pilote (contrôle négatif)

| Id | Scénario | Résultat attendu | Résultat obtenu | Nom | Date | Signature |
|---|---|---|---|---|---|---|
| X-01 | Chercher les feuilles de temps, l'EVM et les périodes budgétaires (L05) | Absents (lot non activé) | | | | |
| X-02 | Chercher le Centre de contrôle des politiques (`policy_center_enabled`) | Absent du menu et refusé | | | | |
| X-03 | Vérifier qu'aucun e-mail ou message Teams n'est parti de l'instance de TEST pendant la semaine | Journal des envois vide pour la période | | | | |

## D. Procès-verbal de recette (copie du responsable du pilote)

| Section | Scénarios joués | OK | KO | Bloqués | Responsable (rôle) | Décision | Nom | Date | Signature |
|---|---|---|---|---|---|---|---|---|---|
| A — produit par défaut | | | | | Responsable du pilote | | | | |
| B — L01 | | | | | Responsable du pilote | | | | |
| B — L02, L03, L09, L14, L15 | | | | | Responsable du pilote + PMO | | | | |
| B — L04, L08, L10, L11, L12 | | | | | Responsable du pilote + Sécurité de l'information | | | | |
| C — lots exclus | | | | | Responsable du pilote | | | | |
| Recette terrain (`docs/ops/pilot/FIELD-DEVICE-UAT.md`) | | | | | Sponsor + IT Groupe (porte G11) | | | | |
