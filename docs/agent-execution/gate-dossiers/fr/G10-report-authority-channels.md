# Dossier de décision G10 — Autorité des rapports et canaux

[English version](../en/G10-report-authority-channels.md)

| | |
|---|---|
| Porte de mise en production | Report authority and channels D-13 (G-13/G-25) |
| Rôle approbateur | Responsable des rapports |
| Périmètre (RELEASE-GATES) | external report release |
| Case de décision dans RELEASE-GATES.md | vide — cette porte est **NO-GO** tant que l'approbateur ne l'a pas remplie. Ce dossier ne remplit rien. |
| Ce que cette porte bloque | ne bloque que le déploiement général |
| À décider après | [G06](G06-kpi-definitions-thresholds.md) Définitions des indicateurs, seuils et score |
| SHA cible | `a5eeb485` |
| Généré | 2026-11-20 |

## 1. La question à trancher

Qui peut diffuser chaque rapport du catalogue comme faisant foi, et par quels canaux (e-mail, Teams, SharePoint) — chaque canal sortant est livré désarmé ?

## 2. Preuves au SHA cible

| Preuve | Ce qu'elle montre | Régénérer / rejouer | Dernière modification (commit, date) | Empreinte |
|---|---|---|---|---|
| `docs/sdp360/completion/REPORT-ALERT-CATALOGUE.md` | Catalogue des rapports et alertes (R01–R16) | `manual` | 2c468fb1, 2026-11-12 | `48f7f0a9232b2a59` |
| `tests/report-release.smoke.test.js` | Comportement de la diffusion des rapports | `node --test --test-force-exit tests/report-release.smoke.test.js` | 4aea9ddf, 2026-10-29 | `23a995841e393702` |
| `tests/publish-sharepoint-mock.test.js` | Publication SharePoint contre une simulation uniquement | `node --test --test-force-exit tests/publish-sharepoint-mock.test.js` | 8d8a7899, 2026-10-29 | `0cadff34c122450d` |
| `tests/e2e-outbound-guard.test.js` | Rien ne sort du serveur pendant les tests | `node --test --test-force-exit tests/e2e-outbound-guard.test.js` | 918bd979, 2026-11-12 | `7d8eed11abdaccfd` |
| `docs/ai-decisions/ADR-G16-outbound-alerts-armed-off.md` | Les alertes sortantes sont livrées désarmées | `manual` | 8d8a7899, 2026-10-29 | `aad1fd4dc842a1d2` |
| `docs/ai-decisions/ADR-P9-export-policy.md` | Politique d'export | `manual` | c4ef1af5, 2026-11-13 | `b6990790a7cbc808` |

## 3. Ce qui n'est pas prouvé, et pourquoi

- Aucun canal réel testé (SharePoint est simulé).
- Aucun responsable nommé par rapport.

## 4. Options et conséquences

- Nommer l'autorité par rapport et armer les canaux un par un.
- Rapports internes (dans l'application) seulement pour le pilote.
- Pas maintenant — la porte reste NO-GO ; aucun rapport ne sort de l'application.

## 5. Risques résiduels en cas d'accord aujourd'hui

- Un rapport brouillon atteint un public externe.

## 6. Ce que l'approbateur doit fournir

- Autorité par rapport.
- Identifiants des canaux (saisis par une personne, jamais par l'agent).

---

_Généré par `node tools/release/gate-dossiers.js` à partir de `tools/release/gate-dossiers.source.js`. Préparé par un agent IA : un panel IA n'est pas une revue indépendante. `tests/gate-dossiers.test.js` échoue si une preuve citée a changé après la génération de ce dossier._
