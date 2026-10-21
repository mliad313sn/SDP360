# Installation de SDP Dashboard 2.0 (Windows Server)

Version 1 · 2026-10-19 · Public : administrateur système · Durée cible : **moins de 20 minutes** sur une machine propre.

## 1. Ce qui est livré

| Artefact | Rôle |
|---|---|
| `SDP-Dashboard-Setup-<version>.exe` | Assistant graphique (7 écrans). Installe, met à jour ou répare. Signé par la CI quand le certificat de signature est configuré (`dist/SIGNING.txt` le dit). |
| `sdp-dashboard-<version>.zip` + `.sha256` + `manifest.json` | Le **paquet de mise à jour** : tous les fichiers d'exécution avec leur empreinte SHA-256. C'est le même paquet que l'assistant embarque — installation et mise à jour ne peuvent pas diverger. |
| `tools/sdp-manager.js` | Le moteur du Manager (état, sauvegarde, vérification, mise à jour, retour arrière, bundle de support). |

Prérequis machine : Windows Server 2019+ (ou Windows 10/11), 4 Go de RAM libres, 10 Go de disque, Node.js 22 (installé par l'assistant si absent), PostgreSQL 17 embarqué **ou** un serveur PostgreSQL 13+ existant. IIS avec ARR est recommandé devant le port applicatif (voir `docs/INTERNAL_TLS_SETUP.md`).

## 2. Les sept écrans de l'assistant

1. **Bienvenue et licence.**
2. **Détection** — l'assistant lit `manifest.json` du dossier cible : version installée, ou « installation antérieure à 2.0 », ou rien.
3. **Mode** — *Nouvelle installation* · *Mise à jour* (sauvegarde d'abord, retour arrière automatique en cas d'échec) · *Réparation* (ré-applique la même version, conserve données et réglages). Le mode proposé découle de la détection.
4. **Dossiers et port** — dossier des données (`data\`), dossier des sauvegardes (hors du dossier applicatif), port HTTP (1024-65535, 3456 par défaut). Les données ne sont **jamais** dans un paquet : une mise à jour ne les touche pas.
5. **PostgreSQL** — *embarqué 17* (recommandé sur un serveur dédié) ou *existant* : hôte, port, base, rôle applicatif, mot de passe superutilisateur (saisi masqué, utilisé une fois pour créer le rôle et la base, jamais écrit sur disque). Écran sauté en mise à jour / réparation.
6. **Service et TLS** — compte de service (vide = LocalSystem), empreinte du certificat TLS pour IIS (optionnel).
7. **Résumé puis progression** — le journal est écrit dans `<install>\logs\setup-<horodatage>.log`.

## 3. Ce que fait l'assistant (tools/installer-v2/post-install.js)

1. **Mise à jour seulement** : `sdp-manager backup` (pg_dump dans le dossier des sauvegardes).
2. `sdp-manager update <paquet>` : vérification du manifeste (une seule empreinte fausse = paquet refusé), **point de retour arrière** `<install>\.rollback\<version précédente>\`, copie des fichiers. Un retour de version est refusé (passer par *Rollback*).
3. `.env` : créé en *nouvelle installation* (clé `SDP_CONFIG_KEY` générée, clé d'API interne `DASHBOARD_API_KEY` générée — 64 caractères hexadécimaux, **minimum 32 exigé en production**, le serveur refuse de démarrer sans elle et ne dérive plus de clé de secours —, compte d'amorçage `admin` avec mot de passe aléatoire, `PG_URL`, `NODE_ENV=production`, tous les modules sur PostgreSQL) ; **conservé** sinon (seules les clés manquantes sont ajoutées). L'assistant console (`Install-SDP.ps1`, option E) génère la même clé et remplace une valeur existante trop courte.
4. Rôle et base PostgreSQL (nouvelle installation) — SQL passé sur l'entrée standard, mot de passe par `PGPASSWORD`, rien sur une ligne de commande.
5. `npm ci --omit=dev`, puis le migrateur `node db\migrate.js` (journal `schema_migrations`).
6. Pare-feu Windows (`netsh advfirewall`) : deux règles sur le port de l'application — **autoriser** TCP `<port>` depuis `127.0.0.1` seulement, **bloquer** depuis toute autre adresse (`SDP Dashboard <port> - loopback only` / `- block remote`). Non bloquant : un échec (droits insuffisants) est journalisé en avertissement avec la commande à rejouer en administrateur.
7. pm2 : enregistrement du processus `endeavour-dashboard` (`--max-old-space-size=4096`) ou redémarrage **stop → start** (jamais `reload`), `pm2 save`.
8. Sonde `GET /api/auth/config` (90 s). En cas d'échec après la copie : `sdp-manager rollback` puis sortie en erreur — l'ancienne version est de nouveau en place.

Les secrets saisis dans l'assistant transitent par des variables d'environnement (`SDP_SETUP_PGSUPERPASS`, `SDP_SETUP_SVCPASS`), jamais par les arguments (les journaux Windows gardent les lignes de commande).

## 4. Après l'installation

1. Ouvrir `http://localhost:<port>/`, se connecter avec `admin` et le `DASH_PASS` lu dans `.env`, **changer le mot de passe**.
2. Admin ▸ Sites, Users, Email, Microsoft SSO, Intégration API (Analytics, SDP) : voir l'aide §7 et §21.
3. Service Windows pm2 (démarrage automatique) : `npm i -g pm2-windows-service` puis `pm2-service-install -n pm2.exe` une fois par machine ; vérifier `sc query pm2.exe`.
4. IIS : site reverse-proxy vers `http://localhost:<port>`, certificat lié, `maxAllowedContentLength` ≥ 150 Mo, délai ARR 5 min (`docs/INTERNAL_TLS_SETUP.md`). **IIS est le seul point d'entrée** : Node écoute sur `127.0.0.1` (`BIND_HOST`, valeur par défaut, écrite dans `.env`) et le pare-feu n'ouvre `<port>` qu'à la boucle locale. Vérifier : `netstat -ano | findstr :<port> | findstr LISTENING` ne doit montrer que `127.0.0.1:<port>`. `BIND_HOST=0.0.0.0` reste possible, explicitement dans `.env`, uniquement sur une machine de laboratoire sans IIS — jamais en production.
5. Première sauvegarde : `node tools\sdp-manager.js backup`.

## 5. Installation scriptée (sans assistant)

```cmd
node tools\installer-v2\post-install.js --dir C:\Apps\SDP-Dashboard --package sdp-dashboard-2.0.0.zip ^
  --mode new --port 3456 --pg-host localhost --pg-port 5432 --db-name sdp_dashboard --db-user sdp_app
```
avec `SDP_SETUP_PGSUPERPASS` posé dans l'environnement de la session. Mode `update` ou `repair` pour les autres cas ; `--mode uninstall` retire le processus pm2 et **garde** données et sauvegardes.

## 6. Dépannage

| Symptôme | Cause probable | Geste |
|---|---|---|
| « package refused: corrupt … » | paquet altéré ou incomplet | re-télécharger, comparer avec le `.sha256` de la release |
| « downgrade … refused » | paquet plus ancien que l'installé | `sdp-manager rollback` si l'on veut revenir en arrière |
| Le service ne répond pas après la mise à jour | port occupé par un ancien processus | `netstat -ano | findstr :<port>`, `taskkill /F /PID <pid>` (jamais `/IM node.exe`), `pm2 start endeavour-dashboard` |
| « SDP_CONFIG_KEY is required in production » | `.env` sans clé | générer une phrase ≥ 16 caractères, redémarrer, ré-enregistrer les secrets dans Admin |
| Migrateur en erreur | droits insuffisants du rôle applicatif | le rôle doit être propriétaire de la base (`OWNER sdp_app`) |

Journal de référence : `<install>\logs\setup-*.log` ; `pm2 logs endeavour-dashboard --lines 200 --nostream`.
