# Dash-key clients inventory (D-15, G-08 / CG-08)

Sixteen routes answer a request that carries only the dash key (`X-Dash-Key`), with no session. The list
is pinned by `tests/dashkey-only-routes.smoke.test.js`, so a new key-only route fails CI.

They can be restricted to a session only after the **platform owner** confirms who calls them from
outside the browser. Restricting them earlier could break a scheduled job or an external consumer
that nobody listed. Until D-15 is decided they stay as they are.

**In-repo callers** were found by searching `public/`, `routes/`, `services/` and `tools/` (2026-10-28).
Browser pages send the session cookie as well, so they keep working after a restriction.
The **external callers** column is for the platform owner: scheduled tasks, Power BI, scripts, other servers.

| Route | Returns | In-repo callers | External callers (owner to fill) | Decision (keep key / session only) |
|---|---|---|---|---|
| `GET /api/ping` | liveness | `public/executive.html` (with session) | | |
| `GET /api/data/ticket-volume` | Zoho Analytics view proxy (aggregates) | none found | | |
| `GET /api/data/changes` | same | none found | | |
| `GET /api/data/changes-it` | same | none found | | |
| `GET /api/data/resolution-by-site` | same | none found | | |
| `GET /api/data/backlog-trend` | same | none found | | |
| `GET /api/data/incidents-volume` | same | none found | | |
| `GET /api/data/sla-by-category-week` | same | none found | | |
| `GET /api/data/sla-violated-by-cat` | same | none found | | |
| `GET /api/data/group-count` | same | none found | | |
| `GET /api/data/request-volume` | same | none found | | |
| `GET /api/data/sla-by-group` | same | none found | | |
| `GET /api/data/cab-compliance` | same | none found | | |
| `GET /api/data/major-inc-by-month` | same | none found | | |
| `GET /api/data/major-inc-by-cat` | same | `public/executive-report.html` (with session) | | |
| `GET /api/data/major-inc-by-site` | same | none found | | |

## How to find external callers (platform owner, on the production server)

These are read-only checks; nothing is changed:

- **Since 2026-10-29 the dashboard records the evidence itself** (EX-02): every call that passes on the key alone
  writes one System Log line per route, source address and client name per day (`category = api`,
  `action = dashkey_call`, target = method + path, user agent; the key and the query string are never logged).
  System Logs ▸ filter *dashkey_call* over 30 days gives the external callers to put in the table above.

- IIS access logs: requests to `/api/data/` or `/api/ping` that carry no `report_token` cookie.
- Windows Task Scheduler: tasks whose action calls the dashboard URL.
- Power BI / Excel workbooks with a web data source pointing at the dashboard.

## Once D-15 is decided

The delivery team moves every route the owner marks "session only" in one commit. The pinned set in
`tests/dashkey-only-routes.smoke.test.js` shrinks by the same amount. Routes kept on the key are recorded
here with their client and owner.
