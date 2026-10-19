# Dossier de conception — Étape 02 — PostgreSQL seul, migrateur de schéma, CI à parité

Version 1 · 2026-10-19 · Auteur : agent IA · Relecteur : comité · Statut : **implémenté (socle), retrait des forks SQLite en cours**

## 1. Objectif et périmètre
Un schéma versionné appliqué automatiquement (serveur, installateur, CI), la CI qui exécute la moitié PostgreSQL de la suite, la sauvegarde nocturne comme job observable, la copie du parc durcie. **Reste ouvert** : retrait des forks SQLite module par module (une PR chacune, ordre arbitré ci-dessous) et bascule effective du parc en production (geste opérateur).

## 2. Existant touché
`db/migrate.js` (nouveau), `server.js` (appel au démarrage), `.github/workflows/ci.yml` (service PostgreSQL 17, `PG_TESTS_REQUIRED=1`, migrateur sur base vierge), `services/backup.js` + job `db.backup` dans le registre, `tools/pg/copy-assets.js` (`--dry-run`, comptages avant/après), `db/postgres/reports/015_kpi_rag_policies.sql` (table déplacée depuis `tracker/002` : l'aire reports est appliquée d'abord et `016_dashboard_definitions` la référence), `reports-db.js` (`initPgReports` ferme un pool précédent), `tests/pg-helpers.js` (ferme les pools des modules avant `DROP DATABASE … FORCE`), `services/sendWeeklyReport.js` (minuterie de délai non `unref`), `tests/deploy-frozen-lots.test.js` (saut sans PowerShell).

## 3. Modèle de données
`schema_migrations (id, checksum, applied_at, duration_ms)`. Ordre : reports → tracker → meetings → inspection → assets → sync, puis nom de fichier. Un script modifié après application est signalé (`changed`) et ré-appliqué (scripts idempotents).

## 4. API / CLI
`node db/migrate.js` · `--status` · `--dry-run`. `node tools/pg/copy-assets.js [--dry-run]`. Job `db.backup` (02:00, `SDP_BACKUP_DIR`, `SDP_BACKUP_KEEP`).

## 5. Écrans
Aucun (le job de sauvegarde apparaît dans System Logs ▸ Sync health).

## 6. Règles métier
Aucune nouvelle table applicative sans script `db/postgres/<aire>/NNN_*.sql` idempotent ; la CI refuse une suite PostgreSQL sautée.

## 7. Tests
`pg-migrate` (2), `backup-job` (2) ; suite complète **2 449 pass / 0 fail / 11 skipped** (PostgreSQL 16 local, `PG_TESTS_REQUIRED=1`) après correction de trois échecs latents (fuite de pool `initPgReports` ×2, minuterie `unref` du délai PPTX) et saut motivé des trois tests PowerShell.

## 8. Migration
Première exécution sur une base existante : tous les scripts ré-appliqués sans effet et enregistrés. Parc : `copy-assets --dry-run` → copie → `ASSETS_BACKEND=postgres` → redémarrage ; retour arrière = retirer le drapeau.

## 9. Sécurité
Mot de passe PostgreSQL jamais sur une ligne de commande (`PGPASSWORD` enfant seulement) ; sauvegardes à chiffrer au repos (étape 4).

## 10. Exploitation
Dossier de sauvegarde par défaut `<data>/backups`, rétention 14. Exercice de restauration trimestriel : `docs/ops/RESTORE-DRILL.md` à rédiger à la première exécution réelle.

## 11. Risques
Script DDL non idempotent ajouté sans test → bloque le démarrage : le test `pg-migrate` rejoue deux fois. Retrait d'un fork SQLite sans parité testée → régression : une PR par module, suite PG requise.

## 12. Points d'arbitrage (défauts appliqués, à confirmer)
1. Ordre de retrait des forks : parc → tracker → inspections → réunions → rapports — **recommandé**.
2. Rétention des sauvegardes : 14 jours locaux + copie hors serveur hebdomadaire — **recommandé**.
3. Réplica en flux : étape 10.

## 13. Critères de réception
- [x] CI verte sur SQLite **et** PostgreSQL (migrateur exécuté sur base vierge).
- [x] Migrateur rejouable sans effet (test).
- [x] Sauvegarde = job observable avec rétention (test).
- [ ] Zéro SQLite en production (bascule du parc + retrait des forks : PR suivantes).
- [ ] Restauration testée sur instance jetable (geste opérateur, à documenter).
