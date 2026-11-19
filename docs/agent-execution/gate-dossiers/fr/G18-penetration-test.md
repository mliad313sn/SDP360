# Dossier de décision G18 — Test d'intrusion

[English version](../en/G18-penetration-test.md)

| | |
|---|---|
| Porte de mise en production | Penetration test / accepted analysis (E-B05, X-B-03) |
| Rôle approbateur | Sécurité de l'information |
| Périmètre (RELEASE-GATES) | release |
| Case de décision dans RELEASE-GATES.md | vide — cette porte est **NO-GO** tant que l'approbateur ne l'a pas remplie. Ce dossier ne remplit rien. |
| Ce que cette porte bloque | ne bloque que le déploiement général |
| À décider après | [G01](G01-security-access-policy.md) Sécurité : politique d'accès et matrice d'autorisation · [G02](G02-threat-model-findings.md) Sécurité : modèle de menace et constats |
| SHA cible | `dd4b7332` |
| Généré | 2026-11-19 |

## 1. La question à trancher

Un test d'intrusion indépendant sera-t-il mené avant le déploiement général, ou acceptez-vous l'analyse sans test ?

## 2. Preuves au SHA cible

| Preuve | Ce qu'elle montre | Régénérer / rejouer | Dernière modification (commit, date) | Empreinte |
|---|---|---|---|---|
| `docs/security/PENTEST-SCOPE.md` | Règles d'engagement et scénarios proposés | `manual` | d5d3b82f, 2026-11-06 | `db7f13ea8aee411c` |
| `docs/security/THREAT-MODEL.md` | Modèle de menace | `manual` | d6ec303e, 2026-11-04 | `f5213b43e7054d97` |
| `tools/qa/route-matrix.js` | Inventaire des routes pour les testeurs | `node tools/qa/route-matrix.js` | 30243287, 2026-11-12 | `948b64b63268ba22` |

**Preuves attendues des lots parallèles**

| Lot | Preuve attendue | Statut |
|---|---|---|
| P07 | Préparation au test d'intrusion (rapport de clôture) | attendue — absente de l'arbre au SHA cible (`docs/agent-execution/P07-*.md`) |
| P02 | Sonde des résultats d'autorisation | attendue — absente de l'arbre au SHA cible (`docs/agent-execution/P02-*.md`) |

## 3. Ce qui n'est pas prouvé, et pourquoi

- Aucun test n'a été mené ; le périmètre n'est pas signé.

## 4. Options et conséquences

- Commander un test avec le périmètre proposé.
- Accepter l'analyse avec des contrôles compensatoires nommés.
- Pas maintenant — la porte reste NO-GO ; le déploiement général reste bloqué.

## 5. Risques résiduels en cas d'accord aujourd'hui

- Vulnérabilités inconnues en production.

## 6. Ce que l'approbateur doit fournir

- Testeurs, dates, environnement, comptes de TEST.

---

_Généré par `node tools/release/gate-dossiers.js` à partir de `tools/release/gate-dossiers.source.js`. Préparé par un agent IA : un panel IA n'est pas une revue indépendante. `tests/gate-dossiers.test.js` échoue si une preuve citée a changé après la génération de ce dossier._
