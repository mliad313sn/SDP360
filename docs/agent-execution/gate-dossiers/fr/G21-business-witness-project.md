# Dossier de décision G21 — Projet témoin métier

[English version](../en/G21-business-witness-project.md)

| | |
|---|---|
| Porte de mise en production | Business witness project (E-B05) |
| Rôle approbateur | PMO |
| Périmètre (RELEASE-GATES) | pilot |
| Case de décision dans RELEASE-GATES.md | vide — cette porte est **NO-GO** tant que l'approbateur ne l'a pas remplie. Ce dossier ne remplit rien. |
| Ce que cette porte bloque | bloque le pilote sur deux sites (instance de TEST) |
| À décider après | [G11](G11-pilot-sites-field-uat.md) Sites pilotes et recette terrain |
| SHA cible | `e57c188029b72bc62b7d9b2a88fbbe4d534c0322` |
| Généré | 2026-11-20 |

## 1. La question à trancher

Quel vrai projet est mené de bout en bout dans l'outil projet natif pendant le pilote comme témoin, et qui certifie le résultat ?

## 2. Preuves au SHA cible

| Preuve | Ce qu'elle montre | Régénérer / rejouer | Dernière modification (commit, date) | Empreinte |
|---|---|---|---|---|
| `docs/audits/2026-11-12-ppm-parity/README.md` | Audit de parité PPM | `manual` | 22297777, 2026-11-19 | `ff260eeeb2e1fa2d` |
| `docs/ppm/W2-ENGINE-CONTRACT.md` | Contrat du moteur de planification | `manual` | e1980be4, 2026-11-13 | `c804f7098180f0fb` |
| `docs/ai-decisions/ADR-G11-native-ppm.md` | Décision PPM natif | `manual` | a559483d, 2026-10-29 | `ffb3fd79864b574e` |
| `tests/ppm-evm.test.js` | Comportement de la valeur acquise | `node --test --test-force-exit tests/ppm-evm.test.js` | 434b7434, 2026-11-12 | `e8ee5fb5d340a676` |

**Preuves attendues des lots parallèles**

| Lot | Preuve attendue | Statut |
|---|---|---|
| P04 | Certification PPM (statut, kits d'interopérabilité et de témoin) | livrée: `docs/agent-execution/P04-ppm-certification.md` (34acf361, `ce601c12654f688f`) |

## 3. Ce qui n'est pas prouvé, et pourquoi

- Aucun projet témoin choisi ; le PPM n'est pas certifié.

## 4. Options et conséquences

- Nommer un projet témoin et son chef de projet.
- Faire le pilote sans PPM.
- Pas maintenant — la porte reste NO-GO ; le PPM reste non certifié.

## 5. Risques résiduels en cas d'accord aujourd'hui

- Un vrai projet dépend d'un outil non certifié.

## 6. Ce que l'approbateur doit fournir

- Nom du projet, chef de projet, critères de certification.

---

_Généré par `node tools/release/gate-dossiers.js` à partir de `tools/release/gate-dossiers.source.js`. Préparé par un agent IA : un panel IA n'est pas une revue indépendante. `tests/gate-dossiers.test.js` échoue si une preuve citée a changé après la génération de ce dossier._
