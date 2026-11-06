# External API contracts — PROPOSAL (E-A03, audit A-03)

> Status: **proposal**, written by an agent on 2026-11-05. Nothing here is approved. The owner of the
> external API (and of every consumer it serves) decides whether to adopt it.

## Scope

The machine-facing surface outside the session gate (`routes/extApi.js`):

| Path | Scope | Body |
|---|---|---|
| `GET /ext/v1/metrics` | `metrics:read` | `{ metrics: Metric[], as_of: ISO }` |
| `GET /ext/v1/sites` | `sites:read` | `{ sites: Site[] }` |
| `GET /ext/v1/metrics/:key/values?site=&window=` | `values:read` | `{ metric, values: Value[] }` + header `X-SDP-Freshness: fresh\|stale` |
| `GET /ext/v1/values?metrics=a,b&site=&window=` | `values:read` | `{ values: Value[] }` (max 20 metrics) |
| `GET /ext/odata/{Metrics,Sites,Values}` | as above | OData v4 collection `{ '@odata.context', value[], '@odata.count'? }` |

Pinned field-by-field by `tests/api-contract-ext.test.js` (hand-written schemas, no dependency):

- **Metric**: `key`, `name`, `module` (string); `unit`, `window_kind`, `formula` (string or null);
  `higher_is_better` (boolean); `name_fr`, `rag_policy` optional.
- **Site**: `id` (number), `name` (string), `country` (string or null), `active` (boolean). No other field —
  site names are the only names that leave the platform.
- **Value**: `metric`, `module`, `site`, `rag`, `freshness` (`FRESH|STALE|UNKNOWN`), `authoritative`
  (boolean); `site_id` (number, or null for a fleet metric); **`value` is a number or `null` — `null` means
  "not measured", never 0**; a non-authoritative value carries `rag: 'NA'` (its colour moves to `rag_if_fresh`).
- **OData paging**: `$top` (≤ 5000), `$skip`, `$count=true` → `@odata.count` = total before paging.

## Error shape

| Status | When | `/ext/v1` body | `/ext/odata` body |
|---|---|---|---|
| 400 | `?api_key=` in the URL; bad parameters | `{ error: string }` | `{ error: { code: 'INVALID', message: 'invalid query option' } }` |
| 401 | no key / unknown / revoked key | `{ error: 'invalid or revoked API key' }` | same |
| 403 | key lacks the scope | `{ error: 'scope <s> required' }` | same |
| 404 | unknown or unpublished metric | `{ error: 'unknown metric' }` | `{ error: { code: 'NOT_FOUND', … } }` |
| 429 | rate limit or daily quota | `{ error: 'rate limit exceeded', retry_after_sec }` + `Retry-After` | same |
| 5xx | any internal error | `{ error: 'internal_error' }` — never the internal message | `{ error: { code: 'ERR', message: 'internal error' } }` |

Inside the application (`/api/*`) the rule is `services/httpError.fail()`. Hand-written
`res.status(4xx|5xx).json(…)` calls are counted by `tests/error-shape.test.js` (485 on 2026-11-05) with a
ratchet: the count may only go down, every body carries `error`, and no 5xx echoes `e.message`.

## Versioning rule (proposed)

- **Additive** changes stay in `/ext/v1`: a new optional field, a new endpoint, a new metric key, a new
  enum value in a field documented as open (`freshness` is closed — adding a value is breaking).
- **Breaking** = removing or renaming a field, changing a type, turning a nullable field non-null or the
  reverse, changing a status code or the error shape, tightening a scope. A breaking change ships as
  **`/ext/v2`** alongside v1; v1 is never changed in place.
- The contract test is the gate: a change that makes `api-contract-ext.test.js` fail is breaking by
  definition, unless the test is extended for a purely additive field.

## Deprecation process (proposed)

1. Announce v2 + the v1 retirement date to every registered consumer (Admin ▸ API consumers lists them).
2. v1 answers with `Deprecation: true` and `Sunset: <date>` headers for at least one quarter.
3. The call log (`api_call_log`) shows which consumers still call v1; each is contacted by its owner.
4. Retirement is a change request — a person decides it; an agent never removes v1.
