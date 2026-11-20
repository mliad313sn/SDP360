# SDP360 — Adoption review: every screen, every profile

> **AI review — not a usability test with real users.** Everything below was observed by an AI agent driving
> Chromium (Playwright) on a **throwaway PostgreSQL database with synthetic data only** (e2e seed + `tools/demo/seed-demo.js`
> DEMO organisation + the D-10 synthetic helpdesk week). No production data, no real person, no outbound send.
> Scores, value moments and backlog are **proposals**. They must be confirmed — or contradicted — by the human
> sessions of `docs/ops/USABILITY-TEST-PROTOCOL.md` (first-click, SUS, think-aloud, French at 390 px) with real
> coordinators, technicians, PMO, finance and executives before anything is ranked for delivery.

Repository state reviewed: throwaway clone of `/home/user/SDP360` at `637124c` (spec baseline commit). Nothing in
`/home/user/SDP360` was edited.

---

## Résumé exécutif (FR)

1. **La valeur existe, mais elle est cachée derrière les réglages par défaut.** Avec les interrupteurs par défaut,
   **12 profils sur 15 atterrissent sur le tableau Helpdesk** (`index.html`, tous sites, 13 filtres) et la direction
   comme le super_admin atterrissent sur `executive.html`, une page masquée du menu, en anglais, restée sur « Loading… »
   sans source Zoho. Le meilleur écran de l'application — « Mon travail » (`home.html`) — n'est la page d'accueil de
   personne.
2. **Le français n'est pas la langue par défaut des pages.** L'enveloppe (menu, recherche) est traduite, mais sans
   l'interrupteur `ui_i18n_pages`, **43 pages sur 61 restent en anglais** pour un utilisateur francophone ; avec
   l'interrupteur, 41/61 passent en français et ~20 restent en anglais (réunions, inspections, studio de rapports,
   intégrations, journaux…). Le titre `<html lang>` reste `en` sur ces pages (lecteurs d'écran).
3. **Plusieurs profils tombent dans des impasses.** Le PMO (comité) et la plupart des comptes voient « Suivi d'activité »
   dans le menu puis un message brut anglais « Forbidden » ; l'auditeur (audit-viewer sans site) voit **0 réunion /
   0 PV signé** alors qu'un PV existe ; le comité KPI n'a **aucune entrée de menu** vers son outil (`kpi-builder.html`) ;
   l'utilisateur métier n'a pas accès à l'aide.
4. **Des « 0 » et du vert affichés sur des données jamais lues.** Parc jamais synchronisé → « $0.00 » en vert ;
   suivi d'activité sans aucune saisie → sites « ROUGE 14–28 % » qui déclenchent des alertes ; « 0 incident majeur »
   à côté de « Source jamais synchronisée ». Cela contredit la règle maison « inconnu ≠ 0 » et détruit la confiance.
5. **Trois semaines différentes affichées le même jour** (accueil W45, sélecteur de rapport W44, helpdesk W46) :
   risque réel qu'un coordinateur remplisse la mauvaise semaine.
6. **Les interrupteurs « dark » apportent la plus grosse partie de la valeur ressentie** (accueil par rôle, file de
   travail, pages en français, page qualité des données gardée, application terrain en page d'arrivée) mais en
   ajoutent aussi de la confusion : bouton « Retour » (= *Feedback*) lu comme « revenir en arrière », portefeuille
   « Mes projets » vide sous des tuiles qui comptent tout, cartes « Disponible · 0 élément(s) » répétées.
7. **Recommandation** : 3 lots — (A) corrections évidentes livrées actives (textes, impasses, 0/inconnu, semaine) ;
   (B) parcours par profil derrière interrupteurs (accueil par rôle étendu aux profils fonctionnels, français par
   défaut, menu par profil) ; (C) consolidation (fusion des pages exécutives, réunions, suivis) **après** les données
   d'usage `page_viewed` du pilote et les sessions utilisateurs.

---

## 0. Method and evidence

| Item | Value |
|---|---|
| Server | real `server.js` booted by `tests/e2e/fixtures/server.js` (`bootApp`) on a throwaway database `sdp_tracker_test_chb7hq` (dropped at the end, verified `pg_database` count = 0) |
| Data | `tests/e2e/fixtures/seed.js` (sites Houndé/Mana, PV with overdue action, last-week reports, 2 projects, a Friday cadence) + `seedHelpdeskWeek` (27 synthetic tickets) + `seedDemo({tag:'adopt', nativeChangeRequests:true})` (DEMO programme, project, tasks, risk, change request, budget periods, benefit, dashboard). Zoho/OpManager/Meraki/AssetExplorer **never synced** — deliberately, it is how a fresh pilot instance looks. |
| Accounts (15) | one per workspace profile (`public/lib/workspaceProfiles.js` PROFILES) + edge roles: administrator `super_admin` · executive `executive` · business `site-business`@Houndé · operations `admin` · coordinator `editor+report-author`@Houndé · field `field-tech`@Houndé · pmo `committee-member` · finance `finance-viewer` · governance `audit-viewer` · kpi `kpi-committee` · analyst `dashboard-publisher` · reader `viewer`@Houndé · siteeditor `editor`@Mana · scorecard `scorecard-viewer` · groupbusiness `group-business` |
| Pass 1 — baseline | defaults of `report_config` (every dark switch OFF). Every one of the 62 top-level pages (+ `field/index.html`) per profile at **1366 px French**; home + landing destinations at **390 px French**, **1366 px English** and home at 390 px English. ~1 900 visits. |
| Pass 2 — switches ON | 140 dark keys of `docs/ops/FLAG-REGISTER.json` set to `'1'` on the throwaway DB only (list: `switches-applied.json`). Excluded on purpose: `notifications_stop`, `roadmap_redirect_to_portfolio`, `sdp_api_write_enabled`, `entra_deprovision_apply`, `soft_delete_purge_enabled`, `opmanager_tls_insecure`, `auth_account_throttle_enabled` (inverse/destructive/outbound semantics), non-0/1 keys. SMTP host, Teams channels, webhooks were **empty**: nothing could leave. Same crawl at 1366 FR + 390 FR. |
| Value moments | `harness/value.js`: real login → landing → the shortest UI route to the profile's value page; time measured from the login click to `networkidle` of the value page (localhost — real sites over VSAT will be slower). |
| Screenshots | `/home/user/adoption-out/shots/<profile>/<page>-<w>-<lang>.png` (baseline), `shots-switches-on/…` (pass 2), `shots-value/<profile>-<pass>.png`. deviceScaleFactor 1, full page. |
| Raw data | `crawl-baseline-*.json`, `crawl-switches-*.json`, `value-baseline.json`, `value-switches.json` (per visit: final URL, h1, refusal, API 4xx/5xx, page errors, unlabelled inputs, nameless buttons, horizontal overflow, `<html lang>`, EN/FR word counts, load time). Harness scripts in `harness/`. |
| Limits | No real users, no real network (VSAT/4G), no screen reader, empty integrations (helpdesk only 27 tickets), synthetic names; heuristics (English-word counts, unlabelled inputs) are indicators, not an audit. Login rate-limit counters were cleared between logins on the throwaway DB (see finding B-03). |

Measured cross-cutting facts:

- **Landing page** (defaults): executive & super_admin → `executive.html`; business → `site-awareness.html`; **everyone else → `index.html`** (`public/lib/landing.js`, `ui_role_landing='0'`). With switches: super_admin & editors → `home.html`, executive → `dashboards.html?key=exec-home`, field-tech → `field/index.html`; **pmo, finance, governance, kpi, analyst, reader, scorecard still → `index.html`** (landing.js ignores feature roles and the workspace profile).
- **French**: pages rendered with `<html lang="fr">` = **18/61 baseline → 41/61 with `ui_i18n_pages`**.
- **Phone 390 px**: no horizontal page scroll on any visited page (78 visits) — previous layout work holds.
- **Load** (local): all pages settled < 3.1 s; slowest `kpi-builder`, `executive-report`, `assets-finance`, `meetings-insights` (2.5–3.1 s).
- **Unlabelled form controls** (no label/aria/title/placeholder): `itsm-roadmap` 79, `executive-report` 21, `inspection` 13, `meeting` 12, `reports` 8, `meetings-issues` 7, `index` 5 … (23 pages).
- **Business users' usage is invisible**: `POST /api/ux/page-view` returns **403** for `site-business` / `group-business` on every page → the pilot's `page_viewed` metric cannot measure the business profile at all.

---

## 1. Per profile

Format: purpose · jobs-to-be-done (proposed, from `profile-tasks.js` + spec §27) · value today · where it gets lost
(evidence). "B" = baseline (defaults), "S" = switches ON.

### 1.1 Executive (`executive`) — "Is IT healthy, which site is worst, which project is late?"
- **Jobs**: read group health in 1 minute; find the worst site and why; see late/at-risk projects; prepare the monthly
  IT review; record a management decision (spec §27 Executive).
- **Value today**: `it-review.html` is rich (leaderboard, 5 Engagements, helpdesk & changes, scoreboard); exec-home
  dashboard (S) has a real trust model (colour withheld when a source never synced); portfolio tiles "1 slipped · 1 high
  risk" are exactly the right first question.
- **Lost**:
  - B: lands on **`executive.html`** — hidden from the menu (`exec_nav_hidden`), English, a full-screen splash and
    "Loading…" tiles that never resolve without Zoho, placeholders "Click Analyze & Fill" (`shots/executive/executive-1366-fr.png`).
  - Home (`home.html`) for an executive says "Vous n'êtes rattaché à aucun site — utilisez le registre des actions du
    site" and shortcuts are English labels ("Executive Home", "IT Review", "Meeting Cockpit") plus "Obligations du site"
    (`shots/executive/home-1366-fr.png`).
  - IT Review is 100 % English and jargon-dense (E1–E5, K19, MTTR, "Composite v2 — Delivery 40 …"); header reads
    "week ending 20 Nov 2026" next to "Comparing 8 Jul – 14 Jul vs prior week"; a "Data quality 100/100" verdict on a
    near-empty dataset (`shots/executive/it-review-1366-fr.png`).
  - Exec-home (S): "Strategic roadmap **21 % red**" computed from a month where **0 of 21** activities were entered;
    "Major incidents **0**" printed right under "Source jamais synchronisée"; site filter defaults to Sabodala, not to
    the group or the worst site; title/question in English (`shots-value/executive-switches.png`).
  - Three executive surfaces compete (executive.html, it-review.html, exec-home) — known P09 proposal.
- **Value moment** "which site is worst + which project is late": B **2 menu clicks, 2.4 s, from a stuck page**;
  S **0 clicks, 1.5 s** (lands on exec-home) — but the portfolio is another 2 clicks.

### 1.2 PMO / portfolio manager (`committee-member`)
- **Jobs**: review the portfolio before committee; run the committee from the cockpit; record decisions; check delivery
  capacity; produce the monthly portfolio report (spec §21, §27 Portfolio Manager).
- **Value today**: portfolio page (programme → objective → project tree, money by programme, Gantt with baseline,
  resource pressure, risk matrix, monthly HTML report) and cockpit (cadence → agenda → session, decision ageing) are
  substantive and the cockpit is in good French (`shots/pmo/cockpit-1366-fr.png`).
- **Lost**:
  - Lands on the **helpdesk dashboard** (B and S); portfolio = 2 clicks under "Opérations ▸ Planifier et suivre".
  - P09 task 3 "Check the activity tracker" → menu entry shown, page loads, then raw English
    `Failed to load tracker data: Forbidden — required role(s): admin or tracker-admin or tracker-editor`
    (`shots/pmo/activity-tracker-1366-fr.png`). Same dead end for coordinator (without tracker-editor), field, finance,
    governance, kpi, analyst, reader, scorecard (API 403 on `/api/tracker/load`).
  - Portfolio has no **project register** view (Project ID · site · name · priority · status · owner · next milestone)
    as the spec's §21/§24.5 baseline asks: the list is buried in objective rows and Gantt labels; statuses show raw
    codes `on_track`, `active`.
  - Cockpit "Exceptions PPM : Aucune exception" while the portfolio shows 1 slipped project and 1 high risk — the
    exceptions list is fed by nightly alerts that are off, so "none" really means "not computed".
  - S: `portfolio_my_projects_default` makes the view "Mes projets": **0 Projets, "Aucun projet daté", "Aucun risque"**
    under tiles that still say "1 slipped · 1 high risk" — a contradiction for a PMO who owns no project
    (`shots-switches-on/pmo/portfolio-1366-fr.png`).
- **Value moment** "list late/at-risk projects": 2 clicks, 2.1 s (B and S); the answer is only partly on screen (tile
  count, then hunt in the Gantt).

### 1.3 Site IT coordinator (`editor` + `report-author`, own site)
- **Jobs**: close/update site actions; submit the weekly report; write & sign the department PV; record an inspection;
  fill the activity tracker.
- **Value today**: **`home.html` "Mon travail" is the best screen of the app** — per-site card with open/overdue actions,
  weekly report, PV to sign, last inspection, tracker gaps, each a link (`shots/coordinator/home-1366-fr.png`). With
  switches the "Ma file de travail" adds one-click *Terminer / Reporter de 7 jours / Déléguer*
  (`shots-switches-on/coordinator/home-1366-fr.png`).
- **Lost**:
  - B: lands on the helpdesk dashboard showing **all sites** by default (13 filters, two rows of selects), not on Home.
  - **Three different weeks on the same day** (20 Nov 2026): Home "Rapport hebdomadaire W45 2026", report picker
    defaults to **W44 (01→07 Nov)**, Recent reports shows W45 (08→14 Nov), helpdesk "W46 (15–21 Nov)"
    (`shots/coordinator/reports-390-fr.png`, `shots/coordinator/index-1366-fr.png`). Risk: report filed for the wrong week.
  - Site Actions, Meetings, Inspections, Reports are **English** in B (`shots/coordinator/site-actions-1366-fr.png`).
  - "1 en retard · la plus ancienne **0 jours**" (age measured from creation, due date 1 Feb) reads as a contradiction.
  - Shortcut block duplicates "Site obligations" + "Obligations du site" and mixes languages.
  - Helpdesk tiles say "**2h** — No assign data", "**2d** — No resolution data" (value and "no data" side by side).
  - "Suivi d'activité" link on Home → Forbidden when the account lacks `tracker-editor` (role taxonomy, see B-05).
- **Value moment** "my overdue actions": B 2 clicks, 2.0 s (menu) — S **0 clicks** (queue on landing) / 1 click to the
  register, 1.9 s.

### 1.4 Site editor (`editor`, other site — Mana)
Same as coordinator; verified scoped correctly (Home shows only MGO; helpdesk still opens on All Sites). Value moment
identical (S: 0–1 click).

### 1.5 Field technician (`field-tech`, own site)
- **Jobs**: capture an inspection offline on the phone; see actions assigned on my site; look up a past inspection.
- **Value today**: `field/index.html` is clean, French, phone-first: site, Synchroniser, data date, low-bandwidth mode,
  "Aujourd'hui 1 actions ouvertes · 1 en retard", outbox "Rien en attente", bottom tabs
  (`shots/field/field_index-390-fr.png`).
- **Lost**:
  - B: lands on the **desktop helpdesk dashboard** (all sites) on the phone; field app = 2 clicks in a "Configurer"
    menu group.
  - Home for a field tech lists "Rapport hebdomadaire", "PV à signer", "Suivi d'activité 21 sans saisie" — jobs a
    field tech cannot do (`shots/field/home-390-fr.png`).
  - Field app has no primary "Nouvelle inspection" button on Accueil; the bottom tab "Tableau de bord" wraps; the
    low-bandwidth checkbox sits on its own line away from its label; field says "0 trackers à remplir" while Home says
    "21 activités sans saisie" for the same site.
- **Value moment** "start an inspection on the phone": B 2 clicks + desktop page first (2.1 s); S **0 clicks** (lands on
  field app, 1.2 s), +1 tab to Inspecter.

### 1.6 Finance reader (`finance-viewer`)
- **Jobs**: read asset finance (book value, forecast); compare project budget and actuals; produce the finance report.
- **Value today**: assets Finance & Licences tab is complete (fleet value, depreciation curve, per-site, licences,
  compliance); portfolio "Money by programme".
- **Lost**:
  - Lands on the helpdesk dashboard (B and S) — irrelevant to finance.
  - **"$0.00" fleet book value in green**, "$0.00 purchase cost", charts with $0–$1 axes, licence tiles "0 expired /
    0 OK" — on a register the banner itself says "Parc jamais synchronisé" (`shots/finance/assets-finance-1366-fr.png`).
    UNKNOWN shown as 0 and green — the house rule says null.
  - Scope line says "amounts admin only" while a finance-viewer is reading them.
  - `finance.html` (certification) reachable but `/api/finance/*` 404 with switch off — page shell with nothing behind.
  - Report studio (task 3) English, generic.
- **Value moment** "budget vs actuals": 2 clicks, 1.9–2.1 s; answer is "0 / 50,000 USD" with actuals (12 000 USD +
  1.5 M XOF) **not** reflected in the portfolio money table (spent shows 0) — needs a check by the finance seat.

### 1.7 KPI committee (`kpi-committee`)
- **Jobs**: review/adopt KPI definitions and thresholds; shadow-test a change; record the session reference.
- **Value today**: `kpi-builder.html` is a serious, French, governed tool (draft → propose → adopt by another member,
  shadow comparison, history).
- **Lost**: **not in any menu** (P09 "reach or retire"); lands on the helpdesk dashboard; value moment = typing the URL
  or Ctrl+K (3+ interactions, 2.1 s). The profile is not one of the 11 workspace profiles (folds into "governance").

### 1.8 Auditor / governance (`audit-viewer`, no site)
- **Jobs**: check PVs are signed; read decisions/obligations; read the security journal (if granted).
- **Lost**:
  - **Sees 0 meetings, 0 signed, 0 departments** although a submitted PV exists — a site-less audit-viewer reads no
    site; the KPIs read as a measured zero, and "+ New meeting" / "Bulk import" are offered to a read-only auditor
    (`shots/governance/meetings-1366-fr.png`).
  - `policies.html` refused (P09-F1 confirmed); `meetings-unsigned.html` not in menu (3 interactions).
  - Lands on the helpdesk dashboard.
- **Value moment** "are the PVs signed?": **not delivered** (wrong answer 0).

### 1.9 Analyst (`dashboard-publisher`)
- **Jobs**: open/publish a dashboard; analyse ticket/change trends; build a report.
- **Lost**: lands on helpdesk; `analytics.html` refused (P09-F2 confirmed); dashboards catalogue says "11 widgets ·
  fleet" (jargon) in English; composer English. Value moment "open a dashboard": 2 clicks, 1.9 s.

### 1.10 Administrator (`super_admin`) / Operations (`admin`)
- **Jobs**: check integration freshness; read security/sync events; see helpdesk load across sites; chase overdue
  actions; asset hygiene.
- **Value today**: helpdesk dashboard (worst-first SLA ranking, ageing, Pareto) is the strongest analytic screen;
  integrations page shows alert rules and firings; system logs.
- **Lost**:
  - super_admin B lands on stuck `executive.html`; S lands on Home with a useful queue.
  - P09 task "check integrations are fresh (SDP, OpManager, Meraki)" points to `integrations.html`, which is **alert
    rules & API keys**, not source freshness; the freshness page `connector-health.html` is English and not in the
    default menu (`shots/administrator/integrations-1366-fr.png`).
  - 6 alert firings on day 0: 5 × "Activity tracker site score red (14–28 %)" generated from **empty** tracker months.
  - `data-quality.html` / `workspace-settings.html` return a raw `{"error":"Not found"}` when their switch is off.
  - `integrations.html` is reachable by every role (no page gate) and then shows three 403s to non-admins.
- **Value moment** "are my sources fresh?": B 3 interactions (URL/search), 1.8 s; S 1 click but lands on the wrong page.

### 1.11 Site business user (`site-business`) / group business (`group-business`)
- **Jobs**: see my site's IT status, open major incidents, planned changes.
- **Value today**: `site-awareness.html` is in good French, read-only, plain-language question per tab
  ("mes équipes sont-elles bien dépannées au quotidien ?"), 5 KPI tiles, 6-week chart, MI list, top categories, changes
  (`shots/business/site-awareness-1366-fr.png`). **0 clicks, ~1 s** — the only profile fully served by default.
- **Lost**: role chip says **"VIEWER"**; title "Site Overview" English; two language toggles (shell EN + page EN/FR);
  "Backlog", "Data table"; **help.html redirects back** to the site view (no manual for business); page-view
  telemetry 403 (usage invisible); Houndé "Conformité SLA 60 %" here vs **50 %** on the helpdesk ranking for the same
  week (different denominators, not explained). Group-business defaults to Sabodala instead of a group summary.
  `itsm-integrations-plan.html` (an internal project document) and `exec-view.html` remain reachable.

### 1.12 Reader (`viewer`) / Scorecard viewer
Reader: helpdesk dashboard as landing is coherent; Home is useful; dashboards catalogue English. Scorecard viewer: lands
on helpdesk, not on the IT review it was created for (2 clicks).

---

## 2. Per screen (62 top-level pages)

Scores 1–5: **Int** = intuitive (purpose + next action obvious), **Inf** = informative (right numbers, unknown ≠ 0,
dated), **Fit** = fit to its owner profile. FR: B = French at baseline, S = French with `ui_i18n_pages`, — = stays
English. Proposal = AI proposal only (merge/hide/retire needs sponsor decision D-P09-3 and pilot usage data).

| Page | Owner profile | Int | Inf | Fit | FR | Main observation (evidence = `shots/<profile>/<page>-1366-fr.png` unless noted) | Proposal |
|---|---|---|---|---|---|---|---|
| home.html | all internal | 4 | 4 | 3 | B | Best page; executive/site-less variants say "no site"; field variant lists non-field jobs; EN shortcut labels; duplicate obligations shortcut | keep, make it the landing; profile-aware blocks |
| index.html | operations, reader | 3 | 4 | 3 | S (partial) | Strong analytics; 13 filters; All sites default for site users; "2h — No assign data" contradictions | keep; default to own site for site roles |
| executive.html | executive | 1 | 2 | 2 | S | Default landing of exec/super_admin, hidden from menu, stuck splash/Loading without Zoho, "Click Analyze & Fill" placeholders | stop landing here; merge candidate (P09) |
| it-review.html | executive | 2 | 4 | 4 | — | Dense, English, jargon (E1–E5, K19, MTTR), period header contradiction, DQ 100 on empty data | translate; plain-language summary strip |
| dashboards.html | executive, analyst, reader | 3 | 3 | 3 | S | Catalogue "11 widgets · fleet" jargon; no description of who each is for | keep; add audience/purpose line |
| portfolio.html | pmo, executive, finance | 3 | 4 | 3 | S (partial) | Rich but long single page; raw status codes; no project register table (spec §21/24.5); "Mes projets" (S) empty under global tiles | keep; add register view first |
| project.html | pmo | 3 | 3 | 4 | S | Opens on a valid id only; 403 `/api/governance/people` for committee (S) | keep |
| cockpit.html | pmo, governance | 4 | 3 | 4 | B | Good French; "Aucune exception PPM" when alerts are off | keep; say "non calculé" |
| activity-tracker.html | coordinator, pmo | 2 | 3 | 2 | S | Raw English "Forbidden" for 10 of 15 profiles who see it in the menu | gate menu by tracker roles; FR refusal |
| trackers.html | pmo | 3 | 3 | 3 | S | Difference with activity tracker unexplained | keep; label the difference (P09) |
| tracker-builder.html | tracker-admin | 3 | 3 | 3 | — | English | keep |
| site-actions.html | coordinator, field, operations | 4 | 4 | 5 | S | Clear register; English at baseline; "Data through unknown" | keep |
| commitments.html | (switch) | 2 | 2 | 2 | — | Switch off: "+ New commitment" still offered, "Admin flag commitments_enabled" text | hide when off |
| handoffs.html | (switch) | 2 | 2 | 2 | B | Overlaps commitments; API 404 when off | review with commitments (P09) |
| coverage.html | coordinator | 2 | 2 | 2 | B | No entry point; API 404 when off | link from Home when on, else hide |
| obligations.html | coordinator | 3 | 3 | 3 | B | Shortcut appears twice on Home | keep |
| notifications.html | all | 3 | 2 | 3 | — | English | keep |
| meetings.html | coordinator, governance | 3 | 3 | 3 | — | English hero; site-less auditor sees 0 everywhere + create buttons | translate; read-only mode for auditors |
| meeting.html | coordinator | 3 | 4 | 4 | S | 12 unlabelled controls; bilingual h1 at baseline | label controls |
| meetings-actions.html | coordinator | 3 | 3 | 3 | — | English; overlaps site-actions | fold into site-actions tab (already tabbed) |
| meetings-issues.html | governance | 3 | 3 | 3 | — | English; 7 unlabelled filters | translate |
| meetings-council.html | governance | 3 | 3 | 3 | S | Escalations also in issues | merge into issues view (P09) |
| meetings-compliance.html | governance | 3 | 3 | 3 | — | Duplicate of insights heatmap | merge into insights (P09) |
| meetings-insights.html | governance | 3 | 4 | 3 | B | Good charts, French | keep |
| meetings-progress.html | coordinator | 4 | 4 | 4 | S | Useful pre-brief | keep |
| meetings-unsigned.html | governance, coordinator | 4 | 3 | 4 | S | Not in menu; auditor can't see sites | add to governance profile menu |
| meetings-import.html | coordinator | 4 | 4 | 4 | B | Good bilingual guide | keep |
| meetings-setup.html | admin | 3 | 3 | 3 | partial | Mixed FR h1 / EN body | keep (admin) |
| inspections.html | coordinator, field | 3 | 3 | 4 | — | English; API 404 repeat-findings when off | translate |
| inspection.html | field, coordinator | 3 | 4 | 4 | S | 13 unlabelled controls (photo/notes per item) | label controls |
| inspection-actions.html | coordinator | 3 | 3 | 3 | — | English | keep |
| reports.html | coordinator | 2 | 3 | 4 | S | Week picker defaults to W44 while the report due is W45; admin console also lives here (`#admin`) | default to the week due |
| site-report.html | coordinator, business | 3 | 3 | 3 | — | "Pick a site" empty state | keep |
| report-studio.html | finance, analyst | 2 | 3 | 3 | — | English, generic | translate; templates per profile |
| executive-report.html | super_admin | 2 | 2 | 3 | — | 21 unlabelled fields; 4 API 500s without Zoho | keep until studio covers it (P09) |
| assets.html (+ finance/hygiene tabs) | operations, finance | 3 | 2 | 4 | S | "$0.00" green on a never-synced register; "amounts admin only" shown to finance | null → "—"; fix scope note |
| assets-finance.html, assets-hygiene.html | — | – | – | – | – | redirect stubs | retire after grace (P09) |
| wan.html | operations | 3 | 3 | 3 | S | Claims API 404 when off | keep |
| wan-health.html, wan-sla.html | — | – | – | – | – | redirect stubs | retire after grace |
| infra-health.html | operations | 3 | 3 | 3 | B | French; empty without OpManager | keep |
| analytics.html | analyst, executive | 3 | 4 | 3 | S | Refused to dashboard-publisher (P09-F2) | widen or drop from analyst profile |
| dashboard-composer.html | analyst | 2 | 3 | 3 | — | English | translate |
| kpi-builder.html | kpi committee | 3 | 4 | 4 | B | Not in menu | add menu entry for kpi-committee/admin |
| policies.html | governance | 3 | 4 | 3 | B | Refused to audit-viewer (P09-F1) | read-only access for auditors (decision) |
| finance.html | finance | 2 | 2 | 3 | B | Empty shell when switch off (404s) | hide when off |
| integrations.html | administrator | 3 | 4 | 3 | — | Not "source freshness"; no page gate (403s for others) | gate page; rename task |
| connector-health.html | administrator | 3 | 4 | 4 | — | The real freshness page, English, not in default menu | promote for admins |
| data-quality.html | admin | 1 | – | – | — | Raw `{"error":"Not found"}` when off; S: correct refusal for non-admins | friendly "not enabled" page |
| value-scoreboard.html | admin | 3 | 2 | 3 | B | API 404 when off | pilot instrument; hide when off |
| system-logs.html | administrator | 3 | 4 | 4 | — | English | translate |
| access.html | all | 4 | 4 | 4 | B | Good French self-service | keep |
| rfi.html | pmo | 3 | 3 | 3 | S | — | keep |
| site-awareness.html | business, executive | 4 | 3 | 5 | B | "Site Overview" EN title; SLA 60 % vs 50 % elsewhere; defaults to Sabodala | keep; align SLA definition text |
| exec-view.html | public | 2 | 2 | 3 | — | English; "Last updated —" | keep (SharePoint) |
| help.html | all | 3 | 4 | 4 | B | Unreachable for business-only accounts | allow help for business |
| no-access.html | all | 4 | 4 | 4 | B | Clear French refusal (good model) | reuse its wording in API refusals |
| workspace-settings.html | all (switch) | 3 | 3 | 3 | S | Raw JSON 404 when off | friendly page or hide link |
| itsm-roadmap.html | super_admin | 2 | 3 | 3 | B | 79 unlabelled inputs (personal tool) | keep (personal) |
| itsm-integrations-plan.html | — | 2 | 2 | 1 | B | A meeting document reachable by every account incl. business | move to docs (P09) |
| coverage/kpi-builder/meetings-unsigned discovery | — | | | | | No menu entry | — |
| login.html | public | 4 | – | – | B | — | keep |

(`field/index.html`, the 63rd page: Int 4 · Inf 4 · Fit 5 · French — best phone page; add a primary "Nouvelle
inspection" button.)

---

## 3. Value check — a "value moment" under 2 minutes per profile

Times = login click → value page settled, local loopback (add network latency at sites). "Clicks" = interactions after
landing (2 = open menu group + item; 3 = URL or Ctrl+K search).

| Profile | Value moment (proposed) | Baseline | Switches ON | Delivered? |
|---|---|---|---|---|
| Executive | Worst site + why, late projects | stuck landing, 2 clicks, 2.4 s | landing, 0 clicks, 1.5 s | Partly: colours withheld correctly, but red on no-data roadmap; portfolio +2 clicks |
| PMO | Which projects are late/at risk | 2 clicks, 2.1 s | 2 clicks, 2.2 s | Partly: count yes, list no; S "Mes projets" empty |
| Coordinator | My overdue actions + report due | 2 clicks, 2.0 s | 0 clicks (queue), 1.9 s to register | Yes (S); week confusion remains |
| Site editor | same | 2 clicks, 2.0 s | 0–1 click, 1.8 s | Yes (S) |
| Field tech | Start an inspection on phone | 2 clicks from desktop page, 2.1 s | 0 clicks, 1.2 s (+1 tab) | Yes (S) |
| Finance | Budget vs actual per project | 2 clicks, 1.9 s | 2 clicks, 2.1 s | No: actuals not shown in money table; $0.00 green on assets |
| KPI committee | Review the SLA definition | URL/search, 2.1 s | URL/search, 2.1 s | Only if you know the URL |
| Governance/auditor | Are PVs signed? | URL/search, 1.9 s | URL/search, 2.1 s | **No** — shows 0 for a site-less auditor |
| Analyst | Open a dashboard | 2 clicks, 1.9 s | 2 clicks, 2.0 s | Yes, English |
| Administrator | Are sources fresh? | URL/search, 1.8 s | 1 click to the wrong page | No (integrations ≠ freshness) |
| Business | My site IT status | 0 clicks, 1.1 s | 0 clicks, 1.0 s | Yes |
| Reader / operations | Helpdesk health | 0 clicks, 1.1–1.5 s | same | Yes |
| Scorecard viewer | IT review | 2 clicks, 2.1 s | 2 clicks, 2.2 s | Yes, English |

Every value moment is technically under 2 minutes on loopback; the blockers are **wrong answers, wrong landing,
missing menu entries and English**, not speed.

---

## 4. What the dark switches add (pass 2) — value vs confusion

| Profile | Added value (switches ON) | New confusion |
|---|---|---|
| All | `ui_i18n_pages`: 41/61 pages French (from 18); `ui_nav_active_from_url`, `ui_url_filters` | "Mon espace" + **"Retour"** buttons in the header — "Retour" (= *Feedback*) reads as "Go back"; ~20 pages still English so the app flips language page to page |
| Coordinator / site editor | `ui_role_landing` → Home; `ui_home_queue` + `ui_home_blocks`: one queue with Terminer / Reporter / Déléguer; "En attente de moi"; benefits to review | 7 source lines "✓ Disponible · 0 élément(s)" before any item (noise); "Reporter de 7 jours" offered on system items "sans responsable"; "Rapport hebdo W45 2026 — In progress" (EN status) |
| Executive | lands on exec-home; KPI definition drawer, sample size, base line, colour withheld when source never synced (`ui_kpi_*`, `metric_explain_enabled`); `dashboard_red_action_links` turn red tiles into "create a commitment" links | red tile from an empty tracker month invites commitments on noise; English title/question; Sabodala default site |
| Field | lands on field app; `field_task_timing`, outbox resolve | none observed |
| PMO | portfolio views (Chronologie/Liste/Tableau par étape), Now/Next/Later roadmap, capacity per site, annual planning pack, templates, published roadmaps | `portfolio_my_projects_default`: "Mes projets" → 0 projects under global tiles; page becomes very long (13 sections) |
| Finance | `finance_certification_enabled`, `asset_money_certify_display`, currency required | finance page now live but its relation to Assets ▸ Finance is unexplained |
| Admin | connector health and data-quality pages gated properly (refusal page instead of raw JSON); value scoreboard | more admin cards; still no single "is everything fresh" answer on landing |
| Governance / auditor | commitments, handoffs, obligations incl. decisions | auditor still sees 0 meetings (scope, not switch) |
| Business | workspace settings link | otherwise unchanged (good) |

Net: the switch set that **creates** value for adoption is small and text/presentation-only
(`ui_i18n_pages`, `ui_role_landing`, `ui_home_queue`, `ui_home_blocks`, `ui_nav_active_from_url`,
`workspace_profiles_enabled`, `ui_kpi_definition_drawer`, `ui_kpi_sample_size`). The governance/PPM switches add depth
for specialists but each should arrive with a profile-scoped entry point, otherwise they lengthen already long pages.

---

## 5. Prioritised improvement backlog (25 items)

Switch column: **ON** = obvious defect/text fix, ship active; **switch (OFF)** = new behaviour behind a new or existing
`report_config` key defaulting OFF. Success measures tie to `page_viewed` (system_log) and pilot sheets
(`docs/ops/pilot/*`). Nothing here sets a business policy, approval or threshold; where one is needed it is marked
**PROPOSED** for its owner.

| # | Problem | Evidence | Proposed change | Profiles | Effort | Risk | Switch | Success measure |
|---|---|---|---|---|---|---|---|---|
| 1 | Unknown shown as 0 / green on never-synced sources | `shots/finance/assets-finance-1366-fr.png` ($0.00 green); exec-home "Major incidents 0" + "never synced" | When the source has no successful sync, money/count tiles render "—" + "jamais synchronisé", no colour; same for licences/compliance tiles | finance, exec, ops | S | low | ON (defect vs house rule) | 0 tiles with value 0 and source never synced (automated check) |
| 2 | Tracker scores RED and alerts fire on months with no entry | integrations firings 5× "site score red 14–28 %"; exec-home roadmap 21 % red with 0/21 entered | Month with no input → "non saisi" (null), excluded from site score/alerts; PROPOSED rule for partially-entered months to the KPI committee | exec, pmo, admin | M | medium (score change) | ON for the empty-month case; partial rule PROPOSED | false-positive alerts on tracker = 0 in pilot week 1 |
| 3 | Three different weeks displayed the same day; report picker defaults to the wrong week | `shots/coordinator/reports-390-fr.png`, home W45, helpdesk W46 | Picker defaults to the week due (same as Home's "Rapport hebdomadaire"); label every week "W45 (08–14 nov.)" with dates everywhere | coordinator, site editor | S | low | ON | WEEKLY-REPORT-STOPWATCH: 0 reports filed on a wrong week |
| 4 | Menu shows pages whose data the role cannot read (activity tracker for 10/15 profiles; integrations for all) → raw English 403 | `shots/pmo/activity-tracker-1366-fr.png` | Align NAV roles with route roles (tracker: admin/tracker-*; integrations: admin); refusals use the no-access.html French wording | pmo, field, reader, finance, kpi, analyst | S | low | ON | page_viewed followed by 403 → 0 |
| 5 | Executive/super_admin land on a hidden, stuck English page | value-baseline: landing `/executive.html` | Default landing executive → exec-home, super_admin → home (what `ui_role_landing` already does); keep scorecard reachable from exec-home | exec, admin | S | low (navigation only) | Turn `ui_role_landing` ON at pilot (decision of the pilot owner) — or flip its default | first-click success on exec task (FIRST-CLICK-SHEET) |
| 6 | 7 of 15 profiles still land on the helpdesk dashboard even with switches | value-switches.json (pmo, finance, governance, kpi, analyst, reader, scorecard) | Extend `landing.js` to the workspace profile's first destination (pmo → portfolio, finance → assets#finance, governance → cockpit, kpi → kpi-builder, analyst → dashboards, scorecard → it-review) | 7 profiles | M | low | switch OFF (`ui_role_landing_profiles`) | median clicks to value moment ≤ 1 |
| 7 | French users get English pages by default | 43/61 pages `lang=en` at baseline | Make `ui_i18n_pages` ON at pilot; finish the ~20 English pages (meetings, inspections list, integrations, report studio, system logs, commitments, composer, tracker builder, notifications, dashboards catalogue) | all FR users | L (text) | low | ON (text) | 61/61 pages `lang=fr` in FR; SUS item 3 |
| 8 | "Retour" = Feedback reads as "Back" | header (S) | Rename to "Votre avis" / "Donner un avis" | all | S | none | ON | — |
| 9 | Site-less auditor sees 0 meetings / 0 signed and create buttons | `shots/governance/meetings-1366-fr.png` | Show "Aucun site dans votre périmètre" instead of 0; hide create/import for read-only roles; the **read scope of audit-viewer** is a PROPOSED access decision (access-policy owner) | governance/audit | S (text) + decision | low | ON (text); scope = decision | auditor answers "PVs signed?" correctly in UAT |
| 10 | KPI committee tool has no entry point | P09; value 3 interactions | NAV entry "Politiques KPI" for kpi-committee + admin under Configure | kpi | S | none | ON | page_viewed kpi-builder by kpi-committee > 0 |
| 11 | Home for executive/site-less says "no site — use the site action register" | `shots/executive/home-1366-fr.png` | Group variant of Home: worst 3 sites, late projects, decisions due; no site wording | exec, pmo, finance | M | low | switch OFF (`ui_home_group_variant`) | exec first-click success |
| 12 | Home for field tech lists jobs they can't do | `shots/field/home-390-fr.png` | Filter Home blocks by role capability (no report/PV rows without editor) | field | S | low | ON | — |
| 13 | Portfolio has no project register view; raw status codes | `shots/executive/portfolio-1366-fr.png`, spec §21/§24.5 | Add a "Registre" table first (ID · site · name · priority · status · owner · next milestone · RAG, sticky header, search/filter/export); translate status codes | pmo, exec, finance | M | low | switch OFF (`portfolio_register_view`) | PMO "list late projects" in 1 click |
| 14 | "Mes projets" default empties the PMO view under global tiles | `shots-switches-on/pmo/portfolio-1366-fr.png` | Default "Mes projets" only for editors/owners; committee & exec default "Tous"; empty state says "vous n'êtes responsable d'aucun projet — voir tous" | pmo, exec | S | low | adjust existing switch semantics (OFF by default) | — |
| 15 | "Aucune exception PPM" when the nightly alerts are off | `shots/pmo/cockpit-1366-fr.png` | Say "non calculé — alertes nocturnes désactivées" | pmo | S | none | ON | — |
| 16 | Integrations task ≠ source freshness | `shots/administrator/integrations-1366-fr.png` | Add a freshness strip (last sync per source, never-synced in amber) on admin Home; point P09 task to connector-health; translate it | admin | M | low | switch OFF (with connector_health_page) | admin answers "sources fresh?" in 1 click |
| 17 | Business usage invisible to pilot metrics | `/api/ux/page-view` 403 for site/group-business | Accept page-view events from business roles (no content, page id only) | business; pilot team | S | low (privacy: page id only) | ON | business rows in page_viewed > 0 |
| 18 | Business users cannot open help; role chip "VIEWER" | business crawl (help → site-awareness) | Allow help.html (business section); chip shows "Métier" | business | S | none | ON | — |
| 19 | Same KPI, different value across screens (Houndé SLA 60 % vs 50 %) | site-awareness vs index | Show the definition name/denominator under each SLA figure (drawer exists: `ui_kpi_definition_drawer`); alignment of definitions = KPI committee (PROPOSED) | business, exec | S | low | ON (label) | — |
| 20 | Raw JSON 404 pages when a switch is off | data-quality, workspace-settings | Serve a friendly French "fonction non activée" page | admin, all | S | none | ON | — |
| 21 | Feature-off pages still offer actions (commitments "+ New", finance shell) | `shots/coordinator/commitments-1366-fr.png` | Hide create buttons and menu entries when the feature switch is off | all | S | low | ON | — |
| 22 | Helpdesk opens on All Sites for site users; 13 filters | `shots/coordinator/index-1366-fr.png` | Default site filter = user's site(s) for site roles; collapse advanced filters | coordinator, reader | S | low | switch OFF (`ui_carry_site` exists as `ui_nav_carry_site` — reuse) | — |
| 23 | Contradictory tiles ("2h — No assign data", "0 jours" with "1 en retard") | index, home | Fix sublabels; age = days past due for overdue items | coordinator | S | none | ON | — |
| 24 | Unlabelled controls on key capture pages | inspection 13, meeting 12, reports 8, meetings-issues 7, index 5 | Add labels/aria-labels | field, coordinator | M | none | ON | axe/a11y check 0 unlabelled on these pages |
| 25 | Executive surfaces ×3, meetings sub-pages ×10, follow-up lists ×3 | P09 inventory + this review | Consolidation plan only after 30 days of pilot `page_viewed` + usability sessions | exec, governance, coordinator | L | medium | switch OFF / redirects with grace | page count per job ↓, SUS ↑ |

---

## 6. Three implementation lots

**Lot A — "Say the truth, no dead ends" (defects & text, ship ON, ~2 weeks):**
items 1, 3, 4, 8, 9 (text part), 10, 12, 15, 17, 18, 19 (label), 20, 21, 23, 24 — plus the French-text half of 7
for the pages coordinators and technicians use daily (site actions, meetings, inspections, reports). Gate: every value
shown with a never-synced source is "—"; zero menu entry leads to a 403; FR crawl `lang=fr` on the coordinator/field
pages.

**Lot B — "Each profile lands on its job" (behind switches, default OFF, enable per pilot site):**
items 5 (pilot turns `ui_role_landing` ON), 6, 7 (pilot turns `ui_i18n_pages` ON, rest translated), 11, 13, 14, 16, 22,
item 2's PROPOSED partial-month rule submitted to the KPI committee. Gate: human first-click and SUS sessions per
`USABILITY-TEST-PROTOCOL.md` on 2 pilot sites, one francophone coordinator + one technician + one PMO + one executive.

**Lot C — "Fewer, clearer pages" (after evidence):**
item 25 + P09 merge proposals (executive.html into exec-home/IT review; meetings-compliance into insights;
council as a view of issues; commitments + handoffs + coverage as one "Mes suivis"; retire the 4 redirect stubs and
`itsm-integrations-plan.html` from the served app). Gate: 30 days of `page_viewed` data (business included, item 17)
and sponsor decision D-P09-3. Nothing retired without a bookmark-grace redirect.

---

## 7. Human confirmation required

- Run `docs/ops/USABILITY-TEST-PROTOCOL.md` with real people per profile (at least: 2 francophone site coordinators,
  1 field technician on a site phone over the real link, 1 PMO, 1 finance reader, 1 executive, 1 business user),
  French, at 390 px and desktop, baseline vs pilot switch profile.
- Capture first-click (`FIRST-CLICK-SHEET.csv`), SUS (`SUS-SHEET.csv`), weekly-report stopwatch and the value table
  (`VALUE-TABLE.md`). Replace the AI-proposed value moments of §3 with what users say.
- Decisions that belong to humans, not to this review: audit-viewer read scope (item 9), the partial-month tracker rule
  and SLA definition alignment (items 2, 19 — KPI committee), committee money exposure (SEC-F2, unchanged here), which
  switches a pilot site turns on (pilot owner), any page retirement (sponsor D-P09-3).
