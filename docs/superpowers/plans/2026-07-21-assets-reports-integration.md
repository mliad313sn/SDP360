# Effort + investissement dans les rapports — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Câbler les lecteurs Assets déjà livrés dans les rapports : (P1) bloc effort
dans le rapport coordinateur **mensuel** ; (P2) nouveau digest « Assets — Groupe »
(leaderboard effort + prévision investissement + couverture%) pour le management.

**Spec:** `docs/superpowers/specs/2026-07-21-assets-effort-investment-reports-design.md` (révisé).
**Branche:** `feat/assets-reports-integration` (déjà créée depuis `main`).

## Règles d'or
1. **Await tout** — lecteurs assets/reports async en pg. `tests/await-precedence.test.js` = 5/5.
2. **Le hebdo affiche DÉJÀ l'effort** — Pièce 1 = mensuel SEUL. Ne pas toucher `weekly.js`.
3. **Goldens mensuels byte-identiques** quand `assetEffort` absent — spread-insertion, jamais `''`.
4. **Nouvelle clé config → `reportConfig.DEFAULTS`** ou `setConfig` la drop en silence.
5. **`result` = `'ok'`|`'resent'`|`'fail'`**. Digest groupe : `site_code='GROUP'`.
6. **money.fmtUsd sans `$`**. Les lecteurs investissement appliquent déjà le taux — pas de double conversion.
7. Tests : `node --test --test-force-exit <files>` depuis la racine.

---

## Task 0 — Extraire le helper effort partagé

**Files:** Create `services/assetEffortForSite.js`; Modify `services/weeklyReportData.js`;
Test `tests/asset-effort-for-site.test.js`.

Aujourd'hui `weeklyReportData._loadEffort` (`:104`) folde le leaderboard via
`foldEffortByCode`, cherche le code, recompute le rang, et retourne `{effort_score, rank}`
(pas de `of`, drop `delta`). On extrait + on enrichit.

- [ ] **Step 1 — test rouge.** `effortForSite(code, { leaderboard, aliases })` (SYNCHRONE
  — le leaderboard est déjà résolu par l'appelant). `leaderboard` = `{rows:[{site, effort_score, delta, rank}], …}`. Assert :
  - fold SGO (Sabodala 71 + Massawa null → 71) : `score=71`.
  - `of` = **nombre de codes foldés non-null** (≥3 codes dans la fixture pour exercer le rang).
  - `rank` = position du code parmi les codes foldés, tri score desc + code asc (tie).
  - `delta` = celui du **premier libellé** foldé pour ce code (ou null si absent) — pris depuis les rows.
  - code sans score foldé → **`null`** (pas un objet de zéros).
  - `aliases` injecté (`foldEffortByCode`) — pas de require dur.
- [ ] **Step 2** FAIL. **Step 3 — implémenter** `services/assetEffortForSite.js` :
  `foldEffortByCode(rows)` → Map ; ordered = entries non-null triées ; `score=folded.get(code)` ;
  `null` si absent ; `rank=ordered.findIndex(...)+1` ; `of=ordered.length` ; `delta` = depuis
  la première row dont `assetLabelToCode(site)===code` (via `aliases.assetLabelToCode`), sinon null.
  Export `{ effortForSite }`.
- [ ] **Step 4 — refactor weekly (garder vert).** `weeklyReportData._loadEffort` appelle
  `effortForSite(code, { leaderboard: board, aliases })` et **ne renvoie que `{effort_score, rank}`**
  (map depuis `{score, rank}`) pour préserver le contrat hebdo. Lance
  `node --test --test-force-exit tests/weekly-report-data.test.js tests/report-template-weekly.test.js` → **inchangé vert**.
- [ ] **Step 5** `node --test --test-force-exit tests/asset-effort-for-site.test.js tests/await-precedence.test.js` vert.
- [ ] **Step 6 — commit:** `refactor(reports): extract shared effortForSite helper (of + delta)`

## Task 1 — Bloc effort dans le rapport coordinateur mensuel

**Files:** Modify `services/reportTemplates/coordinator.js`, `services/siteReportDeps.js`,
`services/siteReport.js` (si nécessaire pour attacher) ; Test `tests/report-template-coordinator.test.js` (ajouts), `tests/site-report-deps.test.js`.

- [ ] **Step 1 — composeur, test rouge d'abord sur le golden.** AVANT toute édition de
  `coordinator.js`, lance `node --test --test-force-exit tests/report-template-primitives.test.js`
  et confirme les 2 goldens **verts** (baseline). Puis ajoute un test : `composeCoordinator`
  avec `data.assetEffort = { score:71, rank:3, of:9, delta:5 }` → `htmlBody` contient
  « 71/100 », « 3 » et « 9 » (rang/of), et « +5 » (delta signé) ; SANS `assetEffort` →
  `htmlBody` **ne contient pas** de marqueur effort.
- [ ] **Step 2** FAIL. **Step 3 — implémenter le bloc** dans `composeCoordinator`, inséré
  par **SPREAD** dans le tableau des sections : `...(data.assetEffort ? [effortBlock] : [])`.
  ⚠ `coordinator.js:412` joint **sans `.filter(Boolean)`** — une chaîne vide ajouterait un
  `\n` et casserait les goldens. Table-based, palette `_primitives`, FR, `escapeHtml`.
  Rang « #3 / 9 sites », delta signé, USD non concerné ici (score 0-100).
- [ ] **Step 4 — les goldens DOIVENT rester verts.** `node --test --test-force-exit tests/report-template-primitives.test.js tests/report-template-coordinator.test.js`.
  Si un golden casse → l'insertion n'était pas propre (chaîne vide injectée) — corriger,
  **NE JAMAIS régénérer le golden**.
- [ ] **Step 5 — binder + glue.** `siteReportDeps.js` : binder `assetEffort(code)` —
  `getEffortLeaderboard({})` + `getAssetLookups()` **une fois** (mis en cache dans le
  closure des deps), puis `effortForSite(code, { leaderboard, aliases })`. Await.
  `siteReport.js`/`siteReportData` attache le résultat à `data.assetEffort`. Test
  (`site-report-deps`) contre un lecteur stub : un code mappé → `{score,rank,of,delta}` ;
  un code sans libellé → `null` (bloc omis).
- [ ] **Step 6** `node --test --test-force-exit tests/site-report*.test.js tests/await-precedence.test.js` vert.
- [ ] **Step 7 — commit:** `feat(reports): monthly coordinator report shows the site's effort rank`

## Task 2 — Composeur pur du digest « Assets — Groupe »

**Files:** Create `services/assetGroupReport.js`; Test `tests/asset-group-report.test.js`.

Mire-toi sur `services/assetHygieneReport.js` (composeur pur hygiène → `{subject, html, …}`).

- [ ] **Step 1 — test rouge.** `buildAssetGroupDigest({ leaderboard, forecast, coverage, period, fmtUsd })`
  → `{ subject, html }`. Assert :
  - `subject` contient « Assets » + le mois.
  - Le **leaderboard effort** rend chaque site (nom, score, rang, Δ), + most_improved / needs_attention.
  - La **prévision investissement** rend les buckets `due_now` / par année / `beyond_horizon`
    (compté, non sommé) et **par type d'équipement** (hardware) + software renouvellement.
  - Les **bannières de couverture%** apparaissent VERBATIM (« basé sur N/M actifs (X%) ») —
    obligatoire, jamais présenter comme exhaustif.
  - **Aucun glyphe `$`** dans `html` (assert `!html.includes('$')`) — USD via `fmtUsd`.
  - Table-based (Outlook), pas de flex/grid.
- [ ] **Step 2** FAIL. **Step 3 — implémenter**, pur, table-based, FR, `escapeHtml`. Réutiliser
  les primitives d'e-mail (`services/reportTemplates/_primitives.js`) si adaptées, sinon
  markup inline comme `assetHygieneReport`.
- [ ] **Step 4** vert. **Step 5 — commit:** `feat(reports): pure Asset Group digest composer`

## Task 3 — CLI + config + type de planification

**Files:** Create `tools/reports/send-asset-group.js`; Modify `services/reportConfig.js`,
`services/reportSchedule.js`; Test `tests/send-asset-group-cli.test.js`, `tests/report-config-asset-group.test.js`.

- [ ] **Step 1 — tests rouges.**
  - config : `asset_group_send_enabled` défaut `'0'` + `asset_group_recipients` défaut `''`,
    **persistés** par `setConfig` (prouve qu'ils sont dans DEFAULTS).
  - CLI : `require` sans effet de bord (`require.main`) ; `decideAssetGroupSend` (arme + recipients
    non vides, comme `decideHygieneSend`) ; `main({cfg: disabled})` → `{sent:0, reason}` sans
    toucher mailer ; bare `--preview` détecté par **présence**.
- [ ] **Step 2** FAIL. **Step 3 — implémenter.** Copier la charpente `send-hygiene.js`
  verbatim (arg parse présence-pas-vérité, `initPgReports` si pg, gate-FIRST, `require.main`,
  `module.exports={decideAssetGroupSend, main}`). **La CLI relit la config elle-même** et
  résout **TROIS** valeurs : `xof_usd_rate` (→ taux, jamais 1, fallback DEFAULT via
  `reportConfig.DEFAULTS`), `asset_replacement_uplift_pct` (→ upliftPct),
  `asset_depreciation_config` (→ `config`, JSON parse via `require('../../services/depreciation').parseDepreciationConfig` si dispo, sinon `JSON.parse`). Appelle
  `getEffortLeaderboard` + `getInvestmentForecast(filters={}, {config, rate, upliftPct, horizonYears:5, asOf})`,
  compose via `assetGroupReport`, envoie aux `asset_group_recipients`, dédup
  `alreadySentToday(db,'asset_group','GROUP',period)`, log `record(db,{report_type:'asset_group', site_code:'GROUP', period, recipients, result})`.
  `reportSchedule.TYPES` += `'asset_group'` + `cliFor` → `tools/reports/send-asset-group.js`.
- [ ] **Step 4** `node --test --test-force-exit tests/send-asset-group-cli.test.js tests/report-config-asset-group.test.js tests/report-schedule*.test.js tests/send-*.test.js` vert.
- [ ] **Step 5 — commit:** `feat(reports): send-asset-group CLI + asset_group schedule type`

## Task 4 — Route + carte admin + vérif navigateur

**Files:** Modify `server.js`, `public/reports.html`; Test `tests/asset-group-route.smoke.test.js`.

- [ ] **Step 1 — smoke rouge.** `POST /api/reports/asset-group/send?preview=1` (admin) → 200 ;
  sans session → 401/403 ; non-admin → 403 ; désarmé → `{sent:0, reason}` (jamais 500).
  ⚠ **Sa propre route**, PAS `SEND_TYPES` (le handler `/api/reports/send` hardcode le composeur
  coordinateur). Copier `POST /api/reports/scoreboard/send`.
- [ ] **Step 2** FAIL. **Step 3 — route** (copie de la route scoreboard, `require('./tools/reports/send-asset-group')`).
- [ ] **Step 4 — carte admin** « 📈 Assets — Groupe » sur `reports.html`, **4 surfaces**
  (`_AR_TYPES`, `_ADMIN_PANEL_IDS`, hash allowlist, rail gate, `saveScheduleRow`) + markup
  panel (recipients + arme + Preview/Send-now), moule des cartes hygiène/scoreboard.
  Ajouter la page HTML au boot `_htmlCache` n'est pas requis (c'est `reports.html`, déjà cached) —
  juste re-vérifier que l'inline JS parse (pas de `null.value`).
- [ ] **Step 5 — VÉRIF NAVIGATEUR.** `preview_start`, redémarrer (reports.html est `_htmlCache`),
  prouver depuis le HTML **servi** que la carte + les 4 surfaces sont présentes et que la route
  répond 401 sans session. Login-gated : n'entrer aucun identifiant ; dire ce qui n'est pas vérifiable.
- [ ] **Step 6 — commit:** `feat(reports): asset-group send route + admin card`

## Task 5 — Régression, CLAUDE.md, merge, ZIP

- [ ] Full : `node --test --test-force-exit tests/report-*.test.js tests/site-report*.test.js tests/asset-*.test.js tests/send-*.test.js tests/await-precedence.test.js` — vert, await 5/5, **2 goldens mensuels intacts**.
- [ ] Prouver les échecs pré-existants sur `main` (`git stash` + checkout) avant de les qualifier ainsi.
- [ ] CLAUDE.md : entrée Current-State + pitfalls — (a) effort mensuel dans le coordinateur / hebdo déjà fait (pas de double) ; (b) helper `effortForSite` partagé, rang recomputé sur codes foldés ; (c) digest Assets-Groupe = recipients config (pas per-coordinateur) ; (d) la CLI relit 3 valeurs config (server-privées) ; (e) spread-insertion pour ne pas casser les goldens.
- [ ] Commit, merge `--no-ff` dans `main`, reconstruire le ZIP.

## Done
- [ ] Le rapport mensuel montre le rang effort du site (omis si non mappé), goldens intacts.
- [ ] Un digest « Assets — Groupe » se compose + s'envoie (armé OFF, programmable, carte admin).
- [ ] USD sans `$` ; couverture% affichée ; rang correct après fold.
- [ ] Suites vertes ; navigateur vérifié ; mergé + empaqueté.
