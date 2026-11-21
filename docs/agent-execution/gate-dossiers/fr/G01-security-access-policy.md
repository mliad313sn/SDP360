# Dossier de décision G01 — Sécurité : politique d'accès et matrice d'autorisation

[English version](../en/G01-security-access-policy.md)

| | |
|---|---|
| Porte de mise en production | Security — access policy CG-01/CG-02, authz matrix (G-03…G-08) |
| Rôle approbateur | Sécurité de l'information |
| Périmètre (RELEASE-GATES) | release |
| Case de décision dans RELEASE-GATES.md | vide — cette porte est **NO-GO** tant que l'approbateur ne l'a pas remplie. Ce dossier ne remplit rien. |
| Ce que cette porte bloque | bloque le pilote sur deux sites (instance de TEST) |
| À décider après | [G19](G19-qa-ci-green.md) QA : CI verte et tests sautés revus |
| SHA cible | `fcc4d77c` |
| Généré | 2026-11-21 |

## 1. La question à trancher

Les règles d'accès (périmètre de site des comptes métier CG-01, plus de lecture de toute la flotte pour les réunions et inspections CG-02, matrice route × rôle) correspondent-elles à la politique d'accès que vous voulez appliquer aux utilisateurs du pilote ?

## 2. Preuves au SHA cible

| Preuve | Ce qu'elle montre | Régénérer / rejouer | Dernière modification (commit, date) | Empreinte |
|---|---|---|---|---|
| `docs/ops/authz-matrix.json` | Matrice route × garde × capacité lisible par machine, régénérée depuis le code | `AUTHZ_MATRIX_UPDATE=1 node --test --test-force-exit tests/authz-matrix-json.test.js` | afc07f86, 2026-11-20 | `b3f808d2872c981d` |
| `docs/ops/AUTHZ-MATRIX.md` | Matrice lisible de chaque route d'API et du rôle exigé | `AUTHZ_MATRIX_UPDATE=1 node --test --test-force-exit tests/authz-route-matrix.test.js` | 3df35be7, 2026-11-21 | `b718b64fff1f6f6f` |
| `tests/authz-route-matrix.test.js` | Échoue si une route est ajoutée ou si sa garde change sans régénérer la matrice | `node --test --test-force-exit tests/authz-route-matrix.test.js` | 3df35be7, 2026-11-21 | `3d3f4473adcf7cf3` |
| `tests/authz-enforce.test.js` | Comportement de l'application des capacités | `node --test --test-force-exit tests/authz-enforce.test.js` | 30243287, 2026-11-12 | `9298b189390ba23a` |
| `docs/sdp360/completion/AUTHZ-OBJECT-MATRIX.csv` | Matrice d'accès par objet (qui lit ou écrit quel objet) | `manual (object-level review)` | 040c228f, 2026-10-28 | `ed72b52d09da051b` |
| `docs/ops/PORTFOLIO-ACCESS-MATRIX.md` | Règles d'accès portefeuille/projet | `manual` | 2da52d5d, 2026-11-12 | `dc11f6254a1a83cc` |
| `docs/sdp360/consolidation/02-GAP-AND-RISK-REGISTER.md` | Constats CG-01 et CG-02 et leur état de correction | `manual` | 350e0c4e, 2026-10-28 | `4e6870a0f759f7e6` |

**Preuves attendues des lots parallèles**

| Lot | Preuve attendue | Statut |
|---|---|---|
| P02 | Rapport de la sonde des résultats d'autorisation (chaque route × persona, codes observés) | livrée: `docs/agent-execution/P02-authz-outcomes.md` (9007a5c4, `1b3c7c2278a4e5d1`) |
| P02 | Instantané des résultats utilisé par le test de la sonde | livrée: `docs/ops/authz-outcomes.json` (76b55aef, `fda67d3d4631a228`) |

## 3. Ce qui n'est pas prouvé, et pourquoi

- Aucun testeur indépendant n'a éprouvé les règles ; tous les tests ont été écrits par les agents de livraison.
- La matrice prouve la garde déclarée par chaque route ; que chaque persona obtienne la réponse attendue relève de la sonde P02 (attendue).
- Les droits par département (D-14) ne sont pas construits : le modèle est par site uniquement.

## 4. Options et conséquences

- GO pour le pilote avec le modèle par site — les utilisateurs pilotes ne voient que leur site.
- GO sous conditions — par exemple une liste nommée de routes à restreindre d'abord, ou la sonde P02 rejouée sur le SHA du pilote.
- Pas maintenant — la porte reste NO-GO ; aucun compte pilote ne peut être ouvert.

## 5. Risques résiduels en cas d'accord aujourd'hui

- Une règle d'accès non couverte par les tests laisse voir les données d'un autre site.
- Les comptes du palier admin sont sans restriction par conception ; leur nombre est une décision distincte (audit des rôles).

## 6. Ce que l'approbateur doit fournir

- Nom et date dans la ligne de RELEASE-GATES.
- La liste des comptes pilotes et de leurs rôles.
- Si l'accès par département (D-14) est exigé avant ou après le pilote.

---

_Généré par `node tools/release/gate-dossiers.js` à partir de `tools/release/gate-dossiers.source.js`. Préparé par un agent IA : un panel IA n'est pas une revue indépendante. `tests/gate-dossiers.test.js` échoue si une preuve citée a changé après la génération de ce dossier._
