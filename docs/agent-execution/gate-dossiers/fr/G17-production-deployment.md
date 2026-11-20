# Dossier de décision G17 — Mise en production

[English version](../en/G17-production-deployment.md)

| | |
|---|---|
| Porte de mise en production | Production deployment GO/NO-GO |
| Rôle approbateur | CAB |
| Périmètre (RELEASE-GATES) | deploy |
| Case de décision dans RELEASE-GATES.md | vide — cette porte est **NO-GO** tant que l'approbateur ne l'a pas remplie. Ce dossier ne remplit rien. |
| Ce que cette porte bloque | ne bloque que le déploiement général |
| À décider après | [G01](G01-security-access-policy.md) Sécurité : politique d'accès et matrice d'autorisation · [G02](G02-threat-model-findings.md) Sécurité : modèle de menace et constats · [G03](G03-cab-dependencies-postgres-only.md) CAB : mise à jour des dépendances et passage à PostgreSQL seul · [G04](G04-signing-key-ci-shas.md) Clé de signature et actions CI épinglées · [G05](G05-backup-restore-rpo-rto.md) Sauvegarde et restauration (RPO/RTO) · [G15](G15-product-business-acceptance.md) Produit : acceptation métier · [G18](G18-penetration-test.md) Test d'intrusion · [G19](G19-qa-ci-green.md) QA : CI verte et tests sautés revus · [G20](G20-capacity-load-soak.md) Capacité : charge et endurance |
| SHA cible | `19172165` |
| Généré | 2026-11-20 |

## 1. La question à trancher

Toutes les portes dont elle dépend étant signées, le SHA cible peut-il être mis en production ?

## 2. Preuves au SHA cible

| Preuve | Ce qu'elle montre | Régénérer / rejouer | Dernière modification (commit, date) | Empreinte |
|---|---|---|---|---|
| `docs/sdp360/completion/RELEASE-RUNBOOK-2026-10-29.md` | Procédure de mise en production | `manual` | dcd10bae, 2026-11-19 | `03787ae70ce91ca6` |
| `docs/INSTALLER.md` | Guide de l'installeur | `manual` | 214c0d1b, 2026-10-19 | `efe0f7d529c0819b` |
| `docs/ops/INSTALLATION.md` | Procédure d'installation | `manual` | 210f11b3, 2026-10-29 | `b874df5007fae452` |
| `docs/ops/EXPLOITATION.md` | Guide d'exploitation | `manual` | a519caab, 2026-10-29 | `15b6ddf6857e10ae` |
| `docs/agent-execution/G24-DOSSIER-GO-NOGO-FR.md` | Dossier antérieur : production NO-GO | `node --test --test-force-exit tests/release-dossier.test.js` | d6695109, 2026-11-05 | `0130ead17d7d9889` |

## 3. Ce qui n'est pas prouvé, et pourquoi

- Aucune porte amont n'est signée.
- Aucun essai de bout en bout de l'installeur sur l'instance de TEST.

## 4. Options et conséquences

- GO une fois toutes les dépendances signées.
- GO pour un sous-ensemble de sites.
- Pas maintenant — la porte reste NO-GO ; la production reste sur la version actuelle.

## 5. Risques résiduels en cas d'accord aujourd'hui

- Déployer avec une porte amont non signée.

## 6. Ce que l'approbateur doit fournir

- Référence CAB, fenêtre, responsable du retour arrière.

---

_Généré par `node tools/release/gate-dossiers.js` à partir de `tools/release/gate-dossiers.source.js`. Préparé par un agent IA : un panel IA n'est pas une revue indépendante. `tests/gate-dossiers.test.js` échoue si une preuve citée a changé après la génération de ce dossier._
