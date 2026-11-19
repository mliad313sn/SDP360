# Dossier de décision G20 — Capacité : charge et endurance

[English version](../en/G20-capacity-load-soak.md)

| | |
|---|---|
| Porte de mise en production | Capacity — load / soak result accepted (E-B05) |
| Rôle approbateur | SRE + DBA |
| Périmètre (RELEASE-GATES) | release |
| Case de décision dans RELEASE-GATES.md | vide — cette porte est **NO-GO** tant que l'approbateur ne l'a pas remplie. Ce dossier ne remplit rien. |
| Ce que cette porte bloque | ne bloque que le déploiement général |
| À décider après | [G03](G03-cab-dependencies-postgres-only.md) CAB : mise à jour des dépendances et passage à PostgreSQL seul |
| SHA cible | `2b35374c` |
| Généré | 2026-11-19 |

## 1. La question à trancher

Le comportement mesuré sous charge est-il acceptable pour tous les sites, et quels budgets de latence et d'erreurs fixez-vous ?

## 2. Preuves au SHA cible

| Preuve | Ce qu'elle montre | Régénérer / rejouer | Dernière modification (commit, date) | Empreinte |
|---|---|---|---|---|
| `docs/ops/LOAD-TEST.md` | Banc de charge ; aucun seuil fixé | `node tools/test/load.js` | 10d740d5, 2026-11-06 | `53f53d38530825af` |
| `tests/load-harness.test.js` | Comportement du banc | `node --test --test-force-exit tests/load-harness.test.js` | 10d740d5, 2026-11-06 | `392a026b45e56610` |
| `docs/agent-execution/PERF-BASELINE.md` | Observation de performance sur données synthétiques | `node tools/test/perf-baseline.js` | 84b66a54, 2026-11-06 | `87bb8122e2371fc4` |
| `docs/ops/CAPACITY-DATA-CONTRACT.md` | Contrat de données de capacité | `manual` | 98cc8b50, 2026-11-12 | `2789abf32313a7a5` |
| `docs/agent-execution/EXPLAIN-SYNTHETIC.md` | Plans de requêtes sur données synthétiques | `node tools/pg/explain-hot.js` | 696e88db, 2026-11-06 | `540ce1ac9f95d382` |

**Preuves attendues des lots parallèles**

| Lot | Preuve attendue | Statut |
|---|---|---|
| P05 | Proposition de budgets de performance et de niveaux de service avec résultats de charge | attendue — absente de l'arbre au SHA cible (`docs/agent-execution/P05-*.md`) |

## 3. Ce qui n'est pas prouvé, et pourquoi

- Aucune endurance sur volume ou matériel proche de la production.
- Aucun budget choisi.

## 4. Options et conséquences

- Fixer les budgets et accepter le résultat.
- Lancer une endurance sur TEST d'abord.
- Pas maintenant — la porte reste NO-GO ; le déploiement général reste bloqué.

## 5. Risques résiduels en cas d'accord aujourd'hui

- Pages lentes aux pics de fin de mois.

## 6. Ce que l'approbateur doit fournir

- Budgets de latence et d'erreurs.
- Nombre d'utilisateurs attendu par site.

---

_Généré par `node tools/release/gate-dossiers.js` à partir de `tools/release/gate-dossiers.source.js`. Préparé par un agent IA : un panel IA n'est pas une revue indépendante. `tests/gate-dossiers.test.js` échoue si une preuve citée a changé après la génération de ce dossier._
