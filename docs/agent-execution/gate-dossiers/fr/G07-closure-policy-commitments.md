# Dossier de décision G07 — Politique de clôture des engagements

[English version](../en/G07-closure-policy-commitments.md)

| | |
|---|---|
| Porte de mise en production | Closure policy D-04 (G-17/G-18) — incl. who is told about A01/A02 escalations |
| Rôle approbateur | Responsables métier/contrôle + Comité |
| Périmètre (RELEASE-GATES) | `commitments_enabled=1` |
| Case de décision dans RELEASE-GATES.md | vide — cette porte est **NO-GO** tant que l'approbateur ne l'a pas remplie. Ce dossier ne remplit rien. |
| Ce que cette porte bloque | ne bloque le pilote que si sa fonction est dans le périmètre du pilote |
| À décider après | [G06](G06-kpi-definitions-thresholds.md) Définitions des indicateurs, seuils et score |
| SHA cible | `8b9acc0c` |
| Généré | 2026-11-20 |

## 1. La question à trancher

Qui peut vérifier et clore un engagement, qui accepte le risque résiduel, et qui est prévenu quand les escalades A01/A02 se déclenchent — avant d'activer commitments_enabled ?

## 2. Preuves au SHA cible

| Preuve | Ce qu'elle montre | Régénérer / rejouer | Dernière modification (commit, date) | Empreinte |
|---|---|---|---|---|
| `docs/sdp360/completion/GOVERNANCE-POLICIES.md` | Chaque règle de gouvernance comme paramètre, avec sa valeur par défaut | `manual` | 68780d5b, 2026-11-05 | `a31f78303695bbcd` |
| `docs/sdp360/completion/GOVERNANCE-LIFECYCLE.md` | Cycle de vie des engagements | `manual` | f69d7fa2, 2026-10-28 | `040eb0f33a500f96` |
| `tests/commitment-lifecycle.test.js` | Règles du cycle de vie | `node --test --test-force-exit tests/commitment-lifecycle.test.js` | f69d7fa2, 2026-10-28 | `9a208f003a2f7bb8` |
| `tests/commitment-escalation.test.js` | Règles d'escalade | `node --test --test-force-exit tests/commitment-escalation.test.js` | 2054b544, 2026-10-28 | `f7858855a224b5c0` |
| `tests/commitments-routes.smoke.test.js` | Les routes répondent 404 tant que l'interrupteur est éteint | `node --test --test-force-exit tests/commitments-routes.smoke.test.js` | 8253c5e3, 2026-11-19 | `94ba4439ac4f8225` |
| `docs/ops/FLAG-REGISTER.json` | Registre des interrupteurs : défaut, responsable (à nommer) | `node tools/agent/flag-register.js` | 8081ee61, 2026-11-20 | `e4e2a1fc74da10d5` |

**Preuves attendues des lots parallèles**

| Lot | Preuve attendue | Statut |
|---|---|---|
| P03 | Lots d'activation des interrupteurs (quel lot porte commitments_enabled) | livrée: `docs/agent-execution/P03-switch-lots.md` (e3a38ce3, `99419412678af916`) |

## 3. Ce qui n'est pas prouvé, et pourquoi

- Aucun responsable métier n'a nommé de vérificateurs ni de destinataires d'escalade.
- Testé uniquement avec des personas synthétiques.

## 4. Options et conséquences

- Approuver la politique et activer l'interrupteur sur TEST.
- Approuver la politique, garder l'interrupteur éteint pour le pilote.
- Pas maintenant — la porte reste NO-GO ; les engagements restent masqués (les routes répondent 404).

## 5. Risques résiduels en cas d'accord aujourd'hui

- Une fin technique lue comme une clôture métier.
- Des escalades envoyées à personne, ou aux mauvaises personnes.

## 6. Ce que l'approbateur doit fournir

- Rôles vérificateurs par site.
- Destinataires des escalades A01/A02.
- Fenêtre de service avant escalade.

---

_Généré par `node tools/release/gate-dossiers.js` à partir de `tools/release/gate-dossiers.source.js`. Préparé par un agent IA : un panel IA n'est pas une revue indépendante. `tests/gate-dossiers.test.js` échoue si une preuve citée a changé après la génération de ce dossier._
