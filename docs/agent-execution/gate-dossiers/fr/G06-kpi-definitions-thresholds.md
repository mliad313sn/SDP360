# Dossier de décision G06 — Définitions des indicateurs, seuils et score

[English version](../en/G06-kpi-definitions-thresholds.md)

| | |
|---|---|
| Porte de mise en production | KPI definitions, thresholds, score D-01/02/03 (G-12) |
| Rôle approbateur | Comité des indicateurs |
| Périmètre (RELEASE-GATES) | any official score |
| Case de décision dans RELEASE-GATES.md | vide — cette porte est **NO-GO** tant que l'approbateur ne l'a pas remplie. Ce dossier ne remplit rien. |
| Ce que cette porte bloque | ne bloque que le déploiement général |
| À décider après | aucune |
| SHA cible | `dca7df89` |
| Généré | 2026-11-19 |

## 1. La question à trancher

Quelles définitions d'indicateurs, quels seuils RAG et quel modèle de score de site deviennent officiels — tout ce qui est affiché d'ici là est marqué non approuvé ?

## 2. Preuves au SHA cible

| Preuve | Ce qu'elle montre | Régénérer / rejouer | Dernière modification (commit, date) | Empreinte |
|---|---|---|---|---|
| `docs/ops/SCORE-METHODOLOGY.md` | Méthodologie du score générée depuis le code ; D-03 ouverte | `node tools/agent/score-methodology.js --check` | 2cad73b9, 2026-11-06 | `3aa294827b43753f` |
| `docs/ops/METRIC-LINEAGE.md` | D'où vient chaque indicateur | `manual` | d7ff2bc1, 2026-11-13 | `bd8de3a4dfb63d0c` |
| `docs/sdp360/completion/KPI-DISPUTES.md` | Désaccords connus entre formules | `manual` | 3715318f, 2026-10-29 | `9fc347535aadd39a` |
| `services/metricRegistry.js` | Dictionnaire des indicateurs | `manual` | 997bf06b, 2026-11-13 | `4c307ac5c409e316` |
| `tests/kpi-policy-engine.test.js` | Comportement du moteur de politiques de seuils | `node --test --test-force-exit tests/kpi-policy-engine.test.js` | d5a8d2e7, 2026-11-05 | `177b5e67c6d4abe4` |
| `tests/kpi-rag.test.js` | Seuils RAG côté serveur | `node --test --test-force-exit tests/kpi-rag.test.js` | 367513cd, 2026-11-04 | `546602899c67bf56` |
| `docs/ai-decisions/ADR-C31-kpi-policy-builder.md` | Décision technique du constructeur de politiques | `manual` | d5a8d2e7, 2026-11-05 | `9388892ea0c9939b` |

**Preuves attendues des lots parallèles**

| Lot | Preuve attendue | Statut |
|---|---|---|
| P08 | Dossier de certification des indicateurs : un dossier par indicateur, test de parité, balayage des valeurs inconnues | livrée: `docs/agent-execution/P08-kpi-certification.md` (f0bf3c56, `f6fa35ee2b87b2f0`), `docs/agent-execution/P08-kpi-dossiers.md` (81ea0b81, `43c1fe4686ea0ce8`), `docs/agent-execution/P08-unknown-sweep.md` (a061dd46, `80ade81034a702d4`) |

## 3. Ce qui n'est pas prouvé, et pourquoi

- Aucun seuil n'est choisi ; les bandes RAG affichées sont des propositions.
- Deux modèles de score coexistent et divergent sur certains sites (par conception).
- Les chiffres historiques 2026 ne sont pas rapprochés (D-10, voir G12).

## 4. Options et conséquences

- Approuver définitions et seuils indicateur par indicateur.
- Faire le pilote avec des scores non certifiés clairement marqués, décider ensuite.
- Pas maintenant — la porte reste NO-GO ; aucun score ne peut être publié comme officiel.

## 5. Risques résiduels en cas d'accord aujourd'hui

- Un seuil choisi sans données de pilote colore mal les sites.
- Les sites comparent un score que le comité n'a pas validé.

## 6. Ce que l'approbateur doit fournir

- Définition et seuil approuvés par indicateur.
- Choix du score de site de référence (D-03).

---

_Généré par `node tools/release/gate-dossiers.js` à partir de `tools/release/gate-dossiers.source.js`. Préparé par un agent IA : un panel IA n'est pas une revue indépendante. `tests/gate-dossiers.test.js` échoue si une preuve citée a changé après la génération de ce dossier._
