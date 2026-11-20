# Dossier de décision G09 — Relecteurs des tableaux de bord et trackers

[English version](../en/G09-dashboard-tracker-reviewers.md)

| | |
|---|---|
| Porte de mise en production | Dashboard and tracker reviewers (G-23/G-24, DEC-6.x) — who reviews which audience |
| Rôle approbateur | Comité |
| Périmètre (RELEASE-GATES) | publication without admin override |
| Case de décision dans RELEASE-GATES.md | vide — cette porte est **NO-GO** tant que l'approbateur ne l'a pas remplie. Ce dossier ne remplit rien. |
| Ce que cette porte bloque | ne bloque le pilote que si sa fonction est dans le périmètre du pilote |
| À décider après | [G06](G06-kpi-definitions-thresholds.md) Définitions des indicateurs, seuils et score |
| SHA cible | `19172165` |
| Généré | 2026-11-20 |

## 1. La question à trancher

Qui relit un tableau de bord ou un tracker avant sa publication à chaque public, pour que la publication n'exige plus de dérogation admin ?

## 2. Preuves au SHA cible

| Preuve | Ce qu'elle montre | Régénérer / rejouer | Dernière modification (commit, date) | Empreinte |
|---|---|---|---|---|
| `tests/publish-gate.test.js` | Comportement de la porte de publication | `node --test --test-force-exit tests/publish-gate.test.js` | c101f957, 2026-10-28 | `f74ad491f91ee4ab` |
| `docs/sdp360/05-SOP-DASHBOARDS-AND-TRACKERS.md` | Procédure des tableaux de bord et trackers | `manual` | 214c0d1b, 2026-10-19 | `4e91f5d6581e65d1` |
| `docs/ops/WIDGET-CATALOGUE.md` | Catalogue des widgets | `manual` | fe780e00, 2026-11-12 | `fde503ff5d4855e7` |
| `tests/dashboard-design.test.js` | Contrôles de conception des définitions | `node --test --test-force-exit tests/dashboard-design.test.js` | 111254ae, 2026-10-29 | `bf1499eefaa47929` |

**Preuves attendues des lots parallèles**

| Lot | Preuve attendue | Statut |
|---|---|---|
| P03 | Lots d'activation (interrupteurs de publication) | livrée: `docs/agent-execution/P03-switch-lots.md` (e3a38ce3, `99419412678af916`) |

## 3. Ce qui n'est pas prouvé, et pourquoi

- Aucun relecteur nommé par public.
- Décisions de conception DEC-6.x encore ouvertes.

## 4. Options et conséquences

- Nommer des relecteurs par public.
- Garder la publication réservée aux admins pour le pilote.
- Pas maintenant — la porte reste NO-GO ; seuls les admins publient.

## 5. Risques résiduels en cas d'accord aujourd'hui

- Un chiffre faux publié à la direction.

## 6. Ce que l'approbateur doit fournir

- Relecteur par public.

---

_Généré par `node tools/release/gate-dossiers.js` à partir de `tools/release/gate-dossiers.source.js`. Préparé par un agent IA : un panel IA n'est pas une revue indépendante. `tests/gate-dossiers.test.js` échoue si une preuve citée a changé après la génération de ce dossier._
