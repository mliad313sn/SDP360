# Dossier de conception — Étape 01 — Synchronisations fiables et observables

Version 1 · 2026-10-19 · Auteur : agent IA · Relecteur : comité (à réceptionner) · Statut : **implémenté, en attente de réception**

## 1. Objectif et périmètre
Faire passer les 11 jobs planifiés (Zoho tickets / changements-CAB / enquête, parc, Meridian, OpManager, Meraki ×4, alertes SLA Teams) par le runner unique, bloquer la suppression massive sur export tronqué, rendre les échecs visibles et alerter. Hors périmètre : delta serveur Zoho (l'export CSV n'a pas de filtre de date — le delta reste côté client via `last_sync_at`), sauvegarde `pg_dump` (étape 2).

## 2. Existant touché
`server.js` (bloc cron remplacé par `services/sync/schedule.start`), `zoho-sync.js` (garde `assertNotTruncated` avant chaque réconciliation), `reports-db.js` (`countTable`), `services/merakiClient.js` (statut HTTP conservé sur l'erreur → 429/5xx classés transitoires), `services/reportConfig.js` (4 clés), `routes/sync.js` (santé fusionnée), `public/system-logs.html` (onglet « Sync health »).

## 3. Modèle de données
Aucune nouvelle table : `sync_runs` / `sync_watermarks` / `sync_locks` existantes. État de dédoublonnage des alertes dans `sync_watermarks` (`alert:fail:<job>`, `alert:stale:<job>`). `sync_metadata` conservée (lue par `/api/sync/status` et le cursor incrémental) et **fusionnée** dans la vue santé.

## 4. API
`GET /api/sync/health` → `{summary:{ok,stale,error,never,idle}, jobs:[{job,status,last_ok,last_error,freshness_hours,optional,stale_hours,errors,source}]}`. `GET /api/sync/runs` inchangé.

## 5. Écrans
System Logs ▸ onglet « 🔄 Sync health » (tableau santé + 30 derniers runs). Pas de nouvelle page.

## 6. Règles métier
- Un job est **stale** si son dernier succès est plus vieux que sa fenêtre déclarée (`FRESHNESS_HOURS`) ; **idle** si optionnel (intégration non configurée) et jamais exécuté.
- Garde anti-troncature : une extraction plus petite que la table locale de plus de 20 % (clé `sync_truncation_tolerance_pct` / env `SYNC_TRUNCATION_TOLERANCE_PCT`) est refusée et rejouée.
- Alerte d'échec après **2 échecs consécutifs**, une fois par série ; alerte de fraîcheur une fois par 24 h ; rien n'est envoyé tant que `sync_alert_recipients` et `sync_alert_teams_url` sont vides.

## 7. Tests
`sync-jobs-registry` (8), `zoho-sync-truncation-guard` (3), `sync-schedule` (1), `sync-routes.smoke` (+2), existants `sync-runner` (14), `sync-store-sqlite` (3). Suite complète : 2 293 pass, 5 échecs préexistants (PowerShell ×3, fuseau/pptx ×2). **Parité PostgreSQL de `countTable` et du store : à exécuter en CI à l'étape 2** (service PG).

## 8. Migration
Aucune donnée migrée. Au premier démarrage, les jobs historiques apparaissent via `sync_metadata` (source `legacy`) puis via `sync_runs`.

## 9. Sécurité
URL de webhook Teams = secret (redaction GET, blank-keep). Aucune clé dans les logs (`scrub`).

## 10. Exploitation
Admin ▸ Config : `sync_alert_recipients`, `sync_alert_teams_url`, `sync_alert_enabled`. Redémarrage requis (server.js).

## 11. Risques
Faux positifs de troncature sur une purge Zoho massive légitime (> 20 %) → relever la tolérance temporairement. Les wrappers « legacy » n'ont pas de garde anti-vide propre (les jobs Zoho ont la garde de troncature, le parc sa garde interne).

## 12. Points d'arbitrage (défauts appliqués, à confirmer)
1. Tolérance de troncature 20 % — **recommandé**.
2. Seuil d'alerte : 2 échecs consécutifs — **recommandé** (1 = bruit sur un 503 isolé).
3. Fenêtres de fraîcheur : 3 h (Zoho), 30 h (nocturnes), 1 h (5 min) — **recommandé**.
4. Destinataires des alertes : à renseigner par l'administrateur.

## 13. Critères de réception
- [x] 100 % des jobs planifiés visibles dans `/api/sync/health` (test smoke).
- [x] Un export tronqué simulé ne supprime aucune ligne (test de garde).
- [x] Alerte émise sur échec provoqué (test schedule).
- [ ] Succès ≥ 99 % sur 4 semaines en production (mesure après déploiement).
- [ ] Parité PostgreSQL en CI (étape 2).
