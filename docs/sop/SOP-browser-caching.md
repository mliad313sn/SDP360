# SOP — Browser-side asset caching (URL versioning)

Moved verbatim from `CLAUDE.md` on 2026-10-22 (SDP-DASH-2.0 step 5, lot 5.5). `CLAUDE.md` is now an index; edit THIS file.

---

## Coding Principles — Browser-side asset caching (codified 2026-06-05)

The dashboard uses the **canonical URL-versioning pattern** (the same
approach webpack / vite / Next.js use in production). Every browser-
side asset is referenced from HTML with a `?v=<APP_VERSION>` query
string suffix. The user gets:

- **Zero round-trips** for cached assets on every page load (full
  `immutable` cache hit — browser never even contacts the server).
- **Zero stale risk** — every deploy bumps `APP_VERSION` → all asset
  URLs change → browsers fetch fresh automatically.
- **Zero Ctrl+F5** needed — users never have to manually bust their
  cache.

The HTML itself is `no-cache` so users ALWAYS receive an up-to-date
HTML referencing the current `APP_VERSION`. Combined with the
`immutable, max-age=1year` on versioned assets, this gives optimal
cache utilization AND immediate deploy propagation.

### How it works end-to-end

```
                 ┌─────────────────────────────────────┐
   server boot   │  APP_VERSION = git rev-parse HEAD   │
                 │  (or fallback: 't<epoch-ms>')       │
                 └──────────────┬──────────────────────┘
                                │
                                ▼
                 ┌─────────────────────────────────────┐
   per HTML      │  loadHtml(name) at boot:            │
   page         │   read public/<name>.html           │
                 │   call injectAssetVersion(html)     │
                 │   cache result in _htmlCache        │
                 └──────────────┬──────────────────────┘
                                │
                                ▼
   browser GET /index.html       Response (no-cache):
                                 <script src="auth.js?v=abc123">
                                 <link href="_tokens.css?v=abc123">

   browser GET /auth.js?v=abc123  Response (immutable, 1 year):
                                 → browser caches under URL key
                                 → next load: served from cache,
                                   ZERO server contact

   --- deploy happens, APP_VERSION = def456 ---
   browser GET /index.html       Response (no-cache, NEW VERSION):
                                 <script src="auth.js?v=def456">
                                                          ^^^^^^

   browser sees a URL it doesn't have cached → fetches fresh.
   Old auth.js?v=abc123 sits dormant in cache until LRU eviction.
```

### When adding a new HTML page

Just add it to the `_htmlCache` boot-load list and add a route handler
that calls `sendHtmlPage()`. **DO NOT serve protected HTMLs via
`express.static`** — `injectAssetVersion` only runs at `loadHtml` time
on cached HTMLs.

```js
// 1. Add to the boot-load list at server.js (in the _htmlCache block):
['executive.html', ..., 'my-new-page.html'].forEach(loadHtml);

// 2. Add a route handler near the other sendHtmlPage handlers:
app.get('/my-new-page.html', (req, res) => {
  sendHtmlPage(res, 'my-new-page.html', false, 'My new page unavailable');
});
//        third arg: injectApiKey — true only if the page needs window.__ak
//                                  (Helpdesk / Executive / Reports / Analytics)
```

That's the only required wiring. `injectAssetVersion` runs at boot,
your `<script src>` and `<link href>` references automatically pick up
`?v=APP_VERSION`.

### When adding a new client-side JS / JSX / CSS file

Reference it from HTML with a relative path — no special treatment
needed:

```html
<script src="my-module/widget.js"></script>
<link rel="stylesheet" href="my-module/styles.css">
```

At boot, the cached HTML becomes:

```html
<script src="my-module/widget.js?v=abc123"></script>
<link rel="stylesheet" href="my-module/styles.css?v=abc123">
```

When the browser requests `/my-module/widget.js?v=abc123`, the static
handler sees the `?v=` query and serves with `Cache-Control: public,
max-age=31536000, immutable`. Cached forever, auto-invalidated next
deploy.

### What gets injected (and what's left alone)

`injectAssetVersion` (at `server.js:~982`) handles two tag families:

| Tag | Rule |
|---|---|
| `<script src="…">` | Inject if local path. Skip if URL starts with `http://`, `https://`, `//`, `data:`, `#`, `mailto:`, or already has `?`. |
| `<link href="…" rel="…">` | Inject only if `rel` is `stylesheet`, `preload`, `prefetch`, or `modulepreload`. Same local-only rules. Skip `rel="icon"` (favicons are too small to cache-bust meaningfully). |

**NOT injected** (these need different cache-busting strategies if
they ever matter):
- `<img src="…">` — images rarely change across deploys
- `<video src>`, `<audio src>`, `<source src>`
- `<iframe src>` — those are full pages, not assets
- Inline `<style>` blocks
- Dynamically-built script tags (added via JS at runtime)
- Background images set via CSS `url(…)`

If you need to bust a CSS-referenced asset, build the asset URL in JS
with `?v=<APP_VERSION>` (exposed to browser via `window.__appVersion`
— TODO if needed).

### Anti-patterns to avoid

| Anti-pattern | Why it's a problem | Do instead |
|---|---|---|
| Serving an HTML via `express.static` instead of `sendHtmlPage` | `injectAssetVersion` runs in `loadHtml`. A page served by `express.static` skips that injection and loses cache busting. | Add a route handler with `sendHtmlPage` for every HTML in `public/`. |
| Hardcoding a CDN URL with `?v=…` already in the source | The injector skips URLs that already contain `?`. If you add `auth.js?fallback=true`, the injector won't add `?v=…` — and the file may go stale. | Don't put query strings in `<script src>` source. Add them only at HTTP-request time if dynamic params are needed. |
| Inlining critical JS in `<script>…</script>` blocks | Inline scripts can't be URL-versioned — they're part of the HTML. If the HTML is cached server-side (it is — `_htmlCache`), the inline script only refreshes on `pm2 reload`. | Move logic to an external `.js` file referenced via `<script src>`. The injector handles the rest. |
| Adding assets referenced via `fetch('/something.js')` from another script | Dynamic fetches don't go through HTML injection. The browser fetches the raw URL → falls through to the `Tier A/B/C` safety net (typically 1-day cache). | Either: (a) reference via `<script src>` so injection applies, or (b) manually append `?v=` + `window.__appVersion` in the fetch. |

### Verifying the cache policy applies correctly

In Chrome DevTools → Network tab → reload the page → check the
`Cache-Control` column (right-click column header to enable):

| File | Expected `Cache-Control` | Expected behavior |
|---|---|---|
| Any `.html` page | `no-cache, must-revalidate` | Status `200` on every load (HTML is always fresh) |
| Any local asset WITH `?v=…` | `public, max-age=31536000, immutable` | Status `200` on first load post-deploy, then `(memory cache)` or `(disk cache)` with ZERO server contact on subsequent loads |
| Any local asset WITHOUT `?v=…` | falls through to Tier A/B/C safety net | Direct-URL hits only (rare) — Tier A modules get `no-cache`, Tier B `/lib/` gets 5 min, Tier C gets 1 day |
| External CDN (`unpkg.com`, `cdnjs.cloudflare.com`) | CDN-controlled headers | Browser caches per CDN policy (typically 1 year for versioned URLs) |

If you see `(disk cache)` on a `.html` page or `(memory cache)` on an
asset URL that's missing `?v=…`, the injection didn't apply. Possible
causes:
1. HTML is served via `express.static` instead of `sendHtmlPage` →
   add a route handler.
2. HTML isn't in the boot-load list → add it to the `.forEach(loadHtml)`
   array near `server.js:1012`.
3. The asset URL has special characters or already had a `?` → check
   `injectAssetVersion` skip rules.

**To verify the injection ran**: View source on the served HTML
(Ctrl+U). All local `<script src>` and `<link href stylesheet>`
should have `?v=<APP_VERSION>` appended. CDN URLs and favicons should
NOT.

### Fallback safety net (Tier A / B / C)

For asset requests that arrive WITHOUT a `?v=…` query (typically
direct-URL hits or fetches from external tools), the static handler
falls through to a 3-tier policy as defensive backup:

- **Tier A** — `no-cache, must-revalidate` — `.jsx` files and anything
  under `/activity-tracker/`, `/dashboard-preview/`, `/design-system/`.
  Prevents the original "stale React app → data loss" bug from
  reappearing if someone bypasses the HTML-injection path.
- **Tier B** — `public, max-age=300, must-revalidate` — anything under
  `/lib/` + `analyze-lite.js`. Shared display helpers.
- **Tier C** — default `max-age=86400` from `express.static` — brand
  assets, `_shell.*`, `auth.js`, fonts, images, vendored libraries.

In normal use NO request hits this fallback. It's a safety net.

---
