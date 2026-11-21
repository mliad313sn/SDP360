# Dossier de décision G16 — Juridique et commercial

[English version](../en/G16-legal-commercial.md)

| | |
|---|---|
| Porte de mise en production | Legal / commercial (G-38/G-39) |
| Rôle approbateur | Juridique + responsable commercial |
| Périmètre (RELEASE-GATES) | market release |
| Case de décision dans RELEASE-GATES.md | vide — cette porte est **NO-GO** tant que l'approbateur ne l'a pas remplie. Ce dossier ne remplit rien. |
| Ce que cette porte bloque | ne bloque que la diffusion hors d'Endeavour |
| À décider après | aucune |
| SHA cible | `33d8a0f3` |
| Généré | 2026-11-21 |

## 1. La question à trancher

SDP360 et ses composants tiers embarqués peuvent-ils être diffusés hors d'Endeavour, et sous quelle licence ?

## 2. Preuves au SHA cible

| Preuve | Ce qu'elle montre | Régénérer / rejouer | Dernière modification (commit, date) | Empreinte |
|---|---|---|---|---|
| `docs/sdp360/completion/RIGHTS-REGISTER.md` | Registre des droits ; usage interne tant que le Juridique n'a pas tranché | `manual` | 8d8a7899, 2026-10-29 | `ad4960d9bc4e2c55` |
| `docs/sdp360/completion/LICENCE-INVENTORY.csv` | Inventaire des licences tierces | `node tools/release/licence-inventory.js --csv docs/sdp360/completion/LICENCE-INVENTORY.csv` | 0103bf05, 2026-11-12 | `7ac05bbb06c244bf` |
| `tests/licence-inventory.test.js` | L'inventaire reste aligné sur le lockfile | `node --test --test-force-exit tests/licence-inventory.test.js` | 3baf3701, 2026-10-29 | `3d82d911b6ae4fce` |
| `LICENSE` | Licence actuelle (usage interne) | `manual` | d1855d33, 2026-10-19 | `db436fd34244ed7a` |

## 3. Ce qui n'est pas prouvé, et pourquoi

- Termes de redistribution EDB et Microsoft non revus par le Juridique.
- Propriété du code contribué non confirmée.

## 4. Options et conséquences

- Garder l'usage interne seulement.
- Autoriser la diffusion sous une licence nommée.
- Pas maintenant — la porte reste NO-GO ; usage interne seulement (sans effet sur le pilote).

## 5. Risques résiduels en cas d'accord aujourd'hui

- Redistribuer un composant embarqué hors de ses termes.

## 6. Ce que l'approbateur doit fournir

- Avis juridique et choix de licence.

---

_Généré par `node tools/release/gate-dossiers.js` à partir de `tools/release/gate-dossiers.source.js`. Préparé par un agent IA : un panel IA n'est pas une revue indépendante. `tests/gate-dossiers.test.js` échoue si une preuve citée a changé après la génération de ce dossier._
