# Dossier de décision G19 — QA : CI verte et tests sautés revus

[English version](../en/G19-qa-ci-green.md)

| | |
|---|---|
| Porte de mise en production | QA lead — CI green on the target SHA, skipped tests reviewed (E-B05) |
| Rôle approbateur | Responsable QA |
| Périmètre (RELEASE-GATES) | release |
| Case de décision dans RELEASE-GATES.md | vide — cette porte est **NO-GO** tant que l'approbateur ne l'a pas remplie. Ce dossier ne remplit rien. |
| Ce que cette porte bloque | bloque le pilote sur deux sites (instance de TEST) |
| À décider après | aucune |
| SHA cible | `8b9acc0c` |
| Généré | 2026-11-20 |

## 1. La question à trancher

L'intégration continue est-elle verte sur le SHA cible, et acceptez-vous chaque test sauté et sa raison ?

## 2. Preuves au SHA cible

| Preuve | Ce qu'elle montre | Régénérer / rejouer | Dernière modification (commit, date) | Empreinte |
|---|---|---|---|---|
| `.github/workflows/ci.yml` | Tâches CI (unitaires, parcours navigateur) | `manual` | a1208217, 2026-11-19 | `1e629a1b51faf736` |
| `tests/.suite-manifest.json` | Recensement revu des tests par fichier | `npm test -- --update-manifest` | 60d16efb, 2026-11-20 | `3d9ec804d51c5f22` |
| `tests/.skip-allowlist.json` | Chaque saut autorisé et sa raison | `manual` | 090d541f, 2026-11-06 | `d0fb199d188863a5` |
| `tools/test/run-all.js` | Lanceur de la suite complète | `node tools/test/run-all.js` | a8a31c3e, 2026-11-19 | `b8e6013f1d72bc84` |
| `docs/agent-execution/DELIVERY-QUALITY.md` | Indicateurs de qualité de livraison | `node tools/release/delivery-metrics.js` | f5acdadf, 2026-11-06 | `1aca3f9dbc393523` |

**Preuves attendues des lots parallèles**

| Lot | Preuve attendue | Statut |
|---|---|---|
| P01 | Référence unique avec le résultat de suite complète sur un SHA | attendue — absente de l'arbre au SHA cible (`docs/agent-execution/P01-*.md`) |

## 3. Ce qui n'est pas prouvé, et pourquoi

- La dernière suite complète consignée (passation de l'orchestrateur) avait 3 échecs et la CI était rouge ; une exécution verte sur le SHA cible reste à produire après la fusion de P01–P10.

## 4. Options et conséquences

- Accepter la CI verte et la liste des sauts.
- Accepter avec des sauts nommés à lever avant déploiement.
- Pas maintenant — la porte reste NO-GO ; aucune version ne peut aller sur TEST.

## 5. Risques résiduels en cas d'accord aujourd'hui

- Un test sauté cache un défaut.

## 6. Ce que l'approbateur doit fournir

- Lien vers l'exécution CI verte sur le SHA cible.

---

_Généré par `node tools/release/gate-dossiers.js` à partir de `tools/release/gate-dossiers.source.js`. Préparé par un agent IA : un panel IA n'est pas une revue indépendante. `tests/gate-dossiers.test.js` échoue si une preuve citée a changé après la génération de ce dossier._
