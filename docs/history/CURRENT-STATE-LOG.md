# SDP Dashboard — "Current state" log (2026-05 → 2026-10)

Moved verbatim from `CLAUDE.md` on 2026-10-22 (SDP-DASH-2.0 step 5, lot 5.5). `CLAUDE.md` is now an index; edit THIS file.
Chronological session log, newest first. Each section was true the day it was written; a "NOT deployed" stamp
is history, not a to-do (see the deployment-reality note at the top of `CLAUDE.md`). New entries go to `CHANGELOG.md`.

---

## ⚡ Current state (as of 2026-10-16 — statuts de transfert, mois clôturés du tracker, export Excel Réunions)

> - **Statuts de transfert** (problèmes `md_issues` + actions `md_actions` SEULEMENT — ni inspections ni
>   suivis du rapport, décision user) : `demand` (Demande / Initiative), `helpdesk_ticket` (Ticket Helpdesk)
>   et `cancelled` exigent un **commentaire** ; `helpdesk_ticket` exige aussi le **n° du ticket SDP**
>   (chiffres seuls). Règle UNIQUE **`public/lib/statusTransfer.js`** (UMD : `DONE`, `isTransfer`,
>   `validate`, `normalizeTicket`, `ask()` = la fenêtre des pages). Colonnes `status_note` /
>   `helpdesk_ticket` (sqlite ALTER + pg `ADD COLUMN IF NOT EXISTS`, codes insérés si absents), effacées
>   dès que l'élément quitte le statut de transfert. Comptés **comme « Annulé »** (décision user) : hors
>   listes ouvertes/retard, jamais « résolu » dans le score programme. Toute liste SQL de statuts terminés
>   de `meetings-db.js` = `('resolved','cancelled','closed','demand','helpdesk_ticket')` — un nouveau code
>   terminal doit rejoindre `DONE` ET ces listes. Le serveur refuse (400) une **transition** sans
>   justification : `/issues/:id/update`, `/actions/:id/update`, `/api/meetings/save` (`_meetingTransferError`,
>   les lignes déjà dans ce statut passent) ; l'import xlsx n'y est pas soumis.
> - **Suite (même jour) — suivis du rapport + hub** : annuler une action du rapport hebdo exige aussi une
>   justification (hub `/api/reports/action/:uid/status {status, note}` → ajoutée au `comment` « Cancelled: … » ;
>   `PUT /:id/actions` refuse une transition vers `cancelled` à commentaire vide ; l'éditeur ouvre la fenêtre et
>   **remet le statut précédent tant qu'elle est ouverte** — sinon l'autosave 1,5 s enverrait l'annulation sans
>   justification). Colonne **`action_items.status_changed_at`** (posée à l'INSERT et à chaque changement de
>   statut). Hub : bouton **Undo** dans le toast (pas depuis un statut de transfert) et case **« Show closed /
>   cancelled (30 days) »** (`?closed=1` → `recent_closed`, pur `buildRecentlyClosed`, rapport via
>   `getSiteClosedReportActions` — date = `status_changed_at`, sinon début de semaine) pour rouvrir sur place.
>   Piège trouvé par le test : `getReport()` rend `action_items`, PAS `actions`. Piège pg : un `?` seul dans
>   `? IS NULL` n'est pas typable → `CAST(? AS TEXT)`.
> - **Tracker, mois clôturés** : sous super_admin, seuls le mois en cours (+ le précédent jusqu'au **5**)
>   sont modifiables ; `public/lib/trackerMonthLock.js` côté page (cellules grisées + bandeau) ET serveur
>   (`saveTracker(D, scope, { lockClosed })` et l'import des réunions gardent la valeur STOCKÉE des mois
>   clos, renvoient `closed_blocked` → la page avertit et se recharge). tracker-admin est verrouillé aussi.
> - **Export Excel Réunions cassé pour tout éditeur** depuis les éditeurs multi-sites : la route passait la
>   LISTE de codes comme une seule valeur à `exportRows` → accepte maintenant une liste (`IN (…)`).
> - Tests : `status-transfer.smoke` (8), `tracker-month-lock` (5), + `pg-meetings`, `multi-site-editor.smoke`,
>   `tracker-save-site-scope.smoke`. **Libellés en anglais partout** (`StatusTransfer.label()` : plus de codes bruts ni de mélange FR/EN dans le hub, fenêtre et messages serveur en anglais, casse des inspections alignée). Vérifié au navigateur (fenêtre de justification, cellules verrouillées,
>   Excel en éditeur). Aide à jour (2026-10-16, EN + FR) : §4.4 (reconduction, aperçu d'import, code de groupe, fusion),
>   §10.5-10.6 (enregistrement auto, mois clôturés), §12.3/12.6/12.8/12.9 (statuts de transfert, Excel éditeur,
>   hub Site Actions), §2/§7 (éditeurs multi-sites) — garde `tests/help-recent-updates.test.js`.

---

## ⚡ Current state (as of 2026-10-15 — actions du rapport : fusion par groupe, aperçu d'import, identité visible ; historique réécrit)

> **Historique git RÉÉCRIT le 2026-10-15** (un mot de passe postgres traînait dans 14 docs + 1 message
> de commit, remplacé par `<PG_PASSWORD>`) → **les SHA cités dans les sections plus anciennes de ce
> fichier sont périmés** (cherche par message de commit). Correspondances utiles : lots gelés installeur `578be34`→`f6f0b12`, tracker RAG `c97ae61`→`437a80f`, donut pondéré `e17b7b7`→`b681083` (`frozen-lots.json` mis à jour). `main` est poussé sur origin ; marqueur
> `.git/last-deployed` remappé (`a1c4830` = l'ancien `a6abafa`). Toutes les branches/worktrees annexes
> ont été supprimés : seules restent `main` et la branche de ce worktree.
>
> - **Groupe d'actions** = `lineage || uid` (le plus récent fait foi, terminal = closed/cancelled).
>   Logique partagée navigateur + serveur : **`public/lib/actionGroups.js`** (UMD ;
>   `services/reportActionGroups.js` le ré-exporte) — `shortCode` (`#XXXX`, hash FNV base36), `hue`,
>   `summarizeGroups`, `classifySourceRows` (raisons `in_current` · `closed_since` · `cancelled` ·
>   `closed`), `weekCounts`.
> - **Fusion = tout le groupe** : `rdb.relineageGroup(uid, key, task)` déplace TOUTES les lignes du
>   groupe de l'action cliquée (même site) — l'ancien `setActionLineage` ne bougeait qu'une ligne et
>   les copies plus anciennes ressurgissaient comme ouvertes. Journal `action_merged`. **Les doublons
>   déjà en prod ne se corrigent pas tout seuls : refaire la fusion une fois après déploiement.**
> - **Import d'une semaine = aperçu** à cases (cochées si importables, raison sinon — y compris une
>   action seulement tapée dans l'éditeur, non sauvegardée) ; `action-weeks` compte les actions
>   réellement importables ; la reconduction auto ne prend que les importables.
> - **Identité visible** : badge `#CODE` coloré + « suivie depuis Wxx · N sem. » (import + fusion),
>   bordure colorée + infobulle sur la cellule de l'action.
> - **Bug pg corrigé** : `_getActionsForReportPg` n'excluait pas les `closed` (le sqlite si) → la prod
>   reportait des actions fermées.
> - Tests : `report-action-groups` (7), `action-import-window.smoke` (3), `reports-action-import-ui`
>   (7), `action-relineage.smoke` (+ chaîne), pg dans `pg-reports-reports`. Vérifié au navigateur.

---

## ⚡ Current state (as of 2026-10-05, plus tard — éditeurs multi-sites, `f6e0c7c`, PAS déployé à l'écriture)

> **Demande user** : un `editor` doit pouvoir être éditeur de PLUSIEURS sites (sans passer Admin, qui voit
> tout). **Modèle** : le site principal reste `users.site_id` (inchangé) ; les **sites supplémentaires** vivent
> dans **`user_sites`** (sqlite + pg `014_user_sites.sql`, CASCADE, ne contient jamais le principal). La
> session (`safeUser` / `_safeUserPg` — **une seule** définition pg, une seconde écrasait la première en
> silence) porte **`site_ids`** = [principal, …suppléments] ; `listUsers` porte `extra_site_ids` ;
> `createUser`/`updateUser` acceptent `extra_site_ids` (remplacé seulement s'il est envoyé).
> - **Règle** : « son site » = **un de ses sites**, via le pur **`services/userSites.js`** (`siteIds`,
>   `hasSite`, `codesFor`, `pickCode`, `inScope`). Ne JAMAIS écrire `user.site_id === x` dans un nouveau
>   contrôle. Les gardes d'écriture des modules (`saveMeeting`, `saveInspection`, `saveTracker`) acceptent
>   une **liste** de codes ; `_userMeetingsSite(user, wanted)` / `_userInspectionSite(user, wanted)` rendent
>   le code de l'objet s'il appartient au compte, sinon le principal (les tests `code !== userSite`
>   existants restent justes). `/api/inspection/lookups` et `/api/tracker/load` ajoutent **`scopes`**
>   (liste) à côté de `scope` (= principal, pour les anciennes pages).
> - **Listes et exports** (`/api/reports`, PV non signés, export Excel/PPTX inspection, SLA WAN) : tous les
>   sites du compte, ou celui demandé par `?site=` s'il en fait partie ; les exports par site restent « un
>   site à la fois » (celui demandé, sinon le principal).
> - **Interface** : fiche utilisateur ▸ « Sites supplémentaires » (cases, le principal en est retiré) +
>   badge « +N » dans la liste ; le sélecteur du tracker ne propose que les sites du compte ; Inspections
>   et Issues Log comparent à la liste. Sans effet pour le palier Admin (déjà sans restriction).
> - Tests : `user-sites` (4), `multi-site-editor.smoke` (6), pg dans `pg-reports-auth`, + suites RBAC
>   existantes vertes. Vérifié au navigateur (fiche, badge, tracker limité à 2 sites, sauvegarde bornée).

---

## ⚡ Current state (as of 2026-10-05 — Site Actions Register : bloc Business Incubation + problèmes ouverts)

> - **Bloc Business Incubation** (`1e4872b`, déployé) : les actions des sessions d'incubation
>   (`intake_source='business_incubation'` OU référence `_INC_`) ont leur propre groupe `incubation` dans
>   `buildSiteActions` ; e-mail coordinateur, Site Awareness et Meridian les **replient** avec les réunions.
> - **Problèmes ouverts dans le hub** (`e665615`, PAS encore déployé à l'écriture) : `groups.issues` = les
>   `md_issues` non `resolved|cancelled` du site (HIGH d'abord, puis en retard), chacun avec
>   **`open_actions`** = nombre d'actions ouvertes qui le traitent (`md_actions.linked_issue_id`).
>   **Pas compté dans `totals.open`** (ce sont des problèmes, pas des actions). Page : case
>   « Problèmes sans action seulement », statut modifiable (`/api/meetings/issues/:id/update`), bouton
>   **« + Action »** (seulement s'il n'y en a aucune — anti-doublon) → **`POST /api/meetings/issues/:id/actions`**
>   (`meetings-db.addActionForIssue`, sqlite + pg : ligne `md_actions` liée + ligne d'historique
>   « Action ajoutée : … » ; même RBAC que `/update` : editor, son site). **Fermer la DERNIÈRE action ouverte
>   d'un problème PROPOSE** (confirm, jamais automatique — choix user) de le passer `resolved` avec la trace
>   « Résolu après la fermeture de sa dernière action ». Les statuts `md_issues` : open · in_progress · blocked
>   · on_hold · resolved · cancelled.

---

## ⚡ Current state (as of 2026-10-04 — rubrique « Intégration API » : Alertes SLA + connexion Analytics éditable)

> - **Admin ▸ 🔌 Intégration API** (`PANEL_GROUPS.api`, rail `admin-rail-grp-api`) regroupe deux onglets :
>   **Alertes SLA** (`#ap-teams-sla`) et **Analytics** (`#ap-analytics-api`). Super_admin.
> - **Connexion Zoho Analytics éditable dans l'interface** (demande user : sortir du `.env`) :
>   `services/analyticsSettings.js` résout **base (`report_config` `analytics_*`) → `.env` (`ZOHO_CLIENT_ID`,
>   `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `WORKSPACE_ID`, `ORG_ID`) → défaut**, cache 60 s, lecture ratée
>   (PG pas prêt) jamais mise en cache. `server.js` `_applyAnalyticsSettings()` réécrit `CONFIG` avant chaque
>   rafraîchissement du jeton et après chaque enregistrement (jeton invalidé → nouveaux identifiants sans
>   redémarrage). **Au démarrage le jeton est désormais rafraîchi APRÈS l'ouverture des bases** (les identifiants
>   peuvent vivre en PG) et un `.env` vide **n'arrête plus** le serveur. Routes `GET/PUT /api/integrations/analytics`
>   (secrets en écriture seule, source de chaque valeur : base / .env / défaut) + `POST …/test` (rafraîchit
>   le jeton, rend le scope). **`DASH_API_KEY` reste dérivé du `.env`** (volontaire — piège X-Dash-Key).
>   Tant que rien n'est enregistré dans l'onglet, la prod tourne exactement comme avant sur le `.env`.
> - **Confirmé sur l'instance réelle (2026-10-04, `b714ef3` en prod)** : OAuth SDP OK ; le filtre
>   `filter_by Open_System` est **IGNORÉ** par SDP Cloud (2036 lus dont 1598 Closed) ; le **`search_criteria`
>   `status.name` « is not » [Closed, Resolved, Cancelled, Rejected, Completed]** est ACCEPTÉ → 352 tickets lus
>   (repli automatique sur lecture complète si une instance répond 400). Statuts vus : *Awaiting Reply*,
>   *Approval pending*, *PO Raised*, *Pending Verification* = SLA en pause (comme *On Hold*), *Rejected* = terminé.
>   Webhook Workflows + carte testés dans un vrai canal (« London IT Support ▸ Alertes SLA », groupe SDP
>   « IT Agents ») ; une carte n'alerte le téléphone que si le canal est en « Show in Activity and banner »
>   (réglage individuel) — les @mentions (technicien / personnes par groupe) ont été proposées, pas construites.
> - **Alertes SLA** : règle `max_ticket_age_days` (défaut **30**, 0 = sans limite) avec son propre champ dans la
>   carte ; la lecture API (triée du plus récent) **s'arrête** à la date limite. Le 1er aperçu réel (2026-10-04)
>   avait lu 2000 tickets pile = l'ancien plafond : statuts terminés écartés côté dashboard, plafond 5000,
>   l'aperçu affiche la répartition par statut + « tronqué », groupes regroupés sans tenir compte de la casse.
>   Le lien ticket de la carte = `sdpTicketUrl()` du Helpdesk (pinné par test).
> - Tests : `analytics-settings` (5), `analytics-integration-routes.smoke` (4), `teams-sla-admin-card` (5) + ajouts
>   rules/client/poll. **Self Client Zoho** : un seul par compte, partagé Analytics + SDP — un nouveau refresh token
>   par usage, ne jamais supprimer/recréer le client ni régénérer son secret.

---

## ⚡ Current state (as of 2026-10-03, plus tard — Alertes SLA dans les canaux Teams, sur `main`, PAS déployé, désarmé)

> **Besoin (user)** : les techniciens lisent Teams, pas les e-mails → prévenir le **groupe** dans son canal
> Teams **avant** le dépassement du SLA de **1re réponse** puis de **résolution** (pas les incidents majeurs).
> **Pourquoi pas nos données** : `request_records` vient d'Analytics, synchronisé **toutes les heures** (+ retard
> propre d'Analytics) et ne porte PAS l'échéance de 1re réponse → trop lent pour un SLA de 15-30 min.
> **Décision (user) : approche B + A en filet** — le dashboard lit **l'API REST de SDP Cloud** toutes les 5 min
> et poste **une carte par groupe** via un webhook **Workflows** Teams ; en attendant, escalade SLA native SDP
> vers l'adresse e-mail du canal (guide). Spec : `docs/superpowers/specs/2026-10-03-teams-sla-alerts-design.md`,
> **guide de mise en service : `docs/integration/2026-10-03-teams-sla-alerts-setup.md`**.
>
> - **Pur** : `services/teamsSla.js` (règles `DEFAULT_RULES`, `normalizeRequest` forme v3 `{value}`/`{name}`,
>   `evaluate` → `fr_soon` P1 10/P2 20/P3 60/P4 240 min · `fr_breach` · `res_soon` 75 % du délai · `res_breach`
>   (dépassements annoncés seulement s'ils ont < 60 min : pas de déluge au 1er passage) · `unassigned` ≥ 30 min,
>   ticket < 24 h ; statut « hold » = SLA en pause, rien), `parseChannels`/`resolveChannel` (groupe `*` = défaut) ;
>   `services/teamsCard.js` (Adaptive Card 1.4 FR, sections par urgence, ≤ 15 tickets + « + N autres »,
>   lien `…/app/itdesk/ui/requests/<id>/details`).
> - **I/O** : `services/sdpApiClient.js` (OAuth Zoho refresh → access token caché, `GET /requests` paginé borné,
>   filtre `Open_System`, Accept `application/vnd.manageengine.sdp.v3+json`) ; `services/slaAlertLog.js`
>   (anti-doublon `(request_id, kind)` à vie, purge 90 j ; sqlite + pg `013_sla_alert_log.sql`) ;
>   `tools/teams/poll-sla.js` `run({dryRun})` — ne lève jamais, jamais deux passages en parallèle, webhook en
>   échec = alertes du groupe NON enregistrées (réessai), groupe sans canal = compté, non enregistré,
>   **URL de webhook jamais dans un résultat/log** ; **cron `*/5`**.
> - **Config** (`report_config`) : `teams_sla_enabled` (`'0'`), `teams_sla_rules` (JSON), `teams_sla_last_run`,
>   `sdp_api_base_url` (`https://oneitsupport.endeavourmining.com/app/itdesk/api/v3`), `sdp_api_accounts_url`,
>   `sdp_api_client_id`, `sdp_api_open_filter` ; **secrets** (masqués, blank-keep, chiffrés A-13) :
>   `sdp_api_client_secret`, `sdp_api_refresh_token`, **`teams_sla_channels`** (JSON `[{group,url}]` — une URL
>   de webhook permet de publier dans le canal).
> - **Routes** `routes/teamsSla.js` (super_admin) : `GET/PUT /api/teams-sla/settings` (écriture seule des
>   secrets/URL ; URL vide = conserver ; https obligatoire), `POST /test` (carte TEST dans un canal),
>   `/preview` (dry-run, même désarmé), `/run`. **Carte admin** `#ap-teams-sla` « 🔔 Alertes SLA Teams »
>   (4 surfaces câblées).
> - Tests : `teams-sla-rules` (10), `teams-sla-card` (5), `sdp-api-client` (6), `sla-alert-log` (3) +
>   `pg-sla-alert-log`, `teams-sla-poll` (7), `teams-sla-config` (2), `teams-sla-routes.smoke` (6),
>   `teams-sla-admin-card` (3). Vérifié au navigateur (instance locale jetable).
> - **⚠ Confirmations d'intégration** (comme Meraki) : nom du filtre « ouverts » et noms des champs v3
>   (`first_response_due_by_time`, `due_by_time`, `responded_time`…) — l'**Aperçu** de la carte montre ce que
>   l'API renvoie réellement. **Étapes user** : client OAuth Zoho (`SDPOnDemand.requests.READ`), un webhook
>   Workflows par canal, puis armer.

---

## ⚡ Current state (as of 2026-10-03 — Formulaire Business Incubation dédié, en prod, marqueur `0b649ba`)

> **Tout `main` est en prod jusqu'à `0b649ba`** (ZIP appliqué, pm2 redémarré, marqueur avancé le 2026-10-03).
> Les lots gelés (installeur `578be34`, tracker RAG `c97ae61`+`e17b7b7`) restent DERRIÈRE le marqueur.
>
> **Constat** : dans `meeting.html`, choisir l'Origine « Business Incubation » ne changeait qu'une étiquette —
> les §1-§4 du *Incubation Follow-up Report* n'arrivaient que par l'import xlsx, puis en lecture seule.
> **Désormais un seul formulaire, deux mises en page** (`#pvMain[data-mode="pv"|"inc"]`, CSS
> `[data-only="pv"|"inc"]`, bascule sur le `change` de `hIntake`) :
> §1 Identification (début/fin de session, durée, **incubé** + fonction, manager d'incubation = `department_head`,
> manager IT = `site_it_lead`, recopiés dans `incubation.roles` à la sauvegarde) · §2 Description du métier ·
> §3 Flux de l'information (entrant → activité → sortant) · §4 Services fournis, **statut en liste fermée**
> `active · in_progress · planned · stopped` (décision user) · §5 Défis & obstacles = les issues · §6 Actions
> **gardées** (décision user) · §7 Escalades · §8 Signatures. Priorités + projets masqués pour une incubation ;
> le PV départemental est inchangé (7 sections).
>
> - **Serveur** : `POST /api/meetings/save` accepte `state.incubation` → normalisé par le pur
>   **`services/incubationForm.js`** (`normalizeIncubation`, `normalizeServiceStatus`, plafonds de taille) puis
>   `setMeetingIncubation` ; **effacé** (`null`) si la session n'est pas une incubation ; **clé absente = blob
>   intact** (sauvegardes d'en-tête, imports). L'import xlsx mappe les statuts libres (« Actif », « En cours »…)
>   sur la même liste, et l'onglet Codes la liste.
> - **Client** : **`public/lib/incubationEditor.js`** (UMD pur : `fromHeader`, `payloadIncubation`,
>   `flowRowsHtml`, `serviceRowsHtml`) ; le panneau lecture seule `#pv-incubation` a disparu.
> - **Bug corrigé au passage** : une incubation saisie à la main recevait la référence auto
>   `SITE_Dept_PV_AAAA-MM` et, la correspondance par référence l'emportant, **écrasait le PV du mois**.
>   `_buildReference(…, intake_source)` produit maintenant `SITE_Dept_INC_AAAA-MM` (même balise que l'import),
>   sqlite + pg. Pinné par `tests/meetings-incubation.test.js` + `tests/pg-meetings.test.js`.
> - Tests : `incubation-form` (5), `incubation-save-route.smoke` (4), `incubation-editor-client` (6) ;
>   suite complète **2273 pass / 0 fail / 0 skipped** (checkout principal, PG compris). Vérifié au navigateur
>   sur une instance locale jetable (aller-retour de sauvegarde, 8 sections, PV inchangé).
> - **Reste** : caler les libellés sur le modèle Word du rapport d'incubation (absent du dépôt — « Incubé »
>   est une traduction provisoire).

---

## ⚡ Current state (as of 2026-10-02 — Audit RBAC & périmètre de site, lots 1-4 + rétrogradation, TOUT en prod)

> **Tout `main` est en prod jusqu'à `9e37113`** (avancer le marqueur avec `mark-deployed.cmd` s'il ne l'est
> pas). Les lots gelés (installeur `578be34`, tracker RAG `c97ae61`+`e17b7b7`) restent DERRIÈRE le marqueur.
>
> **Déclencheur** : le coordinateur de Houndé ne pouvait pas enregistrer le tracker — `403 « no site
> assigned »`. Cause : `tracker-db.SITE_MAP` cherchait le nom du site **à l'exacte casse** (`HOUNDE`,
> `Hounde IT Agents`) alors que les lignes `sites` s'appellent `Hounde`, `Ity`, `Lafigue`… → **8 sites sur
> 11 ne pouvaient pas enregistrer** (seuls Sabodala, MANA, Dakar tombaient juste). Corrigé en `6804ebe`
> (normalisation casse/accents/suffixe comme `inspection-db`, + `siteToCode(site)` qui retombe sur le
> `zoho_group`). Puis audit transverse de la même famille, plan :
> **`docs/superpowers/plans/2026-10-02-rbac-site-scope-audit.md`**.
>
> **RÈGLE D'ACCÈS (décision utilisateur, « tout ouvrir aux coordinateurs, verrouillé à leur site »)** :
> un compte **`editor`** agit sur **son propre site** ; le palier **admin** (`admin`/`executive`/`super_admin`)
> est sans restriction ; un compte **sans site** (ou dont le site n'a pas de code dans le module) **n'écrit
> rien** et ne lit rien par site. Vérifier les rôles par **`rdb.userHasRole(user, 'admin')`** (hiérarchie),
> **jamais** par `user.role === 'admin'` (excluait les executive). Montants des actifs : admin+ (G-11).
>
> - **Lot 1** (`070c4ce`, `0c44ff1`) : modifications du rapport mensuel et objectifs annuels **sans aucun
>   contrôle** (un `viewer` pouvait réécrire n'importe quel site) → règle F5 (`_authorizeSiteWrite`) ;
>   décision de réconciliation des actifs → `editor` ; écritures Réunions/Inspections d'un non-admin **sans
>   site** traitées comme globales → refusées (`_sitelessWriteDenied`) ; e-mail utilisateur **perdu sur
>   PostgreSQL** (create/update/list) → parité avec sqlite.
> - **Lot 2** (`36fad74`) : `GET /api/tracker/load` ouvert à `admin` OU `tracker-*`, et renvoie **`scope`**
>   (code tracker du compte ; `''` = site non résolu → lecture seule) ; le navigateur verrouille le sélecteur
>   de site dessus (`__authUser` n'a PAS de `site_name` — le verrou n'avait jamais marché, et les saisies
>   sur un autre site étaient jetées en silence par le serveur) ; export PPTX tracker = admin|tracker-admin.
> - **Lot 3** (`e78cefd`) : la suppression d'inspection annonçait « supprimé » sur un 403 ; boutons masqués
>   selon le rôle de leur route ; journal d'audit 403 ≠ « aucune entrée » ; **`auth.js` rafraîchit les rôles**
>   depuis `/api/reports/auth/me` et recharge la page **une fois** (`sessionStorage auth_roles_reloaded`) —
>   avant, le cache `localStorage` gardait les anciens rôles jusqu'à 24 h.
> - **Lot 4a** (`e2fb656`) : **garde central de lecture** `app.get([_REPORT_ID_READ, _SITE_ID_READ], …)`
>   (juste après `requireReportSession`) sur tout `GET /api/reports/<id>/…` et `/api/reports/{monthly,yearly,
>   objectives}/<site>/…`, `/api/sites/<id>/…` — une route ajoutée plus tard est verrouillée d'office ;
>   `site-data`/`site-actions` par code, `helpdesk-live`/`helpdesk-charts` par groupes Zoho du site ; decks
>   tous-sites et synthèse hebdo = admin ; journal d'audit ouvert à l'éditeur sur son site
>   (`audit-viewer` reste global). `reports.html` : `_adminTier()` remplace les `role === 'admin'`.
> - **Lot 4b** (`adfb2a8`) : **trou fermé** — un éditeur pouvait **écraser l'inspection d'un autre site** en
>   réutilisant son `f_id` (seul le site entrant était vérifié) ; rouvrir/modifier une inspection soumise,
>   supprimer, PPTX unitaire et consolidé, Excel → éditeur, son site (`exportRows({site})`,
>   `getInspectionHeader`, `/lookups` renvoie `scope`).
> - **Lot 4c** (`54aa8dc`) : **trou fermé** — l'import PV/incubation appelait `saveMeeting(state, null)`
>   (aucun contrôle de site) ; import, édition des PV **clos** et de leurs problèmes, suppression, Excel →
>   éditeur, son site.
> - **Lot 4d** (`34ea25c`) : SLA WAN ouvert à l'éditeur, toutes les lectures filtrées sur son site.
>   **Analytics reste `admin|scorecard-viewer`** (décision : option a) — non verrouillable proprement
>   (colonne `request_records.site` libre, CAB/enquête sans dimension site).
> - **Retour en brouillon** (`8baa98d` puis `2cd72ce`) : un **éditeur sur son site** peut remettre un rapport
>   soumis en brouillon (le contrôle `_authorizeReportWrite` suffit) ; admin+ partout.
>
> **Rétrogradation G-12 FAITE en prod le 2026-10-02** avec **`tools/pg/demote-coordinators.js`**
> (`0a8c811`, `--drop` en `9e37113`) : simulation par défaut, `--apply`, `--add-tracker-editor`, `--except=`,
> `--drop=<rôle de fonction>`, `--restore=<fichier>` ; sauvegarde des rôles d'origine puis **une seule
> transaction**. 16:18 → **25 comptes `admin` → `editor`** (+`tracker-editor`) ; 16:24 → `audit-viewer` retiré
> de 17. Sauvegardes : `data\role-backups\roles-2026-10-02T16-18-29-834Z.json` et
> `…T16-24-00-792Z.json` (restaurer dans l'ordre inverse). Restent `admin` : `dgoro`, `serge.guiro@`
> (sans site, équipe centrale). Exploration et ASSAFO n'ont pas de code Réunions/Inspections → leurs
> comptes ne peuvent plus y écrire — **voulu** (ces sites ne font ni PV ni inspection dans le dashboard).
>
> **Autres faits de la session** : **A-13 confirmé** (test SMTP OK, le pm2 en cours a la clé) ;
> **Santé des infrastructures** (`3cc106c`) : la page affiche maintenant l'erreur réelle au lieu de
> « Aucune donnée » — et a révélé que la **vue Analytics Plus d'OpManager est figée au 2026-05-24** (notre
> synchro tourne : `rows=57075 … upserted` ; c'est l'import OpManager → Analytics Plus qui s'est arrêté,
> à relancer côté Zoho). Suite de tests : **2 242 pass / 0 fail / 0 skipped** (checkout principal, PG compris).
> Intégration Copilot (API M365 Copilot Chat, préversion, déléguée, licence par utilisateur) **mise en pause**.

---

## ⚡ Current state (as of 2026-09-24 — Audit OPS phases 0/2/4 + phase 3, mergé `ba7eecd`, ZIP appliqué en prod)

> Le moteur d'audit écrit le 2026-09-17 (`docs/prompts/2026-09-17-ops-platform-audit-engine.md`) a
> enfin été **exécuté** : phases **0** (baseline), **1** compressée, **1bis** (piste Assets), **2**
> (bibliothèque `/goal`) et **4** (AMDEC) → rapport + journal dans
> **`docs/audits/2026-09-24-audit-phases-0-2-4.md`** ; puis la **phase 3 sur les 7 goals sans
> arbitrage** (branche `audit/phase3-2026-09-24`, 10 commits, fusionnée `--no-ff` en **`ba7eecd`**).
> **ZIP `sdp-deploy_ba7eecd_*` (22 fichiers) APPLIQUÉ en prod le 2026-09-24 par l'utilisateur.**
> **Marqueur avancé à `ba7eecd`** et **pm2 redémarré** le même jour : la chaîne est complète
> (le lot touche `server.js` ET deux HTML mis en cache au boot, `assets.html` + `help.html`, donc
> le redémarrage était indispensable — un `reload` ne suffit jamais). Les utilisateurs ont besoin
> d'**un Ctrl+F5** chacun. Le ZIP ne porte évidemment ni l'installeur ni le tracker gelés (il le
> DIT maintenant, cf. G-10).
>
> **Référence T0 CAPTURÉE en prod le 2026-09-24** (`node tools\pg\asset-engagement-kpis.js`) et
> archivée au **§9 du rapport d'audit** — c'est elle, pas les chiffres de dev, qu'il faut rejouer à
> 30 jours. En résumé : **2279 actifs**, sans QR 455 (20 %), sans date 1822 (80 %), sans coût 1957
> (86 %), **sans utilisateur 2139 (94 %)**. Les sites **progressent** (HOUNDE +11, Massawa +9,
> LAFIGUE +3, MANA +2) : le moteur marche, c'est sa lisibilité qui manquait. Elle a aussi révélé
> **14 lignes de classement pour 11 sites ayant des actifs** (`Ouaga` ET `Ouagadougou`, `Dakar` ET
> `Dakar Office`, plus la faute de frappe `Fetekro Explorarion Office` dans la donnée source).
>
> **3ᵉ lot DÉPLOYÉ le 2026-09-24 (marqueur `7377266`, pm2 redémarré) — `a08c0ad` (G-04) +
> `42f56fa` (G-05)** : sous **20 actifs** un
> site garde son score mais **n'est plus classé** (le 1-actif à 100 devant une mine de 474 tuait
> l'argument), la taille du parc voyage avec chaque score, les libellés en double sont repliés **par
> somme des compteurs puis recalcul** (jamais une moyenne de deux scores), et les compteurs du parc
> portent enfin **la part du parc** + le partage `unassigned` **En service** (anomalie) / **En stock**
> (normal). G-05 est **strictement additif** : les quatre compteurs figés gardent leur définition,
> donc les rapports déjà soumis restent comparables.
>
> **⚠️ Effet visible par les sites** : les rangs ont changé (page Progress + digest « Assets —
> Groupe »). Trois sites qui figuraient au classement n'y sont plus (Ouagadougou, Dakar, Massawa —
> sous 20 actifs), et `Dakar Office`/`Ouaga` ont disparu comme lignes distinctes. Si quelqu'un
> demande pourquoi son site n'est « plus classé », la réponse est sous les deux tableaux : le seuil
> est écrit, et il se change en une ligne (`MIN_RANKED_ASSETS`, `assets-db.js`).
>
> **4ᵉ lot DÉPLOYÉ le 2026-09-24 (marqueur `df23d70`) — `878742e` (G-11) + `4b98801` (G-12)**.
> **G-11 (décision user : restreindre à admin+)** : les routes porteuses de montants
> (finance, licences, investment, depreciation **et l'export Excel de l'inventaire** — le moyen le
> plus simple de sortir avec les chiffres) exigent `admin` ; **l'inventaire reste ouvert à tous**
> mais **sans montants** en dessous d'admin (`_stripAssetMoney`, les XOF bruts autant que les USD
> convertis) ; les onglets Finance et Investment sont **masqués et retirés du jeu d'ancres** pour ces
> comptes, donc personne n'est envoyé dans un 403 ; l'aide §18.3 le dit EN + FR. **Réserve honnête,
> écrite dans le test** : avec 24 comptes `admin` sur 29, la restriction ne mord vraiment qu'après
> G-12.
> **G-12 (moitié agent)** : `node tools\pg\audit-roles.js` — **lecture seule**, classe chaque compte
> actif en `over_privileged` (admin AVEC un site → proposition `editor`, site conservé) ·
> `central` (admin SANS site → à confirmer, jamais proposé) · **`blocked`** (editor SANS site → **ne
> peut écrire AUCUN rapport**, à nommer en premier). Lu sur la copie de dev : **22 sur-privilégiés,
> 2 à confirmer, 0 bloqué** — la rétrogradation est donc plus sûre que le constat ne le laissait
> craindre, mais **la liste doit être rejouée sur le serveur** (ces noms datent de trois semaines).
> **Le changement de rôle reste un geste humain dans Admin ▸ Users**, compte par compte : un UPDATE
> en masse est exactement la façon dont un coordinateur découvre le lundi que son rapport est refusé.
>
> **➡️ IL RESTE DEUX GESTES, tous deux humains :**
> **(A) FAIT le 2026-09-24 (marqueur `9181a0e`)** : `SDP_CONFIG_KEY` posée en prod et les deux
> secrets qui existaient (`smtp_pass`, `meraki_api_key`) chiffrés en place via
> `node tools\pg\encrypt-secrets.js --apply` — `check-secrets.js` confirme « Aucun secret en
> clair ». **A-13 est refermé.** Deux règles à ne pas perdre : la clé vit dans `.env`, le seul
> fichier qu'un dump ne contient pas, et **restaurer un dump sur une autre machine exige la même
> clé** (sinon les secrets sont lus VIDES, avec une ligne de log qui le dit). Les quatre secrets
> non renseignés se chiffreront d'eux-mêmes à leur première saisie.
> **(B) La rétrogradation des rôles**, dans cet ordre : (1) `node tools\pg\audit-roles.js` **sur le serveur** — la
> liste de dev a trois semaines ; (2) rétrograder les comptes `over_privileged` en `editor` dans
> **Admin ▸ Users**, un par un, **site vérifié à chaque fois** ; (3) re-lancer l'outil : le compte
> `blocked` doit rester à **0**. Tant que les 22 gardent `admin`, la restriction des montants de
> G-11 ne mord sur personne — c'est la rétrogradation qui l'active.
>
> **5ᵉ lot DÉPLOYÉ le 2026-09-24 (marqueur `af5d84b`) — `d9359c3` (G-02) + `2a61187` (A-13)** — la
> bibliothèque est close. ⚠️ **A-13 est INERTE tant que `SDP_CONFIG_KEY` n'est pas posée dans le
> `.env` de prod** : c'est délibéré (aucun risque au déploiement), mais tant que la variable manque,
> les six secrets restent en clair dans les dumps — l'outil est livré, la protection n'est pas
> encore active. La bibliothèque est
> close.
> **G-02 : les 75 tests PG ne sont plus sautés, ils PASSENT.** Le blocage supposé (« il faut un
> superutilisateur pour `CREATE DATABASE` ») était contournable : `sdp_app` **possède**
> `sdp_dashboard`, donc il peut créer un **SCHÉMA** jetable, et rien dans `db/postgres/**` ni
> `pgDb.js` ne qualifie une table de `public.` — un `search_path` sur la connexion suffit à y
> rediriger chaque `CREATE TABLE`. L'URL admin reste préférée si elle marche ; le schéma est le
> repli. `PG_URL` est lu dans `.env` **à la main** (cette seule valeur, jamais injectée dans
> `process.env` : un `dotenv.config()` y basculerait `REPORTS_BACKEND=postgres` et casserait toutes
> les suites qui comptent sur le défaut sqlite). **Les faire tourner a révélé 17 échecs cachés
> depuis des semaines** : 13 fixtures sans la colonne `template` (ajoutée en **juillet** avec la
> détection des incidents majeurs — la tâche était filée et jamais faite, puisque rien n'échouait),
> 1 attente périmée par G-05 le jour même, et 4 requêtes de catalogue qui comptaient les objets de
> **tous** les schémas. **Suite : 2134 tests, 2134 pass, 0 fail, 0 skipped.**
> **A-13 : les secrets ne voyagent plus dans les dumps.** Avec `SDP_CONFIG_KEY` dans `.env`, les six
> valeurs de `_SECRET_BLANK_KEEP` sont stockées chiffrées (AES-256-GCM). **Sans clé, rien ne
> change** ; un ancien texte clair reste lisible le jour où la clé apparaît (il se chiffre à la
> sauvegarde suivante) ; et une valeur chiffrée **sans** sa clé est lue **vide** avec un log
> explicite — jamais rendue telle quelle, car nodemailer s'authentifiant avec du chiffré produit une
> erreur illisible un lundi à 07:00. **Activation** : mettre une phrase de passe ≥ 16 caractères dans
> `SDP_CONFIG_KEY`, redémarrer, puis **ré-enregistrer une fois chaque secret** dans Admin (ils se
> chiffrent à l'écriture). **Garder la clé hors des dumps** : la perdre coûte cinq minutes de
> re-saisie, pas une perte de données — mais restaurer un dump sur une autre machine exige la même
> clé.
>
> **Bilan de la journée du 2026-09-24** : 4 lots déployés, 12 goals sur 13 livrés, baseline de tests
> passée de **1932 pass / 5 fail** à **2039 pass / 0 fail** (75 pg toujours sautés), et une référence
> T0 du parc mesurée en prod (§9 du rapport d'audit) à rejouer vers le 2026-10-24.
>
> **2ᵉ lot déployé le même jour — marqueur `4004a36`** (appliqué + pm2 redémarré + marqué) : le §18
> de l'aide était parti **avec son sommaire hors du conteneur** (`.doc-layout` gagnait une 3ᵉ colonne,
> le manuel écrasé en bandeau vertical) — corrigé, vérifié au navigateur, et la leçon est en piège
> ci-dessous. Le même lot porte la **moitié agent de G-02** : le saut des 75 tests pg n'est plus
> silencieux et `PG_TESTS_REQUIRED=1` en fait un échec. **Il ne reste donc, côté propriétaire, que
> l'URL admin PostgreSQL, la capture T0 ci-dessus, et les arbitrages G-04/G-05/G-11/G-12 + A-13.**
>
> **La baseline n'était PAS verte et personne ne le savait** : 5 tests rouges déterministes
> (`reports-editor-asset-tab`, cause = CRLF, PAS une régression produit) **+ 75 tests PostgreSQL
> jamais exécutés**, sautés en silence — sur une prod 100 % PostgreSQL. Après la phase 3 :
> **1987 pass / 0 fail / 75 skipped, deux passages consécutifs** (2012 → 2062 tests).
>
> **Livré** — `G-01` extraction de source insensible aux fins de ligne qui **lève** au lieu de rendre
> `''` (`tests/_fn-source.js`) · `G-03` **`GET /api/assets/sync-status`** + bandeau de fraîcheur sur
> les 7 onglets Assets + date du dernier instantané sur Progress (jamais de date inventée :
> « Parc jamais synchronisé ») · `G-06` trace d'usage `assets_viewed` (1/acteur/jour, garde pure
> `services/viewLog.js`) + `asset_export` — la question « combien de responsables parc ont ouvert le
> module » a enfin une réponse · `G-07` **`node tools/pg/asset-engagement-kpis.js`** (lecture seule,
> réutilise les prédicats `FOLLOWUP_*` verbatim, composeur pur `services/assetEngagementKpis.js`) ·
> `G-08` **aide section 18 EN+FR** pour les 7 onglets Assets + garde d'intégrité des 125 ancres ·
> `G-09` une couverture de forecast **non calculée** dit « couverture inconnue » (un `{total:0}`
> explicite reste « 0/0 » : zéro mesuré ≠ rien mesuré) · `G-10` le packager **nomme les lots gelés
> derrière le marqueur** (`tools/deploy/frozen-lots.json` + `Check-FrozenLots.ps1`, avertissement
> seul, jamais bloquant) · `G-13` **hors programme** : la reprise anti-collision de `db-backup.js`
> était du code mort → une suppression d'inspection pouvait être refusée (c'était la « flake connue »
> d'`inspection-blobs`).
>
> **Trois défauts trouvés en EXÉCUTANT, pas en lisant** : `text <= date` dans le CLI KPI (pg strict),
> « Δ 0 pts » fabriqué quand la référence 30 j *est* le dernier instantané (→ « Δ non comparable »),
> et G-13, découvert parce que la suite a été **relancée** (1ᵉʳ passage vert, 2ᵉ rouge).
>
> **Reste au propriétaire** : **`G-02`** — les 75 tests PG exigent un `PG_ADMIN_URL` superutilisateur
> ou un rôle de test `CREATEDB` (le défaut de `tests/pg-helpers.js:3` vise le cluster Docker 5433
> inexistant ; `sdp_app` n'a pas `CREATEDB`) ; puis appliquer le ZIP, `pm2 stop`→wait→`start`,
> `Ctrl+F5`, `mark-deployed.cmd`, et le contrôle navigateur (bandeau de fraîcheur, onglet Progress,
> impression de l'aide §18). **Arbitrages avant exécution** : `G-04` (classement d'effort non
> équitable — Ouagadougou 100/rang 1 avec **1 actif** contre MANA 54 avec **471** ; `Dakar` et
> `Dakar Office` comptent comme deux sites), `G-05` (« sans utilisateur » = 99-100 % du parc actif sur
> 7 sites → une liste de travail égale au parc entier ne donne aucune action suivante), `G-11`
> (montants du groupe lisibles par toute session), `G-12` (**24 des 29 comptes actifs portent
> `admin`**, or `_reportWriteDenial` exempte `admin` du contrôle de site → le garde-fou F5 du 05/09
> est inopérant pour ~83 % des comptes), et le risque résiduel **A-13** (secret SSO/SMTP dans les
> dumps — « Option A », à confirmer par écrit ou à chiffrer).

---

## ⚡ Current state (as of 2026-09-23 — envois planifiés réparés, marqueur `7a7260d`)

> **Tout `main` est en prod** (marqueur `7a7260d`), sauf les 2 lots gelés (installeur `578be34`, tracker
> `c97ae61`+`e17b7b7`) qui restent DERRIÈRE le marqueur et devront être empaquetés à la main.
>
> **Ce qui a été livré les 21-23/09** : la diapositive « Parc informatique » sur les decks Weekly (+ le
> bandeau « score de tenue du parc » = `effortForSite`) ; `tools/reports/backfill-asset-review.js --apply`
> **lancé en prod** (compteurs figés sur le dernier rapport soumis de 7 sites — W37 sauf Ouaga W33 ; Kalana
> sans libellé Assets, Dakar sans rapport soumis) → les écarts « vs semaine précédente » apparaîtront à
> partir de **W38** ; le chargement de `.env` dans tous les CLI `tools/reports/*` ; la création des tâches
> planifiées **`/RU SYSTEM`**.
>
> **⚠️ DÉCOUVERTE MAJEURE (voir les 2 lignes de pièges) : AUCUN envoi planifié n'a jamais tourné** depuis
> la création des planifications le 2026-08-11 — tâches en « Interactive only » sous le compte machine, Last
> Result **267011**. Les 9 tâches `SDP-Report-*` ont été repassées sous SYSTEM le 2026-09-23 (`schtasks
> /Change /TN <t> /RU SYSTEM`, vérifié : Logon Mode = `Interactive/Background`, Run As User = `SYSTEM`).
> **Aucun e-mail n'est donc parti avec des données périmées** (l'audit `tools/pg/audit-sent-log.js` montre
> le bloc [2] vide : les 10 envois du journal viennent tous du serveur).
>
> **➡️ À FAIRE — lundi 2026-09-28 07:00 = PREMIER passage réel** de `weekly_report-weekly`,
> `scoreboard-weekly`, `hygiene-weekly`, `group-weekly` (puis le 1ᵉʳ octobre pour les mensuels +
> `asset_group`). **L'armement de chaque envoi + ses destinataires restent à vérifier dans Automated
> Reports** — un envoi désarmé ne part pas même si la tâche tourne. Contrôler après coup avec
> `node tools\pgudit-sent-log.js --since=2026-09-28` (bloc [1b] nourri, bloc [3] « dernier » daté).
>
> **État au 2026-09-23 soir (avant lundi)** : `coordinator-monthly` est **DISABLED** (seul envoi sans interrupteur — il aurait mailé tous les coordinateurs confirmés le 1er octobre) ; `asset_reminder` est planifié lundi 07:00 avec ses **2 cases décochées** (rien ne part) ; les tâches `group` tournent et ressortent (type non implémenté) ; journal d'envois vide depuis le 23/09. **Le bloc [0a] a répondu : 4 envois sont ARMÉS** — `weekly_report`, `scoreboard`, `hygiene` (lundi 28/09 07:00) et `asset_group` (1er octobre) ; armés en août quand les tâches ne démarraient jamais, donc sans effet jusqu'ici. **Décision user du 2026-09-23 : on les laisse armés**, la boîte `itops-dashboard@` devant être active le 24/09 — configurer alors le SMTP (Admin ▸ Email) AVANT lundi pour que le 1er envoi automatique parte de la bonne adresse. Les 2 rappels parc restent désarmés.
>
> **Autres chantiers ouverts** : boîte d'envoi dédiée **`itops-dashboard@endeavourmining.com`** (demande
> d'exemption MFA envoyée ; ⚠️ vérifier si le tenant accepte encore l'auth SMTP de base — sinon connecteur
> de réception limité à l'IP du serveur, et laisser `smtp_user` vide) ; le **récap parc du lundi
> (`asset_reminder`) n'est pas encore planifié** (responsables parc à confirmer + 2 e-mails à armer ;
> question de fond non tranchée : ~90 % des actifs sans coût → presque tous les sites recevront le récap) ;
> les **tests pg du parc** (`pg-asset-followups`, `pg-report-asset-review`, `pg-reports-reports`,
> `pg-reporting`) n'ont jamais tourné ; **E2E installeur sur l'instance TEST** ; **dégel tracker** à la fin
> du cycle mensuel ; `help.html` en retard (Assets/Réconciliation/Site Actions/Scoreboard/IT Review).

---

## ⚡ Current state (as of 2026-09-06 — Audit OPS lot 1 : intégrité & accès, sur `main`)

> **Lot 1 de l'audit externe du 2026-09-05** (`docs/…` hors dépôt : *Audit_OPS_Coordonnateurs_Copilot*) —
> les constats P1/P2 reproduits ont été vérifiés dans le code puis corrigés, chaque scénario de l'audit
> porté en test de non-régression (`tests/audit-meetings-integrity.test.js` 10, `tests/audit-report-write-auth.smoke.test.js` 12,
> `tests/infra-auto-route.smoke.test.js` réécrit, parité pg dans `tests/pg-meetings.test.js` + vérifiée sur le PG dev).
> **F5 (P1)** — `PUT /api/reports/:id/{infra,helpdesk,lights,actions,status,reassign-week}`, `DELETE /:id` et
> `POST /api/reports/action/:uid/{status,relineage,merge,unmerge}` passent par **`_reportWriteDenial`** (server.js) :
> rôle `editor` requis · **site de l'OBJET** = site du profil sauf admin+ · **un profil sans site n'est PAS global** ·
> rapport `submitted` gelé sauf super_admin (les routes status/reassign gardent leur propre règle de soumission).
> Lecteur `reports-db.getActionItemOwner(uid)` (dual). **F2 (P1)** — `saveMeeting` **upserte `md_actions` par id**
> (UPDATE si l'id existe, INSERT sinon, DELETE des disparus) sur les 2 backends → l'audit-trail (`md_action_updates`),
> les références `action_items.origin_id` et le hub Site Actions survivent aux re-sauvegardes du PV ; `closed_at`
> = conservé si déjà clos, `NULL` si statut non terminal. **F3 (P1)** — l'import incubation n'écrit plus
> `*_signed_at` depuis un nom (noms = contacts ; signer = flux de signature uniquement). **F1 (P1, décision user)** —
> le fallback site×dept×mois de `saveMeeting` ne s'applique qu'aux PV et n'apparie que des PV
> (`COALESCE(intake_source,'') <> 'business_incubation'` + garde `_isIncubation(h)`) : une incubation est une
> **session distincte** ; un même `reference` se met toujours à jour en place. **F4 (P2)** — `addIssueUpdate`/
> `addActionUpdate` : transition non terminale → `closed_at = NULL` (terminale → `COALESCE(closed_at, now)`) →
> un problème rouvert redevient en retard (`_effClose`). **F8 (P2)** — `commit(…, {force:true})` **saute** les
> sessions dont la ligne porte une erreur de validation (`skipped++`, jamais sauvées). **F9 (P2, décision user)** —
> `GET /api/reports/:id/infra-auto` : la cellule WAN = **% Time Up calibré du snapshot** (base `timeup`, même chiffre
> que le dashboard), le chiffre événementiel calculé sur des clones → `event_pct` (secondaire, tooltip dans
> `reports.html`). **Non traités, volontairement** : F6 (`fm` « Stable »/100 % sans données — aucun consommateur,
> l'envoi mensuel n'accepte que `coordinator` ; à corriger avec le rapport FM), F7 (brouillons comptés comme revues =
> le modèle du patron, pinné par `score-fidelity` — mais **compter une incubation comme PV est une dérive à trancher
> avec l'auteur du modèle**), F10 (plancher « ≥ 99,9 % » = formulation demandée par l'user, tooltip explicite).
> **Effet utilisateur à surveiller** : un compte `editor` **sans site** ne peut plus écrire de rapport (403) — vérifier
> la carte Users après déploiement.

---

## ⚡ Current state (as of 2026-09-18, mergé + DÉPLOYÉ le 2026-09-21 à `7fd553d` — Asset engagement : onglet « Parc informatique » + rappels)

> Spec `docs/superpowers/specs/2026-09-17-asset-engagement-weekly-design.md` (rev 4), plan
> `docs/superpowers/plans/2026-09-18-asset-engagement.md`. **Données** : `asset_first_seen` (assets.db / pg,
> PK asset_id, baseline=1 au 1ᵉʳ passage, jamais mis à jour) alimentée par `afterAssetsSync` (assets-sync.js,
> cron 04:30 + trigger manuel ; sautée si la vue `assets` a échoué) ; `getSiteAssetFollowups(labels,{newFrom,newTo})`
> = 4 compteurs (dans l'e-mail hebdo, quand ils sont présents, les kinds hygiène qui posent la même question sur un autre périmètre — no_owner/no_age/no_cost/no_asset_tag — ne sont PAS répétés : les compteurs d'abord, puis « Autres écarts » ; une diapositive « Parc informatique » (`slideAssetReview`, reports-pptx-shared.js) clôt le Weekly PPTX et chaque site du weekly summary — mêmes compteurs + écart vs la semaine précédente + bandeau « score de tenue du parc » (effortForSite : score/rang/Δ30 j) + les 2 notes, données via `_assetReviewForPptx` dans server.js, best-effort ; l'écart n'existe que si le rapport PRÉCÉDENT a des compteurs figés — les rapports soumis avant la mise en ligne n'en ont pas, d'où `tools/reports/backfill-asset-review.js [--apply]` (fige le dernier rapport soumis de chaque site)) , dans cet ordre (révision user 2026-09-21) : **sans QR code** = `no_tag`, TOUT le parc actif dont le champ SDP « Barcode / QR code » (`barcode`) est vide (le `new` de la semaine ne sert plus qu'à l'alerte du jour ; l'Hygiène `no_asset_tag` utilise la même règle). **`barcode` == Service Tag est l'état NORMAL** : l'asset manager génère le QR code depuis le Service Tag (« Manage Barcode / QR code ») — ne pas le prendre pour un remplissage automatique ; `asset_tag` n'intervient pas / sans date / sans coût / **sans utilisateur** (user_name vide — le département ne compte pas) — ces trois-là In Use·In Store·In Repair (à Mana 468/510 actifs sont « In Store », d'où l'inclusion),
> **aucun montant** (`has_cost` booléen). **Rapport hebdo** : `report_asset_review` (reports.db + pg `012`, une
> ligne par rapport) ; onglet `stab-4` (« 5. Parc informatique ») = **compteurs + 2 notes seulement, ni listes ni liens Assets** (rev 5,
> décision user 2026-09-18 — idem dans le bloc de l'e-mail hebdo ; les listes restent dans les e-mails de rappel) ;
> `GET /api/reports/:id/asset-followups` (admin+ ou même site, **sans `lists`**), `PUT /api/reports/:id/asset-review` (F5), compteurs **recalculés et figés côté serveur**, re-figés à la
> **première** soumission seulement ; **la soumission n'est jamais bloquée** (note vide = « non renseigné » dans
> l'e-mail hebdo ; le seul écran est une confirmation côté client si une note est vide). L'auto-`ready` marche enfin
> (sélecteur `#section-tabs .section-tab.done`, 5 onglets) → plus de rapports « complets mais non soumis ». **Rappels** :
> `tools/reports/send-asset-reminders.js` (`asset_reminder` planifié / `asset_new_alert` in-process), désarmés
> (`asset_reminder_send_enabled`, `asset_new_alert_enabled`), destinataires = **responsable parc confirmé** (nouveau
> contact annuaire, colonne « Responsable parc ») + coordinateur confirmé en cc, jamais une adresse non confirmée ;
> carte admin `#ap-asset-reminders` (groupe « Rappels parc ») ; route `POST /api/reports/asset-reminders/send`.
> **Étapes user** : déployer les Tâches 3 et 11 ENSEMBLE (le chemin post-sync nocturne charge le CLI créé par la
> Tâche 11) — pm2 stop→wait→start, Ctrl+F5, renseigner/confirmer les responsables parc dans Automated Reports ▸
> Recipients, armer les deux e-mails et planifier le récap au lundi 07:00, contrôle navigateur avec un compte
> coordinateur (onglet 5, autosave, soumission avec note vide, aperçu e-mail hebdo). **Les tests pg
> (`pg-asset-followups`, `pg-report-asset-review`, `pg-reports-reports`, `pg-reporting`) n'ont PAS pu être lancés sur
> cette machine** (pas de `PG_ADMIN_URL` accessible) — à lancer avant tout déploiement. La 1ʳᵉ nuit après déploiement
> pose la **baseline** de `asset_first_seen` (aucun « nouveau » ce jour-là).
>
> **Pièges relevés en revue finale (2026-09-18)** : un actif vu pour la première fois pendant un sync **manuel**
> reçoit quand même la date du jour dans `asset_first_seen` (`recordAssetSightings` tourne dans les deux cas), mais
> le sync manuel **n'envoie aucune alerte** (`afterAssetsSync(..., {sendAlerts:false})` côté trigger admin, `true`
> uniquement sur le cron 04:30) — cet actif n'apparaît donc JAMAIS dans une alerte same-day, seulement dans le
> récap hebdomadaire suivant. Le dédup du récap est **same-day seulement** (`reportSentLog.alreadySentToday`, sur
> `sent_at::date`) : un « Envoyer maintenant » un autre jour pour une semaine déjà mailée **la renvoie**. Déplacer
> un rapport déjà **soumis** vers une autre semaine (`reassign-week`) ne touche que `week_id` — les compteurs
> restent **figés sur la fenêtre (`start_date`/`end_date`) de l'ancienne semaine**, jamais recalculés pour la
> nouvelle. Si un sync assets renvoie une **liste partielle sans erreur** (vue Analytics tronquée silencieusement),
> les actifs absents de cette liste ne sont pas vus par `recordAssetSightings` ce jour-là ; s'ils réapparaissent
> le lendemain dans une passe complète, ils seraient signalés « nouveaux » alors qu'ils existaient déjà — à
> surveiller sur les premières alertes en prod.

---

## ⚡ Current state (as of 2026-09-17 — Installer safety parity, mergé sur `main` (578be34), PAS déployé)

> **Parité de sécurité de l'installeur console** (spec `docs/superpowers/specs/2026-09-15-installer-safety-parity-design.md`,
> guide opérateur `docs/INSTALLER.md` + aide §17 `help.html` EN/FR) — **mergé sur `main`, NON déployé** : ne pas appliquer de ZIP portant `tools/installer`/`_sdp_admin.cmd`/`dump-db.js` avant le test E2E. Nouveaux scripts `tools/installer/` : `SdpSituation.ps1`
> (fonctions partagées : comptages DB via le rôle applicatif, `Test-SdpZipHasDump`), `Detect-SDP.ps1` (situation JSON par
> session `%TEMP%\sdp-situation-<rand>.json` + `KEY=VALUE`, détectée au démarrage et après chaque action), `Show-Situation.ps1`
> (bloc situation + menu RECOMMENDED/OTHER/DATA/MAINTENANCE, entrées refusées libellées), `Confirm-Destructive.ps1` (écran rouge,
> phrases exactes `REINSTALL` · `DROP <db>` · `OVERWRITE <COMPUTERNAME>` · `RESTORE <yyyymmdd>`, confirmé **seulement sur exit 0**).
> **Règles** : Install-SDP fait la sauvegarde (étape 5) AVANT l'étape base (4) sur reinstall / fresh-over-existing
> (`-ForceOverwrite`, `-PrintPlan`) ; DROP refusé sans `sdp_dashboard.sql` racine complet (trailer `-- PostgreSQL database dump
> complete`) ; comptages avant/après → `Data check` (WARNING rouge, jamais de rollback) ; résumé 8 lignes identique console/summary.txt.
> `Manage-SDP -Restore` prend d'abord un point `pre-restore` (file de rétention propre, 2 gardés) en dumpant la base que l'import va
> DROP (PG_URL par environnement), refuse sans dump complet, échoue fermé ; `_sdp_admin.cmd` option 6 passe par le même écran rouge.
> Secrets jamais sur une ligne de commande (CREATE ROLE via `Invoke-PsqlSuperStdin`). Tests : `tools\installer\tests\run-all.ps1`
> (11 fichiers, ~3 min, bac à sable ; `SDP_SETUP_NOELEVATE`, `SDP_INSTALLER_LOG_DIR`). **E2E sur l'instance TEST = étape user, pas encore faite** — procédure en 5 étapes (fresh → patch → reinstall+drop → restore → écran DROP) dans `docs/INSTALLER.md` et l'aide §17.5 ; l'instance TEST a son propre `BackupDir` (`..\SDP-Backups-TEST`) pour que la rétention ne touche jamais les points de l'instance principale.

---

## ⚡ Current state (as of 2026-08-18 — Roadmap Manager (outil perso du manager), Phase 1, sur `main`, PAS déployé)

> **Roadmap Manager landed on `main`** (commits `a507c13`→`bdfa0a8`, NOT déployé) — un **outil PERSONNEL** de
> pilotage de roadmap pour le Service & Support Manager (super_admin), délibérément **HORS de la nav partagée
> IT OPS** (« c'est un outil personnel »). Version web de sa feuille *Synthèse Manager* : ses **4 objectifs**
> (Catalogue & formulaires 35 % · Plateforme ITSM & actifs 25 % · Incidents & gouvernance CAB 25 % · Transfert
> de connaissance 15 %) éditables (poids · progression · statut 🟢🟠🔴 · confiance · preuve · écart · date cible)
> + des **livrables par objectif** (libellé · date de livraison · statut à faire/en cours/**exécuté** · ✕),
> avec **score pondéré** `Σ(weight×progress)/Σweight`, auto-save par champ, **export CSV**. **Phase 1 = manuel**
> (l'utilisateur saisit). **Phase 2 = KPIs auto en PREUVE** — **Obj 2 LIVRÉ** (commits `2c297b5`→`da916aa`) :
> `services/roadmapEvidence.js` (pur `platformEvidence` — complétude CMDB = moyenne des present-pct
> owner/age/cost/scan depuis `getHygieneSummary`, **null si total 0** ; `by_kind` toléré objet OU tableau) +
> `assets-db.getAssetCountsByType` (fork ASSETS_BACKEND) + route `GET /api/roadmap/evidence/platform`
> (super_admin, best-effort) + panneau « 🔎 Preuve vivante » **read-only sous la carte `platform` uniquement**
> (complétude CMDB · **couverture discovery** = `sdp/(sdp+gaps_open)` **calculée côté page** depuis
> `/api/assets/reconcile/summary`, **JAMAIS 100 % sans import** → `—` + fraîcheur de l'import · N classes
> d'actifs). **Obj 3 LIVRÉ** (`86709ad`→`8dee856`) : `incidentsEvidence` (conformité RCA/CA/PIR/LL des
> incidents majeurs depuis `getMajorIncidentsHistory` — filled ssi UNE variante de clé UDF non-vide, tolérance
> variantes ; `conformity_pct` = % avec les 4 complets, **null si 0 MI** ; + `change_success_rate`/`changes_count`
> depuis `getChangeMetrics`) + route `/api/roadmap/evidence/incidents` + panneau read-only sous la carte
> `incidents` (les **14 actions = livrables manuels**, pas auto-dérivables). **Obj 4 LIVRÉ** (`7234c67`→`3ea5ac5`)
> : store **`roadmap_training`** (PK `uid`, per-user, dual-backend) **lazy-seedé 9 lignes** (3 sessions
> 2026-07-17/22/29 × ITY/Mana/Lafigue, `module='Module ITAM SDP'`, **`technicians=null` non-fabriqué**) +
> `getRoadmapTraining`/add/update/delete (`technicians_total` sommé EN JS, jamais SQL CAST) + 4 routes
> super_admin + panneau **ÉDITABLE** (log sessions × sites × techniciens, auto-save, add/delete) + stats
> (sessions/sites/techniciens) sous la carte `knowledge`. **Obj 1 LIVRÉ** (`571e096`→`4146f05`) : `getCatalogueStats({since})`
> (dual-backend, group-by `mode` + comptes catégorisés, fenêtre 90 j, `created_time>=?` TEXT sans cast) +
> `catalogueEvidence` (**adoption formulaire** = part via `mode` self-service `/web|portal|self.?service/i`
> classée EN JS ; **précision** = part catégorisée/sous-catégorisée ; **null si 0 ticket**) + route
> `/api/roadmap/evidence/catalogue` + panneau read-only sous la carte `catalogue` (adoption · précision ·
> volume · répartition canal). **Phase 2 COMPLÈTE — les 4 objectifs ont leur preuve auto** (`rm-ev-platform`/
> `incidents`/`training`/`catalogue`, coexistent sans se toucher) ; tests roadmap **41/41** (smoke/evidence/
> training + await + wan-sla boot) + **golden inchangé**. Preuve Obj 1-2-3 = auto read-only + preuve manuelle
> par-dessus ; Obj 4 = tracker éditable. **Ce qui est construit
> (dual-backend)** : store `roadmap_objectives` (PK `(user_id, obj_key)`) + `roadmap_deliverables` (PK `uid`
> = `crypto.randomUUID`) dans reports.db + `010_roadmap.sql` ; **lazy-seed** des 4 objectifs à la 1ʳᵉ lecture ;
> `routes/roadmap.js` (factory, **5 routes `requireReportSession`+`requireSuperAdmin`**, **user_id = session
> uniquement**, jamais le body ; update/delete scoping `WHERE uid=? AND user_id=?`) monté dans server.js à
> côté d'opmanager ; page **standalone `public/itsm-roadmap.html`** (renommée de `roadmap.html` en `d137454`
> pour un nom distinctif ; chrome propre, PAS `_shell.js`, gate
> `auth.js data-require="super_admin"`, état « Accès réservé » si 403). **Accès = URL directe `/itsm-roadmap.html`
> (favori), PAS dans la nav.** Tests : `roadmap.smoke` (6, lecteurs + gate super_admin) + await 5/5 + wan-sla
> smoke (boot app) + **`pptx-monthly-golden` inchangé**. **NE touche RIEN** du reste du dashboard.
> **E2E navigateur = étape user** (login super_admin). Doc de réunion associé (mapping objectifs↔outils,
> automatismes, inventaire) : `docs/integration/2026-08-18-integrations-project-plan.html`.

## ⚡ Current state (as of 2026-08-17 — WAN SLA / ISP Chargeback V1, sur `main`, PAS déployé)

> **WAN SLA landed on `main`** (11 commits `990cb55`→`3954f59`→`9ed9d69`→`d04f37a`→`bdc92fe`→
> `84c54d8`→`68594cf`→`fad1f19`→`6c40f24`→`45a252c`→`4329635`, NOT déployé) — un **instrument SLA /
> refacturation ISP** distinct de WAN Health (opérationnel). Ancré sur un vrai contrat ISP **SILVER**
> (cible **97 %**, mesurée **uniquement dans l'horaire de service** ; Niveau 1 = interruption totale ;
> relève 12/24/48 h ; mesure 1×/mois ; « pas de rapport » côté ISP → notre rapport EST l'instrument).
> **Deux décisions verrouillées** : (1) **dispo = event-log Meraki** (transitions uplink down→up,
> option b), PAS la dérivation `loss<100` (qui surestime les liens dégradés) ; (2) chaque coupure est
> **découpée sur le calendrier d'horaire-service** du site (mine Lun→Dim, bureau Lun→Ven, GMT, éditable)
> → à 97 % sur ~173 h/mois, ~5,2 h/mois de coupure tolérées ; nuits/week-ends gratuits. **Ce qui est
> construit (T1-T11, TDD, dual-backend)** : **moteur pur `services/wanSla.js`** (`serviceSecondsBetween`/
> `clipToService` 2 fenêtres-jour ; `computeCircuitSla` = dispo dans les heures + intersection mois +
> crédit **paliers % du MRC** 0/10/25/50 plafond 100 % (ou prorata) + écart pts/heures + **clock=notification**
> par défaut (contrat) avec figure `detection` objective + provisoire mois-en-cours sans artefact +
> `service_seconds==0→null` ; `resolutionBreaches` crit1=12 h ; `pairEvents`/`attributeOutages` cross-uplink)
> ; **store `wan_outages`** (PK `(site_id,sub_site,uplink,detected_start)`, accumulé au fil de l'eau,
> `upsert/get/listOpen/close/reconcileProvisional` duaux) + `009_wan_outages.sql` ; **config `sla_wan_config`**
> (DEFAULTS + `services/slaWanConfig.js` `parseSlaWanConfig`/`resolveCircuit`) ; **`merakiClient.networkEvents`**
> (objet paginé + `fetchAllNetworkEvents`) ; **poller 5 min** `tools/meraki/poll-wan-outages.js` (détection
> via `orgUplinkStatuses` + **notif ISP 15 min ARMÉE-OFF** via `mailer.js`, jamais après rétablissement,
> garde stale-open 24 h) ; **ingester nocturne** `tools/meraki/sync-wan-events.js` (event-log → pairing →
> attribution → reconcile-en-place, config-gated best-effort) ; **6 routes** `/api/analytics/wan/sla/{summary,
> outages,config(super_admin),sync,export.csv}` + **cron** (poller `*/5`, ingester `25 5`) ; **carte admin
> « SLA WAN »** super_admin (4 surfaces, arm OFF par défaut) ; **vue `public/wan-sla.html`** (nav Insights
> admin+, dispo contrat+objectif, crédit dû, écart, montant texte+devise **sans glyphe**, badge provisoire,
> ligne « circuit non mappé », export preuve). Tests : **89** (moteur/pairing/store/config/networkevents/
> ingest/poller/routes.smoke/await 5/5) + **`pptx-monthly-golden` INCHANGÉ**. **Rien ne touche** WAN Health,
> `wan_link_snapshots`, ni les decks PPTX. **Auto-mesuré depuis Meraki** : dispo 97 % + relève 12/24/48 h ;
> **Phase 2** : délai d'info 30 min + 1er feedback 8 h (exigent le helpdesk). **Activation = étape user** :
> Admin → 📶 SLA WAN → mapper les circuits (uplink→ISP, calendrier par site, MRC, contact) + armer la notif ;
> **confirmations d'intégration** (comme la calibration) : les strings d'événement Meraki (`wan_1_down`…) +
> le contrat de pagination `networkEvents` sont à valider contre l'org réel. **Non-goals** : SLA réponse
> helpdesk, Niveau 2/3 dégradé, Meraki Insight, sites non-UTC. Spec :
> `docs/superpowers/specs/2026-08-17-wan-sla-isp-chargeback-design.md`, plan :
> `docs/superpowers/plans/2026-08-17-wan-sla-isp-chargeback.md`.

## ⚡ Current state (as of 2026-08-16, plus tard — Infra V1b-E : WAN par sous-site (Exploration), sur `main`, PAS déployé)

> **V1b-E landed on `main`** (8 commits `e37c13a`→`3710945`→`40b950b`→`7a8c1fe`→`5281c71`→
> `ef1cd27`→`540ac1e`→`998076c`→`2ec38ed`, NOT déployé) — l'extension **WAN par sous-site** pour
> le rapport **Exploration** (UN site de reporting, PLUSIEURS sous-sites dont les lignes infra-KPI
> encodent le sous-site dans le nom : `WAN1 FETEKRO`, `WAN2 TANDA`). Un sous-site avec une ligne
> `WANx <SOUS-SITE>` a **son propre network Meraki** ; un sous-site sans ligne WAN cohabite le WAN
> de la mine (WiFi/LAN/serveurs/backup séparés — hors périmètre ici). **Token-gaté = la garantie
> que les sites normaux ne bougent pas d'un octet** : sans token configuré, `parseServiceLine`
> rend `sub_site:''`, tout se comporte comme avant. **Ce qui est construit (T1-T8, TDD, dual-backend)** :
> **T1** — `sub_site TEXT NOT NULL DEFAULT ''` rejoint la **PK** de `wan_link_snapshots`
> (`(site_id, sub_site, uplink, period_type, period_start)`) ; `_WAN_CREATE_SQL` factorisé (pas de
> TDZ), rebuild sqlite gardé + `ADD COLUMN IF NOT EXISTS`/swap-PK pg via `DO $…$`. **T2** — store
> **`wan_subsite_networks`** `(site_id, sub_site, network, PK(site_id,sub_site))` + lecteurs duaux
> `listWanSubsiteNetworks` (INNER JOIN sites → seuls les sites existants, porte `site_name`) /
> `setWanSubsiteNetworks` (transaction réelle, replace-all par site touché). **T3** — matcher UMD
> **`public/lib/wanLineMatch.js`** (`parseServiceLine(name, tokens)` → `{family, sub_site}`,
> **token-gaté**, longest-token-wins, strip diacritiques `[̀-ͯ]`, wifi/wlan AVANT wan) ;
> `services/opmReportFill.serviceToFill` **délègue** au matcher (source unique de la famille). **T4** —
> `buildFills` porte `sub_site` par descripteur (WAN = `r.sub_site||''`, infra = `''` ; PAS de param
> `tokens` — le gating vit dans le match client). **T5** — `sync-wan.js` : `siteByNet` → **`netToTargets`**
> (Map network→[{site_id, sub_site}]), un network fanne à N cibles depuis UNE seule collecte Meraki
> (dérive `q` UNE fois par uplink/période, puis fan-out) ; appel `listWanSubsiteNetworks` **gardé**
> (`typeof …==='function'`) pour les rdb injectés minimaux. **T6a** — routes : `GET/PUT
> /api/analytics/wan/mappings` portent `subsites` (super_admin) ; `GET /api/reports/:id/infra-auto`
> ajoute **`tokens`** (les sous-sites du site du rapport) sans toucher `buildFills`. **T6b** —
> `reports.html` : charge `wanLineMatch.js`, **remplace le `byMatch` qui collapsait** `wan1('')` et
> `wan1('FETEKRO')` par un match sur **`(family, sub_site)`** via `WanLineMatch.parseServiceLine(svc,
> data.tokens)` (fallback `_serviceToFill` si la lib échoue ; garde « ne jamais écraser une valeur
> tapée » intacte) + éditeur « Exploration sub-sites » (Site·token·network·✕) sauvé via le PUT
> mappings étendu. **T7** — `wanDashboard.js` groupe par `(sub_site, uplink)` (`latestPerSite` clé
> `site|sub_site|uplink`, `trendSeries` clé `sub_site||uplink` + champ `sub_site`). **T8** —
> `wan-health.html` : sous-en-têtes par sous-site dans la carte résumé (émis SEULEMENT si un
> `sub_site` non vide existe → sites normaux identiques), labels de courbe préfixés du sous-site.
> Tests : **54/54** (wan-snapshots, wan-subsite-map, wan-line-match, opm-report-fill, meraki-sync,
> wan-dashboard, opm-routes.smoke 9/9, infra-auto-route.smoke 5/5, admin-superadmin-gate.smoke,
> await-precedence 5/5) + **`pptx-monthly-golden` 1/1 INCHANGÉ** (preuve « sites normaux byte-for-byte
> intacts »). **Activation = étape user** : mapper les sous-sites Exploration dans Admin →
> ⚡ Infra → « Exploration sub-sites » (chaque sous-site avec ligne WANx → son network Meraki), puis
> Sync WAN. **E2E navigateur = étape user** (éditeur + dashboard derrière login). **Non-goals** :
> auto-fill LAN/WLAN/Servers par sous-site (pas de source sous-site OpManager), généralité au-delà
> d'Exploration, tout changement PPTX/email/score. Plan :
> `docs/superpowers/plans/2026-08-16-infra-wan-subsite-exploration.md`, spec :
> `docs/superpowers/specs/2026-08-16-infra-wan-subsite-exploration-design.md`.

## ⚡ Current state (as of 2026-08-16 — Infra V1b-D : dashboard WAN Health, sur `main`, PAS déployé)

> **V1b-D landed on `main`** (commits `b58b93b`→`c65fd1b`→`T3`→`T4`, NOT déployé) — le **dashboard
> WAN Health** qui lit l'archive `wan_link_snapshots` (V1b-A) et la sert **par site × uplink**,
> conservée **au-delà de la fenêtre ~60 j de Meraki**. **Lecture-seule, best-effort, config-gated
> comme tout V1b.** **Ce qui est construit (T1-T4)** : **`services/wanDashboard.js`** (pur, ZÉRO I/O :
> `latestPerSite(rows)` = la ligne au `period_start` MAX par `(site_id,uplink)`, groupée par site
> ordonné par id, uplinks triés ; `trendSeries(rows)` = série par uplink ordonnée par `period_start`) ;
> **3 routes** dans `routes/opmanager.js` — `GET /api/analytics/wan/summary` (`latestPerSite` + noms
> de site via `listSites`), `GET /api/analytics/wan/trend?site=` (`resolveSiteParam` tolérant probe→
> meetings→nom, puis `trendSeries`), `POST /api/analytics/wan/sync` (admin, lance `sync-wan.main({})`) —
> tous best-effort `{sites:[]}`/`{series:[]}` jamais 500, rdb awaités ; **`public/wan-health.html`**
> (page standalone : shell `#__shell` performance/wan-health, toggle Weekly/Month, grille de cartes
> par site avec pastilles RAG wan1/wan2 + dispo% + loss/latency/jitter, courbe Chart.js dispo+loss
> sur double axe `spanGaps:false`, bouton admin « ⚡ Sync now », état vide ; session par cookie via
> `x-report-token`, `injectApiKey=false`) montée dans `_htmlCache` + route `sendHtmlPage` ; **entrée
> Insights** dans `_shell.js` (`WAN Health`, icône `bar-chart-3` — distincte du parent `trending-up`,
> ajoutée à `ICON_LIB`) ; **cron nocturne 05:20** (`tools/meraki/sync-wan`, staggered après
> opm-availability 05:10 ; construit son propre client Meraki → pas de deps injectées). **Le report
> band `statusColor` de V1b-A est la SEULE bande canonique** (≥target→green, ≥target×0.9→orange,
> else red, null→none) → la cellule du rapport (V1b-C) et le dashboard WAN s'accordent. Tests :
> 3 unités `wan-dashboard` + 2 smoke route (summary/trend + unknown-site vide + 401) ; **goldens
> pptx-monthly + await-precedence 5/5 inchangés**. **E2E navigateur = étape user** (page derrière
> login de session). **V1b complet (A-D)** ; les valeurs ne sont fiables qu'après les gates
> **calibration** (`tools/meraki/calibrate.js`, verrouille `meraki_missing_policy`) + **découverte
> OpManager** (`tools/opmanager/discover.js`, verrouille `deviceToSite`), tous deux = étape user
> (clés lues en ENV, jamais imprimées ; l'agent ne saisit pas de secret). Plan :
> `docs/superpowers/plans/2026-08-15-infra-wan-v1b-d.md`.

## ⚡ Current state (as of 2026-08-15, encore plus tard — Infra V1b-C : auto-remplissage du rapport site, sur `main`, PAS déployé)

> **V1b-C landed on `main`** (commits `00cf7dd`→`0d15794`→`d164ddb`→`T4`, NOT déployé) — l'**auto-
> remplissage** des cellules *Current Value* des Infrastructure KPIs du rapport site depuis les
> snapshots A (`wan_link_snapshots`) + B (`infra_metric_snapshots`). **Ce qui est construit** :
> **`services/opmReportFill.js`** (pur : `serviceToFill(name)` → `wan1|wan2|lan|wifi|servers|null`,
> wlan/wifi AVANT wan, Backup/Radio→null ; `buildFills({wan,infra,staleDays,nowMs})` → cellules
> `{match,value '%',status_color,trend,stale,basis,source}`, metric null → **pas d'entrée** de fill) ;
> **`GET /api/reports/:id/infra-auto`** (résout rapport → `site_id`+`start_date` semaine Zoho →
> lit les 2 stores pour cette semaine → `buildFills` ; best-effort `{fills:[]}` jamais 500 ; 404
> rapport inconnu ; chemin 2-segments donc pas de shadow `/:id` ; tous les rdb awaités) ;
> **`reports.html`** — à l'ouverture d'un rapport **éditable**, après `renderInfra()`,
> `maybeAutoFillInfra()` remplit **UNIQUEMENT les cellules vides** (jamais un override tapé),
> couleur+trend depuis le snapshot (accord avec le dashboard WAN), fond léger + tooltip
> (source·data through·basis·stale), bandeau, + bouton « ⚡ Fill from OPManager/Meraki ».
> `_serviceToFill` client = **mirror** de `services/opmReportFill.serviceToFill` (vérifié identique).
> **Override = stateless, cellule-vide-seulement, ZÉRO schéma `infra_kpis`** → une fois sauvé =
> lignes `infra_kpis` ordinaires → **PPTX/email/score inchangés** (goldens verts sans régénération).
> Backup/Radio jamais touchés. Tests : 5 unités fill + 4 route smoke (fills / no-snapshot vide /
> 404 / 401) ; goldens weekly+pptx **inchangés**. **E2E navigateur = étape user** (éditeur derrière
> login). **Reste V1b** : V1b-D (dashboard WAN Health, lit A) — indépendant. Les valeurs ne sont
> fiables qu'après les gates calibration (A) + découverte (B) ; le tooltip le dit (basis/stale).
> Plan : `docs/superpowers/plans/2026-08-15-infra-wan-v1b-c.md`.

## ⚡ Current state (as of 2026-08-15, plus tard — Infra V1b-B : dispo device OpManager REST → LAN/WLAN/Servers, sur `main`, PAS déployé)

> **V1b-B landed on `main`** (commits `2a08901`→`a7bd304`→`f027300`→`130d319`→`2f38dba`→
> `946a2e1`→`T7`, NOT déployé) — la **dispo device-grain** pour **LAN/WLAN/Servers** via l'**API
> REST OpManager** (`getDeviceCompleteDetails.availdata`), écrite dans le `infra_metric_snapshots`
> de V1a. **Le WAN n'est PAS ici** (c'est Meraki, V1b-A). **Ce qui est construit (T1-T7)** :
> **config** REST (`opmanager_api_key` secret + `opmanager_base_url`/`opmanager_tls_insecure`,
> 3 touch-points) ; **`services/opmanagerClient.js`** (REST read-only, apiKey en query-param,
> cert auto-signé toléré via agent https insecure, `_pluck` dé-enveloppe la liste, injectable,
> inerte sans clé) ; **`services/opmanagerAvailability.js`** (pur : `aggregateDeviceAvail` =
> moyenne de `availdata.Up` par site×famille pour lan/wifi/servers **seulement** ; wan+excluded
> écartés ; device sans lecture pas compté 0 ; famille sans lecture → null/none ; `basis='recent'`
> car la fenêtre availdata n'est PAS la période exacte — étiquetée, pas passée pour « la semaine »)
> ; **colonne `basis`** additive sur `infra_metric_snapshots` (ALTER backend-branché, PAS dans le
> CREATE partagé ; lignes V1a intactes) ; **`sync-availability.js` reworké** — branche REST
> prioritaire quand `opmanager_api_key`+`base_url` réglés (listDevices → skip firewalls →
> getDeviceCompleteDetails → agrège semaine Zoho précédente + mois → upsert `source='opmanager_rest'`),
> chemin Analytics conservé en fallback ; `deviceToSite` par défaut = **probeName** via le seed
> opmanager, **injectable** (probe-vs-nom = décision de découverte) ; **route `/coverage` re-pointée**
> sur la liste REST quand configurée (plus de dérive à deux sources) ; **`tools/opmanager/discover.js`**
> (harness user : confirme les strings category/type vs le classifieur, probe-vs-préfixe, la fenêtre
> availdata). Tests : 24 unités + 5 route smoke (dont coverage REST bout-en-bout via serveur local)
> + await-precedence + pptx golden **inchangé** ; pg `basis` ALTER + upsert prouvés. **NE touche
> RIEN** de `infra_kpis`/score/PPTX ; config-gated + best-effort. **⚠️ GATE DÉCOUVERTE** (comme la
> calibration V1b-A) : avant que V1b-C lise ces snapshots comme « recent », l'user lance
> `discover.js` pour confirmer les strings type/category, la fenêtre availdata, et la stratégie
> site (probe vs préfixe de nom). **Reste** : V1b-C (auto-remplissage rapport + override, lit A+B),
> V1b-D (dashboard WAN Health). Plan : `docs/superpowers/plans/2026-08-15-infra-wan-v1b-b.md`.

## ⚡ Current state (as of 2026-08-15 — Infra WAN dispo & qualité V1b-A : store Meraki + collecteur, sur `main`, PAS déployé)

> **V1b-A landed on `main`** (commits `ff1a17a`→`67ab704`→`b56337c`→`7638d2e`→`66cc29e`→
> `362491d`→T7, NOT déployé) — la **fondation** du module **Disponibilité & Qualité WAN** :
> lit l'**API Cloud Meraki** (read-only) pour la dispo/qualité par lien (wan1/wan2) et
> **archive** des snapshots **hebdo + mensuels** (Meraki purge ~60 j → OPS = livre de
> référence long terme). **Découverte cadrante** (6 rounds de tests API avec l'user) :
> les **firewalls Meraki MX ont 0 interface SNMP** dans OpManager → l'API interfaces OpManager
> est une **impasse pour le WAN** ; les wan1/wan2 sont de la **donnée Meraki cloud** (widget
> WAN Link). **Décision (user)** : source WAN = **API Meraki** (`getDeviceLossAndLatencyHistory`,
> **≤31 j**, par uplink) ; **Piste 2** pour le remplissage (état courant + le coordinateur
> valide) ; LAN/WLAN/Servers viendront d'OpManager REST (V1b-B). **Piège clé** : Meraki donne
> loss/latence, **PAS l'uptime** — le **« % Time Up » est DÉRIVÉ** (interval up ssi
> `lossPercent<100` ; intervalle manquant = `'down'`|`'unknown'` **verrouillé par CALIBRATION**,
> pas supposé ; zéro échantillon → `null`, jamais `0`) et **calibré** contre le Summary Report
> Meraki (Ity 99.86/97.87). **Ce qui est construit (T1-T7)** : **config** (`meraki_api_key`
> secret + `meraki_org_id`/`meraki_base_url`/`meraki_missing_policy`, 3 touch-points secret :
> redact GET + blank-keep `_SECRET_BLANK_KEEP` + gate super_admin) ; **`services/merakiClient.js`**
> (REST read-only, transport injectable, inerte sans clé) ; **`services/merakiWanQuality.js`**
> (pur : `deriveAvailability(series,{totalIntervals,missing})` + `statusColor` **bande rapport**
> `≥t/≥t×0.9/else`, PAS la bande ±2 de V1a) ; **`wan_link_snapshots`** (PK composite
> site×uplink×period, PAS de surrogate ; `008_wan_link_snapshots.sql` pg ; upsert/read duaux) ;
> **seed** `site_module_codes` module=`meraki` (network name par site, résolu par NOM,
> Ity/Mana confirmés) ; **`tools/meraki/sync-wan.js`** (config-gated, best-effort, pré-résout
> network→site + id→name + ip AVANT le pur, fenêtre = **semaine Zoho précédente** via
> `getPreviousWeek`→`getWeekRange` = `weeks.start_date`, `totalIntervals` depuis la FENÊTRE pas
> `series.length`) ; **`tools/meraki/calibrate.js`** (harness user, clé en ENV jamais affichée).
> Tests : 33 unités (config/client/quality/snapshots/seed/sync) + await-precedence + pptx golden
> **inchangé** ; pg 008 + upsert idempotent prouvés. **NE touche RIEN** de `infra_kpis`/score/PPTX.
> **⚠️ GATE DUR non franchi** : V1b-A n'est « fini » qu'après que l'user lance `calibrate.js` et
> confirme quelle politique `missing` reconcilie 99.86/97.87 → régler `meraki_missing_policy`.
> **Reste** : V1b-B (OpManager device dispo → LAN/WLAN/Servers + re-point `/coverage`), V1b-C
> (auto-remplissage rapport + override), V1b-D (dashboard WAN Health). Plan :
> `docs/superpowers/plans/2026-08-15-infra-wan-v1b-a.md`, spec :
> `docs/superpowers/specs/2026-08-15-infra-wan-availability-quality-design.md`.

## ⚡ Current state (as of 2026-08-13 — OPManager Infra Availability V1a : lecture + snapshots + API + gouvernance)

> **V1a landed on `main`** (commits `b9e751e`→`63d1dbd`→`9c93204`→`31c2033`→`086e1ea`→
> `5b36608`→`01eb9be`→`763d282`, NOT déployé) — la **fondation lecture-seule** de
> l'intégration **OPManager → Analytics Plus → OPS** pour les KPIs de disponibilité infra
> (LAN/WiFi/WAN/Servers). **Décisions verrouillées (user)** : « **OPS classe + agrège** »
> (Analytics ne fait QUE la jointure device↔probe ; OPS classe + agrège en JS pur),
> « **Découper, V1a d'abord** », « **unmonitored = indisponible** », « **Tanda = TDA**
> (n'existe pas → adressé par le nom `Tanda`) ». **Contrat Analytics** = UNE vue quotidienne
> par device `OPS_OPM_Device_Availability_Daily` (device_key, probe, type, category, day,
> uptime% + durées) ; l'id de la vue = config `opm_availability_view_id` (vide → tout est
> **inerte**, la Phase 1 Analytics est côté user). **Ce qui est construit (T1-T8)** :
> **config** (`opm_availability_view_id`, `opm_targets` JSON {lan:99,wifi:98,wan:98,servers:99},
> `opm_stale_days:'9'`) ; **`services/opmClassify.js`** (pur : `classifyKpiFamily(type,category)`
> → famille par table de règles ordonnée, premier-match ; excluded/wan/wifi/lan/servers ;
> Unknown/UPS→excluded ≈40% du parc réel) ; **`weekOf(date)`** exporté de `siteReportDeps`
> (Monday-anchored UTC `{period_start,period_end}`) ; **`services/opmAvailability.js`** (pur :
> `parseDuration`/`parsePercent`/`aggregate` → `100×Σuptime/Σ(uptime+downtime+dependent+unmonitored)`,
> maintenance+onhold exclus, fallback `AVG(uptime%)`, **null-pas-zéro** → status `none`) ;
> **`infra_metric_snapshots`** (PK composite, PAS de surrogate id ; `ON CONFLICT DO UPDATE`
> même SQL 2 backends ; `007_infra_snapshots.sql` pg) + lecteurs duaux `upsertInfraSnapshots`/
> `getInfraSnapshots` ; **seed probe→site** dans `site_module_codes` module=`opmanager`
> (`_OPM_PROBE_CODES`, résolu par **NOM de site** — pas d'emprunt de codes meetings/tracker
> qui false-greeneraient : Ouaga=EDV≠OUA, Tanda n'a pas de TDA) ; **`services/opmAnalytics.js`**
> (`readDailyRows` header→contrat + `coverageSummary` pur gouvernance) ;
> **`tools/opmanager/sync-availability.js`** (best-effort : await getConfig, config-gated,
> pré-résout une map plate probe→site_id, agrège week+month, trend vs période précédente
> lue AVANT l'upsert, échec→prior gardés) ; **`routes/opmanager.js`** `GET /api/analytics/
> opmanager/{availability,coverage}` + `POST /sync` (résolveur `site=` tolérant probe→meetings
> →nom ; remplit les 4 familles, absent→`{null,'none'}` jamais 0 ; stale depuis `data_through`
> vs `opm_stale_days`) monté à côté de Meridian + **cron 05:10** (staggered de Meridian 05:00).
> **Tout best-effort + config-gated** : vue non réglée = sync self-skip, API sert `none`/vide.
> **NE touche RIEN** de `infra_kpis`/reports (c'est V1b). Tests : 29 unités opm + 6 smoke
> route + await-precedence (couvre les 2 dispatchers duaux) ; goldens weekly **inchangés**.
> **Reste V1b** (auto-remplissage du rapport site depuis les snapshots + override éditeur) ;
> **V1c** (qualité WAN + gouvernance). **Data LIVE = étape user** (créer la vue Analytics +
> régler `opm_availability_view_id`). Plan : `docs/superpowers/plans/2026-08-13-opmanager-infra-v1a.md`,
> spec : `docs/superpowers/specs/2026-08-13-opmanager-infra-v1a-design.md`.

## ⚡ Current state (as of 2026-08-11, plus tard — F1 Part A : fédération Meridian ⇄ SDP côté SDP)

> **F1 Part A landed on `main`** (commits `8d7adf6`→`0bf9003`→`f26f65b`→`d34e384`→
> `6ef47ad`→`ac58a4d`, NOT déployé) — le **côté SDP** de l'intégration avec **Meridian**
> (l'app PMO du boss). Décision utilisateur : **sync par API d'ingestion Meridian** (pas
> d'écriture DB directe — Meridian a **RLS `FORCE` partout** + tenant via `set_context`,
> donc une écriture directe exigerait des creds owner sur SA base). **3 contrats JSON**
> (`docs/MERIDIAN_INTEGRATION_CONTRACT.md`) : **C1** sync ressources SDP→Meridian
> (`POST {base}/v1/resources/sync`), **C2** actions ouvertes Meridian→SDP
> (`GET /api/actions/open`), **C3** lien projet lu en retour (`GET {base}/v1/links`).
> **Deux clés** : `meridian_out_key` (SDP→Meridian, présentée) + `meridian_in_key`
> (Meridian→SDP, exigée) — secrets dans `report_config` (redactées/blank-kept comme
> smtp_pass), carte admin `🔗 Meridian (PMO)` super_admin. **Ce qui est construit (A1-A6)** :
> les 3 clés config + carte ; `services/meridianActions.js` (`flattenOpenActions` + id
> stable `"<source>:<action_id|uid>"` + `attachProjectLinks`) ; **route C2** `routes/meridian.js`
> `GET /api/actions/open` (**always-mounted**, sa propre garde X-API-Key = `meridian_in_key`
> **awaited** — pg Promise ; **exemptée du gate global `/api/`** comme `/exec/summary`) qui
> **ressert `buildSiteActions`** (aucune logique action neuve, PII-safe owner seul) ;
> `services/meridianLinks.js` (client read-back best-effort, degrade→{}) ; **badge
> `▸ Projet: X`** sur le hub Site Actions (route enrichie best-effort + `site-actions.html`) ;
> `tools/meridian/sync-resources.js` (+ `services/meridianResources.js` pur) → **cron 05:00
> + `POST /api/meridian/sync` + bouton « Sync now »**. **Décisions verrouillées** : source
> personnes = **annuaire utilisateurs** (`listPeople`, seuls ids stables ; les
> « techniciens » = noms sur tickets, pas d'entité) ; `pmo.site.id` = **code module
> meetings** (satisfait le CHECK `^[A-Z0-9_-]{2,16}$`). **Tout best-effort** : Meridian KO
> = pas de badge, hub jamais bloqué ; sync self-skip si non configuré. **Prouvé** : boot
> postgres propre, route 401-inerte sans clé, page servie porte le badge. Tests : 19
> unités meridian + smoke route (4) + smoke hub degrade (project=null) + await 5/5.
> **Part B = code du boss** (migration `0015_external_action_link` + RLS/GRANT/trigger,
> endpoint ingest C1, routes attach/links C3, picker web) — **pré-condition bloquante** :
> il doit accepter d'ajouter `POST /v1/resources/sync`. Plan :
> `docs/superpowers/plans/2026-08-11-f1-meridian-integration-mvp.md`. **E2E badge complet
> = étape utilisateur** (nécessite Meridian live + login de session).

## ⚡ Current state (as of 2026-08-11 — F2a : réglages Entra SSO configurables depuis l'admin)

> **F2a landed on `main`** (commits `8790a88`→`c7b402e`→`8d3972a`→`7b50a3c`, NOT
> yet deployed) — les 6 réglages Entra SSO (`sso_mode`, `entra_tenant_id`,
> `entra_client_id`, `entra_client_secret`, `entra_redirect_uri`,
> `sso_breakglass_user`) se règlent depuis **Admin → 🔐 Microsoft SSO**
> (`reports.html#admin/sso`, **super_admin only**) EN PLUS de `.env`, sans
> redémarrage. **Cœur = `services/ssoSettings.js` `resolveSsoSettings(db)`** : pour
> chaque champ **DB ?? .env ?? défaut** (le pur `ssoEntra.js` prend toujours un
> `cfg` en argument — inchangé). Résolu **à la requête**, caché 60 s ; `_invalidate()`
> appelé par le PUT de config. **Le secret est stocké en DB (`report_config`) comme
> `smtp_pass`** : redacté au GET (`server.js:5108`, jamais renvoyé au navigateur),
> **blank-kept** au save (vide = garder l'existant ; filtre dans `reportConfig.js:95`).
> ⚠️ **Option A choisie par l'utilisateur** = le secret voyage donc dans les dumps DB
> (compromis accepté). Les 6 clés SONT dans `reportConfig.DEFAULTS` (sinon `setConfig`
> les jette). **Route config PUT super_admin-gated sur les clés SSO** (`server.js:5119`,
> 403) + `_invalidate()`. Les 3 routes auth (`/api/auth/{config,sso/login,sso/callback}`)
> sont **async** et lisent `s.mode/s.ready/s.cfg` du resolver ; la garde break-glass du
> login mot-de-passe lit `_sso.mode==='only'`. **Carte admin** = 4 surfaces
> (`_ADMIN_PANEL_IDS`, super-gate `showAdminPanel`, rail role-gate, bouton rail
> `admin-rail-sso`) + `loadSsoConfig`/`saveSsoConfig`. **Durcissement (7b50a3c)** :
> un read **dégradé** (getConfig a throw — course boot avant `initPgReports()`, ou PG
> transitoirement KO) **n'est PLUS caché** — sinon un restart lisait SSO 'off' pendant
> 60 s même avec une config DB. Tests : `sso-settings` (7), `report-config-sso` (2),
> `sso-routes.smoke` (4, sqlite), `sso-db`/`sso-entra` (verts) + await-precedence 5/5.
> **Prouvé sur le VRAI PG** : blank-keep secret, DB→resolver (mode=available,
> ready=true), `/api/auth/config` répond, `_htmlCache` sert la carte + rail + 4 surfaces.
> **E2E navigateur login-gated (clic dans la carte) = étape utilisateur** (pas de saisie
> de mot de passe par l'agent). Plan : `docs/superpowers/plans/2026-08-10-f2a-admin-sso-config.md`,
> guide : `docs/SSO_ENTRA_SETUP.md` §5 « Option A ». **Reste : F1** (intégration Meridian
> MVP — sync ressources SDP→Meridian + lien Action↔Projet ; touche le code du boss).

## ⚡ Current state (as of 2026-08-03, plus tard — vrais deltas MoM sur le rapport exec)

> **Deltas MoM (mois-sur-mois) branchés sur la slide 1 (cover « At a Glance ») + la
> slide 3 (Executive Overview) du rapport Group IT** (branche `fix/exec-mom-deltas`,
> **mergée**). Constat : ces deltas étaient des **placeholders** — backlog/FCR
> montraient un « 0.0% » trompeur (défaut serveur 0), le reste « — MoM ». **Jamais
> câblés (depuis 2026-06-04), PAS une régression PG.** Les 4 qui marchaient (TOTAL,
> CLOSED, SLA, FRT) viennent des tickets ; les autres envoyaient `null`.
> **Navigateur (`_buildExecPptxPayload`)** : juin est déjà en mémoire (`prev`,
> `chgRows`), donc on calcule les équivalents du mois précédent avec la MÊME logique
> que le mois courant → vrais deltas pour open backlog, FCR, avg MTTR, support groups,
> changes (nombre), taux emergency. `null` seulement si juin n'a pas de base → « — »
> honnête. **Serveur (`reportPayload.js`)** : `mi_total_delta = mi_total −
> mi_prev_total` (déjà dispo, MI est serveur-owned) + suppression des défauts `0`
> trompeurs de `open_backlog_delta_pct`/`fcr_delta_pp` (→ null). **Les deux slides
> lisent les mêmes champs K → corrigées ensemble ; `render.py` inchangé.** Test
> exec-pptx vert, les 2 fichiers parsent. Chiffres MoM à vérifier au regénérer
> (E2E navigateur derrière session). Déployé via ZIP (executive-report.html en
> `_htmlCache` + reportPayload.js code serveur → `pm2 stop`→wait→`start` + Ctrl+F5).

## ⚡ Current state (as of 2026-08-03 — fix ageing >60j : pending_status PG + garde readers)

> **Bug prod diagnostiqué + corrigé : la slide « Ticket Ageing by Group » du rapport
> mensuel Group IT comptait ~6709 tickets ouverts (~6000 en >60j) alors que le vrai
> backlog ouvert était 245** (branche `fix/pg-pending-status-ageing`, **mergée**).
> **Cause racine (exposée par le cutover PG)** : dans PG, `request_records.pending_status`
> était bloqué à **1 (ouvert)** pour des milliers d'anciens tickets FERMÉS. La sync
> (`zoho-sync.js`) dérivait `pending_status` **uniquement** du champ Zoho
> `Request Pending Status` et **défaultait à OUVERT** quand il était vide ; les vieux
> tickets le portent vide, et un full re-sync (qui a repeuplé PG au cutover) les a
> basculés. Le navigateur ne voyait jamais le bug car `isClosed()` **retombe sur
> Request Status**. **Confirmé** : snapshot SQLite (9 juil.) = `pending_status=1` → **549**
> (fiable) ; le deck (PG) = **6709**. **Blast radius** : SEULS les lecteurs DB qui font
> confiance à `pending_status` (ageing-by-group/site, comptes « closed » de
> getCalendarMonthlyHelpdesk/getMonthlyHelpdeskHistory) étaient faux ; **les KPI du
> deck (open 245, closed 1307, closure 84,2 %) sont client-side via `isClosed` et
> étaient déjà justes**. **Fix #1 (sync)** : `computePendingStatus(pendingRaw, requestStatus)`
> — dual-source calqué sur `isClosed` (flag d'abord ; vide → CLOSED_STATUSES sur
> Request Status). **Fix #3 (défense en profondeur)** : les readers ageing (group+site,
> 2 backends) comptent « ouvert » ssi `pending_status=1 AND request_status NOT IN
> (closed set)` → la slide ageing est juste même si `pending_status` re-dérive un jour.
> **Fix #2 (réparation données, à lancer par l'utilisateur sur PG prod)** :
> `UPDATE request_records SET pending_status=0 WHERE pending_status=1 AND
> lower(trim(request_status)) IN ('closed','resolved','confirmed resolution',
> 'confirm resolution','cancelled')` — corrige la colonne stockée pour les AUTRES
> lecteurs. **Après déploiement** : la slide ageing est déjà correcte (fix #3) au
> regénérer ; lancer la réparation + une sync requests fixe le reste. Tests :
> `pending-status-derivation` (5) + `ageing-excludes-closed` (2, seed pending=1+Closed).
> Régression verte (await-precedence, zoho-sync-udf, risk-register-classify). Déployé
> via ZIP (zoho-sync.js + reports-db.js = code serveur → `pm2 stop`→wait→`start`).

## ⚡ Current state (as of 2026-07-31, encore plus tard — fenêtre de fusion des doublons + statut « le plus récent fait foi »)

> **Fenêtre de fusion des doublons (à cocher, toutes semaines) + sémantique
> newest-wins landed** (branches `feat/site-actions-merge-newest-wins` puis
> `feat/merge-cleanup-window`, **mergées**) — suite directe de la reconduction/dedup :
> un outil de **nettoyage à la demande** dans la section Actions (le C différé, version
> éditeur-pilotée, forward). **Deux pièces.** **(1) Bouton « ⚯ Fusionner des doublons »**
> (section Actions de `reports.html`) → fenêtre listant les actions **ouvertes du site,
> TOUTES semaines confondues** (cache `_siteOpenActions`), **une case à cocher par
> action**, triées par libellé normalisé (module de similarité) pour que les doublons
> probables soient côte à côte. *(Refonte du bouton ⚯ par-ligne initial : depuis une
> ligne on ne voyait pas les autres semaines pour savoir quoi fusionner — constat
> utilisateur.)* Coche ≥2 → le **canonique = le plus récent** (year/week_number,
> désormais exposés par `getSiteOpenReportActions`) ; les autres adoptent sa **lignée**
> (le hub les replie) **ET** leur **libellé est renommé** sur celui du gagnant (les noms
> divergents deviennent identiques). Route **`POST /api/reports/action/:uid/relineage`**
> (editor, dual-backend) : `setActionLineage(uid, lineage, task?)` — `task` optionnel
> renomme aussi ; sinon lignée seule. Une ligne du rapport courant touchée par la fusion
> est mise à jour en place (libellé + lignée) sans perdre les autres saisies. Libellé du
> bouton Import corrigé (« Import open actions from a previous week » — c'est un
> sélecteur de semaine ; la reconduction auto tire déjà la semaine précédente).
> **(2) Statut « le plus récent fait foi »** — corrige un trou que l'utilisateur a
> repéré : lier ne regroupait que l'**affichage**, chaque ligne gardait son statut
> indépendant → fermer la plus récente faisait **ressurgir** l'ancienne (toujours
> ouverte). `getSiteOpenReportActions` passe de **filtre-puis-dedup** à
> **dedup-la-plus-récente-puis-filtre** : pour chaque lignée on garde la ligne la
> plus récente (tous statuts), puis on la garde ssi non terminale. Donc **fermer la
> dernière ferme le groupe**, les anciennes ne reviennent jamais, **sans réécrire
> l'historique** (les vieilles lignes gardent leur statut d'époque, juste ignorées
> pour « est-ce encore ouvert »). `_SORA_SQL` perd son `status NOT IN (...)` ; nouveau
> `_dedupLineageNewestOpen`. **Consommateurs vérifiés** (hub, e-mail coordinateur SP2,
> site report) — verts. Tests : `site-open-report-actions` (cas distinctif newest-wins,
> échouait en filtre-puis-dedup) + `action-relineage.smoke` (4 : fusion replie /
> fermeture ferme le groupe / 400·404). Régression verte (action-items-upsert,
> site-report-actions, coordinator-actions-block, status/merge/route smokes,
> await-precedence). **E2E navigateur = étape utilisateur.** Déployé via ZIP
> (server.js + reports.html `_htmlCache` → `pm2 stop`→wait→`start`).

## ⚡ Current state (as of 2026-07-31, plus tard — reconduction auto + garde anti-doublon des actions)

> **Reconduction automatique des actions + garde anti-doublon landed** (branche
> `feat/report-actions-reconduct-dedup`, **mergée**) — répond au constat terrain :
> le hub Site Actions montrait la MÊME action plusieurs fois (ex. « Helix underground
> surveillance software deployment » sur W10→W16, libellés divergents) parce que les
> éditeurs **re-saisissaient** un suivi non résolu chaque semaine au lieu de le
> reconduire → chaque re-saisie = uid neuve + **pas de lineage** → le dédoublonnage
> du hub (`_dedupLineage`, par lineage) les voyait comme distincts. **Les DEUX
> correctifs greffent sur la mécanique lineage EXISTANTE — `saveActionItems`
> (upsert-par-uid) et `_dedupLineage` NE sont PAS touchés, zéro schéma, rapports
> existants intacts.** **A — reconduction auto (client seul)** : à l'ouverture d'une
> semaine **vierge** (`action_items` vide + statut `draft`/`in_progress`),
> `maybeReconductActions()` (dans `reports.html`) pré-remplit la section Actions avec
> les actions **non résolues** (open+in_progress+on_hold, = tout sauf closed/cancelled)
> de la semaine précédente — **uid neuve, lineage CONSERVÉE** (`{...a, uid:'',
> lineage:a.lineage||a.uid}`, exactement `_importFromWeek`) — en **brouillon
> révisable** + bandeau « ↩ N reconduites de W-X ». Réutilise les endpoints existants
> `/action-weeks` (renvoie DESC → la plus récente d'abord ; filtrée à
> `start_date < currentReport.start_date`) + `/actions-from`. **Garde SANS état** :
> ne se déclenche QUE section vide à l'ouverture (pas de colonne DB) → si l'éditeur
> quitte sans sauver, re-proposé (correct) ; s'il sauve avec des lignes, non-vide →
> ne re-déclenche plus. `undoReconduct()` annule. **B — garde anti-doublon** :
> module **pur** `public/lib/actionSimilarity.js` (UMD Node+navigateur ;
> `normalizeTask` accent/casse/stopwords FR+EN, `similarity` = Jaccard de jetons,
> `findBestMatch(task,candidats,{threshold:0.5,excludeLineage})`) — calé sur les
> vraies chaînes (re-saisies identiques →1.0, variante Helix →0.625, actions
> différentes →~0). Sur le **blur** d'une action **neuve** (ni uid ni lineage ni
> source), compare au cache des actions ouvertes du site (nouvelle route
> `GET /api/reports/:id/site-open-actions` réutilisant `getSiteOpenReportActions`,
> chargée à l'ouverture) → dialogue **non bloquant** « ressemble à ‹X› · [lier]
> [garder séparé] ». **Lier** pose la lineage de X sur la ligne (round-trip
> `tr.dataset.lineage` déjà géré par `collectActions`, écrite à l'INSERT) → le hub
> les replie. « Garder séparé » mémorise le texte pour ne pas re-prompter.
> **Surface backend = 1 route GET** (réutilise un lecteur existant, sœur de
> `/action-weeks`, pas de shadowing `/:id`). Tests : `action-similarity` (8) +
> `site-open-actions-route.smoke` (3) ; régression verte (action-items-upsert,
> site-open-report-actions, importable/status/merge smokes, await-precedence).
> **E2E navigateur = étape utilisateur** (éditeur derrière session). **C (fusion des
> doublons DÉJÀ existants) = suivi différé** (choix utilisateur : A+B d'abord).
> Déployé via ZIP (server.js + reports.html `_htmlCache` → `pm2 stop`→wait→`start`).
> Spec : `docs/superpowers/specs/2026-07-31-report-actions-reconduct-dedup-design.md`.

## ⚡ Current state (as of 2026-07-31 — slide Infrastructure KPIs en 2 colonnes)

> **Slide « Infrastructure KPIs — Last Week of » sur deux colonnes pour les longues
> listes landed** (branche `fix/infra-kpi-two-column`, **mergée** dans `main`) — la
> slide infra du rapport **mensuel all-sites** (`generateAllSitesMonthlyPptx` →
> `slideMonthlyLastWeekInfra`, `reports-monthly-pptx.js`) ET son équivalent du
> **weekly summary** (`generateWeeklySummaryPptx` → `slideInfraKpis`,
> `reports-weekly-pptx.js`) **débordaient du bas de la slide pour Exploration**, qui
> suit **30 KPIs** (WAN/LAN/WLAN/Servers/Backup × 6 sous-sites FETEKRO/TANDA/MANA/
> MASSAWA/HOUNDE/ITY) là où **tous les autres sites en ont 6-7** — 30 lignes tassées
> dans une table de 5.6"/5.4" → texte illisible + débordement. **Fix chirurgical,
> conditionnel** : nouveau helper **pur** `splitInfraKpiColumns(kpis, threshold=12)`
> dans `reports-pptx-shared.js` (retourne `{twoCol, columns}` — `[list]` si ≤12,
> `[moitié1, moitié2]` équilibrées si >12 ; ordre préservé ; testé
> `tests/pptx-infra-two-column.test.js`, 6). Les deux renderers appellent le helper :
> **au-dessous du seuil → chemin mono-colonne INCHANGÉ octet-pour-octet** (même
> x/y/w/h/colW/rowH/fontSize), donc **tous les autres sites + toutes les autres
> slides intacts — le golden fingerprint reste vert SANS régénération** (aucun site
> de fixture ne dépasse 12). **Au-dessus du seuil → deux tables côte-à-côte** (x=0.3
> & x=6.83, w=6.20 chacune, gap 0.33, fontSize 11, `colW:[2.5,1.3,0.7,0.9,0.8]` —
> Trend assez large pour son en-tête ; rowH `min(0.42, H/(moitié+1))`). Refactor DRY :
> chaque fonction extrait un `headerRow()` + `bodyRows(list)` local (zebra restart
> par colonne). **Vérifié LibreOffice** : stress 36 KPIs → 18+18 tient dans la slide,
> en-têtes sur une ligne, couleurs/tendances OK ; site normal 5 KPIs rendu identique.
> Régression : **21 tests PPTX verts** (infra-two-column 6 + golden 1 +
> shared-helpers + meetings-slide + meetings-all-decks). Déployé via ZIP (les
> `reports-*-pptx.js` sont du code serveur requis par server.js → `pm2 stop`→wait→
> `start`). **QA navigateur non requise** (génération PPTX, pas de page). *(Le ZIP
> embarque aussi `_shell.js`+`system-logs.html` de la nav System-Logs — marker de
> déploiement non avancé alors ; re-déploiement no-op.)*

## ⚡ Current state (as of 2026-07-30 — module System Logs v1, audit sécurité)

> **System Logs v1 landed** (branche `feat/system-logs`, NON mergée — attend la QA
> navigateur super_admin) — inspiré du module System Logs de 4MyPeople. **Hybride
> étagé** : v1 = **journal de sécurité + analytics** sur des événements curés ; v2
> (différé) = log par requête HTTP + onglet Events/reconciliation (perf/5xx/slow).
> **Découverte cadrante** : `logAudit`/`audit_log` est **limité aux rapports** et le
> SDP **ne journalisait PAS les authentifications** — v1 a donc dû **instrumenter**
> les événements, pas juste afficher l'existant. **Table unique `system_log`**
> (reports.db, dual sqlite/pg — sqlite `INTEGER PRIMARY KEY` rowid, pg
> `db/postgres/reports/006_system_log.sql` `BIGINT GENERATED ALWAYS AS IDENTITY`).
> Helper **`logEvent`** **fire-and-forget** (try/catch avale tout — un log mort ne
> casse JAMAIS une requête ; appelé **bare**, jamais await/chain → clear de
> await-precedence). Prédicat `_isRiskAction` (login_failed·session_killed·
> user_deleted·user_role_changed·password_reset·report_deleted → flag `risk`).
> `_redactKeys` retire les clés secrètes (`*_pass`/`*_secret`/`token`…) avant
> `details` (test prouve qu'aucune valeur NI clé sensible n'atterrit). Instrumenté :
> **auth** (login_success/failed, logout, session_killed) ; **report** via UNE ligne
> ajoutée à `logAudit` (mirror `report_*`). *(identity/config : câblage prévu au plan,
> instrumentés incrémentalement — le mirror report couvre déjà les rapports.)*
> Readers dual-backend `listSystemLog`/`countSystemLog`/`getSystemLogAnalytics`
> (filtres `substr(ts,1,10) BETWEEN` — pas de `::date`) ; **4 routes** super_admin
> `GET /api/reports/system-log[/analytics|/export.{csv,json}]` **au-dessus de `/:id`**
> (garde = check `super_admin` **verbatim** de force-logout). Backfill idempotent de
> `audit_log`→`system_log` au boot (garde zéro-ligne-report, PAS de marker setConfig).
> Page **`system-logs.html`** (shell + onglets **in-page** comme assets — PAS
> module-tabs ; Events grisé v2) + entrée nav **super_admin** (`shield-check`,
> vérifié : admin ne la voit pas). **Tests** : `system-log.test.js` (8, predicate +
> redaction + round-trip + filtres + analytics + non-blocking + mirror) +
> `system-log-routes.smoke.test.js` (5 : gate 403, `{rows,total}`, hostile-input
> non-500, analytics, export) + await-precedence 5/5. Voisins report-config/schedule
> **verts en isolation** (le « 1 fail » combiné = flake cross-fichier getDB-singleton
> connu). **pg copy de system_log DÉFÉRÉE** (table auto-créée + backfill au boot +
> prod déjà pg → pas de migration de données pendante ; YAGNI). **QA navigateur =
> étape utilisateur** (page super_admin derrière session) AVANT merge. Spec+plan :
> `docs/superpowers/{specs,plans}/2026-07-29-system-logs-v1*`.

## ⚡ Current state (as of 2026-07-29 — navigation homogène : bandeau + onglets intra-module)

> **Standardisation navigation landed** (branche `feat/module-tabs-standardization`,
> NON mergée — attend la QA navigateur de l'utilisateur) — suite à une plainte
> « nav des nouveaux modules pas aisée + garder le bandeau homogène partout ».
> **Trois choses** : (1) **icônes distinctes** dans le menu Insights du bandeau —
> Inspections/Meetings/Site Actions partageaient toutes `clipboard-check`
> (indistinguables) → Meetings=`users`, Site Actions=`check` (dans `_shell.js`
> `ICON_LIB` + NAV ; vérifié par harness Node). (2) **Composant partagé
> `public/module-tabs.js` + `.css`** (patron `_shell.js` : rend un strip dans
> `<div id="__moduletabs" data-module data-current>` depuis une config `MODULES`
> unique ; icônes de marque, `aria-current`, gating par rôle, badge de compte
> préservé). Appliqué à **Meetings** (11 pages — remplace les strips emoji
> **dupliqués** `.mtg-tabs` + **ajoute le strip à l'éditeur de PV `meeting.html`**
> qui n'en avait pas), **Inspections** (3 pages — n'avait AUCUN strip), et
> **Site Actions** (strip « famille Actions » : Site Actions · Meetings Actions ·
> Inspection Actions — le hub mono-page n'est plus orphelin). Test
> `tests/module-tabs.test.js` (7, DOM stubbé) : jeu d'onglets, actif, icônes
> non-vides, intégrité des href, gating admin sur Setup, degrade sûr, current
> vide = strip inactif (fix du trou éditeur). (3) **DEUX bugs latents de bandeau
> manquant réparés** — `site-actions.html` montait le shell dans **`id="app-shell"`**
> et `meetings-insights.html` mettait `data-section`/`data-current` **sur `<body>`**,
> alors que `_shell.js` ne rend QUE dans `#__shell` → **le bandeau du haut ne
> s'affichait PAS sur ces deux pages** (aucun JS ne référençait le mauvais id ;
> pures typos). Corrigés → un balayage d'homogénéité prouve que **toute page
> chargeant `_shell.js` a `#__shell`** (seul `login.html` sans nav, par design).
> **Les 3 pages standalone restent volontairement sans shell** (exec-view
> publique · site-report imprimable · it-review portage fidèle — chacune avec un
> lien retour). **Assets/Tracker** gardent leurs onglets in-page (mono-page ;
> alignement visuel = Task 4 optionnelle, non faite). Régression : module-tabs
> **7/7** + review-render + await = verts. **QA navigateur = étape utilisateur**
> (pages derrière login de session que l'agent ne peut pas exercer) AVANT merge.
> Plan : `docs/superpowers/plans/2026-07-29-module-tabs-standardization.md`.

## ⚡ Current state (as of 2026-07-27, plus tard — graphe hebdo Helpdesk du rapport site)

> **Demande 1 : courbe hebdomadaire volume + SLA sur le bloc HELPDESK du rapport
> site landed** (branche `feat/site-report-helpdesk-weekly-chart`, fusionnée) —
> le bloc Helpdesk du rapport site (`site-report.html`) ne montrait qu'un
> instantané mensuel ; on ajoute **sous le graphe des catégories** un combo
> Chart.js **6 dernières semaines ISO** : barres Inbound/Closed + **ligne
> « Res. SLA missed % » sur axe secondaire** (`pct` 0-100). **Uniquement dans la
> page** (le rapport authored) — **pas dans l'email** : les goldens
> `monthly-email-{full,nonApplicable}.html` et le fingerprint PPTX restent
> **byte-identiques** (aucune touche au composeur email/PPTX ; câblage additif).
> **Trois pièges honorés** : (a) `missed_pct` vaut **`null` quand `inbound === 0`**
> (jamais un faux 0) → `spanGaps:false` coupe la ligne sur les semaines vides ;
> (b) le périmètre est **résolution SLA seulement** (`request_records` porte
> `overdue_status`, PAS le first-reply) — une note l'indique dans la page ;
> (c) le calcul des 6 semaines est de l'**ISO-8601 vrai** (algorithme du jeudi le
> plus proche, UTC, aligné lundi) via `_isoWeek`/`_lastIsoWeeks` (exportés de
> `siteReportDeps.js`, ancrés à l'as-of). Nouveau binder **`helpdeskWeekly`** :
> boucle `_lastIsoWeeks(asOf, 6)` → `getSiteHelpdeskWindow(site_id, from, to)` par
> semaine → `{label, inbound, closed, overdue, missed_pct}` ; **null si le site
> est irrésoluble** (même garde que les autres binders). `siteReport.js` le porte
> via `_safe` (dep-gardé → `helpdesk_weekly:null` quand absent → graphe caché).
> Client : `renderHelpdeskWeekly(data.helpdesk_weekly)` (destroy-on-rerender,
> caché si vide/pas de Chart.js). **Régression** : `site-report-helpdesk-weekly`
> (4) + goldens (`report-template-primitives`, `report-template-coordinator`,
> `pptx-monthly-golden`) + `await-precedence` = **verts, goldens NON régénérés**.
> **Vérif navigateur E2E impossible** (`site-report.html` derrière login de
> session, identifiants jamais saisis) — prouvé par tests unitaires + syntaxe.
> Plan : `docs/superpowers/plans/2026-07-27-site-report-helpdesk-weekly-chart.md`.

## ⚡ Current state (as of 2026-07-27, later — hub statut suivi éditable)

> **Statut éditable en ligne pour « Report follow-ups » dans le hub Site Actions
> landed** (branche `feat/report-action-inline-status`) — Réunions/Inspections
> étaient déjà éditables en ligne (SP1a) ; le suivi ne l'était pas (SP1a l'avait
> laissé en lecture seule car `action_items` n'avait pas d'identité stable). SP1b
> a levé ça (le `uid`), donc : reader `setActionStatus(uid, status)` (dual-backend,
> `UPDATE status WHERE uid` — ne touche NI `source`/`origin_id` NI `lineage`) +
> route `POST /api/reports/action/:uid/status {status}` (editor, valide le
> vocabulaire rapport `open·in_progress·on_hold·closed·cancelled`→400). Le hub
> rend un `<select>` en ligne pour le suivi (même patron que les 2 autres ;
> `onStatusChange` branche : suivi→`/status {status}`, réunions/inspections→
> `/update {status_change}`) ; revert au 403, reload au succès. **Cohérence
> incluse** : `cancelled` devient terminal pour le suivi (comme `closed`) dans
> `buildSiteActions` **et** `getSiteOpenReportActions` (`NOT IN ('closed',
> 'cancelled')`) — l'e-mail SP2 ne compte donc plus les annulées. Les 3 sections
> du hub sont maintenant éditables en ligne uniformément. Régression **18**
> (status smoke + register cancelled + dedup + merge smoke + await). **E2E
> navigateur non déroulé** (session).

## ⚡ Current state (as of 2026-07-27, later — SP3)

> **Import Réunions/Inspections dans la section Actions du rapport (SP3) landed**
> (branche `feat/import-cross-module-actions`) — le rédacteur coche des actions
> ouvertes de Réunions/Inspections pour les tirer dans « Actions & Follow-ups »
> comme **références** (`source`/`origin_id`). **Décision d'archi qui réconcilie
> SP1b et SP3** : `source`/`origin_id` sont écrits **à la création (INSERT,
> client-set depuis le sélecteur)** OU par l'endpoint de fusion (UPDATE) ;
> **jamais par un UPDATE de re-sauvegarde**. Donc `saveActionItems` écrit
> `source`/`origin_id` **à l'INSERT** (les 2 forks) mais continue de ne JAMAIS
> les toucher à l'UPDATE → une fusion/référence existante reste indestructible
> (c'est un UPDATE par uid). `addActionRow`/`collectActions` round-trip
> `source`/`origin_id`. Endpoint de LECTURE `GET /api/reports/:id/importable-actions`
> (résout rapport→site→code meetings via `listSiteModuleCodes`, liste les actions
> Réunions+Inspections OUVERTES avec `origin_id`+libellé). UI : bouton « Import
> from Meetings / Inspections » réutilisant le modal carry-over (listes à cocher) ;
> « Import selected » ajoute chaque ligne via `addActionRow({source, origin_id,
> uid:''})` (uid neuf) → référence persistée à l'INSERT au Save ; le rédacteur
> **assigne un département** à chaque avant d'enregistrer (règle standard).
> **Conséquences déjà gérées** : la référence porte `source` → le hub la replie
> (`buildSiteActions !a.source`) et l'e-mail SP2 ne la double-compte pas
> (`getSiteOpenReportActions source IS NULL`) ; elle s'affiche dans le
> rapport/PPTX/e-mail comme un suivi normal. **Goldens intacts** (source interne).
> Régression **26** (upsert 3 + importable smoke + register + merge smoke +
> dedup + coordinator block + golden PPTX + goldens byte-exact + await).
> **E2E navigateur non déroulé** (éditeur derrière une session). Plan :
> `docs/superpowers/plans/2026-07-27-import-cross-module-actions-sp3.md`.
> **Reste** : le graphe hebdo Helpdesk (demande 1) + le bloc actions dans
> l'e-mail weekly (follow-on trivial).

## ⚡ Current state (as of 2026-07-27, later — SP2)

> **Bloc « Actions ouvertes par thème » + lien hub dans l'e-mail coordinateur
> (SP2) landed** (branche `feat/coordinator-actions-block`) — répond à « dans le
> mail il faut qu'ils sachent quel rapport ouvrir pour aller les fermer ».
> `actionsSection` dans `coordinator.js` : comptes par source
> (Réunions/Inspections/Suivi du rapport) + la plus ancienne + un CTA vers
> `{base_url}/site-actions.html?site=CODE`. **Optionnel** (spread `...(d.actions ?
> […] : [])`, **exactement le patron `assetEffort`**) → les fixtures golden ne
> fournissent pas `actions`, donc **les deux goldens byte-exact restent
> identiques, NON régénérés** ; un test dédié (`coordinator-actions-block`) couvre
> le bloc. **Lien omis si `public_base_url` vide** (convention du weekly : pas de
> lien deviné/mort). Données : binder `openActions` (`siteReportDeps.js`) qui
> réutilise le **pur** `buildSiteActions` sur les 3 sources (toutes non-fermées,
> pas overdue-only ; suivi via `getSiteOpenReportActions` dédupliqué) → comptes +
> oldest ; `siteReportData` porte `actions` (dep-guardé comme les blocs assets) ;
> `sendCoordinator.js` injecte `data.base_url` depuis `cfg.public_base_url`.
> Régression **90** (bloc 3 + goldens byte-exact + coordinator wording + siteReport
> 3 + sender 23 + await). **E2E e-mail non déroulé** (nécessite un envoi réel).
> **Périmètre : e-mail coordinateur MENSUEL** ; le weekly (qui rend déjà l'effort)
> pourrait recevoir le même bloc en follow-on trivial. Plan :
> `docs/superpowers/plans/2026-07-27-coordinator-actions-block-sp2.md`. **SP3**
> (import cross-module dans la section Actions) reste à faire ; le graphe hebdo
> Helpdesk (demande 1) aussi.

## ⚡ Current state (as of 2026-07-27, later — SP1b-lignée)

> **Dédup inter-semaines par lignée + fix collision uid du carry-forward
> (SP1b-lignée) landed** (branche `feat/site-actions-lineage`, sur SP1b) — le hub
> montre enfin **tous les suivis ouverts d'un site, toutes semaines confondues,
> chacun une fois** (y compris ceux d'anciens rapports **jamais reportés** — la
> limite n°1 de SP1a). **Corrige aussi un bug latent introduit par SP1b** : le
> carry-forward (`_importFromWeek`) recopiait les lignes avec le **uid de la
> source** (car `addActionRow` round-trip le uid depuis SP1b) → deux lignes
> partageaient un uid → `setActionMerge` (`WHERE uid=?`, sans report_id) aurait
> touché **les deux**. Désormais une copie reçoit un **uid neuf** + enregistre sa
> **lignée** (`lineage` = uid racine de la chaîne de report), et le carry-forward
> **saute les lignes fusionnées** (elles vivent à leur origine). Colonne
> `action_items.lineage` (additive, pas de backfill — native = NULL) ; écrite à
> l'INSERT, **immuable** à l'UPDATE (comme `source`). Reader
> `getSiteOpenReportActions(site_id)` (dual-backend, `_dedupLineage` en JS :
> `COALESCE(lineage,uid)`, semaine la plus récente gagne ; exclut closed +
> `source IS NULL`) remplace le « dernier rapport seulement » de la route.
> `buildSiteActions` : chaque ligne du rapport porte **son propre**
> `report_id`/`week_label` (lien profond par ligne ; fallback rétro-compatible
> pour les fixtures). `addActionRow`/`collectActions` round-trip `lineage`.
> Régression SP1b-lignée **22** (schema + upsert 3 + dedup + register 8 + 2
> smokes + await + golden). **E2E navigateur non déroulé**. Plan :
> `docs/superpowers/plans/2026-07-27-site-actions-lineage-sp1b2.md`. **SP2**
> (e-mail par thème + lien hub) / **SP3** (import cross-module) restent à faire.

## ⚡ Current state (as of 2026-07-27, later — SP1b)

> **Identité stable + fusion cross-source des actions (SP1b) landed** (branche
> `feat/site-actions-merge`, sur SP1a) — répond au « merger les items anciens du
> suivi qui sont en fait des doublons de réunion/inspection ». **Le hot-path a
> changé** : `saveActionItems` (2 forks) passe de **DELETE-all+INSERT-all** à un
> **upsert-par-uid** — `action_items` gagne `uid` (stable, serveur,
> `crypto.randomUUID`) + `source`/`origin_id`. L'upsert UPDATE les champs
> éditables par `uid`, INSERT les nouveaux, DELETE les retirés (`uid NOT IN (…)`
> **gardé contre la liste vide**), et **n'écrit JAMAIS `source`/`origin_id`** —
> écrits uniquement par `setActionMerge`/`clearActionMerge`. Résultat : **une
> fusion survit à toute re-sauvegarde du rapport, même d'un client périmé**
> (prouvé par smoke via la vraie route PUT). **Backfill des uid existants REQUIS**
> (sqlite `_backfillActionUids` après l'ALTER ; pg dans `initPgReports`) — un uid
> NULL échappe au `NOT IN` et dupliquerait. Le **client `reports.html` round-trip
> le uid** (`addActionRow` planque `tr.dataset.uid`, `collectActions` le renvoie ;
> `validateActionItems` le propage déjà via `{...a}`) — **sans ce round-trip,
> chaque save re-minte les uid et efface la fusion**. Routes
> `POST /api/reports/action/:uid/{merge,unmerge}` (editor, valide
> `source∈{meetings,inspection}`+`origin_id>0`→400, au-dessus de `:id`). Le **hub
> replie** les lignes du rapport avec `source` (`buildSiteActions` filtre
> `!a.source`) — elles apparaissent sous leur origine. **UI de fusion** sur
> `site-actions.html` : bouton « ⇄ same as… » → modal des actions
> Réunion/Inspection du site, **suggestions** (recouvrement de mots, ★) en tête,
> **Undo** au toast. **Goldens PPTX/e-mail non lus par les nouvelles colonnes →
> additif sûr** (vérifié : golden vert). Régression SP1b **19** (schema + upsert
> + register 7 + 2 smokes + await 5 + golden). **E2E navigateur non déroulé**
> (éditeur derrière une session). Spec+plan :
> `docs/superpowers/{specs,plans}/2026-07-27-site-actions-merge-sp1b*`.
> **Différé (SP1b-lignée)** : dédup inter-semaines par `carried_from` (le `uid`
> posé ici en est la fondation). **SP2** (e-mail par thème + lien hub) / **SP3**
> (import cross-module dans la section Actions) restent à faire.

## ⚡ Current state (as of 2026-07-27)

> **Hub « Registre des actions du site » (SP1a) landed** (branche
> `feat/site-actions-register`) — répond à deux plaintes terrain : « trop de
> lignes non fermées par site » et « on ne sait pas quel rapport ouvrir pour
> aller les fermer ». Les actions d'un site vivent dans **3 endroits séparés**
> (`md_actions` réunions · `insp_actions` inspections · `action_items` suivi du
> rapport hebdo) ; le hub les **agrège en lecture**, groupées par thème, avec
> **âge/retard**. Pur `services/siteActionsRegister.js` (`buildSiteActions` —
> filtre les statuts terminaux par vocabulaire, `asOf` injecté, `age_days` null
> pour le suivi car `action_items` n'a **pas** d'horodatage de création) +
> `GET /api/reports/site-actions?site=CODE` (compose les 3 lecteurs dual-backend
> EXISTANTS — meetings/inspection `listActions` + les `action_items` du **dernier
> rapport** via `listReports(site_id)[0]` → `getReport`) + page
> `public/site-actions.html` (entrée Insights). Fermeture **en ligne** pour
> réunions/inspections (POST aux `/api/{meetings,inspection}/actions/:id/update`
> existants, RBAC serveur, revert au 403) ; **lien profond** pour le suivi via un
> nouveau `reports.html?report=<id>` (additif — `await openReportById` PUIS
> `showSection(3)`, sinon atterrit onglet 0). **Zéro schéma, zéro touche au save
> du rapport** (`action_items` = DELETE+reINSERT → pas d'identité stable, donc la
> **fusion/référence = SP1b**, l'e-mail par thème + lien vers le hub = **SP2**,
> l'import cross-module dans la section Actions = **SP3**). Limites assumées : le
> suivi montré = le dernier rapport seulement ; pas d'âge pour le suivi ; pas de
> dédup des doublons cachés (SP1b) ; Exploration/Tanda (sans code réunion/
> inspection) → groupes vides. Régression : site-actions **13** (6 pur + 2 smoke
> boot-serveur + 5 await). **E2E navigateur non déroulé** (éditeur derrière une
> session). Spec+plan : `docs/superpowers/{specs,plans}/2026-07-27-site-actions-register*`.
> **Séparé, non fait** : le graphe hebdo volume+SLA sur le bloc Helpdesk du
> rapport de site (demande 1).

## ⚡ Current state (as of 2026-07-23)

> **Réconciliation Assets SDP × AD × Entra × Defender landed** (branche
> `feat/assets-reconciliation`) — la fonctionnalité répond à l'angle mort de
> SelfScan : **un inventaire ne peut pas signaler ce qu'il ignore**. Elle compare
> le parc SDP à ce que voient trois sources externes et produit **deux listes** :
> les **ÉCARTS** (vus récemment ailleurs, absents de SDP) et les **CANDIDATS AU
> RETRAIT** (dans SDP, vus nulle part depuis 90 j).
>
> **Architecture en trois couches, seule l'acquisition est remplaçable** :
> `tools/reconcile/Collect-ADComputers.ps1` (DirectorySearcher, aucun droit
> admin, FILETIME→ISO **et depuis ce jour whenCreated→ISO**) + `DeviceInfo.kql`
> (Defender Advanced Hunting) → `services/reconcileImport.js` (parseurs **pilotés
> par en-tête**, 3 sources, **une seule forme de sortie**) → les purs
> `reconcileAssets.js` (clé normalisée, dédup par source, `asOf` injecté),
> `assetNameParser.js` (carte préfixe→site **apprise**), `assetSiteResolver.js`
> (cascade `ou_learned → ou_label → name → null`), `assetTypeClassifier.js`
> (cascade 4 sources, vocabulaire canonique FR) → `services/reconcileView.js`
> (l'assemblage, **pur**) → 8 routes `/api/assets/reconcile/*` → **7ᵉ onglet**
> `#reconcile` + **guide FR imprimable A4**.
>
> **Le résultat opérationnel, sur les vraies données** (export AD réel 4805
> machines × parc SDP 2471) : **545 écarts**, **66 OU** concernées, **751**
> candidats au retrait (dont **214 exclus** comme non joignables au domaine).
> Trois OU concentrent l'essentiel — **Ouaga Office 68/152, Tanda (Exploration
> Sites) 39/80, EDV Project Team (Abidjan) 32/43** — et **HGO est le témoin à
> 16/748 (2 %)** : c'est ce rapport qui transforme les 45-100 % ailleurs en
> *défaut de déploiement démontré* plutôt qu'en soupçon. **L'utilisateur a
> conclu qu'il devait rattacher ces OU à la bonne GPO SelfScan** — d'où le
> groupement **par OU** au premier plan du rapport : **on rattache une GPO à une
> OU, pas à un site**, et un site couvre plusieurs OU (`Exploration Sites` porte
> Tanda, Ity et Hounde dans trois conteneurs distincts).
>
> **Trois défauts trouvés en confrontant le code aux vraies données, pas aux
> tests** : (a) l'attribution du site par le **nom seul échouait à 83 %**
> (453/545) → cascade par OU → **25 indéterminés** ; (b) le sens inverse
> comptait **194 commutateurs/bornes/pare-feux** comme candidats au retrait —
> faux positifs **permanents** (ce matériel ne rejoint jamais un domaine) → un
> prédicat `retirementEligible` **injecté** ; (c) l'export AD réel porte des
> dates **`10/01/2024`** indécidables (jj/mm ou mm/jj) → refusées, pas devinées,
> **et corrigées à la source**.
> **Régression** : suite reconcile **112**, suite assets complète **161**,
> await-precedence 5/5. **T11 (export au format d'import SDP) reste BLOQUÉ** —
> le gabarit d'import SDP n'a pas été fourni et ne sera pas deviné. Plan :
> `docs/superpowers/plans/2026-07-23-assets-reconciliation.md`, spec :
> `docs/superpowers/specs/2026-07-23-assets-reconciliation-design.md`.
> **Suite (2026-07-23, plus tard) — historique + courbe des écarts livrés**
> (branche `feat/reconcile-history`, fusionnée) : transforme « 545 écarts » en
> « 545 → 380 → 210 sur trois mois », la preuve chiffrée que rattacher les GPO
> marche. **Même principe que le retrait fabriqué : on ne peut PAS reconstituer
> l'historique après coup** (fenêtre ancrée à aujourd'hui, sources remplacées),
> donc capture au fil de l'eau — patron `asset_effort_history`. **Deux tables** :
> `asset_import_log` (append-only, une ligne/dépôt, **sans clé surrogate** car
> `AUTOINCREMENT` casse sur pg) et `asset_reconcile_history` (une ligne/jour
> idempotente ; `retirement_candidates` **null quand non applicable** — un 0
> ferait une fausse chute ; `by_site_json` pour la courbe par site). Capture
> **automatique après chaque import** (non bloquante) + bouton admin de secours.
> Lecteurs double backend, route `GET /history` + `POST /snapshot`, bloc
> « Progression » sur l'onglet (courbe parc/par-site + journal). Régression :
> reconcile **127**, await 5/5. Vérifié navigateur.

## ⚡ Current state (as of 2026-07-22, later)

> **Zero-data verdicts purged from the site report + every card now states its own
> window** (branch `fix/report-zero-data-verdicts`). A coordinator asked why the score
> said "INSPECTIONS 7" while the Inspection card said "0" — the numbers were both right
> (score = **3-month rolling**, cards = **report month**), but the audit that followed
> found the report was **asserting favourable verdicts on zero data**, all from ONE root
> cause: *a `null` correctly produced upstream is destroyed downstream by `|| 'default'`
> or `num()`.* **The score half was already hardened (`applicable` gate, `?? null`); the
> report half was not.** Fixed:
> **(a) `overall_risk: 'low'` was ALWAYS fabricated** — `'low'` is **not in the
> finding-status vocabulary** (`ok·minor·major·critical·opp·na`, `inspection-init.json`),
> so `_RISK_ORDER.find()` could never return it; every "Overall risk: low" ever printed
> meant *"nothing found"*, in green. Now `null` (→ "—") when `inspections_done === 0`;
> a real "inspected, nothing serious" still reads `low`. The asymmetry was the tell: a
> reader that **threw** produced the honest "—", one that **read zero** produced green.
> **(b) `avg_resolution_h`** — `reports-db.js:1896` returns `null` deliberately, both
> renderers did `num(null)→0` → "**0h**", the best possible score, for a technician who
> resolved nothing. **(c)** "Nothing needs your attention" no longer appears in the same
> e-mail as "Score non applicable — no data".
> **(d) `pvs_held` (PVs) was compared against `dept_target` (DEPARTMENTS)** — 5 PVs from
> one department read "5 / 3 — target met" while Engagement #1 (3 *distinct* departments)
> was not met. `depts_with_pv` was computed right beside it (`meetings-db.js:2842`) and
> **thrown away by the adapter**; now it is the numerator, in `_recommend` AND
> `_financeView`.
> **(e) Each card now carries its OWN window line**, because the single global sentence
> ("every other section covers the report period only") was **factually false for four
> blocks**: `Open issues`/`HIGH open`/`Escalations` are **all-time, no date filter**
> (`meetings-db.js:2742`), both *Overdue actions* lists are all-time-as-of-today, and the
> asset-effort block is **today** regardless of the report month. The Meetings KPI grid
> is split into a labelled *month* group and an *all-time* group — they were side by side,
> undistinguished. **Regression 126 green; the two monthly goldens diff is label-only +
> exactly ONE added value** (verified independently: 29→30 numbers, no existing figure
> changed) and stayed LF.

## ⚡ Current state (as of 2026-07-22)

> **Effort + investment wired into the reports landed** (branch
> `feat/assets-reports-integration`) — the two Assets dashboards whose readers were
> "exposed for later report integration" are now **in the reports**, all additive.
> **Two pieces, consolidated:** effort and investment have different grains (effort is
> per-site, investment is per-equipment-type/business-planning), so a **single new
> "Assets — Groupe" management digest** carries BOTH the full effort leaderboard AND the
> investment forecast + coverage% banners, plus a **small effort block in the per-site
> coordinator MONTHLY report** (its own rank, the "ne pas être dernier" lever). **Piece 1
> is monthly-ONLY** — the weekly e-mail (shipped 2026-07-21) already renders effort via
> `weeklyReportData._loadEffort`; adding a block to it would double-render. The
> label→code fold+rank logic (previously private in `weeklyReportData`) was **extracted**
> to a shared PURE `services/assetEffortForSite.js` (`effortForSite(code,{leaderboard,
> aliases})` → `{score,rank,of,delta}|null`, rank **recomputed on folded codes** — a mean
> of label ranks is meaningless; `of`=folded-code count; `null` (not zeros) when the code
> maps to no AP label). The new group digest is a **pure composer**
> `services/assetGroupReport.js` + a **`send-asset-group` CLI** (moule hygiène: gate-first,
> `require.main` guard, armed OFF via `asset_group_send_enabled`, recipients from
> `asset_group_recipients` config — a GROUP artifact, NOT per-coordinator
> `resolveRecipient`) + `'asset_group'` schedule type + a **`#ap-asset-group` admin card**
> (4 surfaces) + its **OWN route** `POST /api/reports/asset-group/send` (NEVER `SEND_TYPES`
> — that handler hardcodes the coordinator composer). **Regression**: 162 green across the
> touched + neighbouring suites; the **two monthly-email goldens stay byte-identical** (the
> effort block is spread-inserted `...(x?[b]:[])`, never an empty-string that would add a
> `\n`); await-precedence 5/5. Spec + plan in `docs/superpowers/`. **NOT merged as of this
> line — branch ready.**
>
> **Known limits (flagged, not bugs):** (a) the investment forecast reader gives
> **fleet totals + per-year only, NO per-equipment-type grain** — the per-type filtering
> the user asked for lives on the interactive Investment tab; the emailed digest shows the
> fleet total + coverage, with a top-N-by-type table a possible fast-follow. (b) The
> `foldEffortByCode` mean treats a **null-effort label as 0**, dragging a code's mean down
> when one of its AP labels has never been scored — pre-existing behaviour shared with the
> scoreboard/weekly, surfaced here, not changed. (c) The CLI **re-reads config itself**
> (`xof_usd_rate`→rate never 1, `asset_replacement_uplift_pct`→**÷100 to a fraction**,
> `asset_depreciation_config`→`parseDepreciationConfig(rawString)`) because
> `_assetUsdRate`/`_assetUpliftPct`/`_deprecConfig` are **server.js-private** — a naive
> reuse would pass a percent as +300%/yr.
>
> ---

## ⚡ Current state (as of 2026-07-21)

> **Weekly report e-mail landed** (branch `feat/weekly-report-email`, merged) — the
> coordinator's **weekly** site report now goes out by e-mail, alongside the existing
> monthly one, **entirely additive**. **The decisive design choice: the weekly e-mail
> delivers the AUTHORED report, replayed from the frozen snapshot** — `services/
> weeklyReportData.js` loads `weekly_reports` + its **4 children** through the existing
> `getReport`, and `helpdesk_data` is **computed once at save time and carries
> `fetched_at`**, so the e-mail and the coordinator's PPTX can **never disagree about
> the same week**. It **never re-queries live data** — a live re-query would silently
> re-date the numbers a human already signed off. New: `services/reportTemplates/
> weekly.js` (composer), `services/sendWeeklyReport.js` (sender), `tools/reports/
> send-weekly.js` (CLI), a `'weekly_report'` schedule type, `weekly_report_send_enabled`
> (**armed OFF**, in `reportConfig.DEFAULTS`), its **OWN** `POST` route + an admin card.
> **The monthly path is byte-for-byte untouched**: the shared e-mail primitives were
> extracted to `services/reportTemplates/_primitives.js` under **two byte-equality
> goldens** (`tests/__golden__/monthly-email-*.html`) — necessary because
> `tests/report-template-coordinator.test.js:305-314` **strips all markup** before
> asserting and therefore cannot catch a refactor regression. **The coordinator sender
> is now monthly-only** (a dead cadence kind used to make a weekly schedule mail the
> **monthly** report — fixed in `693c728`). **Status is FOUR values**
> (`draft|in_progress|ready|submitted`, `server.js:5993`) and the client auto-sets
> `ready` (`reports.html:3787`) — so the common real case is a coordinator who filled
> everything in and **never clicked Submit**, reported as **"complete but not
> submitted"**, never merely "not submitted". Asset labels resolve **FORWARD** through
> `assetLabelToCode` over `getAssetLookups().sites` (`b2ebdb5` — inverting `ALIAS`
> matched **zero** rows and every worklist read empty, which looks like a *clean* site).
> Also fixed this session: the two goldens were **CRLF-mangled on every fresh Windows
> clone** (Git-for-Windows ships `core.autocrlf=true` in the SYSTEM gitconfig) — a new
> **`.gitattributes`** pins `tests/__golden__/*.html` to `-text`; the assertion itself is
> untouched. **Regression**: branch suites **174/174**; report/site-report/reporting/
> exec/mailer **223/226** (the 3 failures are the **pre-existing** `exec-routes.smoke`
> `pgDb not initialised`, **verified failing identically on `main`**); the
> reports-db-consumer sweep (review/score/composite/pptx/meetings) **326/326** incl. the
> PPTX golden fingerprint; `await-precedence` **5/5**. Plan:
> `docs/superpowers/plans/2026-07-21-weekly-report-email.md`, specs:
> `docs/superpowers/specs/2026-07-21-weekly-report-email-design.md` +
> `…-coordinator-weekly-report-design.md`.
>
> ---

## ⚡ Current state (as of 2026-07-20)

> **PV signature auto-save + Issues Log inline edits landed** (branch
> `feat/pv-stamp-and-issues-inline`) — two field-driven fixes on the Meetings module.
> **(1) Stamping a signature now PERSISTS the PV** — previously the two "Stamp …
> signature" buttons only mutated local state (`meeting.html:1303-1310`, no network
> call), so a coordinator who forgot to click Save lost the signature. **That was not
> cosmetic**: `signoff` is one of the **6 SCORED dimensions** of the site programme
> score (`services/siteScore.js:28`, G≥70/A30) read from exactly
> `dept_head_signed_at` + `site_it_signed_at` (`reviewDashboard.js:221-223`) — an
> unsaved stamp **silently lowered the site's score**. Now the stamp handler calls the
> page's existing `save()` (which posts the WHOLE PV, so it also rescues other unsaved
> edits) → `reload()` → `renderHeader()` repaints from the stored values; **on failure
> it REVERTS** so the UI can never show a stamp that isn't saved. **The timestamp is
> now SERVER-authoritative** (the UI label already promised "server time" while the
> code used the browser clock): `meetings-db.js` substitutes its own timestamp whenever
> the client sends a truthy signature value, on **both** the sqlite and pg forks —
> combined with the pre-existing `COALESCE(...)` on UPDATE, the first stamp wins and a
> re-save never rewrites it. Proven in-browser by patching `Date.prototype.toISOString`
> to 1999: the client sent `1999-01-01`, the stored value was the server's real time.
> **(2) Issues Log** (`public/meetings-issues.html`) gains a **champion filter**
> (distinct champions from the loaded rows, accent-folded `localeCompare`, composes
> with the other filters; KPI tiles recompute from visible rows when it's active) and
> **per-row status change** posting to the existing `POST /api/meetings/issues/:id/update`
> — which in ONE transaction writes the `md_issue_updates` audit row AND updates
> `md_issues.status` (+ `closed_at` on resolved/cancelled), so no DB work was needed.
> **Per-row RBAC** mirrors the server's `_userMeetingsSite()` (admin+ unscoped; a
> site-scoped editor gets disabled selects with the reason in `title`), the server
> stays the enforcement point, and a refused change **reverts the select** and shows
> the server's message. **Browser-verified both** (champion filter 54 names → narrows +
> composes; a status change persists across reload, KPI tiles move, the audit shows on
> the parent PV; a real temp site-scoped editor saw 29 enabled / 103 disabled with an
> independent server 403; stamps persist + are immutable on re-stamp; zero console
> errors). **Regression**: meetings suite (**36**) + await-precedence 5/5 green.
> **Known limits (flagged, not bugs)**: the champion filter is client-side over the
> loaded set (bounded by `listIssues`' `LIMIT 500`; 135 issues today — a server-side
> `champion` param is the durable fix if the corpus grows), and rows under a **closed**
> parent PV can't be pre-disabled because `/api/meetings/issues` doesn't return the
> parent's status (the actions list does) — the scoped editor learns via the server's
> readable 403. Plan: `docs/superpowers/plans/2026-07-20-pv-stamp-and-issues-inline.md`.
>
> ---

## ⚡ Current state (as of 2026-07-19)

> **Unified operational Site Scoreboard landed** (branch `feat/site-scoreboard`) — a
> per-site **operational** scoreboard (a weighted composite of **4 dimensions**:
> helpdesk SLA · inspections conformity · réunions 5-Engagements · actifs effort)
> grafted **ADDITIVELY** onto the IT Review Dashboard, plus a **scheduled
> per-coordinator e-mail** (full leaderboard, own row highlighted) — so the SDM can
> project one comparable RAG per site in the monthly meeting ("personne ne veut être
> dernier"). **The author's authoritative models are NEVER touched**: it rides the
> existing **`opts.extras`** mechanism (allowlist extended `['hdNote','hdRows']` →
> `['hdNote','hdRows','sbuRows','sbuNote']`), so a no-extras `buildReviewVals` still
> emits **exactly his 61 keys** (`tests/review-fidelity.test.js`'s 72-combo deep-equals
> stay green) and it **never enters `sbs`/`comps`/`codes`**; `siteScore.js`/
> `siteComposite.js` unedited. Pure `services/siteScoreboard.js` (`buildSiteScoreboard`
> — **weighted 40/20/20/20**, **renormalized over PRESENT dims**, coverage N/4, RAG
> **75/55**, rank, Δ vs prev month, 0-dims → "non applicable"); glue
> `services/scoreboardData.js` (`loadScoreboardData` — 4 readers + prev month,
> null-safe: helpdesk null-OBJECT guard, meetings `.site` key + null-before-×100,
> inspections `ok/applicable` from `aggregate().findingStatus`, effort via
> `scoreboardAliases.foldEffortByCode`); `services/scoreboardAliases.js` (in-code AP-label
> →meetings-code map — NOT a `site_module_codes` namespace, whose PK `(site_id,module)`
> can't hold Massawa+Sabodala→SGO — folded by **simple mean** since effort rows carry no
> asset-count). Panel added to **BOTH** `it-review.html` AND
> `docs/reference/it-review-dashboard.template.html` (with a with-scoreboard
> render-backstop pass), single-dot `cells` flattening (the renderer resolves ≤1 dot).
> E-mail: `services/siteScoreboardReport.js` (`buildScoreboardDigest`, no `$`) +
> `tools/reports/send-scoreboard.js` (**per-coordinator**: arm-flag-only gate,
> confirmed-recipients-only via `resolveRecipient('coordinator')`, per-(period,site)
> dedup, `--preview`, `require.main` guard) + `'scoreboard'` in `reportSchedule` +
> `scoreboard_send_enabled` config + a `#ap-scoreboard` admin card (4 surfaces). It is
> **clearly labelled** "Scoreboard opérationnel — 4 dimensions" vs his "Score
> programme" — the two may show a different RAG per site (two lenses, by design, like
> `sbDims` vs `composite` already do). **Browser-verified** (9 real rows, his panels
> unchanged, null dims "—", non-applicable site, callouts, absent in scoreboard/brief
> views, API 65 keys, zero console errors). **Regression**: scoreboard + review suites
> (**183**) + await-precedence 5/5 green. Plan:
> `docs/superpowers/plans/2026-07-19-site-scoreboard.md`, spec:
> `docs/superpowers/specs/2026-07-19-site-scoreboard-design.md`.
>
> ---

## ⚡ Current state (as of 2026-07-19)

> **Assets Investment & Forecast dashboard landed** (branch
> `feat/assets-investment-forecast`, on top of the merged Assets module) — a
> per-equipment-type **investment picture** to take to the business: a historical
> spend curve + a forward forecast + **coverage-% transparency as a headline**, all
> **additive**. A new **6th "Investment" tab** on the unified `public/assets.html`,
> driven by the shared filter bar (filter **by equipment type** — the business ask).
> Three things: **(1) historical curve** (hardware `purchase_cost` XOF→USD + software
> licence `cost` by acquisition year, + cumulative). **(2) forward forecast** —
> **hardware replacement** driven by **depreciation useful life** (each asset replaced
> the year it passes end-of-life per `resolveForType` on the depreciation config),
> budgeted **original cost × (1+uplift)^years-to-replacement** where uplift is the new
> admin config knob **`asset_replacement_uplift_pct`** (default `'0'` = like-for-like);
> **software renewal** driven by licence **expiry year** (subscriptions recur yearly;
> **no depreciation** — a different engine, labelled as renewal). Assets/licences past
> due land in a **"Due now"** bucket; those due after the horizon go to
> **`beyond_horizon` (counted, not summed)**; the horizon is a **UI selector (3/5/10y,
> default 5)**. **(3) coverage banners** stating the exact basis: *"Hardware forecast
> based on N of M assets (X%) — acquisition date + cost + a lifecycle policy"* +
> *"Software renewal based on N of M licences (Y%) with expiry + cost"* + the
> excluded-reason breakdown — so a partial dataset is never over-read (it sharpens as
> the Microsoft-contract data + site/office asset-manager updates land). **All logic is
> in a PURE `services/assetForecast.js`** (`buildInvestmentHistory` /
> `buildHardwareForecast` / `buildSoftwareForecast` — currency-agnostic, USD via
> `money.js`, `asOf` passed in so it's unit-testable without a DB); dual-backend readers
> `getInvestmentSummary` / `getInvestmentForecast` on `assets-db.js` (aliased
> `FROM assets a WHERE 1=1${_assetWhere}`; software uses **`_licenceWhere` = site/state/q**,
> NOT manufacturer/product_type — the licence table has neither); routes
> `GET /api/assets/investment/{history,forecast,export.xlsx}` (`requireReportSession`,
> horizon clamped [1,15], `asOf` resolved before the reader, forecast **echoes
> `uplift_pct`** for the UI label). **Eligibility gates are rate-INDEPENDENT**
> (`parseAmount>0`, not `toUsd>0`) so coverage% never moves with the FX rate. **Readers
> exposed for later weekly/monthly report embedding** — NOT wired now. **Browser-verified**
> (6 tabs, coverage <100% banners, curve + stacked forecast + beyond note, horizon
> selector, product_type narrows hardware only, uplift 3%/yr label, export, empty-state,
> zero console errors). **Regression**: `asset-forecast` (20) + `assets-investment-readers`
> (5) + `assets-investment-routes.smoke` (7) + `report-config-uplift` all green;
> await-precedence 5/5. **(Data reality: hardware eligibility needs acquisition_date
> [~91% empty] AND non-zero cost [~90% `'0.00'`], so today's forecast may rest on a
> single-digit % of the fleet — the coverage banner IS the guardrail.)** Plan:
> `docs/superpowers/plans/2026-07-19-assets-investment-forecast.md`, spec:
> `docs/superpowers/specs/2026-07-19-assets-investment-forecast-design.md`.
>
> ---

## ⚡ Current state (as of 2026-07-19)

> **Assets effort-trend dashboard landed** (branch `feat/assets-effort-trend`, on top
> of the merged Assets module) — a per-site **asset-manager effort-over-time** view so
> sites are visibly comparable in meetings (nobody wants to be the site making no
> effort), all **additive**. A new **append-only `asset_effort_history` table** (PK
> `(snapshot_date, site)`) + a nightly **`snapshotEffort({asOf})`** job that, per site
> with `total>0`, snapshots the six data-hygiene good-state rates and a **composite
> effort score = `round(100 × mean(cost_pct, age_pct, owner_pct, scan_pct, tag_pct,
> enrolled_pct))`** (each pct = `1 − worklist/total`, reusing the **`HYGIENE_KINDS`
> predicate strings verbatim** so it can't drift; `ghost` is stored as a detail column
> but is **NOT** in the score — `scan_pct` uses `never_scanned`). **Idempotent per day**
> (sqlite `INSERT OR REPLACE` / pg `ON CONFLICT (snapshot_date,site) DO UPDATE`) and
> **`GROUP BY COALESCE(site,'')`** (a bare `GROUP BY site` would insert NULL into the
> NOT-NULL PK → the snapshot throws → the sync's `.catch` swallows it → the dashboard
> is silently empty forever). The snapshot is **CHAINED after `syncAllAssets()`
> resolves** (`.then(() => snapshotEffort({}))`, never in parallel — the sync
> DELETE+INSERTs, so a parallel snapshot would read the old/empty/mid-tx table) on
> BOTH the nightly cron (04:30) and the manual `POST /api/sync/trigger/assets`; the
> `.catch` **logs** (never silently swallows). Readers `getEffortLeaderboard({asOf})`
> (per-site `{effort_score, baseline_score, delta, rank}` + `most_improved` /
> `needs_attention`) and `getEffortTrend({site},{months})` (per-site score series
> aligned to sorted dates, **`null` for gaps NOT 0**, + 6-component detail when a single
> `site` is given), dual-backend, await-covered. **Δ is a ~30-day LOOKBACK** (baseline =
> the snapshot on/nearest-before `asOf−30d`, else earliest-in-window; single-snapshot →
> null) — a day-over-day Δ on nightly cadence would read ≈0 in exactly the meeting this
> exists for. Surfaces: `GET /api/assets/progress/{leaderboard,trend}` +
> `POST /api/assets/progress/snapshot` (`requireReportSession`; snapshot `requireAdmin`
> — a manual "capture a point" for demos/first baseline) + a **5th "Progress" tab** on
> the unified `public/assets.html` (leaderboard with Δ badges · most-improved /
> needs-attention callouts · multi-line trend chart `spanGaps:false` · per-site
> component detail on row-click · empty/collecting-data state · admin "Capture snapshot
> now"). **Progress is a per-site metric → only the Site filter applies** (the history
> table has no product_type/state/manufacturer columns; a "site filter only" note is
> shown). **Readers exposed for later weekly/monthly report integration** ("intégrer
> plus tard") — NOT wired into reports now. **Browser-verified** (5 tabs, all 4 Δ
> states, callouts, gap-breaks, component detail, empty-state, admin snapshot, site
> filter; zero console errors). **Regression**: full assets suite (**154**) +
> await-precedence 5/5 green. Plan:
> `docs/superpowers/plans/2026-07-19-assets-effort-trend.md`.
>
> ---

## ⚡ Current state (as of 2026-07-19)

> **Assets UI polish (three fixes) landed** (branch `feat/assets-ui-polish`, on top
> of the merged unified Assets module) — front-end + a small route/Excel change,
> all **additive**. **(1) Finance charts now honour ALL shared filters** (was
> Site-only). Root cause was **TWO layers**: `FIN_PANE` in `public/assets.html`
> passed only `{site: siteVal()}` to the finance/depreciation endpoints (not the
> full `window.__assetFilters()`), AND the depreciation route helper
> `_assetDeprecFilters` in `server.js` whitelisted only `site` (finance's helper
> already whitelisted all 5) — **fixed both**, so State/Product-Type/Manufacturer
> now narrow the fleet-finance band + book-value chart + depreciation schedule.
> Licences/Software deliberately unchanged (product_type/state/hardware-manufacturer
> don't map to a software catalog). **(2) Inventory table + Excel gained 6 columns**:
> Acquisition Date · User · Department · Purchase (USD) · Book value (USD) · TCO
> (USD). The `/api/assets/inventory` route (and `/export.xlsx`) now convert the
> raw-XOF money columns to USD via `_assetUsdRate()` + `money.toUsd`, adding per-row
> `purchase_cost_usd`/`book_value_usd`/`tco_usd` (the inventory reader already
> returned `a.*` incl. `acquisition_date`/`user_name`/`department`).
> `services/assetExcel.js` `ASSET_COLUMNS` reworked to `[header, field]` pairs with
> the 6 new columns (raw XOF `purchase_cost` dropped from the sheet in favour of the
> USD column). The inventory response **stays a BARE ARRAY** (`INV_PANE` consumes
> `Array.isArray(rows)?rows:[]`) — the `*_usd` fields are added per-row, not wrapped.
> **(3) Every Assets chart segment is clickable → a drill modal with CSV export**
> (mirrors index.html's `_openTicketDrillModal`). A shared
> `openAssetDrill({title,columns,rows,filename})` in `assets.html` renders a modal +
> an Export CSV (UTF-8 BOM, CRLF, quote-escaped). Charts wired via a label→drill map:
> by-site bars → `/inventory?site=`, hardware by-kind → `/hardware/exceptions?kind=`,
> software donut → `/software/exceptions?kind=`, licence expiry donut →
> `/licences/exceptions?kind=`, hygiene charts → inventory/exceptions. The licence
> FAMILY donut + the depreciation SCHEDULE line are **intentionally not wired** (no
> clean per-slice row set); existing tile-click drills preserved. **Browser-verified
> all three** (Manufacturer=Dell narrows the finance band/chart/schedule; the 6
> inventory columns show converted USD + owner; chart-click modals export CSV).
> **Regression**: assets suite (**148**) green. Plan:
> `docs/superpowers/plans/2026-07-19-assets-ui-polish.md`.
> **NOT merged** — branch ready for review.
>
> ---

## ⚡ Current state (as of 2026-07-18)

> **Assets Hardware Health (sub-project D) landed** (branch
> `feat/assets-hardware-health`, on top of the merged unified Assets module) — a
> **hardware-health worklist** added as a **4th tab** on the unified module, all
> **additive** (reuses Foundation's `assets`/`asset_monitors` substrate + the
> enriched reader untouched). **Four kinds** (`HARDWARE_KINDS` in `assets-db.js` —
> the single source of truth the routes + Excel read): `low_ram`
> (`ram_total_gb>0 && <8`, unknown-RAM excluded) · `full_disk`
> (`system_disk_free_pct != null && <10`) · `refresh_due`
> (`months_since_acquisition >= _refreshCycleMonths(product_type)`) ·
> `no_real_monitor`. New dual-backend readers `getHardwareHealthSummary(filters)`
> (per-kind counts + per-site) and `getHardwareHealthExceptions(kind, filters)`
> (identity rows via an **explicit no-money column list `_HARDWARE_EXC_COLS`** —
> never `a.*`, which would leak `purchase_cost`/`current_book_value`), await-covered.
> All thresholds computed **IN JS** via a `toNum`→null helper (free-pct may be
> `'94%'`) — **no SQL CAST on the raw text columns** (pg-safe). **The RAW
> `monitor_count` over-counts** (cameras/webcams/virtual monitors) → a trustworthy
> `real_monitor_count` denylist subquery, and `no_real_monitor` is scoped to
> **workstation-type** devices only (headless servers/network gear not flagged).
> Surfaces: `GET /api/assets/hardware/{summary,exceptions,export.xlsx}`
> (`requireReportSession`; unknown kind → **400**) + a **Hardware tab** on the
> unified `public/assets.html` (4 tiles: Low RAM<8GB / Full disk<10% / Refresh-due /
> No-real-monitor + per-kind drill + per-site + Excel). The 4th tab required FOUR
> coordinated edits to the unified shell (the `TABS` array = URL-hash set, the
> `PANE` map, the `inited` map, and the button+section markup). **Browser-verified**
> (4 tabs, no regression, zero console errors). **C-3 (which-machines software
> drill) is BLOCKED** — live recon 2026-07-18 confirmed the AP `software_installations`
> view (id 002075) TIMES OUT even filtered to a single software_id (>2 min for 24
> rows — AP does not push the criteria down, it scans all 121k); neither a full
> 121k sync nor an on-demand per-title fetch is reliable, so the live drill is
> **deferred** (viable path = periodic bulk CSV import or a pre-aggregated AP pivot).
> **Regression**: new suites (assets-hardware-readers · assets-hardware-routes.smoke)
> green; full assets suite (**155**) no regression. Plan:
> `docs/superpowers/plans/2026-07-18-assets-hardware-health.md`.
> **NOT merged** — branch ready for review.
>
> ---

## ⚡ Current state (as of 2026-07-18)

> **Assets UI unified into ONE tabbed module** (branch `feat/assets-unified-module`,
> front-end-only) — the three separate Insights nav entries (Assets · Assets — Hygiene ·
> Assets — Finance & Licences) are collapsed into a **single "Assets" module** with an
> internal **tab bar** (Inventory · Hygiene · Finance & Licences) driven by **one shared
> filter bar** (Site · State · Product Type · Manufacturer · search from
> `/api/assets/lookups`). `public/assets.html` (now ~1660 ln) is the module shell: one
> `<head>` (Chart.js once), a hash-synced tab bar (`#inventory|#hygiene|#finance` → deep-link
> / refresh lands on the right tab), and three panes holding the migrated bodies of the old
> pages as per-tab modules (`INV_PANE`/`HYG_PANE`/`FIN_PANE`) with `init(f)`/`refresh(f)`
> reading the shared `filters()`. **Every element id is namespaced `inv-`/`hyg-`/`fin-`** and
> each Chart has a unique canvas id + destroy-on-refresh (no "Canvas already in use"); tabs
> **lazy-init** on first activation and the filter **persists across tab switches**. Software
> compliance stays **fleet-wide** (the catalog view has no site — only manufacturer/q apply,
> shown with a "site filter N/A" note). `public/_shell.js` now has ONE `assets` child;
> `public/assets-hygiene.html`/`assets-finance.html` are **12-line redirect stubs** →
> `assets.html#hygiene`/`#finance` (old bookmarks land right). **Backend untouched** — pure
> front-end consolidation; the assets test suite (42+) is green. **Browser-verified**: all 3
> tabs render, the Site filter narrows every tab (Inventory/Hygiene/Finance), Site+Product-Type
> combine, zero console errors, redirects work. Plan:
> `docs/superpowers/plans/2026-07-18-assets-unified-module.md`.
>
> ---

## ⚡ Current state (as of 2026-07-18)

> **Assets Software Licence Compliance (C-2) landed** (branch
> `feat/assets-software-compliance`, on top of the merged A+B+C-v1+Depreciation) —
> the deferred sub-project C, **reframed small after live recon**: it answers
> **"purchased vs installed — are we under- or over-licensed?"** entirely from the
> **`software` catalog view** (id **106803000000002070**, ~**9830** rows, single
> fetch — NOT the 121k installations table), all **additive**. The catalog view
> **already carries the aggregated compliance columns** (`Installations` detected,
> `Installations Allowed` purchased, `Compliance Type` verdict), so C-2 needs **NO
> 121k `software_installations` table** — that "which machines run title X"
> drill-down is **deferred to C-3** (needs a dedicated long-timeout fetch). New
> synced `software` table (`assets-sync.js` single fetch → map → DELETE+INSERT tx +
> `db/postgres/assets/001_init.sql`; `'software'` in `_ASSET_TABLES` +
> `tools/pg/copy-assets.js` TABLES). `assets-db.js` (additive):
> `classifySoftwareCompliance` + `getSoftwareComplianceSummary`/
> `getSoftwareComplianceExceptions` + `SOFTWARE_KINDS`
> (`under_licensed`/`over_licensed`/`managed`), dual-backend, await-covered.
> Surfaces: `GET /api/assets/software/{summary,exceptions,export.xlsx}`
> (`requireReportSession`; unknown kind → **400**), + a **Software compliance
> section** on `public/assets-finance.html` (Under-Licensed = **risk headline tile**
> + Over/Compliant/Managed tiles, a **metered-only donut**, by-manufacturer table,
> drill + Excel). **Browser-verified.** **Key facts**: only ~**50** titles are
> `Software Type='Managed'` (the metered universe); the other ~9780 are unmetered
> (`Compliance Type='N/A'`). **The count columns hold the literal string `'N/A'`**
> (9780 rows), NOT empty — so `CAST('N/A' AS INTEGER)` 500s on pg / returns 0 on
> sqlite; **all classification/comparison is done IN JS** via a `toInt`→null helper
> (no SQL CAST, mirroring the licence readers). **Trust SDP's `Compliance Type` as
> the verdict**, NOT a raw `Installations>Allowed` comparison — the raw delta agrees
> on this data but SDP factors CAL/downgrades, so an ORed raw comparison would
> falsely flag downgrade-covered titles (`under_licensed` = Compliance Type only).
> **BOM on `﻿Software ID`** (same trap as Assets.csv). **Regression**: new suites
> (assets-software-readers · assets-software-routes.smoke) + extended
> `assets-integration` (**9830** rows + **32** Under-Licensed on the real
> `tests/fixtures/assets/Software.csv`) = green; A/B/C-v1/depreciation (**120**) no
> regression (one combined-run flake from the cross-file getDB-singleton isolation —
> non-reproducible, each file green alone). Spec:
> `docs/superpowers/specs/2026-07-18-assets-software-compliance-design.md`.
> **NOT merged** — branch ready for review.
>
> ---

## ⚡ Current state (as of 2026-07-18)

> **Asset Depreciation (computed) + scope-reorganized Admin Config console landed**
> (branch `feat/assets-depreciation-config`, on top of the merged A+B+C-v1) — the
> sibling to Finance/Licence (C-v1): where C-v1 shows SDP's Current Book Value as-is,
> this **computes book value ourselves** from a config-driven depreciation policy, and
> reorganizes the sprawling admin console **by scope**. Two halves, both **additive**.
> **(1) Depreciation** — new PURE, **currency-agnostic** `services/depreciation.js`:
> `computeDepreciation({cost,salvage,method,usefulLifeMonths,declinePercent,
> acquisitionDate,asOf})` for **4 methods** (`straight_line` · `declining_balance` ·
> `double_declining` · `sum_of_years`) → `{currentBookValue, accumulated,
> pctDepreciated, monthsElapsed, monthsRemaining, schedule[]}`, plus
> `parseDepreciationConfig`/`resolveForType`/`METHODS`/`DEFAULT_DEPRECIATION_CONFIG`.
> **Pinned to the SDP screenshot case** (2,250,000 / straight-line / 36mo → 62,500/mo,
> 1.5M @ 12mo, 0 @ 36mo). The annual `schedule` **downsamples the SAME monthly
> book-value function** so it's consistent with `currentBookValue` at year boundaries
> (matters for declining/DDB). Currency-agnostic → convert to USD **AFTER** via the
> `xof_usd_rate`. `reportConfig.DEFAULTS` gains `asset_depreciation_config` (a JSON
> blob: global default + per-product-type overrides — **no per-asset**, SDP owns that;
> our module is read-only). `assets-db.js` (additive): `getAssetDepreciation(filters,
> {config,rate,asOf})` (per-site **COMPUTED** book value in USD + SDP's Current Book
> Value as a cross-check + `pct_depreciated = 1 − Σcomputed/Σpurchase` + refresh) and
> `getDepreciationSchedule` (`{years, book_value_usd}` fleet curve), dual-backend,
> await-covered. Surfaces: `GET /api/assets/depreciation/{summary,schedule}` +
> `GET/PUT /api/assets/depreciation-config` (config PUT `requireAdmin`, validates
> `method∈METHODS` + `life>0` + `salvage 0..1` → **400**). `?asOf=` optional (default
> today), **resolved to a real date BEFORE the reader call** (a bug caught in Task 4:
> asOf defaulted only in the response label, passing `undefined` to the reader → 0
> months elapsed → computed = purchase, 0% fleet-wide; fixed). **(2) Admin console**
> `public/reports.html` **reorganized by scope** — rail grouped **⚙ Global**
> (users/sessions/sites/**email (NEW: SMTP extracted → `#ap-email`)**/backups) ·
> **📊 Reports** (autoreports/departments/execview) · **💻 Assets**
> (**finance (NEW: `xof_usd_rate` moved here → `#ap-assets-finance`)** ·
> **depreciation (NEW config editor `#ap-assets-deprec`)** · hygiene) · **🛡 Risk**,
> each item carrying a scope badge. SMTP + rate relocations **kept their ids identical**
> (shared getElementById save/load untouched; `xof_usd_rate` removed from Hygiene's
> save/load). `public/assets-finance.html` gains a **Computed book value (USD)** column
> (primary) next to **Book value (SDP)** (cross-check) + a **fleet net-book-value
> line chart** over years + a note (config source, asOf, rate). **Browser-verified**:
> zero console errors, all panels open, SMTP/rate/depreciation/group_report/hygiene
> saves round-trip, deep-links work. **Decisions**: depreciation config = global
> default + per-product-type only (no per-asset override); book value = **computed by
> us (4 methods) as primary**, SDP's Current Book Value shown only as a cross-check.
> **Regression**: new suites (depreciation · assets-depreciation-readers ·
> report-config-deprec · assets-depreciation-routes.smoke) = **38 new pass**;
> A/B/C + reporting (**129**) no regression. Spec:
> `docs/superpowers/specs/2026-07-18-assets-depreciation-and-config-ia-design.md`.
> **NOT merged** — branch ready for review.
>
> ---

## ⚡ Current state (as of 2026-07-18)

> **Assets Licence compliance (C-v1) + Finance view landed** (branch
> `feat/assets-licence-finance`, on top of the merged A+B) — the sibling to Hygiene
> (B): where B answers "how trustworthy is the register?", this answers **"what is
> it worth and are we licence-compliant?"** — a **Finance view (money in USD)**, a
> **licence-compliance view (type families + expiry)**, and **two hygiene
> enrichments**, all **additive**, driven by the user's ITAM training PPTX +
> software-licence-types guide. **Money is displayed** for the first time —
> deliberately, in **USD only**: assets are XOF × a configurable
> `xof_usd_rate:'0.00165'` (`reportConfig.DEFAULTS`, admin-editable via the Hygiene
> card), licence cost is native USD; **all conversion + parsing lives in the new
> PURE `services/money.js`** (`parseAmount` strips `$`/comma/space, `'0.00'`→0,
> garbage→null; `toUsd(rawXof,rate)`; `fmtUsd` = thousands+2dp, **NO `$` glyph** —
> USD is conveyed by a text label). New `assets-db.js` readers (dual-backend,
> additive): `getFinanceSummary(filters, rate)` (per-site USD value/book/TCO/opex +
> `pct_depreciated` + `refresh_due` — **sums IN JS via `money.parseAmount`, rate
> applied once, never a SQL `SUM`/`CAST`**) and `getLicenceSummary` /
> `getLicenceExceptions` / `classifyLicenceType` / `LICENCE_KINDS` (type families
> per the guide + expiry buckets). Captured columns: finance fields + `asset_tag`
> on `assets`, `license_option`/`installations_allowed`/`acquisition_date`/
> `organization_license` on `software_licenses` (`assets-sync.js` extends both view
> maps; `db/postgres/assets/001_init.sql` adds them to the **one shared CREATE**
> execed on BOTH backends + a JS-side backend-branched ALTER — sqlite PRAGMA-guarded
> in `getDB`, pg `IF NOT EXISTS` in `initPgAssets`). Two new `HYGIENE_KINDS` —
> `no_asset_tag` + `lifecycle_exception` — **NOT in the completeness score** (kept
> additive so B's pinned numbers hold). Surfaces:
> `GET /api/assets/finance/{summary,export.xlsx}` +
> `GET /api/assets/licences/{summary,exceptions,export.xlsx}`
> (`requireReportSession`; finance reads the config rate, **falls back to DEFAULT,
> never 1**; unknown kind → **400**), page `public/assets-finance.html`
> ("Finance & Licences" dashboard) in **Insights ▾** (icon `wallet`) — USD
> value/book/TCO per site + %depreciated + refresh-due + book-value chart; licence
> family donut + expiry tiles + drill + Excel. **Browser-verified** (USD, rate
> labelled, charts, drill, zero console errors). The hygiene digest
> (`services/assetHygieneReport.js` + `tools/reports/send-hygiene.js`) gains
> **optional Finance + Licence snapshots** (USD via `fmtUsd`, **no `$`**),
> backward-compatible. **Decisions**: money is USD-only (conversion only in
> `money.js`); **C-2 (purchased-vs-installed) is DEFERRED** — needs the 121k
> `software_installations` table + the software-catalog view id; per-year
> depreciation schedule is NOT in the SDP export (only Current Book Value ships) →
> Finance shows **book value + % depreciated**, not a schedule. **Regression**: new
> suites (money · report-config-rate · assets-finance-readers ·
> assets-licence-readers · assets-finance-routes.smoke) + extended
> integration/hygiene/report/send-hygiene = **33 new pass**; Foundation + B (**99**)
> no regression. Spec:
> `docs/superpowers/specs/2026-07-18-assets-licence-finance-design.md`.
> **NOT merged** — branch ready for review.
>
> ---

## ⚡ Current state (as of 2026-07-18)

> **Assets CMDB Hygiene (sub-project B) landed** (branch `feat/assets-hygiene`, on
> top of the merged Foundation) — turns "how trustworthy is the register?" into a
> **Group-IT hygiene dashboard**, six **exception reports** with Excel export, and
> a **scheduled email digest**, all **additive** — it reuses Foundation's `assets`
> table + `getEnrichedAssets`/`ASSETS_BACKEND` substrate **untouched**. **Six
> exception kinds** (`HYGIENE_KINDS` in `assets-db.js` — the single source of truth
> the routes + Excel + digest all read): 3 **worklists** (`discovered` ·
> `never_scanned` · `ghost` = stale >90d AFTER a clean audit) and 3 **completeness
> gaps** (`no_owner` · `no_age` · `no_cost`). New dual-backend readers
> `getHygieneSummary(filters)` (per-kind counts + per-site completeness % +
> scan-freshness buckets + by_state) and `getHygieneExceptions(kind, filters)`
> (identity rows, **NO cost amount**; unknown kind throws) — await-covered.
> Surfaces: `GET /api/assets/hygiene/{summary,exceptions,export.xlsx}`
> (`requireReportSession`; unknown kind pre-validated → **400**, never 500) +
> `POST /api/assets/hygiene/send?preview=1|0` (`requireAdmin`, disarm-safe), page
> `public/assets-hygiene.html` in **Insights ▾** (icon `shield-check`) — completeness
> %, 3 worklist tiles (Discovered/Never-scanned/Ghost), 3 Chart.js charts, per-kind
> drill + Excel. **Browser-verified.** The digest: `services/assetHygieneReport.js`
> (PURE `buildHygieneDigest` → `{subject, html, attachments[xlsx]}`, freshness line,
> Δ vs prev, **no money**) + `tools/reports/send-hygiene.js` (**armed-OFF by
> default**, `decideHygieneSend` gate, dedup via `reportSentLog`
> `report_type='hygiene' site_code='GROUP'`, `--preview`, reads `assets_assets`
> last-success via `reports-db.getLastSyncAt` for the freshness line). Existing-module
> edits kept **additive**: `reportConfig.DEFAULTS` gains
> `hygiene_recipients`/`hygiene_send_enabled` (else `setConfig` silently drops them),
> `reportSchedule` gains `'hygiene'` in TYPES + exported `cliFor()`
> (hygiene→send-hygiene.js, coordinator path **byte-unchanged**), and a
> "🛡 Assets Hygiene" admin card (admin+) on `reports.html` (recipients + arm toggle
> + schedule + Preview/Send-now). **NO money displayed anywhere in B** — the `$`
> label is an unresolved XOF/USD lie (Foundation trap); B lists WHICH assets lack
> cost, never an amount (deferred to C/D). **software + software_installations still
> deferred to sub-project C.** **Regression**: new suites (assets-hygiene-readers ·
> assets-hygiene-routes.smoke · asset-hygiene-report · send-hygiene ·
> report-config-hygiene · report-schedule-hygiene) all green; existing coordinator
> tests (report-config/report-schedule/send-reports-cli, **23**) still green;
> Foundation suite (**27**) no regression. Spec:
> `docs/superpowers/specs/2026-07-17-assets-hygiene-design.md`.
> **NOT merged** — branch ready for review.
>
> ---

## ⚡ Current state (as of 2026-07-17)

> **Assets Foundation (sub-project A) landed** (branch `feat/assets-foundation`,
> 7 tasks) — a **read-only IT asset inventory** built from the ManageEngine
> AssetExplorer (AP) Analytics views, alongside the existing modules, **entirely
> additive** (no migration touches any other DB). New `assets-db.js` +
> `assets-sync.js`; **`ASSETS_BACKEND=sqlite|postgres`** flag (default sqlite),
> **PG-ready from day one** via `services/pgDb.js` — this module has NO sqlite prod
> precedent, the sqlite path exists only for tests/dev (no migration debt).
> **5 AP views full-replace-synced nightly** (`cron.schedule('30 4 * * *', …)` —
> daily, not hourly): `assets` (pk asset_id) · `asset_memory` · `asset_logical_drives`
> · `asset_monitors` (composite pk workstation_id+monitor_id) · `software_licenses`.
> Each view is a **single fetch → map → DELETE+INSERT in one tx**, and the fetch
> runs BEFORE the tx so a Zoho throw never empties a table. Enriched reader joins
> **`Workstation ID = Asset ID`** (verified 100% join): `ram_total_gb` (SUM of
> memory), `system_disk_free_pct` (C: drive), `monitor_count` (raw COUNT).
> Surfaces: `/api/assets/{inventory,lookups,summary,export.xlsx}` +
> `POST /api/sync/trigger/assets`, page `public/assets.html` in **Insights ▾**.
> **NO money is ever displayed** — `purchase_cost` / licence `cost` are stored RAW
> TEXT (ambiguous currency, deferred). **software + software_installations are
> DEFERRED to sub-project C** (121k rows / 13.6 min fetch → past fetchView's cap).
> **Task 6 (this session) closed Foundation**: `tools/pg/copy-assets.js` (mirrors
> `copy-tracker.js`, entrypoint-guarded, require-safe) + a **real-CSV integration
> test** (`tests/assets-integration.test.js`) that drives the 5 committed AP
> exports (`tests/fixtures/assets/*.csv`, ~2 MB) through the SAME sync mapping into
> a throwaway sqlite and asserts on REAL data: **2473 assets** land (proves the BOM
> is stripped), **2246** no-cost rows (`purchase_cost IN ('0.00','0','')`), a real
> machine with `ram_total_gb > 0`, sane monitor/free-pct. **Surprise the integration
> test caught**: AP delivers `Free Space (%)` as `'94%'` (trailing percent), so
> `_coerceEnriched`'s `Number('94%')` was NaN on EVERY real machine → the free-pct
> column silently rendered `—` fleet-wide. Fixed in `assets-db.js` `_coerceEnriched`
> (strip `%`/comma/space, NaN→null) — the ONLY source change beyond the new files.
> **Regression**: 757 tests, **672 pass / 15 fail — all 15 pre-existing** (dev `.env`
> sets `REPORTS_BACKEND=postgres`, so route-smoke suites that boot `server.js`
> without `initPgReports()` fail with `pgDb not initialised`). `await-precedence`
> 5/5 green (auto-covers assets-db's dual-backend dispatchers). Spec:
> `docs/superpowers/specs/2026-07-17-assets-foundation-design.md`.
> **NOT merged** — branch ready for final review, merge is the user's call.
>
> ---

## ⚡ Current state (as of 2026-07-16)

> **Sub-project 3C landed** (branch `feat/helpdesk-changes`): three user-requested
> additions, all **ours, on top of the authoritative model, none of them touching
> his score**. (1) A **Helpdesk & Changes panel** on the IT Review, between
> Infrastructure Inspection Assurance and Project pipeline — it rides in via an
> **optional `opts.extras`** on `buildReviewVals`, so a no-extras call still emits
> **exactly his 61 keys** and `tests/review-fidelity.test.js` keeps proving the
> port (a new test pins the added keys to a declared allowlist: `hdNote`+`hdRows`).
> (2) A **changes block on the site report** + coordinator email (plain words —
> no "RFC"/"CAB", asserted). (3) **IT Review in the Insights nav**, `target:'_blank'`
> (the page deliberately has no shell mount — a new tab is what makes that a
> non-issue). New: `reports-db.getSiteHelpdeskWindow` / `getSiteChangesWindow`
> (window-scoped, **group-scoped**) + the change classifier **ported verbatim**
> from `public/executive-report.html:5053-5090`.
> **Two windows in one panel, deliberately**: helpdesk follows the period selector;
> **changes are a fixed 90 days** ending at `ANCHOR` (the last change is 2026-07-03
> and the default WEEK window holds **0** changes — following the selector would
> render permanent dashes). `hdNote` states BOTH windows; the panel is thin
> (SML 4 · SMI 3 · HGO 2 · MGO 6 · SGO 2 = **17** over `2026-04-15..2026-07-14`),
> so raw counts sit next to the percentage rather than a 2-row rate standing alone.
> **Verified live in the browser** (both pages render, real numbers, `?period=week`
> vs `month` moves helpdesk 11→53 while changes stay 4/3/2/6/2).
> **Regression:** 713 tests, **627 pass / 16 fail — all 16 pre-existing on `main`**
> (the dev `.env` sets `REPORTS_BACKEND=postgres`, so route-smoke suites that boot
> `server.js` without `initPgReports()` fail; `inspection-blobs`' "delete removes
> the filesystem blobs" fails 4/4 on `main` in isolation on a leftover backup file).
> All three fidelity tests green; golden fingerprint green and **NOT regenerated**.
>
> ---

## ⚡ Prior state (as of 2026-07-13)

> **Reporting Suite sub-projects 1-2 landed** — sub-project 1 (Foundation, branch
> `feat/reporting-suite`): engine + config module + live `/site-report.html` + Automated
> Reports admin card. Sub-project 2 (Coordinator, branch `feat/reporting-coordinator`):
> the per-site data is now REAL (Foundation's binder silently read zeros — see the
> Known Pitfalls rows below), + the coordinator report composer + `POST /api/reports/send`
> (preview / dedup / safety gate) + the scheduled `tools/reports/send-reports.js` CLI.
> **Sub-project 3A landed** (branch `feat/score-sbdims`): the site score is now the
> user's authoritative `sbDims` model (6 dims × 0/1/2 ÷ 12, RAG 70/45) over a
> **3-month rolling window**, replacing the earlier INVENTED weighted model.
> **Scores WILL differ from any report sent before this** — that is the point, the
> old numbers were ours, not theirs. Pinned to the user's own data by
> `tests/score-fidelity.test.js` (their 5 sites, their window, their oracle).
> **Sub-project 3B-1 landed** (branch `feat/composite-engine`): the SECOND
> authoritative model — `composite()` / `eMetrics()` / `twoMoves()`, RAG **75/55** —
> is ported into `services/siteComposite.js` and fidelity-pinned to the author's
> own dataset (`tests/composite-fidelity.test.js`, his 5 sites, his oracle). It
> ships ALONGSIDE `sbDims`, and the two genuinely disagree — see the pitfall rows.
> Also: a site with **no data on the window now reads "non applicable"** instead of
> the fabricated RED 33 the two inverted dims used to produce.
> **Sub-project 3B-2a landed** (branch `feat/review-data`): the two halves the page
> needs, both fidelity-pinned. (1) `services/reviewData.js` — `loadReviewData(asOf)`
> denormalises our schema into the authoritative dashboard's `D` shape (5 joins,
> fleet-wide, sqlite + PG fork with the `to_char` cast on `md_issues.updated_at`);
> **proved field-for-field against `tests/fixtures/em-data.json`** read from
> `prod-snapshot/`. (2) `services/reviewDashboard.js` — the port of his `renderVals()`
> (15 panels, 61 keys, pure). Its acceptance test derives the oracle **by RUNNING HIS
> CODE** (`tests/review-oracle.js` compiles `docs/reference/it-review-dashboard.source.js`
> against the fixture) and asserts **all 61 keys deep-equal across all 72
> view × period × site combos**. Four approved deviations, each commented at its site:
> the `SITES` lookup is total (his 5 codes would throw on our 11-12 site fleet);
> `fleetScore`/`targetDepts` follow `codes.length` not a hardcoded 5; `groupRows`
> country groups narrow to present codes; option objects carry a declarative `key`
> replacing his dropped `pick` closure. All four are identical on his fixture.
> **Sub-project 3B-2b landed** (branch `feat/review-page`): **the live page** —
> `/it-review.html` serves the author's IT Review Dashboard from our databases.
> His 15 panels, his numbers, **none of his runtime**: no dc-runtime, no React,
> no Babel, no CDN, no remote fonts — **zero external requests** (verified in the
> browser: every request is same-origin). Three parts: (1) `public/it-review.js`
> — a **3-primitive renderer** (`{{ }}` / `<sc-for>` / `<sc-if>`), ~220 lines,
> vanilla, `require`-able by the tests AND browser-usable (see the pitfall row —
> it carries two invariants that each cost a review round); (2) three approved
> `server.js` additions and nothing else — the `_htmlCache` boot-load entry, the
> `GET /it-review.html` route (`site-report.html`'s precedent: `injectApiKey=false`,
> session via cookie), and `GET /api/reports/review-data` (whitelists all 4 of
> `view`/`period`/`site`/`asOf` — they reach the model; proved un-500-able live on
> path-traversal + SQLi-shaped input); (3) `public/it-review.html` — his 85 KB of
> markup carried across verbatim (219 bindings, 32 `<sc-for>`, 3 `<sc-if>`), his
> `<helmet>` CSS minus its 9 `@font-face` (artifact blobs we don't have; the stacks
> fall back to system faces). His `sc-raw-*` / `sc-camel-*` aliases become the real
> tags/attrs; the template lives in a `<script type="text/html">` so the HTML
> parser never touches his `<table>`/`<svg>` before the renderer sees it. **The 4
> `pick` closures became links** — the page is stateless, so changing a control
> navigates (a delegated handler merges the one changed param into the current
> query string, so switching view doesn't reset period + site).
> **Two disclosures the page MUST keep** (unexplained, both read as bugs): the
> score's window (programme start → as-of here, vs a **rolling 3-month window** on
> the emailed site reports — the two can legitimately differ, and neither is the
> report month), and that **`?asOf=` moves the scoreboard only** — `windows(period)`
> pins to `ANCHOR`, not `asOf` (`reviewDashboard.js:110`, his own line, ported for
> fidelity).
> **Deploy note:** `server.js` **and `it-review.html`** are server-code /
> `_htmlCache` surfaces — after the ZIP is applied, `pm2 stop` → `timeout /t 5` →
> `pm2 start` (**NOT `pm2 reload`** — see the EADDRINUSE crash-loop pitfall, where
> the orphan keeps serving the OLD `_htmlCache` and your deployed HTML looks
> "missing"). `it-review.js` is referenced as an external `<script src>` on
> purpose, so `injectAssetVersion` versions it (`?v=<APP_VERSION>`) and users need
> no Ctrl+F5 beyond the usual one.
> Sub-projects 4/5 (scheduling auto-send + the Finance Manager report) pending.
>
> **READ FIRST.** Branch `main`. **🏁 The SQLite→PostgreSQL migration is COMPLETE
> in prod: ALL 4 modules run on PostgreSQL** (`TRACKER_BACKEND` / `MEETINGS_BACKEND`
> / `INSPECTION_BACKEND` / `REPORTS_BACKEND` = `postgres` in prod `.env`, plus
> `PG_URL=postgres://sdp_app:…@localhost:5432/sdp_dashboard`). The PG cluster is the
> one the 4MyPeople installer manages (cohabitation audited: its destructive ops are
> scoped to fmp_v2/fmp_app; the postgres superuser password is the appliance-standard
> value from the installer's config.psd1 — treat it as 4MyPeople-owned). The sqlite
> `.db` files are **frozen archives** — rollback per module = remove the flag + pm2
> stop/start (post-flip writes stay in PG). Backups: `_sdp_admin.cmd` option 5 embeds
> a `pg_dump` (`tools/pg/dump-db.js`) in every restore point — 4MyPeople's own
> restore points cover fmp_v2 ONLY.
>
> **Prod ops now go through `_sdp_admin.cmd`** (4MyPeople-style menu at the app root):
> apply deploy ZIP / restart (stop-wait-start) / backup+restore points / health probe
> / diagnostics / PG check (C) / PG provisioning (P — blank postgres password = the
> standard appliance value auto-read from config.psd1) / pm2 crash-loop recovery (R).
> Deploy-marker discipline: the packager NO LONGER advances `.git/last-deployed` —
> run `tools\deploy\mark-deployed.cmd` on the dev box after each confirmed prod apply;
> the packager auto-deletes older `sdp-deploy_*.zip` so the repo root holds exactly one.
>
> **Key fixes this session (all deployed):** `survey_answers` had NO unique key → every
> sync re-inserted every row (70% dupes; deck pain-points showed "14 mentions" for 2
> respondents) — boot migration purges + `uq_sa_response_question`; slide-9 downtime/MTTR
> now use the `UDF:Incident Actual Start/Resolution Time` window (the typed Total
> Downtime UDF key had drifted + is unreliable); slide-8 has two donuts (By Type +
> "By Category" = UDF:Division); CHANGES-scope group presets now SEED populated
> (Operations incl. Infosec + ManageEngine per user direction — ERP excluded);
> Exec View made PG-ready (5 readers forked, `loadExecSummary` async — this had been
> silently breaking the strategic block since the tracker flip); **await-precedence
> pitfall**: a sync→async sweep wrote `await rdb.listSites().find(...)` in 11 places
> (method chained on the Promise) — always `(await f()).method()`.
> **This row is now ENFORCED, not advisory** — see `tests/await-precedence.test.js`
> (added 2026-07-16 after the same bug reached prod a second time: `POST /api/reports`
> threw `rdb.listReports(...).find is not a function` for every admin while the whole
> sqlite suite stayed green). The test auto-discovers all ~149 dual-backend
> dispatchers and fails on any caller chaining onto one. **Don't hand-grep; run it.**
>
> **QA asset:** `prod-snapshot/` (gitignored) = full prod `data/` copy (2026-07-09) —
> reports/tracker/meetings/inspection DBs + blobs. Local PG 17 on :5432 mirrors prod
> (sdp_app/sdp_dashboard populated from it). Postgres superuser password = appliance
> standard, read from `%TEMP%\4MyPeople-Installer\config.psd1` at run time.
>
> **2026-07-13 (suite) — INSTALLEUR 4MyPeople-style LIVRE** : `SDP-Setup-<version>.exe`
> autonome (Node+pm2+PostgreSQL+Python embarques, zero reseau) — spec/plan dans
> docs/superpowers/, guide operateur docs/INSTALLER.md. Runtime committe dans
> tools/installer/ (Setup.bat menu, Install-SDP.ps1 7 etapes/4 modes/rollback auto,
> Manage-SDP.ps1 = L'implementation backup/restore/schedule unique — _sdp_admin.cmd
> 5/6/7 delegue), build dev-only dans tools/installer-build/ (cache gitignore).
> Carte admin "Scheduled Backups" (reports.html#admin, super_admin) -> 2 taches
> Task Scheduler via /api/admin/backup-schedule (services/backupSchedule.js, TDD).
> E2E prouve sur :3457 : fresh/upgrade/rollback-auto(exit 2)/downgrade-refuse.
> Pieges captures : robocopy /IS /IT /IM (fichiers meme taille+date sautes),
> 7zSD.sfx vient du LZMA SDK (plus dans 7z-extra), Read-Host -AsSecureString gele
> sur stdin redirige, python-embed exige ._pth import site decommente. INCIDENT
> recupere : le .env dev a ete perdu (fichiers racine supprimes pendant le build
> T10, cause externe non identifiee) — reconstruit depuis le .env prod (UNC),
> PG_URL re-adapte dev; git etait intact.
>
> **Open items:** (1) SSO Entra go-live — code complete + dormant, waiting on the
> user's app registration (see the 2026-07-08 section below); (2) scheduled/automatic
> pg_dump (Task Scheduler) — today it runs only when option 5 is used; (3) 12
> pre-existing PG test fixtures missing the `template` key (task chip filed);
> (4) backlog-theme keyword tuning; (5) repo never pushed to origin.

---

## ⚡ Prior state (as of 2026-07-08)

> **READ FIRST.** Branch `main`, tip `01c0811`+, **~46 commits ahead of the last
> confirmed prod deploy** (`7fb62d9`, Exec View v1). **NOTHING in this session
> is deployed yet.**
>
> **DEPLOY MODEL CHANGED (2026-07-08): ZIP package, no more `Z:` xcopy.** Run
> `_deploy.cmd` (now a wrapper for `tools/deploy/make-deploy-zip.ps1`) → builds
> `sdp-deploy_<sha>_<stamp>.zip` → user copies it to prod, extracts, runs the
> bundled `_apply_on_prod.cmd` (xcopies into `C:\Apps\SDP-Dashboard` + deletions)
> → then **`_pm2_restart_prod.cmd`** (pm2 stop → `timeout /t 5` → start — NOT
> `reload`; EADDRINUSE crash-loop pitfall). `render.py` is copy-only. Users need
> ONE **Ctrl+F5** after restart. Because this backlog touches `server.js` + many
> `_htmlCache`'d HTMLs, the restart is mandatory. The marker still drifts
> (background harness) — rebaseline `git rev-parse 7fb62d9 > .git/last-deployed`
> before packaging if it looks wrong.
>
> ### What landed (7 tracks, ~44 commits)
>
> | Track | Commits | Summary |
> |---|---|---|
> | **1 · SharePoint Exec View v1.1/v1.2** | `8bb2ce1`..`15168ef` (+`28ca533`) | MI-centric site panel (only sites with an active Major Incident or overdue backlog), on-page MI detail + SDP quick-links, report-month anchoring, **AI-summarized MI cards** (server-side, cached, degrades to non-AI text), active-MI query fix (exclude closed/resolved/cancelled — stale `pending_status` was leaking closed MIs), footer "Powered by…" removed. New `_pm2_restart_prod.cmd` + `_pm2_recover_prod.cmd`. |
> | **2 · Group IT Report (exec-pptx)** | `db8c100`..`7bea65c` | Slide-2 rebuilt to the "5. Operations: Summary" template (initials avatar, quadrant grid, title colours, light-blue zones); slide-3 Executive Overview compacted; **page number in a blue box**; **FRT SLA target = 80%** everywhere; Resolution-SLA 12-mo trend flat-100% bug fixed (`isResOverdue` in the monthly builder); channel chart trims leading no-data months; **deterministic TOP PAIN POINTS** from survey verbatims (dropped the Phase-5/LLM placeholder); **change charts inherit the tickets group scope** (stop Application-team leakage into the Ops deck); **backlog classified BY THEME** from ticket subjects (`_backlogThemes`, 7 keyword rules) + fixed a >100% "fresh share" denom bug. |
> | **3 · AI off + Quick-only** | `c5f64cd`, `50ea5f7` | **`AI_PROVIDER` default flipped `anthropic`→`off`** — `/api/ai/analyze` returns a clean 503, MI-summary regen skips. Deck builder is **Quick-only**: cloud "Analyze" buttons removed, "Analyze (Quick)" promoted to primary, `runAnalysis()` redirects to the offline engine, Audience selector hidden. |
> | **4 · Corrective-Action dashboards + exports** | `78664ea`, `8074b10`, `71d9fa7`, `b3c5db1` | `inspection-actions.html` + `meetings-actions.html` each got a **Chart.js analytics dashboard** (status/priority-or-dept donuts, ageing, by-site stacked, raised-vs-closed trend) + a **client-side PPTX export** (pptxgenjs 3.12.0, already vendored — 3-slide deck scoped to the active filter). Plus **full-table Excel export** (`services/tableExcel.js` + `GET /api/inspection/export.xlsx` + `GET /api/meetings/export.xlsx`, admin+, multi-sheet, SheetJS server-side). |
> | **5 · Inspection form** | `e6b19e0`, `1fa20d3`, `b3c5db1` | **Owner + Target Date now mandatory** on corrective actions (red highlight + Submit blocked). **Checklist "display by type"** domain filter (All / IT & Datacenter / Telecom & Comms / Safety & Physical / OT & Ops — pure display filter over the 17 categories). Fixed the **`/api/inspection/aggregate/export` 404** (route order: `/:id/export` was swallowing `/aggregate/export`). |
> | **6 · Microsoft Entra ID SSO** (dormant) | `e9dd863`..`40212de`, `f1c6c1f` | Full stack, **flag-gated on `SSO_MODE` (off/available/only), inert until set**. See the dedicated section below. |
> | **7 · Help manual** | `01c0811` | `help.html` bilingual (EN+FR) refreshed: inspection domain filter + mandatory fields + 11.6 Actions Register; meetings 12.6 Actions Register + 12.7 Insights; section 14 reframed Quick-first; new section 15 SharePoint Exec View. 30 headings, TOC anchors validated. |
>
> ### Microsoft Entra ID SSO — built this session, DORMANT
>
> Decisions (locked with the user): **SSO-only** end-state, **pre-provisioned
> only** (deny unknowns), **roles/sites stay in the dashboard DB**, one
> **break-glass** password super_admin, **profile auto-synced from Entra**,
> **hybrid `available` cutover window**. Everything is gated on `SSO_MODE` and
> ships completely inert (default `off`).
>
> - **Engine** `services/ssoEntra.js` — OIDC auth-code + PKCE, **zero new npm
>   deps** (axios + built-in `crypto` for RS256/JWKS verification). Enriches the
>   profile via Graph `/me` (jobTitle/officeLocation; needs `User.Read`).
>   `tests/sso-entra.test.js` (12, real RSA round-trip).
> - **DB** `reports-db.js` — `users` gains `email`, `entra_oid`, `first_name`,
>   `last_name`, `title`, `office` (idempotent ALTER). New `findUserByEntra`,
>   `linkUserEntra`, `createSessionForUser` (mints the SAME session token as
>   `login()`), `updateUserProfileFromEntra` (COALESCE — never wipes on blank),
>   `setUserEmail`. sqlite + pg forks. `tests/sso-db.test.js` (8).
> - **Routes** `server.js` — `SSO_MODE` (SSO_ENABLED=true → `only` back-compat).
>   `GET /api/auth/config` (public), `/api/auth/sso/login`, `/api/auth/sso/callback`
>   (state/nonce/PKCE in a 10-min in-memory map; findUser→link→profile-sync→mint
>   →httpOnly `report_token` cookie + localStorage handoff via a tiny HTML page).
>   All 3 exempted from the `/api/` gate. Password-login **break-glass gate fires
>   only in `only` mode**. `tests/sso-routes.smoke.test.js` (4, boots app SSO-off).
> - **UI** `login.html` (Microsoft button; hides password form per mode; friendly
>   `sso_error` messages), `reports.html` (Email field on Users + **✉ Map SSO
>   emails** bulk screen with `first.last@edv-ops.com` auto-suggest, accent-folded).
> - **Cutover** (`docs/SSO_ENTRA_SETUP.md`): register app + `email` claim +
>   `User.Read` → **map emails in bulk** → `SSO_MODE=available` (~1 wk, both
>   methods) → `SSO_MODE=only`. `.env`: `SSO_MODE`, `ENTRA_TENANT_ID/CLIENT_ID/
>   CLIENT_SECRET/REDIRECT_URI`, `SSO_BREAKGLASS_USER`, `SESSION_COOKIE_SECURE=1`.
> - **The user is the M365/Entra admin** and will do the app registration. **Not
>   yet done** as of this writing → SSO cannot be end-to-end tested until it is.
>   Total SSO suite: **24 tests green**.
>
> ### New files this session
>
> `services/ssoEntra.js`, `services/tableExcel.js`, `docs/SSO_ENTRA_SETUP.md`,
> `_pm2_restart_prod.cmd`, `_pm2_recover_prod.cmd`, tests: `sso-entra`, `sso-db`,
> `sso-routes.smoke`, `exec-active-mi-filter`, `exec-mi-summary`.
>
> ### Open items / next session
>
> 1. **Deploy the 30-file backlog** + `_pm2_restart_prod.cmd`; after restart run
>    ONE full requests sync (`POST /api/sync/trigger/requests?force=true`) so the
>    new `template` column backfills and **Major Incident #311587** (flagged via
>    SDP Template, not Request Type) appears.
> 2. **SSO go-live** — user does the Entra app registration, then: bulk-map
>    emails → `SSO_MODE=available` → verify own Microsoft sign-in → `only`.
>    Offered but not yet done: a **callback integration test** (stub the engine,
>    prove findUser→link→profile→session→cookie) + a **security-review pass**.
> 3. **help.html** — add a "Sign in with Microsoft" note to §2 once SSO is
>    `available`; optionally refresh Admin §7 for the new cards (Exec View
>    editorial, SSO email-mapping).
> 4. **Backlog-theme keyword tuning** — the `_backlogThemes` rules are a first
>    pass; tune against real June data if too much lands in "Other".
> 5. **Postgres**: the SSO reports-db pg forks exist but `entra_oid`/profile
>    columns must be added to the pg `users` schema before a reports.db PG cutover.
>
> ---

## ⚡ Prior state (as of 2026-06-22)

> **READ FIRST.** Branch `main`, tip `50d8717`. This session was a focused
> **Group IT Report PPTX (exec-pptx) overhaul** — 6 commits
> (`72f593c`..`50d8717`) bringing the dashboard's generated deck into
> pixel-alignment with the user's hand-finished **"Group IT May 2026 -
> Final-Operations.pptx"** template, fixing filter leakage, and making the
> AI commentary length audience-aware. The pipeline is unchanged in shape
> (`executive-report.html _buildExecPptxPayload` → POST `/api/reports/exec-pptx`
> → `services/reportPayload.js build()` → `python tools/exec-pptx/render.py`);
> all visual work lives in `render.py`, all data/scoping work in the browser
> builder + `build()`.
>
> **Deploy status**: NOT yet deployed by the user as of this writing. The
> 6 commits touch `tools/exec-pptx/render.py`, `public/executive-report.html`,
> `services/reportPayload.js`. `executive-report.html` is in `_htmlCache` and
> `reportPayload.js` is server code → after `_deploy.cmd`, do
> `pm2 stop` → `timeout /t 5` → `pm2 start` (NOT reload — EADDRINUSE pitfall).
> `render.py` is spawned fresh per export (copy-only, no reload needed).
> The user had already deployed `411cf2f` and earlier and confirmed a clean
> June 2026 export mid-session.
>
> ### What landed (6 commits)
>
> | Commit | Subject |
> |---|---|
> | `72f593c` | design: align slides 3-11 to May template (render.py restyle) |
> | `411cf2f` | feat: wire live payload to feed new template fields (slides 5/8/9/10/11) |
> | `9114a08` | fix: apply CHANGES GRP filter to change charts in export |
> | `9c6ae36` | fix: apply selected group + site filters across all helpdesk + change charts |
> | `c42604d` | feat: dimension AI commentary length by audience + footer auto-shrink |
> | `50d8717` | polish: audience-size slide-2 bullets + larger footer font |
>
> ### Track 1 — render.py restyle to match the May template (slides 3-11)
>
> Per-slide changes in `tools/exec-pptx/render.py` (the matplotlib + python-pptx
> generator). The May final was the **design** reference (data still comes
> from the dashboard — the user's directive: "stick to the site's calc logic"):
>
> - **Slide 3 (KPI Executive Overview)** — tile titles changed from light
>   gray to **bold NAVY** (`kpi_tile` label color); slide-3 footer band
>   enlarged (was the smallest at 0.55").
> - **Slide 4 (12-mo trend)** — `_draw_volume_trend`: grouped vertical
>   Inbound(navy `#1F3D5C`)/Closed(green `#2E8540`) bars + value labels on
>   top. `_draw_sla_trend`: Res.SLA green / FRT navy lines.
> - **Slide 5 (categories/channel)** — `_draw_categories`: horizontal
>   **grouped** current-vs-previous bars (needs `categories_prev`); the
>   channel area is now a **single line chart** (`_draw_channel_share_trend`),
>   the redundant horizontal channel bar was removed.
> - **Slide 7 (CSAT)** — `_draw_csat_donut`: bold-white % **on the slices**
>   (autopct, pctdistance 0.80) + legend below.
> - **Slide 8 (changes)** — `_draw_changes_donut`: bold-white % on slices
>   (Standard dark-navy, Major mid-blue, Emergency red); the yellow box is
>   now **data-driven** (was hardcoded CHG-254) + a **"→ Recent changes
>   include …"** glance line from `recent_changes`.
> - **Slide 9 (Major Incidents)** — **4 tiles** (Major / Resolved / Open /
>   MoM Change; P1/P2/downtime in the first tile's subtitle) + **single-column**
>   full-width incident cards with a description + bold **Action:** line
>   (run-level: "Action:" bold navy + recommendation italic). Was a 2×3 grid
>   with "Lessons:".
> - **Slide 10 (tracker roadmap)** — **5 pastel KPI tiles** (Green / Amber /
>   Red / Avg Score / Best Δ — pastel bg + colored top bar, NOT the
>   left-accent kpi_tile); **vertical** per-site bars (one stable colour per
>   site) + **vertical** stacked pillar bars; italic **"Source:"** footer
>   (no navy commentary band). Header subtitle adds "· N Operating Sites · M
>   Activities".
> - **Slide 11 (per-site)** — **4 pillar banners** (name + weight% + Δpp,
>   teal/orange/purple/gold) + rich **site cards** (code, name·activities,
>   score%, Δ pill, G/A/R light badges, ✓ positive line, ⚠ action line) +
>   **General Review** bullets + "Source:" footer. This is the
>   **tracker-pptx.js two-slide design** ported into render.py at 13.33×7.5.
> - **UTF-8 fix**: `render.py` now reads stdin via
>   `sys.stdin.buffer.read().decode('utf-8')` — was the Windows locale codec
>   (cp1252) → mojibake on accented site names (Houndé→HoundÃ©) + em-dashes.
>
> ### Track 2 — data wiring so the LIVE export populates the new fields
>
> render.py reads new fields with graceful fallbacks; the browser + `build()`
> now supply them:
> - **`executive-report.html` `_buildTrackerBlock`** enriched: `best_site`,
>   `best_delta_pp`, `total_activities`, `active_sites`, fleet `avg_delta_pp`,
>   per-site `positive`/`action` (via existing `_trkSiteCommentary`), per-pillar
>   `delta_pp` (cur vs prev fleet avg), `general_review` (via `_trkGeneralReview`).
>   Plus top-level `recent_changes` (from `chgInMonth` subjects).
> - **`services/reportPayload.js build()`**: emits `categories_prev` (from the
>   browser `categories[].previous` already present) and passes `recent_changes`
>   through. `_majorIncidents()` now computes `mi_resolved` / `mi_open` /
>   `mi_downtime_h` / `mi_prev_total` (prev-month count via an extra query) for
>   the slide-9 tiles, and already supplies per-record `detail` (description) +
>   `lessons`/`action`.
>
> ### Track 3 — filter scoping (the "Sunshine ERP leaked into Operations deck" bug)
>
> The export's change charts (donut, 6 tiles, recent-changes) were filtered
> by **month only** — they ignored CHANGES GRP entirely, so ERP/Apps changes
> leaked into the Operations deck. AND the helpdesk side was **hardcoded** to
> the Operations ticket preset, ignoring an explicit TICKETS GRP selection
> AND the site selector. Now `_buildExecPptxPayload`:
> - **Group (tickets)** = explicit `_activeGroups` if set, else
>   `_DEFAULT_GROUP_PRESETS.Operations` (keeps the Operations default but
>   honors a narrower selection). Applied to tickets, prev, 12-mo trend,
>   categories, channels, ageing, backlog, support-groups.
> - **Group (changes)** = explicit `_activeChangeGroups` if set, else
>   `CHANGE_GROUP_PRESETS.Operations` (consistent with tickets).
> - **Site** = the SAME `siteMatch()` the on-screen preview uses (`selSite`;
>   'all' = no filter) — applied across tickets + changes + ageing + trend.
> - **No change for the all/all default** — numbers identical; filters only
>   bite when the user narrows a group or site.
> - **STILL fleet-wide (by design, flagged):** Major Incidents (server
>   `_majorIncidents`, month+type only) and CSAT (survey-wide, not group/site
>   tagged). Open question for next session — see below.
>
> ### Track 4 — AI commentary length is now audience-aware + footers never overflow
>
> The audience selector (Executive CFO/CIO · Operational · Technical) set
> **tone** but each prompt field hardcoded sentence counts (helpdesk 5-7,
> csat 4-6, sla/change 2-3) that overrode the brevity → footers overflowed
> even in CFO/CIO mode. Now:
> - **`_AUDIENCE_LEN` + `_alen()`** in `executive-report.html` → per-audience
>   LENGTH BUDGET (Executive 1-2 short sentences / Operational 2-3 / Technical
>   4-6). `_audiencePreamble()` injects a **STRICT budget block** that overrides
>   any later count and notes the text renders in a narrow footer band.
> - Every footer-feeding field spec now substitutes `${_alen('section')}` /
>   `${_alen('csat')}` instead of a fixed count; the slide-2 narrative bullets
>   (progress/issues/nextperiod/actions) scale via `${_alen('gov')}`.
> - **Slide 2 IS audience-aware** — the governance prompt already prepends
>   `_audiencePreamble()`; verified. Its columns cap at 5 bullets / fixed box
>   so no overflow regardless of audience.
> - **`render.py _fit_footer_size(text, base=11.5)`** — safety net: short
>   (CFO/CIO) commentary renders LARGE (base 11.5, bands are 0.85" tall);
>   only long (Operational/Technical) commentary scales down (10 → 9 → 8.5)
>   to fit. Applied to all footer bands (slides 3-9 + 11b). Slide-9 footer band
>   enlarged 0.55"→0.85". Verified with a 527-char stress comment — fits.
>
> ### QA harness (dev-only, gitignored deploy)
>
> `tools/exec-pptx/_mk_qa_fixture.py` builds `fixtures/kpis-may-qa.json` —
> a **render.py-flat-shape** fixture (monthly_trend, monthly_channels,
> categories_prev, flat csat, mi resolved/open/mom/action, enriched tracker
> block) so render.py can be visually QA'd locally WITHOUT a 5-min live data
> fetch. Loop: edit render.py → `python tools/exec-pptx/render.py < fixtures/kpis-may-qa.json > out.pptx`
> → LibreOffice (`C:\Program Files\LibreOffice\program\soffice.exe`) → PDF →
> PyMuPDF → PNG → inspect. The dev box also has real **Office 365 PowerPoint**
> at `C:\Program Files\Microsoft Office\root\Office16\POWERPNT.EXE` for
> faithful-render QA.
>
> ### Open items / next improvements (for the following session)
>
> 1. **Major Incidents scoping (slide 9)** — ✅ DONE: the browser sends the
>    selected site in `payload.filters.site`; `build()` forwards it as
>    `dbFilters.site`; `_majorIncidents` filters rows with the SAME fuzzy
>    `siteMatch` logic the rest of the deck uses ('all' = fleet-wide). Group
>    filtering left OFF by design (MIs are cross-cutting). The main query
>    `LIMIT` lifts 10→50 only when a site is selected so post-filter rows
>    aren't truncated; prev-month MoM count is site-scoped too.
> 2. **CSAT scoping (slide 7)** — survey-wide; can't filter by group/site
>    until survey responses are reliably tagged with site/group. Needs a
>    survey-instrument change (add a site question) or a mapping.
> 3. **Pain-points / Voice clustering** — slide-7 "TOP PAIN POINTS" still
>    shows a "Voice clustering pending (Phase 5)" placeholder; `/api/survey/voice`
>    returns 401. LLM verbatim clustering is the unfinished Phase 5.
> 4. **Verify on live** that `categories_prev` (slide 5 grouped Apr-vs-current
>    bars) and `monthly_channels` (slide 5 channel line) actually populate from
>    the browser payload — they were validated against the QA fixture, not yet
>    against a real export.
> 5. **No golden test for the exec-pptx deck** — the `tests/pptx-monthly-golden`
>    fingerprint covers the weekly/monthly report decks, NOT `render.py`.
>    Consider a fingerprint test for the 11-slide Group IT Report.
> 6. **Slide 2 narrative columns** — ✅ DONE (commit after `2a57c29`): the
>    Operations Summary editor now has Progress / Issues / Activities
>    textareas (os-progress / os-issues / os-activities, persisted per month).
>    They override the slide-2 columns; blank = falls back to the AI commentary
>    (render.py `_section_bullets` reads `_os.<key>` first, then `commentary`).
>    Also verified live: slide-5 `categories_prev` (Jun-vs-May grouped bars)
>    + `monthly_channels` (channel line) populate from the browser payload.
> 7. **Deploy the cumulative commits** and confirm a fresh Analyze→Export in
>    each audience renders correctly end-to-end.
>
> ### Sync gotcha — closed Changes weren't re-synced after post-closure edits
>
> Diagnosed from a Major Incident (#289097) whose RCA/CA/PIR/LL showed RED
> (MISSING) on the live register although they were filled in Zoho. Findings:
> - **Major Incidents base rows**: the requests filter now **always upserts
>   every Major-Incident base row** (`_isMajorIncident`, ≈16 rows) so
>   status/resolution/priority stay fresh without trusting Last Updated Time.
> - **Major-Incident UDF (RCA/CA/PIR/LL) — real bug, fixed 2026-06-22**: the
>   register UDFs were sourced from a SEPARATE Zoho Analytics report
>   **view 790842**, which had gone STALE — the `POST /api/admin/refresh-major-incident-udfs`
>   diagnostic showed it returned only **12 rows with udfsExtracted=0** (the UDF
>   fields were re-created in SDP AFTER the report's columns were mapped, so it
>   returned them empty for recent incidents — e.g. #289097 showed RCA/CA/PIR/LL
>   red despite being filled in SDP). Meanwhile the base **REQUEST_TABLE view
>   002201 NOW returns all UDF columns** (203-col schema snapshot; a manual
>   Request export confirmed #289097's UDF filled there). **Fix**: source the MI
>   UDF straight from the base 002201 rows we already fetch (`extractUdf` over
>   `allRows.filter(_isMajorIncident)`), 790842 kept only as a fallback. Also
>   `extractUdf` now keeps **non-empty values only** (no 100-null bloat per
>   request; neither path can clobber good data with blanks). Needs deploy +
>   one requests sync to repopulate. **Diagnostic endpoint to reuse**:
>   `POST /api/admin/refresh-major-incident-udfs` returns rowsFetched /
>   udfsExtracted / dbUpdated / dbUnmatched. **Rule**: prefer sourcing UDF from
>   the table that actually owns the record over a separate Analytics report —
>   reports drift when custom fields are recreated.
> - **Changes had a real gap (fixed)**: the Zoho Change view exposes NO
>   "Last Updated Time" column (`EXPECTED_CHANGE_COLS`), so the old incremental
>   filter (new OR open OR recently-completed) NEVER re-pulled a change edited
>   AFTER it closed (RCA / Change Closure Code / UDF filled during the
>   post-implementation review — the normal workflow). Fix: **upsert ALL change
>   rows every sync** (`zoho-sync.js` change_cab) — the set is small (~hundreds),
>   so a full upsert is cheap and guarantees post-closure edits propagate.
>   **Rule**: a dataset with no modified-time signal can't be synced
>   incrementally on edits — either add a modified-time column or full-upsert it.

---

## ⚡ Prior state (as of 2026-06-05)

> **READ FIRST.** Branch `claude/busy-kirch-2a4176` is now **~273 commits
> ahead of origin** (still NOT pushed). Tip: `d86b382` (data evolution
> strategy doc). This session shipped **8 commits** across three
> tracks: (1) Activity Tracker drill-down + new PPTX slide 11b,
> (2) browser asset caching evolved from no-cache → tiered → canonical
> URL versioning pattern (webpack/vite style — zero RTT + zero stale
> for all modules), (3) two standalone reference docs for handing off
> data architecture + evolution planning to architects/future sessions.
>
> **Deployment status**: `_deploy.cmd` is staged with **6 prod-facing
> files** (server.js + CLAUDE.md + 4 client files from the tracker
> drill-down) covering commits `adfa33d`..`a340b74`. Two later commits
> (`be75f5e`, `d86b382`) are docs-only — they sit in `docs/` which is
> in the post-commit hook's `SKIP_PREFIXES`, so they're in git but NOT
> in the deploy script. User has NOT yet run `_deploy.cmd` — pending
> action.
>
> **Pending user actions after this session**:
>
> 1. Run `_deploy.cmd` from cmd.exe in the worktree → propagates 6
>    files to `Z:\`.
> 2. On the prod server: `pm2 reload endeavour-dashboard --update-env`.
>    The `--update-env` flag matters because nothing new env-wise was
>    added but the server.js + boot-cached HTMLs need a fresh start
>    to inject the new `APP_VERSION` at boot.
> 3. **Once on prod, every user (including Mohamed) needs ONE Ctrl+F5
>    on any dashboard page** to flush their existing browser cache. The
>    old HTML they have cached references unversioned asset URLs;
>    after Ctrl+F5 they receive the new HTML with `?v=<APP_VERSION>`
>    references and from that point onwards the cache pattern handles
>    everything automatically — NO future Ctrl+F5 needed, ever.
> 4. Verify in Chrome DevTools Network tab that `App.jsx` and
>    `dashboard-shared.js` arrive with `?v=...` in the URL and
>    `Cache-Control: public, max-age=31536000, immutable` in the
>    response headers.
>
> **User test result during the session**: Mohamed (super_admin)
> confirmed at the end of the session that everything works on his
> end with the URL-versioning change in place. The browser cache
> was confirmed as the root cause of his earlier "tracker inputs
> revert to null on refresh" report — a stale `App.jsx` running an
> outdated `D.inputs` schema. Fix is structural, not just patched.
>
> ### What landed (8 commits, chronological)
>
> | Commit | Subject | Files |
> |---|---|---|
> | `adfa33d` | feat(activity-tracker): drill-down per pillar / per site + PPTX slide 11b | 5 files (App.jsx, styles.css, reportPayload.js, render.py, CLAUDE.md) |
> | `34141a9` | fix(server): force conditional revalidation on .jsx + active-dev folders | server.js, CLAUDE.md |
> | `c81d62f` | fix(server): tiered cache policy — Tier A no-cache + Tier B 5-min cache | server.js, CLAUDE.md |
> | `429bcf6` | docs(claude.md): codify browser-side cache tier policy as coding principle | CLAUDE.md |
> | `0d1eabf` | docs(claude.md): fix stale line number in cache-policy verification tip | CLAUDE.md |
> | `a340b74` | feat(server): URL-versioned assets (?v=APP_VERSION) — zero RTT + zero stale | server.js, CLAUDE.md (replaces tier policy as primary; tier system kept as fallback) |
> | `be75f5e` | docs: standalone DATA_ARCHITECTURE.md reference for report builders | docs/DATA_ARCHITECTURE.md (1051 lines, NEW) |
> | `d86b382` | docs: data evolution strategy + migration difficulty matrix | docs/DATA_EVOLUTION_STRATEGY.md (491 lines, NEW) |
>
> ### Track 1 — Activity Tracker drill-down (commit `adfa33d`)
>
> Closes the user feedback "can we see progress other months per pillar
> of sites?". Single-surface design with PPTX echo — no duplicate
> dashboard, no new top-level tab.
>
> **Browser** — Dashboard tab now has clickable rows:
> - Click any **Pillar Health** row → inline 6-month fleet-average line
>   chart slides open below the row. Click again to collapse.
> - Click any **Site Leaderboard** row → inline 6-month per-site score
>   line chart slides open below the row.
> - Single open per panel; `▾`/`▴` indicator, hover affordance,
>   slide-in animation 220 ms.
> - Trend window = 6 months ending at the currently-selected period,
>   rolling back across year boundaries.
> - Computed client-side via `TR.ps2(D, site, pillar, y, m)` and
>   `TR.ss(D, site, y, m).avg` — NO extra API call.
>
> **Server payload** — `services/reportPayload.js _tracker()` returns
> a new `trends: { months, fleet[], pillars{name:[]}, sites{code:[]} }`
> block (6-month window). Pillar trend aggregates `{g,a,r}` counts
> across active sites per period and converts to a score at the end —
> faithful to the engine.js `ps2` rollup semantics at a single point
> in time. Sites with zero active activities for a period contribute
> `null` (skipped, not zeroed).
>
> **PPTX** — new **Slide 11b "Pillar Trends"** (conditional —
> only emitted when `K['tracker']['trends']` is populated; empty trends
> → slide skipped, deck stays coherent at 11 pages). 2×2 grid of mini
> matplotlib line charts (one per pillar) on 6.20" × 2.40" cards each,
> with RAG-threshold reference bands at 5% alpha, per-point %
> labels, stable pillar→colour map (Network blue · Biz Partner teal ·
> Risk purple · People orange), and an auto-synthesised "improving /
> declining / stable" commentary at the bottom (no AI dependency).
>
> ### Track 2 — Browser cache strategy (5 commits, evolved during the session)
>
> The session uncovered a long-latent bug pattern: Mohamed (super_admin)
> reported tracker Input values "disappearing on refresh". Root cause
> was a stale browser-cached `App.jsx` running a `D.inputs` shape that
> no longer matched the server's `loadTracker` contract → saves landed
> OK in the DB but under keys that no longer lined up with current
> activity ordering. Server log showed `[Tracker] save ok user=mohamed`
> with the correct user, but next load returned `null` for the cells
> the user thought they'd edited.
>
> The fix evolved across the session through user-driven Q&A:
>
> 1. **First attempt** (`34141a9`) — `.jsx` files + `/activity-tracker/`
>    served with `Cache-Control: no-cache, must-revalidate`. Solves
>    the bug but pays 1 RTT per asset per page load.
>
> 2. **Tiered policy** (`c81d62f`) — extended to include Tier B for
>    `/lib/` (5-min cache) and Tier C (default 1-day). User concern
>    was "does this break cache for the other sites?" — the tier
>    system preserves cache for Helpdesk / Reports / Executive / etc.
>
> 3. **Mohamed's clarifying question** drove a re-frame: "is it
>    possible to have a solution that doesn't interfere with cache
>    AT ALL, like other websites do?" — this triggered Path D, the
>    canonical URL versioning pattern.
>
> 4. **URL versioning** (`a340b74`) — the final, canonical solution:
>    - At server boot, compute `APP_VERSION = git rev-parse --short HEAD`
>      (fallback: `t<epoch-ms>`).
>    - `injectAssetVersion(html)` rewrites every local `<script src>`
>      and `<link href rel=stylesheet|preload|prefetch|modulepreload>`
>      to append `?v=<APP_VERSION>`. CDN URLs (Chart.js, React, Babel,
>      unpkg), data: URIs, hash anchors, and `<link rel=icon>` favicons
>      are skipped.
>    - `loadHtml()` runs `injectAssetVersion` at boot when caching
>      HTMLs in `_htmlCache`.
>    - `activity-tracker.html` + `help.html` moved out of
>      `express.static` into dedicated `sendHtmlPage` route handlers
>      so the injection applies (the path-scoped CSP override at
>      `server.js:182` still fires — matches by `req.path`).
>    - `express.static setHeaders`: if `req.query.v` is present →
>      serve with `Cache-Control: public, max-age=31536000, immutable`.
>      Otherwise the Tier A/B/C safety net kicks in as fallback.
>
>    Result: HTML is no-cache (always fresh), assets are cached
>    forever AND auto-invalidate on every deploy (URL changes).
>    Zero RTT for cached pages, zero stale risk, zero need for
>    Ctrl+F5 in normal use. Same approach webpack / vite / Next.js
>    use in production.
>
> **CLAUDE.md** — new top-level section `## Coding Principles —
> Browser-side asset caching` documents the pattern, the decision
> flow for adding new HTMLs or assets, what gets injected vs not,
> the anti-patterns to avoid, and verification recipes via Chrome
> DevTools. Look for `### When adding a new HTML page` for the
> step-by-step.
>
> ### Track 3 — Documentation (commits `be75f5e`, `d86b382`)
>
> Two standalone reference docs created at the end of the session,
> both excluded from `_deploy.cmd` (`docs/` prefix is in `SKIP_PREFIXES`).
>
> **`docs/DATA_ARCHITECTURE.md`** (1051 lines) — comprehensive schema
> reference for ALL 4 databases. Covers:
> - Every table with full `CREATE TABLE` definition, column types,
>   meanings, indices.
> - UDF field-name variants for Major Incidents (RCA / CA / PIR / LL).
> - Per-module `SITE_MAP` conversion tables (with the canonical trap:
>   Hounde is `MGO` in tracker, `HGO` in inspection, `HGO` in Risk
>   Register, but Kalana is `KLN` in tracker and `KGO` in inspection).
> - Cross-DB linkage map listing every soft FK with applicative
>   validation status.
> - Zoho external sources + field mappings.
> - 6 ready-to-copy SQL query patterns for typical reports
>   (SLA compliance with ITSM denominators, Major Incident UDFs via
>   `json_extract`, Change Success Rate, tracker fleet score,
>   inspection rollups, meetings escalations).
> - File-path quick reference and a list of "Things NOT to assume"
>   (NULL `impact`, stale subjects, inconsistent codes, denominator
>   doctrine).
> - Hand this to any new agent / contractor / engineer building a
>   report — they should be productive without reading source code.
>
> **`docs/DATA_EVOLUTION_STRATEGY.md`** (491 lines) — discussion draft
> for the IT Director / architect on where the 4-SQLite-DB shape will
> hit walls. Covers:
> - Quantitative audit of current state (sizes, growth projections,
>   concurrency reality).
> - 10 initial assumptions inferred from the code (single-host,
>   one-DB-per-module, inline base64 blobs, idempotent ALTER TABLE,
>   etc.).
> - 6 pressure points expected in next 2-3 years (Node `_rawCache`
>   OOM, inspection photos disk pressure, cross-DB join cost,
>   `request_records` partitioning, schema drift between modules,
>   no failover).
> - **Three evolution paths**:
>   - Path A — incremental SQLite (2-3 weeks, +5 years headroom)
>   - Path B — Postgres for hot data + SQLite for cold modules
>     (6-8 weeks)
>   - Path C — full Postgres unification (10-14 weeks)
> - Per-module migration difficulty matrix:
>   - tracker / RR aliases / group presets → 🟢 EASY (1-3 days each)
>   - meetings → 🟡 MEDIUM (5-7 days)
>   - inspection (because of photos) → 🟠 MEDIUM-HARD (7-10 days)
>   - reports.db auth → 🟡 MEDIUM (5-7 days, blocking — do FIRST)
>   - reports.db reports/KPIs → 🟡 MEDIUM (5-7 days)
>   - Zoho-synced data + hot read path → 🔴 HARD (15-20 days)
> - Recommended sequencing in 8 phases (each deployable independently)
>   + target architecture diagram + decision triggers + per-future-
>   module guidance (CMDB / KB / vendor SLAs / etc.).
> - **Recommendation**: Path A this quarter (mandatory), plan Path B
>   for next year, defer Path C until B is limiting.
> - Marked "discussion draft, NOT a commitment to ship anything" — the
>   decision belongs to the IT Director.
>
> ### Open items / suggestions for the next session
>
> 1. **Apply Path A quick-wins** (from `DATA_EVOLUTION_STRATEGY.md` §11):
>    - Add DB-size logging at boot (zero risk, instant value).
>    - Stop preloading `_rawCache` (highest immediate risk).
>    - Move inspection photos to filesystem blobs (~3 days work,
>      80% inspection.db size cut).
>    - Single canonical sites table (drop 4 duplicated `SITE_MAP` JS
>      maps).
> 2. **Push the branch to origin** — `git push -u origin claude/busy-kirch-2a4176`
>    once the deploy is verified working. Branch is now ~273 commits
>    ahead, never pushed. Code review on GitHub would benefit any
>    future architectural discussion.
> 3. **Phase 4 cleanup** (the only remaining task from earlier sessions
>    that's still flagged pending): delete old `/api/data/*` proxy code
>    that's superseded by the DB-backed `/api/exec/*` endpoints. Not
>    user-facing, just dead code in `server.js`.
> 4. **CLAUDE.md is becoming long** (~3000 lines now). Eventually
>    consider extracting the per-module deep-dives into separate files
>    under `docs/modules/` and keeping CLAUDE.md as a top-level index +
>    Current State + Known Pitfalls. Not urgent.

---

## ⚡ Prior state (as of 2026-06-04)

> Branch `claude/busy-kirch-2a4176` is now **~265 commits
> ahead of origin** (still NOT pushed). Tip: `61a0c18` (slide 7 CSAT —
> full payload mapping + dynamic NPS tile). This session was a 25-commit
> sweep of the **executive PPTX pipeline** (`📋 Group IT Report`) and
> related Group Presets + AI Analyze infrastructure. All 11 slides of
> the Group IT Report are now data-driven and free of April-template
> hardcoded text. Most user-facing fixes:
>
> 1. **Group Presets** moved from localStorage-only to DB-backed (new
>    `dashboard_preset_groups` table, separate scopes for tickets +
>    changes, modal-managed). CHANGES GRP dropdown rebuilt to match
>    TICKETS GRP shape (Ops · Apps · All · Clear toolbar + Configure
>    footer).
> 2. **AI Analyze button** re-activated (was disabled with 🔒). Output
>    flows into slide 2 IT Governance commentary. Auto-fallback to the
>    deterministic "Quick" engine when cloud AI is unreachable.
>    Audience selector (Executive CFO/CIO default · Operational · Technical)
>    persisted in localStorage. Wording neutralised — labels are just
>    "Analyze" and "Analyze (Quick)" instead of "(AI)" / "(Lite)".
> 3. **Major Incident priority + UDF** resolution made variant-tolerant
>    and shared across all 3 dashboards (executive-report, executive,
>    analytics). New shared helpers in `public/lib/dashboard-shared.js`.
>    Server-side `getMajorIncidentsHistory()` now ships a canonical
>    `P-Label` field that the browser trusts first.
> 4. **PPTX exec-pptx pipeline** — 11 slides, all data-driven now. No
>    more "Apr '26: 1,465 tickets... Hounde power outage..." hardcoded
>    text anywhere. Slides 4 charts wired (volume_trend + sla_trend).
>    Slide 5 pie → bar chart (label overlap fixed) + new 12-month
>    Email vs Web Form share inset. Slides 10/11 wired to the Activity
>    Tracker (`K['tracker']` snapshot). Slide 9 incidents reorganised
>    into 2-column grid to stop drifting off the bottom.
> 5. **FCR Rate tile dropped** from slide 3 — the metric is computed
>    from CSAT survey responses which rarely match the helpdesk filter,
>    so the tile was almost always misleadingly red (0%). Row 2 now
>    shows just FRT SLA + AVG RESOLUTION.
>
> Specific data-flow conventions worth keeping in mind for any future
> exec-pptx work:
>
> ### Major Incidents — strict "created in month" (2026-06-04)
>
> `services/reportPayload.js _majorIncidents()` SQL now filters
> strictly by `strftime('%Y-%m', created_time) = ?` (was `created_time
> = ? OR resolved_time = ?`). Mixing the two let prior-month carry-
> overs into the current month's deck (e.g. "Incident 3rd and 6th
> February 2026" resolved 2026-05-19 was showing in the May deck and
> inflating the P2 count from 3 → 4). The tile label says "Created in
> May" so the data must match the label. Browser-side `incMonth`
> filter in `executive-report.html` already used `created_time`, so
> the server, the browser, the dashboard, and the PPTX now all reconcile.
>
> ### `KEEP_SERVER_WHEN_BROWSER_IS_ZERO` pattern (2026-06-04)
>
> In `services/reportPayload.js` build(), some KPI fields where 0 from
> the browser is almost always a filter bug (not a real reading) keep
> the SERVER's value when browser sent 0. Set in
> `KEEP_SERVER_WHEN_BROWSER_IS_ZERO`:
>
>   total · closed · changes_total · open_backlog · mi_total ·
>   fcr_rate · support_groups
>
> Plus the nested `changes` block (`changes.total`, `changes.emergency`)
> follows the same rule per sub-field. CSAT block uses an explicit
> `_take(key, browserVal)` helper that applies the same logic for
> `csat_satisfied`/`neutral`/`dissatisfied`/`no_rating`/`total_responses`/
> `avg_score`/`pct`/`nps_proxy`.
>
> The trade-off: this masks a legitimately 0 reading (e.g. a month
> with truly zero major incidents). The opposite trade-off (browser
> always wins) was worse — users reporting "CHANGES = 0" on the PPTX
> because their CHANGES GRP filter was empty (per the seed in
> `services/groupPresets.js`) was the most-frequent complaint.
> Percentage KPIs (closure_rate, sla_compliance, etc.) trust the
> browser unconditionally because 0% IS a legitimate value worth
> reporting on a five-alarm-fire dashboard.
>
> ### MoM delta defaults: None, not 0 (2026-06-04)
>
> `tools/exec-pptx/render.py` `_DEFAULTS` dict now sets all `*_delta_*`
> fields to `None` instead of `0.0`. The render helpers (`_delta_str`,
> `_cover_delta`) format `None` as "— vs Apr" / "— MoM" instead of a
> misleading "0.0% vs Apr". Effect: when the browser doesn't compute
> a previous-period reading (most of the new MoM fields are placeholder
> `null` because they need a snapshot we don't preload), the deck reads
> honestly instead of inventing a "flat MoM".
>
> ### CSAT field-name convention (2026-06-04)
>
> The naming convention across the 3 layers is finally aligned:
>
> | Layer | Field names |
> |---|---|
> | Browser (`_buildExecPptxPayload`) | `csat:{satisfied, neutral, dissatisfied, no_rating, total_responses, avg_score, avg_rating, csat_pct, nps, promoters, passives, detractors}` |
> | Server (`services/reportPayload.js`) | maps to top-level `csat_satisfied`, `csat_neutral`, `csat_dissatisfied`, `csat_no_rating`, `csat_total_responses`, `csat_avg_score`, `csat_pct`, `nps_proxy` |
> | Render (`tools/exec-pptx/render.py`) | reads top-level `csat_*` keys |
>
> Browser ships both CSAT-style (4-5 / 3 / 1-2 = satisfied/neutral/
> dissatisfied) and NPS-style (9-10 / 7-8 / 0-6 = promoters/passives/
> detractors) breakdowns so render.py can fall through gracefully on
> tenants whose survey instrument only classifies one of the two.
> Avg score is `avgRating × 20` (5-scale → 100% expression).
>
> Slide 7 right tile is **NPS-first** when `nps_proxy ≠ 0`, falls back
> to AVG SCORE only when NPS truly absent. CSAT donut chart has a
> fallback path that derives sat/dis counts from `csat_pct ×
> total_responses` when explicit counts are zero — so the chart is
> never empty when there's a known percentage.
>
> ### Group Presets DB schema (2026-06-04)
>
> New table `dashboard_preset_groups` in reports.db (created lazily on
> first hit). Schema:
>
> ```sql
> CREATE TABLE dashboard_preset_groups (
>   scope         TEXT NOT NULL,        -- 'tickets' or 'changes'
>   preset_name   TEXT NOT NULL,        -- Operations/Application/Cybersecurity/ITSM/Other
>   group_name    TEXT NOT NULL,
>   display_order INTEGER DEFAULT 0,
>   updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
>   updated_by    TEXT,
>   PRIMARY KEY (scope, preset_name, group_name)
> );
> ```
>
> API at `/api/dashboard/presets?scope=tickets|changes` (GET public,
> PUT admin+). Auto-discovered groups (in `request_records.tech_group`
> or `change_records.group_name` last 12 months but not yet assigned)
> surface in the modal under "Pending Discovery" until an admin
> classifies them. Module: `services/groupPresets.js`.
>
> Configs are **separate per scope** by user direction — a preset
> called "Operations" under tickets is NOT shared with changes scope
> (different tech_group conventions on `request_records` vs
> `change_records`). Tickets scope seeds from the existing
> `dashboard-shared.js` defaults (12 site IT Agents in Operations +
> 9 app teams in Application). Changes scope seeds EMPTY — admin
> populates as discovered.
>
> ### Audience tone selector (2026-06-04)
>
> New `<select id="analyzeAudience">` next to the Analyze button.
> 3 options with default Executive (CFO/CIO):
>
> | Audience | Preamble injected into every prompt |
> |---|---|
> | Executive (CFO/CIO) | Lead with business outcome (uptime, cost avoidance, user-hours lost). Quantify in monetary or operational terms. Frame risks as strategic exposure. Plain English — no ITSM jargon (replace SLA/FRT/MTTR/RCA/PIR with "response time", "time to resolve", etc.). |
> | Operational (IT Mgr) | Full ITSM vocabulary. Correlate metrics across KPIs to identify root operational cause. Name specific groups/sites/categories. Recommend concrete process changes. |
> | Technical (Engineer) | Maximum specificity. Reference categories, sub-categories, sites, group names, ticket IDs, UDF fields by name. Suggest tooling or platform changes. |
>
> Persisted in `localStorage` under `analyze_audience_v1`. Applied to
> all 4 prompt builders (helpdesk, sla/changes/incidents, csat,
> governance) so the tone is uniform across the deck. Switching the
> audience and re-clicking Analyze regenerates every section in the new
> register.
>
> ### AI prompt grounding — anti-hallucination clause (2026-06-04)
>
> `buildPromptGovernance()` embeds a "NUMERIC GROUNDING — ABSOLUTE RULE"
> block:
>
> ```
> CANONICAL VALUES FOR <period> (these and ONLY these):
>   • Total tickets   : <h.total>
>   • Closed tickets  : <h.closed>    ← write "<h.closed>" not a rounded variant
>   • Closure rate    : <h.closureRate>%
>   ...
>
> PROHIBITED — examples:
>   ✘ "Closure rate 93.4%" when canonical is 93.1%
>   ✘ "1,240 of 1,327 tickets closed" when canonical is 1,236 of 1,327
>   ✘ "12 RFCs" when canonical is 0
>
> REQUIRED:
>   ✓ Copy values BYTE-FOR-BYTE from the canonical list.
>   ✓ If a bullet needs a number not in the list, REPHRASE to omit it.
>   ✓ "(canonical)" self-check rule — if you can't tag a number as
>     canonical without lying, do not use that number.
> ```
>
> Caught: the AI was hallucinating "Closure rate 93.4% (1,240 closed)"
> when actual was 93.1% / 1,236, and "12 RFCs" when changes_total was
> 0. The grounding doesn't prevent stale-snapshot hallucinations (where
> the user clicks Analyze, then changes filters, then exports) — that's
> a UX concern for a future "re-run on filter change" follow-up.
>
> ### "Apr '26" hardcoded text purge (2026-06-04)
>
> Every footer + delta label on slides 1, 3, 7, 8, 9 that used to
> embed an April reference is now data-driven from `K['month']` /
> `K['prev_month_short']`. Slide 2 IT Governance content is AI-
> generated (with the grounding clause above). Slides 4-6 footers were
> already mostly aligned but received the same treatment.
>
> Conventions used by `_delta_str()` + `_cover_delta()`:
> - Returns `('— vs <prev>', 'neutral')` when delta is `None`.
> - Signs the delta string (`+1.3pp` / `-0.2pp`) and decides
>   good/bad/neutral colour via XOR with `invert` flag (backlog,
>   incidents, MTTR all use `invert=True`).
> - `prev_month_short` comes from `services/reportPayload.js build()`
>   computing `MONTH_SHORT[monthIdx - 2]` (with year-wrap fallback to
>   `'Dec'`).
>
> ### Slide 9 incident grid — 2 columns × 3 rows (2026-06-04)
>
> Was 5 stacked cards of 1.10" → drifted into the y=6.55 footer band.
> Now 2 columns × max 3 rows. Card dimensions: 6.10" wide × 1.05"
> tall. Badge strip width 1.00" (was 1.50"). Lessons text truncated
> at 120 chars to fit. Layout origin (0.4, 3.20), row gap 0.05", col
> gap 0.15". Caps at 6 cards; sixth slot stays empty if fewer.
>
> ### Slides 10/11 — Activity Tracker integration (Phase 3.5 done)
>
> `services/reportPayload.js _tracker()` now returns:
>
> ```
> tracker = {
>   green, amber, red,              // fleet totals (active sites × current month)
>   avg_score, avg_delta_pp,        // fleet avg + MoM delta
>   sites: [{ code, name, color, score, delta_pp, g, a, r }],
>   pillars: {                       // weighted per-pillar RAG
>     "P1-Network Infrast": { green, amber, red, score, weight },
>     "P2-Business Partner": ..., "P3-Risk & Compliance": ..., "P4-Manage People": ...
>   },
>   commentary: []                   // placeholder for AI/manual notes
> }
> ```
>
> Slide 10 KPI strip (Fleet · Green · Amber · Red) + 2 charts (site
> leaderboard horizontal bar coloured by score, pillar RAG stacked
> bar sorted by weight). Slide 11 grid of up to 10 site cards (2 rows
> × 5 cols), each showing score + MoM delta + G/A/R counts. Both
> slides fall through to a graceful "tracker data unavailable" amber
> panel when `K['tracker'].sites` is empty.
>
> ### Activity Tracker drill-down — Dashboard + Slide 11b (2026-06-04)
>
> Closes the user feedback "can we see progress other months per
> pillar of sites?". Two complementary surfaces (no duplicate
> dashboards — feedback was clear we already have too many tabs).
>
> **Browser — inline drill-down on the Dashboard tab**:
>
> - Click any row in **Pillar Health** → an inline 6-month fleet-avg
>   trend chart slides open below the row. Click again to collapse.
> - Click any row in **Site Leaderboard** → an inline 6-month per-site
>   score trend chart slides open below the row. Click again to
>   collapse.
> - Single open at a time per panel (clicking another pillar swaps).
> - Hover affordances: light grey bg on row hover, `▾` indicator
>   flipped to `▴` when expanded, slide-in animation 220 ms.
> - Computed client-side via `TR.ps2(D, site, pillar, y, m)` and
>   `TR.ss(D, site, y, m).avg` — no extra API call.
> - Trend window = 6 months ending at the currently-selected period,
>   rolling back through year boundaries.
>
> **Server payload — `tracker.trends`** in `services/reportPayload.js`:
>
> ```
> tracker.trends = {
>   months : ['Dec 25', 'Jan 26', ..., 'May 26'],   // last 6 months ending at selected period
>   fleet  : [pct, pct, pct, pct, pct, pct],        // fleet score per month
>   pillars: { 'P1-Network Infrast': [pct,...], ... },  // per-pillar fleet avg
>   sites  : { 'HGO': [pct,...], 'MGO': [pct,...], ... }  // per-site score
> }
> ```
>
> The pillar-trend computation aggregates `{g, a, r}` counts across
> active sites per period and converts to a score at the end (faithful
> to how the engine.js `ps2` rollup works at a single point in time).
> Sites whose pillar has zero active activities for the period
> contribute null (skipped, not zeroed).
>
> **PPTX — new Slide 11b "Pillar Trends"**:
>
> Inserted between current Slide 11 (Site Summaries) and the
> save-to-stdout block. 2×2 grid of mini line charts (one per
> pillar) on a 6.20" × 2.40" card each:
>
> - Pillar name + latest-value RAG pill in the card header
> - Mini line chart 5.2"×2.0" rendered via matplotlib in `_chart()`
> - RAG threshold reference bands as low-alpha horizontal stripes
>   (red 0-55, amber 55-65, green 65-100) at 5% alpha so they read
>   as context, not noise
> - Per-point % labels above each marker
> - Stable pillar→colour map (`_PILLAR_COLORS` in render.py): Network
>   blue · Biz Partner teal · Risk purple · People orange
> - Defensive pillar ordering: canonical 4 first, then any extras
>   present in payload (so future pillar additions still render)
>
> Bottom commentary auto-synthesised: identifies "improving" /
> "declining" / "stable" pillars by comparing the latest value to
> the trailing 5-month average (±2 pp dead band). No AI dependency
> on this slide.
>
> Footer page number = 12. Slide is **conditional** — only emitted
> when `K['tracker']['trends']['months']` and `['pillars']` are both
> populated. Empty trends → slide skipped entirely, deck stays
> coherent at 11 pages.
>
> ---
>
> **Prior session's work** (Risk Register, Active Sessions, DB-backup
> infrastructure, the CIO/CFO + SharePoint presentation decks, design
> brief for Claude Designer) is unchanged on top of which this sits.

## ⚡ Prior state (as of 2026-06-01)

> Branch `claude/busy-kirch-2a4176` is now **~240 commits
> ahead of origin** (still NOT pushed). Tip: `5a5c07a` (Meetings import
> page bilingual EN/FR + FR guide). This session shipped the
> end-to-end **Meetings lookup management** — closes the gap between
> "an IT coordinator hands me an xlsx with a new code" and "the import
> accepts it". 5 commits across 4 files. Plus the original ask: a
> comprehensive **French step-by-step guide** for francophone field IT
> coordinators on the bulk-import page. Print-only stylesheet makes
> the FR guide PDF-friendly via Ctrl+P. Earlier session's work
> (Risk Register, Active Sessions, DB-backup infrastructure, the
> CIO/CFO + SharePoint presentation decks, design brief for Claude
> Designer) is unchanged on top of which this sits.

### What landed today

| Phase | Commit | What |
|---|---|---|
| 1+2+3 | `fb91f19` | Meetings lookup management end-to-end. New API (GET/PUT/PATCH on `/api/meetings/lookups/:table[/:code[/active]]`, super_admin only). New admin card "🗂 Meetings — Codes de référence" on `reports.html#admin`. Inline "+ Créer ce code" button on `meetings-import.html` preview when an unknown-code error appears (super_admin only). All three pieces tightly coupled around the same API surface. |
| 4 | `5a5c07a` | `meetings-import.html` bilingual EN/FR with localStorage-persisted toggle (15 inline pairs, 8+ block pairs). FR-only "📘 Guide complet" section with: ASCII diagram of the 3-sheet linkage, canonical reference format, Excel formula trick for batch reference generation, duplicate-reference suffix workaround, unknown-code workflow (3 branches by role), end-to-end recipe, cheat-sheet errors table, FAQ. |
| 5 | (in the same commit as 4) | Print stylesheet (`@media print`) on `meetings-import.html` — Ctrl+P with FR active produces a clean A4 portrait PDF containing only the guide (no app shell, no upload UI, no EN content). Coordinators print and email the PDF. |
| 6 | (this commit) | CLAUDE.md update + new "Meetings lookup management" + "Bilingual import page" sections below. |

### What the user sees now on `meetings-import.html`

```
┌────────────────────────────────────────────────────────────[EN|FR]─┐
│ Insights · Réunions · Import en masse                              │
│ Importer des PV historiques                                        │
│ Téléversez un classeur Excel à 3 onglets (Meetings, Issues,        │
│ Actions) pour importer des PV départementaux en une seule…         │
├────────────────────────────────────────────────────────────────────┤
│ [Step 1 — Télécharger]   │ [Preview · rien n'est encore saved]     │
│ [Step 2 — Remplir       │   • KPIs: Réunions / Issues / Actions    │
│   • règle d'or sur la    │   • erreur row 7: Unknown intake_source │
│     reference]           │     "business_incubation" [+Créer code] │
│ [Step 3 — Téléverser]    │ [Step 4 — Valider l'import]             │
├────────────────────────────────────────────────────────────────────┤
│ 📘 Guide complet — FR-only (mécanisme de liaison, pièges, FAQ)     │
│   Section autonome de ~600 lignes pour les coordinateurs IT FR     │
└────────────────────────────────────────────────────────────────────┘
```

Click **+ Créer ce code** (super_admin only) → modal pré-remplie →
POST → re-run preview → erreur disparaît. Boucle fermée.

Ctrl+P avec toggle FR actif → PDF clean A4 portrait avec uniquement
le guide. Email aux coordinateurs.

### Meetings lookup management — full architecture

**API** (all super_admin only, except GET /api/meetings/lookups which is form-facing):

| Method · Path | Purpose |
|---|---|
| `GET /api/meetings/lookups` | Active-only — drives every dropdown in the form |
| `GET /api/meetings/lookups/:table` | Admin view — includes soft-deleted rows |
| `POST /api/meetings/lookups/:table` | Add a new code. Refuses duplicate (use PUT to update). |
| `PUT /api/meetings/lookups/:table/:code` | Partial patch — name_en/fr, display_order, active, plus table-specific extras (color, icon, descriptions). `code` itself is the PK and is NOT editable through this route. |
| `PATCH /api/meetings/lookups/:table/:code/active` | Convenience toggle — body `{active: 0|1}`. Soft delete; old PVs keep their original code labels. |

**meetings-db.js** functions:
- `addLookupRow(table, row)` — strict: refuses duplicate code (avoids the silent INSERT-OR-REPLACE clobber on display_order/active)
- `listLookupTable(table, {includeInactive})` — admin view of one table
- `updateLookupRow(table, code, patch)` — partial UPDATE, uses `PRAGMA table_info` to drop client keys that don't apply to the target table (so the same modal works for all 11 lookups despite their column-set differences)

**Admin card** on `reports.html#admin` — `🗂 Meetings — Codes de référence` — super_admin only. Dropdown picks which of the 9 admin-extensible lookups to manage (it_involvement + engagements stay locked as system concepts). Table shows code/EN/FR/order/active with Edit + Toggle buttons. Edit/Add modal in French (the audience is mostly francophone admins).

**Preview enrichment** on `meetings-import.html` — when a `_coerceCode` error of the form `Unknown <field> "<code>". Allowed: ...` reaches the browser, a "+ Créer ce code" button is injected next to the error (super_admin only — gated client-side via `window.__userHasRole('super_admin')` AND server-side at the route). Click → small modal pre-filled with code + Title-Case-suggested names → POST → auto-rerun of preview → error vanishes.

`FIELD_TO_TABLE` map (top of the meetings-import.html IIFE — KEEP IN SYNC with `meetings-import.js` `_coerceCode` callsites):

```
site_code         → null (sites NOT extensible from here; managed elsewhere)
department        → md_departments
intake_source     → md_intake_sources
meeting_status    → md_meeting_statuses
status            → md_statuses
category          → md_categories
severity          → md_severities
escalation_reason → md_escalation_reasons
council_theme    → md_council_themes
```

### Bilingual EN/FR pattern (replicable across the dashboard)

The meetings-import.html implementation is the canonical pattern for any future page that needs an EN/FR toggle. Reusable as-is:

**Toggle button** — top-right of the hero, persisted to localStorage:

```html
<div class="mim-lang-toggle" id="mimLangToggle">
  <button data-lang="en" class="active">EN</button>
  <button data-lang="fr">FR</button>
</div>
```

**Inline text pairs** for one-line content:

```html
<span data-lng="en">English text</span>
<span data-lng="fr">Texte français</span>
```

**Block-level content** (paragraphs, list items, sections):

```html
<p data-lng-block="en">English paragraph.</p>
<p data-lng-block="fr">Paragraphe en français.</p>
```

**FR-only content** (no EN twin needed — e.g. the import guide):

```html
<div data-lng-block="fr"> ... whole FR-only section ... </div>
```

**CSS** — body.lang-fr toggles visibility:

```css
[data-lng="fr"]       { display: none; }     /* EN is default */
[data-lng-block="fr"] { display: none; }
body.lang-fr [data-lng="en"]       { display: none; }
body.lang-fr [data-lng-block="en"] { display: none; }
body.lang-fr [data-lng="fr"]       { display: inline; }
body.lang-fr [data-lng-block="fr"] { display: block; }
```

**Programmatic strings** through a `T(key, args)` helper backed by an `I18N` table — used for messages we emit at runtime (banners, KPI labels, button labels in dynamically-rendered HTML, confirm prompts).

**Print stylesheet** in the same page — `@media print` hides the app chrome, hides EN content when FR is active, keeps the guide section page-break-friendly. Result: `Ctrl+P` produces a clean A4 PDF.

### Lessons / patterns to NOT re-discover (this session)

| Trap | What we learned |
|---|---|
| **`INSERT OR REPLACE` silently clobbers columns absent from the patch** | The pre-existing `addLookupRow` (and its underlying `_seedTable`) used `INSERT OR REPLACE`. Calling it twice with `{code:'survey', name_en:'IT Survey'}` (no name_fr/display_order/active) would reset name_fr to NULL, display_order to 0, active to 1 — even though the admin only wanted to fix the EN label. Fix: refuse duplicates in `addLookupRow` (forces admin to use the PUT/PATCH path which is partial-update aware) and use `PRAGMA table_info` to discover per-table editable columns. **Rule**: any "upsert" helper that uses INSERT OR REPLACE on a wide schema is a footgun for partial patches. Either use INSERT … ON CONFLICT DO UPDATE with explicit column lists, or separate add (strict) from update (partial). |
| **Form-facing GET vs admin-facing GET differ by `active=1` filter** | `GET /api/meetings/lookups` (used by every dropdown in the form) hides soft-deleted rows via `WHERE active = 1` inside `loadLookups()`. The admin card needs to SEE soft-deleted rows so it can re-activate them. **Fix**: separate route `GET /api/meetings/lookups/:table` with `includeInactive: true`. **Rule**: when adding admin tooling to manage a lookup, decide upfront whether the admin view shows the same rows as the form view or a superset. They almost always differ. |
| **Same-named span pairs across <head> CSS and <body> markup produce false-positive count mismatches** | Counting `data-lng="en"` vs `data-lng="fr"` via grep included matches inside CSS selectors (`[data-lng="fr"] { display: none; }`) and inside HTML comments (`<span data-lng="en"> / <span data-lng="fr">`). The "imbalance" was just CSS being correctly written (EN is the default so only FR needs `display: none` overrides). **Rule**: when sanity-checking i18n pair counts, filter the grep to body-content only, OR just visually pair the actual UI spans in source order. The "off by N" warning is meaningless without context. |
| **Inline `esc` helper named identically to the global escaper** | `_openTicketDrillModal` in `index.html` defined a local `esc` that only handled null/undefined coercion, then used it as if it were the project's HTML escaper. Same trap as the security review caught — a local `esc` that's NOT actually escaping creates false safety in code review. **Rule**: when adding a small inline helper, NEVER name it `esc` if the codebase already has a global `escapeHTML`/`esc` with HTML safety semantics. Use `_orDash`, `_strOrEmpty`, `_nullCoerce`, anything but the conflicting name. |
| **Post-commit hook regenerates _deploy.cmd from git diff — manual edits don't persist across commits** | The hook builds `_deploy.cmd` from `git diff --name-only <last-deployed>..HEAD`, so any manual exclusion (e.g. presentation artefacts) gets overwritten on the next commit. **Workaround**: edit `_deploy.cmd` AGAIN after each commit until the user actually runs it (which advances `.git/last-deployed` past the offending files). **Better long-term**: extend the hook to read a per-repo skip-list (`.deployignore`) — same syntax as `.gitignore`. **Defer**: low priority while the only excluded files are the two presentation artefacts that will eventually move out of the worktree anyway. |

---

## ⚡ Prior state (as of 2026-05-30)

> **READ FIRST.** Branch `claude/busy-kirch-2a4176` is now **~235 commits
> ahead of origin** (still NOT pushed). Tip: `3197c30` (move Risk Register
> admin UI into reports.html#admin card). Two big things landed this
> session: (1) the **Risk Register monthly Occurrence export** —
> entire new feature wiring up SDP incident data to the operations
> risk register; (2) the **DocuSign communication reel** was
> extracted out of the dashboard repo into a standalone folder, since
> it was internal-comms content masquerading as a dashboard feature.
> Also: `better-sqlite3` upgraded 9.6.0 → 12.10.0 (Node 24 prebuild),
> `exceljs` install attempted then reverted in favour of the
> already-installed `xlsx` for security, and the post-commit deploy
> hook now propagates file deletions to prod via `del` commands.
> Prior 2026-05-24 work (Activity Tracker rebuild, save model
> switches, nav consolidation) is unchanged on top of which this sits.

### What landed in the Risk Register Occurrence export

| Stage | Commit | What |
|---|---|---|
| Initial impl | `fe595fd` | Whole-feature: classifier (5 domains, 16 cat/sub rules), SQLite reader, exceljs writer, `/api/risk-register-export` endpoint, button in `index.html` |
| Impact scope filter | `b3955b6` | Added `impact` column to `request_records` + idempotent ALTER + zoho-sync mapping. Filter to operational scope (Enterprise / Single dept / Multiple dept) |
| Auth fix | `b815ab6` | Export fetch was missing `X-Dash-Key` header → 401 from the global API gate |
| Security rewrite | `1779deb` | **exceljs → xlsx (SheetJS CE)** to avoid 80 new transitive deps + 4 npm-audit findings. Same .xlsx output, plainer styling (CE drops cell fill colors) |
| Dep cleanup | `f65d909` | `_uninstall_exceljs_prod.cmd` to remove the 80 dead packages from prod |
| Native binding fix | `6a0855b` | better-sqlite3 9.6.0 → 12.10.0 after `npm uninstall --ignore-scripts` removed the .node binary. v12 ships Node 24 prebuilts. `_recover_better_sqlite3_prod.cmd` ships the same recovery for prod |
| Site name mapping | `3bde6eb` | SDP uses full mine names (`HOUNDE`); spec wants codes (`HGO`). Added SITE_ALIASES map. Also relaxed NULL impact (91% of historical rows are NULL) |
| Admin UI | `a182d51` → `3197c30` | First built as standalone page, then refactored into a 4th card on `reports.html#admin` per user's mental model. SQLite-backed `rr_site_aliases` table; super_admin only |

### DocuSign reel — extracted to standalone folder

Originally drafted under `public/docusign-comms.html` + `docusign-pptx.js` + `public/brand/goldy/*.png` + `public/brand/banners/*.png`. User correctly flagged: this is **internal communication content for TV signage + email distribution**, not a dashboard feature. It shouldn't live in the helpdesk repo.

Moved (commit `db7594b`) to `C:\Users\Admin\Documents\EDV-DocuSign-Comms\` with its own `README.md`, `package.json`, `node_modules\pptxgenjs\`, asset folder. Self-contained — no server, no auth, copy folder to a USB stick → open `index.html` in any browser. Hidden keyboard shortcuts: `Space` next, `←` prev, `F11` fullscreen, `P` play/pause. PPTX still buildable via `node generate-pptx.js`.

Files removed from the dashboard repo (deployment script's new deletion handling propagated these to prod's `Z:\`):
- `public/docusign-comms.html`
- `docusign-pptx.js`
- `public/brand/goldy/*.png` (6 files)
- `public/brand/banners/*.png` (2 files)

### Deploy hook — now handles deletions

The post-commit hook (`.git/hooks/post-commit`) previously used `git diff --diff-filter=ACMR` which dropped Deletions, so removed files orphaned on prod's `Z:\` forever. Fixed: hook now runs a parallel `--diff-filter=D` pass and emits `if exist "Z:\path" ( del /F /Q "Z:\path" )` blocks. Idempotent (skips files already gone). See "Lessons / patterns" below for the rationale.

### Active Sessions admin card (added 2026-05-30 evening, commit `cc64695`)

Small Tier-2 observability feature requested after the Risk Register
work. Backed by a new `sessions.last_seen` column that
`validateSession()` bumps on every authenticated request (~50µs per
call on warm WAL DB).

| Capability | Where | Who |
|---|---|---|
| See who's online | `reports.html#admin` → 🟢 Active Sessions card | admin+ |
| Choose idle window | Dropdown: 1 min / 5 min / 15 min / 1 h / 24 h | admin+ |
| Force-logout a user | ⛔ Force logout button per row | super_admin only |
| Auto-refresh every 30 s | Only fires when admin tab is active + browser tab visible | — |

Schema delta: `ALTER TABLE sessions ADD COLUMN last_seen TEXT` (idempotent).
Backwards-compatible — `COALESCE(s.last_seen, s.created_at)` everywhere
so existing sessions don't disappear from the view before they get
their first bump.

API:
- `GET /api/reports/sessions/active?idle_minutes=N` — admin+
- `DELETE /api/reports/sessions/:token` — super_admin only, server-side
  rejects attempts to kill your own session.

### Late-session inspection + dictation work (2026-05-31, commits `3693c6d` + `b440ebf`)

Two field-user-impacting bugs surfaced from the inspections team after
the Risk Register / Active Sessions work. Both turned out to be older
than tonight's session — they just got reported now.

**Bug 1 — voice dictation duplicating whole sentences**

The 2026-05-23 fix tried to keep continuous-mode dictation working
across natural pauses with a 3-buffer system + auto-restart in
`r.onend` + auto-language fallback (EN ↔ FR swap). The cross-session
boundary commit still produced duplicate sentences on some Chrome
network conditions. Per user direction, **reverted to the simplest
possible push-to-talk model** (commit `3693c6d`):

| Old (continuous mode) | New (push-to-talk) |
|---|---|
| `r.continuous = true` | `r.continuous = false` |
| 3 buffers: initial / committed / current | None — append directly |
| `r.onend` auto-restarts | `r.onend` just stops |
| Auto-language swap on first failure | Hard-set `r.lang = dictLang` (user picks EN / FR via header toggle) |
| Idempotent rebuild from `e.results[0..]` | Canonical pattern from `e.resultIndex` |

Trade-off: longer paragraphs need multiple taps. Inspectors preferred
this over the duplicate-words bug. The EN/FR toggle at the top of
`inspection.html` is the SOLE language-selection mechanism — no
auto-detect — which gives the browser the right speech model upfront
for much better accuracy than auto-fallback.

**Bug 2 — "inspection data disappeared after clearing browser cache"**

Field user reported: filled an inspection, submitted, could see all
data on re-open. Cleared browser cache + re-logged. Re-opened the same
inspection from the dashboard → data was gone.

It wasn't actually gone. The dashboard's "Open" link navigates to
`inspection.html?id=EM-IT-20260531-7591`, but **init() completely
ignored the `?id=` URL parameter** — it only read `localStorage`. With
localStorage empty after the cache clear, it fell through to
`newInspection()` and created a brand-new empty inspection
(`EM-IT-20260531-1991`) with a fresh ID. The original 7591 was sitting
safely on the server the whole time; the form just never asked for it.

Fix (commit `b440ebf`):

1. `init()` now reads `?id=` from `URLSearchParams` FIRST, falls back
   to `localStorage` KEY_CURRENT, then to `newInspection()`.
2. Added `window.fetchInspectionFromServer(id)` helper exposed from
   the IIFE — thin wrapper around `GET /api/inspection/:id` returning
   the state blob or null. Never throws.
3. When local cache misses, init() calls the server, hydrates `state`,
   mirrors to localStorage + index, and shows "✓ Loaded from server"
   toast. If the server also returns nothing, starts fresh with a
   "Inspection not found" toast.

The canonical load-priority chain for any deep-linkable form:
**URL ?param → localStorage → server → fresh**.

### Activity Tracker year management (where to delete a year)

Per the 2026-05-24 Phase 6.5 work, the toolbar's `+ Year` button was
moved out of the top bar into the `Tracker Setup` tab's
`1 · Years` section. To **delete a year** (e.g. someone added 2027
prematurely and you need to remove it without touching 2026 data):

1. Open Activity Tracker → **Tracker Setup** tab (top bar)
2. Section **`1 · Years`** at the top — list of years with a small
   delete button per row
3. Clicking delete shows a confirm modal listing cascade impact
   (number of `tracker_inputs` rows for that year that will be wiped)
4. Confirm → year is removed from `tracker_config.years` AND
   `tracker_inputs` rows for that year are deleted server-side
5. The selector at the top updates immediately; previously-selected
   year falls back to the most recent remaining year

Schema reminder: `tracker_inputs.year` is part of the composite PK
`(year, site, activity_ix)` — deleting year N has NO effect on rows
for year M. The years array in `tracker_config` is just a list of
"years the UI should show in the dropdown"; the inputs table is
keyed by year, so 2026 data is isolated from 2027 data by design.

### Lessons / patterns to NOT re-discover (Risk Register + this session)

| Trap | What we learned |
|---|---|
| **`npm uninstall <pkg> --ignore-scripts` can delete OTHER packages' native bindings** | Even though `--ignore-scripts` blocks REBUILDS, npm's package-tree reconciliation pass deletes files it considers extraneous. Removed `better_sqlite3.node` from both dev and prod after `npm uninstall exceljs --ignore-scripts` ran. **Rule**: BACK UP `node_modules/better-sqlite3/` before any npm install/uninstall on prod, even with --ignore-scripts. Recovery is `_recover_better_sqlite3_prod.cmd`. |
| **`prebuild-install` fails through corporate proxy with "unable to get local issuer certificate"** | The proxy does SSL inspection; Node's bundled CA doesn't trust the corporate root cert. The fallback `node-gyp rebuild --release` then fails because prod has C++17 build tools, not C++20. **Per-process bypass**: `set NODE_TLS_REJECT_UNAUTHORIZED=0` + `npm install --strict-ssl=false`. Do NOT persist in `npm config` — that's a global security weakening. |
| **`npm rebuild <pkg>` skips the prebuild download** | `rebuild` runs `node-gyp rebuild` directly, bypassing `prebuild-install`. **Rule**: to fetch a missing prebuild, `rm -rf node_modules/<pkg> && npm install <pkg>` — the `install` lifecycle script tries prebuild FIRST, then source. |
| **`<` inside `node -e "..."` from cmd.exe is parsed as stdin redirect** | cmd.exe ends quote-mode at the inner `\"`, then sees the bare `<` as a redirect operator. Symptom: "The system cannot find the file specified" with no Node stack trace. **Fix**: write the script to a `.js` file (`node script.js`) or rewrite SQL to use `BETWEEN ... AND ...` instead of `<`. |
| **SDP `site` column carries full mine names, NOT short codes** | The Risk Register, Activity Tracker, and Inspection module each have their own code conventions. The helpdesk `request_records.site` is the most authoritative source for what SDP actually populates — `HOUNDE`, `MANA`, `Sabodala`, `LAFIGUE`, `Ouagadougou`, mixed-case, with one-off labels like `LAFIGUE - SML`. **Don't assume the codes line up with any other module's list.** Use a `*_aliases` lookup. |
| **`impact` column in `request_records` is 91% NULL on historical rows** | The Impact field was added to SDP recently. ~228 of 251 May 2026 incidents carry NULL impact — they predate the field. Strict `VALID_IMPACTS` filtering shows zero everywhere; report becomes useless. **Decision shipped**: treat NULL as in-scope (likely operational, just unannotated), explicitly EXCLUDE only `Individual`. Diagnostics surface `classified_with_null_impact` so the operator knows how much of the count is impact-uncertain. As Zoho's data catches up, this number will shrink naturally. |
| **SheetJS CE drops cell fill colors / borders / fonts on write** | Pro-only feature. **What CE DOES preserve on write**: column widths (`!cols`), row heights (`!rows`), date number formats (cell.z), cell values. **What CE DROPS silently**: fill colors, borders, fonts, freeze panes (`!views`). For the Risk Register, the spec's colored header bands and row banding are lost; data is fully correct. If you ever need the styling: either use a template (`XLSX.read` an pre-styled file, repopulate the data cells, `XLSX.write` — round-trip preserves more), or accept Plain Format. |
| **Standalone HTML pages vs `reports.html#admin` cards — pick the integration pattern early** | Built the Risk Register admin as a standalone page first (`public/risk-register-admin.html`), then re-built it as a 4th card on `reports.html#admin` per user feedback. The card pattern matches the existing User / Sites / Departments cards, reuses `.modal-overlay.open` + `toast()` + `esc()` + `.user-table` styles, and keeps the nav simple (flat "Admin" link, not a dropdown). **Rule**: if it's an admin function, default to a new card on `reports.html#admin` unless there's a specific reason to surface it separately. |
| **`x-dash-key` is REQUIRED for every `/api/*` call from a browser tab** | The global gate at `server.js:946` (`app.use('/api/', ...)`) rejects requests without either `X-Dash-Key` or a valid `x-report-token`. `index.html` uses `pgGet()` which injects this. Naked `fetch('/api/something')` from new code → 401. **Rule**: when adding a new API call, copy the auth header pattern from `pgGet` or the inline pattern at `public/index.html:396`. |

### Activity Tracker rebuild (Phases 2–6) — from 2026-05-24 session

(retained — see below)

## ⚡ Prior state (as of 2026-05-24)

> **READ FIRST.** Branch `claude/busy-kirch-2a4176` is now **~96 commits
> ahead of origin** (still NOT pushed). Tip: `a4d9ed3` (soften RAG red
> on tracker roadmap/leaderboard, drop "NEW" badge). The Activity
> Tracker was rebuilt end-to-end this session to match the
> dashboard-preview design while keeping the calculation engine
> identical, the Inspection save model was switched from auto-debounce
> to manual ("Save now"/Submit), the primary nav was consolidated
> (Reports + Insights dropdowns), and a few small UX polish items
> landed (branded delete modal, softer RAG red). Yesterday's work
> (meetings v2, inspection diagnostics, voice fix — see 2026-05-23
> entry below) is unchanged on top of which this sits.

### What landed in the Activity Tracker rebuild (Phases 2–6)

| Phase | Commit | What |
|---|---|---|
| 2  | `1a19a16` | React shell + Dashboard tab, on `/api/tracker/load`. Legacy at `/activity-tracker-legacy.html` |
| 3  | `23d903a` | Scoring + Input + Heatmap tabs. Input gets debounced auto-save (800 ms) + explicit Save button |
| 3.5| `a1709f9` | Dashboard hierarchy rewritten to match preview — hero (Overall + Trend) + Pillar Health + Site Leaderboard, charts reduced from 6 → 4 |
| —  | `fa00c7a` | Site Leaderboard score bars: switched from `<span>` (didn't render) to `<div>`; RAG-coloured (55/65 thresholds) instead of site brand colour |
| 4  | `fa7c9b6` | Tracker Setup tab + RedistributeModal (proportional/equal/custom) |
| —  | `fcfc32f` | Add-pillar / add-activity / delete cascade warnings |
| —  | `259b0e1` | Site activate / deactivate confirm modal (direction-aware copy) |
| 5  | `dd18a6f` | Targets + Roadmap panels (12-month Gantt by pillar) |
| —  | `8f5206e` | Smart default month (last month with data) + two-line Roadmap (period vs today) |
| —  | `80216c6` | + Year button in toolbar (with confirm modal) |
| 6  | `5c26d61` | PPTX export modal + CLAUDE.md update |
| 6.5| `6736df6` | **+ Year moved out of toolbar** into Tracker Setup tab (new "1 · Years" section); section renumbering 2-4; drive-by fix of an `onExport` prop destructure missed in Phase 6 |

### Nav reorganization — Reports + Insights consolidation

Top-level menu cleaned up. Old: 5 top-level items (Helpdesk, Reports,
Insights ▾, Inspections, Deck Builder) + Admin + Help. New: 3 functional
top-level items (Helpdesk, Reports ▾, Insights ▾) + Admin + Help.

```
Helpdesk · Reports ▾ · Insights ▾ · Admin · Help
            │            └ Inspections, Activity Tracker,
            │              Meetings Decisions, Analytics,
            │              Executive Scorecard
            └ Site Reports, Deck Builder
```

Changes in `_shell.js`:
- **Reports becomes a parent** with two children: `site-reports`
  (reports.html, any) + `reports-builder` (executive-report.html,
  report-author / super_admin / executive). Parent click smart-lands on
  Site Reports.
- **Inspections moved INTO Insights** as the first child (id `inspections`).
  Top-level Inspections entry removed. Capture is still one click away
  via the "+ New inspection" button on the dashboard.
- **Insights children reordered**: any-role items first (Inspections,
  Tracker, Meetings) so site-IT users clicking the parent smart-land on
  Inspections. Admin- / executive-gated items (Analytics, Scorecard) last.
- **Single-child dropdowns collapse to a flat link** in `renderNavItem`:
  if a user has access to only one child of a parent (typical: viewer
  sees only Site Reports under Reports), the parent renders as a plain
  link instead of a one-item dropdown with caret.

Pages whose mount `data-section` / `data-current` had to be updated:
- `inspection.html` + `inspections.html`: `section=performance current=inspections`
- `executive-report.html`: `section=reports current=reports-builder`
- `reports.html`: `section=reports current=site-reports`

Verified per-role rendering with a throwaway harness (loaded `_shell.js`
with stubbed window/document and walked `window.__shell.NAV` per role) —
all 6 role variants render the expected shape.

### Inspection save model — switched to Local + Save now + Submit

After three rounds of bug-fixing (window.state scoping → 413 → empty
draft pollution) the field user asked: *"autosave should be local and
only appear on server when submitted?"*. We confirmed the trade-off
and switched to:

| Action | Local | Server |
|---|---|---|
| Keystroke | ✓ | ✗ |
| **Save now** button | ✓ | ✓ |
| **Submit** | ✓ | ✓ |
| **Re-open** (admin+) | ✓ | ✓ |

Patched `saveCurrent` in `public/inspection.html` no longer schedules
a debounced server POST — it just runs the local autosave and updates
the toolbar with a "click Save now to sync" hint. `forceSyncNow()`
remains the single path to the server (Save now button + the
auto-chained sync from Submit / Re-open). The `_stateIsMeaningful`
gate and `_promotedIds` Set are retained to drive the toolbar hint
text but no longer block any POST. Full details in §"Save model"
inside the Inspection module section below.

### Analyze Lite — deterministic stop-gap (no AI, no network call)

While cloud AI analysis is paused pending IT approval for the on-prem
Mistral Nemo deployment, a deterministic templating engine
(`public/analyze-lite.js`) fills the same commentary fields the AI
path used to fill. **Nothing leaves the browser** — pure JavaScript,
zero network calls, instant.

```
Browser executive-report.html / executive.html
  ├─ 🔒 Analyze (paused)   ← cloud-AI button, disabled
  └─ ⚡ Analyze (lite)     ← new, calls window.AnalyzeLite.run*Lite()
       ├─ reads buildAiSnapshot() (or _baseData / _rawRows)
       ├─ classifies each KPI vs threshold (same thresholds the AI used)
       ├─ picks worst site / worst category / trend direction
       └─ writes into f-exec, f-helpdesk, f-sla, f-change, f-incidents,
          f-csat (executive-report.html) or f-obs, f-risks, f-actions,
          f-change, f-incidents, f-outlook (executive.html)
```

**Field strategy** — fact-first, narrative-poor:

| AI strength | Lite equivalent |
|---|---|
| Classify KPI vs target | Identical — same threshold table (slaComp ≥90, frtComp ≥90, reopenRate <5, fcrRate ≥75, csat ≥80, nps ≥30, emergency <5%, etc.) |
| Worst category by volume / SLA | Identical — sort the parsed category breakdown |
| Worst site by FRT SLA | Identical — sort the parsed site summary |
| 12-month trend direction | Identical — last value vs trailing-6m average (`_trendDir`) |
| Backlog blocker categories + sample subjects | Renders the pre-computed strings verbatim with a "manual triage required" note |
| Major incident per-row (RCA / CA / Lessons / PIR / downtime) | Renders `s.incidents.lines` verbatim — that string already came from the snapshot |
| Narrative prose, cross-KPI causal speculation, inferred-from-subjects analysis | **Not attempted** — Lite is honest about its limits |

**Visual cue** for Lite-generated fields: thin amber left border
(`border-left: 3px solid #d97706`) so the analyst can see at a glance
which fields came from templates vs the user's own edits.

**Bilingual EN / FR** — detected from `<html lang>`. Full string table
in `STR.en` / `STR.fr` inside `analyze-lite.js`. Both languages are
first-class; pick by changing the document `lang` attribute or a
fallback default constant in the file.

**Files touched**:

| File | Purpose |
|---|---|
| `public/analyze-lite.js` | The engine (~470 lines). Exposes `window.AnalyzeLite.runReportLite()` + `runExecutiveLite()`. |
| `public/executive-report.html` | Loads the script in `<head>`. Two `⚡ Analyze (lite)` buttons: one in top action row, one in bottom action bar (next to each paused 🔒 AI button). |
| `public/executive.html` | Loads the script in `<head>`. One `⚡ Analyze All (lite)` button next to the paused 🔒 AI button. |

**Re-enable cloud / local AI flow** when Mistral lands:

1. Remove the `disabled` attribute + `style="opacity:.55..."` from the 🔒 buttons (3 places: 2 in executive-report.html, 1 in executive.html).
2. Optionally hide the `⚡ Analyze (lite)` button (or keep it as a "factual rerun" alternative — both can coexist).
3. Restore button labels from "🔒 Analyze (paused)" → "✨ Analyze & Save".
4. Update `actionStatus` text on executive-report.html if desired.
5. Set `AI_PROVIDER=local` in prod `.env` and `pm2 reload --update-env`.

**Known limits / future improvements**:

- `_parseCategoryLines` and `_parseSiteLines` parse the formatted
  strings buildAiSnapshot produces. If that function's output format
  ever changes, the parsers need to keep pace. Pin format if drift
  becomes an issue.
- `executive.html` Lite is intentionally lighter than the AI version
  (which has 4 separate sub-analyses: Monthly Summary, Staff Scorecard,
  Change & Incidents, Customer Voice). Lite fills the 6 visible fields
  with templated commentary using `_baseData` / `_rawRows`; staff
  scorecard sub-analysis is not attempted (would require
  technician-level row scans).
- CSAT recommendation copy is a fixed three-state lookup (both OK /
  CSAT OK only / both below). For more nuance, add intermediate
  states or feed the actual rating distribution.

### AI analyze — local Ollama provider (on-prem privacy switch)

`/api/ai/analyze` (server.js around line 2825) now has a provider switch
controlled by the `AI_PROVIDER` env var. Set `AI_PROVIDER=local` and
restart pm2 — every "Analyze & Save" click stays on the network. ITSM
data (ticket subjects, root causes, customer voice, incident lessons-
learned) no longer leaves the corporate LAN.

The browser is unaware. `executive-report.html` still POSTs an
Anthropic-shape body — the server translates it into an
OpenAI-compatible chat-completions request, talks to local Ollama, and
re-wraps the response back into the Anthropic envelope. Same client
code, same response handling, no deploy on the HTML side.

**Env vars** (`.env` on the prod host):

| Key | Default | Purpose |
|---|---|---|
| `AI_PROVIDER` | `anthropic` | `anthropic` (cloud) or `local` (Ollama / LM Studio / llama.cpp / any OpenAI-compatible chat-completions server) |
| `LOCAL_LLM_URL` | `http://localhost:11434/v1/chat/completions` | Ollama default. LM Studio uses `:1234/v1/...`, llama.cpp `:8080/v1/...` |
| `LOCAL_LLM_MODEL` | `mistral-nemo:12b-instruct-2407-q4_K_M` | The tag you pulled via `ollama pull`. Default is Mistral Nemo (France/EU, Apache 2.0, native French). |
| `LOCAL_LLM_TIMEOUT` | `240000` (4 min) | CPU inference can take 1-2 min for a long prompt. Raise if it's hitting 504. |
| `ANTHROPIC_API_KEY` | — | Only required when `AI_PROVIDER=anthropic`. Safe to remove from `.env` once fully on local. |

**Model choice rationale**: Mistral Nemo 12B Instruct (default) is picked
over Qwen2.5 14B for two non-trivial reasons:

1. **EU sovereignty** — Mistral AI is a French company headquartered in
   Paris. ITSM data on Endeavour's network (ticket subjects, root cause
   text, customer voice) stays under the same legal regime as the ops
   that generated it. Avoids Chinese supply-chain concerns that come
   with Alibaba's Qwen family.
2. **Native French quality** — Mistral's training mix is heavily
   European, so French analytical commentary reads native (matters for
   Endeavour's Francophone West African sites: Mana, Houndé, Ity,
   Kalana, Lafigué, Tanda, Dakar, Ouaga).

Trade-off: Mistral Nemo is ~7 GB Q4 vs Qwen's ~10 GB, so it's also
faster on CPU. Quality on multi-KPI reasoning (Prompt 2) is roughly on
par. JSON-mode reliability via `format:'json'` is excellent on both.

**Setup checklist (Windows Server, CPU only, Mistral Nemo 12B):**

1. Install Ollama: download the `.msi` from `https://ollama.com/download/windows` — runs as a Windows service on `localhost:11434`.
2. Pull the model: `ollama pull mistral-nemo:12b-instruct-2407-q4_K_M` (≈7 GB download, ~7 GB RAM in use).
3. Add to `.env`: `AI_PROVIDER=local` (LOCAL_LLM_URL + LOCAL_LLM_MODEL default to the right values).
4. `pm2 reload endeavour-dashboard --update-env`. The `--update-env` flag is required for new env vars.
5. Test: open `executive-report.html`, pick a month, click "✨ Analyze & Save". Expect ~45 s – 75 s per prompt on CPU (three prompts = 2-4 min total).

**Alternative models** if Mistral Nemo doesn't fit your constraints:

| Model | When to pick it | `ollama pull` tag |
|---|---|---|
| `llama3.1:8b` | US-only policy preference, RAM tight, want ~50 s/prompt | `llama3.1:8b-instruct-q4_K_M` |
| `gemma2:9b` | Google ecosystem preference | `gemma2:9b-instruct-q4_K_M` |
| `phi3.5:3.8b` | Very limited RAM (~3 GB), can tolerate weaker reasoning | `phi3.5:latest` |
| `mistral-small:24b` | More RAM available (~14 GB), better quality, **research-only license** | `mistral-small:24b-instruct-2409-q4_K_M` |
| `qwen2.5:14b` | OK with Chinese-origin (Alibaba, Apache 2.0), want max Q4 reasoning | `qwen2.5:14b` |

To swap: `ollama pull <tag>` then set `LOCAL_LLM_MODEL=<tag>` in `.env` and `pm2 reload --update-env`. No code change.

**Translation quirks the server handles transparently:**

- **System prompt placement**: Anthropic uses a top-level `system` field; OpenAI puts a `{role:'system', content:...}` message at the start of the array. `_aiCallLocal` prepends the system message accordingly.
- **Assistant pre-fill trick**: Prompt 1 in the client sends `{role:'assistant', content:'{'}` as the last message — an Anthropic-only feature where the model continues the partial assistant content. OpenAI-compatible servers don't reliably support this. Server-side we (a) strip the pre-fill from the request, (b) force JSON-mode (`format:'json'` + `response_format:{type:'json_object'}`) which guarantees `{...}` output, and (c) strip the leading `{` from the model's response when the client used the trick, so the client's `text = lastMsg.content + text` reconstruction still parses as valid JSON.
- **Temperature**: forced to `0.2` for the local path. Smaller models drift more — tighter temp keeps the analyst tone + structured output stable.
- **Diagnostic errors**: `ECONNREFUSED` → "Is Ollama running? (try: ollama serve)". `ETIMEDOUT` → suggests bumping `LOCAL_LLM_TIMEOUT`. Surfaces in the toolbar status, not just the console.

**Why Mistral Nemo 12B is the default** (see the "Model choice rationale" section above): EU origin + Apache 2.0 + native French + lighter than Qwen 14B + faster CPU inference. Quality is close enough to Qwen on this analyst workload that the sovereignty + speed wins outweigh the few % quality delta on the hardest multi-KPI prompt. If GPU lands later, `mistral-small:24b` (Mistral Small 2409) or `llama3.3:70b` close the gap to Haiku — same env-only swap. Avoid Chinese-origin models (`qwen2.5:*`, `deepseek-*`, `glm-*`, `yi-*`) by policy.

**Fallback policy (today: none)**: when `AI_PROVIDER=local`, failures DO NOT fall back to Anthropic — the privacy guarantee is absolute. If the analyst sees "Local LLM not reachable", the Ollama service is down and the operator fixes it (or temporarily flips `AI_PROVIDER=anthropic` for the duration). A "local with cloud fallback" mode is a 10-line addition if ever needed.

### Inspection delete — branded confirmation modal (`9bd7d56`)

Replaced the native browser `confirm()` dialog with a styled modal in
both `inspection.html` (toolbar 🗑 button) and `inspections.html`
(per-row Delete on the dashboard). Status-aware copy: deleting a
submitted / closed inspection shows a sterner red warning than a
plain draft.

- `inspection.html`: new `#deleteModal` mirroring the existing
  `#submitModal` pattern (same `.modal-backdrop` / `.modal-sheet`
  classes). `deleteInspection()` now opens the modal; the actual
  server DELETE + local cleanup moved into `confirmDelete()`.
- `inspections.html`: new `.del-modal-*` styles + `#delModal` markup
  + per-row Delete handler opens the modal instead of calling
  `confirm()`. Backdrop click, Cancel button, and Escape all dismiss.
  Cancel + backdrop dismiss wired in JS (not inline `onclick`) because
  the script is inside an IIFE — inline handlers can't see IIFE-local
  functions.
- Defensive fallback: if the modal markup is somehow missing at
  runtime, both paths fall back to native `confirm()` rather than
  silently dropping the delete action.

### RAG red softened on tracker roadmap + leaderboard (`a4d9ed3`)

Field-user feedback on the Roadmap page: the brand `#D90038`
(`--edv-red`) reads as a wall of red when many activities are
failing — the full-width 12-month bars compound at full saturation
and visually drown out the amber/green/grey signal.

Switched to `#DC2626` (Tailwind red-600) in three places inside the
activity tracker module:
- `.rm-bar--red` (roadmap bars)
- `.dash-lb__bar-fill--red` (Site Leaderboard score bars on Dashboard)
- inline legend text in the Roadmap hero (`color: '#D90038'` → `'#DC2626'`)

This is the same shade `.hm-cell--red` already used (heatmap), and the
same shade the dashboard charts already used for their "Red (Off
Track)" series — so every red in the activity tracker module is now
**internally consistent on `#DC2626`**.

The brand `--edv-red` / `#D90038` is **untouched everywhere else**
(KPI tile accents, pills, borders, inspection danger, meetings high-
severity, etc.) — at small-accent sizes it reads as colour, not
volume. The override is scoped to the dense-RAG visuals where it
matters.

Also drove a tiny housekeeping change in the same commit: dropped
the `NEW` badge from the Roadmap tab — it shipped weeks ago and
isn't new anymore.

### Architecture in one diagram

```
Browser:
  /activity-tracker.html              entry point (~60 lines, CSP-exempt)
   ├─ _tokens.css / _shell.css        brand surface + production header
   ├─ auth.js                         sets window.__authUser + __userHasRole
   ├─ _shell.js                       renders the navy header
   ├─ Chart.js (CDN)                  dashboard charts
   ├─ activity-tracker/engine.js      scoring engine — pure functions on window.TR
   ├─ activity-tracker/api.js         /api/tracker/* fetch wrappers on window.TRApi
   ├─ React + ReactDOM + Babel (CDN)  same pattern as /dashboard-preview/
   └─ activity-tracker/App.jsx        ~120 KB, all 7 panels + modals
        + activity-tracker/styles.css ~40 KB, brand-token-driven

  (activity-tracker-legacy.html — deleted 2026-09-05; no fallback page remains)

Server (unchanged):
  /api/tracker/{load,save,export,reset}   identical contract pre/post rebuild
  tracker-db.js → tracker.db (SQLite)
  tracker-pptx.js → fixComboChartAxes()
```

### Lessons / patterns to NOT re-discover (Activity Tracker)

| Trap | What we learned |
|---|---|
| **Inline `<span>` for percentage bars** | `<span class="lb__bar"><span class="bar-fill" style="width:69%"/></span>` renders nothing — `width` / `height` don't apply to inline elements. The pillar bars worked because they used `<div>`. **Fix**: use `<div>` for any progress-bar wrapper + fill, OR add `display: block`. Caught on the Site Leaderboard during Phase 3.5 QA. |
| **D mutated in place needs a tick** | React state is the `D` object. Children mutate it in place via `engine.si2()` etc. Without a counter `setMutationCounter(c => c + 1)` to flip on every mutation, React doesn't see the change and the auto-save effect never fires. The `mutationCounter` lives in App state alongside `dirty`. |
| **Two modal scopes coexist** | One `modal` state in SetupPanel (for redistribute / per-pillar confirms — handlers close over per-pillar state) + one `appModal` state in App (for the toolbar's +Year). They share the same `<Modal>` component. Single user = one modal visible at a time, no conflict. |
| **Default month vs server's `currentMonth`** | The server-stored `currentMonth` defaults to 3 (March) from `tracker-init.json`. Users landing on the page saw stale anchoring. Fix: `lastMonthWithData(D, year)` scans `D.inputs[year][site][ix]` arrays for the rightmost non-zero month; boot uses that as the default S.month. |
| **Roadmap line meaning ambiguity** | A single vertical line on a 12-month Gantt is ambiguous — selected period? today? Fix: render two lines (solid orange = S.month, dashed grey = calendar today) with inline legend pills in the hero. The today line is suppressed when it coincides with S.month (which is the common case thanks to the smart default). |
| **CSP for JSX-at-runtime pages** | The new tracker uses React + Babel via CDN (in-browser JSX transform = needs 'unsafe-eval'). server.js has a path-scoped CSP override at `app.use((req, res, next) => ...)` that grants `unsafe-eval` + unpkg.com only on `/activity-tracker.html`, `/activity-tracker/*`, `/dashboard-preview/*`, `/design-system/*`. The production CSP on every other live page is untouched. |
| **Brand red `#D90038` is too heavy for full-width RAG bars** | Brand `--edv-red` (`#D90038`) is high-saturation pure red. Tiny accent uses (pills, borders, KPI strips) read as "colour"; full-width filled bars (Roadmap rows, leaderboard score bars) read as a wall of red and drown out amber/green/grey signal when many activities are failing. **Fix 2026-05-24** (`a4d9ed3`): override to `#DC2626` (Tailwind red-600) scoped to `.rm-bar--red`, `.dash-lb__bar-fill--red`, and the Roadmap legend text. Same shade `.hm-cell--red` and the dashboard charts already used, so the whole tracker module is now internally consistent on `#DC2626`. The brand red stays the canonical token for everything else. Rule of thumb for future RAG visuals: if the red surface is >100 px wide and filled, prefer `#DC2626`; if it's a small accent, use the brand token. |
| **Single-child dropdowns look broken** | When a user has access to only ONE visible child of a parent nav item (typical: a viewer sees only Site Reports under Reports, not Deck Builder), a dropdown with one item + redundant caret reads as a UI bug. **Fix** (`206860f`): `renderNavItem` in `_shell.js` collapses a single-visible-child parent to a flat link pointing straight to that child. Hover state, active state, and `data-section` matching all still work; the caret just disappears. Applies dynamically per user — same NAV literal renders differently per role. |

---

## ⚡ Prior state (as of 2026-05-23)

> **READ FIRST.** Branch `claude/busy-kirch-2a4176` is now **~37 commits
> ahead of origin** (still NOT pushed). Tip: `211ccbd` (voice dictation
> duplicate-words fix). Two huge feature waves shipped today:
>
> 1. **Meetings & Council Escalations module v2** — full rewrite of the
>    earlier v1 (which was never deployed). Meeting-centric digital twin
>    of the Endeavour Mining Group IT × Mines operating system. Plus
>    bulk Excel import for historical PVs and a "since last meeting"
>    pre-brief diff view for the IT coordinator.
> 2. **Inspection module hardening** — 2 new checklist categories
>    (Servers + Datastores), visible server-sync diagnostics in the
>    form toolbar, and a fix for the voice-dictation duplicate-words
>    bug a field user reported.
>
> Prior 2026-05-16 and 2026-05-12 handoffs are preserved further down.

### What landed today

| Area | What | Commit |
|---|---|---|
| Meetings v2 schema + API | 11 bilingual lookups, 6 core tables, 14 API routes, defensive children contract, two-sided cross-site write guard | `b4848d4` |
| Meetings v2 list + editor | `meetings.html` + 7-section PV editor (`meeting.html`) + audit thread + quick-comment box + 5 Engagements local snapshot | `a439831` |
| Meetings v2 companion views | `meetings-issues.html` (flat log), `meetings-council.html` (theme-grouped escalations), `meetings-compliance.html` (5 Engagements monitor) + nav + CLAUDE.md | `4e37ccb` |
| Bulk Excel import | `meetings-import.js` (xlsx-based) + 3 routes (template / preview / commit) + `meetings-import.html` UI + xlsx dep | `e8cf5bc` |
| "Since last meeting" diff | `compareDepartment()` in `meetings-db.js` + `/api/meetings/progress` + `meetings-progress.html` + deep-link from `meeting.html` sticky bar | `e8cf5bc` |
| Label fix + self-healing migration pattern | "InfoTech Survey" → "IT Survey" on the live row via idempotent UPDATE in `_initSchema` | `4a38a92` |
| Inspection save diagnostics | Toolbar shows server-sync state ("✓ Saved (local + server HH:MM)" vs "✓ Saved locally · ⚠ Server queued") + toast on POST failure + `__inspectionSync.lastServerError` + server-side `[Inspection] save ok …` log | `05ddc4f` |
| Inspection: Servers + Datastores categories | Two new checklist categories (`srv` + `sto`, 12 items each, bilingual) inserted between `net` and `rack`. **15 → 17 categories.** | `05ddc4f` |
| Voice dictation duplicate-words fix | Web Speech API idempotency — rebuilt transcript-buffer logic so duplicate `isFinal` emissions (Chrome bug on flaky networks) collapse instead of doubling | `211ccbd` |

### Lessons / patterns to NOT re-discover

| Trap we hit today | What we learned |
|---|---|
| **`npm install xlsx` on prod FAILS** (Visual Studio C++20 error in better-sqlite3) | better-sqlite3 9.4.3 has no prebuilt for Node 24 and node-gyp falls back to source compile which needs C++20. Prod VS Build Tools default to C++17. Same problem on the dev box. **Workaround**: xcopy `node_modules/xlsx/` directly from dev → `Z:\node_modules\xlsx\` — xlsx is pure JS, no native bindings, ~7 MB. No npm involved. Followup: upgrade better-sqlite3 to ^11 (has Node 24 prebuilds) as a separate change. |
| **Editing seed JSON doesn't fix already-seeded rows** | The first-run seed gate in every `*-db.js` (`if (n === 0) _seedLookups(db)`) means re-running on an existing DB is a no-op. To rename / fix a live row, add a one-time **idempotent UPDATE** below the seed gate. Only touches rows that still carry the old value; logs once on the affected reload; no-op forever after. Same file safe to ship indefinitely. Example: see the `survey` rename block in `meetings-db.js:_initSchema()`. |
| **Web Speech API duplicate-emits** (push-to-talk repeated words) | Chrome's `webkitSpeechRecognition` can emit the same `isFinal=true` chunk twice on flaky networks. The classic `_recBaseText += finals` accumulator doubles the transcript. **Fix**: track three buffers (initial / committed-from-prior-sessions / current-session) and **rebuild current-session from scratch on every onresult event** — duplicate emits collapse to the same value. Cross-session boundary handled in `r.onend` before re-issuing `r.start()`. |
| **Form looked like it was saving but wasn't** | Toolbar's "✓ Saved" only reflected localStorage save, not the server POST result. Patched debounced `saveCurrent` to surface server-sync state separately ("server-ok" / "server-fail" CSS classes + toast on first failure of a streak). Also added a server-side audit log: `pm2 logs endeavour-dashboard --lines 200 --nostream \| findstr Inspection`. |
| **Two sources of truth for inspection categories** | The form has an inline `CATEGORIES` const (line 1454 of `inspection.html`), AND `inspection-init.json` seeds the DB's `_findItemDef()`. **Both must be edited together** or findings save fine but reports/PPTX lose item text. (No DB migration needed — `_findItemDef` reads from the JSON at module load time.) |

### Deployment paths used today

| Asset | How it deploys |
|---|---|
| `.js`, `.html`, `.json`, `.css` in worktree | `_deploy.cmd` (auto-staged on commit) → `xcopy /Y` over the SMB share `Z:\` |
| New `node_modules/<pkg>/` (pure JS only) | Manual one-liner: `xcopy "<worktree>\node_modules\<pkg>" "Z:\node_modules\<pkg>\" /E /Y /I` — bypasses npm so better-sqlite3's native binding stays intact |
| Native-binding deps | Don't try from dev — risk nuking better-sqlite3 on prod. Schedule a maintenance window + upgrade better-sqlite3 first. |

### Open / future items (carried forward)

- **Push to origin**: branch is ~37 commits ahead, never pushed. `git push -u origin claude/busy-kirch-2a4176` when ready for review.
- **CH-273 Phase B** — still pending PKI wildcard cert. See prior state below.
- **Goldy mascot assets + Franklin Gothic WOFF2** — still pending from EDV brand team (see 2026-05-12 handoff).
- **better-sqlite3 ^11 upgrade** — would let `npm install` work cleanly on Node 24. Single-package change, modest behaviour risk; do it in a dedicated maintenance window.
- **Zoho Survey API integration** — user confirmed the IT Survey is done with Zoho Survey. Future: a `/api/meetings/sync/survey` route that auto-pulls responses into draft issues under `intake_source = 'survey'`. Needs the Zoho Survey scope added to the existing OAuth refresh token + a sample response payload to design the question→field mapping.
- **Pre-existing Zoho Desk schema warnings** (`requests/Request — MISSING columns: Request ID`, `survey/Results — MISSING columns: Survey Name`, `ViewSchemaCheck: Invalid URL`) — unrelated to today's work, flagged by the user as low-priority.

---

## ⚡ Prior state (as of 2026-05-16)

> Today's session added the **IT Inspection module** end-to-end (form
> + dashboard + API + PPTX + nav). The 2026-05-23 work above LANDED ON
> TOP of this state; the 2026-05-12 handoff below is older still.

### Inspection module — what landed on 2026-05-16

| Area | What | Status |
|---|---|---|
| Schema + seed | `inspection-init.json` (10 sites · 26 areas · 6 types · 15 categories · 149 items — **expanded to 17 categories · 173 items on 2026-05-23**) | ✅ |
| DB layer | `inspection-db.js` — SQLite (`inspection.db`), CRUD + aggregate + cross-site write guard | ✅ Smoke-tested |
| API routes | `/api/inspection/{lookups,list,aggregate,:id,save,export,aggregate/export,reset}` in `server.js` | ✅ Wired |
| Form page | `public/inspection.html` — port of `IT_Inspection_SDP.html` + brand tokens + CSP nonce + offline-queue server-sync | ✅ |
| Dashboard | `public/inspections.html` — KPI tiles + filters + monthly trend bars + table | ✅ |
| Nav | "Inspections" entry added to Performance ▾ in `_shell.js`; `clipboard-check` / `camera` / `mic` icons added to `brand/icons.js` | ✅ |
| PPTX | `inspection-pptx.js` — 4-slide single deck + 4-slide aggregate, 13.33"×7.5" canvas | ✅ Smoke-tested |

See the §"IT Inspection Module" section further down for architecture,
schema, API contract, and known pitfalls.

---

## ⚡ Prior state (as of 2026-05-12)

> Brand-system merge + executive page audit shipped on this date. Two open items
> below remain across sessions.

### Branch you should be on

`claude/busy-kirch-2a4176` — the main working branch. **30 commits ahead of
origin** (not yet pushed). Latest commit is `b6e2145` (brand handoff doc).
The merge commit for today's work is `9882318`.

### What landed today (already on `claude/busy-kirch-2a4176`)

| Area | What | Status | Reference |
|---|---|---|---|
| **HTTPS migration (CH-273)** | IIS reverse-proxy + `https://itops-dashboard.edv-ops.com` cutover | ✅ Live with placeholder cert; awaiting wildcard `*.edv-ops.com` from PKI | `docs/CHANGE_REQUEST_HTTPS_LOGIN.md` + `docs/ROLLOUT_BACKOUT_CHECKLIST.md` |
| **Brand design system Phase 1** | Tokens (CSS + JS), icon library, login hero, Goldy infrastructure, nav SVG icons | ✅ Merged via `9882318` | `docs/BRAND_HANDOFF.md` — read this FIRST when extending the brand work |
| **Emoji → SVG icon migration** | ~30 buttons / headings across index, reports, executive, executive-report, activity-tracker, analytics | ✅ Done for high-visibility surfaces; keep ✓ ✕ ⚠ ✏ 🟢🟡🔴 😊😟 as text (BMP / functional) | `public/brand/icons.js` library + `BRAND_HANDOFF.md` policy section |
| **Executive page audit fixes** | Phantom groups removed (CAB / Dakar / IT Agents); ITY + Kalana added to site filter; `avgResolveDays` aligned with AP (Math.floor per ticket on all paths); `isResOverdue` + `xRows` hoisted to `dashboard-shared.js` | ✅ Merged | Commits `6052eab` + `37c2b28` |
| **executive-report.html drift fix** | Local `isResOverdue` was missing `'confirm resolution'` variant — same ticket counted as a violation on this page but not others. Now consumes shared lib. | ✅ Merged | Commit `37c2b28` |
| **`executive.html` Chart.js race** | `<script ... defer>` removed; inline script at line 2608 called `Chart.defaults.*` at parse time | ✅ Fixed (commit `feffa00`) | — |
| **Activity Tracker tab icon sizing** | Raw SVG inserted without wrapper → browser stretched to ~60 px. Fix: emit `width="1em" height="1em"` directly on the `<svg>`. | ✅ Fixed (commit `70bdf14`) | — |

### Operational notes from 2026-05-12 (post-merge)

- **Node heap raised to 4 GB on prod** to stop the recurring 2 GB OOM crash that
  surfaced after the merge deploy (caused stuck "Connecting to data proxy…" splash).
  PM2 now starts with `--node-args="--max-old-space-size=4096"`. See the OOM row
  in Known Pitfalls for the re-apply command if PM2 ever gets reset.
- **Underlying memory leak is a separate ticket** — heap ceiling is a band-aid;
  Node still trends upward over hours. Suspects: `_rawCache` retention,
  `syncRequestData()` not releasing the 51 700-row Zoho fetch, or `stripPiiColumns`
  regexing huge arrays. Worth a heap-snapshot diff session.

### What's still open (carry to next session)

1. **CH-273 Phase B — pending PKI wildcard cert delivery**
   - Currently dashboard is reachable at `https://itops-dashboard.edv-ops.com`
     with a placeholder cert (red "Not secure" banner). The wildcard
     `*.edv-ops.com` is in flight with PKI.
   - When the `.pfx` arrives: IIS Manager → Server Certificates → Import →
     bind to the IT-Dashboard site (replaces placeholder). 2-minute job.
   - **After cert binding**, run Phase B (BIND_HOST=127.0.0.1 + firewall
     rule + sign-off email to Cezar + Alexis). Full runbook at
     `docs/ROLLOUT_BACKOUT_CHECKLIST.md` §3.
   - Open question: confirm corporate domain suffix is **`edv-ops.com`**
     (already used in all docs; awaiting final PKI confirmation).

2. **Goldy mascot assets + Franklin Gothic WOFF2** — pending from EDV brand team
   - Drop 5 PNGs into `public/brand/goldy/` (named per the README) and the
     login hero / empty-states light up automatically.
   - Drop licenced Franklin Gothic WOFF2 into `public/brand/fonts/` and add
     `@font-face` in `_tokens.css`. Until then Libre Franklin (Google
     Fonts) substitutes — ~95 % visual match.

3. **Phase 2 of brand rollout** (deferred deliberately)
   - Per-PPTX-slide migration from legacy `C.*` palette to brand `EDV.*`.
     Visual change to deliverables — needs per-slide design review.
   - `docs/BRAND_HANDOFF.md` §"What's NOT in Phase 1" lists all deferred items.

### Branches preserved but not merged

- **`perf/index-windowed-load`** (`1a9930c`) — windowed-load optimisation
  of `/api/data/requests-raw`. Reverted in the working branch because
  wall-clock improvement didn't materialise; row count dropped ~50 % but
  TTFB barely moved. **Real bottleneck is server-side `JSON.stringify` on
  the warm cache, not payload size.** Available for revisiting:
  pre-stringify common window slices once during sync and serve the bytes
  directly. **Do NOT re-propose the row-windowing approach without first
  measuring `res.json()` time on the server.** Branch preserved for
  reference.

- **`brand/design-system-phase-1`** — the feature branch merged into
  `claude/busy-kirch-2a4176` as commit `9882318`. Already-merged; safe to
  delete with `git branch -d brand/design-system-phase-1`.

### Deployment status

`_deploy.cmd` is staged with **26 files** since the last successful deploy.
Run it from the dev laptop when ready to push everything to `Z:\`. Then on
prod: `pm2 reload endeavour-dashboard --update-env`. (All HTML files in
`_htmlCache` require a reload to refresh.)

The repo is **not pushed to origin**. `git push` when ready.

### Key reference docs in `docs/`

| Doc | Read when |
|---|---|
| `BRAND_HANDOFF.md` | Touching any visual layer / icons / tokens / typography |
| `CHANGE_REQUEST_HTTPS_LOGIN.md` | Anything related to CH-273 / cert binding / Phase B |
| `ROLLOUT_BACKOUT_CHECKLIST.md` | Executing Phase B or rolling back |
| `INTERNAL_TLS_SETUP.md` | IIS / cert / appcmd issues |

---
