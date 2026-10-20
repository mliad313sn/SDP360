---
title: "SDP Dashboard 2.0 — Charte de simplicité et de valeur"
subtitle: "Ce que la plateforme doit être pour chaque partie prenante, ce qu'il faut retirer, et comment le mesurer"
author: "Product Owner — complément au rapport du comité et au plan de remédiation (exécution IA)"
date: "20 octobre 2026 — version 1.1"
lang: fr
---

> **Principe directeur posé par le sponsor.** La plateforme doit être *facile à utiliser, informative et pertinente* ; les processus doivent être *simples et intuitifs* ; elle doit *faciliter l'usage pour toutes les parties prenantes* et *apporter une valeur réelle à l'équipe en retirant de la complexité*. Ce document transforme ce principe en règles vérifiables, en une liste de retraits, et en une **vague 0 « Simplifier »** qui précède les vagues du plan de remédiation.

# 1. Le constat chiffré : la plateforme a grandi plus vite que ses usages

| Mesure (dépôt, commit `436a928`) | Valeur | Lecture |
|---|---|---|
| Pages HTML servies | **47** | Un utilisateur n'en a besoin que de 4 à 6 selon son rôle |
| Entrées de navigation | **33** (dont Operations : 13) | Deux « Trackers », trois surfaces « Direction », trois chaînes de reporting |
| Panneaux d'administration | **30** | Un seul super_admin les utilise ; la plupart sont réglés une fois |
| Clés de configuration | **46** | Dont une dizaine n'ont jamais été renseignées en production |
| Rôles | **11** (5 hiérarchiques + 6 de fonction) | Les coordinateurs cumulent `editor` + `tracker-editor` + site ; personne ne sait ce que donne `audit-viewer` |
| Routes API | **251** | Beaucoup de doublons par module (export Excel ×6, PPTX ×5) |
| Sections d'aide | **54** | Un manuel de cette taille est le symptôme, pas le remède |
| Scores d'un site | **3 à 4** | Aucun utilisateur ne peut expliquer pourquoi il est rouge |

La complexité n'est pas dans une fonction en particulier : elle est dans **l'accumulation sans retrait**. Chaque étape du programme a ajouté une surface sans jamais en fermer une. Le rapport du comité note l'adoption à 2/5 et la participation de l'encadrement à 1,5/5 : ce n'est pas un manque de fonctionnalités, c'est un excès.

# 2. Dix règles de simplicité (vérifiables)

| # | Règle | Comment on la vérifie |
|---|---|---|
| S1 | **Une page d'accueil par rôle**, qui répond à « qu'est-ce que je dois faire aujourd'hui ? » en un écran, sans défilement sur un portable | Test Playwright : la page de rôle rend ses 3 à 5 blocs en < 2 s ; aucune barre de défilement à 390 px |
| S2 | **Trois clics maximum** de l'accueil à toute action du parcours principal du rôle | Scénarios §3 rejoués par Playwright, nombre de clics compté |
| S3 | **Un chiffre, une définition, un propriétaire** : tout indicateur affiché vient du registre et porte un « ? » qui l'explique en une phrase | `tests/registry-consumers.test.js` : aucun seuil littéral hors registre ; chaque tuile a un attribut `data-metric` |
| S4 | **Une saisie, un seul endroit** : une action, un PV, une inspection, un relevé n'est jamais retapé ailleurs | Grep des formulaires : aucune duplication de champ `task/owner/due` entre modules sans `source/origin_id` |
| S5 | **Pas d'écran sans état vide utile** : un écran vide dit quoi faire et propose le bouton | Test statique : toute liste a un bloc `.edv-empty-state` avec une action |
| S6 | **Rien ne se perd** : toute saisie est auto-enregistrée, tout refus garde le contenu, toute suppression s'annule 8 s | Tests autosave/undo par module |
| S7 | **La langue de l'utilisateur**, jamais un mélange | `tests/i18n-coverage.test.js` |
| S8 | **Aucune fonction sans usage mesuré 90 jours après sa mise en service** n'est conservée dans le menu | Tableau d'adoption ; revue trimestrielle « garder / masquer / retirer » |
| S9 | **Budget de complexité** : ≤ 12 entrées de menu, ≤ 6 rôles, ≤ 10 panneaux admin, ≤ 25 clés de configuration visibles, 1 score de site | Test `tests/simplicity-budget.test.js` qui compte et échoue au dépassement |
| S11 | **Tout commentaire IA est en anglais simple pour un lecteur CIO / CFO** : au plus 5 phrases courtes, aucun acronyme ni jargon, jamais de français, quel que soit le gabarit (règle du sponsor, 2026-10-20) | `services/plainEnglish.js` impose la règle à l'exécution ; `tests/plain-english.test.js` + `tests/ai-commentary.test.js` |
| S10 | **Toute nouvelle fonction en retire une** ou prouve par l'adoption qu'elle comble un besoin non couvert | Règle du comité, inscrite dans la charte (doc 02) |

# 3. Les six parcours qui comptent (et ce qu'on leur enlève)

Pour chaque partie prenante : la question à laquelle la plateforme répond, l'écran unique qui y répond, le parcours en clics, et ce qu'on retire pour qu'il tienne.

## 3.1 Technicien de terrain — « Qu'est-ce que je fais maintenant ? »

- **Écran** : `field/` ouvert sur **Mes tâches du jour** : tickets assignés triés par échéance SLA, actions à fermer, inspection en cours. Trois boutons : *Prendre*, *Résoudre / Clore*, *Photo*.
- **Parcours** : ouvrir (1) → tâche (2) → clore avec commentaire (3).
- **On retire** : la navigation par module, le choix de site (déduit du compte), toute saisie de champ non obligatoire au premier écran (les détails se déplient).
- **Valeur** : zéro re-saisie, travail hors-ligne, et un technicien qui ne découvre plus ses tickets par e-mail.

## 3.2 Coordinateur IT de site — « Mon site est-il en ordre cette semaine ? »

- **Écran** : **Mon site** : score unique avec les 4 dimensions expliquées, les 5 points à traiter (actions en retard, SLA, rapport à soumettre, PV à tenir, inspection due), et le bouton *Rapport de la semaine* pré-rempli.
- **Parcours** : accueil (1) → rapport pré-rempli (2) → relire, soumettre (3). Cible 20 minutes mesurée.
- **On retire** : les 5 onglets du rapport (un seul écran défilant, sections repliées quand elles sont auto-remplies), la triple saisie des actions, les « weekly summary / monthly v2 / all-sites » en autant de boutons (un seul *Exporter*, format choisi ensuite).
- **Valeur** : 1 à 2 jours par mois rendus, un score compréhensible, aucune surprise en réunion.

## 3.3 Responsable IT de site — « Où est le problème et qui s'en occupe ? »

- **Écran** : la même page **Mon site** avec un second niveau : charge par technicien, actions par personne, tendance 6 semaines.
- **Parcours** : accueil (1) → technicien ou action (2) → réassigner / commenter (3).
- **On retire** : IT Review, Executive Scorecard et Analytics comme pages séparées pour ce rôle (leurs blocs utiles deviennent des widgets de *Mon site*).
- **Valeur** : pilotage d'équipe sans tableur à côté.

## 3.4 Encadrement de site (non IT) — « Qu'est-ce que l'IT a fait pour mon département ? »

- **Écran** : **Mon département** : le dernier PV, les engagements IT ouverts, un bouton *Signaler / Escalader*, la signature nominative du PV par lien.
- **Parcours** : lien reçu par e-mail (1) → PV (2) → signer ou commenter (3).
- **On retire** : tout le reste. Ce rôle ne voit ni menu, ni scores, ni administration.
- **Valeur** : participation réelle, Engagement #4 enfin mesurable, confiance (« ma signature est la mienne »).

## 3.5 Direction / Group IT — « Quels sites ont besoin de moi, et pourquoi ? »

- **Écran** : **Direction** (le composeur de l'étape 6, pré-composé) : 1 score par site, exceptions seulement, décisions ouvertes, 3 tendances. Un bouton *Rapport mensuel* qui produit le deck.
- **Parcours** : accueil (1) → site en exception (2) → décision ou demande (3).
- **On retire** : `executive.html`, `exec-view.html`, `it-review.html`, `executive-report.html` du menu (conservées un trimestre en « vues historiques », puis retirées) ; les trois scores ; le Roadmap Manager personnel (ses objectifs deviennent un tracker).
- **Valeur** : une réunion mensuelle sur un seul jeu de chiffres, décisions tracées jusqu'à leur effet.

## 3.6 Employé — « L'IT fonctionne-t-elle, et où en est mon ticket ? »

- **Écran** : `status.html` public : état par site, maintenances à venir, contacts, lien *Mon ticket* vers SDP. Aucune donnée personnelle.
- **Parcours** : 1 clic.
- **On retire** : `exec-view.html` (sujets de tickets et textes libres publiés).
- **Valeur** : transparence sans risque.

# 4. La liste des retraits (ce qu'on enlève, pas ce qu'on ajoute)

| Domaine | Aujourd'hui | Cible | Mécanisme |
|---|---|---|---|
| Menu | 33 entrées, 5 groupes | **≤ 12** : Mon site · Terrain · Réunions & actions · Rapports · Direction · Admin · Aide (+ sous-entrées contextuelles) | `_shell.js` réécrit par rôle ; les pages retirées restent accessibles par URL un trimestre avec un bandeau « vue historique » |
| Trackers | 2 (legacy + constructeur) | **1** | Migration vérifiée puis redirection |
| Scores de site | 3–4 | **1** (+ détail des 4 dimensions) | Décision D1, registre |
| Reporting | rapport hebdo 5 onglets + studio + 5 decks PPTX + e-mails | **1 rapport de site** (hebdo, auto-rempli) + **1 rapport direction** (mensuel) ; le studio devient le moteur, pas une page | Gabarit unique `services/reportTemplates/` |
| Surfaces direction | 4 pages | **1** (composeur pré-composé) | Widgets |
| Rôles | 11 | **6** : employé (public) · technicien · coordinateur · responsable IT · direction · admin ; les rôles de fonction deviennent des capacités attachées au rôle (`capabilities_json`), invisibles à la saisie | Migration des comptes par script, matrice régénérée |
| Panneaux admin | 30 | **≤ 10** par regroupement en assistants : Connexions (toutes les intégrations), Utilisateurs & sites, Rapports & envois, Sécurité, Sauvegardes, Journal | `reports.html#admin` restructuré |
| Clés de configuration visibles | 46 | **≤ 25** visibles ; le reste en « avancé » replié avec valeur par défaut raisonnable | Attribut `advanced:true` dans `reportConfig.DEFAULTS` |
| Aide | 54 sections | **Aide contextuelle** (« ? » sur chaque écran, 1 paragraphe) + 6 guides par rôle de 2 pages ; le manuel complet reste en annexe | `public/help/<role>.html` + `data-help` |
| Modules à faible usage (à décider sur 90 jours d'adoption) | Risk Register export, WAN SLA, Roadmap Manager, System Logs v1, Analytics | Garder si usage mesuré ; sinon masquer du menu, conserver l'API | Tableau d'adoption (E7-a) |

# 5. Ce qui apporte la valeur réelle à l'équipe (et qu'on protège)

1. **L'auto-remplissage** du rapport depuis Meraki, OpManager, SDP et le parc : c'est là que le temps se gagne. On l'étend (actions, PV, inspections pré-listées) avant d'ajouter quoi que ce soit.
2. **Le registre des actions unique** : une action vit une fois, visible partout, fermée partout.
3. **Le score unique expliqué** : la seule chose qu'un directeur de site retient.
4. **Le hors-ligne terrain** : le seul moyen de capter l'information là où elle naît.
5. **Les décisions tracées** du cockpit, reliées à une métrique : la mémoire de l'équipe.
6. **L'intégrité** (chiffres gelés, journal, un seul point d'entrée) : invisible pour l'utilisateur, indispensable pour la confiance.

Tout ce qui n'est pas sur cette liste est candidat au retrait ou au repli.

# 6. Vague 0 « Simplifier » — à insérer avant la vague 1 du plan de remédiation

Durée : 2 semaines, en parallèle des correctifs de sécurité C1–C2 (qui ne touchent pas les mêmes fichiers). Exécution par agents selon le §8 du plan de remédiation (une fiche = une session, vérificateur distinct, interdits).

## S-1 — Pages d'accueil par rôle

```
Crée public/home.html (une page, un rendu par rôle) servie sur / après connexion : technicien → Mes tâches
(tickets assignés via tech_group des sites du compte, actions ouvertes, inspection en cours) ;
coordinateur et responsable IT → Mon site (score de référence + 4 dimensions avec « ? », 5 points à traiter
calculés par un pur services/todoForSite.js, bouton Rapport de la semaine) ; direction → redirection vers
le tableau de bord composé « Direction » (dashboardStore, seedé) ; encadrement → Mon département ;
admin → Mon site + raccourcis admin. Aucune donnée hors registre : chaque tuile porte data-metric. Test
Playwright tests/e2e/home-per-role.spec.js : rendu < 2 s, 0 défilement à 390 px, ≤ 3 clics vers chaque
action du §3. FR/EN.
```

**Bénéfice.** Chaque utilisateur sait quoi faire en un écran ; c'est la mesure S1/S2.

## S-2 — Menu réduit par rôle et vues historiques

```
Réécris la NAV de public/_shell.js selon le §4 (≤ 12 entrées, par rôle) ; les pages retirées du menu
(executive.html, exec-view.html, it-review.html, executive-report.html, activity-tracker.html,
analytics.html si non retenue) reçoivent un bandeau « Vue historique — sera retirée le <date> ; utilisez
<lien> » et une ligne d'adoption *_viewed ; tests/module-tabs.test.js et tests/simplicity-budget.test.js
(nouveau : compte les entrées, rôles, panneaux, clés visibles ; échoue au-delà des budgets S9).
```

**Bénéfice.** Fin de l'errance dans le menu ; le budget de complexité devient un test qui casse.

## S-3 — Rapport hebdomadaire en un écran

```
public/reports.html : remplace les 5 onglets par un écran unique en sections repliables ; une section
auto-remplie (infra, helpdesk, parc) s'ouvre repliée avec son résumé et un bouton « Vérifier » ; seules
les sections à saisir (feux, actions, note) sont ouvertes ; autosave visible ; validation au fil de
l'eau ; un seul bouton « Exporter » (PPTX hebdo / mensuel / e-mail choisis ensuite) ; chronomètre
opt-in → métrique report_edit_minutes. Test Playwright : rapport complet en ≤ 12 interactions à partir
des fixtures auto-remplies.
```

**Bénéfice.** Le parcours 3.2 tient en 3 clics ; l'objectif de 20 minutes devient atteignable et mesuré.

## S-4 — Action unique

```
Un seul modèle d'action : table actions_unified (id, site, task, owner, due, status, source, origin_id,
lineage) alimentée par vues de compatibilité depuis md_actions, insp_actions, action_items ; les trois
formulaires créent dans le registre unique via un composant partagé public/lib/actionEditor.js ; le hub
Site Actions devient la seule liste ; « créer aussi dans… » disparaît (c'est automatique). Migration
avec reconnaissance des doublons (actionSimilarity.js) en aperçu avant fusion. Tests sqlite + pg + smoke.
```

**Bénéfice.** La triple saisie disparaît (règle S4) ; moins de doublons dans le hub.

## S-5 — Rôles et administration simplifiés

```
Migre les 11 rôles vers 6 rôles + capacités (users.capabilities_json : tracker-admin, report-author,
audit-viewer, scorecard-viewer deviennent des capacités cochables dans la fiche utilisateur, avec valeur
par défaut déduite du rôle) ; rdb.userHasRole inchangé pour la compatibilité, nouveau rdb.userCan(cap).
Regroupe les 30 panneaux admin en 6 assistants ; marque advanced:true les clés de configuration non
essentielles (repliées) ; script tools/pg/migrate-roles.js (simulation, --apply, sauvegarde). Matrice
AUTHZ régénérée ; tests RBAC existants verts.
```

**Bénéfice.** Un administrateur comprend la fiche utilisateur en 10 secondes ; les comptes « bloqués » (éditeur sans site) deviennent impossibles à créer.

## S-6 — Aide contextuelle et guides par rôle

```
Chaque écran reçoit des « ? » (data-help="clé") ouvrant un paragraphe FR/EN tiré de public/help/context.json ;
six guides de deux pages public/help/<role>.html générés à partir des parcours du §3 ; help.html complet
conservé en annexe ; tests/help-context-coverage.test.js : tout data-metric et toute section de
formulaire a une clé d'aide.
```

**Bénéfice.** On n'ouvre plus un manuel de 54 sections pour savoir ce qu'est un feu orange.

## S-7 — Page statut employé et retrait d'exec-view

```
public/status.html public (FR/EN, aucun texte libre) : état par site dérivé des MI actifs et changements
planifiés, maintenances à venir, contacts IT, SLA par priorité, lien « Mon ticket » vers SDP ;
exec-view.html passe en vue historique puis est retiré. Test : /api/status sans champ libre.
```

**Bénéfice.** Transparence pour tous, zéro donnée personnelle publique (règle E10 du comité).

## S-8 — Tableau d'adoption et revue « garder / masquer / retirer »

```
Généralise *_viewed à toutes les pages ; GET /api/reports/adoption ; widget « Usage 90 jours » dans le
tableau Direction et la page admin ; gabarit docs/sdp360/templates/REVUE-SIMPLICITE.md (par module :
usage, valeur déclarée, décision garder/masquer/retirer, date) rempli par un agent chaque trimestre et
soumis au comité.
```

**Bénéfice.** La règle S8 a une donnée ; la plateforme peut maigrir au lieu de seulement grossir.

# 7. Effet sur le plan de remédiation

- **La vague 0 passe en premier** (sauf C1 et C2, lancés le jour 1) : il est inutile de sécuriser, franciser et documenter des pages qu'on retire.
- **Fiches du plan absorbées par la vague 0** : M13 (doublons, menu) → S-2 ; M16 (ergonomie rapport, triple saisie) → S-3 et S-4 ; V4-4 (page statut) → S-7 ; une partie de E7 (adoption) → S-8 ; E10 point 1 (exec-view) → S-7.
- **Fiches dont le périmètre se réduit** : E8 (francisation) ne porte plus que sur les pages conservées ; E5 (CSP) et M9 (erreurs) sur moins de routes ; M12 (découpage) retire les routes des pages supprimées au lieu de les extraire.
- **Critère de sortie ajouté à chaque vague** : `tests/simplicity-budget.test.js` vert et aucun parcours du §3 au-delà de 3 clics.
- **Règle pour toute fiche V4** : elle doit nommer ce qu'elle retire ou prouver par l'adoption qu'elle comble un besoin non couvert (S10).

# 8. Comment on saura que c'est réussi

| Indicateur | Avant (2026-10-20) | Cible à 90 jours après la vague 2 |
|---|---|---|
| Entrées de menu visibles par un coordinateur | 25+ | ≤ 8 |
| Clics de l'accueil à « soumettre le rapport » | ~9 (menu, page, onglet ×5, bouton) | 3 |
| Temps médian de rédaction du rapport hebdo | non mesuré | ≤ 20 min, mesuré |
| Scores de site affichés | 3–4 | 1 |
| Actions saisies dans plus d'un registre | fréquent | 0 |
| SUS (5 coordinateurs) | non mesuré | ≥ 70 |
| Part des pages ouvertes au moins une fois par semaine par un utilisateur réel | inconnue | ≥ 80 % de celles au menu (les autres sortent du menu) |
| Sections d'aide ouvertes depuis un « ? » contextuel | 0 | majorité des consultations d'aide |
| Tickets de support « je ne trouve pas / je ne comprends pas » | non suivis | suivis, en baisse mois après mois |

> La simplicité n'est pas un sprint : c'est le test `simplicity-budget` qui casse quand on dépasse, la revue trimestrielle qui retire, et la règle « une fonction entre, une fonction sort ». Le comité en est le gardien.
