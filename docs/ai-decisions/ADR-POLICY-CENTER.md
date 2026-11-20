# ADR — Policy Control Center (one place for every administrable rule)

Status: ACCEPTED as an engineering decision (AI, reversible). Business values, thresholds and owners stay PROPOSED.
Date: 2026-11-20 · Branch `feat/policy-center` · Switch `policy_center_enabled` (default `'0'`).

## Context

The platform already holds its rules in three stores: `report_config` (≈296 keys, `services/reportConfig.js`, global,
super_admin through `PUT /api/reports/config`), governance policies (37 parameters, `services/governancePolicy.js`,
global / per site / per group, own history + two-person proposals) and KPI RAG policies (`public/lib/kpiRag.js` +
the KPI policy builder with committee adoption). They are administered from scattered cards. The requester asked for
one place to adapt rules to field reality, with best practice as the default and recommendations shown.

## Decision

1. **No parallel config system.** The center is a *view and a pipeline* over the existing stores. report_config writes
   go through `setConfig` + `configJournal` (the same journal as the admin card); governance writes go through the
   governance store's `set()` (its bounds, protected-rule rules, two-person proposals and history); KPI RAG policies are
   listed read-only with a link to the KPI policy builder. The old cards keep working, switch on or off.
2. **Catalogue = code + one hand-maintained file.** `docs/ops/policy-catalogue.json` carries only what the code cannot
   say: category, risk of deviating, four-eyes flag, values a consumer accepts (each cited to its consumer), unit/bounds
   where known. Defaults, types, descriptions (reportConfig comments; governance FR/EN texts), PROPOSED
   recommendations and owner roles (FLAG-REGISTER.json) and consumers (repository scan) are derived at run time.
   `node tools/agent/policy-catalogue.js` (and `tests/policy-center-catalogue.test.js`) fails when a key exists in
   the code without an entry or an exclusion with a reason. `--bootstrap` proposes entries for new keys; it never
   overwrites an existing one.
3. **Categories.** The ten requested categories plus one extra, *User interface & language*, for the `ui_*` keys that
   fit none of the ten. "KPI & thresholds" also holds money/FX keys (labelled "KPI, thresholds & money").
4. **Best-practice default = the code default** (today's behaviour). A recommendation is shown only when the flag
   register carries one, always labelled PROPOSED; otherwise "no recommendation yet". No threshold is invented.
5. **Scope honesty.** report_config is global only (no consumer reads a per-site report_config value, so none is
   offered). Per-site values exist only for governance parameters marked `siteScoped`, which consumers read through
   `governancePolicy.forContext({ siteId })` (handoffs, meetings, publication, AI stale gate, work calendar).
6. **Four-eyes.**
   - report_config keys flagged `four_eyes` (77: access widening/hardening, money exposure, outbound sends, retention,
     security, command execution, truncation tolerance): a change that moves the value **away from its best-practice
     default** becomes a request (`policy_change_requests`, migration 120); another super_admin approves or rejects
     (requester refused by id and by normalised identity — `commitmentLifecycle.identityKey`). Returning to the default
     is immediate (the safe direction). A request lapses after 7 days; approving re-checks that the stored value is
     still the one the request saw (otherwise `stale`, 409); the value is re-validated at approval.
   - governance parameters: the governance store's own rule (protected relaxations, and tightening when
     `governance.dual_approval_tightening` is on). The center lists those proposals and can approve/reject them
     through the store (`gp-<id>`); it adds no second layer.
7. **Secrets** (the blank-keep set) are catalogued as read-only: never returned (only "set / not set"), never written,
   never exported or imported. They stay in their admin cards.
8. **Reasons are mandatory** on every change (5+ characters; 10+ for a high-risk request, a profile import, a governance
   relaxation). History comes from the existing journals (system_log `config_changed`, governance history) plus the
   request table.
9. **Environment profile import is dry-run first.** The dry run returns a plan and its SHA-256 hash; applying requires
   `confirm: true` and the same hash (what was previewed is what is applied). Every row goes through the same pipeline
   (four-eyes rows become requests). Unknown keys, secrets and invalid values are reported, never applied.
10. **Placement.** Routes in `routes/policyCenter.js` (server.js grows by zero lines: mounted on an existing line,
    before `express.static` so the page gets its nonce). The page is on the built-in strict-CSP list (no inline script).

## Consequences

- One additive table (120, manual rollback proved by `tests/ppm-rollback-scripts.test.js`).
- A new report_config key now needs a catalogue line (one-line review cost; prevents silent drift).
- Approvals are acts of logged-in users; nothing in the center fills a human decision field (flag-decisions.json,
  RELEASE-GATES) or claims a policy approved.

## Alternatives rejected

- A new generic "policy" table replacing report_config: duplicates state, breaks every reader.
- Per-site overrides for report_config: no consumer reads them; offering the scope would be a false claim.
- Four-eyes on every high-risk change regardless of direction: blocks emergency rollback to the safe default.
