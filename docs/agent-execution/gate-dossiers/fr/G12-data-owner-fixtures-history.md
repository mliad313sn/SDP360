# Dossier de décision G12 — Propriétaire des données : données anonymisées et historique 2026

[English version](../en/G12-data-owner-fixtures-history.md)

| | |
|---|---|
| Porte de mise en production | Data owner — anonymised fixtures (G-15), 2026 history D-10 |
| Rôle approbateur | Propriétaires des données |
| Périmètre (RELEASE-GATES) | data claims |
| Case de décision dans RELEASE-GATES.md | vide — cette porte est **NO-GO** tant que l'approbateur ne l'a pas remplie. Ce dossier ne remplit rien. |
| Ce que cette porte bloque | bloque le pilote sur deux sites (instance de TEST) |
| À décider après | [G02](G02-threat-model-findings.md) Sécurité : modèle de menace et constats |
| SHA cible | `5ffdd57a` |
| Généré | 2026-11-19 |

## 1. La question à trancher

Des données réelles peuvent-elles être chargées sur TEST pour le pilote, un extrait anonymisé peut-il être produit pour les tests, et qui rapproche les chiffres historiques 2026 ?

## 2. Preuves au SHA cible

| Preuve | Ce qu'elle montre | Régénérer / rejouer | Dernière modification (commit, date) | Empreinte |
|---|---|---|---|---|
| `docs/ops/ANONYMISED-SNAPSHOT.md` | Procédure d'anonymisation ; aucun extrait n'existe | `manual` | 44a5d662, 2026-11-06 | `3b906ee51708867e` |
| `tests/anonymize-snapshot.test.js` | Comportement de l'anonymiseur sur données synthétiques | `node --test --test-force-exit tests/anonymize-snapshot.test.js` | 44a5d662, 2026-11-06 | `8f45707c7ce182ee` |
| `tests/.skip-allowlist.json` | Tests sautés faute d'extrait approuvé | `manual` | 090d541f, 2026-11-06 | `d0fb199d188863a5` |
| `docs/ops/RETENTION-INVENTORY.md` | Inventaire de conservation | `node tools/security/retention-inventory.js` | d5d3b82f, 2026-11-06 | `c17f340d35402666` |
| `docs/sdp360/2027/02-DECISION-LOG.md` | Décision D-10 sur les chiffres historiques (ouverte) | `manual` | 16bc3aa6, 2026-10-28 | `a556e916281bc051` |

## 3. Ce qui n'est pas prouvé, et pourquoi

- Aucun extrait anonymisé n'a été produit ni approuvé.
- Les chiffres historiques ne sont montrés que comme références attribuées.

## 4. Options et conséquences

- Autoriser les données réelles sur TEST et un extrait anonymisé.
- Autoriser les données réelles sur TEST seulement.
- Pas maintenant — la porte reste NO-GO ; le pilote tourne sur données synthétiques, ce qui prouve peu.

## 5. Risques résiduels en cas d'accord aujourd'hui

- Données personnelles dans un environnement de test moins contrôlé.

## 6. Ce que l'approbateur doit fournir

- Propriétaire par source.
- Approbation des règles d'anonymisation.
- Responsable du rapprochement D-10.

---

_Généré par `node tools/release/gate-dossiers.js` à partir de `tools/release/gate-dossiers.source.js`. Préparé par un agent IA : un panel IA n'est pas une revue indépendante. `tests/gate-dossiers.test.js` échoue si une preuve citée a changé après la génération de ce dossier._
