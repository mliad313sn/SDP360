# Dossier de conception — Étape 03 — Dictionnaire des indicateurs, échelles RAG, registre des sites

Version 1 · 2026-10-19 · Auteur : agent IA · Relecteur : présidence du comité
Référence : SDP-DASH-2.0-ETUDE v1.2, §6.3 étape 3.

> **Statut : socle implémenté, convergence en attente d’arbitrage.** Rien de ce qui est livré ne change
> une couleur ni un chiffre affiché : les tests de fidélité (scores du modèle IT Review) et l’empreinte PPTX
> sont verts **sans régénération**. Les décisions qui changeraient les couleurs sont au §5 (DEC-1 à DEC-5),
> chacune avec la preuve nécessaire pour trancher.

## 1. Objectif et périmètre — écarts avec la fiche

| Demandé | Réalisé | Écart |
|---|---|---|
| Dictionnaire `metric_registry`, ≥ 40 KPI (formule, fenêtre, responsable, source, politique RAG) | oui — **46** entrées, `services/metrics/registry.js` | registre **en code**, versionné et testé, pas en table : une définition n’a rien à faire dans une base qu’un admin peut modifier sans revue |
| `GET /api/metrics/registry` et `GET /api/metrics/:key` | oui — `routes/metrics.js` | `:key` sert **21** indicateurs (ceux qui ont un lecteur propre par site) ; les autres renvoient 422 « documenté seulement » avec leur source — aucune formule n’est réécrite pour l’API |
| Dictionnaire bilingue dans l’aide | oui — page **Operations ▸ KPI Dictionary** + aide §7.6 EN/FR | |
| Converger 5 échelles RAG en ≤ 3 politiques via `kpiRag.js` lu par tous | **socle seulement** | l’inventaire a trouvé **10** échelles rien que côté serveur (et une soixantaine de seuils dans les pages) ; `public/lib/kpiRag.js` les reproduit **valeur pour valeur** et 8 modules serveur le lisent ; la fusion est DEC-1 |
| Registre unique des sites, suppression des alias en dur | **vue + diagnostic** | `GET /api/registry/sites` + onglet admin : chaque code par module, ce que donnent les tables en dur, drapeaux de désaccord ; la suppression est DEC-4 |
| Fermer les lignes « À CONFIRMER » | **outillé** | le registre montre l’état réel de la base ; la confirmation reste humaine (DEC-5) |

## 2. Ce qui est livré

- `services/metrics/registry.js` — 46 indicateurs (domaine, libellés EN/FR, formule en clair, fenêtre, unité, sens, responsable, source, politique RAG, lecteur servi).
- `services/metrics/dispatch.js` — `computeMetric(key, {site, window}, deps)` appelle **le lecteur existant** ; `null` reste `null` (`measured:false`), jamais 0.
- `services/metrics/formulas.js` — `conformityPct` (conformité d’inspection) : une seule formule, désormais aussi utilisée par le scoreboard.
- `public/lib/kpiRag.js` (UMD navigateur + Node) — 10 politiques, `classify()`, `bands()`. Adopté par : `siteScore.rag2`, `siteComposite.rag`, `siteScoreboard`, `siteScoreboardReport`, `deckGovernanceV2.rag`, `merakiWanQuality.statusColor`, `opmAvailability.statusColor`, `reports-pptx-shared.autoStatusColor`. Un test statique interdit le retour des littéraux dans ces fichiers.
- `services/siteRegistry.js` + `GET /api/registry/sites` (admin).
- `public/kpi-dictionary.html` — onglets Indicateurs · Échelles de couleurs · Registre des sites (admin).
- `tools/metrics/rag-impact.js` — tableau d’impact avant/après **en lecture seule** (§4).
- Tests : `metrics-registry`, `kpi-rag`, `site-registry`, `metrics-routes.smoke`.

**Volontairement non touché** : `public/activity-tracker/engine.js`, `tracker-pptx.js`, `App.jsx` (lot gelé derrière le marqueur), les pages navigateur (`executive*.html`, `analytics.html`, `it-review.html`…) dont les seuils sont recensés mais pas encore branchés sur `kpiRag.js` — chaque branchement de page sera fait **après** DEC-1, sinon il faudrait le refaire.

## 3. Inventaire des échelles (résumé)

| Politique (`kpiRag`) | Vert | Orange | Utilisée par |
|---|---|---|---|
| `programme_score` | ≥ 70 | ≥ 45 | score programme 6 dimensions (modèle IT Review), deck gouvernance v2 |
| `composite` | ≥ 75 | ≥ 55 | composite IT Review |
| `scoreboard` | ≥ 75 | ≥ 55 | scoreboard opérationnel + e-mail |
| `meetings_compliance` | ≥ 80 % | ≥ 60 % | 5 Engagements |
| `tracker_site` | ≥ 65 | ≥ 55 | tracker (classement des sites) |
| `tracker_activity` | ≥ 90 % (prod : 100 %) | ≥ 75 % | statut d’activité du tracker |
| `sla_pct` | ≥ 90 | ≥ 85 | SLA de résolution (analyse Lite, e-mail hebdo) |
| `availability_target` | ≥ cible | ≥ 90 % de la cible | WAN % time up, cellules infra du rapport, PPTX |
| `opm_availability` | ≥ cible | ≥ cible − 2 | LAN / Wi-Fi / serveurs (OpManager) |
| `wan_sla` | ≥ cible contractuelle | — | SLA WAN |

Incohérences relevées par l’inventaire (pages navigateur, non modifiées) : le seuil orange du SLA vaut 85, 80, 75 ou 70 selon l’écran ; le NPS vert vaut 30 (Scorecard) ou 50 (deck) ; le taux de réouverture < 1 % (Scorecard) ou < 5 % (deck) ; le succès des changements 90/80, 90/75 ou 90/70 ; le score tracker 65/50 (Site Awareness) contre 65/55 (tracker) ; et **le deck Group IT compte encore les activités tracker avec l’ancien seuil 100 %** (`executive-report.html`) alors que le moteur du tracker sur `main` est à 90 % — à traiter au dégel du lot tracker.

## 4. Tableau d’impact (DEC-1)

`node tools/metrics/rag-impact.js [--asOf=AAAA-MM-JJ] [--json]` — lecture seule, à lancer **sur le serveur de production** (la machine de développement n’a pas les données). Pour chaque site : la valeur du jour, la couleur actuelle, la couleur proposée, et le décompte des changements (↑ / ↓) par indicateur. La proposition testée :

- **SCORE** — tout indice 0-100 : vert ≥ 75, orange ≥ 55 (score programme, composite, scoreboard, tracker site, 5 Engagements).
- **TARGET** — une valeur contre sa cible : vert ≥ cible, orange ≥ 90 % de la cible (disponibilités, SLA WAN, SLA helpdesk avec cible 90).
- **PROGRESS** — réalisé ÷ cible au prorata : vert ≥ 90 %, orange ≥ 75 % (activités du tracker).

Effet attendu à lire dans le tableau : le score programme passe de 70/45 à 75/55, donc **des sites aujourd’hui verts entre 70 et 74 deviennent orange, et des sites orange entre 45 et 54 deviennent rouges** ; c’est le changement le plus visible pour les coordinateurs.

## 5. Points d’arbitrage

| # | Question | Options | Recommandation |
|---|---|---|---|
| DEC-1 | Fusionner les 10 échelles en 3 politiques (SCORE / TARGET / PROGRESS) ? | (a) oui, telles que proposées · (b) oui, avec d’autres seuils · (c) non, garder les échelles actuelles centralisées | décider **sur le tableau d’impact de prod** ; si (a), appliquer en début de cycle mensuel, jamais en cours de cycle |
| DEC-2 | Les deux modèles 6 dimensions de l’auteur (score programme 70/45, composite 75/55) sont des ports fidèles de son tableau de bord : peut-on changer leurs seuils ? | (a) oui, l’auteur valide · (b) non, ils restent hors convergence | (b) tant que l’auteur n’a pas validé : un score qui diverge de celui qu’il affiche est pire que pas de score |
| DEC-3 | OpManager colore à « cible − 2 », le WAN à « 90 % de la cible » : aligner ? | (a) aligner sur 90 % de la cible · (b) garder | (a) — un commentaire du code dit déjà que la bande ±2 avait été abandonnée |
| DEC-4 | Supprimer les tables de codes en dur (tracker, inspection, alias assets, alias registre des risques) au profit de `site_module_codes` ? | (a) oui, après résolution des drapeaux du registre · (b) non | (a), site par site, quand l’onglet Registre des sites n’affiche plus de drapeau rouge pour ce module |
| DEC-5 | Qui confirme les lignes « À CONFIRMER » du registre des sites ? | coordinateur de site · équipe centrale | coordinateur, avec l’onglet Registre des sites comme support |

## 6. Réception

1. Déployer, ouvrir **Operations ▸ KPI Dictionary** : 46 indicateurs, 10 échelles, registre des sites (compte admin).
2. Sur le serveur : `node tools\metrics\rag-impact.js` et joindre la sortie au dossier pour DEC-1.
3. Vérifier qu’aucune couleur n’a bougé : IT Review, scoreboard, cellules infra d’un rapport, deck mensuel.
