# Rapport du comité AMDEC — SDP360, 5 novembre 2026

> **Avertissement.** Ce rapport rend compte d'une **campagne de scénarios exécutée par un agent** (« UAT simulée ») sur
> une base PostgreSQL jetable, peuplée d'une organisation **fictive**. Ce n'est **pas** une recette utilisateur : aucun
> utilisateur réel n'y a participé, rien n'a été signé, et rien ici n'atteste qu'SDP360 est prêt pour la production.
> Les sièges du comité ci-dessous sont des **rôles simulés** par l'agent, pas des personnes.

## 1. Synthèse

- **58 scénarios conçus** sur 10 modèles d'organisation (central, fédéré, éditeur multi-sites sur trois pays, centre
  de services partagé entre bureaux, sites sans code de module, comptes métier, lecteurs, technicien terrain, comité,
  compte désactivé), 5 pays (Sénégal, Burkina Faso, Côte d'Ivoire, Mali, Royaume-Uni), 2 devises (XOF, GBP → USD).
- **30 exécutés par des tests nouveaux** (28 API + 2 parcours navigateur) : **26 verts du premier coup, 4 rouges puis
  corrigés** sur cette branche. **18 couverts par des suites existantes relancées** dans la campagne (toutes vertes).
  **10 non exécutés**, chacun avec sa raison (connecteurs réels, SMTP, lecteur d'écran, accès d'urgence non fusionné…).
- **Relance de référence** : 45 fichiers, **347 tests, 0 échec, 0 ignoré** ; parcours navigateur : **12/12 verts**, aucune
  requête externe.
- **Mise à jour du 5 novembre (suites D-07, D-09, D-10, toujours exécutées par un agent, pas une recette)** : **62 scénarios
  conçus, 36 exécutés par des tests nouveaux** (31 API + 5 parcours navigateur ; 32 verts du premier coup, 4 corrigés),
  18 couverts par des suites existantes, **8 non exécutés**. L'accès d'urgence (NE-01) et le circuit du comité KPI
  (NE-02) sont désormais **joués** ; le fuseau horaire par site (DAT-06b) existe derrière un réglage **désactivé** ;
  les parcours navigateur admin, direction « pire site » et scorecard (U3, U4, U5) sont ajoutés. Relance : `run-e2e`
  **22/22 parcours verts**, aucune requête externe.
- **4 défauts corrigés** (tests rouges avant, verts après) : montant inconnu affiché « 0 USD » (AM-05), semaines
  impossibles acceptées (AM-06), deux sites partageant le même code non signalés (AM-01, détection seulement), nom de
  site non échappé dans la liste des rapports (AM-13).
- **Risque n°1 restant** : **Assafo et Tanda écrivent dans le même tracker (`TND`)**. Le code le signale désormais ; le
  choix du site propriétaire appartient au propriétaire des données.
- **Risque structurel** : aucun de ces parcours n'a été joué par de vrais utilisateurs (AM-14, RPN 700). La recette
  pilote par pays et par modèle d'organisation reste une **porte humaine**.

## 2. Ce que la solution fait — prouvé par quels tests

| Capacité | Preuve (test) |
|---|---|
| Périmètre de site strict pour les coordinateurs, y compris Sabodala ≠ Massawa dans le même pays | ORG-b ; `cross-site-read-sweep`, `cross-site-write-sweep`, `audit-report-write-auth` |
| Éditeur multi-sites sur trois pays : mêmes sites dans rapports, PV, tracker, inspections, Site Awareness, exports | ORG-c, WF-01, WF-03, WF-04 ; `multi-site-editor` ; parcours U1 |
| Centre de services partagé entre bureaux (Dakar, Abidjan, Ouagadougou) | ORG-d, WF-02, WF-04 |
| Équipe IT Groupe centrale sans site : lecture et écriture partout | ORG-a |
| Comptes métier (site / groupe) limités à la vue métier | ORG-f ; `business-only-boundary` |
| Lecteurs : direction, scorecard, finance, lecteur simple — chacun sa tranche, aucune écriture | ORG-g ; parcours U2 |
| Technicien terrain : son site seulement, saisie hors ligne puis synchronisation | ORG-h ; parcours T3 ; `field-*` |
| Ajout d'un nouveau site (Massawa) par le registre des codes, refus clair avant, conflit de code refusé | ORG-e1 |
| Pays et unité métier par site, avec motif obligatoire | ORG-e4 |
| Helpdesk partagé : un site compte tous ses groupes (BF + CI), quel que soit le libellé saisi | DAT-01 |
| « Rien de mesuré » reste vide, jamais 0 % ni vert | DAT-02 ; `uat-itsm-figures` |
| Conversion par devise (GBP, XOF) ; montant non convertible = inconnu | DAT-03 (corrigé) |
| Sous-sites Exploration (FETEKRO / TANDA) sur les lignes WAN | DAT-09 |
| Volume : 20 000 tickets sur un site — lecteur mensuel ~60 ms, rapport de site ~150 ms sur ce poste | DAT-07 |
| Français : bascule de langue, manuel, noms de sites non traduits | parcours T7, U1 ; `i18n-coverage`, `field-french` |
| Accessibilité automatisable : statique, tableaux de données des graphiques, clavier jusqu'au portefeuille | `a11y-static`, `chart-a11y`, parcours T8 |
| Continuité : suppléants bornés, passations avec acceptation, couverture « inconnue » sans planning, qualifications vérifiées par un tiers, demandes d'accès sans auto-approbation | `scoped-deputies`, `handoffs`, `governance-roles`, `shift-handover`, `duty-*`, `qualification-*`, `access-*` |

## 3. Limites — ce qui ne marche pas, ou pas encore

1. **Deux sites, un code** : Assafo et Tanda partagent le code tracker `TND` (AM-01). Signalé, pas réparé.
2. **Nouveau site bloqué** tant qu'un super_admin n'a pas rempli le registre **et** activé le registre (AM-02) ;
   Exploration écrit sous un code `EXP` codé en dur, absent du registre (AM-03).
3. **Deux semaines « W37 »** : le rapport hebdo suit la semaine Zoho (dimanche→samedi, 13–19 sept.), le graphe du rapport
   de site la semaine ISO (lundi→dimanche, 7–13 sept.), sous la même étiquette (AM-07).
4. **Calendriers en UTC** : un ticket de Londres saisi à 00:30 (heure d'été) le 1er septembre compte en août (AM-08).
   Sans effet pour les sites d'Afrique de l'Ouest (UTC+0). **D-07** : fuseau par site (`sites.time_zone`, sinon celui du
   pays) derrière `site_local_calendar` (défaut `0` = UTC, comme aujourd'hui) ; à `1`, seul le lecteur mensuel du helpdesk
   (`getCalendarMonthlyHelpdesk`) compte ce ticket en septembre (DAT-06b). Les autres lecteurs restent en UTC.
5. **Liste des rapports plafonnée à 20 cartes**, sans filtre ni pagination (AM-09).
6. ~~Pas de rôle « comité KPI »~~ : le rôle `kpi-committee` existe depuis C-31 et le circuit brouillon → proposition →
   adoption par un autre membre est joué (NE-02) ; l'auteur ne peut pas adopter. Reste : un rôle inconnu est ignoré sans
   message (AM-04), et qui détient ce rôle reste une décision du comité (AM-10).
7. **L'équipe IT centrale (palier admin) n'a pas accès à Site Awareness** (AM-11) — à confirmer comme voulu.
8. **Libellé source mal orthographié** (`Fetekro Explorarion Office`) : actifs exclus du score d'effort d'Exploration (AM-12).
9. **Accès d'urgence** : fusionné (C-22) et joué (NE-01) — 24 h maximum, jamais à soi-même, revue par un autre
   super_admin, fin à l'heure dite ; il reste **désactivé** (`emergency_access_enabled` = `0`) tant que les super_admins
   habilités ne sont pas nommés (AM-15).
10. **Non vérifié ici** (8 scénarios NE-03 … NE-10) : connexion SSO réelle, envoi d'e-mails réel, données Meraki/OpManager réelles, parité chiffrée
    PPTX/PDF dans cette campagne, charge concurrente réelle, lecteur d'écran, compréhension par les utilisateurs.

## 4. Résultats par modèle d'organisation et par profil

| Modèle × profil | Scénarios | Résultat |
|---|---|---|
| (a) IT Groupe central (admin sans site) | ORG-a, WF-05, ORG-j, U3 | Vert (helpdesk multi-sites, santé infra et WAN au navigateur) ; limites AM-09 (liste 20), AM-11 (pas de Site Awareness) |
| (b) Coordinateur fédéré (Sabodala, Massawa, Houndé) | ORG-b, DAT-05, parcours DENY/T1/T2 | Vert ; défaut AM-06 corrigé |
| (c) Éditeur multi-sites SN + BF + CI | ORG-c, WF-01, WF-03, U1 | Vert, y compris en français |
| (d) Centre de services partagé (bureaux) | ORG-d, WF-02, WF-04, DAT-01 | Vert |
| (e) Sites sans code (Massawa avant ajout, Assafo, Londres) et Exploration | ORG-e1…e4, DAT-09 | Vert ; défaut AM-01 détecté ; limites AM-02/03 |
| (f) Comptes métier site / groupe | ORG-f | Vert |
| (g) Direction, scorecard, finance, lecteur | ORG-g, DAT-03, U2, U4, U5 | Vert (pire site de la semaine et pourquoi ; scorecard sans écriture) ; défaut AM-05 corrigé |
| (h) Technicien terrain hors ligne | ORG-h, T3 | Vert |
| (i) Comité KPI | ORG-i, NE-02 | Vert : rôle `kpi-committee` (C-31), adoption par un autre membre que l'auteur, avec référence |
| (j) Comité, suppléants, compte désactivé, accès d'urgence | ORG-j, suites continuité, NE-01 | Vert ; accès d'urgence joué (désactivé par défaut) |

## 5. Positions des sièges du comité (simulés)

- **Responsable processus ITSM** : un site = ses groupes Zoho, jamais le libellé saisi (DAT-01 le prouve) ; la double
  convention de semaine (AM-07) doit être levée avant de comparer des chiffres hebdomadaires entre écrans.
- **Coordinateur de mine** : l'ajout d'un site doit tenir sur une fiche (D-02) ; aujourd'hui il faut un super_admin et
  une bascule de registre.
- **Coordinateur de bureau** : le centre de services partagé fonctionne ; la liste plafonnée à 20 gêne dès 3 bureaux (D-05).
- **DSI Groupe / direction** : l'IT Review et le scorecard s'ouvrent sans erreur (U2) ; trancher l'accès de l'IT centrale à Site Awareness.
- **Finance** : la conversion par devise est juste ; un site sans devise est désormais « inconnu » ; la certification doit
  compter les lignes exclues (D-06). Les devises et taux restent des données à fournir par la Finance.
- **HSE** : les qualifications ne valent jamais autorisation physique (suites existantes) ; les émetteurs restent à nommer.
- **Architecte sécurité / IAM** : le partage de code `TND` est le risque principal (S = 8) ; échappement corrigé (AM-13) ;
  un rôle inconnu doit être refusé, pas ignoré (D-04).
- **Architecte données / BI** : « rien mesuré » reste nul partout où la campagne a regardé ; corriger la faute de frappe à la
  source plutôt que l'aliaser.
- **SRE / exploitation** : volumes de 20 000 tickets tenus ; calendriers UTC à documenter pour tout futur site hors UTC.
- **Accessibilité & i18n** : français vérifié sur rapports, actions de site, manuel, terrain ; session lecteur d'écran à faire par une personne.
- **Responsable QA** : 30 scénarios nouveaux, 4 défauts trouvés en exécutant ; aucun ne remplace une recette par de vrais utilisateurs.

## 6. Risques AMDEC prioritaires (détail : AMDEC.md)

| # | Mode de défaillance | RPN avant | RPN après | Suite |
|---|---|---:|---:|---|
| AM-14 | Parcours jamais joués par de vrais utilisateurs | 700 | 700 | Porte humaine (recette pilote) |
| AM-01 | Deux sites, un code tracker (Assafo/Tanda) | 320 | 128 | Décision propriétaire + D-01 |
| AM-05 | Montant non convertible affiché « 0 » | 280 | 7 | **Corrigé** ; D-06 (certification) |
| AM-12 | Faute de frappe du libellé source | 280 | 160 | Corriger dans SDP |
| AM-07 | Deux semaines sous la même étiquette | 196 | 112 | D-03 |
| AM-04 | Rôle inconnu ignoré sans message | 160 | 64 | D-04 |
| AM-06 | Semaines impossibles acceptées | 140 | 7 | **Corrigé** |

## 7. Corrections appliquées sur cette branche

| Défaut | Correction | Test (rouge → vert) |
|---|---|---|
| AM-05 | Site dont tous les montants sont non convertibles → `null`, plus `0` (`assets-db.js`) ; l'ancien test qui figeait `0` est mis à jour | DAT-03, `assets-finance-readers` |
| AM-06 | `POST /api/reports/ensure` refuse une semaine hors `1..zohoWeeksInYear(année)` (`server.js`, `reports-db.js`) | DAT-05 |
| AM-01 | Le diff du registre des codes signale `shared_code` (`services/siteCodeRegistry.js`) — détection, pas de réparation | ORG-e3 |
| AM-13 | Échappement du nom de site, de l'étiquette de semaine et des dates dans la liste des rapports (`public/reports.html`) | WF-06 |

Ce sont des corrections de défaut (livrées actives) : aucune ne change un comportement quand les réglages sont à leur
valeur par défaut, sauf le refus d'une semaine inexistante. Aucun nouveau réglage n'a été ajouté.

## 8. Suites (détail : FOLLOW-UP-GOALS.md)

D-01 blocage d'un code partagé · D-02 fiche d'ajout de site · D-03 vocabulaire de semaine unique · D-04 rôle inconnu refusé ·
D-05 filtres et pagination de la liste des rapports · D-06 certification des montants · D-07 fuseau par site ·
D-08 échappement du reste de `reports.html` · D-09 fusion de l'accès d'urgence (C-22) · D-10 parcours admin et scorecard.
D-07, D-09 et D-10 sont livrés (voir `docs/agent-execution/D-070910.md`) ; D-07 reste désactivé par défaut et limité au
lecteur mensuel du helpdesk.

## 9. Portes humaines

Propriétaire du code `TND` ; correction du libellé dans SDP ; activation du registre des codes ; périmètre de Site
Awareness ; propriétaire des seuils KPI ; devises et taux par site ; **recette avec des utilisateurs pilotes par pays et
par modèle d'organisation** ; session lecteur d'écran ; exercice d'installation/restauration sur l'instance TEST ; CAB ;
décision de mise en production. **Aucune de ces portes n'est fermée par ce rapport.**

## 10. Déclaration

Cette campagne a été conçue et exécutée par un agent. Elle établit ce que le code fait sur des données fictives, avec les
tests cités. Elle **ne constitue ni une recette utilisateur, ni une validation de site, ni une autorisation de mise en
production**.
