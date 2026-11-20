# Dossier de décision G15 — Produit : acceptation métier

[English version](../en/G15-product-business-acceptance.md)

| | |
|---|---|
| Porte de mise en production | Product — business acceptance |
| Rôle approbateur | Sponsor / PO |
| Périmètre (RELEASE-GATES) | release |
| Case de décision dans RELEASE-GATES.md | vide — cette porte est **NO-GO** tant que l'approbateur ne l'a pas remplie. Ce dossier ne remplit rien. |
| Ce que cette porte bloque | ne bloque que le déploiement général |
| À décider après | [G11](G11-pilot-sites-field-uat.md) Sites pilotes et recette terrain · [G21](G21-business-witness-project.md) Projet témoin métier · [G06](G06-kpi-definitions-thresholds.md) Définitions des indicateurs, seuils et score |
| SHA cible | `fc6f37f3` |
| Généré | 2026-11-20 |

## 1. La question à trancher

Après le pilote, le produit fait-il ce dont le métier a besoin suffisamment bien pour être déployé sur tous les sites ?

## 2. Preuves au SHA cible

| Preuve | Ce qu'elle montre | Régénérer / rejouer | Dernière modification (commit, date) | Empreinte |
|---|---|---|---|---|
| `docs/sdp360/completion/TRUTH-MATRIX.md` | Matrice de vérité : ce qui est implémenté, testé, validé | `manual` | 5dc0c25c, 2026-11-19 | `f4318da0bef49eb8` |
| `docs/ops/PERSONA-JOURNEYS.md` | Correspondance persona-parcours | `manual` | 7b6b0abb, 2026-11-20 | `33d8093051f71d12` |
| `docs/audits/2026-11-12-enterprise-review/UAT-COMITE-UTILISATEURS.md` | Revue d'un comité utilisateurs IA (pas de vrais utilisateurs) | `manual` | d6a7f2bb, 2026-11-12 | `222de56c07458f00` |
| `docs/agent-execution/G24-DOSSIER-GO-NOGO-FR.md` | Dossier GO/NO-GO antérieur (pilote conditionnel, production NO-GO) | `node --test --test-force-exit tests/release-dossier.test.js` | d6695109, 2026-11-05 | `0130ead17d7d9889` |

**Preuves attendues des lots parallèles**

| Lot | Preuve attendue | Statut |
|---|---|---|
| P09 | Kit d'adoption et tâches par profil | livrée: `docs/agent-execution/P09-PAGE-INVENTORY.md` (e1118e1d, `242aaec9fedf8f15`), `docs/agent-execution/P09-adoption-kit.md` (c9bab46d, `8246fb83ee6409fc`) |
| P04 | Rapport de certification PPM | livrée: `docs/agent-execution/P04-ppm-certification.md` (34acf361, `ce601c12654f688f`) |

## 3. Ce qui n'est pas prouvé, et pourquoi

- Aucun résultat de pilote, aucune donnée d'usage de vrais utilisateurs.

## 4. Options et conséquences

- Accepter pour le déploiement général.
- Accepter un sous-ensemble de modules.
- Pas maintenant — la porte reste NO-GO ; le déploiement reste limité au pilote.

## 5. Risques résiduels en cas d'accord aujourd'hui

- Faible adoption après déploiement.

## 6. Ce que l'approbateur doit fournir

- Critères d'acceptation et revue du rapport de pilote.

---

_Généré par `node tools/release/gate-dossiers.js` à partir de `tools/release/gate-dossiers.source.js`. Préparé par un agent IA : un panel IA n'est pas une revue indépendante. `tests/gate-dossiers.test.js` échoue si une preuve citée a changé après la génération de ce dossier._
