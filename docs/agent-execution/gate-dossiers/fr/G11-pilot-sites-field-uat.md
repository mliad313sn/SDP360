# Dossier de décision G11 — Sites pilotes et recette terrain

[English version](../en/G11-pilot-sites-field-uat.md)

| | |
|---|---|
| Porte de mise en production | Pilot sites D-05 and field UAT (G-16/G-35) |
| Rôle approbateur | Sponsor + IT Groupe |
| Périmètre (RELEASE-GATES) | field acceptance |
| Case de décision dans RELEASE-GATES.md | vide — cette porte est **NO-GO** tant que l'approbateur ne l'a pas remplie. Ce dossier ne remplit rien. |
| Ce que cette porte bloque | bloque le pilote sur deux sites (instance de TEST) |
| À décider après | [G01](G01-security-access-policy.md) Sécurité : politique d'accès et matrice d'autorisation · [G02](G02-threat-model-findings.md) Sécurité : modèle de menace et constats · [G05](G05-backup-restore-rpo-rto.md) Sauvegarde et restauration (RPO/RTO) · [G12](G12-data-owner-fixtures-history.md) Propriétaire des données : données anonymisées et historique 2026 |
| SHA cible | `33a3c7bb` |
| Généré | 2026-11-21 |

## 1. La question à trancher

Quels deux sites font le pilote, avec quels utilisateurs nommés, et quel résultat de recette terrain vous permettra de dire GO ou NO-GO à la fin ?

## 2. Preuves au SHA cible

| Preuve | Ce qu'elle montre | Régénérer / rejouer | Dernière modification (commit, date) | Empreinte |
|---|---|---|---|---|
| `docs/ops/pilot/PILOT-PROFILE.md` | Valeurs d'interrupteurs proposées pour le pilote (non approuvées) | `manual` | d0b28752, 2026-11-20 | `00ff4aff07519dd2` |
| `docs/ops/pilot/FIELD-DEVICE-UAT.md` | Protocole de recette des appareils terrain | `manual` | 123bbb9e, 2026-11-06 | `a8a6d3349b817775` |
| `docs/ops/pilot/PILOT-MEASUREMENT.md` | Ce que le pilote mesure et comment | `node tools/pilot/pilot-metrics.js` | 0cedb940, 2026-11-12 | `4379002a25bde6c2` |
| `docs/ops/pilot/TEST-INSTANCE.md` | Description de l'instance de TEST | `manual` | 247500f0, 2026-11-04 | `753ce5e6e2924cbb` |
| `tests/field-no-silent-loss.test.js` | La saisie terrain hors ligne ne perd jamais un enregistrement en silence | `node --test --test-force-exit tests/field-no-silent-loss.test.js` | fcc4d77c, 2026-11-21 | `c58f6dd857fae252` |
| `tests/pilot-metrics.test.js` | Outil de mesure du pilote | `node --test --test-force-exit tests/pilot-metrics.test.js` | 1cdc2a73, 2026-11-19 | `166b16e4a1e036a9` |
| `docs/sdp360/completion/UAT-PANEL-2026-10-29.md` | Panel de revue IA (pas de vrais utilisateurs) | `manual` | 210f11b3, 2026-10-29 | `d02e3bbebc87851b` |

**Preuves attendues des lots parallèles**

| Lot | Preuve attendue | Statut |
|---|---|---|
| P09 | Kit d'adoption et de préparation terrain (procédure S1–S10, formation, parcours) | livrée: `docs/agent-execution/P09-PAGE-INVENTORY.md` (e1118e1d, `242aaec9fedf8f15`), `docs/agent-execution/P09-adoption-kit.md` (c9bab46d, `8246fb83ee6409fc`) |

## 3. Ce qui n'est pas prouvé, et pourquoi

- Aucun pilote n'a eu lieu : aucun vrai utilisateur, aucun vrai appareil, aucune donnée de site.
- Le panel de recette était composé de sièges IA, pas de personnes.

## 4. Options et conséquences

- Nommer deux sites et leurs utilisateurs, démarrer le pilote sur TEST.
- Nommer un premier site seulement.
- Pas maintenant — la porte reste NO-GO ; rien n'est validé sur le terrain.

## 5. Risques résiduels en cas d'accord aujourd'hui

- Sites pilotes non représentatifs de la flotte.
- Conditions réseau non couvertes par les tests.

## 6. Ce que l'approbateur doit fournir

- Deux noms de sites et un site optionnel de préparation hors ligne.
- Utilisateurs pilotes nommés.
- Critères de succès pour le GO/NO-GO du pilote.

---

_Généré par `node tools/release/gate-dossiers.js` à partir de `tools/release/gate-dossiers.source.js`. Préparé par un agent IA : un panel IA n'est pas une revue indépendante. `tests/gate-dossiers.test.js` échoue si une preuve citée a changé après la génération de ce dossier._
