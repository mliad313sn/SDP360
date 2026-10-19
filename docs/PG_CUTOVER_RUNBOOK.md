# Migration PostgreSQL — Runbook de bascule prod

> Rédigé le 2026-07-09. Opérateur : Azize. Assistant : Claude (boîte dev).
> Tout le code est prêt et mergé sur `main` derrière 4 flags par module
> (`TRACKER_BACKEND` / `MEETINGS_BACKEND` / `INSPECTION_BACKEND` / `REPORTS_BACKEND`,
> défaut `sqlite` — le prod ne change PAS de comportement tant qu'un flag n'est pas posé).
> Le cluster PostgreSQL 17 du prod est celui installé par 4MyPeople ; la cohabitation
> a été auditée (scripts installeur lus) et prouvée : ses opérations destructives sont
> scopées à `fmp_v2`/`fmp_app`, jamais au cluster ni aux autres bases.

---

## 0. État des lieux (fait / reste)

| ✔ Fait | Détail |
|---|---|
| Code complet 4 modules | Toutes les fns DB + tous les consommateurs server.js forkés, tests verts |
| Outils de bascule | `tools/pg/copy-*.js` (copies idempotentes), `copy-reports-all.js`, `reconcile-reports.js` (diff KPI sqlite↔pg), `provision-prod.js` |
| Menu prod | `_sdp_admin.cmd` (options C = pré-flight, P = provisioning) |
| Dérives de schéma corrigées | colonne `template`, colonnes SSO users, index unique survey_answers (2026-07-09) |
| Dry-run données réelles | Copie du snapshot prod → PG local OK ; réconciliation : **12/21 lecteurs identiques** |

| ✘ Reste (avant les phases concernées) | Bloque |
|---|---|
| **9 lecteurs KPI à ordre non déterministe** (égalités triées différemment par sqlite vs PG : getRequestMetrics, getRequestFilterOptions, getSlaByCategoryDB, getGroupRequestsDB, getAgeingBy{Site,Group}DB, getAgeingSummaryDB, getChangeMetrics, getCABMetrics) → ajouter des clés de tri secondaires aux DEUX forks, re-réconcilier **21/21** | Phase 4 uniquement (reports.db) |
| Driver `pg` absent du node_modules prod (pur JS, xcopy) | Phase 1 |
| pg_dump planifié pour sdp_dashboard | Phase 5 |

---

## 1. Mot de passe `postgres` du prod — arbre de décision

On ne sait pas quel mot de passe superuser est posé sur le cluster prod. **Aucun
n'est bloquant** — essayer dans cet ordre, s'arrêter au premier qui passe :

1. **Le mot de passe standard de l'appliance 4MyPeople** — celui que l'installeur
   pose/attend (clé `StandardPgSuperPassword` du `config.psd1` livré avec
   l'installeur 4MyPeople ; c'est la valeur active sur le cluster DEV depuis le
   2026-07-09). Si le prod a été installé/upgradé par le même installeur
   récemment, c'est le plus probable.
2. **`<PG_PASSWORD>`** — l'ancienne valeur posée à la main à l'installation
   initiale (c'était celle du dev avant standardisation).
3. **Ni l'un ni l'autre ?** Lancer l'installeur 4MyPeople sur le prod →
   option **« P. Set postgres password »** : il réinitialise `postgres` à la
   valeur standard via le mode `trust` local (arrêt service → pg_hba trust →
   ALTER USER → retour scram → redémarrage). C'est SA mécanique officielle,
   sans risque pour les données. Ensuite → candidat 1.
4. Dernier recours manuel (équivalent de 3 sans l'installeur) : éditer
   `pg_hba.conf` → `trust` local → `ALTER USER postgres PASSWORD '…'` → revenir
   à `scram-sha-256` → recharger.

> Le test est instantané et sans effet de bord : `_sdp_admin.cmd` → option **C**
> (ou `node tools\pg\provision-prod.js --check`) après avoir posé un PG_URL,
> ou simplement l'option **P** qui échoue proprement si le mot de passe est faux.

**Après le provisioning, le superuser ne sert PLUS.** Le dashboard vit en
`sdp_app` (mot de passe à toi, jamais réinitialisé par l'installeur 4MyPeople).

---

## 2. Phase 1 — Pré-requis prod (~15 min, aucun impact service)

1. Déployer le zip courant (contient `_sdp_admin.cmd`, `tools/pg/*`, les schémas).
2. **Copier le driver `pg`** (pur JS, 13 dossiers, PAS de npm install sur le prod —
   piège better-sqlite3) : sur la boîte dev, générer le paquet :
   ```powershell
   # dans C:\Users\Admin\Documents\SDP-Dashboard
   $mods = 'pg','pg-connection-string','pg-pool','pg-protocol','pg-types','pg-int8',
           'postgres-array','postgres-bytea','postgres-date','postgres-interval',
           'xtend','pgpass','split2'
   Compress-Archive -Path ($mods | ForEach-Object { "node_modules\$_" }) -DestinationPath sdp-pgdriver.zip
   ```
   Sur le prod : extraire dans `C:\Apps\SDP-Dashboard\node_modules\`.
3. `_sdp_admin.cmd` → **P. Provision PostgreSQL** : au prompt
   `postgres password:`, **laisser VIDE (Enter)** = le mot de passe standard
   de l'appliance est lu automatiquement dans le `config.psd1` de l'installeur
   4MyPeople (même convention que l'installeur ; confirmé actif sur le prod
   par les logs checkdb du 2026-07). Ne taper un mot de passe que si le
   cluster n'est pas encore standardisé (arbre §1). Puis choisir le mot de
   passe de `sdp_app` (le noter dans le coffre). Crée `sdp_app` +
   `sdp_dashboard`. Idempotent, ne touche pas fmp_v2.
4. Ajouter au `.env` prod (SANS poser de flag backend !) :
   ```
   PG_URL=postgres://sdp_app:<mdp>@localhost:5432/sdp_dashboard
   ```
5. `_sdp_admin.cmd` → **C. Check DB connection** → doit afficher `[check] OK`.

**Rollback : rien à annuler — rien ne consomme encore PG_URL.**

## 3. Phase 2 — Pilote : Activity Tracker (~10 min, fenêtre calme)

Le plus petit module, données saisies à la main, instantanément réversible.

1. Copie : `set PG_URL=... && node tools\pg\copy-tracker.js` (idempotent).
2. `.env` : `TRACKER_BACKEND=postgres` → `_sdp_admin.cmd` option 2 (restart).
3. Vérifier : ouvrir le tracker, saisir une valeur, recharger, l'y retrouver ;
   `pm2 logs | findstr Tracker`.
4. Observer **une semaine**.

**Rollback : retirer le flag + restart** (tracker.db intact ; les saisies
faites PENDANT la fenêtre PG restent dans PG — re-copier à la main si besoin).

## 4. Phase 3 — Meetings puis Inspection (~15 min chacun)

Même recette : `copy-meetings.js` / `copy-inspection.js` → flag → restart →
vérification fonctionnelle (ouvrir un PV / une inspection avec photos — le
contrat blobStore est identique). Une semaine d'observation chacun.

## 5. Phase 4 — reports.db (le gros morceau, tout-ou-rien)

**GATES avant d'y toucher :**
- [ ] les 9 lecteurs à tri non déterministe corrigés (boîte dev) ;
- [ ] `reconcile-reports.js` sur un snapshot prod FRAIS : **21/21 ✓** ;
- [ ] Phases 2-3 stables depuis ≥ 1 semaine.

Exécution (fenêtre creuse, juste APRÈS un sync Zoho réussi) :
1. Backup : `_sdp_admin.cmd` option 5 + copie à froid de `data\reports.db`.
2. `PG_URL=... node tools\pg\copy-reports-all.js` (auth → config → reports → hot,
   ordre FK, idempotent).
3. `.env` : `REPORTS_BACKEND=postgres` → restart (option 2).
4. Vérifier : login, dashboard helpdesk, Analyze (Quick) → Export PPTX,
   `POST /api/sync/trigger/requests?force=true` puis re-check des KPIs.

**Rollback : retirer le flag + restart.** reports.db sqlite n'a pas bougé ;
perte = écritures post-bascule (sessions, éditions de rapports, sync) — d'où
la fenêtre creuse + un re-sync Zoho après retour.

## 6. Phase 5 — Consolidation

- Ajouter un `pg_dump` planifié de `sdp_dashboard` (Task Scheduler ou intégré à
  `_sdp_admin.cmd` backup — les restore points 4MyPeople ne couvrent QUE fmp_v2).
- Après un mois stable : les fichiers `.db` deviennent des archives (les garder).

---

## 7. Risques & parades

| Risque | Parade |
|---|---|
| Mot de passe postgres prod inconnu | Arbre §1 — l'installeur 4MyPeople sait toujours le réinitialiser |
| L'installeur 4MyPeople re-standardise `postgres` plus tard | Sans effet : le dashboard vit en `sdp_app` |
| Upgrade/reinstall 4MyPeople | Audité : DROP scopé à fmp_v2/fmp_app ; sdp_dashboard intact (prouvé 3× le 2026-07-09) |
| npm install accidentel sur le prod | Interdit — le driver pg arrive par xcopy (§2.2) |
| Écritures perdues au rollback | Fenêtres creuses + re-sync Zoho (hot data) ; tracker/meetings = re-copie manuelle possible |
| Service PG arrêté = modules flippés HS | `_sdp_admin.cmd` option 8 le détecte ; rollback flag possible à tout moment |

## 8. Calendrier suggéré

| Semaine | Action |
|---|---|
| S0 (dev) | Fix des 9 lecteurs + reconcile 21/21 (Claude) |
| S0 (prod) | Phase 1 (pré-requis, sans impact) |
| S1 | Phase 2 tracker + observation |
| S2 | Phase 3 meetings + inspection + observation |
| S3-S4 | Phase 4 reports.db (si gates verts) |
| S5+ | Phase 5 consolidation |
