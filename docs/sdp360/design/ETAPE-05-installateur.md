# Dossier de conception — Étape 05 — Installateur, Manager, paquets signés, modularisation

Version 1 · 2026-10-19 · Auteur : agent IA · Relecteur : comité (à réceptionner) · Statut : **implémenté (volet agent) — volet humain (certificat de signature, Manager WPF, maquettes designer, recette E2E Windows) en attente**

## 1. Objectif et périmètre
Un seul assistant graphique `SDP-Dashboard-Setup-<version>.exe` (7 écrans) installe, met à jour ou répare ; un paquet de mise à jour versionné et vérifié par manifeste ; un Manager (CLI livré, application WPF spécifiée) pour l'état, la sauvegarde, la mise à jour avec retour arrière, le bundle de support ; les scripts `.cmd` et le registre des lots gelés retirés ; `server.js` réduit par extraction de modules ; fin de la compilation JSX dans le navigateur (esbuild) ; règles de CLAUDE.md consolidées en ADR. **Hors périmètre** : la fenêtre WPF elle-même (spécifiée dans `tools/manager/README.md`), la signature (dépend du certificat), la recette sur une machine Windows propre (étape humaine).

## 2. Existant touché
- **Nouveau** : `services/updatePackage.js` (pur : manifeste, SemVer, règles d'application, chemins protégés), `tools/deploy/make-update-package.js` (paquet complet depuis `git ls-files`, exclusions dev, bundle esbuild obligatoire), `tools/sdp-manager.js` (status · backup · verify · update · rollback · support-bundle), `tools/installer-v2/SDP-Dashboard.iss` + `post-install.js`, `.github/workflows/release.yml`, `tools/build/build-frontend.js` (esbuild, `npm run build` / `build:check`), `routes/meetings.js` (870 lignes sorties de `server.js`), `LICENSE`, `tools/manager/README.md`, `docs/ops/INSTALLATION.md`, `docs/ops/EXPLOITATION.md`, ADR-002 à ADR-005.
- **Modifié** : `server.js` (montage du routeur meetings, `require` de `statusTransfer` rapatrié, CSP : `'unsafe-eval'` réservé aux pages de prévisualisation design), `public/activity-tracker.html` (React production UMD + `dist/app.js`, plus de Babel), `.gitignore` (le bundle `public/activity-tracker/dist/` est **versionné**), `package.json` (scripts, version alpha.6), `ci.yml` (`npm run build:check`), aide §22 EN/FR, `docs/ops/INCIDENT-RESPONSE.md`, `tools/pg/README.md`.
- **Supprimé** : `_sdp_admin.cmd`, `_pm2_restart_prod.cmd`, `_pm2_recover_prod.cmd`, `_restore_db.cmd`, `tools/deploy/{make-deploy-zip.ps1, apply-on-prod.cmd, mark-deployed.cmd, Check-FrozenLots.ps1, frozen-lots.json}`, `tests/deploy-frozen-lots.test.js`, `tools/installer/tests/admin-static.tests.ps1`.

## 3. Modèle de données
Aucune table. Deux fichiers d'état dans le dossier d'installation : `manifest.json` (la version installée, écrite par l'application du paquet) et `.rollback/<version>/` (fichiers conservés + `rollback.json`). `manifest.json` du paquet : `{format:1, name, version, commit, built_at, files:{<chemin>:{sha256,size}}}`.

## 4. API / CLI
`node tools/sdp-manager.js <status|backup|verify <zip>|update <zip>|rollback|support-bundle> [--dir] [--url] [--no-backup|--no-npm|--no-migrate|--no-restart] [--reinstall] [--allow-downgrade]`. `node tools/deploy/make-update-package.js [--out dist] [--version] [--commit]`. `node tools/installer-v2/post-install.js --dir … --package … --mode new|update|repair|uninstall …` (secrets par variables `SDP_SETUP_*`). `npm run build` / `npm run build:check`. Aucune route HTTP nouvelle.

## 5. Écrans
Les 7 écrans de l'assistant sont décrits dans `docs/ops/INSTALLATION.md` §2 ; l'ordre, les valeurs par défaut et les sauts (PostgreSQL ignoré en mise à jour) sont dans `SDP-Dashboard.iss`. **Maquettes designer : à produire** (arbitrage 3) — l'assistant utilise pour l'instant le style « modern » d'Inno sans habillage de marque.

## 6. Règles métier
- Un paquet est appliqué seulement si **chaque** fichier a l'empreinte annoncée ; une seule divergence refuse le paquet entier (jamais de copie partielle).
- Pas de retour de version par un paquet : `rollback` restaure l'état conservé. Même version = refusée sauf *réparation*.
- `.env`, `data/`, `logs/`, `node_modules/`, `backups/` : jamais dans un paquet, jamais écrits par un paquet (un paquet qui les liste est refusé).
- Toute étape après la copie (npm, migrateur, redémarrage, sonde) qui échoue déclenche le retour arrière automatique.
- Redémarrage = `pm2 stop` → attente → `pm2 start`, jamais `reload` (CLAUDE.md, EADDRINUSE).
- Secrets : variables d'environnement ou entrée standard, jamais une ligne de commande ; le bundle de support ne porte que les **noms** des clés.
- `server.js` ne peut que décroître (`tests/server-size-budget.test.js`, budget 8 300 → abaissé à chaque extraction) ; aucune page ne compile du JSX dans le navigateur.

## 7. Tests
`update-package` (6), `sdp-manager.smoke` (5 : installation puis mise à jour avec point de retour, refus corrompu/rétrogradation/même version, échec post-copie → rollback automatique, chemins protégés, bundle sans secret), `server-size-budget` (2), `frontend-bundle-fresh` (1). Suites meetings / tracker / authz / CSP vertes après l'extraction (149) ; suite complète avec PostgreSQL : 0 échec. Le script Inno et le workflow release ne s'exécutent que sur Windows / sur tag : **recette humaine** (§12, arbitrage 8).

## 8. Migration
Première release 2.0 : `git tag v2.0.0-beta.1` → CI produit le paquet et `Setup.exe` → sur le serveur, Setup en mode *Mise à jour* par-dessus l'installation v1 (il écrit `manifest.json` et conserve `.env`). Ensuite chaque release passe par `sdp-manager update`. Le marqueur `.git/last-deployed` et le registre des lots gelés n'ont plus de sens : les deux lots jadis « derrière le marqueur » (installer-safety-parity, tracker RAG 90 %) sont **dans** tout paquet 2.0 par construction — le second est donc **livré au prochain déploiement** ; si le cycle de reporting impose encore le gel, c'est une politique RAG à régler dans le registre (étape 3), plus un fichier à retenir.

## 9. Sécurité
Signature Authenticode de `Setup.exe` par la CI (secret `SIGNING_CERT_PFX_BASE64`) ; le zip n'est pas signable (Authenticode) : son intégrité repose sur `.sha256` + manifeste par fichier, et le `Setup.exe` **signé** embarque le même zip. Release non signée publiée mais étiquetée (`SIGNING.txt`) ; le Manager avertira avant de l'appliquer. `post-install.js` journalise en masquant toute valeur `*PASS*`/`*KEY*`/`*SECRET*`.

## 10. Exploitation
`docs/ops/INSTALLATION.md`, `docs/ops/EXPLOITATION.md`. Objectifs d'acceptation : installation < 20 min, mise à jour < 5 min avec retour arrière démontré, première release de production depuis un paquet CI.

## 11. Risques
- Le `.iss` n'a pas été compilé ici (pas de Windows) : une erreur de syntaxe Pascal Script apparaîtra au premier job `release` — correction en un commit, aucune donnée en jeu.
- `post-install.js` suppose `psql` et `pm2` dans le PATH ; l'embarqué PostgreSQL d'EDB les installe, un serveur existant peut exiger d'ajouter `bin\` au PATH (documenté).
- Le bundle esbuild est versionné : un oubli de `npm run build` casse la CI (`build:check`), jamais la production.

## 12. Points d'arbitrage (défauts appliqués, à confirmer)
1. **Technologie installateur** : **Inno Setup 6** (pages personnalisées en script, gratuit, signature native) plutôt que WiX (tables MSI, courbe d'apprentissage, pas de valeur ajoutée GPO ici).
2. **Technologie Manager** : **WPF .NET 8** (Windows seul, tray, APIs de service) plutôt que Tauri ; le cœur reste le CLI Node, le Manager n'a aucune logique propre.
3. **Maquettes des 7 écrans** : à produire par le designer sur la base de `INSTALLATION.md` §2 ; habillage de marque (logo, couleurs `_tokens.css`) à poser dans le `.iss` (`WizardImageFile`).
4. **Format et signature des paquets** : ZIP complet + `manifest.json` + `.sha256`, `Setup.exe` signé ; **pas de paquet différentiel**. Certificat de signature de code = prérequis humain (arbitrage bloquant pour « release signée »).
5. **Politique de version** : SemVer ; `2.0.0-alpha.N` jusqu'à la recette, `2.0.0-beta.N` en pilote, `2.0.0` à la première mise en production ; le tag doit égaler `package.json` (la CI le vérifie).
6. **Découpage du code** : prochains modules extraits de `server.js` dans l'ordre inspection (déjà fait) → meetings (fait) → tracker → assets → reports/auth ; budget abaissé à chaque étape, cible < 3 000 lignes à l'étape 8.
7. **Retrait de `tools/installer/` (v1 console)** : conservé jusqu'à la première release signée appliquée en production, puis supprimé avec ses tests PowerShell.
8. **Recette E2E Windows** : machine propre (VM), chronométrée : installation, mise à jour, panne provoquée → rollback, restauration d'un dump ; enregistrement vidéo joint à la release.
