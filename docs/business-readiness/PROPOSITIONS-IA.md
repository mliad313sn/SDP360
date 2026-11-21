# Propositions IA pour les décisions humaines en attente — SDP360

> **PROPOSITIONS IA — non approuvées. Chaque ligne attend la validation du propriétaire lors de son test final.
> Aucune case de décision humaine n'est remplie.**
>
> Document généré par `node tools/release/ai-proposals-check.js --write` à partir de `tools/release/ai-proposals.source.js` — ne pas
> éditer à la main. Le propriétaire a délégué l'analyse à un agent IA ; les règles du dépôt
> (`.claude/rules/SDP360_BOUNDARIES.md`) interdisent malgré tout d'inventer une approbation, une signature, une mise
> en production ou une acceptation terrain. Les cases Décision, Nom, Date et Signature de
> `docs/business-readiness/REGISTRE-DECISIONS-HUMAINES.md` restent **vides**. Les valeurs de configuration proposées ne
> s'appliquent qu'à une base de TEST, par `node tools/release/final-test-profile.js` (simulation par défaut).

Total : **113 propositions** pour 113 décisions en attente.

## Synthèse par décideur

| Décideur (rôle) | Propositions | Réversibles | Avec valeurs de test | Acte humain physique requis |
|---|---|---|---|---|
| Sponsor | 5 | 5 | 0 | 3 |
| Sponsor + IT Groupe | 1 | 1 | 0 | 1 |
| Product owner | 9 | 9 | 5 | 3 |
| Responsable du pilote | 3 | 3 | 2 | 1 |
| Sécurité de l'information | 16 | 16 | 6 | 7 |
| Sécurité de l'information + Finance | 1 | 1 | 0 | 0 |
| Finance | 9 | 9 | 0 | 3 |
| Comité KPI | 15 | 15 | 4 | 1 |
| Comité de gouvernance | 7 | 7 | 5 | 0 |
| PMO | 16 | 16 | 3 | 4 |
| CAB | 2 | 2 | 0 | 2 |
| CAB + SRE | 1 | 1 | 0 | 1 |
| SRE | 3 | 3 | 0 | 1 |
| DBA | 2 | 2 | 0 | 1 |
| SRE + DBA | 1 | 1 | 0 | 1 |
| Propriétaires des données | 2 | 2 | 1 | 2 |
| Responsable QA | 2 | 2 | 0 | 1 |
| Responsable des rapports | 2 | 2 | 1 | 1 |
| Responsable plateforme / intégrations | 5 | 5 | 1 | 2 |
| Responsable réseau | 1 | 1 | 1 | 0 |
| Responsable inspections / GRC | 2 | 2 | 2 | 1 |
| Responsable incidents / problèmes | 1 | 1 | 0 | 1 |
| Coordination de site | 4 | 4 | 2 | 2 |
| DPO | 1 | 1 | 0 | 0 |
| HSE | 1 | 1 | 0 | 0 |
| Juridique + commercial | 1 | 1 | 0 | 1 |
| **Total** | **113** | **113** | **33** | **40** |

## Actes humains ou d'autorité requis quelle que soit la délégation

Ces propositions ne suffisent pas : une personne ou une instance doit encore agir physiquement (réunion, test, clé,
consentement, avis, exercice). L'IA ne peut ni le faire ni le déclarer fait.

| Id | Décideur | Acte requis |
|---|---|---|
| HD-G19 | Responsable QA | Le responsable QA relit la CI du SHA cible et remplit lui-même la ligne G19 de RELEASE-GATES.md. |
| HD-G01 | Sécurité de l'information | La Sécurité de l'information nomme les comptes pilotes, leurs rôles et les super_admins habilités à émettre un jeton opérateur. |
| HD-G03 | CAB | Le CAB doit se réunir, attribuer une référence et fixer la fenêtre d'installation sur TEST. |
| HD-G02 | Sécurité de l'information | La Sécurité de l'information doit faire la rotation d'EX-01 et accepter nommément chaque risque résiduel. |
| HD-G05 | CAB + SRE | Le CAB et le SRE doivent accepter les valeurs RPO/RTO, nommer le responsable des sauvegardes et dater un exercice réel de restauration. |
| HD-G12 | Propriétaires des données | Les propriétaires de données doivent être nommés par leur hiérarchie. |
| HD-G11 | Sponsor + IT Groupe | Le sponsor et l'IT Groupe choisissent les sites et nomment les utilisateurs. |
| HD-G21 | PMO | Le PMO choisit le projet et nomme le chef de projet. |
| HD-G14 | Finance | La Finance doit fournir la source des taux et nommer le rôle certificateur avant toute levée. |
| HD-G04 | Sécurité de l'information | Un détenteur humain de la clé de signature doit être désigné et générer la clé hors du dépôt. |
| HD-G20 | SRE + DBA | Le SRE et le DBA doivent exécuter le tir sur l'environnement cible et fixer les budgets. |
| HD-G18 | Sécurité de l'information | Un test d'intrusion réel doit être réalisé par un testeur qualifié ; aucune délégation à l'IA ne le remplace. |
| HD-G15 | Sponsor | Le sponsor doit relire le rapport de pilote et décider lui-même. |
| HD-G17 | CAB | Le CAB doit se réunir pour toute mise en production, avec un responsable du retour arrière nommé. |
| HD-G16 | Juridique + commercial | Un avis juridique réel reste nécessaire avant toute diffusion externe. |
| HD-S04 | Sécurité de l'information | Un second super_admin réel et indépendant doit être désigné pour examiner et accepter ou refuser les demandes. |
| HD-S07 | Sécurité de l'information | Deux super_admins doivent être nommés et faire un exercice de break-glass réel sur TEST. |
| HD-S10 | Sécurité de l'information | L'administrateur du locataire Entra doit donner (ou refuser) le consentement User.Read.All. |
| HD-S14 | Responsable plateforme / intégrations | Le responsable plateforme doit accepter le risque en son nom ; l'IA ne peut pas l'accepter à sa place. |
| HD-K01 | Comité KPI | Le comité KPI doit se réunir et adopter les définitions. |
| HD-P01 | PMO | Le PMO doit tenir l'atelier de revue. |
| HD-P04 | PMO | Le PMO doit nommer le validateur. |
| HD-P13 | PMO | Une revue humaine du lot L16 est nécessaire avant toute vague. |
| HD-F01 | Finance | La Finance doit fournir les tables de devises et de taux avant toute levée. |
| HD-F07 | Finance | La Finance doit déposer les contrats des fournisseurs d'accès. |
| HD-O01 | DBA | Un DBA doit exécuter le script après sauvegarde, dans une fenêtre CAB. |
| HD-O05 | SRE | Le SRE doit fournir un emplacement sur un autre serveur. |
| HD-O07 | Propriétaires des données | Les propriétaires des données doivent être nommés. |
| HD-O08 | Product owner | Le product owner doit nommer la personne qui répond. |
| HD-O09 | Responsable des rapports | Le responsable des rapports doit enregistrer lui-même la décision de maintien en production. |
| HD-O10 | Responsable plateforme / intégrations | Le retrait en production passe par le CAB. |
| HD-O11 | Coordination de site | Les coordinateurs de site doivent corriger eux-mêmes les statuts signalés sur la base réelle. |
| HD-O15 | Coordination de site | Les coordinateurs des sites pilotes doivent être prévenus par une personne. |
| HD-U01 | Product owner | Un coordinateur francophone doit relire le glossaire. |
| HD-U03 | Responsable du pilote | La cohorte doit confirmer les tâches en séance. |
| HD-U04 | Sponsor | Le sponsor doit nommer la cohorte, le facilitateur et l'observateur. |
| HD-U07 | Sponsor | Le sponsor doit nommer le détenteur de la clé ; l'IA ne détient aucune clé. |
| HD-U12 | Product owner | Des séances sur vrais appareils doivent avoir lieu. |
| HD-U18 | Responsable inspections / GRC | Le responsable inspections / GRC doit nommer l'adoptant. |
| HD-U19 | Responsable incidents / problèmes | Le responsable incidents / problèmes doit nommer les signataires. |

## Sponsor (5)

### HD-G15 — Porte G15 — critères d'acceptation métier et revue du rapport de pilote.

- **Choix proposé :** Accepter sous conditions
- **Justification :** L'acceptation métier doit reposer sur les mesures du pilote (docs/ops/pilot/PILOT-MEASUREMENT.md) ; « sous conditions » permet de lister les écarts mesurés à corriger avant le déploiement général.
- **À vérifier au test final :** Relire le rapport de pilote : chaque critère de PLAN-PILOTE.md section 6 a une mesure et un résultat.
- **Réversible :** oui
- **Risque si accepté :** Des conditions non suivies resteraient ouvertes après l'acceptation.
- **Acte humain encore requis :** Le sponsor doit relire le rapport de pilote et décider lui-même.

### HD-U04 — D-P09-2 / D-P09-3 — cohorte (participants codés P01…), facilitateur, observateur, dates (référence, mise en route, fin).

- **Choix proposé :** Nommer
- **Justification :** Un facilitateur extérieur à la construction des écrans évite le biais de l'auteur (registre, D-P09-2).
- **À vérifier au test final :** Vérifier que la cohorte, le facilitateur, l'observateur et les dates sont renseignés par le sponsor.
- **Réversible :** oui
- **Risque si accepté :** Le facilitateur extérieur doit se familiariser avec l'outil.
- **Acte humain encore requis :** Le sponsor doit nommer la cohorte, le facilitateur et l'observateur.

### HD-U05 — D-P09-6 — fusions et retraits de pages (lot C de la revue d'adoption).

- **Choix proposé :** Après 30 jours d'usage
- **Justification :** Fusionner ou retirer des pages après 30 jours de données d'usage (mesure `page_viewed`) évite de décider sur des impressions (registre).
- **À vérifier au test final :** Relire le rapport d'usage après 30 jours avant toute fusion.
- **Réversible :** oui
- **Risque si accepté :** Des pages peu utiles restent visibles 30 jours de plus.

### HD-U07 — D-P09-8 — détenteur de la clé de pseudonymisation du pilote (`PILOT_PSEUDONYM_KEY`).

- **Choix proposé :** Nommer
- **Justification :** La clé de pseudonymisation doit être détenue par une personne hors de l'équipe de livraison (registre, D-P09-8).
- **À vérifier au test final :** Vérifier que les exports d'usage sont pseudonymisés et que la clé n'est pas dans le dépôt.
- **Réversible :** oui
- **Risque si accepté :** La perte de la clé empêche de relier les mesures aux participants.
- **Acte humain encore requis :** Le sponsor doit nommer le détenteur de la clé ; l'IA ne détient aucune clé.

### HD-U09 — D5 — nouvelle présentation des graphiques exécutifs (`ui_exec_charts_v2`) après revue navigateur.

- **Choix proposé :** Inchangé
- **Justification :** La nouvelle présentation attend une revue navigateur avec le sponsor exécutif en semaine 3 (registre, D5) ; d'ici là, rien ne change.
- **À vérifier au test final :** Vérifier que `ui_exec_charts_v2` reste à 0.
- **Réversible :** oui
- **Risque si accepté :** Les graphiques à double axe restent en place.

## Sponsor + IT Groupe (1)

### HD-G11 — Porte G11 / D-05 — les deux sites pilotes, le site optionnel de préparation hors ligne, les utilisateurs nommés et les critères de succès du GO/NO-GO.

- **Choix proposé :** Deux sites
- **Justification :** Deux sites contrastés (un site minier francophone avec coordinateur et technicien terrain, et un bureau) couvrent les deux parcours sans multiplier les risques (PLAN-PILOTE.md section 6, PILOT-RUNBOOK.md). Un seul site ne testerait ni la langue ni le travail terrain.
- **À vérifier au test final :** Vérifier que les deux sites et les utilisateurs nommés existent dans la base TEST avec le bon rattachement.
- **Réversible :** oui
- **Risque si accepté :** Un site pilote peu disponible fausserait les mesures d'adoption.
- **Acte humain encore requis :** Le sponsor et l'IT Groupe choisissent les sites et nomment les utilisateurs.

## Product owner (9)

### HD-S12 — Direction en lecture seule sur le portefeuille (`portfolio_executive_readonly`).

- **Choix proposé :** Lecture seule
- **Justification :** La direction en lecture seule sur le portefeuille applique le moindre privilège (valeur stricte = 1) et n'a pas d'effet si aucun compte executive n'écrit (registre).
- **À vérifier au test final :** Avec un compte executive, vérifier qu'aucune écriture n'est possible sur le portefeuille.
- **Réversible :** oui
- **Valeurs proposées (base de TEST seulement) :** `portfolio_executive_readonly` = `1`
- **Risque si accepté :** Un dirigeant qui saisissait des données devra passer par le PMO.

### HD-C04 — Retour en brouillon d'un rapport soumis (`report_revert_policy` : « site_editor » ou « second_person », `report_reassign_submitted`).

- **Choix proposé :** Deuxième personne
- **Justification :** Le retour en brouillon par une deuxième personne est la valeur stricte du catalogue des politiques et la proposition du profil pilote (PILOT-PROFILE.md, A-24).
- **À vérifier au test final :** Avec l'auteur d'un rapport soumis, vérifier qu'il ne peut pas le remettre seul en brouillon.
- **Réversible :** oui
- **Valeurs proposées (base de TEST seulement) :** `report_revert_policy` = `second_person`, `report_reassign_submitted` = `0`
- **Risque si accepté :** Un coordinateur seul sur son site devra demander à un collègue.

### HD-O08 — Personne qui répond aux retours utilisateurs (`ui_feedback_enabled`).

- **Choix proposé :** Nommer
- **Justification :** Une personne doit répondre aux retours utilisateurs avant d'ouvrir le bouton de retour (registre, condition L01).
- **À vérifier au test final :** Envoyer un retour depuis TEST et vérifier qu'il arrive à la personne nommée.
- **Réversible :** oui
- **Valeurs proposées (base de TEST seulement) :** `ui_feedback_enabled` = `1`
- **Risque si accepté :** Des retours sans réponse décourageraient les utilisateurs.
- **Acte humain encore requis :** Le product owner doit nommer la personne qui répond.

### HD-U01 — D-2 — glossaire français validé par un coordinateur francophone, langue par défaut (`ui_lang_default`), pages traduites (`ui_i18n_pages`).

- **Choix proposé :** Français par défaut au pilote
- **Justification :** Les sites miniers pilotes sont francophones ; le français par défaut et les pages traduites sont réversibles (PILOT-PROFILE.md A-09), sous réserve de la relecture du glossaire par un coordinateur francophone (D-2).
- **À vérifier au test final :** Se connecter avec un compte d'un site francophone : interface en français, termes du glossaire respectés.
- **Réversible :** oui
- **Valeurs proposées (base de TEST seulement) :** `ui_lang_default` = `fr`, `ui_i18n_pages` = `1`
- **Risque si accepté :** Une traduction non relue pourrait induire en erreur.
- **Acte humain encore requis :** Un coordinateur francophone doit relire le glossaire.

### HD-U02 — Palier de rôle du technicien terrain (viewer + field-tech ou editor) — conditionne F-9/F-10.

- **Choix proposé :** viewer + field-tech
- **Justification :** Le palier viewer + field-tech applique le moindre privilège (registre) ; un rôle editor donnerait des droits d'écriture au-delà du terrain.
- **À vérifier au test final :** Avec un compte technicien terrain, vérifier qu'il saisit sur l'application terrain mais ne modifie pas les rapports du site.
- **Réversible :** oui
- **Risque si accepté :** Un technicien pourrait manquer d'un droit utile, à ajouter au cas par cas.

### HD-U06 — D-P09-7 — destination d'un compte audit-viewer seul ou dashboard-publisher seul (page qu'il ne peut pas ouvrir).

- **Choix proposé :** Changer la destination
- **Justification :** Changer la destination est un changement de présentation seul, sans effet sur les droits (registre).
- **À vérifier au test final :** Se connecter avec un compte audit-viewer seul : la page d'arrivée doit être lisible par ce compte.
- **Réversible :** oui
- **Risque si accepté :** Aucun effet sur les droits.

### HD-U12 — Résolution des entrées terrain bloquées par un admin (`field_outbox_resolve_enabled`) après les séances sur vrais appareils.

- **Choix proposé :** Après les séances
- **Justification :** La résolution par un admin des entrées terrain bloquées attend les séances sur vrais appareils (registre) ; F-32 (faux 409 après file hors ligne) est encore ouvert au tour 9.
- **À vérifier au test final :** Vérifier que `field_outbox_resolve_enabled` reste à 0 avant les séances.
- **Réversible :** oui
- **Risque si accepté :** Une entrée terrain bloquée se règle à la main pendant le pilote.
- **Acte humain encore requis :** Des séances sur vrais appareils doivent avoir lieu.

### HD-U14 — Calendrier local d'un site non UTC (`site_local_calendar`).

- **Choix proposé :** Inchangé
- **Justification :** Tous les sites sont en UTC+0 ; le calendrier local n'a pas d'effet tant qu'aucun site non UTC n'est ajouté (registre).
- **À vérifier au test final :** Vérifier que `site_local_calendar` reste à sa valeur par défaut.
- **Réversible :** oui
- **Risque si accepté :** Aucun.

### HD-U16 — Politique d'alerte : regroupement par règle (`alert_group_by_rule`) et heures de silence (`alert_quiet_hours`).

- **Choix proposé :** Adopter
- **Justification :** Le regroupement par règle réduit le bruit des alertes (une ligne par règle) ; les heures de silence restent non fixées faute de besoin exprimé (registre).
- **À vérifier au test final :** Déclencher une règle sur deux sites de TEST et vérifier une seule ligne regroupée.
- **Réversible :** oui
- **Valeurs proposées (base de TEST seulement) :** `alert_group_by_rule` = `1`
- **Risque si accepté :** Un site pourrait passer inaperçu dans une ligne regroupée.

## Responsable du pilote (3)

### HD-U03 — D-P09-4 — les trois tâches par profil (proposition IA), à confirmer par la cohorte.

- **Choix proposé :** Confirmer
- **Justification :** Les trois tâches par profil sont une proposition IA à confirmer par la cohorte en séance de formation (registre).
- **À vérifier au test final :** Pendant la formation, noter si chaque participant reconnaît ses trois tâches.
- **Réversible :** oui
- **Risque si accepté :** Des tâches mal choisies fausseraient les mesures d'usage.
- **Acte humain encore requis :** La cohorte doit confirmer les tâches en séance.

### HD-U10 — D-6 — profil de menu (`ui_nav_profile`), menu exécutif (`ui_exec_nav`), rôles du constructeur de dossiers (`ui_deck_builder_roles`).

- **Choix proposé :** Valeurs du profil pilote
- **Justification :** Les valeurs du profil pilote (menu allégé, menu exécutif consolidé, constructeur de dossiers ouvert aux auteurs de rapports) sont réversibles et à revoir après les séances T1–T8 (PILOT-PROFILE.md A-21, C-28). Le rôle du constructeur est un interrupteur « quatre yeux ».
- **À vérifier au test final :** Vérifier le menu allégé avec un compte éditeur et l'accès au constructeur avec un compte report-author.
- **Réversible :** oui
- **Valeurs proposées (base de TEST seulement) :** `ui_nav_profile` = `lean`, `ui_exec_nav` = `consolidated`, `ui_deck_builder_roles` = `super_admin,report-author`
- **Risque si accepté :** Des utilisateurs habitués au menu complet pourraient chercher une entrée.

### HD-U11 — L15 (atterrissage par profil) aux sites pilotes : avis panel IA du tour 6 — sécurité et UX GO PILOT, `ui_helpdesk_site_default` et classement des sites CONDITIONAL (F-21, F-26 corrigés dans le code par les correctifs 28 et 25, non revérifiés).

- **Choix proposé :** Activer en vague 2 après revue
- **Justification :** Le panel IA du tour 9 recommande L15 GO PILOT ; la condition est de vérifier les graphies de site du filtre Helpdesk aux sites pilotes (registre).
- **À vérifier au test final :** Se connecter avec chaque profil pilote et vérifier sa page d'arrivée et le filtre Helpdesk sur son site.
- **Réversible :** oui
- **Valeurs proposées (base de TEST seulement) :** `ui_role_landing` = `1`, `ui_role_landing_profiles` = `1`, `ui_home_group_variant` = `1`, `ui_home_freshness_strip` = `1`, `ui_helpdesk_site_default` = `1`
- **Risque si accepté :** Une graphie de site non reconnue afficherait un Helpdesk vide.

## Sécurité de l'information (16)

### HD-G01 — Porte G01 — politique d'accès (périmètre de site CG-01/CG-02), liste des comptes pilotes et de leurs rôles, accès par département D-14 avant ou après le pilote ; qui peut réinitialiser les identifiants d'un super_admin, et quels super_admins peuvent émettre un jeton opérateur pour `activate-switches` (P11 tour 6, R6-A1).

- **Choix proposé :** GO avec le modèle par site
- **Justification :** Le périmètre par site (éditeur verrouillé à ses sites, palier admin sans restriction) est appliqué côté serveur et couvert par les tests d'autorisation (docs/ops/AUTHZ-MATRIX.md, dossier G01). D-14 (accès par département) ajoute de la complexité sans besoin démontré pour deux sites pilotes. La lecture des portefeuilles par site est resserrée par la valeur proposée, qui est une restriction.
- **À vérifier au test final :** Se connecter avec un compte éditeur d'un site pilote : aucune donnée d'un autre site lisible ni modifiable ; lister les super_admins habilités au jeton opérateur.
- **Réversible :** oui
- **Valeurs proposées (base de TEST seulement) :** `portfolio_site_scope_reads` = `1`
- **Risque si accepté :** Un compte pilote mal rattaché à son site verrait trop ou trop peu.
- **Acte humain encore requis :** La Sécurité de l'information nomme les comptes pilotes, leurs rôles et les super_admins habilités à émettre un jeton opérateur.

### HD-G02 — Porte G02 — rotation datée du secret EX-01, acceptation nominative de chaque risque résiduel, liste des pages en CSP stricte après une période en mode rapport.

- **Choix proposé :** GO sous conditions
- **Justification :** Le panel IA rapporte P0 = 0 et P1 = 0 sur tous les sièges pour le quatrième tour consécutif (rapport P11, Round 9), mais des P3 restent ouverts (N-R9-1, R9-A1, O-14, O-16). La rotation du secret EX-01 et l'acceptation nominative des risques résiduels restent des préalables à tout compte pilote.
- **À vérifier au test final :** Contrôler qu'une rotation datée d'EX-01 existe et que chaque risque résiduel du registre P11 porte le nom d'une personne qui l'accepte.
- **Réversible :** oui
- **Risque si accepté :** Un risque résiduel accepté sans propriétaire nommé resterait orphelin.
- **Acte humain encore requis :** La Sécurité de l'information doit faire la rotation d'EX-01 et accepter nommément chaque risque résiduel.

### HD-G04 — Porte G04 / D-12 — détenteur de la clé de signature (jamais la clé) et SHA des actions CI vérifiés.

- **Choix proposé :** NO-GO
- **Justification :** La clé publique livrée est une clé de démonstration (dossier G04) ; signer une release avec elle donnerait une fausse garantie. Le NO-GO tient jusqu'au remplacement par la clé du détenteur désigné.
- **À vérifier au test final :** Vérifier que la clé publique du dépôt n'est plus la clé de démonstration avant toute release munie d'une signature.
- **Réversible :** oui
- **Risque si accepté :** Aucune release munie d'une signature tant que la clé n'est pas remplacée.
- **Acte humain encore requis :** Un détenteur humain de la clé de signature doit être désigné et générer la clé hors du dépôt.

### HD-G18 — Porte G18 — test d'intrusion : testeurs, dates, environnement, comptes de TEST.

- **Choix proposé :** Test d'intrusion externe
- **Justification :** Une analyse par un panel IA n'est pas un test d'intrusion (rapport P11 : « AI panel, not an independent human review »). Un test externe sur TEST après le pilote et avant G17 est le minimum.
- **À vérifier au test final :** Vérifier qu'un rapport de test d'intrusion daté, produit par un testeur qualifié, existe pour le SHA candidat.
- **Réversible :** oui
- **Risque si accepté :** Coût et délai du test externe.
- **Acte humain encore requis :** Un test d'intrusion réel doit être réalisé par un testeur qualifié ; aucune délégation à l'IA ne le remplace.

### HD-S02 — Élargissement d'accès `portfolio_editor_plan_writes` (les éditeurs de site écrivent les plans de leurs projets), contenu dans L03.

- **Choix proposé :** Sortir l'interrupteur de L03 (révision du plan de lots)
- **Justification :** `portfolio_editor_plan_writes` élargit l'écriture (activate-switches.js, ACCESS « widens ») et c'est un interrupteur « quatre yeux ». Le sortir de L03 permet d'activer les baselines et demandes de changement sans élargir les droits.
- **À vérifier au test final :** Vérifier sur TEST qu'un éditeur de site ne peut pas écrire le plan d'un projet.
- **Réversible :** oui
- **Risque si accepté :** Les chefs de projet de site passent par un compte PMO pour modifier les plans.

### HD-S03 — Périmètre de lecture du compte audit-viewer (voit 0 réunion aujourd'hui, item 9 de la revue d'adoption).

- **Choix proposé :** Liste de sites nommés
- **Justification :** Une liste de sites nommés pour l'auditeur du pilote corrige l'item 9 de la revue d'adoption (0 réunion visible) sans ouvrir toute la flotte (moindre privilège).
- **À vérifier au test final :** Avec le compte audit-viewer, vérifier que les réunions des sites pilotes sont lisibles et pas celles des autres sites.
- **Réversible :** oui
- **Risque si accepté :** Un site oublié dans la liste resterait invisible pour l'auditeur.

### HD-S04 — Centre de contrôle des politiques (`policy_center_enabled`) : peut-on s'appuyer sur son double contrôle ? Tour 7 du panel IA (revue IA, pas une revue humaine indépendante) : N-R6-1 corrigé par le correctif 26 (fusionné) ; N-R7-1 (une valeur numérique « plus stricte » hors de la plage acceptée par son lecteur, appliquée par une seule personne) traité par le correctif 31 — à revérifier. Limite connue : un outil en ligne de commande qui détient l'URL de la base (ex. `tools/governance/apply-values.js`) écrit hors de ce contrôle. Depuis le correctif 29 (R6-A1), c'est le SEUL chemin par lequel un interrupteur « quatre yeux » des lots L03, L08, L11, L12, L14 peut être activé (demande déposée avec un jeton opérateur, approuvée par un second super_admin).

- **Choix proposé :** Activer après revérification des correctifs 26, 29 et 31
- **Justification :** Le panel IA a revérifié N-R6-1 au tour 7 (R7-A3) et le siège sécurité du tour 9 recommande L13, dont `policy_center_enabled`, « GO PILOT on TEST ». Activer le Centre est un durcissement (valeur stricte = 1) et c'est le seul chemin autorisé pour les interrupteurs « quatre yeux ». Limite connue : N-R9-1 (un détenteur de l'accès base peut forger un jeton).
- **À vérifier au test final :** Sur TEST, demander un changement « quatre yeux » avec un super_admin et vérifier qu'il reste en attente jusqu'à l'approbation d'un second super_admin distinct.
- **Réversible :** oui
- **Valeurs proposées (base de TEST seulement) :** `policy_center_enabled` = `1`
- **Risque si accepté :** Un détenteur de l'accès base de données pourrait contourner le double contrôle (N-R9-1).
- **Acte humain encore requis :** Un second super_admin réel et indépendant doit être désigné pour examiner et accepter ou refuser les demandes.

### HD-S05 — Clé de tableau de bord injectée dans les pages (SEC-F3) : passer `ui_inject_dash_key` à 0 et `dashkey_scope_mode` de `open` à `shadow` puis `restrict`.

- **Choix proposé :** Shadow pendant le pilote
- **Justification :** Le mode ombre recense les appelants de la clé sans rien bloquer (SEC-F3, dossier G13). Retirer l'injection de la clé dans les pages supprime une exposition ; c'est un durcissement immédiat (valeur stricte 0) à valider par un passage navigateur sur TEST.
- **À vérifier au test final :** Après application, parcourir les pages principales sur TEST : aucune page cassée ; le journal du mode ombre liste les appelants.
- **Réversible :** oui
- **Valeurs proposées (base de TEST seulement) :** `dashkey_scope_mode` = `shadow`, `ui_inject_dash_key` = `0`
- **Risque si accepté :** Une page qui dépendait encore de la clé injectée pourrait ne plus charger ses données.

### HD-S06 — Mode d'application des capacités : `authz_capability_mode` (`off` → `shadow` → `enforce`) et liste `authz_enforce_caps`.

- **Choix proposé :** Shadow deux semaines
- **Justification :** Le mode ombre journalise les divergences sans rien refuser (docs/agent-execution/C-17.md) ; enforce n'est envisagé qu'après deux semaines sans divergence inexpliquée.
- **À vérifier au test final :** Lancer le rapport de divergences des capacités après deux semaines sur TEST et relire chaque divergence.
- **Réversible :** oui
- **Valeurs proposées (base de TEST seulement) :** `authz_capability_mode` = `shadow`
- **Risque si accepté :** Un volume important de divergences pourrait masquer une vraie anomalie.

### HD-S07 — Approbation des droits et accès d'urgence : matrice d'approbateurs (`access_require_approval`), super_admins habilités pour `emergency_access_enabled`, `breakglass_timebox_enabled`, exercice de break-glass.

- **Choix proposé :** Pas maintenant
- **Justification :** L12 reste CONDITIONAL au tour 9 (exercice de break-glass et porte InfoSec manquants). Sans deux super_admins nommés et un exercice réel, activer l'accès d'urgence élargirait les droits sans contrôle éprouvé.
- **À vérifier au test final :** Vérifier que `emergency_access_enabled` et `access_require_approval` restent à 0 sur TEST tant que l'exercice n'est pas fait.
- **Réversible :** oui
- **Risque si accepté :** Le parcours d'approbation des droits n'est pas testé au pilote.
- **Acte humain encore requis :** Deux super_admins doivent être nommés et faire un exercice de break-glass réel sur TEST.

### HD-S08 — Limitation des connexions : `login_limit_failures_only` et `auth_account_throttle_enabled` (verrouillage volontaire possible d'un compte nommé).

- **Choix proposé :** Activer
- **Justification :** `login_limit_failures_only` corrige le verrouillage d'un site entier vu derrière une seule adresse (registre, HD-S08) sans affaiblir la limitation des échecs.
- **À vérifier au test final :** Sur TEST, faire plusieurs connexions réussies depuis la même adresse sans blocage, puis des échecs répétés : blocage attendu.
- **Réversible :** oui
- **Valeurs proposées (base de TEST seulement) :** `login_limit_failures_only` = `1`
- **Risque si accepté :** Une attaque qui alterne succès et échecs serait comptée différemment.

### HD-S09 — Coût de hachage des mots de passe (`auth_pbkdf2_iterations`, 100000 aujourd'hui).

- **Choix proposé :** Garder 100000
- **Justification :** La valeur actuelle (100000 itérations, minimum que le lecteur admet) reste en place ; le registre précise que la cible n'est pas une décision d'IA et relève d'une revue cryptographique.
- **À vérifier au test final :** Vérifier que `auth_pbkdf2_iterations` vaut toujours 100000.
- **Réversible :** oui
- **Risque si accepté :** Le coût de hachage reste à son niveau actuel jusqu'à la revue.

### HD-S10 — Désactivation des départs Entra : consentement Graph `User.Read.All` (administrateur du locataire), puis `entra_deprovision_enabled` en essai et `entra_deprovision_apply`.

- **Choix proposé :** Pas maintenant
- **Justification :** La désactivation des départs exige le consentement Graph du locataire et un essai relu ; elle est classée irréversible ou destructrice (K:irreversible_or_destructive).
- **À vérifier au test final :** Vérifier que `entra_deprovision_enabled` reste à 0.
- **Réversible :** oui
- **Risque si accepté :** Les départs restent désactivés à la main pendant le pilote.
- **Acte humain encore requis :** L'administrateur du locataire Entra doit donner (ou refuser) le consentement User.Read.All.

### HD-S11 — Matrice de sensibilité des exports (`export_policy_strict`, `export_watermark_enabled`, ADR-P9).

- **Choix proposé :** Adopter la matrice proposée
- **Justification :** Les exports stricts et le filigrane sont des durcissements (valeur stricte = 1, ADR-P9) et réversibles ; le registre recommande de les adopter avec L12 en annonçant aux lecteurs les exports perdus.
- **À vérifier au test final :** Avec un compte lecteur, vérifier qu'un export sensible est refusé et qu'un export autorisé porte un filigrane.
- **Réversible :** oui
- **Valeurs proposées (base de TEST seulement) :** `export_policy_strict` = `1`, `export_watermark_enabled` = `1`
- **Risque si accepté :** Des lecteurs perdent des exports qu'ils utilisaient.

### HD-S13 — Partage public des feuilles de route et projets sensibles (`roadmap_audience_publication_enabled`, `portfolio_sensitive_projects`).

- **Choix proposé :** Pas maintenant
- **Justification :** Le test de partage avec montants semés n'a pas été exécuté (siège sécurité du tour 9, L07 CONDITIONAL) ; le partage public reste éteint.
- **À vérifier au test final :** Vérifier que `roadmap_audience_publication_enabled` reste à 0.
- **Réversible :** oui
- **Risque si accepté :** Pas de lien public de feuille de route pendant le pilote.

### HD-S15 — Activation du fournisseur d'IA (`AI_PROVIDER`) — aucune donnée de production vers un modèle sans accord du propriétaire.

- **Choix proposé :** Rester éteint
- **Justification :** Aucune donnée de production ne doit aller vers un modèle d'IA sans accord du propriétaire (règle du dépôt) ; le pilote n'a pas besoin du fournisseur d'IA.
- **À vérifier au test final :** Vérifier que la variable AI_PROVIDER vaut off sur TEST.
- **Réversible :** oui
- **Risque si accepté :** Les commentaires automatiques restent indisponibles.

## Sécurité de l'information + Finance (1)

### HD-S01 — SEC-F2 / R1-F2 — les membres du comité lisent les montants du portefeuille (6 routes).

- **Choix proposé :** Totaux seulement pour le comité
- **Justification :** Le siège sécurité du tour 9 laisse L02 CONDITIONAL sur R1-F2 (montants lus par le comité). Les totaux seulement pour le comité, et les montants détaillés pour admin + lecteur finance, appliquent le moindre privilège sans bloquer la lecture du portefeuille.
- **À vérifier au test final :** Avec un compte membre du comité, vérifier que seuls les totaux apparaissent ; avec un lecteur finance, que le détail est visible.
- **Réversible :** oui
- **Risque si accepté :** Le comité pourrait demander le détail en séance.

## Finance (9)

### HD-G14 — Porte G14 — source des taux de change, rôle certificateur des montants, certification des budgets et bénéfices.

- **Choix proposé :** NO-GO (L05 reste hors pilote)
- **Justification :** Le panel IA (tour 9, siège données) maintient L05 en NO-GO pour le pilote tant que la porte Finance est vide. Aucun montant ne doit être présenté comme certifié sans la Finance.
- **À vérifier au test final :** Vérifier que tous les interrupteurs de L05 sont à 0 sur TEST.
- **Réversible :** oui
- **Risque si accepté :** Les parcours temps/argent/bénéfices ne seront pas testés au pilote.
- **Acte humain encore requis :** La Finance doit fournir la source des taux et nommer le rôle certificateur avant toute levée.

### HD-F01 — Règles de devise : devise par site (`asset_site_currency`), taux (`asset_currency_rates`), devise obligatoire (`finance_currency_required`), lecture des montants (`asset_amount_parser`).

- **Choix proposé :** Inchangé (XOF par défaut)
- **Justification :** Sans les tables de la Finance, aucun montant ne doit être présenté au comité (registre) ; L05 est exclu du pilote. Garder la valeur par défaut n'invente aucun taux.
- **À vérifier au test final :** Vérifier qu'aucun montant converti n'est présenté comme certifié sur TEST.
- **Réversible :** oui
- **Risque si accepté :** Les montants multi-devises restent non comparables.
- **Acte humain encore requis :** La Finance doit fournir les tables de devises et de taux avant toute levée.

### HD-F02 — Seuils de certification des montants du parc (`asset_money_certify_min_sites`, `asset_money_certify_min_pct`) avant `asset_money_certify_display`.

- **Choix proposé :** 3 sites / 50 %
- **Justification :** Garder les seuils 3 sites / 50 % pendant le pilote (registre, PILOT-PROFILE.md A-16) ; l'affichage certifié reste éteint tant que la Finance n'a pas décidé.
- **À vérifier au test final :** Vérifier que `asset_money_certify_display` reste à 0.
- **Réversible :** oui
- **Risque si accepté :** Aucun.

### HD-F03 — Grille des périodes budgétaires et certification EVM (`ppm_budget_periods_enabled`, `ppm_evm_enabled`, `finance_certification_enabled`).

- **Choix proposé :** Pas maintenant
- **Justification :** Pas au pilote (registre) : les périodes budgétaires et l'EVM sont des interrupteurs « argent » de L05.
- **À vérifier au test final :** Vérifier que `ppm_evm_enabled` et `ppm_budget_periods_enabled` restent à 0.
- **Réversible :** oui
- **Risque si accepté :** Aucun au pilote.

### HD-F04 — R4-1 (montants réels perdus à la suppression) : corrigé par le correctif 15, pas encore revérifié par un panel.

- **Choix proposé :** Faire revérifier
- **Justification :** R4-1 est corrigé par le correctif 15 mais pas revérifié par un panel (registre) ; une revérification est nécessaire avant L05.
- **À vérifier au test final :** Relire la revérification de R4-1 avant toute activation de L05.
- **Réversible :** oui
- **Risque si accepté :** L05 reste bloqué tant que la revérification n'est pas faite.

### HD-F05 — Rôle vérificateur des bénéfices monétaires (`benefit_money_verifier_role`) et classes de valeur (`benefit_value_class_enabled`).

- **Choix proposé :** Pas maintenant
- **Justification :** Avec L05 seulement (registre), exclu du pilote.
- **À vérifier au test final :** Vérifier que `benefit_value_class_enabled` reste à 0.
- **Réversible :** oui
- **Risque si accepté :** Aucun au pilote.

### HD-F06 — Import des réalisés (`actuals_import_enabled`).

- **Choix proposé :** Pas maintenant
- **Justification :** Pas au pilote (registre) ; l'import des réalisés est un interrupteur « argent » de L05.
- **À vérifier au test final :** Vérifier que `actuals_import_enabled` reste à 0.
- **Réversible :** oui
- **Risque si accepté :** Aucun au pilote.

### HD-F07 — Preuve contractuelle exigée pour les réclamations SLA WAN (`wan_sla_require_contract_evidence`, puis `wan_sla_claims_enabled`).

- **Choix proposé :** Exiger après dépôt des contrats
- **Justification :** Exiger la preuve contractuelle est un durcissement, mais il n'a de sens qu'une fois les contrats déposés (registre) ; rien n'est activé tant qu'ils ne le sont pas.
- **À vérifier au test final :** Vérifier que les réclamations SLA WAN restent désactivées tant qu'aucun contrat n'est déposé.
- **Réversible :** oui
- **Risque si accepté :** Aucune réclamation SLA WAN pendant le pilote.
- **Acte humain encore requis :** La Finance doit déposer les contrats des fournisseurs d'accès.

### HD-F08 — Dossier annuel : enveloppes et arbitrages (`ppm_annual_pack_enabled`).

- **Choix proposé :** Pas maintenant
- **Justification :** Hors pilote (registre) ; le dossier annuel est un interrupteur « argent » de L05.
- **À vérifier au test final :** Vérifier que `ppm_annual_pack_enabled` reste à 0.
- **Réversible :** oui
- **Risque si accepté :** Aucun au pilote.

## Comité KPI (15)

### HD-G06 — Porte G06 — définition et seuil approuvés par indicateur, choix du score de site de référence (D-03).

- **Choix proposé :** Pas maintenant (aucun chiffre officiel)
- **Justification :** Le pilote peut tourner sans G06 : chaque chiffre reste marqué « non certifié » (registre, HD-G06). Adopter des seuils avant un mois de lecture du pilote figerait des valeurs non éprouvées.
- **À vérifier au test final :** Vérifier que les indicateurs affichés sur TEST portent la mention « non certifié ».
- **Réversible :** oui
- **Risque si accepté :** Les utilisateurs pourraient lire les chiffres comme officiels malgré la mention.

### HD-K01 — D-01 — dictionnaire des indicateurs : définitions, numérateurs/dénominateurs, règles N/A et fraîcheur des cinq dimensions (poids proposés 20/20/25/20/15).

- **Choix proposé :** Adopter
- **Justification :** Les définitions (numérateurs, dénominateurs, règles N/A, fraîcheur) sont la base de tout seuil ; le registre recommande de les adopter avant les poids. Le siège données du tour 9 rapporte une parité KPI 158/158.
- **À vérifier au test final :** Ouvrir le dictionnaire des indicateurs sur TEST et vérifier qu'un indicateur de chaque dimension a sa définition complète.
- **Réversible :** oui
- **Risque si accepté :** Une définition adoptée trop tôt devra être révisée après le pilote.
- **Acte humain encore requis :** Le comité KPI doit se réunir et adopter les définitions.

### HD-K02 — D-02 — seuils RAG et signaux anti-manipulation (proposé ≥ 80 / 60–79 / < 60).

- **Choix proposé :** Pas maintenant
- **Justification :** Le registre recommande d'adopter les seuils après un mois de lecture du pilote ; en attendant, les seuils proposés (≥ 80 / 60–79 / < 60) restent des propositions.
- **À vérifier au test final :** Vérifier que les seuils affichés sont marqués « proposés ».
- **Réversible :** oui
- **Risque si accepté :** Les couleurs affichées pendant le pilote ne sont pas officielles.

### HD-K03 — D-03 — score de site de référence (`site_score_published_model` : `legacy` ou `programme`) et seuil vert du tracker.

- **Choix proposé :** legacy
- **Justification :** Garder le score `legacy` pendant le pilote évite de changer le chiffre de référence en cours de route ; les deux modèles sont comparés (registre, HD-K03).
- **À vérifier au test final :** Vérifier que `site_score_published_model` vaut legacy et que la comparaison des deux modèles est disponible.
- **Réversible :** oui
- **Risque si accepté :** Le score programme, peut-être plus pertinent, n'est pas publié au pilote.

### HD-K04 — Définition du SLA helpdesk et du chiffre de tête (`helpdesk_sla_definition`, `sla_headline_definition`) et alignement des écrans (Houndé 60 % vs 50 %, item 19).

- **Choix proposé :** flag / closed_only (aujourd'hui)
- **Justification :** Garder les définitions actuelles et afficher la définition sous chaque chiffre (L09) rend visibles les écarts Houndé 60 % / 50 % sans changer les calculs.
- **À vérifier au test final :** Vérifier que le chiffre SLA de tête affiche sa définition sous la valeur.
- **Réversible :** oui
- **Risque si accepté :** Deux écrans peuvent continuer à afficher des chiffres différents, désormais expliqués.

### HD-K05 — Politique des zéros du dossier exécutif (`exec_payload_zero_policy`) et formule des changements de la vue publique (`exec_view_change_formula`).

- **Choix proposé :** Valeurs actuelles
- **Justification :** Garder `keep_server` et la formule actuelle pendant le pilote évite de modifier des chiffres déjà lus par la direction (registre, HD-K05).
- **À vérifier au test final :** Vérifier que `exec_payload_zero_policy` vaut keep_server.
- **Réversible :** oui
- **Risque si accepté :** Une meilleure formule éventuelle n'est pas testée au pilote.

### HD-K06 — Taille minimale d'échantillon affichée par `ui_kpi_sample_size` (sans elle, aucun avertissement).

- **Choix proposé :** Fixer un minimum
- **Justification :** Sans taille minimale, aucun avertissement d'échantillon n'apparaît (registre). Afficher la base sous chaque indicateur et l'avertissement d'échantillon est en lecture seule (PILOT-PROFILE.md) ; le minimum lui-même reste à fixer par le comité.
- **À vérifier au test final :** Sur un site avec peu de tickets, vérifier que l'indicateur affiche sa base et un avertissement.
- **Réversible :** oui
- **Valeurs proposées (base de TEST seulement) :** `ui_kpi_sample_size` = `1`, `ui_kpi_base_line` = `1`
- **Risque si accepté :** Des avertissements nombreux sur les petits sites pourraient inquiéter.

### HD-K07 — Règle des mois partiellement saisis du tracker (item 2 de la revue d'adoption).

- **Choix proposé :** Non saisi tant que le mois n'est pas complet
- **Justification :** Afficher « non saisi » plutôt qu'un proportionnel respecte la règle « un nombre sans source est inconnu, jamais 0 ni vert » (règles du dépôt, item 2 de la revue d'adoption).
- **À vérifier au test final :** Sur le tracker TEST, un mois partiellement saisi doit apparaître comme non saisi.
- **Réversible :** oui
- **Risque si accepté :** Les tableaux du mois en cours paraîtront vides plus longtemps.

### HD-K08 — Les deux indicateurs de décision du tableau de bord (`dashboard_decision_kpis_seed`).

- **Choix proposé :** Pas maintenant
- **Justification :** Le registre recommande de choisir les deux indicateurs de décision après le pilote ; le choix est une politique de comité (K:committee_policy).
- **À vérifier au test final :** Vérifier que `dashboard_decision_kpis_seed` reste à 0.
- **Réversible :** oui
- **Risque si accepté :** Le tableau de décision reste sans indicateurs choisis.

### HD-K09 — Adoption d'une politique de SLA de résolution dans le constructeur (`kpi_policy_enforced`, auteur ≠ adoptant).

- **Choix proposé :** Pas maintenant
- **Justification :** Lire la comparaison en ombre pendant le pilote avant d'adopter une politique de SLA de résolution (règle auteur ≠ adoptant).
- **À vérifier au test final :** Vérifier que la comparaison en ombre est lisible et que `kpi_policy_enforced` reste à 0.
- **Réversible :** oui
- **Risque si accepté :** La politique reste non appliquée pendant le pilote.

### HD-K10 — Lecteurs du score programme sur tableaux de bord et API (`metric_programme_readers`).

- **Choix proposé :** Pas maintenant
- **Justification :** Le score programme n'est pas certifié (D-01 à D-03, PILOT-PROFILE.md) ; l'exposer sur API et tableaux de bord le ferait lire comme officiel.
- **À vérifier au test final :** Vérifier que `metric_programme_readers` reste à 0.
- **Réversible :** oui
- **Risque si accepté :** Le score programme reste invisible hors de la comparaison.

### HD-K11 — Seuil de récurrence des candidats problèmes (`problem_candidate_min`).

- **Choix proposé :** Fixer un seuil
- **Justification :** Sans seuil, aucun candidat problème n'est calculé (services/problemCandidates.js). Proposition à tester en ombre : 3 récurrences par site × catégorie × sous-catégorie, à confirmer avec le responsable problèmes.
- **À vérifier au test final :** Activer les candidats sur TEST et vérifier que la liste est lisible et que chaque candidat a au moins 3 incidents.
- **Réversible :** oui
- **Valeurs proposées (base de TEST seulement) :** `problem_candidate_min` = `3`
- **Risque si accepté :** Un seuil trop bas produirait des candidats sans intérêt.

### HD-K12 — Sens proposés de priorité / effort / risque du registre d'intake (L14).

- **Choix proposé :** Adopter
- **Justification :** Les sens de priorité / effort / risque doivent être adoptés avant d'utiliser les scores en comité (registre) ; le registre d'intake est un parcours de lecture et saisie sans montant.
- **À vérifier au test final :** Créer une demande dans le registre d'intake TEST et vérifier le score calculé.
- **Réversible :** oui
- **Valeurs proposées (base de TEST seulement) :** `ppm_intake_register_enabled` = `1`
- **Risque si accepté :** Des scores mal compris pourraient orienter des arbitrages.

### HD-K13 — Codes de site depuis le registre (`site_codes_from_registry` : shadow puis 1).

- **Choix proposé :** Shadow deux semaines
- **Justification :** En mode ombre, les tables en dur répondent toujours et les divergences avec le registre des sites sont journalisées (reportConfig, DEC-4) : aucun effet sur les chiffres.
- **À vérifier au test final :** Après deux semaines, relire les divergences de codes de site journalisées.
- **Réversible :** oui
- **Valeurs proposées (base de TEST seulement) :** `site_codes_from_registry` = `shadow`
- **Risque si accepté :** Les divergences journalisées doivent être relues par quelqu'un.

### HD-K14 — Décision de maintien pour les changements de chiffres livrés actifs (lot d'adoption A, sans interrupteur).

- **Choix proposé :** Maintenir
- **Justification :** Afficher « — » au lieu de 0 pour une valeur inconnue applique la règle « inconnu n'est jamais 0 ni vert » ; revenir en arrière réintroduirait de faux zéros.
- **À vérifier au test final :** Vérifier qu'un indicateur sans source affiche « — » et non 0.
- **Réversible :** oui
- **Risque si accepté :** Certains écrans paraîtront plus vides.

## Comité de gouvernance (7)

### HD-G07 — Porte G07 / D-04 — politique de clôture : rôles vérificateurs par site, destinataires des escalades A01/A02, fenêtre de service avant escalade.

- **Choix proposé :** Adopter sous conditions
- **Justification :** Le panel IA (tour 9, siège audit) recommande L01 « GO PILOT conditionnel à G07 » : le registre des engagements ouvre une surface d'écriture et a besoin de rôles vérificateurs. La proposition active le registre sur TEST seulement, la fenêtre d'escalade restant à fixer par le comité.
- **À vérifier au test final :** Créer un engagement sur TEST, le clôturer avec un autre compte et vérifier que l'auteur ne peut pas vérifier sa propre clôture.
- **Réversible :** oui
- **Valeurs proposées (base de TEST seulement) :** `commitments_enabled` = `1`
- **Risque si accepté :** Des escalades A01/A02 sans destinataires nommés resteraient sans suite.

### HD-G08 — Porte G08 — passations : destinataires des notifications, correspondance utilisateur ↔ département si voulue.

- **Choix proposé :** Activer sans notification
- **Justification :** Les passations fonctionnent sans envoi sortant ; `handoff_notify_enabled` reste éteint conformément à la règle « aucun envoi sortant au pilote » (PLAN-PILOTE.md, K:outbound).
- **À vérifier au test final :** Créer une passation sur TEST et vérifier qu'elle apparaît au destinataire sans aucun e-mail envoyé.
- **Réversible :** oui
- **Valeurs proposées (base de TEST seulement) :** `handoffs_enabled` = `1`
- **Risque si accepté :** Un destinataire qui ne consulte pas l'application ne verrait pas la passation.

### HD-G09 — Porte G09 — relecteur par public des tableaux de bord et trackers publiés.

- **Choix proposé :** Publication par l'admin seulement pendant le pilote
- **Justification :** Limiter la publication à l'admin pendant le pilote est le choix le moins permissif (dossier G09) et laisse le temps de nommer des relecteurs par public avant le déploiement général.
- **À vérifier au test final :** Avec un compte non admin, vérifier qu'aucun bouton de publication n'est disponible.
- **Réversible :** oui
- **Risque si accepté :** L'admin devient un goulet pour les publications.

### HD-C01 — Cycle de vie des décisions (`decision_lifecycle_enforced`, `decision_motive_required`) et décisions dans les obligations (`obligations_include_decisions`).

- **Choix proposé :** Activer en vague 3
- **Justification :** Le cycle de vie et le motif obligatoire sont des durcissements (valeur stricte = 1) ; le registre recommande la vague 3 avec L08, dont le siège sécurité du tour 9 recommande GO PILOT.
- **À vérifier au test final :** Sur TEST, tenter de clôturer une décision sans motif : refus attendu.
- **Réversible :** oui
- **Valeurs proposées (base de TEST seulement) :** `decision_lifecycle_enforced` = `1`, `decision_motive_required` = `1`, `obligations_include_decisions` = `1`
- **Risque si accepté :** Plus de saisie demandée aux secrétaires de séance.

### HD-C02 — Préparation automatique des ordres du jour en brouillon (`agenda_cron_enabled`) — rien n'est envoyé.

- **Choix proposé :** Activer
- **Justification :** La préparation automatique crée des ordres du jour en brouillon sans rien envoyer (registre) ; c'est un interrupteur « quatre yeux », activé par le Centre des politiques.
- **À vérifier au test final :** Vérifier qu'un brouillon d'ordre du jour apparaît sur TEST et qu'aucun message n'est parti.
- **Réversible :** oui
- **Valeurs proposées (base de TEST seulement) :** `agenda_cron_enabled` = `1`
- **Risque si accepté :** Des brouillons inutiles pourraient s'accumuler.

### HD-C03 — Gouvernance du re-baselining : qui peut re-baseliner et seuils d'exception (ADR-G11b).

- **Choix proposé :** Comité seul
- **Justification :** Réserver le re-baselining au comité pendant le pilote est le choix le plus prudent (ADR-G11b) et réversible après le premier cycle.
- **À vérifier au test final :** Avec un compte chef de projet, vérifier qu'un re-baselining est soumis au comité.
- **Réversible :** oui
- **Risque si accepté :** Délais de re-baselining plus longs.

### HD-C05 — Rétention de la corbeille (`soft_delete_enabled`, 30 jours) et purge (`soft_delete_purge_enabled`).

- **Choix proposé :** 30 jours sans purge
- **Justification :** La corbeille de 30 jours protège contre les suppressions accidentelles (valeur stricte = 1) et la purge reste éteinte pendant le pilote (PILOT-PROFILE.md, A-19).
- **À vérifier au test final :** Supprimer un élément sur TEST et le restaurer depuis la corbeille.
- **Réversible :** oui
- **Valeurs proposées (base de TEST seulement) :** `soft_delete_enabled` = `1`, `soft_delete_retention_days` = `30`, `soft_delete_purge_enabled` = `0`
- **Risque si accepté :** La corbeille grossit sans purge pendant le pilote.

## PMO (16)

### HD-G21 — Porte G21 — nom du projet témoin, chef de projet, critères de certification.

- **Choix proposé :** Un projet réel du portefeuille
- **Justification :** Le dossier G21 demande un projet témoin réel ; un projet en exécution, en une seule devise et avec une équipe nommée évite de dépendre de L05 (argent, exclu du pilote).
- **À vérifier au test final :** Ouvrir le projet témoin dans le portefeuille TEST : équipe, jalons et risques renseignés, aucune conversion de devise.
- **Réversible :** oui
- **Risque si accepté :** Le projet choisi pourrait ne pas représenter la complexité d'un programme.
- **Acte humain encore requis :** Le PMO choisit le projet et nomme le chef de projet.

### HD-P01 — Listes de référence du registre d'intake du portefeuille (statuts budgétaires, catégories) — PROPOSÉES.

- **Choix proposé :** Option recommandée : revoir les listes de référence en atelier PMO avant L14
- **Justification :** Les listes (statuts budgétaires, catégories) sont PROPOSÉES ; un atelier PMO les confronte au portefeuille réel avant d'activer L14 (registre).
- **À vérifier au test final :** Vérifier que les listes affichées sur TEST correspondent à celles retenues en atelier.
- **Réversible :** oui
- **Risque si accepté :** Un atelier supplémentaire retarde L14.
- **Acte humain encore requis :** Le PMO doit tenir l'atelier de revue.

### HD-P02 — Règles de qualité des données du portefeuille (19 contrôles, bandes 100/80) et blocage de soumission (`ppm_dq_gate_enforced`).

- **Choix proposé :** Adopter, blocage éteint
- **Justification :** Les 19 contrôles de qualité aident sans bloquer ; laisser le blocage de soumission éteint les deux premières semaines évite de bloquer le pilote sur des données incomplètes (registre).
- **À vérifier au test final :** Ouvrir le tableau de qualité du portefeuille TEST et vérifier qu'une soumission reste possible malgré des écarts.
- **Réversible :** oui
- **Valeurs proposées (base de TEST seulement) :** `ppm_data_quality_enabled` = `1`
- **Risque si accepté :** Des données de qualité insuffisante peuvent être soumises.

### HD-P03 — Définitions des rapports du registre et seuil « bloqué » du tableau exécutif (L14 lot 3).

- **Choix proposé :** Adopter
- **Justification :** Adopter les définitions pour le pilote et les réviser ensuite (registre) ; le tableau exécutif est en lecture.
- **À vérifier au test final :** Ouvrir le tableau exécutif du portefeuille TEST et vérifier le seuil « bloqué » appliqué.
- **Réversible :** oui
- **Valeurs proposées (base de TEST seulement) :** `ppm_portfolio_dashboard_v2_enabled` = `1`
- **Risque si accepté :** Un seuil « bloqué » mal calibré pourrait alarmer.

### HD-P04 — Validateurs des modèles de projet (`ppm_templates_enabled`).

- **Choix proposé :** Nommer
- **Justification :** Un validateur différent de l'auteur des modèles applique la séparation des tâches (registre).
- **À vérifier au test final :** Créer un modèle de projet sur TEST et vérifier qu'il doit être contrôlé par une autre personne.
- **Réversible :** oui
- **Valeurs proposées (base de TEST seulement) :** `ppm_templates_enabled` = `1`
- **Risque si accepté :** Un validateur peu disponible freine la création de modèles.
- **Acte humain encore requis :** Le PMO doit nommer le validateur.

### HD-P05 — Modèle de phases et approbateurs des jalons (ADR-W3).

- **Choix proposé :** Adopter
- **Justification :** Le mappage proposé (ADR-W3) suffit pour le pilote ; il sera revu après un premier cycle de jalons.
- **À vérifier au test final :** Vérifier sur le projet témoin que chaque phase a son approbateur de jalon.
- **Réversible :** oui
- **Risque si accepté :** Des approbateurs mal positionnés pourraient ralentir un jalon.

### HD-P06 — Responsable capacité et contrat de données de capacité ; allocation non précisée (`ppm_alloc_unspecified`).

- **Choix proposé :** Pas maintenant
- **Justification :** Sans responsable capacité nommé ni contrat de données signé, la vue capacité produirait des chiffres sans propriétaire (registre) ; L04 reste CONDITIONAL au consolidé.
- **À vérifier au test final :** Vérifier que `ppm_capacity_view` reste à 0.
- **Réversible :** oui
- **Risque si accepté :** La capacité n'est pas testée au pilote.

### HD-P07 — Performance du nivellement (PPM-F4, 8,8–18,7 s) et budgets de performance (perf-budgets.json, PROPOSÉS).

- **Choix proposé :** Accepter pour le pilote
- **Justification :** Le nivellement (8,8 à 18,7 s) est lent mais fonctionne ; l'accepter avec un avertissement aux utilisateurs permet de mesurer l'usage réel (registre). Il ne prend effet que si L04 est activé.
- **À vérifier au test final :** Lancer un nivellement sur TEST et vérifier que l'avertissement de durée s'affiche.
- **Réversible :** oui
- **Risque si accepté :** Des utilisateurs pourraient abandonner une opération lente.

### HD-P08 — Commentaires de projet ouverts à tout lecteur (`ppm_comments_enabled`, élargit l'écriture).

- **Choix proposé :** Membres de l'équipe seulement
- **Justification :** L'interrupteur actuel ouvre l'écriture des commentaires à tout lecteur (activate-switches.js, ACCESS « widens ») ; le moindre privilège recommande l'équipe seulement, donc l'interrupteur reste éteint tant que cette restriction n'existe pas.
- **À vérifier au test final :** Vérifier que `ppm_comments_enabled` reste à 0.
- **Réversible :** oui
- **Risque si accepté :** Pas de commentaires de projet pendant le pilote.

### HD-P09 — Politique d'approbation des feuilles de temps (ADR-P7B).

- **Choix proposé :** Règle d'écriture du plan
- **Justification :** La règle d'écriture du plan réutilise un contrôle déjà en place (ADR-P7B) ; elle ne prend effet qu'avec L05, exclu du pilote.
- **À vérifier au test final :** Sans objet au pilote (L05 éteint) ; vérifier que les feuilles de temps restent désactivées.
- **Réversible :** oui
- **Risque si accepté :** Le responsable hiérarchique n'intervient pas dans l'approbation.

### HD-P10 — Lien des propriétaires de bénéfices aux utilisateurs (`benefit_owner_link_enabled`).

- **Choix proposé :** Pas maintenant
- **Justification :** Le lien des propriétaires de bénéfices n'a de sens qu'avec L05 (registre), exclu du pilote.
- **À vérifier au test final :** Vérifier que `benefit_owner_link_enabled` reste à 0.
- **Réversible :** oui
- **Risque si accepté :** Aucun.

### HD-P11 — Critères de score des RFI nées de l'incubation (`incubation_rfi_link_enabled`).

- **Choix proposé :** Score provisoire
- **Justification :** Un score provisoire suffit tant que L07 est hors pilote (registre) ; des critères définitifs se décideront avec l'usage.
- **À vérifier au test final :** Vérifier que `incubation_rfi_link_enabled` reste à 0.
- **Réversible :** oui
- **Risque si accepté :** Le score provisoire pourrait être pris pour définitif.

### HD-P12 — Redirection de la feuille de route vers le portefeuille (`roadmap_redirect_to_portfolio`) après un cycle de parité propre ; suppression des données = CAB.

- **Choix proposé :** Option recommandée : redirection éteinte pendant le pilote, à revoir après un cycle de parité propre
- **Justification :** La redirection est classée irréversible ou destructrice quand elle s'accompagne de la suppression des données de feuille de route (K:irreversible_or_destructive, PILOT-PROFILE.md B-09). La garder éteinte est sans risque.
- **À vérifier au test final :** Vérifier que `roadmap_redirect_to_portfolio` reste à 0.
- **Réversible :** oui
- **Risque si accepté :** Deux écrans de feuille de route coexistent pendant le pilote.

### HD-P13 — Portefeuille phase 2 (L16 : dépendances structurées, demande de ressources et capacité, documents, score d'effort, scénarios, export BI `ext_api_portfolio_enabled`) — absent du plan de pilote tant que le PMO, la sécurité (stockage des documents sans antivirus, export vers un outil tiers) et le propriétaire des données ne l'ont pas planifié.

- **Choix proposé :** Hors pilote
- **Justification :** Le consolidé du tour 6 est CONDITIONAL et le registre demande une revue humaine du lot L16 avant toute vague.
- **À vérifier au test final :** Vérifier que les interrupteurs de L16 restent à 0.
- **Réversible :** oui
- **Risque si accepté :** Les fonctions de phase 2 ne sont pas testées au pilote.
- **Acte humain encore requis :** Une revue humaine du lot L16 est nécessaire avant toute vague.

### HD-P14 — Règle de la porte de clôture (R7-4, D-04) livrée avec F-27 et appliquée par défaut : un PROBLÈME (issue) ouvert de niveau élevé bloque la clôture comme un risque, et un risque élevé est débloqué dès qu'un niveau résiduel faible ou moyen est enregistré (`services/governanceStore.js` gateCounts, règle unique `services/ppm/riskExposure.js` isHigh). Règle PROPOSÉE, jamais approuvée.

- **Choix proposé :** Confirmer la règle
- **Justification :** Un problème ouvert de niveau élevé est un risque matérialisé ; le confirmer pour le pilote est le choix le plus prudent (siège PPM du tour 9, L03 GO PILOT conditionnel) et se rediscute après le premier cycle de clôture.
- **À vérifier au test final :** Sur le projet témoin, ouvrir un problème élevé et vérifier que la clôture est bloquée.
- **Réversible :** oui
- **Risque si accepté :** Des clôtures pourraient être bloquées plus souvent.

### HD-P15 — Risques non cotés (R8-1, R8-2) : depuis la migration 139, un risque saisi sans probabilité ni impact reste NULL (inconnu, jamais vert) ; les lignes déjà stockées en 2 × 2 ne peuvent pas être distinguées d'une vraie cotation. Un risque élevé connu à côté d'un risque non coté garde son score avec la mention « partiel » (règle PROPOSÉE).

- **Choix proposé :** Faire revoir les lignes 2 × 2 existantes par leurs propriétaires
- **Justification :** Depuis la migration 139, un risque non coté reste inconnu (jamais vert) ; aucune réécriture automatique des lignes existantes n'est proposée (siège données du tour 9).
- **À vérifier au test final :** Vérifier que les lignes 2 × 2 existantes ont été relues avant d'armer `ppm_project_rag_enabled`.
- **Réversible :** oui
- **Risque si accepté :** La revue prend du temps aux propriétaires de risques.

## CAB (2)

### HD-G03 — Porte G03 — référence CAB, SHA cible approuvé pour TEST, fenêtre d'installation ; mise à jour des dépendances D-11 et passage à PostgreSQL seul PO-08.

- **Choix proposé :** GO pour TEST
- **Justification :** Le dossier G03 sépare l'installation sur TEST de la mise en production (G17). Le panel IA (tour 9, siège opérations) confirme que les migrations jusqu'à 139 s'appliquent sur une base neuve et survivent à une sauvegarde-restauration ; le passage PostgreSQL seul (PO-08) est déjà la réalité du code.
- **À vérifier au test final :** Vérifier qu'une référence CAB et une fenêtre existent pour TEST et que le SHA installé est celui de la CI.
- **Réversible :** oui
- **Risque si accepté :** Une dépendance mise à jour (D-11) pourrait se comporter différemment sur le serveur réel.
- **Acte humain encore requis :** Le CAB doit se réunir, attribuer une référence et fixer la fenêtre d'installation sur TEST.

### HD-G17 — Porte G17 — mise en production : référence CAB, fenêtre, responsable du retour arrière.

- **Choix proposé :** NO-GO
- **Justification :** Le registre indique que G17 ne se décide qu'après G01, G02, G03, G04, G05, G15, G18, G19 et G20 ; aucune de ces portes n'est remplie dans RELEASE-GATES.md. La proposition est donc NO-GO tant que ces portes sont vides.
- **À vérifier au test final :** Vérifier que les neuf portes préalables sont remplies par leurs approbateurs avant de rouvrir G17.
- **Réversible :** oui
- **Risque si accepté :** La production attend la fin du pilote et des portes préalables.
- **Acte humain encore requis :** Le CAB doit se réunir pour toute mise en production, avec un responsable du retour arrière nommé.

## CAB + SRE (1)

### HD-G05 — Porte G05 — valeurs RPO et RTO, emplacement et responsable des sauvegardes, date de l'exercice de restauration sur TEST.

- **Choix proposé :** Valeurs proposées ci-contre
- **Justification :** RPO 24 h correspond à la sauvegarde nocturne chiffrée (job db.backup) et RTO 2 h à la cible déjà mesurée dans docs/ops/pilot/TEST-INSTANCE.md. Le siège opérations du tour 9 a vu passer l'exercice de restauration sur la copie hors site sous écritures concurrentes (0 écart).
- **À vérifier au test final :** Lancer l'exercice de restauration sur TEST et chronométrer : restauration complète en moins de 2 h, données de la veille présentes.
- **Réversible :** oui
- **Risque si accepté :** Jusqu'à 24 h de saisies pourraient être perdues en cas de sinistre.
- **Acte humain encore requis :** Le CAB et le SRE doivent accepter les valeurs RPO/RTO, nommer le responsable des sauvegardes et dater un exercice réel de restauration.

## SRE (3)

### HD-O02 — Politique de rétrécissement des synchronisations (confirmation opérateur ou N confirmations) et dérogation de sauvegarde en clair (`SDP_BACKUP_ALLOW_PLAINTEXT`).

- **Choix proposé :** Confirmation opérateur
- **Justification :** La confirmation par un opérateur est plus simple à auditer que N confirmations automatiques, et aucune dérogation de sauvegarde en clair n'est proposée (registre).
- **À vérifier au test final :** Provoquer un rétrécissement de synchronisation sur TEST et vérifier qu'il attend la confirmation d'un opérateur.
- **Réversible :** oui
- **Risque si accepté :** Une synchronisation peut rester en attente si personne ne confirme.

### HD-O03 — Objectifs de service (SLO) : toutes les cibles sont UNKNOWN.

- **Choix proposé :** Fixer après le pilote
- **Justification :** Les cibles de service sont inconnues (UNKNOWN) ; quatre semaines de lecture du pilote donnent une base mesurée plutôt qu'inventée (registre).
- **À vérifier au test final :** Vérifier que les SLO restent marqués UNKNOWN jusqu'à la fin du pilote.
- **Réversible :** oui
- **Risque si accepté :** Pas d'alerte de dépassement de SLO pendant le pilote.

### HD-O05 — Copie hors site des sauvegardes (`backup_offsite_path`).

- **Choix proposé :** Chemin UNC
- **Justification :** Une copie hors site sur un autre serveur est la condition de la valeur RPO proposée (HD-G05) ; le siège opérations du tour 9 a vu passer l'exercice sur la copie hors site.
- **À vérifier au test final :** Vérifier qu'une sauvegarde récente existe sur le chemin UNC et qu'elle se restaure.
- **Réversible :** oui
- **Risque si accepté :** Le chemin réseau doit rester accessible au compte de service.
- **Acte humain encore requis :** Le SRE doit fournir un emplacement sur un autre serveur.

## DBA (2)

### HD-O01 — Durcissement des droits d'audit (`tools/pg/harden-audit-grants.sql`) : à exécuter par un DBA, après sauvegarde, dans une fenêtre CAB.

- **Choix proposé :** TEST puis production
- **Justification :** Le siège audit du tour 9 demande d'appliquer le durcissement des droits d'audit (re-joué après la migration 137) avant de s'appuyer sur les registres comme preuve ; TEST d'abord, production dans la fenêtre G17.
- **À vérifier au test final :** Après exécution sur TEST, vérifier que le rôle applicatif ne peut plus modifier les tables d'audit.
- **Réversible :** oui
- **Risque si accepté :** Une erreur de droits pourrait bloquer l'écriture du journal.
- **Acte humain encore requis :** Un DBA doit exécuter le script après sauvegarde, dans une fenêtre CAB.

### HD-O06 — Index proposés (ADR-E-A05).

- **Choix proposé :** Attendre la charge
- **Justification :** Créer des index sans mesure de charge risque de ralentir les écritures pour rien ; attendre le résultat G20 (registre).
- **À vérifier au test final :** Relire le tir de charge G20 avant de créer les index.
- **Réversible :** oui
- **Risque si accepté :** Des requêtes lentes restent lentes jusqu'au tir.

## SRE + DBA (1)

### HD-G20 — Porte G20 — budgets de latence et d'erreurs, nombre d'utilisateurs attendus par site.

- **Choix proposé :** Rejouer sur un environnement proche de la production
- **Justification :** Le tir de charge disponible ne tourne pas sur Windows Server avec le volume de production (dossier G20) ; le siège opérations du tour 9 rappelle qu'un essai d'endurance sur le serveur réel reste nécessaire avant G17.
- **À vérifier au test final :** Relire le résultat d'un tir de charge sur Windows Server + PostgreSQL 17 au volume réel.
- **Réversible :** oui
- **Risque si accepté :** Le passage en production est retardé par le tir de charge.
- **Acte humain encore requis :** Le SRE et le DBA doivent exécuter le tir sur l'environnement cible et fixer les budgets.

## Propriétaires des données (2)

### HD-G12 — Porte G12 — propriétaire par source, règles d'anonymisation, responsable du rapprochement de l'historique 2026 (D-10).

- **Choix proposé :** GO sous conditions
- **Justification :** Le dossier G12 montre que le pilote peut tourner avec un propriétaire par source sans attendre le rapprochement historique 2026 (D-10). Exiger le propriétaire avant le pilote évite des chiffres orphelins sans retarder le calendrier.
- **À vérifier au test final :** Vérifier qu'une personne est nommée par source (SDP/Analytics, OpManager, Meraki, saisies natives).
- **Réversible :** oui
- **Risque si accepté :** Un écart historique non rapproché pourrait être découvert pendant le pilote.
- **Acte humain encore requis :** Les propriétaires de données doivent être nommés par leur hiérarchie.

### HD-O07 — Responsable par source pour le tableau de qualité des données (`ui_data_quality_page`).

- **Choix proposé :** Nommer
- **Justification :** Le tableau de qualité des données doit avoir un responsable par source avant la vague 1 (registre, condition L01 du plan pilote).
- **À vérifier au test final :** Ouvrir la page qualité des données sur TEST : chaque source affiche son responsable.
- **Réversible :** oui
- **Valeurs proposées (base de TEST seulement) :** `ui_data_quality_page` = `1`
- **Risque si accepté :** Un responsable peu disponible laisserait des écarts sans suite.
- **Acte humain encore requis :** Les propriétaires des données doivent être nommés.

## Responsable QA (2)

### HD-G19 — Porte G19 — CI verte sur le SHA cible du pilote, tests sautés revus.

- **Choix proposé :** GO pour le SHA nommé
- **Justification :** Le tour 9 du panel IA rapporte une CI verte au SHA figé 928ca8f0 (6 078 tests et répétition PostgreSQL 17) — rapport P11, section Round 9. Une porte QA ne vaut que pour un SHA précis : la proposition limite le GO au SHA qui sera réellement installé sur TEST.
- **À vérifier au test final :** Ouvrir le dernier run CI du SHA installé sur TEST : tous les tests verts, liste des tests sautés relue une à une.
- **Réversible :** oui
- **Risque si accepté :** Un SHA différent de celui de la CI serait installé par erreur.
- **Acte humain encore requis :** Le responsable QA relit la CI du SHA cible et remplit lui-même la ligne G19 de RELEASE-GATES.md.

### HD-O12 — Exécuter les contrôles statiques à chaque fusion (ADR-P09).

- **Choix proposé :** Adopter
- **Justification :** Les contrôles statiques à chaque fusion (ADR-P09) détectent les régressions tôt et sont déjà dans la CI.
- **À vérifier au test final :** Vérifier qu'une fusion déclenche les contrôles statiques dans la CI.
- **Réversible :** oui
- **Risque si accepté :** Des fusions plus lentes.

## Responsable des rapports (2)

### HD-G10 — Porte G10 / D-13 — autorité par rapport du catalogue et identifiants des canaux de diffusion.

- **Choix proposé :** Pas maintenant (aucune diffusion externe)
- **Justification :** Aucune diffusion externe pendant le pilote (K:outbound) ; l'autorité par rapport se décide avant le déploiement général.
- **À vérifier au test final :** Vérifier sur TEST que les envois planifiés et la publication externe sont désarmés.
- **Réversible :** oui
- **Risque si accepté :** Les rapports restent consultables uniquement dans l'application.

### HD-O09 — Maintien des quatre envois enregistrés comme armés en production (`weekly_report_send_enabled`, `scoreboard_send_enabled`, `hygiene_send_enabled`, `asset_group_send_enabled`).

- **Choix proposé :** Maintenir
- **Justification :** Les quatre envois sont armés en production depuis août 2026 ; l'IA ne propose pas de modifier un envoi de production. Sur TEST, les mêmes envois restent éteints (valeur stricte 0), comme le recommande le registre.
- **À vérifier au test final :** Sur TEST, vérifier que les quatre envois sont à 0 et qu'aucun e-mail ne part.
- **Réversible :** oui
- **Valeurs proposées (base de TEST seulement) :** `weekly_report_send_enabled` = `0`, `scoreboard_send_enabled` = `0`, `hygiene_send_enabled` = `0`, `asset_group_send_enabled` = `0`
- **Risque si accepté :** Aucun en production ; sur TEST, les envois ne sont pas testés.
- **Acte humain encore requis :** Le responsable des rapports doit enregistrer lui-même la décision de maintien en production.

## Responsable plateforme / intégrations (5)

### HD-G13 — Porte G13 — liste des appelants de la clé de tableau de bord (D-15) et décision par connecteur (D-07 Meridian, D-08 4MyPeople, D-09 calendrier M365).

- **Choix proposé :** Pas maintenant (connecteurs inchangés)
- **Justification :** Aucun connecteur n'est nécessaire au pilote ; la clé de tableau de bord passe en mode ombre (HD-S05) pour recenser les appelants avant toute restriction (dossier G13). Meridian reste dormant ou retiré (HD-O10).
- **À vérifier au test final :** Consulter le journal du mode ombre de la clé de tableau de bord après deux semaines : liste des appelants.
- **Réversible :** oui
- **Risque si accepté :** Un appelant inconnu pourrait être bloqué plus tard, lors du passage en restriction.

### HD-S14 — Ancrage externe de la tête de chaîne d'audit (AUD-2) et pouvoir d'un seul super_admin d'activer n'importe quel interrupteur (AUD-4).

- **Choix proposé :** Accepter le risque nommément
- **Justification :** Pour l'instance de TEST, les risques AUD-2 (ancrage externe) et AUD-4 (pouvoir d'un seul super_admin) sont des P3 sans falsification cachée constatée (tour 9, sièges audit et opérations) ; le Centre des politiques (HD-S04) réduit AUD-4. Ils doivent être traités avant G17.
- **À vérifier au test final :** Vérifier que l'acceptation du risque porte un nom et est limitée à TEST, avec échéance G17.
- **Réversible :** oui
- **Risque si accepté :** Une falsification par un détenteur de l'accès base resterait détectable seulement a posteriori.
- **Acte humain encore requis :** Le responsable plateforme doit accepter le risque en son nom ; l'IA ne peut pas l'accepter à sa place.

### HD-O04 — Destinataires des alertes de synchronisation (`sync_alert_recipients`) et seuils de dérive par flux (`sync_drift_drop_pct`, `sync_drift_spike_pct`).

- **Choix proposé :** Pas maintenant
- **Justification :** Les alertes de dérive sont un envoi sortant (activate-switches.js, OUTBOUND) ; sans destinataires nommés, elles restent désarmées pendant le pilote.
- **À vérifier au test final :** Vérifier que `sync_drift_alerts` reste à 0 ; la dérive reste lisible dans le journal de santé des synchronisations.
- **Réversible :** oui
- **Risque si accepté :** Une dérive n'est vue qu'en consultant la page de santé.

### HD-O10 — Retrait de Meridian (D-07, `meridian_enabled` à 0).

- **Choix proposé :** Retirer (CAB)
- **Justification :** Meridian a été retiré du plan d'intégrations (2026-09-02), ses clés sont vides et la fonction est dormante ; le retirer réduit la surface d'attaque. Sur TEST, la valeur 0 est appliquée.
- **À vérifier au test final :** Sur TEST, vérifier que la route Meridian répond comme désactivée et que rien d'autre ne casse.
- **Réversible :** oui
- **Valeurs proposées (base de TEST seulement) :** `meridian_enabled` = `0`
- **Risque si accepté :** Un appelant inconnu de Meridian perdrait l'accès.
- **Acte humain encore requis :** Le retrait en production passe par le CAB.

### HD-O13 — Durée maximale d'un interrupteur allumé sans décision (`expiry` de switch-lots.json, null aujourd'hui) et champs de décision des interrupteurs éteints (flag-decisions.json, 0 entrée).

- **Choix proposé :** Fixer N jours et remplir les champs
- **Justification :** Une durée maximale de 60 jours sans décision empêche qu'un interrupteur reste allumé indéfiniment par oubli (registre) ; le champ vit dans docs/ops/switch-lots.json, pas dans la configuration.
- **À vérifier au test final :** Vérifier que les interrupteurs des vagues 1 et 2 ont leurs champs de décision et une échéance de 60 jours.
- **Réversible :** oui
- **Risque si accepté :** Des interrupteurs utiles pourraient devoir être reconfirmés.

## Responsable réseau (1)

### HD-O14 — Calibration du % Time Up (`wan_timeup_loss_pct`) et fermeture des coupures périmées (`wan_stale_close_at`).

- **Choix proposé :** Valeurs proposées (5 / last_seen)
- **Justification :** La calibration du 2026-09-04 reproduit le % Time Up de Meraki avec une perte ≥ 5 % par échantillon (MAE 0,8 point sur semaine et mois, PILOT-PROFILE.md A-18) ; fermer une coupure périmée à sa dernière observation évite de gonfler sa durée.
- **À vérifier au test final :** Comparer sur TEST le % Time Up d'un site avec celui de Meraki pour la même semaine.
- **Réversible :** oui
- **Valeurs proposées (base de TEST seulement) :** `wan_timeup_loss_pct` = `5`, `wan_stale_close_at` = `last_seen`
- **Risque si accepté :** Les chiffres WAN changent par rapport aux rapports déjà diffusés.

## Responsable inspections / GRC (2)

### HD-U17 — Fenêtre des constats répétés (`insp_repeat_window`) et vérification indépendante des actions critiques (`insp_action_verify_enabled`).

- **Choix proposé :** Fixer N et activer
- **Justification :** Une fenêtre de 3 inspections pour les constats répétés et la vérification indépendante des actions critiques (valeur stricte = 1) renforcent le contrôle sans écrire ailleurs (registre).
- **À vérifier au test final :** Clôturer une action critique sur TEST et vérifier qu'elle reste « en attente de vérification » jusqu'à la vérification par une autre personne.
- **Réversible :** oui
- **Valeurs proposées (base de TEST seulement) :** `insp_repeat_findings` = `1`, `insp_repeat_window` = `3`, `insp_action_verify_enabled` = `1`
- **Risque si accepté :** Les actions critiques restent ouvertes plus longtemps.

### HD-U18 — Personne qui adopte les contrôles du registre (`controls_register_enabled`).

- **Choix proposé :** Nommer
- **Justification :** Une personne doit adopter les contrôles du registre avant L08 (registre).
- **À vérifier au test final :** Vérifier que le registre des contrôles affiche la personne qui les adopte.
- **Réversible :** oui
- **Valeurs proposées (base de TEST seulement) :** `controls_register_enabled` = `1`
- **Risque si accepté :** Un registre sans adoptant resterait théorique.
- **Acte humain encore requis :** Le responsable inspections / GRC doit nommer l'adoptant.

## Responsable incidents / problèmes (1)

### HD-U19 — Signataires des revues post-incident et sponsor métier par incident majeur (`pir_reviews_enabled`) ; responsable problèmes (`problem_candidates_enabled`).

- **Choix proposé :** Nommer
- **Justification :** Les revues post-incident exigent des signataires distincts de l'auteur et un responsable problèmes (registre) ; les fonctions restent éteintes tant qu'ils ne sont pas nommés.
- **À vérifier au test final :** Vérifier que `pir_reviews_enabled` reste à 0 tant que les signataires ne sont pas nommés.
- **Réversible :** oui
- **Risque si accepté :** Pas de revue post-incident dans l'outil au pilote.
- **Acte humain encore requis :** Le responsable incidents / problèmes doit nommer les signataires.

## Coordination de site (4)

### HD-O11 — Statuts d'actions d'inspection erronés (UX-F-5) : lancer `node tools/field/inspection-action-status-check.js` sur la base réelle, les propriétaires ferment ou annulent les lignes listées.

- **Choix proposé :** Faire
- **Justification :** Le contrôle des statuts d'actions d'inspection (UX-F-5) est en lecture ; le lancer avant la vague 1 sur les sites pilotes évite de démarrer avec des statuts erronés.
- **À vérifier au test final :** Relire la sortie de tools/field/inspection-action-status-check.js pour les sites pilotes.
- **Réversible :** oui
- **Risque si accepté :** Les propriétaires doivent corriger les lignes signalées.
- **Acte humain encore requis :** Les coordinateurs de site doivent corriger eux-mêmes les statuts signalés sur la base réelle.

### HD-O15 — Filtre de site du Helpdesk (P11 tour 7, F-26) : depuis le correctif 28, les chiffres Helpdesk par site changent au déploiement pour tous les utilisateurs, sans interrupteur — graphies alias ajoutées (HOUNDE compte aussi HGO / Houndé), `SABODALA - MASSAWA` replié dans Sabodala, Ouaga ne compte plus Ouaga2000, MANA ne compte plus MANAGEMENT. Prévenir les coordinateurs de site ; le propriétaire de la table des alias décide si une étiquette combinée se replie sur un seul site.

- **Choix proposé :** Prévenir et garder le repli
- **Justification :** Depuis le correctif 28, les chiffres Helpdesk par site changent ; prévenir les coordinateurs et garder le repli de `SABODALA - MASSAWA` est le choix le moins perturbant (registre).
- **À vérifier au test final :** Ouvrir le Helpdesk filtré sur un site pilote et comparer au chiffre attendu par le coordinateur.
- **Réversible :** oui
- **Risque si accepté :** Des coordinateurs pourraient contester les nouveaux chiffres.
- **Acte humain encore requis :** Les coordinateurs des sites pilotes doivent être prévenus par une personne.

### HD-U15 — Délais des rappels de planification (`schedule_reminder_lead_days`, `schedule_inspection_interval_days`).

- **Choix proposé :** Fixer
- **Justification :** Sans délais, aucun rappel n'est écrit (services/engagementJobs.js). Proposition à tester : rappel 2 jours avant une réunion et inspection de site tous les 90 jours, en rappels internes seulement.
- **À vérifier au test final :** Planifier une réunion à J+2 sur TEST et vérifier qu'un rappel interne apparaît, sans e-mail.
- **Réversible :** oui
- **Valeurs proposées (base de TEST seulement) :** `schedule_reminder_lead_days` = `2`, `schedule_inspection_interval_days` = `90`
- **Risque si accepté :** Des rappels trop fréquents pourraient être ignorés.

### HD-U20 — Tableau de service pour la passation de quart (`shift_handover_enabled`).

- **Choix proposé :** Activer au site pilote
- **Justification :** La passation de quart est utile au site minier pilote en vague 3 (registre) et n'envoie rien.
- **À vérifier au test final :** Sur TEST, faire une passation de quart avec un compte du site minier.
- **Réversible :** oui
- **Valeurs proposées (base de TEST seulement) :** `shift_handover_enabled` = `1`
- **Risque si accepté :** Des passations non utilisées encombreraient le tableau.

## DPO (1)

### HD-U08 — D3 — avis de confidentialité et rétention de la télémétrie d'usage (`ux_event_telemetry`).

- **Choix proposé :** Pas maintenant
- **Justification :** La mesure `page_viewed` suffit au pilote (registre) ; la télémétrie détaillée attend un avis de confidentialité.
- **À vérifier au test final :** Vérifier que `ux_event_telemetry` reste à 0.
- **Réversible :** oui
- **Risque si accepté :** Moins de détail sur les parcours utilisateurs.

## HSE (1)

### HD-U13 — Preuves de qualification HSE par site (`qualification_check_enabled`, `qualification_requirements`).

- **Choix proposé :** Pas maintenant
- **Justification :** Hors pilote (registre) : les preuves de qualification HSE exigent des exigences fournies par le HSE.
- **À vérifier au test final :** Vérifier que `qualification_check_enabled` reste à 0.
- **Réversible :** oui
- **Risque si accepté :** Aucun contrôle de qualification dans l'outil pendant le pilote.

## Juridique + commercial (1)

### HD-G16 — Porte G16 — avis juridique et choix de licence (diffusion hors d'Endeavour uniquement).

- **Choix proposé :** Hors périmètre (usage interne seulement)
- **Justification :** La diffusion hors d'Endeavour n'est pas au chemin critique du pilote interne (dossier G16) ; l'usage interne n'exige pas de choix de licence.
- **À vérifier au test final :** Vérifier qu'aucune diffusion externe du logiciel n'est prévue au plan.
- **Réversible :** oui
- **Risque si accepté :** Un usage externe futur exigera de rouvrir la question.
- **Acte humain encore requis :** Un avis juridique réel reste nécessaire avant toute diffusion externe.
