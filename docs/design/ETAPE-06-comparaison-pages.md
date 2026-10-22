# Étape 06 — Lot 6.6 — Comparaison des 10 pages et de leurs candidats

Version 1 · 2026-10-22 · Suite du dossier `ETAPE-06-design-espace-direction-composeur.md` §7 (DEC-6.5).

> **Statut : candidats publiés, aucune page remplacée.** Chaque page historique reste en place et inchangée.
> Son candidat est un tableau de bord « système » (`candidat-*`), ouvert depuis `dashboard.html` par les mêmes
> rôles que la page. Il est modifiable dans le composeur comme n'importe quel tableau (super_admin). **Aucune redirection n'est posée
> tant que le comité n'a pas validé la comparaison ci-dessous** (DEC-6.5). Un test vérifie qu'aucun candidat ne
> porte de redirection.

## 1. Ce que la comparaison a montré

Un candidat ne reprend que ce que le dictionnaire des indicateurs sert (`/api/metrics/registry`). Les pages
historiques montrent beaucoup plus : filtres fins (groupe IT, priorité, catégorie), détails par lien ou par
technicien, répartitions (statut, risque, type), listes cliquables. **Aucun candidat ne couvre sa page à 100 %
aujourd'hui.** Les candidats sont donc à lire comme des **vues de synthèse** ; ce ne sont pas encore des remplaçants.
Le choix de remplacer reste au comité (§4).

Différences de **définition** à connaître avant de comparer un chiffre (ce ne sont pas des erreurs) :

- **Période.** Le candidat calcule par **mois calendaire** (ou semaine ISO). Site Awareness « Support » compte sur
  **30 jours glissants**, ses changements sur 90 jours ; Analytics compte sur 7 à 365 jours glissants.
- **Groupe.** Le candidat agrège le groupe en **Σ numérateurs ÷ Σ dénominateurs**, jamais en moyenne de
  pourcentages de sites.
- **Feux.** Le candidat colore avec les politiques serveur (`public/lib/kpiRag.js`) ; certaines pages ont leurs
  propres seuils (ex. Site Awareness, cible SLA 90 %). Un écart de couleur pour une même valeur relève de DEC-1
  (étape 3), pas du candidat.
- **Accès.** `exec-view.html` est **publique** (SharePoint, sans session) ; son candidat **exige une session**
  (DEC-6.2 n'a pas ouvert de mode public au moteur).

## 2. Page par page

Couverture : **Haute** = l'essentiel de la page est là ; **Partielle** = les chiffres principaux, pas les
répartitions ni les filtres ; **Faible** = une petite partie de la page.

| # | Page (rôles) | Candidat | Repris | Manque (reste sur la page) | Couverture |
|---|---|---|---|---|---|
| 1 | `exec-view.html` (public) | `candidat-exec-view` | KPI du mois (volume, SLA résolution et 1re réponse, CSAT, succès des changements), incidents majeurs en cours, tendance du volume, stratégie IT | bandeau d'état global, tuiles d'action, cause et action corrective rédigées des incidents (et leur résumé IA), sites à surveiller, maintenances planifiées, faits marquants et axes (éditorial), **accès public** | Partielle |
| 2 | `executive.html` — KPI Snapshot (executive, scorecard-viewer) | `candidat-executive-kpi` | tickets, clôtures, SLA, backlog, incidents majeurs, CSAT, NPS, changements ; tendances 12 mois | **filtres groupe IT / priorité / catégorie**, taux de réouverture, multi-touch, mise en attente, transferts, changements d'urgence, taux de réponse au questionnaire, top des violations SLA par catégorie, vieillissement par site et par groupe, portail libre-service, panneau de décision, commentaires | Faible |
| 3a | `site-awareness.html` — vue site (site-business, group-business, executive) | `candidat-site-awareness` | SLA, backlog, incidents majeurs, disponibilité WAN, changements, incidents en cours, actions en retard, tendance tickets 6 mois | onglets Installations (inspections), Réunions, Projets ; catégories principales ; répartition des changements ; tendance **hebdomadaire** 6 semaines avec cible 90 % ; fenêtres glissantes 30/90 jours | Partielle |
| 3b | `site-awareness.html` — vue groupe (group-business, executive) | `candidat-site-awareness-groupe` | tableau des sites (SLA, backlog, WAN, changements), incidents, décisions | notation globale par site sur 5 modules, tri du pire au meilleur, synthèse (point faible, site le plus à risque, progrès / reculs) | Partielle |
| 4 | `meetings-insights.html` (tous) | `candidat-meetings-insights` | PV, départements couverts, problèmes ouverts / HIGH / résolus, escalades, score 5 engagements ; carte de chaleur des engagements par site × mois ; problèmes et escalades par site | filtres département et période ; réunions par mois et site vs cible ; ouverts vs clôturés par mois ; par catégorie ; gravité ; escalades par thème ; classement avec E1/E2/E3/E5 | Partielle |
| 5 | `meetings-compliance.html` (tous) | `candidat-meetings-compliance` | score global des engagements par site (grille RAG), PV et départements du mois | **détail E1 / E2 / E3 / E5** (pas encore dans le dictionnaire), diffusion sous 48 h, signature, hygiène du processus (actions sans responsable, escalades sans thème / motif) | Faible |
| 6 | `meetings-council.html` (tous) | `candidat-meetings-council` | décisions en attente (escalades Council, CAB, sites en retard), escalades ouvertes par site | **regroupement par thème** et demande indicative, filtres (site, département, gravité, motif, recherche), détail de chaque escalade | Faible |
| 7 | `infra-health.html` (tous) | `candidat-infra-health` | disponibilité WAN par site, tendance 13 semaines | **LAN, WLAN, serveurs** (OpManager, pas dans le dictionnaire), note globale infra, sondes exclues / non mappées, tendance 12 mois par famille | Faible |
| 8 | `wan.html` — santé (tous) | `candidat-wan` | disponibilité par site (mois), tendance 13 semaines, carte de chaleur site × mois | par lien et sous-site : qualité, MOS, perte, latence, gigue ; périodes jour / semaine ; synchronisation | Partielle |
| 9 | `inspections.html` — tableau de bord (tous, limité à ses sites) | `candidat-inspections` | inspections du mois, conformité, actions ouvertes / en retard, conformité par site, actions en retard, carte de chaleur | inspections critiques, soumises, sites couverts ; répartitions par statut, constats, risque ; filtres dates / risque / statut ; export | Partielle |
| 10 | `analytics.html` (admin, scorecard-viewer) | `candidat-analytics` | tickets et SLA sur 12 mois, tableau par site (volume, clôture, SLA, backlog) | filtres statut / type / impact / mode et périodes glissantes, catégories, **techniciens**, sections Changements, CAB et CSAT détaillées | Faible |

## 3. Procédure de comparaison côte à côte (à faire par un relecteur métier)

Pour chaque page : 20 minutes, une personne qui utilise la page aujourd'hui.

1. Ouvrir la page historique et, dans un second onglet, `dashboard.html` ▸ le candidat correspondant.
2. Régler **le même mois** et **le même site** (ou « Groupe ») des deux côtés. Sur une page à fenêtre glissante
   (Site Awareness, Analytics), choisir le mois calendaire le plus proche et noter l'écart de définition.
3. Relever chaque chiffre présent des deux côtés dans le tableau ci-dessous. Un écart s'explique par une
   différence de définition (§1) ou c'est un défaut à corriger avant toute redirection.
4. Lister ce qui manque au candidat **et dont la personne a réellement besoin** chaque mois. Ce qui est sur la page mais
   que personne ne regarde ne bloque pas un remplacement.
5. Conclure : *remplaçable* / *remplaçable après ajouts (lesquels)* / *à garder*.

| Page | Mois / site | Chiffre | Page | Candidat | Écart expliqué ? | Relecteur |
|---|---|---|---|---|---|---|
| | | | | | | |

Point de départ vérifié (copie de production, 2026-06, groupe) : chaque candidat se calcule **sans erreur de
bloc** ; les candidats sur 12 mois (Scorecard, Analyses) prennent 5 à 7 s au premier affichage, puis sont servis
par le cache de 5 minutes ; les autres moins de 3 s.

## 4. Recommandation pour DEC-6.5

- **Ne rediriger aucune page à ce stade.** Aucun candidat n'atteint la couverture « Haute ».
- Garder les candidats comme **vues de synthèse** à côté des pages, et les ouvrir aux comités de site : c'est le
  bon usage d'un tableau composé (une page, les chiffres qui comptent, la même définition partout).
- Faire grandir le dictionnaire là où l'écart est le plus coûteux, dans cet ordre :
  1. détail des 5 engagements (E1, E2, E3, E5), qui débloque *Compliance* et *Insights* ;
  2. LAN / WLAN / serveurs (OpManager), qui débloque *Infra Health* ;
  3. répartitions par catégorie et par groupe IT (Scorecard, Analytics) ;
  4. un widget « regroupé par thème » pour le Council.
  Chaque ajout = une entrée du registre + un service, puis le candidat s'édite dans le composeur, sans code de
  page.
- Revoir la couverture après chaque ajout. Une page ne redirige qu'après une comparaison signée (§3) et une
  décision du comité.
