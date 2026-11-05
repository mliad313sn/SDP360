# Plan E — exécution de l'audit d'experts du 5 novembre 2026 (révision d38fa41)

Sources : CROSSCHECK-1-SDKU.md, CROSSCHECK-2-VIGPR.md, CROSSCHECK-3-FAQB.md (dans ce dossier).
Bilan du contre-contrôle : 101 actions ; aucune affirmation fausse, plusieurs partiellement dépassées.
Classes (classe principale) : DONE 13 · BUILD 28 · BUILD-SHADOW 37 · HUMAN 25 · OUT 0 (quelques actions
comptent une part humaine secondaire). 73 objectifs E-* proposés ; regroupés ci-dessous en lots exécutables.

Règles : défauts corrigés actifs ; tout autre changement visible derrière un interrupteur `report_config`
(défaut = aujourd'hui) + ligne PILOT-PROFILE ; null = INCONNU ; aucune approbation inventée ; PostgreSQL seul.

## Vague 0 — server.js (strictement sériel, libère le budget de lignes)
| Lot | Objectifs | Migrations |
|---|---|---|
| W0-SRV | E-A01 (routes enquête) → E-A01b (routes tracker + suppression d'année sûre) → E-D02 (fiche site : pays/fuseau, routes sites hors server.js) | 067 |

## Vague 1 — parallèle (pas de server.js / reports-db.js / reports.html)
| Lot | Objectifs | Migrations |
|---|---|---|
| W1-SEC | E-S01, E-S03, E-S04, E-S06 | 068, 069 |
| W1-DATA | E-D01, E-D04, E-D05, E-D06 (+E-Q02 fusionné) | — |
| W1-VIZ | E-V01, E-V02, E-V03, E-V06, E-V09, E-K02 (chaîne sérielle dashboard) | — |
| W1-FIELD | E-F01, E-F02, E-F03, E-F04 | — |
| W1-QA | E-A03, E-A04, E-A05, E-A06, E-Q01, E-Q04, E-Q05, E-Q08 | — |
| W1-GOV | E-I01, E-I04, E-G02, E-G03, E-G04, E-G05 | 070, 071 |

## Vague 2 — après la vague 0 / 1
| Lot | Objectifs | Migrations |
|---|---|---|
| W2-PPM | E-P03, E-P04, E-P05, E-P06, E-P08 (P07 couvert par E-I04) | 072, 073 |
| W2-ITSM | E-I02, E-I03, E-I06 | 074 |
| W2-REP | E-R01, E-R02, E-R04, E-R05, E-R06, E-R07 | — |
| W2-UX | E-U01, E-U02, E-U03, E-U04, E-U05, E-V08, E-V10 | 075 |
| W2-KPI | E-K01, E-K03, E-K04, E-B03, E-B05 | — |
| W2-SRV (sériel server.js) | E-S02, E-A07, E-Q07, E-B07, E-B08, E-D07 | 076 |
| W2-RDB (sériel reports-db) | E-D03, E-S05, E-A02 | 077 |
| W2-QJ | E-Q03, E-Q09 | — |

## Vague 3 — comité de représentants utilisateurs (agents, PAS une recette réelle)
Charte : CROSSCHECK-3-FAQB.md §(e). Sièges : coordinateur site, technicien mobile, responsable IT, métier,
direction, Finance, PMO, sécurité ; modèles multi-pays, multi-sites, site à deux codes, IT central / sous-sites /
bureau, devises, langues. Livrable : docs/audits/2026-11-05-expert-audit/UAT-COMITE-UTILISATEURS.md.

## Hors code (humain) — préparé par les lots, décidé par des personnes
Rotation du secret PostgreSQL + décision d'historique ; pentest ; CAB ; signature GO/NO-GO ; recette réelle par
persona et sur téléphones ; comité KPI (mandat, formules, seuils) ; propriété des codes TND ; devises Finance ;
OLA par groupe ; adoption des contrôles GRC ; licences/redistribution ; cérémonie de clés de signature.
