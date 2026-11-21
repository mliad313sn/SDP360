# Dossier de décision G05 — Sauvegarde et restauration (RPO/RTO)

[English version](../en/G05-backup-restore-rpo-rto.md)

| | |
|---|---|
| Porte de mise en production | Backup / restore RPO-RTO (G-11) |
| Rôle approbateur | CAB + SRE |
| Périmètre (RELEASE-GATES) | release |
| Case de décision dans RELEASE-GATES.md | vide — cette porte est **NO-GO** tant que l'approbateur ne l'a pas remplie. Ce dossier ne remplit rien. |
| Ce que cette porte bloque | bloque le pilote sur deux sites (instance de TEST) |
| À décider après | [G03](G03-cab-dependencies-postgres-only.md) CAB : mise à jour des dépendances et passage à PostgreSQL seul |
| SHA cible | `2aea9ac3` |
| Généré | 2026-11-21 |

## 1. La question à trancher

Quelle perte de données (RPO) et quel délai de restauration (RTO) acceptez-vous, et la preuve d'exercice de restauration suffit-elle pour charger les données du pilote ?

## 2. Preuves au SHA cible

| Preuve | Ce qu'elle montre | Régénérer / rejouer | Dernière modification (commit, date) | Empreinte |
|---|---|---|---|---|
| `docs/ops/restore-drills/2026-10-21.md` | Exercice de restauration : comptes de lignes égaux sur la copie restaurée (base synthétique) | `node tools/pg/restore-drill.js` | de418131, 2026-10-21 | `c6515dbb34f803de` |
| `tools/pg/restore-drill.js` | Outil d'exercice | `node tools/pg/restore-drill.js` | 861e2bb0, 2026-11-21 | `c992308b84f0b285` |
| `tests/restore-drill.test.js` | Comportement de l'outil d'exercice | `node --test --test-force-exit tests/restore-drill.test.js` | f001ec01, 2026-11-12 | `5df8903f7cc56426` |
| `tests/backup-encrypt.test.js` | Comportement de la sauvegarde chiffrée | `node --test --test-force-exit tests/backup-encrypt.test.js` | e57c1880, 2026-11-20 | `cde8b83169659eb4` |
| `tests/blob-backup.test.js` | Stock de fichiers (photos, signatures, téléversements, documents) archivé avec le dump et vérifié par l'exercice (nombre + SHA-256) | `node --test --test-force-exit tests/blob-backup.test.js` | 277386f1, 2026-11-20 | `28e0285a89518d4c` |
| `docs/ops/REPLICA-RESTORE.md` | Procédure réplica et restauration | `manual` | de418131, 2026-10-21 | `7c73dcacf7dbb71c` |
| `docs/ops/rehearsals/2026-10-29-local-pg16-g04.md` | Répétition locale avec durées | `node tools/pg/restore-rehearsal.js` | 95a84168, 2026-10-29 | `83405a53694f863a` |
| `docs/ops/SLO-PROPOSAL.md` | Indicateurs proposés ; chaque cible INCONNUE | `manual` | 4f225458, 2026-11-19 | `332e1e07cb05be84` |

## 3. Ce qui n'est pas prouvé, et pourquoi

- Aucun exercice sur le serveur de TEST ni sur PostgreSQL 17.
- Les valeurs de RPO et RTO ne sont pas choisies ; l'exercice mesure, il ne fixe pas de cible.

## 4. Options et conséquences

- Fixer RPO/RTO et exiger un exercice sur TEST avant le chargement.
- Accepter l'exercice local pour le pilote seulement.
- Pas maintenant — la porte reste NO-GO ; les données du pilote ne peuvent pas être chargées en sécurité.

## 5. Risques résiduels en cas d'accord aujourd'hui

- Une restauration jamais pratiquée sur l'hôte cible échoue le jour où on en a besoin.
- Une sauvegarde restaurée sur un autre hôte exige la même SDP_CONFIG_KEY.

## 6. Ce que l'approbateur doit fournir

- Valeurs de RPO et RTO.
- Emplacement des sauvegardes et son responsable.
- Rétention des archives du stock de fichiers (même nombre que les dumps par défaut).
- Date de l'exercice sur TEST.

---

_Généré par `node tools/release/gate-dossiers.js` à partir de `tools/release/gate-dossiers.source.js`. Préparé par un agent IA : un panel IA n'est pas une revue indépendante. `tests/gate-dossiers.test.js` échoue si une preuve citée a changé après la génération de ce dossier._
