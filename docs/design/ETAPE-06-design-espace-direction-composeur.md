# Dossier de conception — Étape 06 — Système de design, espace direction, composeur de tableaux de bord

Version 1 · 2026-10-22 · Auteur : agent IA · Relecteurs : designer, présidence du comité
Référence : SDP-DASH-2.0-ETUDE v1.2, §6.3 étape 6, lacunes L16 (pas d'accès direction autonome), L17 (pas de
démarche design : 37 pages construites au fil de l'eau), L12 partiel (pas de pilotage par programme).
Maquettes cliquables : `docs/design/maquettes/etape-06-prototype.html` (données fictives, marquées comme telles),
publiées pour relecture : https://claude.ai/artifact/QheDNbXHNx918gVA9cgHBq (page privée ; la partager depuis son menu
Partager avec le designer et les relecteurs). Quatre vues : `#direction`, `#site`, `#composeur`, `#systeme`.

> **Statut : lot 6.1 livré — conception à valider.** L'étude impose une conception validée avant tout code : les
> quatre livrables « à soumettre » (§8) et les décisions DEC-6.1 à DEC-6.8 (§9) doivent être arbitrés avant le
> lot 6.2. Rien n'a été modifié dans l'application.

## 1. Fiche → état

| Demandé par l'étude | État de l'existant | Ce dossier |
|---|---|---|
| Parcours utilisateurs (direction, coordinateur, technicien, partie prenante) | aucun formalisé ; chaque page répond à une demande ponctuelle | §3 |
| Système de design étendu (composants, états, densités, mobile, AA) | jetons de marque solides (`public/_tokens.css`, `brand/icons.js`, `brand/components.css`) ; pas de bibliothèque de composants ni d'états standard | §4 + feuille « Système » des maquettes |
| Bibliothèque de maquettes | aucune | prototype cliquable, 4 vues |
| Espace direction (feux par objectif, tendances 13 sem., incidents majeurs, décisions en attente, site et programme), mobile, sans saisie, données datées | trois surfaces partielles : `exec-view.html` (publique, exceptions seulement), `executive.html` (scorecard, 11 000 lignes, onglets d'analyse), `it-review.html` (modèle de l'auteur) | §5 |
| Composeur (grille, 10 types de widgets, filtres, aperçu par audience, publication versionnée) + moteur de rendu sur le shell commun | aucun ; le dictionnaire de l'étape 3 (46 KPI, `/api/metrics/:key`) est la fondation | §6 |
| Remplacement progressif des 37 pages figées | — | §7 : 10 premières pages |
| Tests d'utilisabilité avec le comité | — | §10 : protocole SUS |

## 2. Constats qui orientent la conception

1. **Le dictionnaire est la bonne fondation, mais il ne sert que 21 indicateurs sur 46**, et uniquement **par site et
   par mois** (`routes/metrics.js` exige `site=`). Il n'existe ni **agrégat groupe** (toute la flotte), ni **série
   temporelle** (13 semaines). Ce sont les deux briques dont dépendent à la fois l'espace direction et le composeur :
   elles forment le lot 6.2 (§11), avant toute interface.
2. **Trois pages s'adressent déjà à la direction et se recouvrent.** L'espace direction les remplace comme point
   d'entrée ; `exec-view.html` reste la vitrine publique SharePoint (périmètre volontairement réduit, sans données
   sensibles) et `it-review.html` reste intacte (portage fidèle du modèle de l'auteur, épinglé par tests).
3. **Les rôles existent déjà** : `executive` et `scorecard-viewer` (direction, lecture), `group-business` /
   `site-business` (parties prenantes métier, Site Awareness), `editor` verrouillé sur son site (coordinateurs).
   Le composeur n'a besoin que de deux rôles de fonction nouveaux (§6.6).
4. **La mesure d'usage existe** : `services/viewLog.js` (un événement `*_viewed` par personne et par jour, journal
   System Logs). Le critère « ≥ 3 membres de la direction chaque semaine » se mesure sans nouveau mécanisme.
5. **Accessibilité — quatre couleurs de texte échouent AA aujourd'hui** (contrastes calculés, seuil 4,5:1 pour le
   texte courant) : l'orange primaire `#EF631A` (3,25:1 sur blanc, 2,98:1 sur le fond de page `#F4F5F7`), le gris
   « atténué » `#7B7B7B` (4,23 / 3,88), le vert RAG `#1B9A3A` (3,66 / 3,36) et l'ambre d'alerte `#D97706`
   (3,19 / 2,92). Même `--edv-orange-dark` (`#CA6419`) n'atteint que 3,93:1. Le rouge `#D90038` (5,24), le bleu
   `#145FAE` (6,41) et le texte courant `#524F4E` (8,12) passent. Le jaune de marque est déjà exclu des textes.
   Ces couleurs restent valables pour les aplats, pastilles et icônes ; seuls les **textes** changent (§4.4).

## 3. Parcours utilisateurs

| | Direction | Coordinateur IT de site | Technicien | Partie prenante (DG / directeur financier de site) |
|---|---|---|---|---|
| But | savoir en 2 minutes si l'IT tient ses engagements et où agir | préparer et tenir les revues, fermer les actions de son site | traiter ses tickets, ses inspections, ses actions | savoir si l'IT de son site fonctionne et ce qui est en cours |
| Fréquence | hebdomadaire, avant le comité ; ponctuelle sur incident | quotidienne | quotidienne | mensuelle, avant la revue de site |
| Appareil | **téléphone d'abord**, puis portable | portable | portable, tablette sur le terrain | portable, téléphone |
| Entrée aujourd'hui | le deck mensuel reçu par e-mail ; `exec-view` SharePoint | Site Reports, Site Actions, Réunions | SDP, Inspections | Site Overview (Site Awareness) |
| Questions | Sommes-nous dans les objectifs ? Qu'est-ce qui s'aggrave ? Quel incident majeur est ouvert ? Quelle décision m'attend ? Quel site décroche ? | Qu'est-ce qui est en retard sur mon site ? Que présenter lundi ? | Qu'est-ce qui m'est assigné ? | Mon site est-il dans le vert ? Qu'est-ce qui a changé ce mois ? |
| Cible | **Espace direction** (lecture seule, daté, mobile) | tableau « Mon site » composé + pages de saisie existantes | inchangé (outils de saisie) | tableau « Site » publié pour l'audience `site-business` |
| Ne doit jamais | saisir, filtrer longuement, attendre un deck | — | — | voir un autre site que le sien |

Le parcours direction détaillé (maquette, vue « Espace direction ») :
1. Ouvre le lien (favori ou Teams) → arrive sur l'espace, **date des données en tête**.
2. Lit les feux par objectif (6 secondes) : un feu orange/rouge porte sa raison en une ligne.
3. Descend aux tendances 13 semaines, puis aux incidents majeurs ouverts et aux décisions en attente.
4. Touche un site dans « Où en est-on » → fiche site (même grammaire, périmètre d'un site).
5. Touche « Voir le détail » → page existante correspondante, **seulement si ses droits l'y autorisent**
   (sinon le lien n'est pas affiché).

## 4. Système de design étendu

### 4.1 Fondations (existantes, conservées)
Palette, typographie (Libre Franklin, substitut de Franklin Gothic), espacements, rayons, ombres : `public/_tokens.css`
et son miroir PPTX `brand/brand-tokens.js`. Icônes : `brand/icons.js`. Aucun jeton n'est recréé ; le système étendu
ajoute des **composants** et des **règles**.

### 4.2 Composants à formaliser (feuille « Système » des maquettes)
| Composant | Rôle | Variantes / états |
|---|---|---|
| Tampon de fraîcheur | date et âge des données, obligatoire sur chaque bloc chiffré | à jour · en retard (> seuil `sync_alert_*`) · indisponible |
| Feu d'objectif | valeur, cible, couleur RAG, raison en une ligne | vert · orange · rouge · non applicable (gris, jamais « 0 ») |
| Tuile KPI | grand chiffre + unité + écart vs période précédente | normal · non mesuré (« — » + raison) · en retard |
| Courbe de tendance | 13 points, dernier point mis en valeur, bande de cible | trou de données (ligne coupée, jamais 0) |
| Ligne de site | code, nom, score, couverture N/4, flèche de tendance | classé · non classé (< seuil) · non applicable |
| Carte incident majeur | priorité, site, durée, état RCA | ouvert · résolu < 7 j |
| Carte décision | objet, demandeur, âge, échéance, lien | en attente · en retard |
| Tableau | tri, colonnes figées, export | dense · confort |
| États de page | chargement (squelettes), vide, accès refusé, erreur, hors ligne | messages d'action, sans excuse |

### 4.3 Densités et mobile
- Deux densités : **confort** (espace direction, parties prenantes) et **compact** (coordinateurs, tableaux).
- Points de rupture : < 600 px une colonne ; 600–1 024 px deux colonnes ; > 1 024 px grille 12 colonnes.
- L'espace direction est conçu **à 390 px d'abord** : aucun tableau large, aucune infobulle indispensable (le
  survol n'existe pas au doigt), cibles tactiles ≥ 44 px.

### 4.4 Accessibilité (AA)
- Texte : contraste ≥ 4,5:1 (≥ 3:1 au-delà de 24 px ou 18,7 px gras). **Proposition DEC-6.7** : quatre jetons de
  **texte** accessibles, vérifiés sur blanc, sur le fond de page et sur les fonds teintés des pastilles :

  | Jeton proposé | Remplace en texte | Blanc | Fond `#F4F5F7` | Fond teinté |
  |---|---|---|---|---|
  | `--text-orange` `#B4510F` | `#EF631A` | 5,09 | 4,67 | 4,52 (vert) / 4,57 (ambre) |
  | `--text-muted` `#666666` | `#7B7B7B` | 5,74 | 5,26 | 5,10 / 5,16 |
  | `--text-success` `#157A2E` | `#1B9A3A` | 5,45 | 4,99 | 4,84 |
  | `--text-warning` `#9A5200` | `#D97706` | 5,86 | 5,38 | 5,27 |

  Les couleurs de marque restent pour les aplats, icônes, barres et grands titres.
- Le RAG n'est jamais porté par la seule couleur : chaque feu a un libellé (« Dans l'objectif », « À surveiller »,
  « Hors objectif ») ou une icône de forme distincte.
- Navigation complète au clavier, focus visible, `prefers-reduced-motion` respecté, graphiques doublés d'une
  version texte (valeur courante + tendance en mots).
- Audit outillé (axe-core) à la réception, plus une passe manuelle lecteur d'écran sur l'espace direction.

## 5. Espace direction — contenu proposé

Page `direction.html`, rôle `executive` (et `scorecard-viewer`), **aucune saisie**, chaque bloc daté.

| Bloc | Contenu | Source (existante) | Disponible aujourd'hui ? |
|---|---|---|---|
| En-tête | « Situation au <date des données> », âge de la synchro la plus ancienne utilisée | `sync_job_state` (`/api/sync/health`) | oui |
| Feux par objectif | **6 objectifs de service** (proposition DEC-6.1) : SLA de résolution, SLA de 1re réponse, disponibilité WAN, succès des changements, satisfaction, discipline des revues de site (5 engagements) + **4 piliers** de la stratégie IT (tracker) | dictionnaire (`helpdesk.sla_res_pct`, `helpdesk.sla_reply_pct`, `infra.wan_timeup_pct`, `changes.success_pct`, `helpdesk.csat_pct`, `meetings.engagements_score`) + `tracker-pptx.ps2` | par site seulement ; **agrégat groupe à construire** (lot 6.2) ; 3 KPI non servis |
| Tendances 13 semaines | tickets entrants / clôturés, SLA de résolution, disponibilité WAN, incidents majeurs | `getSiteHelpdeskWindow` par semaine, `wan_link_snapshots` hebdomadaires, `getMajorIncidentsHistory` | lecteurs oui ; **série + agrégat à construire** |
| Incidents majeurs | ouverts maintenant + résolus depuis 7 jours, avec durée et état de l'analyse de cause (RCA/CA/PIR) | `getActiveMajorIncidentsForSite`, `getMajorIncidentsHistory` (UDF) | oui |
| Décisions en attente | escalades Council ouvertes, changements en attente d'approbation CAB, actions en retard de plus de 30 jours (par site) | `meetings-db.listIssues({escalate:1})`, `change_records`, `buildSiteActions` | oui (assemblage à écrire) |
| Où en est-on — sites | une ligne par site : scoreboard opérationnel (4 dimensions), couverture, tendance | `services/siteScoreboard.js` | oui |
| Où en est-on — programmes | 4 piliers et activités du tracker, attainment pondéré ; **option** : roadmap ITSM (4 objectifs) si DEC-6.3 | `tracker-pptx.fleetStats/ps2`, `roadmap_objectives` | oui |

Règles : une valeur non mesurée s'affiche « — » avec sa raison (jamais 0) ; un bloc dont la source est en retard
porte le tampon orange ; un lien de détail n'apparaît que si le rôle de la personne y donne accès ; consultation
journalisée (`direction_viewed`, 1 par personne et par jour).

## 6. Composeur de tableaux de bord

### 6.1 Principe
Un tableau de bord est une **définition** (JSON versionné) rendue par un **moteur** commun. Les widgets ne calculent
rien : ils lisent le dictionnaire (`/api/metrics/*`), qui lit les lecteurs existants. Une définition ne contient
**ni SQL ni code**, seulement des clés du dictionnaire, des filtres et une mise en page — la sécurité et le périmètre
de site restent appliqués par le serveur.

### 6.2 Modèle de définition
```json
{
  "id": "dg-site-monthly", "title": { "fr": "Mon site — revue mensuelle", "en": "My site — monthly review" },
  "audience": { "roles": ["site-business"], "site_scope": "own" },
  "filters": [{ "id": "month", "type": "month", "default": "previous" }],
  "grid": { "columns": 12, "density": "comfort" },
  "widgets": [
    { "id": "w1", "type": "kpi", "at": [0, 0, 3, 2], "metric": "helpdesk.sla_res_pct", "scope": "site", "compare": "previous" },
    { "id": "w2", "type": "trend", "at": [3, 0, 9, 4], "metric": "helpdesk.inbound", "series": { "grain": "week", "points": 13 } },
    { "id": "w3", "type": "rag-grid", "at": [0, 4, 12, 4], "metrics": ["helpdesk.sla_res_pct", "infra.wan_timeup_pct"], "by": "site" },
    { "id": "w4", "type": "text", "at": [0, 8, 12, 2], "markdown": "Les chiffres couvrent le mois précédent." }
  ],
  "version": 3, "status": "published", "published_by": "…", "published_at": "…"
}
```

### 6.3 Catalogue de widgets (10, comme l'étude)
| Type | Lit | Notes |
|---|---|---|
| KPI | 1 clé, site ou groupe, comparaison | couleur = politique RAG du dictionnaire (`kpiRag.js`), jamais choisie par l'auteur |
| Tendance | 1–3 clés en série (semaine / mois, N points) | trous de données coupés |
| Barres | 1 clé par site ou par catégorie | |
| Table | N clés × sites | export CSV |
| Heatmap | 1 clé × sites × périodes | |
| Grille RAG | N clés × sites | |
| Tracker | piliers / activités du tracker | lit `tracker-pptx` (mêmes calculs que le deck) |
| Texte | Markdown restreint (titres, listes, liens internes) | nettoyé côté serveur, aucun HTML |
| Actions | registre des actions (`buildSiteActions`) filtré | lecture seule ; « ouvrir » renvoie à la page de saisie |
| Incidents / décisions | incidents majeurs, escalades, CAB | |

### 6.4 Filtres et aperçu
Filtres déclarés par la définition (site, mois, semaine, groupe de support), valeurs par défaut, et **aperçu par
audience** : l'auteur voit le tableau « comme » un rôle donné (le serveur applique ce rôle, l'auteur ne contourne
pas le périmètre).

### 6.5 Publication versionnée
Brouillon → **publié vN** ; chaque publication garde la version précédente, retour à une version antérieure en un
geste, journal `dashboard_published` dans System Logs. Stockage : tables `dashboard_definitions` et
`dashboard_versions` (migration `db/postgres/reports/0xx_dashboards.sql`, ADR-002).

### 6.6 Droits (proposition DEC-6.4)
| Rôle | Peut |
|---|---|
| `dashboard-author` (nouveau, rôle de fonction) | créer et modifier des brouillons ; aperçu |
| `dashboard-publisher` (nouveau) | publier pour une audience, retirer, revenir à une version |
| super_admin | tout, y compris les tableaux système (espace direction) |
| lecteurs | voir les tableaux publiés dont l'audience les inclut, dans leur périmètre de site |

Le critère « ≥ 5 tableaux publiés par des membres du comité sans développeur » suppose que des membres du comité
reçoivent `dashboard-author` + `dashboard-publisher`.

## 7. Les 10 premières pages remplacées (proposition DEC-6.5)

Critères de choix : page en lecture seule, chiffres déjà (ou bientôt) dans le dictionnaire, pas de modèle « portage
fidèle ». Les pages de saisie (PV, inspections, rapports, tracker, actifs), l'IT Review et l'administration restent.

| # | Page | Lignes | Pourquoi |
|---|---|---|---|
| 1 | `exec-view.html` | 675 | vitrine SharePoint : devient une définition publique restreinte |
| 2 | `executive.html` (onglet KPI Snapshot) | 11 006 | les KPI du dictionnaire ; les onglets d'analyse restent dans un premier temps |
| 3 | `site-awareness.html` | 1 162 | vue site / vue groupe métier : deux définitions, audiences `site-business` / `group-business` |
| 4 | `meetings-insights.html` | 1 046 | 6 graphiques sur des KPI réunions déjà servis |
| 5 | `meetings-compliance.html` | 453 | grille des 5 engagements par site (grille RAG) |
| 6 | `meetings-council.html` | 426 | escalades par thème (widget décisions) |
| 7 | `infra-health.html` | 524 | disponibilité LAN / WLAN / serveurs par site |
| 8 | `wan.html` (onglet santé) | 623 | disponibilité et qualité WAN par site |
| 9 | `inspections.html` (tableau de bord) | 860 | tuiles + tendance mensuelle ; la liste reste |
| 10 | `analytics.html` | 959 | analyses helpdesk (tendances, catégories) |

Chaque remplacement se fait **à côté** de l'ancienne page (comparaison chiffre par chiffre), puis l'ancienne page
redirige — jamais de suppression sans comparaison.

## 8. Livrables « conception à soumettre » (étude)
| Livrable | Où | À faire valider par |
|---|---|---|
| Parcours et maquettes | §3, prototype cliquable | designer + 2 membres de la direction |
| Contenu de l'espace direction | §5, vue « Espace direction » | présidence du comité |
| Droits de publication | §6.6 | présidence du comité + RSSI |
| Liste des 10 premières pages | §7 | comité |

## 9. Points d'arbitrage

| # | Question | Recommandation |
|---|---|---|
| DEC-6.1 | Quels « objectifs » portent les feux ? | les 6 objectifs de service du §5 + les 4 piliers du tracker ; cibles = politiques RAG existantes (`kpiRag.js`) |
| DEC-6.2 | Accès à l'espace direction | **authentifié** (rôle `executive`), SSO Entra recommandé ; `exec-view` reste la seule vue publique, réduite |
| DEC-6.3 | La roadmap ITSM (outil personnel du Service & Support Manager) est-elle publiée dans « programmes » ? | non par défaut ; oui seulement si son auteur le décide (bloc optionnel) |
| DEC-6.4 | Droits de publication | deux rôles de fonction nouveaux (§6.6) ; publication des tableaux « système » réservée au super_admin |
| DEC-6.5 | Liste des 10 premières pages | §7 |
| DEC-6.6 | Designer et outil de maquettes | relecture du prototype HTML par le designer ; le prototype reste la référence (pas d'outil payant imposé) |
| DEC-6.7 | Couleurs de texte accessibles | 4 jetons de texte (§4.4) ; couleurs de marque inchangées pour aplats et icônes |
| DEC-6.8 | Panel des tests d'utilisabilité | 5 personnes : 2 direction, 1 coordinateur, 1 DG de site, 1 membre du comité auteur |

## 10. Critères de réception et mesure
| Critère | Mesure |
|---|---|
| Espace direction utilisé chaque semaine par ≥ 3 membres de la direction | `direction_viewed` (System Logs), requête hebdomadaire par personne distincte |
| ≥ 5 tableaux publiés par des membres du comité sans développeur | `dashboard_published` dont l'auteur n'a pas de rôle technique |
| SUS ≥ 75 | questionnaire SUS (10 questions) après 3 tâches scénarisées par participant (§9 DEC-6.8) |
| Audit AA sans défaut bloquant | axe-core sur chaque page publiée + passe manuelle lecteur d'écran |

## 11. Plan des lots
| Lot | Contenu | Prérequis |
|---|---|---|
| 6.1 | ce dossier + prototype | — |
| 6.2 | **données** : servir les KPI manquants utiles (CSAT, WAN, engagements, scores), agrégat groupe, séries 13 semaines `/api/metrics/:key/series`, tampons de fraîcheur | DEC-6.1 |
| 6.3 | **espace direction** `direction.html` (lecture seule, mobile, AA, journal des vues) | 6.2, DEC-6.2/6.3 |
| 6.4 | **moteur de rendu** + stockage des définitions versionnées ; l'espace direction devient la 1re définition | 6.3 |
| 6.5 | **composeur** (grille, catalogue, filtres, aperçu par audience, publication) + rôles | 6.4, DEC-6.4 |
| 6.6 | remplacement des 10 pages, une par une, avec comparaison chiffre par chiffre | 6.5, DEC-6.5 |
| 6.7 | tests d'utilisabilité, audit AA, mesure des critères | 6.3–6.6, DEC-6.8 |
