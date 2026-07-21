# Intégrer effort + investissement dans les rapports — design

**Date:** 2026-07-21
**Statut:** spec, révisé après revue — prêt à planifier
**Branche (prévue):** `feat/assets-reports-integration`

## Problème

Deux tableaux de bord Assets ont été livrés avec leurs lecteurs **exposés pour une
intégration rapport ultérieure, mais jamais câblés** :

- **Effort** (`getEffortLeaderboard` / `getEffortTrend`) — score d'effort **par site**
  dans le temps. Le levier « personne ne veut être dernier ». Déjà visible sur le
  scoreboard IT Review, pas dans les rapports envoyés.
- **Investissement** (`getInvestmentSummary` / `getInvestmentForecast`) — courbe
  historique + prévision **par type d'équipement** + couverture%. Pensé « pour engager
  avec le business et mieux planifier ».

Décision utilisateur : intégrer les deux dans les rapports. Grains différents → foyers
différents (voir consolidation).

## Consolidation (décision de design)

Effort-leaderboard et investissement sont **tous deux des vues management** (comparaison
tous-sites · planification capex). Plutôt que deux rapports groupe qui se chevauchent,
**un seul nouveau digest « Assets — Groupe »** les porte. Plus un **petit bloc effort**
dans le rapport coordinateur per-site (son rang à lui).

| Pièce | Contenu | Destinataire | Foyer |
|---|---|---|---|
| **1** | score effort du site + rang + Δ | coordonnateur | bloc dans le rapport per-site **MENSUEL uniquement** |
| **2** | leaderboard effort complet + prévision investissement par type d'équipement + couverture% | management | NOUVEAU digest programmé (moule hygiène/scoreboard) |

> **Correction (revue)** : le rapport **HEBDO affiche DÉJÀ l'effort** — livré aujourd'hui
> (`weekly.js:290-293` « Score de tenue du parc » / « Classement des sites », via
> `weeklyReportData._loadEffort`). Pièce 1 est donc **mensuelle uniquement** ; ajouter un
> bloc au hebdo ferait un **double affichage**. Le hebdo et le mensuel sont deux chemins
> de données DIFFÉRENTS (hebdo → `weeklyReportData.js`, objet imbriqué `d.assets.effort` ;
> mensuel → `siteReportDeps.js`+`siteReport.js`, objet plat).

Le scoreboard IT Review reste inchangé — complémentaire.

## Substrat vérifié (ne pas re-dériver)

| Lecteur | Forme | Note |
|---|---|---|
| `getEffortLeaderboard({asOf})` `assets-db.js:1144` | `{rows:[{site, effort_score, baseline_score, delta, rank}], most_improved, needs_attention}` | dual-backend. **`site` = libellé AP** (`Sabodala`), pas code |
| `getEffortTrend({site},{months})` `:1197` | série par site | pour une sparkline optionnelle |
| `getInvestmentSummary(filters,{rate})` `:695` | courbe historique USD | `filters` = `_assetWhere` (site/state/product_type/manufacturer/q) |
| `getInvestmentForecast(filters,{config,rate,upliftPct,horizonYears,asOf})` `:718` | `{hardware, software}` (buckets due_now/years/beyond_horizon + couverture) | horizon défaut 5 ; couverture% = garde-fou |

**Piège libellé (déjà résolu ailleurs)** : `asset_effort_history.site` et `assets.site`
portent le **libellé AP** (mine name / code), pas forcément le code meetings. Le bloc
per-site (Pièce 1) doit résoudre le site → libellé(s) via `getAssetLookups().sites` +
`assetLabelToCode` **FORWARD** (jamais inverser `ALIAS`), exactement comme
`services/weeklyReportData.js` le fait déjà pour l'hygiène. Cette logique y est
**privée** → on l'**EXTRAIT** dans un helper partagé (voir Glue Pièce 1), on ne
« réutilise » pas un privé inexistant à l'export.

## Pièce 1 — Bloc effort dans le rapport coordinateur per-site

### Où — `coordinator.js` (mensuel) UNIQUEMENT

`composeCoordinator(data)` reçoit un champ **optionnel** `data.assetEffort` :

```
assetEffort: null | { score:Number, rank:Number, of:Number, delta:Number|null }
```

- `null` → **bloc omis** (site sans libellé AP, ou historique vide). Jamais des zéros.
- `rank`/`of` = « 3ᵉ sur 9 sites ». `of` **doit être DÉRIVÉ** — aucun lecteur ne le
  fournit (le nombre de codes foldés). `delta` = évolution ~30 j (le hebdo le drop pour
  sa cadence, mais le mensuel le montre).
- `coordinator.js` **n'a PAS de bloc assets** (c'est le hebdo qui en a un) — le bloc
  effort se pose après le contenu autoré, en fin de corps.

> **🔴 Piège golden** : `composeCoordinator` (`coordinator.js:412`) joint ses sections
> **sans `.filter(Boolean)`** (contrairement à `composeWeekly`). Injecter `''` quand
> `assetEffort` est absent ajouterait un `
` → **casse les deux goldens byte-à-byte**.
> Insérer par **spread** : `...(data.assetEffort ? [effortBlock] : [])`, jamais une
> chaîne vide. C'est la condition de la rétrocompat byte-identique.

### Glue — helper PARTAGÉ extrait (pas de réutilisation d'un privé)

La résolution libellé→code + fold + recompute du rang vit aujourd'hui **privée** dans
`weeklyReportData.js` (`_loadEffort:104`, `_labelsForCode:59`) — non exportée. On
**EXTRAIT** un helper partagé `services/assetEffortForSite.js`
(`effortForSite(code, {leaderboard, lookups, aliases})` → `{score, rank, of, delta}|null`)
que le nouveau binder mensuel utilise. Il fold via `foldEffortByCode`, **re-classe sur les
codes foldés** (SGO ← Sabodala+Massawa ; un mean de rangs est absurde — même correction
que le scoreboard/weekly) et dérive `of` = nombre de codes foldés.

`services/siteReportDeps.js` gagne un binder `assetEffort(code)` : `getEffortLeaderboard`
+ `getAssetLookups` **une fois par run**, puis `effortForSite(code, …)`. **Await**
(dual-backend). `siteReportData` l'attache à `data`.

> **Bonus DRY (optionnel, non bloquant)** : `weeklyReportData._loadEffort` peut adopter
> le même helper extrait, tant que les tests weekly restent verts. À faire seulement si
> ça ne perturbe rien — le hebdo est fraîchement livré.

## Pièce 2 — Nouveau digest « Assets — Groupe »

Moule **hygiène/scoreboard** verbatim (le pattern est rodé) :

```
services/assetGroupReport.js     composeur PUR → {subject, html}
tools/reports/send-asset-group.js CLI (gate-first, require.main, --preview, armé OFF)
```

- **Config** : `asset_group_send_enabled` (défaut `'0'`) dans `reportConfig.DEFAULTS`
  (sinon `setConfig` le drop en silence) + `asset_group_recipients` (liste management —
  ce digest est GROUPE, pas per-coordinateur, donc recipients de config comme hygiène,
  PAS `resolveRecipient`).
- **Type de planification** : `'asset_group'` dans `reportSchedule.TYPES` + `cliFor`.
- **Contenu** : leaderboard effort (tous sites, rang, Δ, most_improved/needs_attention)
  + prévision investissement (par type d'équipement, horizon 5 par défaut) + les
  **bannières de couverture%** (le garde-fou : « prévision basée sur N/M actifs (X%) » —
  ne JAMAIS présenter la prévision comme exhaustive, la couverture matériel est mince).
- **Money** : USD via `money.fmtUsd` (pas de glyphe `$` — label texte). Les lecteurs
  investissement **appliquent déjà le taux** → NE PAS re-convertir. La CLI tourne HORS
  `server.js` : `_assetUsdRate`/`_assetUpliftPct`/`_deprecConfig` y sont des closures
  **privées, inaccessibles**. La CLI **relit la config elle-même** (comme
  `send-hygiene.js` via `reportConfig.getConfig(db)`) et résout **TROIS** valeurs :
  `xof_usd_rate` (→ taux, jamais 1, fallback DEFAULT), `asset_replacement_uplift_pct`
  (→ uplift), et **`asset_depreciation_config`** (→ `config`, requis par
  `buildHardwareForecast` pour la durée de vie utile — oublié dans rev-1).
- **Dedup / log** : `reportSentLog` `report_type='asset_group'`, `site_code='GROUP'`,
  `period='YYYY-MM'` (mensuel) — comme hygiène.
- **Carte admin** : sur `reports.html`, une carte « 📈 Assets — Groupe » (les **4
  surfaces** `_ADMIN_PANEL_IDS` + hash + rail gate + saveScheduleRow), recipients + arme
  + Preview/Send-now, comme les cartes hygiène/scoreboard.

## Non-buts

- Pas de nouvelle donnée : purement du câblage de lecteurs existants.
- Le digest groupe est **mensuel** (l'investissement bouge lentement ; l'effort a une
  cadence ~30 j). Pas de variante hebdo pour la Pièce 2.
- L'investissement n'entre PAS dans le rapport per-site (par type d'équipement = non-sens
  pour un coordonnateur de site).
- Pas de slide PPTX exec dans cette v1 (option future si demandé).

## Risques

| Risque | Mitigation |
|---|---|
| Bloc effort per-site avec le mauvais rang (libellé vs code) | fold + recompute du rang, réutiliser le helper weekly/scoreboard ; test 2-labels→1-code |
| Prévision investissement lue comme exhaustive | bannière couverture% obligatoire, gate rate-indépendant (déjà dans les lecteurs) |
| `asset_group_*` config droppé en silence | présents dans `reportConfig.DEFAULTS` |
| Nouveau type touche moins de surfaces qu'il ne faut | check-list des surfaces (config, TYPES, cliFor, SUPPORTED_TYPES N/A, _AR_TYPES, panel ids, hash, rail, saveScheduleRow) |
| Bloc omis vs zéros | `assetEffort:null` → omis, jamais des zéros |
| Injection `''` casse les goldens mensuels | spread-insertion `...(x?[b]:[])`, jamais une chaîne vide |
| Double-affichage effort (hebdo déjà fait) | Pièce 1 = mensuel UNIQUEMENT |
| CLI appelle un résolveur server-privé | relire la config dans la CLI, 3 valeurs (taux/uplift/deprec) |
| Money avec `$` | `fmtUsd` sans glyphe, label « USD » |

## Critères de fin

- Le rapport coordinateur (hebdo + mensuel) montre le rang effort du site quand il existe,
  omis sinon ; rang correct après fold sur les codes.
- Un digest « Assets — Groupe » se compose (leaderboard + prévision + couverture%), armé
  OFF, programmable, envoyable depuis la carte admin, dédup mensuel.
- Money en USD sans `$`.
- Les goldens du rapport mensuel restent **byte-identiques** quand `assetEffort` est absent
  (rétrocompat : un composeur sans le champ produit exactement l'e-mail actuel).
- Suites vertes ; await-precedence 5/5.
