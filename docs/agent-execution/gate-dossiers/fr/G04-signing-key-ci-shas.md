# Dossier de décision G04 — Clé de signature et actions CI épinglées

[English version](../en/G04-signing-key-ci-shas.md)

| | |
|---|---|
| Porte de mise en production | Signing key and CI action SHAs D-12 (G-09) |
| Rôle approbateur | Sécurité de l'information + responsable CI |
| Périmètre (RELEASE-GATES) | first signed release |
| Case de décision dans RELEASE-GATES.md | vide — cette porte est **NO-GO** tant que l'approbateur ne l'a pas remplie. Ce dossier ne remplit rien. |
| Ce que cette porte bloque | ne bloque que le déploiement général |
| À décider après | [G03](G03-cab-dependencies-postgres-only.md) CAB : mise à jour des dépendances et passage à PostgreSQL seul |
| SHA cible | `6457dcfa` |
| Généré | 2026-11-20 |

## 1. La question à trancher

Quelle clé signe les paquets de version, qui la détient, et les actions CI sont-elles épinglées sur des SHA vérifiés ?

## 2. Preuves au SHA cible

| Preuve | Ce qu'elle montre | Régénérer / rejouer | Dernière modification (commit, date) | Empreinte |
|---|---|---|---|---|
| `tests/update-package-signature.test.js` | Comportement de la vérification de signature des paquets | `node --test --test-force-exit tests/update-package-signature.test.js` | 6cb63aac, 2026-10-21 | `6de8613ddf017101` |
| `tools/manifest-public.pem` | Clé publique actuellement livrée (pas une décision de clé de production) | `manual` | 6cb63aac, 2026-10-21 | `96a5d1a57f291c4c` |
| `.github/workflows/ci.yml` | Workflow CI et ses références d'actions | `manual` | a1208217, 2026-11-19 | `1e629a1b51faf736` |
| `tests/ci-config.test.js` | Contrôles de la configuration CI | `node --test --test-force-exit tests/ci-config.test.js` | d51b714f, 2026-11-06 | `a48a78087437f513` |
| `tools/release/sbom.js` | Générateur de nomenclature logicielle (SBOM) | `node tools/release/sbom.js` | ee8b7a0c, 2026-11-12 | `73d25c84e6ac3228` |

## 3. Ce qui n'est pas prouvé, et pourquoi

- Aucune clé de signature de production n'existe ; la créer et la détenir est un acte humain.
- Les SHA épinglés n'ont pas été vérifiés par le responsable CI auprès des sources.

## 4. Options et conséquences

- Approuver un détenteur de clé et la liste des SHA.
- Approuver des paquets de TEST non signés uniquement, version signée plus tard.
- Pas maintenant — la porte reste NO-GO ; aucune version signée ne peut être produite.

## 5. Risques résiduels en cas d'accord aujourd'hui

- Un paquet non signé peut être substitué en transit.
- Une action non épinglée peut changer sous la construction.

## 6. Ce que l'approbateur doit fournir

- Nom du détenteur de la clé et lieu de stockage (jamais la clé).
- Liste des SHA vérifiés.

---

_Généré par `node tools/release/gate-dossiers.js` à partir de `tools/release/gate-dossiers.source.js`. Préparé par un agent IA : un panel IA n'est pas une revue indépendante. `tests/gate-dossiers.test.js` échoue si une preuve citée a changé après la génération de ce dossier._
