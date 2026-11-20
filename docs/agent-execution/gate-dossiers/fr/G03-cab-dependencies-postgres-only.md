# Dossier de décision G03 — CAB : mise à jour des dépendances et passage à PostgreSQL seul

[English version](../en/G03-cab-dependencies-postgres-only.md)

| | |
|---|---|
| Porte de mise en production | CAB — dependency release D-11 (CG-05) and PostgreSQL-only cutover PO-08 |
| Rôle approbateur | CAB |
| Périmètre (RELEASE-GATES) | release |
| Case de décision dans RELEASE-GATES.md | vide — cette porte est **NO-GO** tant que l'approbateur ne l'a pas remplie. Ce dossier ne remplit rien. |
| Ce que cette porte bloque | bloque le pilote sur deux sites (instance de TEST) |
| À décider après | [G19](G19-qa-ci-green.md) QA : CI verte et tests sautés revus |
| SHA cible | `24a2f966` |
| Généré | 2026-11-20 |

## 1. La question à trancher

La version qui porte les mises à jour de dépendances (D-11) et ne fonctionne que sur PostgreSQL (plus de repli SQLite, PO-08) peut-elle être installée sur l'instance de TEST ?

## 2. Preuves au SHA cible

| Preuve | Ce qu'elle montre | Régénérer / rejouer | Dernière modification (commit, date) | Empreinte |
|---|---|---|---|---|
| `docs/agent-execution/DEPS-TRIAGE.md` | Registre de tri des dépendances (propositions, rien de fusionné par l'agent) | `manual` | 0103bf05, 2026-11-12 | `8a2b7888644d603e` |
| `tests/postgres-only.test.js` | Prouve qu'il ne reste ni dépendance ni branche SQLite | `node --test --test-force-exit tests/postgres-only.test.js` | f44591ae, 2026-10-28 | `123db127d3df7c0d` |
| `services/backendGuard.js` | Le serveur refuse de démarrer sans PG_URL | `manual` | f44591ae, 2026-10-28 | `84fd82b3a445ef79` |
| `tests/dependency-sources.test.js` | Contrôles de l'origine des dépendances | `node --test --test-force-exit tests/dependency-sources.test.js` | 068a7c1f, 2026-11-06 | `f289ca65c0e455f2` |
| `tests/pg-migrate.test.js` | Les migrations s'appliquent dans l'ordre et sont journalisées | `node --test --test-force-exit tests/pg-migrate.test.js` | 47663284, 2026-10-19 | `41e0921db683a262` |
| `docs/ops/rehearsals/2026-10-29-local-pg16.md` | Répétition PostgreSQL locale sur données synthétiques | `node tools/pg/restore-rehearsal.js` | 63940e08, 2026-10-29 | `cb9255cdf7d0960a` |
| `docs/sdp360/consolidation/03-DECISIONS-AND-ASSUMPTIONS.md` | PO-08 et D-11 tels que consignés | `manual` | 16bc3aa6, 2026-10-28 | `f9e10b4ad831c678` |

**Preuves attendues des lots parallèles**

| Lot | Preuve attendue | Statut |
|---|---|---|
| P01 | Référence unique : branche, SHA et résultat de suite complète sur lesquels la version est construite | attendue — absente de l'arbre au SHA cible (`docs/agent-execution/P01-*.md`) |

## 3. Ce qui n'est pas prouvé, et pourquoi

- Aucune répétition sur le vrai serveur de TEST ; les répétitions ont tourné sur un PostgreSQL 16 local avec données synthétiques (la cible est PostgreSQL 17).
- Les notes de version des paquets mis à jour n'ont pas été relues hors ligne.

## 4. Options et conséquences

- Approuver l'installation sur TEST uniquement.
- Approuver sous conditions (par exemple répéter la migration sur une copie PostgreSQL 17 d'abord).
- Pas maintenant — la porte reste NO-GO ; le pilote ne peut pas démarrer car rien ne tourne sans PostgreSQL.

## 5. Risques résiduels en cas d'accord aujourd'hui

- Une migration se comporte autrement sur PostgreSQL 17 que sur le 16 utilisé en répétition.
- Revenir en arrière signifie restaurer un dump (pas de repli SQLite).

## 6. Ce que l'approbateur doit fournir

- Référence et date du CAB.
- Le SHA cible approuvé pour TEST.
- La fenêtre d'installation.

---

_Généré par `node tools/release/gate-dossiers.js` à partir de `tools/release/gate-dossiers.source.js`. Préparé par un agent IA : un panel IA n'est pas une revue indépendante. `tests/gate-dossiers.test.js` échoue si une preuve citée a changé après la génération de ce dossier._
