# F2a — Admin-configurable Entra SSO settings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the SDP Entra SSO settings configurable from the admin config page (`reports.html#admin`, super_admin) — DB-backed, `.env` as fallback, no restart — so enabling SSO is paste-in-the-UI + flip a mode, not server file editing.

**Architecture:** `services/ssoEntra.js` is already a pure engine that takes a `cfg` object; `server.js` currently builds that cfg + `SSO_MODE`/`SSO_BREAKGLASS_USER` **once at boot** from `process.env`. This plan moves that to a **request-time resolver** (`services/ssoSettings.js`) that merges `report_config (DB) ?? process.env ?? default`, cached briefly and invalidated on save. The SSO settings (incl. the client secret, handled exactly like the SMTP password) become `report_config` keys editable from a new admin card that mirrors the existing SMTP card.

**Tech Stack:** Node/Express, `services/reportConfig.js` (dual sqlite/pg k/v store), `node --test`, vanilla admin UI in `public/reports.html`.

**Spec:** `docs/superpowers/specs/2026-08-10-meridian-sdp-federation-design.md` §F2a.

---

## File structure

| File | Responsibility |
|---|---|
| `services/reportConfig.js` (modify) | Add 6 `sso_*` keys to `DEFAULTS` (so `setConfig`'s `KEYS.includes` accepts them); extend the blank-means-keep filter to `entra_client_secret`. |
| `services/ssoSettings.js` (**create**) | `resolveSsoSettings(db)` → `{mode, ssoEnabled, breakglassUser, cfg:{tenantId,clientId,clientSecret,redirectUri}, ready}`, merging DB config ?? env ?? default. 60s cache + `invalidate()`. Pure-ish (db injected). |
| `server.js` (modify) | Replace the boot-time `SSO_MODE`/`_ssoCfg`/`SSO_BREAKGLASS_USER` consts + their 4 consumer routes with request-time `await resolveSsoSettings(rdb.db)`; redact `entra_client_secret` in `GET /api/reports/config`; call `ssoSettings.invalidate()` in `PUT /api/reports/config`. |
| `public/reports.html` (modify) | New "🔐 Microsoft Entra SSO" admin card (mirrors `#ap-email`), wired to the 4 admin-panel surfaces, with save/load (secret blank = keep). |
| `tests/sso-settings.test.js` (**create**) | Resolver precedence (DB > env > default), `ready` flag, blank-secret keep, cache invalidation. |

Boot consts to replace (read them first): `server.js:5499-5514`. Consumer routes: `5455` (password login: `SSO_MODE`/breakglass), `5528` (`/api/auth/config`), `5538` (`/api/auth/sso/login`), `5552` (`/api/auth/sso/callback`). Config GET redaction to mirror: `server.js:5104-5107`. Admin-card template: `public/reports.html:1346` (`#ap-email`). The **4 admin-panel surfaces**: `_ADMIN_PANEL_IDS` (`reports.html:5189`), the hash/deep-link allowlist, the rail role-gate `display:none`, and the JS super-gate (grep `ap-scoreboard` — a recent card — to find all four call sites).

---

## Task 1: `reportConfig` — the 6 SSO keys + secret blank-keep

**Files:**
- Modify: `services/reportConfig.js` (`DEFAULTS` ~line 5; `setConfig` blank-keep filter line 90)
- Test: `tests/report-config-sso.test.js` (**create**)

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const os = require('os'), fs = require('fs'), path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'rcfg-sso-'));
process.env.REPORTS_BACKEND = 'sqlite';
const { test } = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const cfg = require('../services/reportConfig');

test('SSO keys are in DEFAULTS (so setConfig accepts them)', () => {
  for (const k of ['sso_mode','entra_tenant_id','entra_client_id','entra_client_secret','entra_redirect_uri','sso_breakglass_user']) {
    assert.ok(k in cfg.DEFAULTS, `${k} missing from DEFAULTS`);
    assert.ok(cfg.KEYS.includes(k), `${k} missing from KEYS`);
  }
});

test('blank entra_client_secret is kept (not wiped), like smtp_pass', () => {
  const db = new Database(':memory:');
  cfg.setConfig(db, { entra_client_secret: 'SECRET-1', entra_client_id: 'cid' }, 'u');
  cfg.setConfig(db, { entra_client_secret: '', entra_client_id: 'cid2' }, 'u'); // blank = keep
  const c = cfg.getConfig(db);
  assert.equal(c.entra_client_secret, 'SECRET-1', 'blank secret must keep the stored value');
  assert.equal(c.entra_client_id, 'cid2', 'other fields still update');
});
```

- [ ] **Step 2: Run — expect FAIL** (`sso_mode missing from DEFAULTS`).
```
node --test --test-force-exit tests/report-config-sso.test.js
```

- [ ] **Step 3: Add the keys to `DEFAULTS`** (in `services/reportConfig.js`, inside the `DEFAULTS` object, with a comment matching the existing style):

```js
  // ── F2a: Entra SSO (admin-configurable; resolved by services/ssoSettings.js as
  //    DB ?? .env ?? default). entra_client_secret is redacted on GET and blank-kept
  //    on save, exactly like smtp_pass. Must live in DEFAULTS or setConfig drops them.
  sso_mode: '', entra_tenant_id: '', entra_client_id: '', entra_client_secret: '',
  entra_redirect_uri: '', sso_breakglass_user: '',
```

- [ ] **Step 4: Extend the blank-means-keep filter** (line ~90):

```js
    .filter(([k, v]) => !((k === 'smtp_pass' || k === 'entra_client_secret') && String(v) === ''));
```

- [ ] **Step 5: Run — expect PASS.**
- [ ] **Step 6: Commit** — `git add services/reportConfig.js tests/report-config-sso.test.js && git commit -m "feat(sso): report_config keys for admin-configurable Entra SSO (secret blank-kept)"`

---

## Task 2: `services/ssoSettings.js` — the request-time resolver (the core)

**Files:**
- Create: `services/ssoSettings.js`
- Test: `tests/sso-settings.test.js` (**create**)

Precedence per field: **non-empty DB config → non-empty env → default**. `getConfig(db)` is dual-backend (sync sqlite / Promise pg), so the resolver is **async** and `await`s it.

- [ ] **Step 1: Write the failing test** (inject a fake `getConfig` so it's DB-free + deterministic):

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { resolveSsoSettings, _invalidate } = require('../services/ssoSettings');

const envStub = { SSO_MODE: 'available', ENTRA_TENANT_ID: 'T-env', ENTRA_CLIENT_ID: 'C-env',
  ENTRA_CLIENT_SECRET: 'S-env', ENTRA_REDIRECT_URI: 'https://env/cb', SSO_BREAKGLASS_USER: 'bg-env' };

test('DB config wins over env when non-empty', async () => {
  _invalidate();
  const db = {}; const getConfig = async () => ({ sso_mode: 'only', entra_tenant_id: 'T-db',
    entra_client_id: '', entra_client_secret: '', entra_redirect_uri: '', sso_breakglass_user: '' });
  const s = await resolveSsoSettings(db, { env: envStub, getConfig });
  assert.equal(s.mode, 'only');              // DB wins
  assert.equal(s.cfg.tenantId, 'T-db');      // DB wins
  assert.equal(s.cfg.clientId, 'C-env');     // DB blank → env
  assert.equal(s.breakglassUser, 'bg-env');  // DB blank → env
});

test('falls to defaults when both DB and env are empty', async () => {
  _invalidate();
  const s = await resolveSsoSettings({}, { env: {}, getConfig: async () => ({}) });
  assert.equal(s.mode, 'off');
  assert.equal(s.ssoEnabled, false);
  assert.equal(s.breakglassUser, 'admin');
  assert.equal(s.cfg.redirectUri, 'https://itops-dashboard.edv-ops.com/api/auth/sso/callback');
  assert.equal(s.ready, false);
});

test('ready is true only when tenant + client + secret all present', async () => {
  _invalidate();
  const getConfig = async () => ({ sso_mode: 'available', entra_tenant_id: 't', entra_client_id: 'c', entra_client_secret: 's' });
  const s = await resolveSsoSettings({}, { env: {}, getConfig });
  assert.equal(s.ready, true);
  assert.equal(s.ssoEnabled, true);
});

test('cache: a second call within TTL does not re-read; invalidate forces re-read', async () => {
  _invalidate();
  let calls = 0; const getConfig = async () => { calls++; return { sso_mode: 'available' }; };
  await resolveSsoSettings({}, { env: {}, getConfig });
  await resolveSsoSettings({}, { env: {}, getConfig });
  assert.equal(calls, 1, 'cached');
  _invalidate();
  await resolveSsoSettings({}, { env: {}, getConfig });
  assert.equal(calls, 2, 're-read after invalidate');
});
```

- [ ] **Step 2: Run — expect FAIL** (module not found).

- [ ] **Step 3: Implement `services/ssoSettings.js`:**

```js
'use strict';
// F2a — resolve Entra SSO settings at REQUEST TIME from report_config (DB) with
// process.env fallback and hardcoded defaults, so the admin config page changes
// take effect without a restart. Cached briefly; invalidate() clears it (called
// after a config save). getConfig(db) is dual-backend (sync sqlite / Promise pg),
// so this is async. Deps are injectable for tests.
const reportConfig = require('./reportConfig');

const DEFAULT_REDIRECT = 'https://itops-dashboard.edv-ops.com/api/auth/sso/callback';
const TTL_MS = 60000;
let _cache = null, _at = 0;

function _pick(dbVal, envVal, def) {
  const d = (dbVal == null ? '' : String(dbVal)).trim();
  if (d) return d;
  const e = (envVal == null ? '' : String(envVal)).trim();
  if (e) return e;
  return def;
}

function _invalidate() { _cache = null; _at = 0; }

// Accept a monotonic clock via deps.now for testability; default Date.now.
async function resolveSsoSettings(db, deps = {}) {
  const env = deps.env || process.env;
  const getConfig = deps.getConfig || ((d) => reportConfig.getConfig(d));
  const now = deps.now ? deps.now() : Date.now();
  if (_cache && (now - _at) < TTL_MS) return _cache;

  const c = (await getConfig(db)) || {};
  let mode = _pick(c.sso_mode, env.SSO_MODE, '').toLowerCase();
  if (!/^(off|available|only)$/.test(mode)) {
    // legacy SSO_ENABLED=true → 'only', else 'off'
    mode = /^(1|true|yes)$/i.test(String(env.SSO_ENABLED || '')) ? 'only' : 'off';
  }
  const cfg = {
    tenantId:     _pick(c.entra_tenant_id,     env.ENTRA_TENANT_ID,     ''),
    clientId:     _pick(c.entra_client_id,     env.ENTRA_CLIENT_ID,     ''),
    clientSecret: _pick(c.entra_client_secret, env.ENTRA_CLIENT_SECRET, ''),
    redirectUri:  _pick(c.entra_redirect_uri,  env.ENTRA_REDIRECT_URI,  DEFAULT_REDIRECT),
  };
  const settings = {
    mode,
    ssoEnabled: mode !== 'off',
    breakglassUser: _pick(c.sso_breakglass_user, env.SSO_BREAKGLASS_USER, 'admin'),
    cfg,
    ready: !!(cfg.tenantId && cfg.clientId && cfg.clientSecret),
  };
  _cache = settings; _at = now;
  return settings;
}

module.exports = { resolveSsoSettings, _invalidate, DEFAULT_REDIRECT };
```

- [ ] **Step 4: Run — expect PASS** (4 tests).
- [ ] **Step 5: Commit** — `git commit -m "feat(sso): ssoSettings resolver — DB ?? env ?? default, cached + invalidatable"`

---

## Task 3: `server.js` — rewire the 4 SSO routes to the resolver

**Files:**
- Modify: `server.js` (boot consts `5499-5514`; routes `5455`, `5528`, `5538`, `5552`; config GET `5104-5107`; config PUT `5112-5113`)
- Test: `tests/sso-routes.smoke.test.js` (existing — extend if present; else add a smoke assert that `/api/auth/config` reflects a saved `sso_mode`)

> This task is mechanical rewiring — no behaviour change when DB config is empty (env still wins). Keep the boot `[SSO]` log but compute it from an initial `await resolveSsoSettings` (best-effort; note it's now dynamic).

- [ ] **Step 1:** At the top of the SSO block, replace the boot consts (`SSO_MODE`, `SSO_ENABLED`, `SSO_BREAKGLASS_USER`, `_ssoCfg`, `_ssoReady`, `5499-5514`) with a require + a boot-time best-effort log:

```js
const ssoSettings = require('./services/ssoSettings');
// SSO settings are resolved per-request now (DB ?? .env ?? default) so the admin
// config page takes effect without a restart. Boot log is best-effort.
ssoSettings.resolveSsoSettings(rdb.db).then(s =>
  console.log(`[SSO] mode=${s.mode} ${s.ssoEnabled ? (s.ready ? '(Entra ready)' : '(NOT configured — set it in reports.html#admin or .env)') : ''}`)
).catch(() => {});
```

- [ ] **Step 2:** In each of the 4 consumer handlers, resolve at request time. Examples:

`/api/auth/config` (make the handler `async`):
```js
app.get('/api/auth/config', async (req, res) => {
  const s = await ssoSettings.resolveSsoSettings(rdb.db);
  res.json({
    mode: s.mode,
    password_login: s.mode !== 'only',
    breakglass_user: s.mode === 'only' ? s.breakglassUser : null,
    // …keep the rest of the existing payload, sourced from `s`…
  });
});
```
`/api/auth/sso/login` (async): `const s = await ssoSettings.resolveSsoSettings(rdb.db);` then use `s.cfg` where `_ssoCfg` was, and guard `if (!s.ready) return res.status(503)…`.
`/api/auth/sso/callback` (already async): same — resolve `s`, use `s.cfg`.
Password login handler (`5455`): resolve `s`, replace `SSO_MODE`→`s.mode`, `SSO_BREAKGLASS_USER`→`s.breakglassUser`.

- [ ] **Step 3:** In `GET /api/reports/config` (`5104-5107`), redact the secret next to the smtp_pass line:
```js
    if (c && c.smtp_pass) c.smtp_pass = '';
    if (c && c.entra_client_secret) c.entra_client_secret = '';   // never expose the stored secret
```

- [ ] **Step 4:** In `PUT /api/reports/config` (`5112`), invalidate the cache after save so UI changes are immediate:
```js
    const out = await reportConfig.setConfig(rdb.db, req.body || {}, req.reportUser?.username);
    require('./services/ssoSettings')._invalidate();
    res.json(out);
```

- [ ] **Step 5:** Boot-check + smoke:
```
node -e "new Function(require('fs').readFileSync('server.js','utf8'))" && echo SYNTAX-OK
node --test --test-force-exit tests/sso-routes.smoke.test.js 2>&1 | grep -E "pass|fail"
```
Expected: syntax OK; the smoke suite that boots the app with SSO off stays green (env-empty ⇒ `mode=off`, identical to today).

- [ ] **Step 6: Commit** — `git commit -m "feat(sso): resolve Entra SSO settings per-request (DB ?? env); redact secret on GET, invalidate on save"`

---

## Task 4: `reports.html` — the "Microsoft Entra SSO" admin card

**Files:**
- Modify: `public/reports.html` (card markup near `#ap-email` `:1346`; `_ADMIN_PANEL_IDS` `:5189`; + the other 3 admin-panel surfaces; the save/load JS)

Mirror the SMTP card exactly (structure, save/load-by-id, secret placeholder "Leave blank to keep the stored secret"). No new endpoint — it reuses `GET`/`PUT /api/reports/config`.

- [ ] **Step 1:** Add the card markup (after `#ap-email`), `super_admin`-gated, ids `cfg-sso-*`:
```html
<div class="card admin-panel" id="ap-sso" data-panel="sso">
  <h3>🔐 Microsoft Entra SSO</h3>
  <p class="muted">Single sign-on for the dashboard. Settings here override <code>.env</code> and take effect without a restart. See docs/SSO_ENTRA_SETUP.md.</p>
  <div class="form-group"><label>Mode</label>
    <select id="cfg-sso-mode"><option value="off">off — password only</option>
      <option value="available">available — Microsoft + password</option>
      <option value="only">only — Microsoft required (break-glass excepted)</option></select></div>
  <div class="form-group"><label>Tenant (Directory) ID</label><input id="cfg-entra-tenant" type="text"></div>
  <div class="form-group"><label>Client (Application) ID</label><input id="cfg-entra-client" type="text"></div>
  <div class="form-group"><label>Client Secret</label><input id="cfg-entra-secret" type="password" placeholder="Leave blank to keep the stored secret"></div>
  <div class="form-group"><label>Redirect URI</label><input id="cfg-entra-redirect" type="text" placeholder="https://itops-dashboard.edv-ops.com/api/auth/sso/callback"></div>
  <div class="form-group"><label>Break-glass username</label><input id="cfg-sso-breakglass" type="text" placeholder="admin"></div>
  <button class="btn" id="cfg-sso-save">Save SSO settings</button>
  <span id="cfg-sso-msg" class="muted" style="font-size:.85rem"></span>
</div>
```

- [ ] **Step 2:** Register the panel in **all four** surfaces (grep `ap-scoreboard` to find each):
  1. `_ADMIN_PANEL_IDS` (`:5189`) — add `sso:'ap-sso'`.
  2. Hash/deep-link allowlist — add `sso`.
  3. Rail role-gate (`display:none` for non-super_admin) — add `#ap-sso` to the super_admin-only set (like System Logs / scoreboard).
  4. JS super-gate — add `ap-sso` where the other super_admin panels are gated.

- [ ] **Step 3:** Load values in the existing config-load function (where `cfg-smtp-*` are populated from `GET /api/reports/config`): set `cfg-sso-mode`, `cfg-entra-tenant`, `cfg-entra-client`, `cfg-entra-redirect`, `cfg-sso-breakglass` from the response; leave `cfg-entra-secret` blank (server redacts it).

- [ ] **Step 4:** Save handler — `PUT /api/reports/config` with only the SSO keys; omit `entra_client_secret` when the field is blank (mirror how SMTP pass is handled):
```js
document.getElementById('cfg-sso-save').onclick = async () => {
  const body = { sso_mode: v('cfg-sso-mode'), entra_tenant_id: v('cfg-entra-tenant'),
    entra_client_id: v('cfg-entra-client'), entra_redirect_uri: v('cfg-entra-redirect'),
    sso_breakglass_user: v('cfg-sso-breakglass') };
  const sec = v('cfg-entra-secret'); if (sec) body.entra_client_secret = sec;
  const r = await putConfig(body);   // reuse the page's existing config-PUT helper
  document.getElementById('cfg-sso-msg').textContent = r ? 'Saved.' : 'Save failed.';
};
```
(Use the page's existing `v(id)` / config-PUT helper names — match what the SMTP card uses.)

- [ ] **Step 5: Browser-verify** (server code + `_htmlCache` → the page must be served fresh): start the dev server, log in as super_admin, open `reports.html#ap-sso`, save `sso_mode=available` + tenant/client, reload → values persist, secret field blank; `GET /api/auth/config` returns `mode:"available"`; console clean. (Reuse the localStorage-session technique from the nav-fix verification if no live login.)

- [ ] **Step 6: Commit** — `git commit -m "feat(sso): admin card for Entra SSO settings (reports.html), 4 panel surfaces + save/load"`

---

## Task 5: Regression, docs, finish

- [ ] **Step 1:** Run the touched + neighbouring suites:
```
node --test --test-force-exit tests/report-config-sso.test.js tests/sso-settings.test.js tests/sso-routes.smoke.test.js tests/report-config.test.js tests/await-precedence.test.js
```
Expected: all green. (`await-precedence` guards the dual-backend `getConfig` await — the resolver awaits it correctly.)

- [ ] **Step 2:** Update `docs/SSO_ENTRA_SETUP.md` — add a short "Option A: configure from the admin page" section (the card at `reports.html#ap-sso`; `.env` still works as fallback; no restart).

- [ ] **Step 3:** Update `CLAUDE.md` Current-state with a one-paragraph F2a summary + a Known-Pitfalls row: *"SSO settings are resolved per-request via `services/ssoSettings.js` (DB ?? env ?? default), cached 60s — a config save MUST call `ssoSettings._invalidate()` or the change lags up to 60s; the `entra_client_secret` is redacted on GET + blank-kept on save like `smtp_pass` (omit it from the PUT to keep the stored value)."*

- [ ] **Step 4:** Build the deploy ZIP (server code + `_htmlCache` HTML → `pm2 stop`→wait→`start`). Note in the handoff: **no `.env` change needed** — after deploy, the admin pastes the Entra IDs in the card once the app registration lands.

- [ ] **Step 5: Finish the branch** — REQUIRED SUB-SKILL: superpowers:finishing-a-development-branch.

---

## Notes / guardrails
- **No behaviour change when DB config is empty** — env still wins, so an un-configured prod stays exactly as today (`mode=off`). This is the safety property; the smoke suite proves it.
- **Secret handling is load-bearing**: redact on GET (Task 3.3), blank-keep on save (Task 1.4 + Task 4.4). Miss either and the secret leaks to the browser or gets wiped on the next save.
- **Cache invalidation is load-bearing**: the PUT route must call `_invalidate()` (Task 3.4) or admins see a ≤60s lag after saving.
- **YAGNI:** no per-field validation UI, no "test SSO connection" button (out of scope; the `/api/auth/sso/login` flow is the test). No encryption-at-rest for the secret (Option A accepted the DB-dump tradeoff).
