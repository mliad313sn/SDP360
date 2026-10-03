# Alertes SLA dans les canaux Teams des groupes — design

**Date** : 2026-10-03 · **Demandeur** : Service & Support Manager · **Statut** : approuvé (développement de bout en bout sans approbation intermédiaire, la configuration est faite ensuite par l'utilisateur).

## Problème

Les techniciens lisent Teams, pas leurs e-mails. Il faut les prévenir **avant** qu'un ticket de leur groupe ne dépasse son SLA de **première réponse** puis de **résolution** — pas les incidents majeurs ni le reste.

## Pourquoi pas nos données actuelles

`request_records` vient de Zoho Analytics, synchronisé **toutes les heures** (plus le retard propre d'Analytics). Le SLA de 1ʳᵉ réponse est de 15–30 min pour un P1 : une alerte « bientôt due » arriverait après le dépassement. Et nous ne stockons pas l'échéance de 1ʳᵉ réponse. → lecture **directe de l'API REST de SDP Cloud**, toutes les 5 min.

## Architecture (approche B, + A en filet)

```
SDP Cloud API v3 ──(GET /requests, filtre « ouverts », toutes les 5 min)──► dashboard
   → normalisation (pur) → règles (pur) → anti-doublon (sla_alert_log)
   → regroupement par groupe SDP → carte Adaptive Card (pur)
   → POST webhook « Workflows » du canal Teams du groupe
```

**A (filet, sans code)** : escalade SLA native de SDP (« avant échéance ») vers l'adresse e-mail du canal — guide dans `docs/integration/2026-10-03-teams-sla-alerts-setup.md`.

## Unités

| Fichier | Rôle |
|---|---|
| `services/teamsSla.js` | PUR : `DEFAULT_RULES`, `parseRules`, `priorityLabel`, `normalizeRequest` (forme API v3 → ticket), `evaluate(tickets, rules, nowMs)` → alertes, `parseChannels`, `resolveChannel` |
| `services/teamsCard.js` | PUR : `buildGroupCard(group, alerts, opts)` → payload Workflows (Adaptive Card 1.4, FR) |
| `services/sdpApiClient.js` | OAuth Zoho (refresh token → access token, cache) + `listOpenRequests()` paginé ; transport injectable ; inerte non configuré |
| `services/slaAlertLog.js` | Anti-doublon `(request_id, kind)` — sqlite + pg (`013_sla_alert_log.sql`) |
| `tools/teams/poll-sla.js` | `main({dryRun, deps})` : config-gated, best-effort, ne lève jamais ; cron `*/5` |
| routes `/api/teams-sla/*` | super_admin : canaux (GET masqué / PUT), groupes connus, test d'un canal, aperçu (dry-run), lancement |
| carte admin `#ap-teams-sla` | réglages API SDP, règles, canaux, test, aperçu |

## Règles (défauts, réglables — `teams_sla_rules`)

| Alerte | Condition |
|---|---|
| `fr_soon` | pas encore de 1ʳᵉ réponse, échéance 1ʳᵉ réponse dans ≤ P1 10 / P2 20 / P3 60 / P4 240 min |
| `fr_breach` | pas de 1ʳᵉ réponse, échéance dépassée depuis ≤ 60 min (fenêtre : pas de déluge au 1ᵉʳ passage) |
| `res_soon` | ≥ 75 % du délai de résolution consommé (created → due_by) |
| `res_breach` | échéance de résolution dépassée depuis ≤ 60 min |
| `unassigned` | aucun technicien depuis ≥ 30 min, ticket de moins de 24 h |

Statuts en pause (`hold`) exclus. Une seule alerte par `(ticket, type)`, à vie. Une carte par groupe et par passage, ≤ 15 tickets (« + N autres »).

## Configuration (report_config)

- `teams_sla_enabled` (`'0'` = désarmé), `teams_sla_rules` (JSON), `teams_sla_last_run` (battement).
- `sdp_api_base_url` (défaut `https://oneitsupport.endeavourmining.com/app/itdesk/api/v3`), `sdp_api_accounts_url` (`https://accounts.zoho.com`), `sdp_api_client_id`.
- **Secrets** (masqués au GET, conservés si vides, chiffrés au repos A-13) : `sdp_api_client_secret`, `sdp_api_refresh_token`, `teams_sla_channels` (JSON `[{group, url}]` — une URL de webhook permet de publier dans le canal). Groupe `*` = canal par défaut.

## Erreurs

Tout est best-effort : API SDP en panne → aucun envoi, rien d'enregistré, le passage suivant réessaie. Webhook en échec → les alertes de CE groupe ne sont pas enregistrées (renvoyées au passage suivant). Groupe sans canal → compté, ignoré, non enregistré. Un passage ne chevauche jamais le précédent.

## Confirmations d'intégration (à valider sur l'instance réelle)

Le nom du filtre « ouverts » (`Open_System`), les noms de champs v3 (`first_response_due_by_time`, `due_by_time`, `responded_time`, `group`, `technician`, `priority`) — tous tolérés absents ; l'aperçu (dry-run) de la carte admin montre ce que l'API renvoie réellement.

## Tests

Pur : règles (chaque déclencheur, bornes, pause, fenêtre), normalisation, canaux, carte. Client : refresh + pagination avec transport simulé. Store : sqlite + parité pg. Job : transport + webhook simulés (dédup, échec webhook non enregistré, désarmé = rien). Routes : smoke super_admin + masquage des URL.
