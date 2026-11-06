# KPI committee — charter (PROPOSITION, not adopted)

> **Status: proposal prepared by an agent for the KPI committee to amend and adopt.** Nothing in this file is a
> decision. No member is named, no quorum is fixed, no formula or threshold is declared approved. The adoption of
> this charter is itself the committee's first act (release gate 11, `docs/sdp360/completion/RELEASE-GATES.md`).

## 1. Mandate (proposed)
The committee decides, for every indicator published by the dashboard, decks and e-mails:
- the **definition** (numerator, denominator, exclusions, window, unit, rounding, direction);
- the **RAG thresholds** and the **minimum sample** under which a figure is shown as "not comparable";
- **which of two co-existing definitions is official** where the code carries both (see `FORMULA-REFERENCE.md` §6,
  the divergence register);
- the **effective date** of each adopted version, and its retirement.

It does **not** decide operational targets per site (those are `kpi_targets`), nor access rights.

## 2. Roles (proposed — names left for a person)
| Role | Who | Notes |
|---|---|---|
| Chair | _to be named_ | Opens the session, signs the minutes (PV). |
| Members | _to be named_ | Hold the `kpi-committee` feature role (Admin ▸ Users). |
| Secretary | _to be named_ | Keeps the PV and enters the committee reference on each decision. |
| Author of a policy | the member who drafts it | May **propose**, never **adopt** (see §4). |
| Quorum | _to be fixed by the committee_ | Placeholder — the code does not enforce a quorum. |

## 3. Decision cycle (as the code supports it today)
1. A member drafts a version in `/kpi-builder.html` (status `draft`).
2. Its author proposes it (status `proposed`) — only the author may: `services/kpiPolicyStore.js:105` (`only the author of the draft proposes it`).
3. The committee reads the **shadow comparison** (per site Δ and RAG changes vs the adopted version, else today's code).
4. A member who is **neither the author, nor the proposer, nor a deputy of them** records `adopt` / `reject` / `retire`.
5. The adopted version takes effect at its `effective_from`; the previous adopted version of the metric is closed at that date.
6. The switch `kpi_policy_enforced` decides whether screens consume adopted versions (today `'0'`).

## 4. Author ≠ adopter — where the code enforces it
- Separation rule `kpi_policy.adopt` = `no_self_approval` + `no_deputy_verification`: `services/sodPolicy.js:39` (`'kpi_policy.adopt'`).
- The check applied at decision time: `services/kpiPolicyStore.js:115` (`function adoptCheck(p, actorId, principals)`).
- Writes require the committee role: `routes/kpiPolicies.js:31` (`const requireKpiCommittee`).
- An adopted or retired version is **immutable** (database trigger): `db/postgres/reports/065_kpi_policies.sql:65` (`immutable`).
- Proven by `tests/kpi-policy-routes.smoke.test.js` ("governance: only the committee drafts; only the author proposes; the author cannot adopt…").

## 5. Decision record = `committee_ref`
Every decision row (`kpi_policy_decisions`) carries a mandatory committee reference:
- schema: `db/postgres/reports/065_kpi_policies.sql:35` (`committee_ref TEXT NOT NULL`);
- route check (≥ 3 characters, else 400): `services/kpiPolicyStore.js:127` (`if (ref.length < 3)`).

**Proposed format** (to be confirmed by the committee): `KPI-PV-<YYYY>-<NN>[/<item>]`, e.g. `KPI-PV-2026-03/4` =
session 3 of 2026, agenda item 4. The same reference is written in the PV (`PV-TEMPLATE.md`) so that each adopted
version can be traced from the database to the signed minutes and back.

## 6. Publication and effect
- **Effect date** = the version's `effective_from` (a day, `YYYY-MM-DD`); never back-dated before the session date
  (proposal — the code accepts any date that does not overlap an adopted version).
- **Publication**: the PV is filed by the secretary; the adopted version is visible read-only in `/kpi-builder.html`
  and in `docs/ops/METRIC-LINEAGE.md` ("Versioned contract" row points to `kpi_policies`).
- A figure whose definition has no adopted version keeps today's code and is labelled **not certified**
  (`docs/ops/METRIC-LINEAGE.md`, "Certification" row).

## 7. Left for a person
Members, chair, secretary, quorum, meeting frequency, adoption of this charter, the reference format, and every
decision listed in `FORMULA-REFERENCE.md` §6.
