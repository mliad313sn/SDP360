# Dossier de conception — Étape 03 — Dictionnaire des KPI, convergence RAG, registre unique des sites

Version 1 · 2026-10-19 · Auteur : agent IA · Relecteur : comité (à réceptionner) · Statut : **implémenté (socle), arbitrages ouverts**

## 1. Objectif et périmètre
Un chiffre = une définition = une couleur. Un **registre des métriques** (clé, nom EN/FR, module, unité, formule, fenêtre, politique RAG, lecteur, responsable) chargé au démarrage, exposé par l'API, et consommé par les modules de score ; les **seuils RAG sont des données** (`kpi_rag_policies`) et plus aucun module de score ne porte de seuil littéral (test statique) ; le **registre des sites** (`sites` + `site_module_codes`) devient la clé unique, les libellés du parc y entrent (module `assets`) et la table d'alias en code passe en repli. Hors périmètre : les tableaux de bord dynamiques (étape 7 — ils lisent ce registre), l'admin graphique du registre (étape 7).

## 2. Existant touché
`public/lib/kpiRag.js` (déplacé depuis `services/`, UMD partagé navigateur + serveur ; `services/kpiRag.js` ré-exporte), `public/activity-tracker/engine.js` et `tracker-pptx.js` (bandes via `KpiRag.rag(…, 'tracker-activity' | 'tracker-boolean')` — fin du « moteur jumeau, éditer les deux »), `services/siteScore.js` (`site-score`), `services/siteComposite.js`, `services/siteScoreboard.js`, `services/siteScoreboardReport.js` (`site-composite`), `services/metricRegistry.js` (nouveau), `routes/metrics.js` (nouveau), `server.js` (chargement au démarrage + montage), `reports-db.js` (semence `site_module_codes` module `assets`, sqlite + pg), `services/scoreboardAliases.js` (registre d'abord, alias en repli), `db/postgres/reports/015_kpi_rag_policies.sql` (+ `tracker-boolean`, `wan-availability`), `public/help.html` (§20 EN + FR), `public/activity-tracker.html` (charge `lib/kpiRag.js`).

## 3. Modèle de données
`kpi_rag_policies (name, scale ratio|points|target-ratio, green, amber, source)` — 7 politiques semées. `metric_registry (key, name, module, unit, formula, window_kind, rag_policy, reader, owner_role, status)` — 46 métriques semées depuis `metricRegistry.SEED` (`ON CONFLICT DO NOTHING` : une ligne modifiée par le comité l'emporte sur le code). `site_module_codes (site_id, 'assets', 'LIBELLE1,LIBELLE2')` — les libellés AP d'un site, virgule-joints (la PK est `(site_id, module)`).

## 4. API / CLI
`GET /api/metrics/registry[?module=]` — dictionnaire + politiques (toute session). `GET /api/metrics/:key?site=<id>&window=` — une valeur `{ value, unit, rag, window{kind,label,from,to}, as_of, record }` ; éditeur = ses sites, palier admin = tout site ; métrique non mesurée → `value: null`, `rag: 'NA'` (jamais 0) ; lecteur en erreur → `{ value: null, error }`, jamais 500. Fenêtres : `month` (`AAAA-MM`), `week` (`AAAA-Wss`, défaut = semaine pleine précédente), `rolling3m`, `ytd`, `current`.

## 5. Écrans
Aide §20 (dictionnaire + politiques). Pas d'écran d'édition (étape 7).

## 6. Règles métier
- Aucun seuil littéral dans un module de score : `tests/metrics-no-scale-outside-registry.test.js` balaye `siteScore`, `siteComposite`, `siteScoreboard(Report)`, `trackerDefinitions`, `dashboardWidgets`, `metricRegistry`, `tracker-pptx`, `engine.js`. Exemptions motivées : `reviewDashboard.js` (port fidèle du tableau de bord de l'auteur, pinné par `review-fidelity`), `merakiWanQuality.js` / `infraHealth.js` (bande WAN relative à la cible, politique `wan-availability`).
- Une nouvelle métrique = une ligne du registre (clé, formule, fenêtre, lecteur) ; un lecteur rend un enregistrement, la métrique en choisit un champ.
- `null` ≠ `0` partout ; aucune date inventée (la fenêtre est toujours renvoyée).

## 7. Tests
`metrics-registry` (6), `metrics-no-scale-outside-registry` (3), `metrics-routes.smoke` (3), `scoreboard-aliases` (+1) ; suites de fidélité (`score-fidelity`, `composite-fidelity`, `review-fidelity`, `deck-governance-v2-fidelity`, golden PPTX) **inchangées et vertes** : les politiques sont enregistrées à l'identique, aucun chiffre n'a bougé.

## 8. Migration
Aucune donnée à migrer : `015_kpi_rag_policies` et `016_dashboard_definitions` sont appliqués par le migrateur ; la semence du registre et des libellés parc est idempotente. Avant/après par site : **identique par construction** (les 5 jeux de seuils hérités sont enregistrés verbatim) — le tableau d'impact n'a de contenu qu'après l'arbitrage 1.

## 9. Sécurité
Lecture par session ; périmètre de site par `services/userSites` (jamais `user.site_id === x`). Aucun SQL dans le registre (`reader` = identifiant de fonction).

## 10. Exploitation
Au démarrage : `[metrics] registry loaded: N metrics (… from DB, … seeded), P RAG policies` et `[metrics] asset-label registry: L labels`. Modifier un seuil = `UPDATE kpi_rag_policies` puis redémarrage (rechargement à chaud = étape 7).

## 11. Risques
Un seuil modifié en base change la couleur de toutes les surfaces d'un coup → c'est le but, mais la décision `DEC-` doit précéder l'`UPDATE` et le tableau d'impact être joint. Un libellé parc absent du registre retombe sur l'alias en code sans signal → le journal de démarrage affiche le nombre de libellés ; l'arbitrage 4 ferme le repli.

## 12. Points d'arbitrage (défauts appliqués, à confirmer)
1. **Convergence des échelles** : 7 politiques enregistrées verbatim ; proposition ≤ 3 — `sla-percent` 90/70 pour tout pourcentage de conformité, `site-composite` 75/55 pour tout score en points, `tracker-activity` 90/75 pour toute atteinte vs cible (`site-score` 70/45 et `tracker-executive` 70/50 à aligner, `tracker-boolean` conservée par sémantique). **Tableau avant/après par site à produire sur données réelles avant décision** (`node tools/pg/…` à écrire si retenu). Défaut appliqué : aucun changement de chiffre.
2. **Sort des deux modèles « 6 dimensions »** (`siteScore` 70/45 et `siteComposite` 75/55, qui divergent sur 3 sites sur 5) : conserver les deux, étiquetés, jusqu'à la décision de l'auteur du modèle — **recommandé** ; alternative : ne publier que le composite opérationnel.
3. **Fenêtres glissantes vs dates d'ancrage** : le registre ne connaît que des fenêtres relatives (`rolling3m`, semaine précédente) ; `reviewDashboard.windows()` reste ancré sur juillet 2026 par fidélité — proposer son remplacement par `resolveWindow` à la réception. **Recommandé : remplacer.**
4. **Fermeture du registre des sites** : supprimer `ALIAS` de `scoreboardAliases.js` et `siteAliases` d'inspection une fois les 9 sites confirmés en base (lignes « TO CONFIRM » : Exploration, Tanda sans code réunions/inspection — à trancher : sites sans PV ni inspection, donc hors score programme). Défaut appliqué : registre d'abord, alias en repli, journal au démarrage.
