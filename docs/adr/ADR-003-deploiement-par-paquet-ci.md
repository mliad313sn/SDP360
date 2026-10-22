# ADR-003 — Livraison par paquet construit en CI depuis un tag

Statut : **partiellement appliqué** (étape 5 de SDP-DASH-2.0, 2026-10-22) — points 1 et 4 faits au lot 5.6
(`tools/release/`, `.github/workflows/release.yml`, `/health` → `version`) ; points 2 et 3 en attente. Dépend de DEC-1 (certificat de signature) et
DEC-2 (essai de bout en bout de l'installeur actuel sur l'instance TEST, préalable à toute v2).

## Contexte

Le déploiement actuel construit sur le poste de dev un ZIP des fichiers modifiés depuis un marqueur
(`.git/last-deployed`). Un fichier « derrière le marqueur » (ZIP appliqué en partie) ne repart jamais : d'où le
registre `tools/deploy/frozen-lots.json` et l'option `-Include`. Rien ne prouve ce qui tourne en production.

## Décision

1. La CI construit, depuis un tag SemVer (`v2.5.0`), un paquet **complet** : arbre de l'application, `node_modules`
   de production, `manifest.json` (version, commit, date, fichiers + SHA-256, version minimale de départ).
2. Le paquet et `Setup.exe` (Inno Setup, moteur `Install-SDP.ps1` inchangé) sont signés Authenticode avec
   horodatage ; sans certificat, l'empreinte SHA-256 est publiée avec la release.
3. Le Manager applique un paquet : vérification (signature + manifeste) → point de restauration + dump PG →
   arrêt pm2 → remplacement de l'arbre → `node db/migrate.js --apply` → démarrage → sonde `/health`.
   Toute étape en échec restaure l'arbre et le dump.
4. `/health` affiche la version du tag : on sait ce qui tourne.

## Conséquences

- Disparaissent après la première livraison CI : `_deploy.cmd`, `make-deploy-zip.ps1`, `_apply_on_prod.cmd`,
  `mark-deployed.cmd`, le marqueur et `frozen-lots.json`.
- Tant que DEC-1 et DEC-2 ne sont pas levés, le modèle ZIP reste la procédure (`docs/sop/SOP-deploy.md`).
