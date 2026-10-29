# Installation de SDP Dashboard 2.0 (Windows Server)

Version 2.1 · 2026-10-29 · Public : administrateur système · Durée cible : **moins de 20 minutes** sur une machine propre.

## 1. Ce qui est livré

| Artefact | Rôle |
|---|---|
| `SDP-Dashboard-Setup-<version>.exe` | Assistant moderne bilingue FR/EN, **entièrement hors ligne** (Node.js 22, dépendances Windows, service et Manager embarqués). Installe, met à jour, répare et désinstalle. Signé Authenticode par la CI quand le certificat de signature est configuré (`dist/SIGNING.txt` le dit : `Setup.exe signed: YES`). |
| `sdp-dashboard-<version>.zip` + `.sha256` + `manifest.json` | Le **paquet de mise à jour** : tous les fichiers d'exécution avec leur empreinte SHA-256, et un `manifest.json` **signé Ed25519** par la CI (`SIGNING.txt` : `manifest signed: YES`). C'est le même paquet que l'assistant embarque — installation et mise à jour ne peuvent pas diverger. Le Manager vérifie la signature avec la clé publique `tools\manifest-public.pem` **avant** d'écrire un fichier ; un paquet altéré est refusé, un paquet non signé aussi (sauf `--allow-unsigned`, journalisé). |
| **SDP Dashboard Manager** (menu Démarrer) | Console graphique de maintenance : vue d'ensemble, service (démarrer / arrêter / redémarrer), sauvegardes et **restauration avec phrase de confirmation**, mises à jour et retour arrière, diagnostic. Elle appelle `tools/sdp-manager.js`, utilisable aussi en ligne de commande. |
| Service Windows `SDPDashboard` | Démarrage automatique différé, relance automatique en cas d'arrêt (5/10/30/60 s), journal `logs\service-*.log`. Remplace pm2 sur une nouvelle installation (pm2 reste géré sur les serveurs existants). |

Prérequis machine : Windows Server 2019+ (ou Windows 10/11), 4 Go de RAM libres, 10 Go de disque, Node.js 22 (embarqué, rien à installer), PostgreSQL 17 embarqué **ou** un serveur PostgreSQL 13+ existant. IIS avec ARR est recommandé devant le port applicatif (voir `docs/INTERNAL_TLS_SETUP.md`).

## 2. Les écrans de l'assistant

Bienvenue · Licence · Dossier · **Ce que Setup a trouvé** (version installée ou rien) · **Mode** (nouvelle installation / mise à jour / réparation) · Avertissement « paquet non signé » (seulement si `manifest.json` n'est pas signé) · Données, sauvegardes et port · **PostgreSQL** (embarqué 17 ou serveur existant ; mot de passe superutilisateur saisi masqué, utilisé une fois, jamais écrit) · Compte de service (vide = LocalSystem) · **Adresse publique** (IIS, facultatif : nom d'hôte + empreinte du certificat) · Résumé · Progression · Fin (ouvrir le tableau de bord / le Manager).

Le journal est écrit dans `<install>\logs\` (`setup-last.json` résume la dernière exécution).

## 3. Ce que fait l'assistant (tools/installer-v2/post-install.js)

1. **Mise à jour seulement** : `sdp-manager backup` (pg_dump dans le dossier des sauvegardes).
2. `sdp-manager update <paquet>` : vérification du manifeste (une seule empreinte fausse = paquet refusé), **point de retour arrière** `<install>\.rollback\<version précédente>\`, copie des fichiers. Un retour de version est refusé (passer par *Rollback*).
3. `.env` : créé en *nouvelle installation* (clé `SDP_CONFIG_KEY` générée, clé d'API interne `DASHBOARD_API_KEY` générée — 64 caractères hexadécimaux, **minimum 32 exigé en production**, le serveur refuse de démarrer sans elle et ne dérive plus de clé de secours —, compte d'amorçage `admin` avec mot de passe aléatoire, `PG_URL`, `NODE_ENV=production`, tous les modules sur PostgreSQL) ; **conservé** sinon (seules les clés manquantes sont ajoutées). L'assistant console (`Install-SDP.ps1`, option E) génère la même clé et remplace une valeur existante trop courte.
4. Rôle et base PostgreSQL (nouvelle installation) — SQL passé sur l'entrée standard, mot de passe par `PGPASSWORD`, rien sur une ligne de commande.
5. `npm ci --omit=dev`, puis le migrateur `node db\migrate.js` (journal `schema_migrations`).
6. Pare-feu Windows (`netsh advfirewall`) : deux règles sur le port de l'application — **autoriser** TCP `<port>` depuis `127.0.0.1` seulement, **bloquer** depuis toute autre adresse (`SDP Dashboard <port> - loopback only` / `- block remote`). Non bloquant : un échec (droits insuffisants) est journalisé en avertissement avec la commande à rejouer en administrateur.
7. Service Windows `SDPDashboard` (ou pm2 si `--service pm2`) : installé ou redémarré **stop → attente → start** (jamais `reload`). IIS configuré si une adresse publique a été donnée (`iis-setup.ps1`, sans effet si IIS / URL Rewrite / ARR manquent : un avertissement le dit).
8. Sonde `GET /ready` (90 s). En cas d'échec après la copie : `sdp-manager rollback` puis sortie en erreur — Setup s'arrête, l'ancienne version est de nouveau en place, le journal est nommé.

Les secrets saisis dans l'assistant transitent par des variables d'environnement (`SDP_SETUP_PGSUPERPASS`, `SDP_SETUP_SVCPASS`), jamais par les arguments (les journaux Windows gardent les lignes de commande).

## 4. Après l'installation

1. Ouvrir `http://localhost:<port>/`, se connecter avec `admin` et le `DASH_PASS` lu dans `.env`, **changer le mot de passe**.
2. Admin ▸ Sites, Users, Email, Microsoft SSO, Intégration API (Analytics, SDP) : voir l'aide §7 et §21.
3. Service : `sc query SDPDashboard` doit dire `RUNNING` (démarrage automatique). Toute la maintenance passe ensuite par **SDP Dashboard Manager**.
4. IIS : site reverse-proxy vers `http://localhost:<port>`, certificat lié, `maxAllowedContentLength` ≥ 150 Mo, délai ARR 5 min (`docs/INTERNAL_TLS_SETUP.md`). **IIS est le seul point d'entrée** : Node écoute sur `127.0.0.1` (`BIND_HOST`, valeur par défaut, écrite dans `.env`) et le pare-feu n'ouvre `<port>` qu'à la boucle locale. Vérifier : `netstat -ano | findstr :<port> | findstr LISTENING` ne doit montrer que `127.0.0.1:<port>`. `BIND_HOST=0.0.0.0` reste possible, explicitement dans `.env`, uniquement sur une machine de laboratoire sans IIS — jamais en production.
5. Première sauvegarde : Manager ▸ Sauvegardes ▸ *Sauvegarder maintenant* (ou `runtime\node\node.exe tools\sdp-manager.js backup`).

### Clés de signature (une fois, côté CI — geste humain)

La chaîne est authentifiée de bout en bout seulement quand les trois secrets GitHub existent (Settings ▸ Secrets and variables ▸ Actions) :

| Secret | Contenu | Produit |
|---|---|---|
| `SIGNING_CERT_PFX_BASE64` | le certificat de signature de code (`.pfx`) encodé en base64 (`certutil -encode cert.pfx cert.b64`, coller sans les lignes BEGIN/END) | Setup.exe signé Authenticode |
| `SIGNING_CERT_PASSWORD` | le mot de passe du `.pfx` | — (transmis à `signtool` par variable d'environnement, jamais sur une ligne de commande ni dans `GITHUB_ENV`) |
| `SIGNING_MANIFEST_KEY` | la clé privée Ed25519 du manifeste, PEM PKCS8 | `manifest.json` signé |

Génération de la paire Ed25519 (sur un poste de confiance, la clé privée ne touche jamais le dépôt) :

```cmd
node -e "const c=require('crypto');const k=c.generateKeyPairSync('ed25519');require('fs').writeFileSync('manifest-private.pem',k.privateKey.export({type:'pkcs8',format:'pem'}));require('fs').writeFileSync('manifest-public.pem',k.publicKey.export({type:'spki',format:'pem'}))"
```

Coller `manifest-private.pem` dans le secret `SIGNING_MANIFEST_KEY`, puis **remplacer le bloc `PUBLIC KEY` de `tools\manifest-public.pem` dans le dépôt** par celui de `manifest-public.pem` (le fichier livré est un **placeholder** dont la clé privée a été détruite : tant qu'il n'est pas remplacé, aucun paquet ne peut être accepté comme signé). Un paquet signé par une clé qui ne correspond pas à la clé publique embarquée est refusé avec « signature made with another key ». La CI vérifie elle-même le paquet qu'elle vient de construire (`sdp-manager verify`), donc une clé publique périmée casse la release avant publication.

Sans ces secrets, la release est publiée **non signée** et `SIGNING.txt` le dit ; l'installation reste possible avec `--allow-unsigned` (voir §6 et `EXPLOITATION.md` §2).

## 5. Installation scriptée (sans assistant)

```cmd
node tools\installer-v2\post-install.js --dir C:\Apps\SDP-Dashboard --package sdp-dashboard-2.0.0.zip ^
  --mode new --port 3456 --pg-host localhost --pg-port 5432 --db-name sdp_dashboard --db-user sdp_app
```
avec `SDP_SETUP_PGSUPERPASS` posé dans l'environnement de la session. Mode `update` ou `repair` pour les autres cas ; `--mode uninstall` retire le service et les règles de pare-feu et **garde** données et sauvegardes. Préférer l'assistant en mode silencieux (`/VERYSILENT /MODE=new …`, voir `docs/INSTALLER-V2.md` §2). Un paquet dont le `manifest.json` n'est pas signé est refusé ; ajouter `--allow-unsigned` (transmis au Manager, qui journalise la décision dans `logs\sdp-manager.log`) uniquement pour un paquet dont l'origine a été vérifiée autrement (`.sha256` comparé à la page de release).

## 6. Dépannage

| Symptôme | Cause probable | Geste |
|---|---|---|
| « package refused: corrupt … » | paquet altéré ou incomplet | re-télécharger, comparer avec le `.sha256` de la release |
| « package refused: manifest signature invalid: … » | `manifest.json` modifié après signature, ou signé avec une autre clé que `tools\manifest-public.pem` | **ne pas installer** ; re-télécharger depuis la release ; si le message dit « another key », la clé publique du dépôt et le secret `SIGNING_MANIFEST_KEY` ne correspondent plus (voir §4, clés de signature) |
| « package refused: manifest is not signed … » | release construite sans `SIGNING_MANIFEST_KEY` (`SIGNING.txt` : `manifest signed: NO`) | poser le secret et relancer la release ; à défaut, après contrôle du `.sha256`, `--allow-unsigned` (journalisé) |
| « downgrade … refused » | paquet plus ancien que l'installé | `sdp-manager rollback` si l'on veut revenir en arrière |
| Le service ne répond pas après la mise à jour | port occupé par un ancien processus | `netstat -ano | findstr :<port>`, `taskkill /F /PID <pid>` (jamais `/IM node.exe`), puis Manager ▸ Service ▸ *Démarrer* |
| Restauration refusée | phrase de confirmation inexacte | taper exactement `RESTORE aaaammjj` affiché à côté de la sauvegarde ; une sauvegarde est prise avant toute restauration |
| « SDP_CONFIG_KEY is required in production » | `.env` sans clé | générer une phrase ≥ 16 caractères, redémarrer, ré-enregistrer les secrets dans Admin |
| Migrateur en erreur | droits insuffisants du rôle applicatif | le rôle doit être propriétaire de la base (`OWNER sdp_app`) |

Journaux de référence : `<install>\logs\setup-*.log`, `logs\service-*.log`, `logs\sdp-manager.log` ; Manager ▸ Diagnostic ▸ *Bundle de support* (secrets retirés).
