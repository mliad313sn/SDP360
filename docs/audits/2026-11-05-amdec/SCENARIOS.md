# AMDEC 2026-11-05 — scenario catalogue (agent-executed campaign, "UAT simulée")

**What this is.** A scenario catalogue executed by an agent on a throwaway PostgreSQL database seeded with a
fictitious multinational organisation (`tests/_uat-world.js`). **It is not user acceptance**: no real user, site,
credential or production record took part, nobody signed anything, and nothing here states production readiness.
A real UAT with pilot users stays a human gate (`docs/decisions/2026-11-05-PO-DELEGATED-DECISIONS.md` §3).

**Seeded world.** 15 sites in 5 countries — Senegal (Sabodala, Massawa *as its own site*, Dakar), Burkina Faso (MANA,
Houndé, Ouagadougou, Wahgnion *inactive*), Côte d'Ivoire (Ity, Lafigué, Abidjan, Tanda, Exploration *with sub-sites
FETEKRO/TANDA*, Assafo), Mali (Kalana) and the United Kingdom (London Office); currencies XOF / GBP reported in USD;
21 accounts covering the organisation models below; free-text site-label variants (`HOUNDE`, `Houndé`, `MASSAWA`,
`Ouaga`, the source typo `Fetekro Explorarion Office`); an empty-data site (Kalana); a 20 000-ticket site (Houndé).

**Organisation models.** (a) central Group IT — site-less `admin`/`super_admin` · (b) federated — `editor` locked to one
site · (c) multi-site editor spanning three countries · (d) shared office service desk (Dakar + Abidjan + Ouagadougou)
· (e) sites without meetings/inspection codes (Massawa before onboarding, Assafo, London) and Exploration (hard-coded
`EXP`) · (f) business-only (`site-business`, `group-business`) · (g) readers (`executive`, `scorecard-viewer`,
`finance-viewer`, `viewer`) · (h) field technician · (i) KPI committee (role `kpi-committee`, C-31, two members in CI and GB) · (j) committee
member, deputies, deactivated account, second super_admin; emergency access C-22 (merged, switch off by default).

**Status legend.** PASS = new campaign test, green · FAIL→FIXED = new test, red on the first run, green after the fix
in this branch's fix commits · LIMIT = test green but it *pins* a limit (behaviour stays, recorded in AMDEC.md) · COVERED = an
existing suite, **re-run in this campaign** and green · NOT EXECUTED = with the reason.

Test files: `tests/uat-amdec-org-models.smoke.test.js` (ORG, 13), `tests/uat-amdec-multinational-data.test.js` (DAT, 10),
`tests/uat-amdec-workflows.smoke.test.js` (WF + NE-01/NE-02, 8), `tests/e2e/u1-multisite-french.spec.js`, `tests/e2e/u2-executive-review.spec.js`,
and the follow-up D-10 journeys `tests/e2e/u3-admin-helpdesk-infra.spec.js`, `u4-executive-worst-site.spec.js`, `u5-scorecard-viewer.spec.js`.

| Id | Area | Org model × persona | Scenario → expected result | Status | Evidence |
|---|---|---|---|---|---|
| ORG-a | RBAC / reports | (a) central admin | Lists and reads the reports of all 11 report sites, writes PVs on SGO/HGO/SMI/DKR | PASS | org-models |
| ORG-b | RBAC / reports | (b) Sabodala vs Massawa editors (same country) | Each sees only its site; cross read/write 403 | PASS | org-models |
| ORG-c | RBAC / all modules | (c) editor SN+BF+CI | Exactly 3 sites in reports, PVs, tracker (`SGO,HGO,ITY`), inspection (`SGO,HGO,SMI`), Site Awareness; 403 on the rest | PASS | org-models |
| ORG-d | RBAC / meetings | (d) shared office desk | PVs on DKR/ABJ/OUA only; tracker closed without `tracker-editor` | PASS | org-models |
| ORG-e1 | Onboarding | (e) Massawa editor + super_admin | Refused ("no site assigned for this module") until codes registered + registry on; editor cannot register; code clash 409; other sites unchanged | PASS | org-models |
| ORG-e2 | Site codes | (e) Exploration editor | PV + inspection accepted under hard-coded `EXP`; registry reports EXP missing | LIMIT (AM-03) | org-models |
| ORG-e3 | Site codes | (e) Assafo + Tanda editors | Two sites resolve to tracker `TND` (shared write scope); diff must report it | FAIL→FIXED (AM-01) | org-models |
| ORG-e4 | Hierarchy | (e) UK office | Country set by super_admin with a reason (admin 403, no reason 400); no PV without code; weekly report works | PASS | org-models |
| ORG-f | Business view | (f) site-business / group-business | `/api/reports` 403; own-site awareness 200, other site 403; group view every site; no PV | PASS | org-models |
| ORG-g | Readers | (g) exec / scorecard / finance / viewer | Each reads exactly its slice (review, metrics, finance, reports); site-less viewer lists nothing; readers never write | PASS | org-models |
| ORG-h | Field | (h) field technician | Own site only; no PV; no report write; inspection scope HGO | PASS | org-models |
| ORG-i | Roles | (i) KPI committee | `kpi-committee` role kept (C-31); an unknown role is refused with a 400 naming it (D-04) | PASS (AM-04 fixed by D-04) | org-models |
| ORG-j | Identity | (j) deactivated / central admin | Deactivated login null; admin tier has no Site Awareness (403) | PASS + LIMIT (AM-11) | org-models |
| DAT-01 | Helpdesk | (d) shared desk across BF/CI groups | Exploration window counts its 3 country groups; the ticket's site label is ignored; Massawa is its own site | PASS | multinational-data |
| DAT-02 | Null truth | empty site | Kalana: closure/SLA/avg resolution null; score not applicable; risk never "low" | PASS | multinational-data |
| DAT-03 | Finance / currency | (g) finance-viewer | GBP and XOF converted per site; a site with no currency is null (not 0), counted in `excluded`; certification `false` / `excluded_rows` while any row is excluded (D-06) | FAIL→FIXED (AM-05, D-06) | multinational-data |
| DAT-04 | Calendar | all | Weekly report week = Zoho Sun→Sat, site-report chart week = ISO Mon→Sun, same label "W37 2026" | LIMIT (AM-07) | multinational-data |
| DAT-05 | Calendar | (b) editor | 1–2 Jan 2027 in Zoho W52 2026; API refuses weeks 53/99/-1/0 for 2026 | FAIL→FIXED (AM-06) | multinational-data |
| DAT-06 | Time zone | UK office | Ticket 00:30 BST on 1 Sept counted in August (UTC calendars, `site_local_calendar` = 0, today) | LIMIT (AM-08) | multinational-data |
| DAT-06b | Time zone | UK office / Dakar | D-07 `site_local_calendar` = 1: the London ticket counts in September (Europe/London from GB), Dakar (UTC+0) unchanged, `sites.time_zone` wins, an invalid zone reads UTC | PASS (D-07, month reader only) | multinational-data |
| DAT-07 | Performance | large site | 20 000 tickets: month reader and site report under budget (measured ~60 ms / ~150 ms on this runner) | PASS | multinational-data |
| DAT-08 | Site labels | all | Variants fold; Massawa ≠ Sabodala; source typo not folded | PASS + LIMIT (AM-12) | multinational-data |
| DAT-09 | WAN sub-sites | (e) Exploration | `WAN1 FETEKRO` carries the sub-site only with the token; normal sites unchanged | PASS | multinational-data |
| WF-01 | Report lifecycle | (c) multi-site editor | Submits the Ity report, it freezes; a Sabodala-only editor cannot revert; the site editor can | PASS | workflows |
| WF-02 | Meetings transfer | (d) shared desk | Helpdesk transfer needs a note and a numeric ticket; cross-site comment 403 | PASS | workflows |
| WF-03 | Site Actions hub | (c)/(d) | Hub follows the account's sites | PASS | workflows |
| WF-04 | Exports | (d) shared desk | Meetings Excel contains only DKR/ABJ/OUA rows | PASS | workflows |
| WF-05 | Scale | (a) central admin | API returns every report; the page shows at most 20 cards (no paging) | LIMIT (AM-09) | workflows |
| WF-06 | Security / XSS | (a) central admin | Report list cards escape site name, week label and dates | FAIL→FIXED (AM-13) | workflows |
| U1 | UI + i18n | (c) coordinator BF+SN | Report list = exactly the 2 sites; switches to French; site names not translated | PASS | e2e u1 |
| U2 | UI executive | (g) executive / (b) editor | IT Review renders, scorecard opens, no page error; editor gets 403 on review data | PASS | e2e u2 |
| U3 | UI admin | (a) Group IT admin | Helpdesk: inbound of the week across sites, resolution-SLA ranking worst first (Houndé before MANA); infra-health and WAN pages open; WAN summary 200 | PASS (D-10) | e2e u3 |
| U4 | UI executive | (g) executive | Scorecard, then the worst site of the week and why (Houndé, 6 missed); a published dashboard renders | PASS (D-10) | e2e u4 |
| U5 | UI scorecard viewer | (g) scorecard-viewer | Scorecard and Analytics open; settings write, report write, site report and finance read refused; IT Review data readable | PASS (D-10) | e2e u5 |
| EX-01 | Cross-site read | (b) | Every GET route with a site-B id leaks nothing to a site-A editor | COVERED | cross-site-read-sweep (2) |
| EX-02 | Cross-site write | (b) | Every write route refuses another site's object | COVERED | cross-site-write-sweep (2), cross-site-object-writes (9), audit-report-write-auth (19) |
| EX-03 | Multi-site editor | (c) | Session sites, lists, writes, exports | COVERED | multi-site-editor (7) |
| EX-04 | Business boundary | (f) | Every GET answering 2xx is inside the business allow-list | COVERED | business-only-boundary (6) |
| EX-05 | Access requests | (j) | Self-approval refused; second super_admin approves; grant with end date; approver policy R7 | COVERED | access-routes (6), access-approver-policy (4), sso-grant-merge (5) |
| EX-06 | Deputies / handover | (j) | Scoped deputies, handoff acceptance, escalation, receiver moved site loses power | COVERED | scoped-deputies (8), handoffs (11), governance-roles (8), shift-handover (4) |
| EX-07 | Coverage | mine vs office | No roster → unknown, never covered; deactivated holder not counted | COVERED | duty-routes (6), duty-coverage (8) |
| EX-08 | Qualifications | HSE | Verified by someone other than the subject; never a physical authorisation | COVERED | qualification-routes (3), qualification-policy (4) |
| EX-09 | Field offline | (h) | Offline inspection + photo then sync; no silent loss; French | COVERED | e2e T3, field-routes (5), field-no-silent-loss (4), field-french (4), browser quota unit |
| EX-10 | i18n / a11y | all | French dictionaries cover the shell pages; static a11y; chart data tables | COVERED | i18n-coverage (41), a11y-static (18), chart-a11y (13), e2e T7, T8 |
| EX-11 | Currency engine | Finance | Currency map, rates, coverage certification | COVERED | currency (6), money-coverage (12), assets-finance-* (20), assets-money-scope (7) |
| EX-12 | Site codes | all | Registry off by default, diff, fill, switch | COVERED | site-code-registry (1), tracker-site-code (14) |
| EX-13 | Governance UAT | committee / chair | Minutes after acceptance, RFI verification by requester, PV signer | COVERED | uat-governance-users (4) |
| EX-14 | ITSM figures | ITSM owner | Closure null without tickets, cancelled out of SLA | COVERED | uat-itsm-figures (4) |
| EX-15 | Meetings transfer | (b) | Transfer statuses need a justification | COVERED | status-transfer (11) |
| EX-16 | Exports / viewport / race | super_admin | CSV/XLSX non-empty, 4 viewports, filter race | COVERED | e2e X1, V1, R1 |
| EX-17 | Deny / site action / weekly / cockpit | (b), committee | e2e journeys | COVERED | e2e DENY, T1, T2, T4 |
| EX-18 | Authz matrix / backups / await | platform | Route guard matrix, backup schedule, await precedence, server size | COVERED | authz-route-matrix, backup-schedule (6), await-precedence (5), server-size-budget (2), readme-truth (7), evidence-baseline (5) |
| NE-01 | Emergency access | (j) | Off by default (404); admin tier refused; > 24 h and self-grant refused; super_admin grants the Massawa editor the Sabodala site for 8 h → reads Sabodala only; logged risk=1; the granter cannot review, the second super_admin does; at the hour the grant ends, own site untouched | PASS (after the C-22 merge, D-09) | workflows |
| NE-02 | KPI committee approvals | (i) | Editor / admin / executive cannot draft; the CI member drafts and proposes, cannot adopt (separation of duties); a reference is required; the GB member adopts; adopted = immutable; `kpi_policy_enforced` stays 0 | PASS (after the C-31 merge, D-09) | workflows |
| NE-03 | SSO login per country tenant | all | Entra sign-in, role merge | NOT EXECUTED — needs a real tenant and credentials (human gate); merge logic COVERED by sso-grant-merge | — |
| NE-04 | E-mail delivery | coordinator | Weekly/monthly mails reach confirmed recipients | NOT EXECUTED — no SMTP in the sandbox; composers COVERED by existing golden tests (not re-run here) | — |
| NE-05 | PPTX/PDF parity | executive | Same figures in HTML/CSV/XLSX/PPTX/PDF | NOT EXECUTED in this campaign — C-16 golden figure test exists, not re-run | — |
| NE-06 | Meraki / OpManager live data | SRE | WAN and infra availability from real APIs | NOT EXECUTED — no live connector (forbidden to use real credentials) | — |
| NE-07 | Screen reader | accessibility | NVDA/JAWS session | NOT EXECUTED — needs a person (human gate) | — |
| NE-08 | Backup/restore drill | SRE | Install + restore on the TEST instance | NOT EXECUTED — Windows-only + human gate | — |
| NE-09 | Concurrency under real load | SRE | Many coordinators saving at month end | NOT EXECUTED — single-runner sandbox; PG lock test exists (pg-reports-reports) | — |
| NE-10 | Real users' understanding | all personas | Can a coordinator find and act unaided | NOT EXECUTED — usability protocol `docs/ops/USABILITY-TEST-PROTOCOL.md` needs people | — |

## Counts

| | Scenarios |
|---|---:|
| Designed | 62 |
| Executed by new campaign tests (API 31 + browser 5) | 36 |
| — passed first time | 32 |
| — failed first, fixed on this branch, now green | 4 (ORG-e3, DAT-03, DAT-05, WF-06) |
| — green but pinning a limit (counted in passed/fixed above) | 7 (ORG-e2, ORG-j, DAT-04, DAT-06, DAT-08, WF-05 + ORG-e3 before fix; ORG-i is no longer a limit since C-31) |
| Covered by existing suites re-run in this campaign (all green) | 18 |
| Not executed (reason given) | 8 (NE-03 … NE-10) |

Run of record (5 Nov 2026, this branch, after the fixes): 45 API/unit files (the 3 campaign files + the 42 neighbour
suites named above, plus `assets-routes.smoke` and `pg-reports-reports`) — **347 tests, 347 pass, 0 fail, 0 skipped** (WF-06 added afterwards: its file re-run 6/6 with i18n-coverage + a11y-static, 65/65);
`node tools/test/run-e2e.js --runs=1` — **12 journeys + 1 browser unit, all green, 0 external request**. One existing
expectation was changed on purpose (`assets-finance-readers`: an all-skipped site now reads `null`, see AM-05).

Follow-up run (5 Nov 2026, goals D-07 / D-09 / D-10, still agent-run, not user acceptance): the 3 campaign files +
`site-time-zone`, `emergency-access(.smoke)`, `kpi-policy-routes.smoke`, `readme-truth`, `flag-register`,
`evidence-baseline`, `server-size-budget`, `await-precedence`, `report-config`, `pg-migrate`, `uat-itsm-figures`,
`e2e-harness`, `site-report-helpdesk-weekly` — green (counts in `docs/agent-execution/D-070910.md`);
`node tools/test/run-e2e.js --runs=1` — **22 journeys + 1 browser unit, all green, 0 external request**.
