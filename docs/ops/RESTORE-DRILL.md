# Exercice de restauration trimestriel — SDP-Dashboard

But : prouver, une fois par trimestre, qu'une sauvegarde chiffrée de la nuit se relit et se recharge.
Une sauvegarde qu'on n'a jamais restaurée n'est pas une sauvegarde. Durée : 20 minutes.

## Prérequis

- Le job `db.backup` tourne (System Logs ▸ Sync health : état **ok**, dernier succès < 30 h).
- `.env` de production : `SDP_BACKUP_DIR`, `SDP_BACKUP_KEY` (ou `SDP_CONFIG_KEY`). **La clé n'est jamais
  rangée avec les sauvegardes** : une copie papier ou dans le coffre de mots de passe de l'équipe.
- PostgreSQL 17 installé (fournit `psql.exe`).

## Étapes (sur le serveur, dans `C:\Apps\SDP-Dashboard`)

1. Choisir la sauvegarde la plus récente dans `SDP_BACKUP_DIR` (`sdp_dashboard_AAAAMMJJ-HHMMSS.sql.gz.enc`).
2. La déchiffrer :
   ```
   node tools\pg\restore-backup.js <dossier>\sdp_dashboard_<horodatage>.sql.gz.enc C:\Temp\drill.sql
   ```
   Un message « cannot decrypt » = mauvaise clé ou fichier abîmé → **incident à traiter**.
3. Créer une base jetable (jamais `sdp_dashboard`) :
   ```
   "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -c "CREATE DATABASE sdp_drill"
   ```
4. Charger la sauvegarde :
   ```
   "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -v ON_ERROR_STOP=1 -d sdp_drill -f C:\Temp\drill.sql
   ```
5. Contrôler quelques volumes et comparer à la production :
   ```
   psql -U postgres -d sdp_drill -c "SELECT COUNT(*) FROM request_records"
   psql -U postgres -d sdp_drill -c "SELECT COUNT(*) FROM weekly_reports"
   psql -U postgres -d sdp_drill -c "SELECT module, COUNT(*) FROM schema_migrations GROUP BY module"
   ```
6. Nettoyer : `DROP DATABASE sdp_drill;` et supprimer `C:\Temp\drill.sql` (données en clair).
7. Noter dans le registre : date, fichier restauré, volumes, durée, anomalies.

## Si la restauration est réelle (sinistre)

Restaurer dans `sdp_dashboard` uniquement après arrêt du service (`pm2 stop endeavour-dashboard`), en
passant par le point de restauration de l'outil d'administration (`_sdp_admin.cmd`, écran rouge de
confirmation). Ne jamais charger une sauvegarde par-dessus une base en service.
