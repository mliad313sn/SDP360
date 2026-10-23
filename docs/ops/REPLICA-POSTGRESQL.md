# Procédure — Réplica PostgreSQL (objectif : 15 minutes de données perdues au plus)

Étape 10 de SDP-DASH-2.0. Objectif de point de reprise (RPO) : **15 minutes**. La sauvegarde chiffrée de chaque
nuit (`db.backup`, étape 2) reste la protection de dernier recours ; le réplica réduit la perte possible de « une
journée » à « quelques secondes, 15 minutes au pire ».

> Les commandes ci-dessous sont à exécuter par l'administrateur des serveurs. Aucune n'est lancée par l'application.
> Les mots de passe sont saisis par l'administrateur et ne sont **jamais** écrits dans ce document ni dans un ticket.

## 1. Principe

- Un second serveur Windows (ou une seconde instance) porte un PostgreSQL 17 **en lecture seule**, alimenté en
  continu par la réplication en flux (*streaming replication*) du serveur principal.
- L'application continue d'écrire uniquement sur le principal (`PG_URL`).
- La tâche `db.replica_lag` (toutes les 5 minutes) mesure le retard du réplica et **échoue** — donc alerte, comme
  toute synchronisation en échec — s'il dépasse 15 minutes (`REPLICA_MAX_LAG_MIN`), si le réplica est injoignable ou
  s'il a quitté la lecture seule.

## 2. Sur le serveur principal

1. `postgresql.conf` :
   ```
   wal_level = replica
   max_wal_senders = 5
   max_replication_slots = 5
   wal_keep_size = 2GB
   ```
2. Créer un rôle de réplication (mot de passe saisi interactivement) :
   ```
   psql -U postgres -c "CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD NULL;"
   psql -U postgres -c "\password replicator"
   ```
3. Créer un emplacement de réplication (le principal garde les journaux tant que le réplica ne les a pas lus) :
   ```
   psql -U postgres -c "SELECT pg_create_physical_replication_slot('sdp_replica');"
   ```
4. `pg_hba.conf` : autoriser **uniquement** l'adresse du serveur réplica :
   ```
   host  replication  replicator  <IP_DU_REPLICA>/32  scram-sha-256
   ```
5. Redémarrer le service PostgreSQL du principal.

## 3. Sur le serveur réplica

1. Installer PostgreSQL 17 (même version mineure que le principal), arrêter le service, vider son dossier de données.
2. Copier le principal et écrire la configuration de réplica (`-R`) :
   ```
   pg_basebackup -h <IP_DU_PRINCIPAL> -U replicator -D "<DOSSIER_DONNEES>" -X stream -S sdp_replica -R -P
   ```
3. Démarrer le service. Vérifier sur le réplica : `SELECT pg_is_in_recovery();` → `true`.
4. Créer, **sur le principal** (il est répliqué), un rôle de lecture pour la surveillance :
   ```
   psql -U postgres -c "CREATE ROLE sdp_monitor LOGIN PASSWORD NULL;"
   psql -U postgres -c "\password sdp_monitor"
   psql -U postgres -c "GRANT pg_monitor TO sdp_monitor;"
   ```

## 4. Brancher la surveillance

Dans le `.env` du serveur applicatif (puis arrêt → attente → démarrage de pm2) :
```
PG_REPLICA_URL=postgresql://sdp_monitor:<mot de passe>@<IP_DU_REPLICA>:5432/<base>
REPLICA_MAX_LAG_MIN=15
```
Contrôle : System Logs ▸ Santé des synchronisations ▸ « PostgreSQL replica — lag » doit passer au vert. Tant que
`PG_REPLICA_URL` est vide, la tâche indique « no replica configured » sans erreur.

## 5. Bascule (le principal est perdu)

1. Constater la panne du principal (le service ne répond plus, pas seulement un arrêt programmé).
2. Sur le réplica : `psql -U postgres -c "SELECT pg_promote();"` — il devient principal, en écriture.
3. Sur le serveur applicatif : `PG_URL` pointe vers l'ancien réplica ; vider `PG_REPLICA_URL` ; arrêt → attente → démarrage de pm2.
4. Vérifier `/health`, la connexion, une page de saisie.
5. Reconstruire un nouveau réplica à partir du nouveau principal (§3) dès que possible.
6. Consigner la bascule (heure de la panne, heure de la reprise, perte constatée) dans `docs/ops/INCIDENT-RESPONSE.md`.

## 6. Exercice (critère de réception « RPO 15 min démontré »)

Une fois par trimestre, en même temps que l'exercice de restauration (`docs/ops/RESTORE-DRILL.md`) :
1. Noter l'heure, saisir une valeur témoin dans un tracker.
2. Mesurer le retard : la tâche `db.replica_lag` le journalise (`lag_seconds`).
3. Vérifier la présence de la valeur témoin sur le réplica (`SELECT …` en lecture seule).
4. Sur une **copie** du réplica (jamais le réplica de production) : `pg_promote()`, démarrer une instance de test
   de l'application dessus, constater les données.
5. Consigner : retard mesuré, perte constatée (doit être ≤ 15 minutes), durée de reprise.
