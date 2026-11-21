# Dossier de décision G14 — Finance : budgets et bénéfices

[English version](../en/G14-finance-budgets-benefits.md)

| | |
|---|---|
| Porte de mise en production | Finance — budgets and benefits (G14) |
| Rôle approbateur | Finance |
| Périmètre (RELEASE-GATES) | financial figures |
| Case de décision dans RELEASE-GATES.md | vide — cette porte est **NO-GO** tant que l'approbateur ne l'a pas remplie. Ce dossier ne remplit rien. |
| Ce que cette porte bloque | ne bloque le pilote que si sa fonction est dans le périmètre du pilote |
| À décider après | [G06](G06-kpi-definitions-thresholds.md) Définitions des indicateurs, seuils et score |
| SHA cible | `bcc729eb` |
| Généré | 2026-11-21 |

## 1. La question à trancher

Les montants de budget, de réalisé et de bénéfices peuvent-ils être affichés comme certifiés, et selon quelles règles de devise et de taux ?

## 2. Preuves au SHA cible

| Preuve | Ce qu'elle montre | Régénérer / rejouer | Dernière modification (commit, date) | Empreinte |
|---|---|---|---|---|
| `docs/ops/FINANCE-CURRENCY-RULES.md` | Chaque chemin monétaire et la décision Finance en attente | `manual` | 0e354435, 2026-11-12 | `94fb27478e4448fd` |
| `docs/ai-decisions/ADR-P2-finance-certification-and-actuals.md` | Conception de la certification financière | `manual` | d99fa409, 2026-11-12 | `7d19b7ee8a532142` |
| `tests/finance-certification.test.js` | Comportement de la certification | `node --test --test-force-exit tests/finance-certification.test.js` | 70fdac00, 2026-11-12 | `e1e384936ef23251` |
| `tests/portfolio-benefits.test.js` | Comportement du suivi des bénéfices | `node --test --test-force-exit tests/portfolio-benefits.test.js` | 8a71aa64, 2026-11-12 | `34563da060425125` |
| `docs/sdp360/completion/TCO-TEMPLATE.csv` | Modèle de coût total | `manual` | 8d8a7899, 2026-10-29 | `97ee1fda0a6b3c55` |

**Preuves attendues des lots parallèles**

| Lot | Preuve attendue | Statut |
|---|---|---|
| P04 | Rapport de certification PPM (contrôles financiers inclus) | livrée: `docs/agent-execution/P04-ppm-certification.md` (34acf361, `ce601c12654f688f`) |

## 3. Ce qui n'est pas prouvé, et pourquoi

- Aucun montant validé par la Finance ; les montants sont non certifiés.
- Source du taux de change non approuvée.

## 4. Options et conséquences

- Approuver les règles de devise et certifier par projet.
- Afficher les montants comme non certifiés pendant le pilote.
- Pas maintenant — la porte reste NO-GO ; les montants restent non certifiés.

## 5. Risques résiduels en cas d'accord aujourd'hui

- Un montant converti lu comme un chiffre comptable.

## 6. Ce que l'approbateur doit fournir

- Source du taux.
- Rôle certificateur.

---

_Généré par `node tools/release/gate-dossiers.js` à partir de `tools/release/gate-dossiers.source.js`. Préparé par un agent IA : un panel IA n'est pas une revue indépendante. `tests/gate-dossiers.test.js` échoue si une preuve citée a changé après la génération de ce dossier._
