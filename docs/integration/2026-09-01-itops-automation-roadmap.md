# IT OPS Automation — Feuille de route consolidée

> **Document de pilotage** · Endeavour Mining IT Operations · 2026-09-01
> Fusionne : (a) le handoff « IT OPS Automation with SDP Cloud, Teams, Azure OpenAI and ManageEngine Stack » (2026-09-01, autre session), (b) l'article *Server Administration AI Agents Blueprint* (C. Kumar, LinkedIn), (c) le repo `packetcoders/awesome-network-automation-ai`, et — c'est le point clé — **(d) l'état RÉEL du SDP Dashboard**, que le handoff ne connaissait pas.
> *(L'article Ciena « Automate network operations with agentic AI » est inaccessible en fetch anonyme — à relire manuellement si besoin.)*

---

## 1. La correction la plus importante au handoff

Le handoff propose de construire plusieurs choses **qui existent déjà en production** dans le SDP Dashboard. Avant tout nouveau chantier, voici la réconciliation — elle évite de re-payer ce qui est payé :

| Proposition du handoff | État réel dans notre stack |
|---|---|
| §5.6 Reporting automation (rapports coordinateurs hebdo/mensuels, alertes SLA/backlog, suivi adoption portail, couverture scan des actifs, CAB/action tracker, PIR des incidents majeurs) | **DÉJÀ LIVE** — c'est le cœur du SDP Dashboard : e-mails coordinateurs weekly + monthly, scoreboard opérationnel, digest hygiène actifs, vues SLA/backlog, registre MI avec RCA/CA/PIR/LL, Site Actions hub, decks PPTX |
| §5.7 Asset automation (actifs non scannés depuis N jours, actifs fantômes, rapport conformité tags, lien user/site/historique) | **DÉJÀ LIVE** — module Assets : worklists `never_scanned`/`ghost`/`no_asset_tag`, effort trend par site, réconciliation SDP × AD × Entra × Defender (écarts + candidats retrait), bouton Sync |
| §5.8 OpManager → SDP incidents | **Conçu, pas codé** — voir `2026-07-28-opmanager-sdp-autoticketing.docx` (ce dossier). Le dashboard a déjà : Infrastructure Health (dispo par site/famille), garde angle-mort sondes, notif ISP WAN SLA (armée-OFF) |
| §5.9 AD / identité | **Conçu, pas codé** — voir `2026-07-29-identity-ad-security.docx`. Gate décidé : **SSPR writeback = pré-requis avant tout write identitaire** |
| §5.1–5.3 Triage, choix du bon formulaire, validation des champs | **Agent « One IT Support » CONSTRUIT et publié** (Copilot Studio + Zoho MCP, tables de routage formulaires dans ce dossier) — **BLOQUÉ** : crédits Copilot Studio (admin Power Platform), approbation Teams admin, 1er test addRequest |
| §5.4 Assignment (business rules SDP) | À configurer côté SDP (action CLIENT, zéro dev) |
| §5.5 Teams push / Adaptive Cards | À FAIRE (rien d'existant) |
| §5.10 Patch compliance | À FAIRE (rien d'existant) |
| §4 Azure OpenAI dans SDP Cloud | À configurer (action CLIENT : ressource Azure + clé). Recommandation du handoff retenue : Azure OpenAI plutôt que ChatGPT direct pour les données ITSM |

**Principe directeur (déjà acté)** : le dashboard est la **colonne vertébrale de données** des agents ; **System Logs** est la piste d'audit ; SDP reste le système d'enregistrement.

---

## 2. Idées nouvelles retenues des articles

### 2.1 Pattern « deux agents » (Monitoring + Diagnostics) — article LinkedIn
- **Agent Monitoring** : détecte l'anomalie (métriques, seuils/ML). *Chez nous : ce rôle existe déjà — pollers Meraki/OpManager, snapshots, WAN SLA.*
- **Agent Diagnostics** : à la détection, exécute des **diagnostics read-only** (ping, DNS, espace disque, statut service, event log), joint le contexte au ticket SDP, propose la remédiation, **escalade à l'humain** pour tout ce qui est risqué.
- **À retenir pour nous** : quand l'auto-ticketing OpManager→SDP se fera (§5.8), créer le ticket **déjà enrichi** (device, site, sévérité, dernières métriques du dashboard, diagnostics read-only) au lieu d'un ticket nu. C'est le différenciateur.

### 2.2 Garde-fous éprouvés (LinkedIn + NetClaw)
- **Escalation gates** : l'agent ne franchit jamais seul le seuil du risqué ; il route vers SDP avec le diagnostic complet.
- **Change gating + audit trail** (pattern NetClaw) : toute action d'agent = journalisée. *Chez nous : System Logs est fait pour ça — toute action d'agent devra y écrire.*
- **Plans de changement « risk-mitigated »** générés par l'IA mais approuvés par l'humain → s'aligne sur notre CAB.
- Ces gardes **confirment le §6 du handoff** (liste des actions à approbation obligatoire) — à garder tel quel comme politique.

### 2.3 MCP comme couche d'intégration standard — awesome-network-automation-ai
- Le marché converge vers des **serveurs MCP par outil** (NetBox, Catalyst Center, SD-WAN vManage, Junos, pyATS…). Notre agent One IT Support utilise **déjà** le MCP Zoho — c'est la bonne architecture.
- **Idée concrète** : un **MCP server du SDP Dashboard** (lecture seule au départ) exposant aux agents ce que le dashboard sait déjà — dispo infra par site, worklists actifs, score sites, MI actifs — plutôt que chaque agent ré-interroge Zoho/Meraki/OpManager. Le dashboard devient littéralement la « data spine » des agents.
- **Optimisation token** (pattern `neterse`) : toute sortie CLI/diagnostic destinée à un LLM doit être compactée/reformatée — pas de dump brut de `show tech`.

---

## 3. Feuille de route (phases du handoff, ajustées à l'existant)

| Phase | Contenu | Propriétaire | Statut |
|---|---|---|---|
| **0 · Débloquer** | Crédits Copilot Studio (Power Platform Admin Center → Capacity) · approbation Teams admin · 1er test addRequest de One IT Support | **CLIENT / Microsoft admin** | 🔴 Bloqueur actuel |
| **1 · SDP natif** | App Teams SDP Cloud native (création/liste tickets, notifs) — fonctionne même sans crédits Copilot | CLIENT (config) | À valider |
| **2 · Azure OpenAI dans SDP** | Ressource Azure + déploiement modèle + clé → activer Summarization, Reply Assistant, Template Prediction, Solution Suggestion. Modèle éco pour le tout-venant, modèle fort pour PIR/RCA/MI | CLIENT (Azure) | À faire |
| **3 · Règles déterministes SDP** | Business Rules (catégorie/site/priorité/groupe) + workflows d'approbation (USB, admin local, logiciel non autorisé, accès ERP, licence Copilot). **Groupe d'abord, technicien individuel plus tard** | CLIENT (config SDP) | À faire |
| **4 · Teams push** | Notifs natives d'abord ; Adaptive Cards custom uniquement pour : MI, SLA breach, déviation sécurité, VIP, rapport hebdo site | DEV (léger) | À faire |
| **5 · Infra + identité** | Auto-ticketing OpManager→SDP **enrichi** (pattern 2 agents, §2.1) · runbooks read-only PowerShell/Python · remédiation gated par approbation · identité via ADManager/ADAudit **après le gate SSPR writeback** | DEV | Docs prêts, pas codé |
| **∞ · Transverse** | MCP server du dashboard (lecture) · journalisation System Logs de toute action d'agent · reporting = **ne rien reconstruire**, étendre le dashboard | DEV | Idée validée à cadrer |

---

## 4. Règles de sécurité (inchangées, confirmées par les 2 sources)

Jamais d'exécution directe sans approbation humaine pour : comptes/privilèges/groupes AD, admin local, accès USB, exceptions firewall, reboot serveur, restart service prod, déploiement patch, retrait d'actif, implémentation post-CAB. Séquence obligatoire : résumer → identifier impact (système/user/site) → évaluer le risque → proposer → **demander l'approbation** → journaliser (SDP + System Logs).

---

## 5. Prochaines actions immédiates

1. **CLIENT** : lever le bloqueur crédits Copilot Studio (sans ça, One IT Support reste mort dans Teams).
2. **CLIENT** : valider l'app Teams SDP native en parallèle (Phase 1 — indépendante des crédits).
3. **CLIENT** : créer la ressource Azure OpenAI (Phase 2) — le handoff contient les champs exacts demandés par l'écran SDP.
4. **DEV (quand 1–3 avancent)** : spec de l'auto-ticketing OpManager→SDP enrichi (reprendre le doc du 28/07 + le pattern 2 agents) et cadrage du MCP dashboard.
