# Dossier de décision G02 — Sécurité : modèle de menace et constats

[English version](../en/G02-threat-model-findings.md)

| | |
|---|---|
| Porte de mise en production | Security — threat model and findings register (G27) |
| Rôle approbateur | Sécurité de l'information |
| Périmètre (RELEASE-GATES) | release |
| Case de décision dans RELEASE-GATES.md | vide — cette porte est **NO-GO** tant que l'approbateur ne l'a pas remplie. Ce dossier ne remplit rien. |
| Ce que cette porte bloque | bloque le pilote sur deux sites (instance de TEST) |
| À décider après | [G01](G01-security-access-policy.md) Sécurité : politique d'accès et matrice d'autorisation |
| SHA cible | `85ac79d3` |
| Généré | 2026-11-21 |

## 1. La question à trancher

Acceptez-vous les risques résiduels du modèle de menace et du registre des constats, y compris l'identifiant de base historique (EX-01) à faire tourner avant tout chargement de données réelles ?

## 2. Preuves au SHA cible

| Preuve | Ce qu'elle montre | Régénérer / rejouer | Dernière modification (commit, date) | Empreinte |
|---|---|---|---|---|
| `docs/security/THREAT-MODEL.md` | Modèle de menace STRIDE construit depuis le code, avec le responsable de chaque risque résiduel | `manual (STRIDE per entry point)` | 06a369c1, 2026-11-19 | `9ec7bf8e71c8c107` |
| `docs/agent-execution/SEC-01.md` | Constats de la revue de sécurité et avis sur les dépendances | `manual` | 668764c7, 2026-11-05 | `d1ac9fa1250da820` |
| `docs/security/EX-01-CREDENTIAL-INCIDENT.md` | Identifiant historique dans la configuration de l'installeur — porte humaine ouverte | `manual` | 7576d012, 2026-10-29 | `c940ae12a71398f0` |
| `docs/security/ROTATION-RECORD.md` | Où une rotation est consignée une fois faite par une personne | `manual` | d5d3b82f, 2026-11-06 | `9f8be1b68b704da5` |
| `tools/security/secret-scan.js` | Scanner de secrets sur l'arbre | `node tools/security/secret-scan.js` | cf2b8ae3, 2026-10-29 | `6efe7f2db825d61e` |
| `docs/security/CSP-JOURNEYS.md` | Observations de Content-Security-Policy par parcours | `node tools/security/csp-journey-report.js` | 33a3c7bb, 2026-11-21 | `34d78f5579e4dc43` |

**Preuves attendues des lots parallèles**

| Lot | Preuve attendue | Statut |
|---|---|---|
| P07 | Rapport de clôture sécurité (constats clos ou proposés, proposition de pages CSP strictes) | livrée: `docs/agent-execution/P07-security-closure.md` (06a369c1, `d11eb355b50431bf`) |

## 3. Ce qui n'est pas prouvé, et pourquoi

- Le modèle de menace n'est pas un test d'intrusion (c'est G18).
- EX-01 n'est pas tourné : seule une personne disposant des accès peut le faire.
- La Content-Security-Policy stricte est proposée page par page mais pas activée.

## 4. Options et conséquences

- Accepter les risques résiduels pour le pilote, avec la rotation EX-01 comme préalable.
- Accepter une partie et nommer les constats à clore d'abord.
- Pas maintenant — la porte reste NO-GO ; aucune donnée réelle ne peut être chargée.

## 5. Risques résiduels en cas d'accord aujourd'hui

- Tant qu'EX-01 n'est pas tourné, quiconque dispose de l'ancien historique peut atteindre une base qui utilisait cet identifiant.
- Les scripts en ligne restent autorisés sur les pages pas encore passées à la politique stricte.

## 6. Ce que l'approbateur doit fournir

- Confirmation datée de la rotation d'EX-01 (ligne dans ROTATION-RECORD.md).
- Le responsable qui accepte chaque risque résiduel.
- Décision sur la liste des pages CSP strictes après une période en mode rapport.

---

_Généré par `node tools/release/gate-dossiers.js` à partir de `tools/release/gate-dossiers.source.js`. Préparé par un agent IA : un panel IA n'est pas une revue indépendante. `tests/gate-dossiers.test.js` échoue si une preuve citée a changé après la génération de ce dossier._
