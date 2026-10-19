# Dossier de conception — Étape 01 — Synchronisations fiables et observables

Version 1 · 2026-10-19 · Auteur : agent IA · Relecteur : présidence du comité · Designer : — (écran admin existant étendu)
Référence : SDP-DASH-2.0-ETUDE v1.2, §6.3 étape 1, lacunes L1 et L2.

> **Statut : implémenté, en attente de réception.** Les points d'arbitrage du §12 ont été tranchés
> par défaut sur l'option recommandée (règle §6.5 « hors arbitrage, l'agent choisit l'option
> recommandée et la documente »). Chaque valeur est un réglage : le comité peut la changer sans code.

## 1. Objectif et périmètre

Un moteur unique pour toutes les tâches planifiées : verrou, rejeu, journal, santé, alertes, garde
anti-suppression massive. **Écarts avec la fiche :**

| Demandé par la fiche | Réalisé | Écart |
|---|---|---|
| Verrou de chevauchement, rejeu exponentiel avec `Retry-After`, classification des erreurs | oui | — |
| Journal `sync_runs`, santé `/api/sync/health`, écran « Santé des synchronisations » | oui | — |
| Miroir des échecs dans le journal système, alerte après 2 échecs ou péremption | oui | — |
| Garde anti-vide / export tronqué | oui | appliquée à la **suppression** (réconciliation), là où le risque se matérialise |
| Filtre « modifié depuis » (watermark) côté Zoho, charge ÷ 5 à 10 | **non** | l'export CSV d'Analytics Plus n'a pas de filtre serveur ; le delta côté client existait déjà pour les tickets. Nécessite une vue Analytics filtrée ou l'API SDP v3 → RFI à ouvrir |
| Gestion du 429 Meraki | partielle | le runner rejoue un 429 qui remonte en exception ; les collecteurs Meraki qui avalent l'erreur en interne ne la remontent pas |
| Sauvegarde dans le runner | **non** | les sauvegardes passent par le Planificateur Windows (`Manage-SDP.ps1`) ; à rapatrier à l'étape 2 |
| « 7 familles + sauvegarde » | 14 tâches | toutes les lignes `cron.schedule` de `server.js` (y compris caches et jeton) |

## 2. Existant touché

- `server.js` : les 14 `cron.schedule` sont remplacés par `services/sync/schedule.js` ; les déclencheurs
  manuels passent par le runner (409 si la tâche tourne déjà) ; 3 routes nouvelles.
- `reports-db.js` : les 6 réconciliateurs (sqlite + pg) appellent la garde ; `015_sync_runs.sql` appliqué au démarrage.
- `services/reportConfig.js` : 3 clés d'alerte (désarmées).
- `public/system-logs.html` : onglet « Sync health ».
- Inchangés : planifications (mêmes horaires), `zoho-sync.js`, `assets-sync.js`, collecteurs Meraki/OpManager/Teams.

## 3. Modèle de données

`sync_runs(run_id PK, job_key, run_trigger, started_at, finished_at, status ok|error|skipped|overlap,
attempts, duration_ms, error, detail)` — purge à 30 jours.
`sync_job_state(job_key PK, last_status, last_run_at, last_ok_at, last_error, consecutive_failures,
failure_alerted_at, stale_alerted_at)`.
DDL idempotent (sqlite à la volée, pg `CREATE TABLE IF NOT EXISTS`). Retour arrière : les tables peuvent
rester ; revenir au commit précédent restaure les `cron.schedule`.

## 4. API et contrats

| Route | Rôle | Réponse |
|---|---|---|
| `GET /api/sync/health` | admin+ | `{jobs[], summary, server_time, alerts}` ; statut par tâche `ok·running·idle·stale·error·never` |
| `GET /api/sync/runs?job=&limit=` | admin+ | 40 derniers passages |
| `POST /api/sync/run/:key` | admin+ | 404 inconnue, 409 en cours, sinon lancement |
| `GET /api/sync/status`, `POST /api/sync/trigger/*` | inchangés | contrat conservé |

## 5. Écran

System Logs ▸ 🔄 Sync health : 4 compteurs, réglages d'alerte, tableau des tâches (cliquer une ligne
filtre les passages), « Run now ». Écran super_admin existant étendu, mêmes composants.

## 6. Règles métier

- Une erreur est **transitoire** si réseau, 408/425/429/5xx ou « timeout » ; seule une erreur transitoire est rejouée.
- Un résultat `{skipped}` (intégration non configurée) n'est pas un échec : état **idle**.
- Un résultat `{error}` (collecteurs qui ne lèvent pas) est un échec.
- Alerte : une par série d'échecs, une par épisode de péremption, avis de rétablissement.
- Une URL de webhook n'apparaît jamais dans un passage, un journal ou une alerte.
- Garde : une réconciliation qui supprimerait plus de 20 % d'une table (et plus de 5 lignes) est refusée ; rien n'est supprimé.

## 7. Plan de tests

`tests/sync-runner.test.js` (10, purs), `tests/sync-health-routes.smoke.test.js` (6, application démarrée sur sqlite),
`tests/pg-sync-runs.test.js` (parité PostgreSQL : journal, état, statistiques, purge, garde).

## 8. Migration

Aucune donnée migrée. Au premier démarrage, l'historique `sync_metadata` des tâches existantes est
fusionné dans la santé ; les tâches de nuit apparaissent « never » jusqu'à leur premier passage.

## 9. Sécurité

Routes admin+ derrière session ; aucun secret journalisé (filtre `url|token|secret|key` sur le détail).

## 10. Exploitation

Redémarrage pm2 requis (server.js + system-logs.html en cache). Réglages : `SYNC_TRUNCATION_TOLERANCE_PCT`
(20), `SYNC_ALERT_AFTER_FAILURES` (2), `SYNC_RUN_RETENTION_DAYS` (30) dans `.env` ; destinataires et armement dans l'écran.

## 11. Risques

- Une vraie suppression massive dans Zoho (> 20 %) sera bloquée : il faudra relever la tolérance le temps d'un passage.
- Les tâches toutes les 5 minutes écrivent ~860 lignes/jour dans `sync_runs` (purgées à 30 jours, ~26 000 lignes).

## 12. Points d'arbitrage (option retenue par défaut en gras)

| N° | Point | Options | Retenu |
|---|---|---|---|
| DEC-2026-001 | Tolérance de troncature | 10 % · **20 %** · 30 % | 20 % |
| DEC-2026-002 | Seuil d'alerte | 1 · **2** · 3 échecs consécutifs | 2 |
| DEC-2026-003 | Fenêtres de fraîcheur | **3 h / 30 h / 1 h** (horaire / nuit / 5 min) | 3 h / 30 h / 1 h |
| DEC-2026-004 | Destinataires et canal | e-mail IT Ops + **canal Teams par défaut** | à saisir à l'écran (désarmé) |
| — | Rétention du journal | **30 jours** · 90 jours | 30 jours |

## 13. Critères de réception

| Critère | État |
|---|---|
| 100 % des tâches visibles dans la santé | ✅ 14/14 (test smoke) |
| Un export tronqué simulé ne supprime rien | ✅ sqlite et PostgreSQL (tests) |
| Alerte reçue lors d'un échec provoqué | ⏳ mécanisme testé ; envoi réel à faire après armement en production |
| Succès ≥ 99 % sur 4 semaines | ⏳ mesurable 4 semaines après la mise en production (colonne « Success 28 d ») |
| Parité PostgreSQL verte | ✅ |
