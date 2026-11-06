# Department visibility — draft matrix (audit S-03) — PROPOSITION, NO RULE INVENTED

Prepared by E-S06 on 2026-11-06. **PO decision R4 (2026-11-05): no department scoping during the pilot**
(`docs/decisions/2026-11-05-PO-DELEGATED-DECISIONS.md`). This file does not propose a rule: it lists where a
department appears and who can read it TODAY, and the questions the data owners must answer before any rule.

Today's model: an account carries roles and sites (`users.site_id` + `user_sites`); there is **no account ↔
department link**. No authorization helper reads a department (`services/userSites.js`,
`services/authorizationService.js` — no `department` reference); visibility is by site and role only.

## Tables that carry a department

| Table | Column(s) | What the department means | Who reads it today (site / role scope, per `docs/ops/AUTHZ-MATRIX.md`) | Department narrows visibility? |
|---|---|---|---|---|
| `md_meetings` | `department`, `department_head`, `department_head_title` | the department a PV (or incubation session) is held with | meeting pages and exports: by site for editors, every site for the admin tier | no |
| `action_items` | `department` | department assigned to a weekly-report follow-up | weekly report of the site; Site Actions hub; e-mails | no |
| `action_departments` | `name` | reference list of departments for follow-ups | anyone with the report editor | no |
| `md_departments` | lookup | reference list of PV departments | anyone with the meetings pages | no |
| `commitments` | `department` | department a commitment belongs to | commitments pages, by site | no |
| `handoffs` | `from_department`, `to_department` | business handoff between departments of one site | handoff pages, by site | no |
| `assets` | `department` | department recorded in the asset tool (source of record) | Assets inventory (amounts admin+ only, G-11) | no |
| `governance_role_events` (comments) | department head named on a handoff | person reference, not a scope | governance pages | no |

## Questions for the data owners (answers recorded by them, not here)

1. Which of these objects, if any, must be hidden from people of another department on the same site?
2. How is a person's department known — HR source, Entra attribute, manual assignment — and who keeps it current?
3. What happens to people serving several departments, deputies, the site IT coordinator and the admin tier?
4. Are department heads without an account (handoffs) affected?
5. Which exports and e-mails would need the same restriction, and how is it tested before it is switched on?

Until these are answered, department stays a label. Any future rule ships behind a `report_config` switch
defaulting to today (no department scoping), shadow-tested first.
