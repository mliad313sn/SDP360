# 4MyPeople integration — slice 1 (read-only `/api/v1` consumption)

The dashboard reads 4MyPeople workforce data (employees + readiness) over its REST
API, **behind the dashboard's own auth** (executive/admin). No shared session/SSO —
that's a separate, migration-gated track. Server-to-server, read-only, reversible.

## Pieces
| File | Role |
|---|---|
| `services/fmpClient.js` | Outbound client (axios) → `FMP_API_URL` with `X-API-Key: FMP_API_KEY`. `listEmployees()`/`listReadiness()`. Degrades to `[]` + logs if 4MyPeople is down (never breaks the dashboard). HTTP fn injectable for tests. |
| `routes/fourmypeople.js` | DI factory. `GET /api/integration/fmp/employees` + `/readiness`, gated by `requireReportSession` + `requireRole(['super_admin','executive','admin'])`, 60s in-memory cache. |
| `server.js` (mount) | Mounts the routes **only when `FMP_API_KEY` is set** (next to the inspection mount). |
| `tests/fmp-client.test.js` | Unit tests (mocked HTTP — no live key needed). |

## Environment (`.env` on the dashboard host)
```
FMP_API_URL=http://localhost:3000/api/v1      # 4MyPeople on the same box (default)
FMP_API_KEY=<paste the key minted below>
# optional:
FMP_CACHE_MS=60000
FMP_API_TIMEOUT_MS=8000
```
The routes are **not mounted** until `FMP_API_KEY` is present, so leaving it unset is a
clean off switch.

## Minting the API key (one-time, in 4MyPeople — superadmin)
The dashboard cannot mint the key itself (it needs a 4MyPeople superadmin session). Do it
once via the 4MyPeople API:
1. Log into 4MyPeople (`http://localhost:3000`) as a superadmin → obtain a session cookie.
2. `POST /api/v1/admin/api-keys` (superadmin session) with body `{ "label": "sdp-dashboard", "scope": "powerbi.read" }`.
   The response returns the key **once** — copy it.
3. Put it in the dashboard `.env` as `FMP_API_KEY`, then restart the dashboard.

> The API key authenticates as a read-only superadmin principal (fleet-wide rows). That's
> why the dashboard routes are gated to executive/admin — surfacing this data to lower
> roles needs a governance decision + per-user filtering (out of scope for slice 1).

## Verify
- `node --test tests/fmp-client.test.js` → green (no key needed).
- With the key set + 4MyPeople up: `GET /api/integration/fmp/readiness` (with a dashboard
  executive/admin session) returns `{ data: [ { employeeId, employeeName, siteName,
  readinessPercent, isReady, … } ] }`.

## Not in this slice (deferred)
- Shared SSO/session (blocked on the dashboard's reports.db auth migration + a 4MyPeople
  IdP — `4MyPeople/app/src/services/SsoService.js` is scaffolded but not wired).
- Shared email (4MyPeople `EmailService` as the relay).
- An org-tree endpoint (4MyPeople `/api/v1` only exposes denormalized `siteName`/
  `departmentName`/`roleName` on employee rows today).
- A site-code crosswalk (4MyPeople `siteName` strings vs the dashboard's HGO/MGO/… codes).
