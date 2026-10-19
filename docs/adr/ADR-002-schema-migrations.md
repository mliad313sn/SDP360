# ADR-002 — Le schéma PostgreSQL ne change que par le migrateur

Statut : accepté (étape 2 de SDP-DASH-2.0, 2026-10-19). Décision : DEC-2026-005 à 007 (dossier ETAPE-02).

## Contexte

Avant l'étape 2, chaque module (`reports`, `tracker`, `meetings`, `inspection`, `assets`) appliquait son schéma
à chaque démarrage : une série de `readFileSync(...sql)` plus des `ALTER TABLE` écrits directement dans le
code de `initPg*`. Rien ne disait quels scripts une base avait reçus ; un `ALTER` oublié dans un module
ne se voyait qu'en production.

## Décision

1. Tout le DDL PostgreSQL vit dans `db/postgres/<module>/NNN_nom.sql`, appliqué dans l'ordre des noms.
2. `db/migrate.js` est le seul chemin : appelé par chaque `initPg*`, par la CI et par l'installateur
   (`node db/migrate.js --status | --apply`). Journal `schema_migrations(module, filename, checksum, applied_at)`.
3. Tout script est **idempotent** (`IF NOT EXISTS`, `DO` gardé). Un script modifié est **ré-appliqué** et son
   checksum mis à jour (journalisé « reapplied ») — on n'écrit jamais un script qui casse s'il est rejoué.
4. Un script par transaction, sous verrou consultatif PostgreSQL : un serveur qui démarre et une commande
   `--apply` ne s'entrechoquent pas.
5. Les **données** de référence (listes, catalogues, rattrapages) restent dans le code des modules.
6. Le checksum ignore les fins de ligne (le poste Windows et la CI Linux doivent s'accorder).

## Conséquences

- Ajouter une colonne = ajouter un fichier `NNN_*.sql` (jamais un `ALTER` dans `initPg*` — un test statique le refuse).
- `001_init.sql` d'`assets` est partagé avec SQLite et doit rester sans `ALTER` ; les colonnes ajoutées vont
  dans `002_additive_columns.sql` (un test vérifie qu'il suit `_ADDED_COLS`).
- Une base existante reçoit tous les scripts au premier démarrage avec le migrateur : ils sont idempotents,
  donc sans effet, et le journal est rempli.
