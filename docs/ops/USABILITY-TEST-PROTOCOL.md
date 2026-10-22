# Protocole — tests d'utilisabilité et audit d'accessibilité de l'étape 6

Version 1 · 2026-10-22 · Lot 6.7 de `docs/design/ETAPE-06-design-espace-direction-composeur.md` (§10, DEC-6.8).
Mesure des résultats : `node tools/metrics/step6-acceptance.js --sus=<fichier.csv>`.

> Ce document outille les tests ; **il ne les remplace pas**. Les séances se font avec de vraies personnes, sur
> l'instance de production (ou une copie fidèle), et c'est le comité qui en tire les conclusions.

## 1. Panel (proposition DEC-6.8)

| # | Profil | Rôle applicatif | Parcours testé |
|---|---|---|---|
| P1 | membre de la direction | `executive` | espace direction |
| P2 | membre de la direction | `executive` ou `scorecard-viewer` | espace direction, sur téléphone |
| P3 | coordinateur IT de site | `editor` + `dashboard-author` | composeur |
| P4 | DG de site | `site-business` | candidat « Mon site — vue métier » |
| P5 | membre du comité auteur | `dashboard-publisher` | composeur + publication |

Cinq personnes suffisent à faire apparaître l'essentiel des problèmes d'un parcours ; au-delà, refaire une
série après corrections plutôt qu'élargir.

## 2. Déroulé d'une séance (30 min)

1. **Accueil (3 min).** « Nous testons l'outil, pas vous. Pensez à voix haute. Il n'y a pas de mauvaise réponse. »
   Demander l'accord pour prendre des notes (pas d'enregistrement vidéo sans accord écrit).
2. **Trois tâches (15 min)**, lues une par une, sans aide. L'observateur note : réussite (oui / avec aide / non),
   durée, hésitations, phrases prononcées.
3. **Questionnaire SUS (5 min)**, rempli seul, sur papier ou formulaire, juste après les tâches.
4. **Débriefing (7 min).** « Qu'est-ce qui vous a le plus gêné ? Qu'est-ce qui vous manquerait pour l'utiliser
   chaque semaine ? »

## 3. Tâches scénarisées

**Espace direction (P1, P2)**
- T1 — « Le SLA de résolution du groupe est-il dans l'objectif ce mois-ci ? Était-il meilleur le mois dernier ? »
- T2 — « Y a-t-il une décision qui vous attend ? Laquelle est la plus ancienne ? »
- T3 — « Quel site est le moins bien placé, et sur quel indicateur ? » (P2 : sur téléphone, sans zoom)

**Composeur (P3, P5)**
- T1 — « Créez un tableau pour votre site avec le volume de tickets du mois et la tendance du SLA sur 13 semaines. »
- T2 — « Vérifiez ce que verra un DG de site, puis enregistrez le brouillon. »
- T3 — (P5) « Publiez-le avec une note de version, puis revenez à la version précédente. »

**Vue métier de site (P4)**
- T1 — « Votre site a-t-il un incident majeur en cours ? »
- T2 — « Le service IT de votre site est-il meilleur ou moins bon que le mois dernier ? »
- T3 — « Quelles actions sont en retard sur votre site ? »

Critère de réussite d'une tâche : la bonne réponse, ou le résultat attendu à l'écran, **sans aide**.

## 4. Questionnaire SUS (System Usability Scale)

Échelle de 1 (pas du tout d'accord) à 5 (tout à fait d'accord). Les dix affirmations, dans cet ordre :

1. Je pense que j'aimerais utiliser cet outil fréquemment.
2. J'ai trouvé cet outil inutilement complexe.
3. J'ai trouvé cet outil facile à utiliser.
4. Je pense que j'aurais besoin de l'aide d'une personne technique pour pouvoir utiliser cet outil.
5. J'ai trouvé que les différentes fonctions de cet outil étaient bien intégrées.
6. J'ai trouvé qu'il y avait trop d'incohérences dans cet outil.
7. J'imagine que la plupart des gens apprendraient à utiliser cet outil très rapidement.
8. J'ai trouvé cet outil très lourd à utiliser.
9. Je me suis senti(e) très en confiance en utilisant cet outil.
10. J'ai eu besoin d'apprendre beaucoup de choses avant de pouvoir utiliser cet outil.

Calcul (fait par l'outil) : items impairs = réponse − 1, items pairs = 5 − réponse, somme × 2,5 → score de 0 à
100. **Critère de réception : moyenne ≥ 75.** Un questionnaire incomplet est écarté, jamais compté comme 0.

Saisie : un fichier CSV, une ligne par participant, **sans nom** (P1…P5), modèle `docs/ops/sus-template.csv` :

```
participant;q1;q2;q3;q4;q5;q6;q7;q8;q9;q10
P1;4;2;4;1;4;2;5;2;4;2
```

## 5. Audit d'accessibilité (AA)

- **Automatique, à chaque commit** : `tests/a11y-step6.test.js` — contraste de chaque couleur de texte de
  `public/dashboard.css` calculé depuis les vrais jetons (≥ 4,5:1), focus visible, mouvement sous
  `prefers-reduced-motion`, langue / repère `main` / titre / zone `aria-live` des trois pages, un titre `h2` par
  bloc, en-têtes de tableau, état RAG écrit en mots (pastilles et cellules), graphique doublé d'une phrase.
- **Outillé, à la réception** : extension axe DevTools (ou Lighthouse ▸ Accessibilité) sur `direction.html`,
  `dashboard.html?id=<un candidat>` et `dashboard-composer.html`, en clair et à 390 px. Aucun défaut « critical »
  ou « serious » accepté.
- **Manuel, une fois** : NVDA (Windows) ou VoiceOver (téléphone) sur l'espace direction — parcours au clavier
  seul (Tab, Maj+Tab, Entrée), lecture des feux, d'une tendance et du tableau des sites.

Consigner les défauts trouvés dans le tableau ci-dessous (une ligne par défaut, corrigé ou accepté par le comité).

| Date | Page | Outil | Défaut | Gravité | Suite |
|---|---|---|---|---|---|
| | | | | | |

## 6. Mesure des autres critères

`node tools/metrics/step6-acceptance.js [--weeks=8] [--sus=fichier.csv] [--tech-roles=super_admin,admin]`
(sur le serveur, depuis `C:\Apps\SDP-Dashboard\`) imprime, sans aucun nom :

- les personnes distinctes ayant ouvert l'espace direction, semaine par semaine (critère : ≥ 3 chaque semaine) ;
- les tableaux publiés par des personnes sans rôle technique (critère : ≥ 5) — les rôles « techniques » sont un
  paramètre, `super_admin,admin` par défaut ;
- la moyenne SUS du fichier fourni.

Lancer la mesure 8 semaines après la mise à disposition, puis à chaque comité.
