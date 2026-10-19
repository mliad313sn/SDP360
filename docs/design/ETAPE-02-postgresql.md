# Dossier de conception — Étape 02 — PostgreSQL seul, migrateur de schéma, CI complète

Version 1 · 2026-10-19 · Auteur : agent IA · Relecteur : présidence du comité
Référence : SDP-DASH-2.0-ETUDE v1.2, §6.3 étape 2, lacunes L5 et L6 (partiel). ADR : `docs/adr/ADR-002-schema-migrations.md`.

> **Statut : implémenté, en attente de réception.** Points d'arbitrage tranchés sur l'option recommandée (§12).

## 1. Objectif et périmètre — écarts avec la fiche

| Demandé | Réalisé | Écart |
|---|---|---|
| Migrateur `db/migrate.js`, journal `schema_migrations`, idempotent, au démarrage, par l'installateur et en CI | oui | l'installateur v2 (étape 5) l'appellera ; la commande existe dès maintenant |
| Bascule du parc vers PostgreSQL | outillée | `ASSETS_BACKEND=postgres` est un réglage de prod que l'agent ne voit pas ; la garde `REQUIRE_POSTGRES=1` empêche désormais tout démarrage avec un module en SQLite |
| Retrait des forks SQLite module par module | **non** (DEC-2026-005) | voir §12 : les forks sont le support des 2 400 tests ; « zéro SQLite en production » est garanti par la garde au démarrage |
| `ORDER BY` déterministes sur 9 lecteurs | **non** | l'étude ne nomme pas les 9 lecteurs ; un audit est nécessaire → RFI |
| GitHub Actions avec PostgreSQL, lint, couverture | oui | lint = contrôle de syntaxe sans dépendance (JS + scripts des pages) ; ESLint viendra avec l'étape 4 |
| Sauvegarde quotidienne chiffrée via le runner | oui | job `db.backup` 02:30, AES-256-GCM, désactivé tant que `SDP_BACKUP_DIR` n'est pas réglé |
| Exercice de restauration trimestriel documenté | oui | `docs/ops/RESTORE-DRILL.md` ; prouvé en test sur PostgreSQL (dump réel → chiffré → déchiffré → `psql` → 250 lignes) |

## 2. Existant touché

`reports-db.js`, `tracker-db.js`, `meetings-db.js`, `inspection-db.js`, `assets-db.js` (`initPg*` → migrateur ;
plus aucun DDL dans le code), 3 nouveaux scripts (`reports/016`, `meetings/002`, `assets/002`) qui reprennent mot
pour mot le DDL qui était dans le code, `server.js` (garde au démarrage, santé de la base), `services/sync/jobs.js`
(job `db.backup`), `public/system-logs.html` (ligne « Database »), `tests/deploy-frozen-lots.test.js` (3 tests
réservés au poste Windows).

## 3. Modèle de données

`schema_migrations(module, filename, checksum, applied_at)`. Au premier démarrage d'une base existante, les
24 scripts sont rejoués (sans effet : idempotents) et journalisés.

## 4. API

`GET /api/sync/health` gagne `database: { backends, sqlite[], require_postgres, migrations[{module, scripts, pending[]}] }`.
Commandes : `node db/migrate.js --status | --apply`, `node tools/pg/restore-backup.js <fichier.enc> <sortie.sql>`.

## 7. Tests

`schema-migrations.test.js` (6 : plan, découverte, pas de DDL dans `initPg*`, idempotence de tous les scripts,
`assets/002` suit `_ADDED_COLS`), `pg-schema-migrations.test.js` (base vide → tout appliqué, rejeu sans effet,
script modifié ré-appliqué), `db-backup.test.js` (6 : garde, chiffrement, pas de mot de passe en ligne de
commande, refus sans clé, dump vide/en échec, rétention), `pg-db-backup.test.js` (exercice de restauration réel).
Les 105 tests PostgreSQL existants passent par le migrateur.

## 10. Exploitation

À régler dans le `.env` de production :
- `REQUIRE_POSTGRES=1` — après avoir vérifié que les cinq `*_BACKEND` valent `postgres` (sinon le service ne
  démarre plus, avec le module fautif dans le message).
- `SDP_BACKUP_DIR=` un dossier hors de l'application (idéalement un autre disque), `SDP_BACKUP_KEY=` une phrase
  de 16 caractères ou plus **conservée hors des sauvegardes**, `SDP_BACKUP_RETENTION_DAYS=14`.

## 12. Points d'arbitrage (option retenue par défaut en gras)

| N° | Point | Options | Retenu |
|---|---|---|---|
| DEC-2026-005 | Forks SQLite | supprimer module par module (réécrire ~2 400 tests sur PostgreSQL) · **les garder pour les tests, interdire SQLite en production par la garde** | garder + garde |
| DEC-2026-006 | Sauvegardes | rétention **14 jours** / 30 jours · clé **hors sauvegarde** (`.env` + coffre) | 14 jours, clé hors sauvegarde |
| DEC-2026-007 | Réplica | maintenant · **à l'étape 10** (RPO 15 min, avec le terrain) | étape 10 |

## 13. Critères de réception

| Critère | État |
|---|---|
| Zéro SQLite en production | ⏳ outillé : à constater en production (ligne « Database » de Sync health) puis à verrouiller par `REQUIRE_POSTGRES=1` |
| CI verte sur les deux bases | voir le premier passage GitHub Actions (lien dans la PR / l'onglet Actions) |
| Migrateur rejouable sans effet | ✅ test PostgreSQL + étape CI dédiée |
| Restauration testée sur instance jetable | ✅ en test automatisé ; ⏳ premier exercice réel à faire en production (RESTORE-DRILL.md) |
