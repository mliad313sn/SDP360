# `/api/data/*` inventory + auth hardening (audit 3.1 / 3.3, Phase 1)

**Date:** 2026-06-19
**Scope:** the legacy `/api/data/*` surface flagged by the external audit.

## Problem (audit 3.1 / 3.3)

Every `/api/*` route sits behind one global gate (`server.js` `app.use('/api/', …)`)
that accepts **either** an `X-Dash-Key` header **or** a valid session
(`x-report-token` header / `report_token` cookie). The dashboard injects the
API key into pages via `window.__ak`, so `X-Dash-Key` is **not a real security
boundary** — anything that can read a page's `__ak` can call these routes. None
of the 17 `/api/data/*` routes had **route-level** auth.

## Why re-gating to `requireReportSession` is safe (verified)

- Login sets an **httpOnly `report_token` cookie** unconditionally (`server.js`
  ~4013, `sameSite=lax`, 24h).
- The consumer pages are all behind `auth.js` login, and their fetches are
  same-origin with **no `credentials:'omit'`**, so the browser sends the
  `report_token` cookie automatically — even though the JS only adds the
  `X-Dash-Key` header.
- `requireReportSession` accepts the cookie. So a logged-in user passes; the
  `X-Dash-Key` alone no longer grants access to these routes. No page breaks.

## Inventory (17 routes)

| Route | Consumer page(s) | Auth before | Action |
|---|---|---|---|
| `/api/data/major-incidents` | executive, executive-report | key/session only | + `requireReportSession` |
| `/api/data/change-table` | executive, executive-report | key/session only | + `requireReportSession` |
| `/api/data/first-response` | executive | key/session only | + `requireReportSession` |
| `/api/data/sla-trend` | executive, executive-report | key/session only | + `requireReportSession` |
| `/api/data/sla-by-category` | executive | key/session only | + `requireReportSession` |
| `/api/data/group-requests` | executive | key/session only | + `requireReportSession` |
| `/api/data/emergency-changes` | executive | key/session only | + `requireReportSession` |
| `/api/data/ageing` | executive, executive-report | key/session only | + `requireReportSession` |
| `/api/data/incident-vs-sr` | executive | key/session only | + `requireReportSession` |
| `/api/data/cab-approvals` | executive, executive-report | key/session only | + `requireReportSession` |
| `/api/data/cab-recommendations` | executive | key/session only | + `requireReportSession` |
| `/api/data/submission-channels` | executive-report | key/session only | + `requireReportSession` |
| `/api/data/requests-raw` | index, executive, executive-report | key/session only | + `requireReportSession` |
| `/api/data/monthly-summary` | index, executive, executive-report | key/session only | + `requireReportSession` |
| `/api/data/ageing-by-site` | executive | key/session only | + `requireReportSession` |
| `/api/data/ageing-by-group` | executive, executive-report | key/session only | + `requireReportSession` |
| `/api/data/perf-summary` | **none (dead)** | key/session only | **REMOVED** (YAGNI; also did a heavy Zoho `REQUEST_TABLE` 10k fetch) |

All 16 live routes now require a session (route-level), enforced **in addition
to** the global gate. `perf-summary` was removed (no caller anywhere — pages or
server).

## Roll-out note

This is a runtime behaviour change on the server: the routes now require a valid
session cookie. The consumer pages already carry it (logged-in users), so this
is expected to be transparent — **verify in the browser after deploy** (open
executive.html / index.html as a logged-in user; the dashboards should populate;
DevTools → Network shows the `/api/data/*` calls returning 200).

## Follow-ups (NOT done here — separate decisions)

- **Drop `window.__ak`** from pages whose routes are now all session-gated
  (defense-in-depth; the key no longer grants access to `/api/data/*`). Needs a
  pass to confirm every page fetch falls back to the cookie/session cleanly.
- **Tighten roles** on the exec-only routes (e.g. require `executive` /
  `scorecard-viewer`) — deferred to avoid breaking `report-author` / mixed
  flows; `requireReportSession` is the safe baseline first.
- **Inventory the rest of `/api/*`** (non-`/api/data`) the same way over time.
