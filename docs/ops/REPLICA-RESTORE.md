# Réplica PostgreSQL et exercice de restauration — SDP Dashboard 2.0

Version 1 · 2026-10-19 · Public : exploitant / administrateur · Étape 10 (§9.11 de l'étude 08). Complète `EXPLOITATION.md` (sauvegarde nocturne `db.backup`, 03:00, rétention 14, gzip + AES-256-GCM `SDP_BACKUP_KEY`) et `INSTALLATION.md`.

## 1. Objectif et cibles
- **RPO ≤ 15 min** : au plus 15 minutes de saisies perdues en cas de perte du serveur principal. La sauvegarde nocturne seule donne un RPO de 24 h ; la réplication en flux le ramène sous 15 min.
- **RTO ≤ 2 h** : la plateforme répond de nouveau en moins de deux heures, sur le réplica promu ou sur un serveur restauré.
- **Exercice de restauration trimestriel** (§7) : une restauration qui n'a jamais été jouée n'est pas une sauvegarde.

## 2. Architecture retenue
Réplication **physique en flux** (streaming replication) PostgreSQL 16 : un **primaire** (le serveur de production) et un **réplica chaud en lecture seule** sur une seconde machine (ou un second site). Aucun composant tiers : `pg_basebackup`, un emplacement de réplication (*replication slot*) et un fichier `standby.signal`. Le dashboard n'écrit que sur le primaire (`PG_URL`) ; le réplica sert la bascule et, en option, les lectures lourdes de l'export OData (`PG_URL_RO`, non câblé à ce jour — point d'arbitrage).

```
 primaire (PG_URL)  ──WAL en flux (slot sdp_replica)──►  réplica (hot standby, lecture seule)
        │                                                        │
        └── db.backup 03:00 → <data>/backups/*.sql.gz.enc (14 j)    └── promotion manuelle : pg_ctl promote
```

## 3. Mise en place (une fois, sur le primaire)
```sql
-- 1. rôle de réplication (mot de passe transmis par le gestionnaire de secrets, jamais sur une ligne de commande)
CREATE ROLE sdp_replicator WITH REPLICATION LOGIN PASSWORD '<secret>';
-- 2. emplacement : le primaire garde les WAL tant que le réplica ne les a pas lus
SELECT pg_create_physical_replication_slot('sdp_replica');
```
`postgresql.conf` (primaire) : `wal_level = replica`, `max_wal_senders = 5`, `max_replication_slots = 5`, `wal_keep_size = 1GB`. `pg_hba.conf` : `host replication sdp_replicator <ip-replica>/32 scram-sha-256`. Redémarrer PostgreSQL (fenêtre de maintenance : arrêt pm2 → PostgreSQL → démarrage, jamais `pm2 reload`).

## 4. Initialisation du réplica (sur la seconde machine)
```cmd
set PGPASSWORD=<secret>
pg_basebackup -h <ip-primaire> -U sdp_replicator -D "C:\PG\data" -R -S sdp_replica -X stream -C -P
```
`-R` écrit `standby.signal` et `primary_conninfo` ; `-S` attache l'emplacement ; `-X stream` copie les WAL pendant la copie. Démarrer le service PostgreSQL du réplica. Vérification : sur le primaire `SELECT client_addr, state, sent_lsn, replay_lsn, replay_lag FROM pg_stat_replication;` → `state = streaming`, `replay_lag` de l'ordre de la seconde.

## 5. Surveillance du RPO
- Primaire : `SELECT now() - pg_last_xact_replay_timestamp()` **sur le réplica** = retard de rejeu ; alerte si > 5 min (seuil de confort, RPO 15 min).
- `/api/sync/health` (dashboard) suit déjà les tâches ; la tâche `db.backup` y figure. Le retard de réplication est à surveiller par la supervision d'infrastructure (OpManager) : requête ci-dessus ou `pg_stat_replication` vide = réplica détaché.
- Un emplacement sans réplica attaché **fait grossir les WAL** du primaire sans limite : supprimer l'emplacement (`SELECT pg_drop_replication_slot('sdp_replica')`) si le réplica est abandonné.

## 6. Bascule (perte du primaire)
1. Confirmer la perte (pas de reprise sous 15 min) ; noter l'heure (RPO réel = dernier `replay_lsn`).
2. Sur le réplica : `pg_ctl promote -D "C:\PG\data"` → il devient primaire en écriture.
3. Sur le serveur applicatif (ou le réplica s'il héberge aussi Node) : pointer `PG_URL` vers le nouveau primaire dans `.env` ; **la même `SDP_CONFIG_KEY`** que la production (sinon les secrets chiffrés se lisent vides) ; `pm2 stop` → attendre → `pm2 start`.
4. Vérifier : connexion, `/api/sync/health`, une saisie de test, l'application terrain (`/field/`) qui rejoue sa file d'attente : les enveloppes déjà appliquées répondent `duplicate`, celles perdues avec le primaire (fenêtre RPO) sont **rejouées depuis les téléphones** — c'est précisément l'intérêt de la file hors-ligne.
5. Reconstruire un nouveau réplica depuis le nouveau primaire (§4) dès que possible.

## 7. Exercice de restauration (trimestriel, instance TEST)
| # | Geste | Preuve attendue |
|---|---|---|
| 1 | Prendre la dernière sauvegarde `<data>/backups/sdp_dashboard-<date>.sql.gz` (tâche `db.backup`) | fichier < 24 h, trailer `-- PostgreSQL database dump complete` |
| 2 | Sur TEST : `dropdb sdp_dashboard_test && createdb sdp_dashboard_test` puis `gunzip -c <dump> \| psql sdp_dashboard_test` | aucune erreur ; `\dt` liste `field_outbox`, `tracker_definitions`, `dashboard_definitions`… |
| 3 | Démarrer l'instance TEST avec `PG_URL` vers cette base et la **même** `SDP_CONFIG_KEY` | boot propre, migrations déjà appliquées (`db/migrate.js` ne rejoue rien) |
| 4 | Lire : un tableau de bord publié, un tracker, le journal `system_log` du jour précédent | chiffres identiques à la production à l'heure du dump |
| 5 | Chronométrer | RTO mesuré ≤ 2 h ; consigner date, durée, écarts dans `docs/ops/restore-log.md` (à créer au premier exercice) |

Un exercice échoué est un incident de sévérité 2 (voir `INCIDENT-RESPONSE.md`) : il bloque toute mise en production jusqu'à correction.

## 8. Points d'arbitrage
1. **Emplacement du réplica** : seconde machine du même site (RTO court, pas de protection site) ou site distant (RPO 15 min tenu si la liaison WAN le permet — mesurer `replay_lag` une semaine avant de décider) — défaut proposé : même site, puis distant à l'étape suivante.
2. **Lectures sur le réplica** (`PG_URL_RO` pour l'OData/Power BI) : non câblé ; à faire si les exports pèsent sur le primaire.
3. **Automatiser la promotion** (Patroni / repmgr) : refusé pour l'instant — une bascule manuelle documentée vaut mieux qu'un basculement automatique non maîtrisé sur une seule paire.
