# SDP360 — Feuille de route exécutive et modèle de délégation Claude Code

**Date de référence :** 29 octobre 2026. **Branche :** `claude/sdp360-consolidation` (HEAD observé précédemment : `48153a0`; Claude doit revérifier). **Produit :** `2.0.0-alpha.14` selon package.json lors de l'analyse. **Statut opérationnel :** NO-GO pour production et commercialisation tant que les conditions ne sont pas vérifiées.

## Objet

Transformer SDP360 en plateforme maintenable, sécurisée et pilotable : ITSM en lecture depuis ServiceDesk Plus, supervision OpManager, Meraki WAN/SLA, gouvernance multisite, engagements vérifiés, workflow transversal, rapports certifiés, PPM entièrement natif, finance et bénéfices, expérience terrain et industrialisation. L'objectif n'est pas de recréer ServiceDesk Plus ni de connecter des outils hors périmètre.

## Délégation des décisions à l'IA

**AI-TECH-DECIDED** : décisions techniques réversibles, architecture, design d'interface, tests, choix de modules, priorisation, ADR et implémentation en environnement isolé. **AI-PROPOSED-POLICY** : choix de règles métier, seuils de score, RACI, destinataires ou autorisations proposés par plusieurs agents; peuvent être implémentés derrière feature flag et exécutés en SHADOW, jamais annoncés approuvés. **EXTERNAL-AUTHORITY-BLOCKED** : le code peut être prêt mais une vraie autorité doit accepter les droits, budgets, secrets, déploiement, données personnelles, communications réelles ou la mise en marché. Les agents ne produisent pas de fausses signatures.

## MODS / modes d'exécution

`AUDIT` -> `DESIGN` -> `BUILD` -> `VERIFY` -> `REVIEW` -> `PACKAGE` -> `STOP`. Ces MODS sont **une convention de ce programme**, non une extension officielle identifiée de Claude Code. Les modes de permission natifs de Claude Code sont distincts (Plan, Ask, Accept Edits, etc.). Les règles et hooks protègent les opérations sensibles ; jamais d'option `--dangerously-skip-permissions` pour une machine disposant d'accès réels.

## Dépendances et priorités

| Vague | Objectifs | Livraison attendue | Conditions de passage |
|---|---|---|---|
| W0 : vérité produit | G00–G01 | Inventaire, traçabilité, CI reproductible | Un HEAD, résultats CI et historique des skips exacts |
| W1 : sécurité et données | G02–G05 | RBAC complet, secrets maîtrisés, PG17 restaurable, connecteurs gouvernés | Absence d'exposition critique et tests d'isolement négatifs |
| W2 : vérité métier | G06–G10 | KPI cohérents, publications tracées, réunions, engagements, handoffs | Tests métier et refus des actions non autorisées |
| W3 : portefeuille et reporting | G11–G16 | PPM natif, ressources, finances, roadmap, RFI, catalogue reports et dashboards | Couverture projet end-to-end et données non fictives différenciées |
| W4 : expérience et terrain | G17–G20 | Navigation par rôle, FR/EN, modularisation, PWA, IA ancrée | Tests navigateur/accessibilité et absence de perte offline |
| W5 : industrialisation | G21–G23 | QA, Windows installer/recovery, cadre commercial et juridique | CI et DR de test probants ; droits commerciaux toujours à vérifier |
| W6 : arbitrage exécutif | G24 | Dossier de validation, adoption, readiness, NO-GO/GO motivé | Authentiques approbations externes, jamais simulées |

## Écarts existants à fermer

- Autorisations site/département : sécuriser toutes les lectures, écritures, photos, exports, shares et 16 routes `dash-key` ; révoquer les permissions à la requête suivante.
- Certifier les formules KPI et rapprocher les scores divergents de roadmap (22 % / 54 % signalés dans la revue) avant publication officielle ; distinguer `null`/UNKNOWN de zéro.
- Finir finance/PPM : WBS, tâches, dépendances, ressources, baselines, budgets avec preuve, bénéfices validés et consolidation de Roadmap Manager.
- Ne pas inventer les 24 spécifications F01–F24 et les 41 chart contracts si leurs fichiers originaux sont absents ; proposer des remplacements explicites, non certifiés.
- Finaliser engagements, PV, RFI, handoffs, rapports et alertes avec contrôles SoD, historique, escalade et notifications non activées par défaut.
- Refondre navigation et grands écrans (`server.js`, `executive.html`, `reports.html`) progressivement avec tests de parité ; uniformiser FR/EN.
- Valider PWA hors ligne sur fixtures et navigateur puis vrai terrain ; évaluer installation, mise à jour et restauration Windows.
- `LICENSE` indique un usage interne Endeavour Mining ; aucun agent n'a le pouvoir de créer des droits de redistribution commerciale.

## Format de preuve standard

Pour chaque Gxx : SHA, point d'entrée, chemins de fichiers et schéma modifiés, cas de test rouge/vert, commandes avec code sortie, résultat de l'analyse sécurité, test de rollback, statut (`IMPLEMENTED` / `TESTED` / `FIELD_VALIDATED` / `DEPLOYED` / `BUSINESS_ACCEPTED`), dérogations, décisions ADR et liens CI. Si l'une de ces preuves manque, `UNKNOWN` / `BLOCKED` et non `PASS`.

## Utilisation rapide

Installer le dossier `.claude/` à la racine du dépôt **en fusionnant** avec les configurations existantes (ne pas écraser les anciens agents/skills/CLAUDE.md). Depuis Claude Code, exécuter d'abord `/sdp-master G00`. Pour prolonger les travaux jusqu'aux critères explicités dans le programme : utiliser la **commande native** `/goal` avec le prompt maître dans le fichier `SDP360_GOALS_READY_TO_PASTE_EN.md`. Les sous-skills `/sdp-security`, `/sdp-ppm`, `/sdp-qa` etc. sont réutilisables directement.

## Références examinées

- https://github.com/mliad313sn/SDP360/tree/claude/sdp360-consolidation
- https://github.com/mliad313sn/SDP360/blob/claude/sdp360-consolidation/docs/sdp360/completion/UAT-PANEL-2026-10-29.md
- https://github.com/mliad313sn/SDP360/blob/claude/sdp360-consolidation/docs/sdp360/completion/RELEASE-GATES.md
- https://github.com/mliad313sn/SDP360/blob/claude/sdp360-consolidation/docs/sdp360/completion/GAPS.csv
- https://code.claude.com/docs/en/skills
- https://code.claude.com/docs/en/commands
- https://playwright.dev/mcp/installation
- https://github.com/github/github-mcp-server/blob/main/docs/installation-guides/install-claude.md

**Limite de la présente livraison :** le dépôt n'a pas été cloné dans cet environnement (résolution DNS indisponible). Ce pack est une spécification opérationnelle et une configuration d'agents, **pas une modification déjà appliquée à SDP360**. Le premier objectif doit vérifier le HEAD et chaque état actuel.
