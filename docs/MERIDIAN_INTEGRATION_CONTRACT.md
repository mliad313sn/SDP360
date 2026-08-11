# Meridian ⇄ SDP Integration Contract (F1 / MVP)

The whole integration is **three JSON contracts over HTTP** — no shared database. SDP
owns the resource sync, the open-actions read API, the read-back client, and the hub
badge (all **built** — see "SDP side, done"). Meridian owns the link storage, the ingest
endpoint, the link endpoints, and the picker UI (**Part B — to build**, this document is
the brief).

Base URLs (confirm at deploy): SDP = `https://itops-dashboard.edv-ops.com`, Meridian =
whatever origin the PMO app is served from (path or subdomain — TBD).

## Auth — two independent API keys

| Key | Direction | Who holds / who checks |
|---|---|---|
| **Outbound** (`meridian_out_key`) | SDP → Meridian | SDP presents it as `X-API-Key` on the sync POST (C1) and the link GET (C3). **Meridian validates it** and maps it → the Endeavour tenant + a write-capable context. |
| **Inbound** (`meridian_in_key`) | Meridian → SDP | Meridian presents it as `X-API-Key` on the open-actions GET (C2). **SDP validates it.** |

Both are set on the SDP side from **Admin → 🔗 Meridian (PMO)** (`reports.html#admin/meridian`,
super_admin) or `.env`; stored redacted, blank-kept on save. Meridian issues/stores the
outbound key its own way and shares the inbound key value with the SDP admin.

---

## C1 — Resource sync (SDP → Meridian)

`POST {meridian}/v1/resources/sync` — header `X-API-Key: <meridian_out_key>`

```json
{
  "sites":  [ { "id": "HGO", "name": "Houndé", "country": null, "region": null } ],
  "people": [ { "id": "SDP-U42", "name": "A. Samandoulgou", "role": "coordinator", "site_id": "HGO", "active": true } ]
}
```

- `site.id` is the **SDP meetings module code** (HGO/MGO/SMI/SGO/SML/KGO…) — it satisfies
  Meridian's `pmo.site.id` CHECK `^[A-Z0-9_-]{2,16}$`.
- `person.id` is `SDP-U<dashboard-user-id>` (stable). `person.site_id` FKs a site in the
  same payload — **upsert sites first**. SDP already drops a person whose site isn't in
  the set, so the FK is safe.
- **Idempotent**: Meridian upserts `ON CONFLICT (tenant_id, id) DO UPDATE`. Re-POST = no-op.
- Suggested response: `{ "sites": {"upserted": N}, "people": {"upserted": M, "skipped_unknown_site": K} }`.

**Meridian TODO:** a `POST /v1/resources/sync` route that resolves the outbound key → the
Endeavour tenant + superadmin context, then upserts `pmo.site` then `pmo.person`. Confirm
`pmo.site` has `name/country/region` + `(tenant_id,id)` PK and `pmo.person` has
`name/role/site_id/active` + `(tenant_id,id)` PK (per `0003_domain.sql`).

## C2 — Open actions (Meridian → SDP)

`GET {sdp}/api/actions/open?site=HGO` — header `X-API-Key: <meridian_in_key>`

```json
{ "site": "HGO", "as_of": "2026-08-11",
  "actions": [ { "id": "meetings:1234", "source": "meetings", "title": "Fix radio", "owner": "Koffi",
                 "status": "open", "due_date": "2026-08-20", "age_days": 12, "overdue": true,
                 "origin_label": "HGO_Maintenance_PV_2026-05" } ] }
```

- `id` is the SDP **stable action id** = `"<source>:<action_id|uid>"`; `source` ∈
  `meetings | inspection | report`. Cache `id` + `title` in the link row so a
  renamed/deleted action still shows something.
- PII-safe: owner name only (no requester/technician names).
- Unknown/absent site → `200` with `actions: []` (never 500). Missing/invalid key → `401`.
- **This is live now** (SDP built it). It is inert (401) until the SDP admin sets the
  inbound key.

**Meridian usage:** the picker fetches this (server-side, with the inbound key) to list
attachable actions for a project's site.

## C3 — Link read-back (SDP → Meridian)

`GET {meridian}/v1/links?site=HGO` — header `X-API-Key: <meridian_out_key>`

```json
{ "links": [ { "ext_source": "meetings", "ext_id": "meetings:1234", "activity_id": "AC-7",
               "project_id": "PR-3", "project_name": "WAN upgrade Houndé", "title_cache": "…" } ] }
```

- `ext_id` MUST equal the C2 stable id — SDP keys the hub badge by it.
- Filter to links whose project is at `site` (`project.site_id = :site`).
- **This must accept the outbound service key** (not only interactive JWT users) — SDP
  calls it server-to-server.

**Meridian usage:** SDP's Site Actions hub calls this best-effort and renders a
"▸ Projet: X" badge (deep-linking to `{meridian}/projects/<project_id>`); any error →
no badge, hub never blocked.

---

## Part B — what Meridian must implement (brief for the boss)

1. **Migration `packages/db/migrations/0015_external_action_link.sql`** — a `pmo.external_action_link`
   table `(tenant_id, id, activity_id, project_id, ext_system='sdp', ext_source, ext_id,
   title_cache, linked_by, linked_at)`, PK `(tenant_id, id)`, `UNIQUE (tenant_id, ext_system, ext_id)`,
   FKs to `pmo.activity` + `pmo.project` (tenant-carried). **Enable + FORCE RLS** with
   `current_tenant()` read/write policies, an explicit `GRANT … TO meridian_app`, and an
   `audit.record()` trigger. (Full SQL in the F1 plan, `docs/superpowers/plans/2026-08-11-f1-meridian-integration-mvp.md`, Task B1.)
2. **`POST /v1/resources/sync`** (C1 ingest) — service-key auth → Endeavour tenant + superadmin context.
3. **`POST /v1/activities/:id/attach`** (`{ext_source, ext_id, title_cache}` → upsert a link) +
   **`GET /v1/links?site=`** (C3, reachable by the outbound service key).
4. **Web (`apps/web`) picker** — attach an SDP action (from C2) to a project activity; show attached actions.

**Blocking pre-condition:** this design uses the **ingest API** (C1) rather than a
direct DB write (the original spec's mechanism) — chosen because Meridian's RLS `FORCE`
makes a direct write require owner DB creds + replicating `set_context`. Please confirm
you're OK adding the `POST /v1/resources/sync` endpoint before that piece is built.

---

## SDP side — done (this repo)

| Piece | File |
|---|---|
| Config keys + admin card | `services/reportConfig.js`, `public/reports.html` (`#ap-meridian`) |
| Stable id + flat serializer | `services/meridianActions.js` |
| C2 read API `GET /api/actions/open` | `routes/meridian.js` (mounted in `server.js`) |
| C3 read-back client | `services/meridianLinks.js` |
| Hub badge | `services/meridianActions.js attachProjectLinks` + `public/site-actions.html` |
| Resource sync job | `tools/meridian/sync-resources.js` + `services/meridianResources.js` (nightly cron + `POST /api/meridian/sync`) |

Tests: `tests/meridian-*.test.js` + `tests/meridian-route.smoke.test.js`.
