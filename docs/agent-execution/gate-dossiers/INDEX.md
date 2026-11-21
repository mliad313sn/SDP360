# Gate dossiers — index and critical path / Dossiers des portes — index et chemin critique

Target SHA / SHA cible: `ebec6b86` · Generated / Généré: 2026-11-21 · Source: `tools/release/gate-dossiers.source.js`

**No decision cell is filled by these dossiers. Every gate below is NO-GO until its approver fills its row in `docs/sdp360/completion/RELEASE-GATES.md`.**
**Aucune case de décision n'est remplie par ces dossiers. Chaque porte ci-dessous est NO-GO tant que son approbateur n'a pas rempli sa ligne.**

## Critical path to a two-site pilot GO/NO-GO / Chemin critique vers la décision de pilote sur deux sites

`G19` QA: CI green and skipped tests reviewed → `G01` Security: access policy and authorization matrix → `G03` CAB: dependency upgrade and PostgreSQL-only cutover → `G02` Security: threat model and findings → `G05` Backup and restore (RPO/RTO) → `G12` Data owner: anonymised data and 2026 history → `G11` Pilot sites and field acceptance → `G21` Business witness project

`G19` QA : CI verte et tests sautés revus → `G01` Sécurité : politique d'accès et matrice d'autorisation → `G03` CAB : mise à jour des dépendances et passage à PostgreSQL seul → `G02` Sécurité : modèle de menace et constats → `G05` Sauvegarde et restauration (RPO/RTO) → `G12` Propriétaire des données : données anonymisées et historique 2026 → `G11` Sites pilotes et recette terrain → `G21` Projet témoin métier

## All gates in dependency order / Toutes les portes dans l'ordre des dépendances

| # | Gate | Porte | Blocks / Bloque | Decide after / Après | Evidence (cited / awaited) | EN | FR |
|---|---|---|---|---|---|---|---|
| 1 | KPI definitions, thresholds and score | Définitions des indicateurs, seuils et score | blocks general deployment only / ne bloque que le déploiement général | — | 7 / 0 | [EN](en/G06-kpi-definitions-thresholds.md) | [FR](fr/G06-kpi-definitions-thresholds.md) |
| 2 | Legal and commercial | Juridique et commercial | blocks distribution outside Endeavour only / ne bloque que la diffusion hors d'Endeavour | — | 4 / 0 | [EN](en/G16-legal-commercial.md) | [FR](fr/G16-legal-commercial.md) |
| 3 | QA: CI green and skipped tests reviewed | QA : CI verte et tests sautés revus | blocks the two-site pilot on the TEST instance / bloque le pilote sur deux sites (instance de TEST) | — | 5 / 1 | [EN](en/G19-qa-ci-green.md) | [FR](fr/G19-qa-ci-green.md) |
| 4 | Security: access policy and authorization matrix | Sécurité : politique d'accès et matrice d'autorisation | blocks the two-site pilot on the TEST instance / bloque le pilote sur deux sites (instance de TEST) | G19 | 7 / 0 | [EN](en/G01-security-access-policy.md) | [FR](fr/G01-security-access-policy.md) |
| 5 | CAB: dependency upgrade and PostgreSQL-only cutover | CAB : mise à jour des dépendances et passage à PostgreSQL seul | blocks the two-site pilot on the TEST instance / bloque le pilote sur deux sites (instance de TEST) | G19 | 7 / 1 | [EN](en/G03-cab-dependencies-postgres-only.md) | [FR](fr/G03-cab-dependencies-postgres-only.md) |
| 6 | Closure policy for commitments | Politique de clôture des engagements | blocks the pilot only if its feature is in the pilot scope / ne bloque le pilote que si sa fonction est dans le périmètre du pilote | G06 | 6 / 0 | [EN](en/G07-closure-policy-commitments.md) | [FR](fr/G07-closure-policy-commitments.md) |
| 7 | Dashboard and tracker reviewers | Relecteurs des tableaux de bord et trackers | blocks the pilot only if its feature is in the pilot scope / ne bloque le pilote que si sa fonction est dans le périmètre du pilote | G06 | 4 / 0 | [EN](en/G09-dashboard-tracker-reviewers.md) | [FR](fr/G09-dashboard-tracker-reviewers.md) |
| 8 | Report authority and channels | Autorité des rapports et canaux | blocks general deployment only / ne bloque que le déploiement général | G06 | 6 / 0 | [EN](en/G10-report-authority-channels.md) | [FR](fr/G10-report-authority-channels.md) |
| 9 | Finance: budgets and benefits | Finance : budgets et bénéfices | blocks the pilot only if its feature is in the pilot scope / ne bloque le pilote que si sa fonction est dans le périmètre du pilote | G06 | 5 / 0 | [EN](en/G14-finance-budgets-benefits.md) | [FR](fr/G14-finance-budgets-benefits.md) |
| 10 | Security: threat model and findings | Sécurité : modèle de menace et constats | blocks the two-site pilot on the TEST instance / bloque le pilote sur deux sites (instance de TEST) | G01 | 6 / 0 | [EN](en/G02-threat-model-findings.md) | [FR](fr/G02-threat-model-findings.md) |
| 11 | Signing key and pinned CI actions | Clé de signature et actions CI épinglées | blocks general deployment only / ne bloque que le déploiement général | G03 | 5 / 0 | [EN](en/G04-signing-key-ci-shas.md) | [FR](fr/G04-signing-key-ci-shas.md) |
| 12 | Backup and restore (RPO/RTO) | Sauvegarde et restauration (RPO/RTO) | blocks the two-site pilot on the TEST instance / bloque le pilote sur deux sites (instance de TEST) | G03 | 8 / 0 | [EN](en/G05-backup-restore-rpo-rto.md) | [FR](fr/G05-backup-restore-rpo-rto.md) |
| 13 | Interdepartmental handoffs | Passations entre départements | blocks the pilot only if its feature is in the pilot scope / ne bloque le pilote que si sa fonction est dans le périmètre du pilote | G07 | 3 / 0 | [EN](en/G08-handoffs.md) | [FR](fr/G08-handoffs.md) |
| 14 | Connectors and dash-key clients | Connecteurs et clients à clé | blocks the pilot only if its feature is in the pilot scope / ne bloque le pilote que si sa fonction est dans le périmètre du pilote | G01 | 6 / 0 | [EN](en/G13-connectors-dashkey-clients.md) | [FR](fr/G13-connectors-dashkey-clients.md) |
| 15 | Capacity: load and soak | Capacité : charge et endurance | blocks general deployment only / ne bloque que le déploiement général | G03 | 5 / 0 | [EN](en/G20-capacity-load-soak.md) | [FR](fr/G20-capacity-load-soak.md) |
| 16 | Data owner: anonymised data and 2026 history | Propriétaire des données : données anonymisées et historique 2026 | blocks the two-site pilot on the TEST instance / bloque le pilote sur deux sites (instance de TEST) | G02 | 5 / 0 | [EN](en/G12-data-owner-fixtures-history.md) | [FR](fr/G12-data-owner-fixtures-history.md) |
| 17 | Penetration test | Test d'intrusion | blocks general deployment only / ne bloque que le déploiement général | G01, G02 | 3 / 0 | [EN](en/G18-penetration-test.md) | [FR](fr/G18-penetration-test.md) |
| 18 | Pilot sites and field acceptance | Sites pilotes et recette terrain | blocks the two-site pilot on the TEST instance / bloque le pilote sur deux sites (instance de TEST) | G01, G02, G05, G12 | 7 / 0 | [EN](en/G11-pilot-sites-field-uat.md) | [FR](fr/G11-pilot-sites-field-uat.md) |
| 19 | Business witness project | Projet témoin métier | blocks the two-site pilot on the TEST instance / bloque le pilote sur deux sites (instance de TEST) | G11 | 4 / 0 | [EN](en/G21-business-witness-project.md) | [FR](fr/G21-business-witness-project.md) |
| 20 | Product: business acceptance | Produit : acceptation métier | blocks general deployment only / ne bloque que le déploiement général | G11, G21, G06 | 4 / 0 | [EN](en/G15-product-business-acceptance.md) | [FR](fr/G15-product-business-acceptance.md) |
| 21 | Production deployment | Mise en production | blocks general deployment only / ne bloque que le déploiement général | G01, G02, G03, G04, G05, G15, G18, G19, G20 | 5 / 0 | [EN](en/G17-production-deployment.md) | [FR](fr/G17-production-deployment.md) |

## Blocking classes / Classes de blocage

- `pilot` — blocks the two-site pilot on the TEST instance / bloque le pilote sur deux sites (instance de TEST) (G01, G02, G03, G05, G11, G12, G19, G21)
- `pilot-if` — blocks the pilot only if its feature is in the pilot scope / ne bloque le pilote que si sa fonction est dans le périmètre du pilote (G07, G08, G09, G13, G14)
- `general` — blocks general deployment only / ne bloque que le déploiement général (G04, G06, G10, G15, G17, G18, G20)
- `market` — blocks distribution outside Endeavour only / ne bloque que la diffusion hors d'Endeavour (G16)

## Regenerate / Régénérer

```
node tools/release/gate-dossiers.js --sha=<merge sha>
node tools/release/gate-dossiers.js --check
node --test tests/gate-dossiers.test.js
```

_Generated by `node tools/release/gate-dossiers.js` from `tools/release/gate-dossiers.source.js`. Prepared by an AI agent: an AI panel is not an independent review. `tests/gate-dossiers.test.js` fails when any cited evidence changed after this dossier was generated._
