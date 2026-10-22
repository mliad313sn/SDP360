# Dossier de conception — Étape 05 — Installateur, modularisation, paquets signés

Version 1 · 2026-10-21 · Auteur : agent IA · Relecteur : présidence du comité
Référence : SDP-DASH-2.0-ETUDE v1.2, §6.3 étape 5, lacunes L6, L10, L11.

> **Statut : lot 5.1 livré (code sans effet visible pour les utilisateurs).** L'installateur
> signé et la mise à jour par paquet CI attendent deux préalables extérieurs au code : l'essai de
> bout en bout de l'installeur actuel sur l'instance TEST (lot gelé `installer-safety-parity`) et
> un certificat de signature de code (PKI). Choix validés le 2026-10-21 : Inno Setup, Manager =
> console PowerShell existante, ordre « découpage + build d'abord, installateur ensuite ».

## 1. Fiche → état

| Demandé | État | Où |
|---|---|---|
| Extraction de `server.js` vers `routes/*` (≥ 600 lignes par sprint, cible < 3 000) | **lot 5.1 : 9 203 → 7 394 lignes** (−1 809) | `routes/meetings.js` (36 routes), `routes/assets.js` (40 routes) ; cliquet `tests/server-size.test.js` (plafond 7 400, à abaisser à chaque extraction ; tout module de `routes/` doit être monté) |
| Étape de build (esbuild), fin de la compilation dans le navigateur | **oui (lot 5.2, 2026-10-22)** | `tools/build/build-frontend.js` (`npm run build`, `--check` en CI) ; l'aperçu `dashboard-preview` est compilé et ne charge plus Babel ni `unsafe-eval`. Le tracker est compilé depuis la levée de son gel (DEC-4) et charge React en version **production** avec SRI ; plus aucune page n'autorise `unsafe-eval` |
| Registre unique des tâches planifiées | déjà fait (étape 1) | `services/sync/jobs.js` |
| Setup.exe et Manager.exe construits et signés par la CI, paquet de mise à jour avec manifeste, retour arrière | conçu (§3), non construit | prérequis : E2E TEST + certificat (DEC-1, DEC-2) |
| Migrateur appelé par l'installateur | prêt côté code | `db/migrate.js` (étape 2) — l'installateur v2 l'appellera |
| Retrait des scripts `.cmd` et du registre des lots gelés | après la 1re livraison CI | §3.4 |
| `CLAUDE.md` réduit à un index, règles vers SOP et ADR | lot 5.5 | §4 |

## 2. Découpage de `server.js` — méthode et suite

Méthode (identique à `routes/inspection.js`, juin 2026) : le bloc de routes est déplacé tel quel
dans une fabrique `module.exports = (deps) => router` ; seuls `app.` → `router.`, les `require('./`
→ `require('../` et les chemins `__dirname` changent. Les dépendances internes arrivent par `deps`.
Trois pièges relevés pendant ce lot, à vérifier à chaque extraction :

1. **Une déclaration du bloc utilisée ailleurs** (`statusTransfer` servait aussi une route de
   rapport) : lister les déclarations du bloc et chercher leurs usages dans le reste du fichier.
2. **Une dépendance déclarée plus bas que le montage** (`let rdb`) : à l'exécution d'une requête
   elle existait, au montage elle est en zone morte → l'importer dans le module de routes.
3. **Des routes d'un autre préfixe mêlées au bloc** (quatre `/api/reports/*/send` au milieu des
   routes assets) : elles restent dans `server.js`, à la même place dans l'ordre d'enregistrement.

Suite proposée (≈ 600 à 1 000 lignes par sprint) : `reports` (86 routes, en trois lots :
administration/config, envois et PPTX, rapports hebdo), puis `data`/`survey`/`sync`, puis
l'amorçage (`start()`, caches HTML) dans `services/boot.js`. Cible < 3 000 lignes.

## 3. Installateur v2 — conception

### 3.1 Technologie
- **Setup.exe : Inno Setup 6** (un script `.iss`, compilable en CI sur `windows-latest` avec
  `iscc`). Il remplace l'archive auto-extractible 7-Zip actuelle (`tools/installer-build`) mais
  **garde `Install-SDP.ps1` comme moteur** : la logique déjà éprouvée (7 étapes, sauvegarde avant
  base, écrans rouges, contrôle de données, retour arrière) n'est pas réécrite.
- **Manager : la console `Manage-SDP.ps1` / `_sdp_admin.cmd`**, empaquetée et installée dans le menu
  Démarrer. Un Manager graphique (.NET / Tauri) est un projet distinct, hors de cette étape.

### 3.2 Paquet de mise à jour
`sdp-update-<version>.zip` construit par la CI depuis un **tag** : arbre complet (pas un diff
depuis un marqueur), `node_modules` de production, `manifest.json` (version, commit, date, liste
des fichiers avec SHA-256, migrations attendues, version minimale de départ). Le Manager :
vérifie la signature et le manifeste → sauvegarde (point de restauration + dump PG) → arrête pm2 →
remplace l'arbre → `node db/migrate.js` → démarre → sonde `/health` ; **toute étape en échec
restaure l'arbre et le dump** (retour arrière automatique, démontré à la réception).

### 3.3 Signature et versions
- Signature Authenticode de `Setup.exe` et du paquet (`signtool`, horodatage RFC 3161) avec le
  certificat de signature de code de la PKI ; secret dans les secrets GitHub, jamais dans le dépôt.
- Version **SemVer** depuis le tag Git (`v2.5.0`) ; `APP_VERSION` affiché par `/health` = le tag.
- Sans certificat : le paquet est livré avec son empreinte SHA-256 publiée dans la release.

### 3.4 Ce qui disparaît après la première livraison CI
`_deploy.cmd`, `make-deploy-zip.ps1`, `_apply_on_prod.cmd`, `mark-deployed.cmd`, le marqueur
`.git/last-deployed` et `tools/deploy/frozen-lots.json` : un paquet construit depuis un tag porte
l'arbre entier, il n'y a plus de « fichiers derrière le marqueur ».

## 4. `CLAUDE.md` → index (lot 5.5)
Les sections « Current state » deviennent `CHANGELOG.md` (déjà tenu) ; les pièges deviennent des
SOP par domaine dans `docs/sop/` ; les décisions deviennent des ADR dans `docs/adr/` (ADR-001
tracker par année, ADR-002 PostgreSQL existent). `CLAUDE.md` garde la carte des fichiers, les
règles transverses et des liens. ADR initiaux proposés : ADR-003 déploiement par paquet CI,
ADR-004 routes en modules injectés, ADR-005 JSX compilé à l'avance, ADR-006 secrets v2.

## 5. Points d'arbitrage

| # | Question | Recommandation |
|---|---|---|
| DEC-1 | Certificat de signature de code | demander à la PKI un certificat « Code Signing » au nom de l'entité ; sans lui, livraison avec empreinte SHA-256 |
| DEC-2 | Instance TEST pour l'E2E de l'installeur | indispensable avant tout installateur v2 : l'installeur actuel (lot gelé) n'a jamais été joué de bout en bout |
| DEC-3 | Politique de version | SemVer sur tag ; une version mineure par étape de l'étude (2.5.0 pour l'étape 5) |
| DEC-4 | Levée du gel du tracker | le gel date du 2026-09-04 « jusqu'à la fin du cycle mensuel » : le lever permet de livrer le RAG 90 % + le donut pondéré **et** de compiler le tracker (fin de Babel partout) |
| DEC-5 | React en version production | passer des builds `development` aux builds `production.min` (plus légers, sans avertissements) au moment de la compilation du tracker |

## 6. Critères de réception (état)
- Installation neuve < 20 min sur machine vierge : **à mesurer** (installateur v2).
- Mise à jour < 5 min avec retour arrière démontré : **à mesurer** (paquet CI).
- Première mise en production depuis un paquet CI : **non**.
- `server.js` < 3 000 lignes : **7 394** (cliquet en place).
- Aucune compilation dans le navigateur : **atteint** (lot 5.2) ; `tests/frontend-build.test.js` (liste d'exceptions vide).

## 7. Décisions prises (2026-10-22)

| # | Décision | Effet |
|---|---|---|
| DEC-1 | Certificat de signature de code : **oui**, demandé à la PKI | signature Authenticode dans la CI dès réception |
| DEC-2 | E2E de l'installeur actuel sur l'instance TEST **avant** tout installateur v2 | l'installateur v2 attend cet essai |
| DEC-4 | Gel du tracker **levé** | RAG 90 % + donut pondéré livrés ; tracker compilé (lot 5.2) |
| DEC-5 | React production | appliqué au tracker avec le lot 5.2 |
