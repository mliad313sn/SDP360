# SDP Dashboard — Installeur & Maintenance (guide opérateur)

> Livré 2026-07-13. Spec : `docs/superpowers/specs/2026-07-13-sdp-installer-design.md`.
> Parité de sécurité (détection, menu groupé, écrans rouges, contrôle de données) : 2026-09-17,
> spec `docs/superpowers/specs/2026-09-15-installer-safety-parity-design.md`.
> Un seul artefact à distribuer : **`SDP-Setup-<version>.exe`** (~450 MB, autonome,
> zéro réseau requis sur le serveur cible).

## Construire l'exécutable (boîte dev)

```powershell
# 1. (une fois / après changement de versions tierces) remplir le cache :
powershell -File tools\installer-build\download-cache.ps1
#    -> Node MSI, PostgreSQL EDB, python-embed + wheels, 7zr/7zSD.sfx (LZMA SDK)
#    Le sous-arbre pm2 global (cache\pm2-global\) doit etre copie depuis une
#    machine qui a pm2 (%APPDATA%\npm\node_modules\pm2 + shims) - voir README du dossier.

# 2. build officiel (exige arbre git propre + tag vX.Y.Z) :
git tag v2.1.0 && powershell -File tools\installer-build\build-installer.ps1
# ou build de dev :
powershell -File tools\installer-build\build-installer.ps1 -DevBuild
# -> SDP-Setup-<version>.exe a la racine du repo (gitignore). Build RESUMABLE
#    (re-lancer reprend ou il en etait; -Clean pour repartir de zero).
```

Le bundle embarque les scripts de premier niveau de `tools\installer\` (`Setup.bat`,
`Install-SDP.ps1`, `Manage-SDP.ps1`, `SdpSituation.ps1`, `Detect-SDP.ps1`,
`Show-Situation.ps1`, `Confirm-Destructive.ps1`, `config*.psd1`, `env.template`) ;
le sous-dossier `tests\` n'est pas embarqué. Il n'arrive pas non plus sur le serveur
par le code déployé : `tools/installer/tests` est `export-ignore` (`.gitattributes`,
donc absent du `git archive` qui produit `payload\app.zip`) et exclu du ZIP de
déploiement (`tools\deploy\make-deploy-zip.ps1`, liste `$skip`).

`Setup.bat` exécute **toujours les scripts du bundle** (jamais une copie installée,
qui peut être plus ancienne et ne pas offrir les garanties promises par l'écran rouge).
Quand `<InstallDir>\tools\installer\config.psd1` existe, il est passé en `-Config`
(fusionné sur la config du bundle) à la détection et à `Manage-SDP.ps1` (backup,
liste, restore, check DB) - pas à `Install-SDP.ps1` : ce fichier est une copie
complète de la config de l'ancien bundle et écraserait les valeurs par défaut du
nouveau (`NodeMinMajor`, `PgMinMajor`...), et l'étape 6 le remplace de toute façon.
**Le `config.psd1` installé est donc écrasé à chaque installation (étape 6) : pour un
réglage durable, modifiez le `config.psd1` du bundle, pas la copie installée.**

## Sur le serveur cible

Double-clic sur `SDP-Setup-<version>.exe` → auto-élévation → `Setup.bat`.

### 1. Détection de la situation

Avant d'afficher le menu, `Setup.bat` lance **`Detect-SDP.ps1`** (lecture seule, ne
lève jamais d'erreur) : dossier d'installation, version installée, `.env`, pm2, port,
base PostgreSQL (taille + comptages `sites`, `weekly_reports`, `md_meetings`,
`insp_inspections`, `users`, `assets`, lus avec le rôle applicatif du `PG_URL`),
dernier restore point, version du bundle, `package-lock.json` identique ou non.
Le résultat est écrit dans un fichier JSON **propre à la session**
(`%TEMP%\sdp-situation-<aléatoire>.json`), supprimé avant chaque détection (jamais de
situation périmée) et à la sortie du menu. `-OutFile` est **obligatoire** : il n'y a
plus de fichier partagé par défaut (`%TEMP%\sdp-situation.json`) ; appelé sans,
`Detect-SDP.ps1` répond `STATE=unknown` + `ERROR=...` et n'écrit rien. La détection est refaite **après chaque
action terminée** — pas après un refus ni une confirmation annulée (rien n'a changé).

`Show-Situation.ps1` affiche ensuite un bloc coloré :

```
 -- Situation ---------------------------------------------------------------
  Install    : C:\Apps\SDP-Dashboard   v2.3.1   (pm2 online, port ours)
  Database   : sdp_dashboard  1800 MB   sites 11 | reports 412 | PV 96 | inspections 41 | users 23
  Backups    : last full 3 d ago (sdp-restore_manual_20260912-020011.zip, 640 MB) | 14 kept
  Bundle     : v2.4.0   node_modules changed -> Upgrade recommended
```

Vert = sain ; jaune = avertissement (pm2 non `online`, port occupé par un autre
processus, base injoignable, dernier backup de plus de 7 jours) ; rouge = downgrade,
installation incomplète ou état illisible. Une base injoignable **n'empêche pas**
Patch/Upgrade : les comptages sont « unavailable » et le contrôle de données sera sauté.

États : **empty** (ni `server.js` ni `.env` → Fresh recommandé), **installed**
(`server.js` + `.env` → Patch recommandé si le lockfile est identique, Upgrade s'il
diffère ou est inconnu), **partial** (un seul des deux → aucune recommandation, une
note dit quoi faire). Un état qui ne peut pas être lu est traité comme inconnu.

### 2. Menu groupé

Une phrase d'état (« SDP Dashboard vA is installed and this package contains vB. »),
puis quatre groupes. Les numéros d'option n'ont pas changé.

| Groupe | Option | Action | Notes |
|---|---|---|---|
| RECOMMENDED | celle que la détection recommande | affichée en vert avec `<< recommended` | sur machine vide : 4 Fresh, et `D Demo` juste dessous si le bundle contient `payload\demo\*.zip` |
| OTHER | 1 Patch | Code seul ; node_modules et base intacts | backup auto avant, rollback auto |
| | 2 Upgrade | Code + node_modules | backup auto, `node_modules.prev` filet, migrations DB au boot |
| | 3 Reinstall | Redéploie par-dessus ; **base conservée** sauf demande explicite | écran rouge `REINSTALL` ; suppression de la base = second écran rouge |
| | 4 Fresh install | Serveur vierge : Node, pm2+service, PostgreSQL, provisioning, questionnaire `.env`, app | sur une installation existante : en rouge, écran rouge `OVERWRITE <COMPUTERNAME>` |
| | D Demo | Fresh + jeu de données embarqué (**remplace la base et les comptes**) | sur une installation existante : en rouge, écran rouge `DEMO <COMPUTERNAME>` ; entrée absente si le bundle n'a pas de démo |
| DATA | 5 Backup now | Restore point complet (code + `.env` + `data\` + blobs + dump) | |
| | 6 Restore | Revient à un restore point | en rouge ; écran rouge `RESTORE <yyyymmdd>` ; mention `(no PostgreSQL configured)` si le `.env` n'a pas de `PG_URL`, `(database unreachable)` si la base ne répond pas |
| | 7 List | Liste des restore points | |
| MAINTENANCE | 8 / 9 | Santé / Diagnostics | probe :port, pm2, tailles DB, flags |
| | E | Compléter le `.env` | ne redemande QUE les valeurs manquantes/placeholder |
| | C | Pré-flight PostgreSQL | `[check] OK …` attendu |

Une entrée inapplicable est **grisée avec sa raison**, et `Setup.bat` la refuse avant
toute exécution :

| Raison | Entrées refusées |
|---|---|
| état inconnu (situation illisible) | 1, 2, 3, 4, D — lancer 9 (Diagnostics) |
| downgrade (bundle plus ancien que l'installé) | 1, 2, 3, 4, D — utiliser un bundle plus récent ; le menu ne passe jamais `-Force` |
| rien d'installé (état empty) | 1, 2, 3 — utiliser 4 |
| installation incomplète (état partial) | 1, 2 |
| pas de `server.js` | 3 — utiliser 4 (le `.env` est conservé) |
| pas de jeu de démo dans le bundle | D |

### 3. L'écran rouge (`Confirm-Destructive.ps1`)

Toute action destructive passe par le même écran : bandeau rouge, **ce qui va se
passer**, **ce qui est en jeu** (taille et comptages réels de la base, version,
`.env`, âge du dernier restore point), **ce qui vous protège**, puis une phrase exacte
(sensible à la casse) :

| Action | Phrase à taper |
|---|---|
| Reinstall | `REINSTALL` |
| Suppression + recréation de la base (après Reinstall) | `DROP <db>` (ex. `DROP sdp_dashboard`) |
| Fresh sur une installation existante | `OVERWRITE <COMPUTERNAME>` (nom de la machine) |
| Demo sur une installation existante | `DEMO <COMPUTERNAME>` (`OVERWRITE ...` n'est **pas** accepté) |
| Restore | `RESTORE <yyyymmdd>` (date du nom `sdp-restore_<tag>_<yyyymmdd>-<hhmmss>.zip` ; un nom sans cette date → `RESTORE <nom sans .zip>`) |

- Les espaces autour de la phrase sont ignorés ; toute autre saisie, une entrée vide
  ou fermée **annule** : « Cancelled - nothing changed ».
- Une confirmation ne compte **que si le script de confirmation sort avec le code 0
  exactement**. Script absent, planté ou code négatif = refus. Si
  `Confirm-Destructive.ps1` manque au bundle, un avertissement s'affiche au démarrage :
  Reinstall, Fresh/Demo sur existant et Restore sont **désactivés** ; le menu reste
  utilisable pour la maintenance.
- Reinstall : le restore point pris d'abord contient code + `.env` + `data` ; le **dump
  de la base n'y est que si la base est joignable** (l'écran le dit quand elle ne
  l'est pas). Le dump n'est exigé que si la base doit être supprimée (écran `DROP <db>`).
- La question « Also DROP + recreate the PostgreSQL database? [y/N] » n'est posée
  **que si la base est joignable** ; sinon la base est conservée et sa suppression
  n'est pas proposée (on ne supprime pas ce qu'on ne peut pas dumper).
- Restore : l'écran lit le contenu réel du zip (code / `.env` / `data` / dump) et dit
  si la base sera remplacée. Un fichier `*.sql` (dump seul) est refusé avant la phrase.
- Fresh sur existant (option 4, `-Fresh -ForceOverwrite`) : code et node_modules
  remplacés ; base, `data\`, `blobs\` et `.env` **ne sont pas supprimés**.
  `-ForceOverwrite` lève uniquement le refus « dossier non vide » ; le refus de
  downgrade reste actif. Restore point + rollback automatique **seulement si
  `server.js` est présent** : s'il ne reste qu'un `.env` (installation partielle), le
  plan n'a pas d'étape 5 (`1,2,3,4,4b,6,7`), donc ni restore point ni rollback - l'écran
  rouge l'annonce ; faire un backup (option 5) avant si une copie est voulue.
- Demo sur existant (option D, `-Fresh -SeedData -ForceOverwrite`) : **ce n'est pas
  un Fresh qui conserve la base.** Après le déploiement, l'étape 8 restaure le jeu de
  démo : la base est **SUPPRIMÉE puis rechargée** depuis le dump de démo, les
  **comptes utilisateurs sont remplacés** par ceux de la démo, `data\` reçoit les
  fichiers de démo. D'où un écran rouge dédié (`demo-over-existing`, phrase
  `DEMO <COMPUTERNAME>`). Protections : restore point complet avant tout, puis un
  point `pre-restore` **avec dump complet** avant le remplacement — sans ce dump, le
  remplacement est refusé et la base actuelle est conservée. Le résumé indique
  `Database: replaced by demo dataset (<zip>)` et
  `Data check: skipped (database replaced by demo dataset)`.
  Sans `server.js` existant (restes seulement), il n'y a ni restore point complet ni
  rollback des fichiers : l'écran le dit, et seule la protection `pre-restore` de la
  base s'applique.
  **Un chargement de démo qui échoue n'est jamais un succès simple** : l'install reste
  en place et vérifiée, mais le run se termine par
  `Result: COMPLETED WITH WARNINGS - demo dataset NOT loaded` et **exit 3**. Si la
  restauration a été refusée avant tout changement (ex. dump de démo plus récent que le
  serveur PostgreSQL), la ligne dit
  `Database: <created|preserved> - NOT replaced: demo dataset refused before any change (<zip>), see the log` ;
  si elle a échoué après son pré-contrôle, `Database: uncertain - ...`.

`_sdp_admin.cmd` option 6 (Restore) passe par le même écran rouge (détection dans un
fichier propre à la session, phrase `RESTORE <yyyymmdd>`, code 0 exigé) avant
d'appeler `Manage-SDP.ps1 -Restore -Force`. Il exige les scripts de l'installeur
**sur le serveur**, dans `<InstallDir>\tools\installer\` (`Confirm-Destructive.ps1`,
`Detect-SDP.ps1`, `SdpSituation.ps1`, `Manage-SDP.ps1`) - le ZIP de déploiement les
transporte (seul `tests\` en est exclu) ; s'il en manque un, l'option 6 refuse
(« deploy the installer tools first ») sans rien changer.

## Garanties

- **Sauvegarde AVANT toute suppression.** Patch, Upgrade, Reinstall et Fresh sur
  existant prennent un restore point complet (`sdp-restore_pre-<ver>_*.zip` dans
  `..\SDP-Backups` : code + `.env` + `data\` + `blobs\` + `pg_dump`). Sur Reinstall et
  Fresh sur existant (avec `server.js`), cette sauvegarde (étape 5) s'exécute **avant** l'étape base de
  données (étape 4) : plan `1,2,3,5,4,4b,6,7`. L'étape 5 démarre au besoin le service
  PostgreSQL pour le dump. Fresh sur machine vide : pas de sauvegarde (rien à sauver).
- **DROP refusé sans dump complet.** Quand la base doit être supprimée
  (`-ConfirmDataLoss`), l'installeur vérifie que le restore point contient
  `sdp_dashboard.sql` **à la racine**, non vide, se terminant par
  `-- PostgreSQL database dump complete` ; sinon il s'arrête avant le DROP.
- **La base dumpée = la base de la phrase = la base supprimée.** Avant l'étape 5
  (donc avant tout DROP), avec `-ConfirmDataLoss` l'installeur compare le `PG_URL`
  du `.env` (source du dump et de la phrase `DROP <db>`) - et, s'il est défini, le
  `PG_URL`/`DATABASE_URL` d'environnement que `dump-db.js` lit en premier - avec
  `DbName` / `PgHost` / `PgPort` de la config (`localhost`, `127.0.0.1` et `::1` sont
  équivalents, port absent = 5432). Pas de `PG_URL` ou base différente → arrêt :
  « The database named in .env (<db>@<host>:<port>) is not the one this installer
  would drop (...) - fix .env or config.psd1; nothing was dropped. » Le message ne
  contient jamais d'identifiant ni de mot de passe.
- **Rollback automatique** : si après déploiement le service ne répond pas
  (pm2 online ≤30 s + probe HTTP ×3), le code + `.env` + `node_modules.prev` sont
  restaurés, redémarrés, re-testés → sortie `ROLLED BACK` (exit 2).
  Codes de sortie d'`Install-SDP.ps1` : 0 OK, 1 échec, 2 échec + rollback,
  3 installé et vérifié mais jeu de démo NON chargé (`-SeedData` uniquement). Il couvre
  désormais aussi Fresh sur existant **quand `server.js` était présent** (sinon pas
  d'étape 5, donc rien vers quoi revenir). La base n'est PAS auto-restaurée (migrations
  additives ; restore DB = option 6). Redémarrages « orphan-safe » (jamais
  `pm2 reload` ; kill chirurgical du PID orphelin sur le port).
- **Contrôle d'intégrité avant/après.** L'étape 5 relève les comptages (`sites`,
  `weekly_reports`, `md_meetings`, `insp_inspections`, `users`, `assets`), l'étape 7
  les relit une fois le service vérifié. Un comptage en baisse →
  `Data check: WARNING - <table> <avant> -> <après> - restore point: <zip>`, en rouge.
  **Jamais de rollback automatique** sur ce motif : la décision de restaurer la base
  revient à l'opérateur. Comptages indisponibles → `skipped (...)` ; base supprimée à
  la demande → `skipped (database dropped by request)` ; Fresh sans existant →
  `skipped (fresh install)`. Tout est `OK (...)` sinon.
- **Résumé de fin de run** : les mêmes 8 lignes, dans le même ordre, dans l'encadré
  vert de la console et dans `summary.txt` : `Mode`, `Version` (`a -> b`),
  `Restore point`, `Database`, `.env` (`preserved (merged)` / `created`),
  `Data check`, `Log`, `Summary`. La ligne `Database` décrit ce qui s'est
  **réellement** passé : `preserved`, `created`, `DROPPED and recreated`,
  `DROPPED - NOT recreated (restore from the restore point)`,
  `preserved (drop not performed)`, `not created (...)`, `replaced by demo dataset (<zip>)`,
  `uncertain - demo dataset restore failed (<zip>), see the log`.
- **En-tête d'environnement** au début de chaque journal : date, utilisateur, machine,
  OS, PowerShell, espace libre, config résolue, node/psql, état des ports. Les secrets
  n'y figurent que sous la forme `(set)` / `(not set)`.
- **Restauration = point `pre-restore` d'abord.** `Manage-SDP.ps1 -Restore` :
  1. détermine si l'import va supprimer une base : `PG_URL` du `.env` contenu dans le
     restore point s'il en a un, sinon celui du `.env` actuel, et présence d'un dump
     racine dans le zip ;
  2. prend un restore point `sdp-restore_pre-restore_*.zip` de l'état courant en
     dumpant **cette** base-là (le `PG_URL` est transmis au processus enfant par
     variable d'environnement uniquement) ; échec → restauration annulée, rien modifié ;
  3. refuse si une base doit être supprimée et que ce point ne contient pas de dump
     complet (le point inutilisable est alors supprimé) ;
  4. supprime un `sdp_dashboard.sql` résiduel à la racine de l'installation avant la
     copie (l'import ne rejoue jamais un vieux dump) ;
  5. échoue « fermé » si le `.env` actuel ou le zip est illisible (aucun changement) ;
     **règle de version** : avant le point pre-restore, l'en-tête du dump
     (`-- Dumped by pg_dump version N`) est comparé à la version du serveur
     (`SHOW server_version_num`, en `postgres`). Un dump fait par un pg_dump **plus
     récent** que le serveur est refusé (« Upgrade PostgreSQL to N or later, or use a
     restore point made on this server ») - pg_dump 17 écrit par exemple
     `SET transaction_timeout`, que PostgreSQL 16 rejette ; un en-tête illisible ou un
     serveur qui ne répond pas → refus aussi (échec fermé). Un `PG_URL` sans mot de
     passe est également refusé à ce stade. Tout refus du pré-contrôle sort en
     **exit 3** « rien modifié » (1 = échec après l'arrêt du service) ;
     la base supprimée est **exactement la base dumpée** : base, hôte et port viennent
     du même `PG_URL` que le dump de l'étape 2 (jamais de `PgHost`/`PgPort`/`DbName` de
     `config.psd1`). Ce `PG_URL` doit être une URL postgres valide dont la base et
     l'utilisateur sont des identifiants simples en minuscules (`[a-z_][a-z0-9_]*`,
     PostgreSQL replie la casse d'un nom non cité) - sinon refus avant le point
     pre-restore, rien modifié. Après la copie, le `.env` doit toujours nommer cette
     base, sinon rien n'est supprimé ;
  6. import strict : `DROP`, `CREATE` puis import (`psql -w -v ON_ERROR_STOP=1`)
     vérifiés un par un - un échec arrête tout (jamais de CREATE après un DROP raté,
     jamais d'import dans une base non créée). Après l'arrêt du service, **chaque**
     message d'erreur nomme le point `pre-restore` à restaurer pour revenir en
     arrière (le service reste arrêté) ; un import raté conserve le dump et dit où.

  Les points `pre-restore` ont leur propre file de rétention (les 2 plus récents sont
  gardés) et ne comptent pas dans `RetentionFull`.
- **Secrets jamais sur une ligne de commande construite par l'installeur** (les
  transcripts et les listes de processus les capturent). Les mots de passe passent par
  `PGPASSWORD`, des variables d'environnement (`SDP_APP_PASSWORD`, `PG_URL` du point
  pre-restore) ou une saisie masquée ; le SQL qui contient un mot de passe
  (`CREATE ROLE ... PASSWORD`) passe par **stdin** (`Invoke-PsqlSuperStdin`,
  `psql -f -`). Seule exception : l'argument `--superpassword` de l'installeur EDB
  PostgreSQL, uniquement quand aucun service `postgresql*` n'existe (installation
  neuve) — EDB n'accepte rien d'autre, et la valeur n'est jamais journalisée.
- **Une seule exception volontaire à « aucun secret à l'écran »** : à l'étape 4, en
  mode interactif, si l'opérateur répond Entrée à « sdp_app database password [Enter =
  generate one] », le mot de passe généré pour le rôle `sdp_app` est affiché **une
  fois** sur la console (`generated: <mot de passe>   (SHOWN ONCE - stored in .env
  PG_URL)`) - c'est le seul moyen de le connaître. Il n'est pas écrit dans le journal
  d'installation (seulement dans `.env` `PG_URL`), mais une transcription PowerShell
  active (`Start-Transcript`) le capturerait. En mode silencieux (`EnvSilent`), rien
  n'est affiché : le journal dit seulement « sdp_app password GENERATED ».
- `.env` **jamais écrasé** ; clés nouvelles ajoutées commentées `# NEW in <ver>:`.
- `data\`, `blobs\`, `SDP-Backups\` jamais touchés par un déploiement.
- Journal : `C:\ProgramData\SDP-Dashboard\logs\` (`install-*.log`, `summary.txt`,
  `installs.log` = une ligne par run, `setup-session.log` = actions du menu).
- Plan d'un mode sans rien exécuter (pas d'admin requis) :
  `powershell -File tools\installer\Install-SDP.ps1 -Reinstall -PrintPlan` →
  `PLAN=1,2,3,5,4,4b,6,7`.

## Sauvegardes planifiées (depuis l'admin de l'app)

`reports.html#admin` → carte **💾 Scheduled Backups** (super_admin) :
- Quotidienne DB seule + hebdo complète (heure/jour configurables), rétention,
  activer/désactiver, « Backup now », liste des restore points.
- Les 2 tâches Windows (`SDP-Backup-DB-Daily`, `SDP-Backup-Full-Weekly`)
  tournent **même si l'app est arrêtée** (Task Scheduler, compte SYSTEM).
- Équivalent CLI : `powershell -File tools\installer\Manage-SDP.ps1 -Schedule -Daily 02:00 -Weekly SUN:03:00`.
- La rétention `RetentionFull` ne compte pas les points `pre-restore` (file séparée,
  2 conservés).

## Instance de test parallèle

`-Config config.test.psd1` sur n'importe quel script = instance
`C:\Apps\SDP-Dashboard-TEST`, port 3457, pm2 `sdp-test`, DB `sdp_dashboard_test`,
tâches planifiées suffixées — le prod n'est jamais touché.

## Tests

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\installer\tests\run-all.ps1
```

11 fichiers `*.tests.ps1` (sans Pester), ~3 min, en bac à sable (dossiers
temporaires, jamais `C:\Apps`). Crochets de test : `SDP_SETUP_NOELEVATE=1` saute
l'auto-élévation de `Setup.bat` ; `SDP_INSTALLER_LOG_DIR` remplace le dossier de
journaux de `Manage-SDP.ps1`. Le test de bout en bout (ci-dessous) reste une étape
manuelle : il installe réellement l'instance TEST.

## Test de bout en bout sur l'instance TEST (manuel, PowerShell administrateur)

Ne touche que `C:\Apps\SDP-Dashboard-TEST` (port 3457, pm2 `sdp-test`, base
`sdp_dashboard_test`, restore points dans `C:\Apps\SDP-Backups-TEST`). À faire avant
d'appliquer en prod un ZIP qui transporte `tools\installer`, `_sdp_admin.cmd` ou
`tools\pg\dump-db.js`.

**0. Construire le paquet et préparer les variables**
```powershell
cd C:\Users\Admin\Documents\SDP-Dashboard
powershell -NoProfile -ExecutionPolicy Bypass -File tools\installer-build\build-installer.ps1 -DevBuild -KeepWork
$B = "$env:TEMP\sdp-build-dev-$(git rev-parse --short HEAD)\bundle"
$C = "$B\config.test.psd1"
$I = "$B\Install-SDP.ps1"; $M = "$B\Manage-SDP.ps1"
Test-Path $I, $C    # True True
```

**1. Installation neuve** (dossier TEST vide ; le questionnaire `.env` s'affiche)
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File $I -Fresh -Config $C -BundleRoot $B -NoBrowser
```
Attendu : `Database: created`, `Data check: skipped (fresh install)`.

**2. Correctif**
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File $I -Patch -Config $C -BundleRoot $B -NoBrowser
```
Attendu : `Data check: OK (...)`, `Restore point: ...\sdp-restore_pre-*.zip`.

**3. Réinstallation avec suppression de la base**
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File $I -Reinstall -ConfirmDataLoss -Config $C -BundleRoot $B -NoBrowser
```
Attendu : l'étape 5 (sauvegarde) apparaît avant l'étape 4 dans le journal, aucun refus
« No database dump… », `Database: DROPPED and recreated`,
`Data check: skipped (database dropped by request)`.

**4. Restauration du point pris avant la réinstallation**
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File $M -List -Config $C
powershell -NoProfile -ExecutionPolicy Bypass -File $M -Restore -Name "<sdp-restore_pre-...zip de l'étape 3>" -Force -Config $C
```
Attendu : un `sdp-restore_pre-restore_*.zip` est créé d'abord, le contrôle de version
PostgreSQL passe, les données reviennent (`-List`, puis l'appli sur http://localhost:3457).

**5. Écran rouge « DROP » tapé à la main** (ne supprime rien, ne fait que confirmer)
```powershell
$S = "$env:TEMP\sdp-e2e-situation.json"
powershell -NoProfile -ExecutionPolicy Bypass -File "$B\Detect-SDP.ps1" -Config $C -BundleRoot $B -OutFile $S
powershell -NoProfile -ExecutionPolicy Bypass -File "$B\Confirm-Destructive.ps1" -Action dropdb -Situation $S
```
Attendu : les comptages affichés sont ceux de la base TEST ; une mauvaise phrase →
« Cancelled », `DROP sdp_dashboard_test` → « Confirmed ».

Contrôle après chaque étape : l'encadré vert à l'écran et
`C:\ProgramData\SDP-Dashboard\logs` (`installs.log` + le journal du run). Noter les
cinq résultats ; en cas d'échec, garder l'encadré et la fin du journal.
