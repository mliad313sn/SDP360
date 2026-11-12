# F-UAT — comité représentatif des utilisateurs (plan F, vague 3)

> **Simulation par agents IA — ne remplace pas une recette utilisateur réelle.** Organisation synthétique, base
> PostgreSQL jetable, aucun utilisateur réel ; aucune approbation, signature, recette terrain ni aptitude à la
> production n'est revendiquée.

Branche `goal/uat-f` (depuis `48c2d46`). Non poussée, non fusionnée. Rapport complet :
`docs/audits/2026-11-12-enterprise-review/UAT-COMITE-UTILISATEURS.md`.

## Ce qui a été construit

| Élément | Fichier |
|---|---|
| Harnais du comité (passes A / B, enregistrement par parcours, session conservée par personne) | `tests/e2e/fixtures/uat.js` |
| Rejouer n'importe quel parcours avec le profil pilote | `tests/e2e/fixtures/harness.js` (`UAT_PILOT_PROFILE=1`) |
| 8 sièges, 57 parcours, chacun en passe A et B | `tests/e2e/uat-s1…s8-*.spec.js` |
| Gardes statiques (bannière, profil pilote = interrupteurs livrés à 0, défauts D1 / D3) | `tests/uat-committee.test.js` (5) |
| Carte persona → parcours, matrice régénérée | `docs/ops/PERSONA-JOURNEYS.md`, `docs/ux/PERSONA-TASK-MATRIX.md` |

`tests/.suite-manifest.json` ne recense que `tests/*.test.js` (le garde de `tools/test/run-all.js` refuse une entrée
sans fichier de test unitaire) : les parcours `uat-s*` y sont représentés par `tests/uat-committee.test.js`, qui
vérifie leur présence et leur cartographie ; les fichiers de test ajoutés (`uat-committee`, `portfolio-duplicate-key`)
et le test complété (`home-queue`) y sont inscrits.

## Résultats (dernière exécution, PostgreSQL 16 local, Chromium Playwright)

| Passe | PASS | FAIL | BLOQUÉ | NON TESTABLE |
|---|---|---|---|---|
| A — réglages livrés | 39 | 1 (S7-08, KNOWN UAT-OI-03) | 0 | 17 |
| B — profil pilote | 56 | 1 (S7-08, KNOWN UAT-OI-03) | 0 | 0 |

Parcours existants (32) : passe A 30/32 puis 32/32 après D5 (f1 instable : 1 échec sur 4, UAT-OI-04) ; passe B 31/32
puis 32/32 après D4.

## Défauts corrigés

| # | Correction | Avant → après |
|---|---|---|
| D1 | Accueil à 320 px (`public/home.html`) | `uat-s1` S1-07 FAIL → PASS ; `uat-committee` S1-07 |
| D2 | Doublon de clé portefeuille 500 → 409 (`services/governanceStore.js`) | `portfolio-duplicate-key.smoke` 500 → 409 |
| D3 | Routes d'espace permises aux comptes métier (`services/businessGuard.js`) | `uat-s8` S8-06 B BLOQUÉ (403) → PASS ; `uat-committee` S8-06 |
| D4 | File d'accueil sans appel 404 quand les engagements sont éteints (`services/uiPolicy.js`, `public/lib/homeQueue.js`, `public/lib/home-page.js`) | `home-queue` (cas UAT-F) échoue → passe ; `v1-viewport-layout` passe B rouge → vert |
| D5 | En-tête CSV de `x1-exports` lu depuis `services/dashboardCsv.js` | `x1` rouge → vert |

## Vérifications

- **Suite complète `npm test` (PostgreSQL)** : 4862 tests, 4852 pass, 0 fail, 10 sautés autorisés (« no prod-snapshot »),
  724/724 fichiers, plancher 4845.
- Voisinage : 140 tests (portfolio, governance, business boundary, persona-matrix, error-shape, a11y-static,
  ui-design-ratchet, reflow-known, workspace, workbench, roadmap, demo-seed, uat-committee) verts ; `ui-policy*`,
  `home-queue*`, `home-page-blocks`, `exec-charts-v2`, `state-badge`, `url-filters`, `ux-events`, `i18n-*`,
  `flag-register`, `authz-route-matrix` verts.
- ESLint propre sur les fichiers modifiés.
- `node tools/test/drop-test-dbs.js` exécuté après les campagnes.
- `server.js` non modifié ; ratchet d'erreurs 444 inchangé ; aucune couleur hexadécimale ajoutée.

## Laissé aux personnes

Les huit séances réelles, les décisions PO du §10 du rapport, la définition des écarts F01–F09 (absente des documents
fournis), et les problèmes ouverts UAT-OI-01 … 08 (prompts /goal dans le rapport).

> **Simulation par agents IA — ne remplace pas une recette utilisateur réelle.**
