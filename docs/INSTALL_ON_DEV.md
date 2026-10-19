# Réinstaller le SDP Dashboard sur le système dev 4MyPeople

Clone complet **code + toutes les données** de la prod vers un environnement dev
(cluster PostgreSQL 4MyPeople déjà présent, Windows).

> ⚠️ Le clone contient les vraies données : comptes/auth (`users`), tickets avec
> PII, verbatims. **Le dev doit être protégé comme la prod.** Le `.env` dev utilise
> des identifiants DEV — ne jamais recopier les secrets prod (tokens Zoho, secret de
> session, SMTP) tels quels.

---

## Le package (3 morceaux)

| Morceau | D'où il vient | Contient |
|---|---|---|
| **1. Code** | `sdp-dashboard-code.zip` (fourni) | Toute la source committée. **Pas** de `node_modules`, `.env`, ni `data/`. |
| **2. Dump PG** | à générer sur la **prod** (ci-dessous) | Schéma + **toutes les données** des 78 tables (reports, tracker, meetings, inspection, assets, auth). |
| **3. Blobs** | à zipper sur la **prod** (ci-dessous) | Photos/signatures d'inspection — **PAS dans le dump PG**, sur le disque. |

### Générer 2 et 3 sur la PROD (`C:\Apps\SDP-Dashboard`)

```bash
:: 2 — dump complet (schéma + données), lit PG_URL depuis .env, sans mot de passe en clair
node tools/pg/dump-db.js sdp_dashboard_full.sql

:: 3 — blobs d'inspection (s'ils existent)
powershell -c "if (Test-Path data\blobs) { Compress-Archive data\blobs data-blobs.zip -Force }"

:: compresser le dump avant transfert (il fait plusieurs centaines de Mo en SQL brut)
powershell -c "Compress-Archive sdp_dashboard_full.sql sdp_dashboard_full.zip -Force"
```

Transférer `sdp-dashboard-code.zip` + `sdp_dashboard_full.zip` + `data-blobs.zip`
vers le dev **par un canal sécurisé** (ils contiennent auth + PII).

---

## Installation sur le dev

### 0. Prérequis (déjà là via 4MyPeople)
- **PostgreSQL 17** (cluster 4MyPeople sur `:5432`) — `pg_dump`/`psql` dans `C:\Program Files\PostgreSQL\17\bin`.
- **Node.js** + **pm2** (`npm i -g pm2` si absent).
- **Python 3.12** (pour l'export PPTX `render.py`) — optionnel si tu n'exportes pas de deck.

### 1. Déployer le code
```bash
mkdir C:\Apps\SDP-Dashboard-dev
:: dézipper sdp-dashboard-code.zip dans ce dossier
:: dézipper data-blobs.zip -> C:\Apps\SDP-Dashboard-dev\data\blobs
```

### 2. Dépendances Node
Le plus fiable sur Windows (évite la recompilation `better-sqlite3` C++20) :
**recopier `node_modules\` depuis un poste qui marche déjà** (même Windows/Node) :
```bash
xcopy "C:\Apps\SDP-Dashboard\node_modules" "C:\Apps\SDP-Dashboard-dev\node_modules" /E /I /Y
```
Sinon `npm install` — et si `better-sqlite3` casse, lancer `_recover_better_sqlite3_prod.cmd`.

### 3. Base de données dev
Provisionner une base dédiée dans le cluster 4MyPeople (**ne jamais toucher `fmp_v2`**) —
via `_sdp_admin.cmd` option **P** (provisioning PG), ou à la main :
```bash
set PGPASSWORD=<mot de passe superuser postgres du cluster 4MyPeople>
"C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -h localhost -c "CREATE DATABASE sdp_dashboard;"
"C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -h localhost -c "CREATE USER sdp_app WITH PASSWORD '<mdp_dev>';"
"C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -h localhost -c "GRANT ALL ON DATABASE sdp_dashboard TO sdp_app;"
```

### 4. Restaurer le dump
```bash
:: dézipper sdp_dashboard_full.zip d'abord
"C:\Program Files\PostgreSQL\17\bin\psql.exe" "postgres://sdp_app:<mdp_dev>@localhost:5432/sdp_dashboard" -f sdp_dashboard_full.sql
```

### 5. Créer le `.env` dev
Copier `tools/installer/env.template` → `.env` à la racine et remplir avec des
**valeurs dev** :
```
PORT=3456
NODE_ENV=production
PG_URL=postgres://sdp_app:<mdp_dev>@localhost:5432/sdp_dashboard
REPORTS_BACKEND=postgres
TRACKER_BACKEND=postgres
MEETINGS_BACKEND=postgres
INSPECTION_BACKEND=postgres
ASSETS_BACKEND=postgres          # ← PAS dans le template : à ajouter pour lire les assets sur PG
DASH_USER=... DASH_PASS=...       # identifiants dashboard dev
# Zoho : ne mets les tokens QUE si tu veux la sync live en dev. Sinon laisse vide —
# l'app tourne sur les données restaurées (la sync échoue proprement, sans casser l'UI).
ZOHO_CLIENT_ID= ZOHO_CLIENT_SECRET= ZOHO_REFRESH_TOKEN=
```
> **`ASSETS_BACKEND=postgres` est obligatoire** pour ce clone : sans lui, le module
> Assets retombe sur SQLite (vide) et l'onglet est vide alors que la donnée est dans PG.

### 6. Démarrer
```bash
cd C:\Apps\SDP-Dashboard-dev
pm2 start server.js --name sdp-dashboard-dev --node-args="--max-old-space-size=4096"
pm2 save
```
Ouvrir `http://localhost:3456`. Ctrl+F5.

---

## Vérification
```bash
node tools/pg/check-assets-age.js HOUNDE   :: doit montrer les mêmes chiffres que la prod
```
Compter quelques tables (`request_records`, `users`, `insp_inspections`) et comparer
à la prod. Les photos d'inspection s'affichent = blobs bien restaurés.

## Notes
- **Sync Zoho** : en dev, laisse-la désarmée (tokens vides) sauf besoin — sinon le dev
  tape la vraie API Zoho et peut déclencher le rate-limit OAuth partagé avec la prod.
- **Le `.git`** n'est pas dans l'archive (source seulement). Si tu veux l'historique,
  clone le repo à la place du zip.
- **Les `.db` SQLite** (`data/*.db`) ne sont PAS nécessaires — tout tourne sur PG. Ce
  sont des archives gelées d'avant le cutover.
