# SDP Dashboard — Installeur & Maintenance (guide opérateur)

> Livré 2026-07-13. Spec : `docs/superpowers/specs/2026-07-13-sdp-installer-design.md`.
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

## Sur le serveur cible

Double-clic sur `SDP-Setup-<version>.exe` → auto-élévation → menu console :

| Option | Action | Notes |
|---|---|---|
| 1 Patch | Code seul (équivaut aux zips actuels) | backup auto avant, node_modules intact |
| 2 Upgrade | Code + node_modules | backup auto, `node_modules.prev` filet, migrations DB au boot |
| 3 Reinstall | Réinstalle tout, **DB conservée** | taper `REINSTALL` ; DB neuve = taper aussi `DROPDB` |
| 4 Fresh install | Serveur vierge : Node, pm2+service, PostgreSQL, provisioning, questionnaire `.env`, app | Enter = défaut ; chaque question affiche où trouver l'info ; valeurs sautables |
| 5/6/7 | Backup / Restore / Liste | via `Manage-SDP.ps1` (identique au menu `_sdp_admin.cmd`) |
| 8/9 | Santé / Diagnostics | probe :port, pm2, tailles DB, flags |
| E | Compléter le `.env` | ne redemande QUE les valeurs manquantes/placeholder |
| C | Pré-flight PostgreSQL | `[check] OK …` attendu |

L'en-tête affiche `Installed: vA -> Bundle: vB` ; un downgrade est refusé sans `-Force`.

## Garanties

- **Backup automatique avant** tout Patch/Upgrade/Reinstall (`sdp-restore_pre-<ver>_*.zip`
  dans `..\SDP-Backups` : code + `.env` + `data\` + `blobs\` + `pg_dump`).
- **Rollback automatique** : si après déploiement le service ne répond pas
  (pm2 online ≤30 s + probe HTTP ×3), le code + `.env` + `node_modules.prev`
  sont restaurés, redémarrés, re-testés → sortie `ROLLED BACK` (exit 2).
  La DB n'est PAS auto-restaurée (migrations additives ; restore DB = action
  manuelle option 6). Redémarrages « orphan-safe » (jamais `pm2 reload` ;
  kill chirurgical du PID orphelin sur le port).
- `.env` **jamais écrasé** ; clés nouvelles ajoutées commentées `# NEW in <ver>:`.
- `data\`, `blobs\`, `SDP-Backups\` jamais touchés par un déploiement.
- Journal : `C:\ProgramData\SDP-Dashboard\logs\` (`install-*.log`, `summary.txt`,
  `installs.log` = une ligne par run).

## Sauvegardes planifiées (depuis l'admin de l'app)

`reports.html#admin` → carte **💾 Scheduled Backups** (super_admin) :
- Quotidienne DB seule + hebdo complète (heure/jour configurables), rétention,
  activer/désactiver, « Backup now », liste des restore points.
- Les 2 tâches Windows (`SDP-Backup-DB-Daily`, `SDP-Backup-Full-Weekly`)
  tournent **même si l'app est arrêtée** (Task Scheduler, compte SYSTEM).
- Équivalent CLI : `powershell -File tools\installer\Manage-SDP.ps1 -Schedule -Daily 02:00 -Weekly SUN:03:00`.

## Instance de test parallèle

`-Config config.test.psd1` sur n'importe quel script = instance
`C:\Apps\SDP-Dashboard-TEST`, port 3457, pm2 `sdp-test`, DB `sdp_dashboard_test`,
tâches planifiées suffixées — le prod n'est jamais touché.
