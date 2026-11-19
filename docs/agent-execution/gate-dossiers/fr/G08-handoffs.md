# Dossier de décision G08 — Passations entre départements

[English version](../en/G08-handoffs.md)

| | |
|---|---|
| Porte de mise en production | Handoffs (G-22) — enable, notification recipients, user↔department mapping if wanted |
| Rôle approbateur | Sponsor / PO + Comité |
| Périmètre (RELEASE-GATES) | `handoffs_enabled=1`, `handoff_notify_enabled=1` |
| Case de décision dans RELEASE-GATES.md | vide — cette porte est **NO-GO** tant que l'approbateur ne l'a pas remplie. Ce dossier ne remplit rien. |
| Ce que cette porte bloque | ne bloque le pilote que si sa fonction est dans le périmètre du pilote |
| À décider après | [G07](G07-closure-policy-commitments.md) Politique de clôture des engagements |
| SHA cible | `e8900a7` |
| Généré | 2026-11-19 |

## 1. La question à trancher

Faut-il activer les passations entre départements, qui est notifié, et voulez-vous une correspondance utilisateur-département ?

## 2. Preuves au SHA cible

| Preuve | Ce qu'elle montre | Régénérer / rejouer | Dernière modification (commit, date) | Empreinte |
|---|---|---|---|---|
| `docs/sdp360/completion/HANDOFF-STATE-MACHINE.md` | Machine d'états des passations ; statut IMPLÉMENTÉ · TESTÉ | `manual` | f69d7fa2, 2026-10-28 | `723be948071357f3` |
| `tests/handoff-lifecycle.test.js` | Règles du cycle de vie | `node --test --test-force-exit tests/handoff-lifecycle.test.js` | f69d7fa2, 2026-10-28 | `c4ec820897b7017f` |
| `tests/handoffs.smoke.test.js` | Comportement des routes et de l'interrupteur | `node --test --test-force-exit tests/handoffs.smoke.test.js` | 4aea9ddf, 2026-10-29 | `0d9fc06bd54be1d0` |

**Preuves attendues des lots parallèles**

| Lot | Preuve attendue | Statut |
|---|---|---|
| P03 | Lots d'activation (handoffs_enabled, handoff_notify_enabled) | attendue — absente de l'arbre au SHA cible (`docs/agent-execution/P03-*.md`) |

## 3. Ce qui n'est pas prouvé, et pourquoi

- Non validé sur le terrain, non déployé, non accepté.
- Aucune liste de destinataires.

## 4. Options et conséquences

- Activer les passations sans notifications d'abord.
- Activer les deux avec des destinataires nommés.
- Pas maintenant — la porte reste NO-GO ; les routes continuent de répondre 404.

## 5. Risques résiduels en cas d'accord aujourd'hui

- Passations envoyées à une personne partie.
- Bruit de notifications.

## 6. Ce que l'approbateur doit fournir

- Destinataires.
- Source de la correspondance si voulue.

---

_Généré par `node tools/release/gate-dossiers.js` à partir de `tools/release/gate-dossiers.source.js`. Préparé par un agent IA : un panel IA n'est pas une revue indépendante. `tests/gate-dossiers.test.js` échoue si une preuve citée a changé après la génération de ce dossier._
