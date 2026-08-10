# Meridian PMO ↔ SDP Dashboard — Federation Integration (Design)

**Date:** 2026-08-10
**Status:** Design approved (3 sections validated by product owner) — pending spec review + Entra dependency.

---

## 1. Vision & scope

Meridian is a production-grade multi-tenant **PMO platform** (PostgreSQL 17 + RLS,
Fastify API, Next.js 15 web, optional Redis) developed separately. SDP is the
existing **operational** platform (helpdesk, incidents, inspections, meeting PVs,
site reports, assets — vanilla Node/Express + HTML on PostgreSQL).

They are **complementary, not competing**: SDP owns operational reality; Meridian
owns project structure (WBS, Gantt/critical path, EVM, resource capacity, RAID,
milestones). The goal is to **federate** them so that:

- a technician/site is one entity across both (shared master data),
- an **operational action** (from a meeting / weekly report / inspection) can be
  attached to a **project/activity** in Meridian,
- users move between the two under one identity,
- project health can later roll up into SDP's exec/site reports.

**Non-goals (YAGNI):** no rewrite of either engine; no merging of the two UIs; no
consolidation of deck generation (they coexist by usage); no multi-tenant use of
Meridian beyond the single Endeavour tenant.

## 2. Approved decisions

| Decision | Choice |
|---|---|
| Coupling | **Federation** — two apps, same PG cluster, linked by reference. NOT a merge or rewrite. |
| Auth | **Microsoft Entra SSO for both** (single IdP). Gated on the Entra app registration (pending). |
| Action↔Project link direction | **Driven from Meridian** — the PMO attaches SDP actions to a project; the link lives Meridian-side; SDP reads it back for display. |
| Meeting decks overlap | **Coexist by usage** — Meridian = project steering decks; SDP = department PVs + Group IT report. Nothing to build. |
| Hosting | **Same box + 4MyPeople PG cluster** — a `meridian` database alongside `sdp_dashboard` / `fmp_v2`. Redis optional (in-memory fallback to start). |

## 3. Architecture (federation)

```
IIS reverse proxy (TLS) — itops-dashboard.edv-ops.com
 ├── /            → SDP (Node/Express :3456)        ── PG: sdp_dashboard
 └── /meridian/*  → Meridian
                     ├── web  (Next.js :3000, pm2)
                     └── api  (Fastify :4000, pm2)   ── PG: meridian   (Redis optional)

IdP: Microsoft Entra — SSO for SDP AND Meridian
PG cluster (4MyPeople): fmp_v2 · sdp_dashboard · meridian   (one backup/ops story)
```

- Meridian runs **as-is** (two pm2 processes: `meridian-api`, `meridian-web`),
  its own `meridian` DB on the existing cluster. Endeavour = **one tenant**.
- Neither engine is rewritten. SDP stays the org's source of truth; Meridian is
  the project backbone.

### Feasibility (verified 2026-08-10)
- **Redis is optional**: `apps/api/src/config.ts` has `REDIS_URL: z.string().optional()`;
  `apps/api/src/app.ts` falls back to `MemoryCache`/`MemoryQueue` when unset. Start
  without Redis; add it later only if async deck-generation throughput needs it.
- Meridian is **already built** (`apps/api/dist/server.js`, `apps/web/.next`).
  Boot requires only `DATABASE_URL` + `JWT_SECRET` (≥32 chars).
- Node 22 target; prod runs Node 24 (compatible).

## 4. Integration surfaces (the three links = Tranche 1 / MVP)

### 4.1 Resource sync — SDP → Meridian (one-way)
A `copy-*`-style job (mirrors the existing `tools/pg/copy-*.js` pattern) pushes:
- SDP `sites` → `pmo.site` (id, name, country, region…),
- SDP technicians (+ tech groups) → `pmo.person` (id, name, role, site_id, active).

SDP is the **source of truth** for the organisation. One-way, idempotent,
scheduled nightly + on-demand. No double data entry; a technician is one person
in both systems. Endeavour tenant is provisioned once; the sync targets it.

### 4.2 Action exposure — SDP → Meridian (read API)
SDP exposes a **read-only API** of its open actions, already unified across the
three sources by the existing pure composer `services/siteActionsRegister.js`
(`buildSiteActions`) fed by `getSiteOpenReportActions` + the meetings/inspection
readers. Shape per action: `{ source, origin_id/uid, site, title, owner, status,
due_date, age_days }`. Meridian consumes this to present a picker of attachable
actions. **No new SDP action logic** — this endpoint re-serves what the Site
Actions hub already computes.

### 4.3 Link storage + display — driven from Meridian, read back by SDP
- **Meridian** stores the link: a new table `pmo.external_action_link
  (tenant_id, activity_id, project_id, ext_system='sdp', ext_source, ext_id,
   title_cache, linked_by, linked_at)`. The PMO attaches an SDP action to an
  activity from the Meridian UI.
- **SDP** reads the link back via a small Meridian read API (by site or by
  action id) and renders a **"▸ Projet: X"** badge + deep-link on the Site
  Actions hub row. Additive to the hub; null when unlinked (never fabricated).

### 4.4 Later (Tranche 2 — out of MVP scope)
- Project health rollup (RAG / SPI / CPI / milestones) into SDP exec/site reports.
- Capacity ↔ real workload (feed SDP's actual technician load into Meridian's
  capacity view).

## 5. Identity — Entra SSO (both apps)

Target: both SDP and Meridian authenticate via **Microsoft Entra** (one IdP →
single sign-on). SDP's OIDC auth-code+PKCE engine already exists (`services/
ssoEntra.js`, dormant behind `SSO_MODE`); Meridian currently uses its own JWT
auth and would gain an Entra login (Tranche 2 auth work).

**Dependency:** this is gated on the **Entra app registration**, still pending
with the customer's Entra admin (the same blocker that keeps SDP's SSO dormant).

**Interim (does NOT block Tranche 1):** Meridian keeps its own login until Entra
is live; SDP keeps password login. When the app registration lands, both switch
to Entra (SDP flips `SSO_MODE`; Meridian gets its Entra login wired). One app
registration with two redirect URIs (SDP callback + Meridian callback) serves
both. See `docs/SSO_ENTRA_SETUP.md` for the SDP side.

## 6. Data flow (MVP)

```
SDP sites/technicians ──(nightly sync)──▶ pmo.site / pmo.person        [4.1]
SDP open actions ──────(read API)───────▶ Meridian action picker       [4.2]
Meridian PMO attaches action ──▶ pmo.external_action_link (stored)     [4.3]
SDP Site Actions hub ◀──(read link API)── Meridian  ⇒ "▸ Projet: X"    [4.3]
```

## 7. Boundaries / interfaces

- **SDP → Meridian sync** (`tools/meridian/sync-resources.js`): reads SDP
  `sites`/technicians, writes `pmo.site`/`pmo.person` in the `meridian` DB via a
  least-privilege role. Idempotent upsert; SDP-authoritative fields only.
- **SDP action read API** (`GET /api/actions/open?site=…`): re-serves
  `buildSiteActions`, session-guarded, PII-safe (no requester names beyond owner).
- **Meridian link API** (Meridian-side, new): `POST /activities/:id/attach` +
  `GET /links?site=…` — attach/list external SDP action links.
- **SDP hub read-back** (`services/meridianLinks.js`): thin client that calls the
  Meridian link API and caches per site; the hub renders the badge from it,
  degrading to no-badge on error (never blocks the hub).

Each unit is independently testable: the sync against a throwaway `meridian` DB;
the SDP read API as a route smoke test; the read-back client with a stubbed
Meridian response.

## 8. Error handling

- Sync: fetch-before-write, idempotent upsert, per-entity try/catch; a Meridian
  outage never touches SDP data. Logs, non-blocking.
- Read-back: the hub's project badge is **best-effort** — a Meridian timeout or
  error renders "no badge", never an error state on the SDP hub.
- Cross-system ids: SDP action identity is `(source, origin_id|uid)`; the link
  caches a title so a deleted/renamed action still shows something sane.

## 9. Testing

- `tools/meridian/sync-resources` — unit test against a throwaway `meridian` DB
  (sites/people upsert + idempotency).
- SDP `/api/actions/open` — route smoke test (auth gate, shape, PII-safe).
- `services/meridianLinks` — client test with a stubbed Meridian response
  (badge present / absent / error → no-badge).
- No change to `siteActionsRegister` behaviour (the read API re-serves it) — the
  existing register + hub tests stay green.

## 10. Open items / risks

1. **Entra app registration** — the SSO blocker for both apps (Section 5). Tranche 1
   does not depend on it.
2. **Reverse-proxy path vs subdomain** — `/meridian/*` path (Next.js `basePath`)
   vs a `meridian.edv-ops.com` subdomain. Path is simpler for one cert; subdomain
   is cleaner for cookies/CORS. To confirm at deploy time.
3. **Redis** — start without; revisit if deck-generation queue depth grows.
4. **Tenant provisioning** — seed the single Endeavour tenant + initial
   sites/people before the first sync.
5. **Ownership of Meridian's codebase** — it's the boss's; changes to Meridian
   (the link API, Entra login) must be coordinated with him.

## 11. Sub-projects (each its own spec→plan→build later)

- **F1 (MVP):** resource sync + SDP action read API + Meridian link + SDP read-back badge.
- **F2:** Entra SSO for both (after the app registration).
- **F3:** project-health rollup into SDP reports.
- **F4:** capacity ↔ real workload.
