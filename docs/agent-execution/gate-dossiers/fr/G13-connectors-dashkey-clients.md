# Dossier de décision G13 — Connecteurs et clients à clé

[English version](../en/G13-connectors-dashkey-clients.md)

| | |
|---|---|
| Porte de mise en production | Connectors D-07/D-08/D-09, dash-key clients D-15 (D-06 Meraki: kept by requester decision) |
| Rôle approbateur | Responsables plateforme/infra |
| Périmètre (RELEASE-GATES) | connector changes |
| Case de décision dans RELEASE-GATES.md | vide — cette porte est **NO-GO** tant que l'approbateur ne l'a pas remplie. Ce dossier ne remplit rien. |
| Ce que cette porte bloque | ne bloque le pilote que si sa fonction est dans le périmètre du pilote |
| À décider après | [G01](G01-security-access-policy.md) Sécurité : politique d'accès et matrice d'autorisation |
| SHA cible | `a7565f27` |
| Généré | 2026-11-20 |

## 1. La question à trancher

Quels changements de connecteurs approuvez-vous (retrait de Meridian D-07, recherche 4MyPeople D-08, calendrier Microsoft 365 D-09), et qui appelle les routes à clé seule (D-15) pour pouvoir les restreindre ? Meraki reste (D-06).

## 2. Preuves au SHA cible

| Preuve | Ce qu'elle montre | Régénérer / rejouer | Dernière modification (commit, date) | Empreinte |
|---|---|---|---|---|
| `docs/sdp360/completion/CONNECTOR-REGISTER.csv` | Registre des connecteurs | `manual` | c0520254, 2026-11-06 | `ccef4d1f315b7ce6` |
| `docs/agent-execution/CONNECTOR-QUALIFICATION-2026-11-12.md` | Qualification des connecteurs | `manual` | 1652132b, 2026-11-12 | `61d3bf548d1b22bb` |
| `docs/sdp360/completion/DASHKEY-CLIENTS.md` | Les 16 routes à clé seule | `node tools/security/dashkey-consumers.js` | d22d3660, 2026-10-29 | `20bc1779dccad33b` |
| `tests/dashkey-only-routes.smoke.test.js` | Fige la liste des routes à clé seule | `node --test --test-force-exit tests/dashkey-only-routes.smoke.test.js` | 30243287, 2026-11-12 | `91e89f55d8322cce` |
| `tests/connector-register.test.js` | Audit des connecteurs exclus | `node --test --test-force-exit tests/connector-register.test.js` | d015a67e, 2026-11-13 | `861cf2333f8b53cb` |
| `docs/ai-decisions/ADR-A20-meridian-retirement.md` | Proposition de retrait de Meridian | `manual` | 05521371, 2026-11-04 | `e652337d1a04e09f` |

## 3. Ce qui n'est pas prouvé, et pourquoi

- Aucun responsable n'a listé les appelants externes de la clé.
- Les lectures des connecteurs n'ont pas été jouées par l'agent contre les sources de production.

## 4. Options et conséquences

- Approuver chaque décision de connecteur séparément.
- Garder les connecteurs en l'état pour le pilote.
- Pas maintenant — la porte reste NO-GO ; les routes à clé restent ouvertes comme aujourd'hui.

## 5. Risques résiduels en cas d'accord aujourd'hui

- Restreindre une route casse une tâche planifiée que personne n'avait listée.

## 6. Ce que l'approbateur doit fournir

- Liste des appelants de la clé.
- Décision par connecteur.

---

_Généré par `node tools/release/gate-dossiers.js` à partir de `tools/release/gate-dossiers.source.js`. Préparé par un agent IA : un panel IA n'est pas une revue indépendante. `tests/gate-dossiers.test.js` échoue si une preuve citée a changé après la génération de ce dossier._
