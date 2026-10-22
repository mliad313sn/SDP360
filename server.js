/**
 * Endeavour Mining — Analytics Plus Proxy Server v9
 * CHANGED: Survey now reads from Analytics Plus view 106803000000002079
 *          (Overall Score field = percentage string e.g. "100%", "80%")
 *          Survey data read directly from Analytics Plus view — no separate survey API needed
 */

require('dotenv').config();
const express = require('express');
const axios   = require('axios');
const cors    = require('cors');
const cron    = require('node-cron');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');

// ── STARTUP VALIDATION — fail closed if secrets are missing ───────
// SECURITY: We refuse to start rather than silently running open.
const REQUIRED_ENV = ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN', 'DASH_USER', 'DASH_PASS'];
let _startupOk = true;
REQUIRED_ENV.forEach(k => {
  if (!process.env[k]) {
    console.error(`[STARTUP] FATAL: Required environment variable ${k} is not set in .env`);
    _startupOk = false;
  }
});
if (process.env.DASH_PASS && process.env.DASH_PASS.length < 12) {
  console.error('[STARTUP] FATAL: DASH_PASS must be at least 12 characters. Please update your .env file.');
  _startupOk = false;
}
if (!_startupOk) {
  console.error('[STARTUP] Refusing to start with missing/invalid configuration. Fix .env and restart.');
  process.exit(1);
}

// ── SECURITY CONFIG ───────────────────────────────────────────────
// Basic Auth — set DASH_USER / DASH_PASS in .env (both required, min 12 chars for DASH_PASS)
const DASH_USER = process.env.DASH_USER;
const DASH_PASS = process.env.DASH_PASS;

// Internal API key — derived from Zoho secret so no extra config needed,
// or override with DASHBOARD_API_KEY in .env
const DASH_API_KEY = process.env.DASHBOARD_API_KEY ||
  crypto.createHmac('sha256', process.env.ZOHO_CLIENT_SECRET || 'fallback-secret')
        .update('endeavour-dashboard-internal-key')
        .digest('hex')
        .slice(0, 32);

// ── PII COLUMN BLOCKLIST ──────────────────────────────────────────
// Columns matching these patterns are stripped from ALL API responses
// before data leaves the server. Keep names (Technician/Requester) — remove contact/identity info.
const PII_BLOCKED_PATTERNS = [
  /email/i,
  /\bphone\b/i,
  /mobile/i,
  /\bfax\b/i,
  /position/i,
  /designation/i,
  /job[\s_-]?title/i,
  /employee[\s_-]?id/i,
  /employee[\s_-]?no/i,
  /staff[\s_-]?id/i,
  /login[\s_-]?name/i,
  /national[\s_-]?id/i,
  /passport/i,
  /date[\s_-]?of[\s_-]?birth/i,
  /\bdob\b/i,
  /\bgender\b/i,
  /\baddress\b/i,
  /postal/i,
  /zip[\s_-]?code/i,
];

function stripPiiColumns(rows) {
  if (!rows || rows.length === 0) return rows;
  // Identify blocked column names from first row
  const allCols   = Object.keys(rows[0]);
  const blocked   = allCols.filter(col => PII_BLOCKED_PATTERNS.some(p => p.test(col)));
  if (blocked.length === 0) return rows;
  console.log(`[PII-strip] Removing columns: ${blocked.join(', ')}`);
  return rows.map(row => {
    const clean = Object.assign({}, row);
    blocked.forEach(col => delete clean[col]);
    return clean;
  });
}

const app  = express();
const PORT = process.env.PORT || 3456;
// BIND_HOST controls which network interface the Node server listens on.
//   undefined / '0.0.0.0' — listen on all interfaces (legacy default; the
//                           dashboard is reachable directly at the host's
//                           public IP — only safe BEFORE IIS reverse proxy
//                           is in place).
//   '127.0.0.1'           — listen on localhost only. After IIS is wired
//                           in front of the app for TLS termination, set
//                           BIND_HOST=127.0.0.1 in the environment so the
//                           Node process can ONLY be reached through IIS.
//                           External machines hitting :3456 directly get
//                           connection refused. See docs/INTERNAL_TLS_SETUP.md.
const BIND_HOST = process.env.BIND_HOST || '0.0.0.0';

// Session-cookie Secure flag. Default false so login still works over plain
// HTTP on the internal LAN (direct :3456). Set SESSION_COOKIE_SECURE=1 once the
// dashboard is reached over HTTPS (IIS/TLS termination) so the report_token
// cookie is only ever transmitted over HTTPS. Flip via .env + pm2 reload — no
// code change, and only do it when NO client still uses plain HTTP.
const SESSION_COOKIE_SECURE = process.env.SESSION_COOKIE_SECURE === '1'
  || /^true$/i.test(process.env.SESSION_COOKIE_SECURE || '');
// Step 4 (SDP-DASH-2.0): one place for the session cookie. Secure is set whenever the request
// arrived over HTTPS (IIS sends X-Forwarded-Proto, trusted from loopback) even without the env
// flag; HttpOnly + SameSite=Lax always.
function _sessionCookieOpts(req) {
  return { httpOnly: true, secure: SESSION_COOKIE_SECURE || !!(req && req.secure), sameSite: 'lax', maxAge: 24 * 60 * 60 * 1000 };
}

// ── PROXY AWARENESS ────────────────────────────────────────────────
// IIS in front of Node will forward requests with these headers:
//   X-Forwarded-For   — original client IP
//   X-Forwarded-Proto — 'https' (so req.secure / req.protocol stay correct)
//   X-Forwarded-Host  — original Host the browser asked for
// Express's `trust proxy` setting tells it to honour those headers when
// computing req.ip / req.protocol / req.secure / req.hostname. We trust
// only the loopback proxy (the IIS instance on the same box); we do NOT
// trust X-Forwarded-* from arbitrary upstream — that would let any
// client lie about their IP.
app.set('trust proxy', 'loopback');

// ── SAFE ERROR HELPER ─────────────────────────────────────────────
// SECURITY: Never leak internal error details, stack traces, or upstream
// API responses to the client in production.
const IS_DEV = process.env.NODE_ENV === 'development';
function safeError(err, res, fallbackStatus = 500) {
  const status = err.response?.status || fallbackStatus;
  console.error('[API Error]', err.message, err.response?.data || '');
  res.status(status).json({
    error: IS_DEV ? err.message : 'An internal error occurred. Please try again.',
    ...(IS_DEV && { details: err.response?.data }),
  });
}

// ── SECURITY HEADERS MIDDLEWARE ───────────────────────────────────
// SECURITY: Applied before all routes. Prevents clickjacking, MIME sniffing,
// XSS via inline scripts (CSP), and hides server technology fingerprint.
// CSP uses 'unsafe-inline' for script-src because the dashboard has many inline
// onclick/onchange event handlers throughout the HTML that a nonce cannot cover
// (CSP nonces apply only to <script> tags, not event handler attributes).
// The nonce is still generated and used for the window.__ak injection script,
// but CSP enforcement relies on 'unsafe-inline' + domain allowlist.
// This is appropriate for an internal private-network dashboard.
app.use((req, res, next) => {
  // Generate a nonce — still used to inject window.__ak into HTML pages
  const nonce = crypto.randomBytes(16).toString('base64');
  res.locals.nonce = nonce;

  // Prevent this page being embedded in an <iframe> on another site (clickjacking)
  res.setHeader('X-Frame-Options', 'DENY');
  // Prevent browser guessing content-type (MIME sniffing)
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Basic XSS filter for old browsers
  res.setHeader('X-XSS-Protection', '1; mode=block');
  // Don't send Referer to third-party origins
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Content-Security-Policy — 'unsafe-inline' required for inline event handlers
  // (onclick/onchange attributes). CDN domains allowlisted for external libraries.
  // style-src keeps 'unsafe-inline' (many inline styles throughout).
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' cdn.jsdelivr.net cdnjs.cloudflare.com",
    "style-src 'self' 'unsafe-inline' fonts.googleapis.com cdn.jsdelivr.net cdnjs.cloudflare.com",
    "font-src 'self' fonts.gstatic.com data:",
    "img-src 'self' data:",
    // inspection.html ships its PWA manifest as an inline `data:` URL so the
    // form can be Add-to-Home-Screen-installed on phones without a separate
    // asset. Allowing `data:` here silences the manifest CSP block.
    "manifest-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; '));
  // Remove X-Powered-By to hide the tech stack
  res.removeHeader('X-Powered-By');
  next();
});

// ── CSP override for design-system previews ─────────────────────────────────
// /dashboard-preview/ and /design-system/ are static review artefacts shipped
// with the design system handoff. The dashboard preview loads React + Babel
// from unpkg.com and transforms .jsx at runtime via Babel standalone, which
// needs 'unsafe-eval' and the unpkg.com origin in script-src. Rather than
// loosen the GLOBAL CSP (which protects all the actual dashboard pages), we
// install a path-scoped override that runs AFTER the global one and replaces
// the header on those two prefixes only. The production pages keep their
// hardened CSP unchanged.
app.use((req, res, next) => {
  // 2026-05-24: /activity-tracker.html and the per-page asset bundle in
  // /activity-tracker/ joined the React+CDN+Babel club when the IT
  // Activity Tracker was rewritten to share the design system with the
  // preview. Same trade-off as before — auth-gated page, 'unsafe-eval'
  // only on this path, not the global dashboard surface.
  const path = req.path;
  const isPreviewLike =
    path.startsWith('/dashboard-preview') ||
    path.startsWith('/design-system') ||
    path === '/activity-tracker.html' ||
    path.startsWith('/activity-tracker/');
  // Step 4: pages written without inline script get the STRICT policy (services/cspPolicy.js).
  const _csp = require('./services/cspPolicy');
  if (_csp.STRICT_PAGES.has(path)) res.setHeader('Content-Security-Policy', _csp.strictHeader(res.locals && res.locals.nonce));
  if (isPreviewLike) {
    // Step 5 (2026-10-21/22): every JSX page is compiled ahead of time
    // (tools/build/build-frontend.js), so none of them needs 'unsafe-eval' any more.
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' unpkg.com cdn.jsdelivr.net cdnjs.cloudflare.com",
      "style-src 'self' 'unsafe-inline' fonts.googleapis.com",
      "font-src 'self' fonts.gstatic.com data:",
      "img-src 'self' data:",
      "connect-src 'self' unpkg.com",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join('; '));
  }
  next();
});

// ── IN-MEMORY RATE LIMITER ────────────────────────────────────────
// SECURITY: Lightweight token-bucket rate limiter — no extra npm package needed.
// Tracks request counts per IP in a Map with automatic expiry.
function makeRateLimiter({ windowMs, max, message }) {
  const _hits = new Map();
  // Clean up old entries every windowMs to prevent memory leak
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of _hits) {
      if (now - entry.start > windowMs) _hits.delete(key);
    }
  }, windowMs).unref();

  return (req, res, next) => {
    const ip  = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = _hits.get(ip);
    if (!entry || now - entry.start > windowMs) {
      _hits.set(ip, { start: now, count: 1 });
      return next();
    }
    entry.count++;
    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

// Global limiter — 300 requests per 15 minutes per IP
const globalLimiter = makeRateLimiter({
  windowMs: 15 * 60 * 1000, max: 300,
  message: 'Too many requests. Please wait a few minutes and try again.',
});

// Strict AI limiter — 30 calls per hour per IP (each call has real cost)
const aiLimiter = makeRateLimiter({
  windowMs: 60 * 60 * 1000, max: 30,
  message: 'AI analysis rate limit reached. Maximum 30 analyses per hour.',
});

// Login limiter — 10 attempts per 15 minutes per IP (in memory; the persistent per-account
// throttle in the login route is the second layer). Bypassed with the test switch below.
const _loginLimiterMem = makeRateLimiter({
  windowMs: 15 * 60 * 1000, max: 10,
  message: 'Too many login attempts. Please wait 15 minutes before trying again.',
});
const loginLimiter = (req, res, next) => (_noRateLimit ? next() : _loginLimiterMem(req, res, next));

// Apply global limiter to all routes (except /health which is polled by Docker)
// SDP_TEST_NO_RATE_LIMIT=1 lets the route-authorization test sweep every route (hundreds of calls);
// it is IGNORED in production mode (REQUIRE_POSTGRES=1) so it can never weaken a live server.
const _noRateLimit = process.env.SDP_TEST_NO_RATE_LIMIT === '1' && process.env.REQUIRE_POSTGRES !== '1';
app.use((req, res, next) => {
  if (req.path === '/health' || _noRateLimit) return next();
  globalLimiter(req, res, next);
});

// ── CONFIG ────────────────────────────────────────────────────────
const CONFIG = {
  clientId:      process.env.ZOHO_CLIENT_ID,
  clientSecret:  process.env.ZOHO_CLIENT_SECRET,
  refreshToken:  process.env.ZOHO_REFRESH_TOKEN,
  workspaceId:   process.env.WORKSPACE_ID || '106803000000002012',
  orgId:         process.env.ORG_ID       || '878991289',
  // Anthropic API key — used for AI analysis features (Claude "Analyze" buttons)
  // Add ANTHROPIC_API_KEY=sk-ant-... to your .env file
  anthropicKey:  process.env.ANTHROPIC_API_KEY || '',
  // Survey data — read from Analytics Plus view, no separate survey API needed
  // Get it from: https://survey.zoho.com/api/v1/surveys (list all surveys)
  surveyId:      process.env.ZOHO_SURVEY_ID || null,
  zohoAccounts:  'https://accounts.zoho.com/oauth/v2/token',
  analyticsApi:  'https://analyticsplusapi.manageengine.com/restapi/v2',
  surveyApi:     'https://survey.zoho.com/api/v1',
  tokenFile:     path.join(__dirname, '.token_cache.json'),
};

// Zoho Analytics connection — admin-editable since 2026-10-04 (Admin ▸ Intégration API ▸
// Analytics): each value resolves database → .env → default (services/analyticsSettings).
// Applied onto CONFIG (which every Analytics call reads at request time) before each token
// refresh and after each save. DASH_API_KEY above stays .env-derived on purpose.
async function _applyAnalyticsSettings() {
  const s = await require('./services/analyticsSettings').resolveAnalyticsSettings();
  CONFIG.clientId = s.clientId; CONFIG.clientSecret = s.clientSecret; CONFIG.refreshToken = s.refreshToken;
  CONFIG.workspaceId = s.workspaceId; CONFIG.orgId = s.orgId;
  CONFIG.zohoAccounts = `${s.accountsUrl}/oauth/v2/token`;
  return s;
}

// ── CACHES ────────────────────────────────────────────────────────
const _rowCache    = new Map();
// _surveyCache lives in routes/survey.js (read by /health through _surveyRouter.helpers)

const getCached = (k) => {
  const e = _rowCache.get(k);
  if (!e) return null;
  if (Date.now() - e.ts > 300000) { _rowCache.delete(k); return null; }
  return e.data;
};
const setCache = (k, d) => _rowCache.set(k, { ts: Date.now(), data: d });

// ── VIEW ID MAP ────────────────────────────────────────────────────
const VIEWS = {
  REQUEST_TABLE:         '106803000000002201',
  CHANGE_TABLE:          '106803000000002044',
  WORKLOG_TABLE:         '106803000000002203',
  MONTHLY_TICKET_TREND:  '106803000000002320',
  INCOMING_VS_RESOLVED:  '106803000000002270',
  MONTHLY_SUMMARY_PREBUILT: '106803000000644288',
  SLA_COMPLIANCE_TREND:  '106803000000002234',
  SLA_BY_CATEGORY:       '106803000000002312',
  SLA_BY_CATEGORY_WEEK:  '106803000000829506',
  SLA_VIOLATED_BY_CAT:   '106803000000953051',
  AGEING_BY_SITE:        '106803000000141197',  // Use Ageing Summary — has Site+Group+Tier+TotalRequests (803585 is chart-only, no Site col)
  AGEING_SUMMARY:        '106803000000141197',
  FIRST_RESPONSE_TREND:  '106803000000002215',
  RESOLUTION_BY_SITE:    '106803000000002279',
  BACKLOG_TREND:         '106803000000002216',
  INCIDENTS_VOLUME:      '106803000000168161',
  CHANGES_BY_STAGE:      '106803000000002139',
  CHANGES_BY_STAGE_IT:   '106803000000560846',
  EMERGENCY_CHANGES:     '106803000001137889',
  CAB_COMPLIANCE:        '106803000001137789',
  CAB_APPROVAL_DETAILS:  '106803000000002138',
  CAB_RECOMMENDATIONS:   '106803000000002048',
  INCIDENT_VS_SR:        '106803000000002237',
  MAJOR_INCIDENTS:       '106803000000790842',
  MAJOR_INC_BY_MONTH:    '106803000000691477',
  MAJOR_INC_BY_CAT:      '106803000000691124',
  MAJOR_INC_BY_SITE:     '106803000000693050',
  GROUP_REQUEST_COUNT:   '106803000000002275',
  REQUEST_VOLUME_TREND:  '106803000000644288',
  AGEING_BY_GROUP:       '106803000000141197',
  SLA_BY_GROUP:          '106803000000002448',
  // Assets module (Foundation) — view ids are also self-contained in assets-sync's
  // ASSET_VIEWS; listed here for discoverability/parity with the other synced views.
  ASSET_ASSETS:          '106803000000002058',
  ASSET_MEMORY:          '106803000000002066',
  ASSET_LOGICAL_DRIVES:  '106803000000002064',
  ASSET_MONITORS:        '106803000000002067',
  ASSET_LICENSES:        '106803000000002074',
};

// ── TOKEN ─────────────────────────────────────────────────────────
// SECURITY: Access tokens are kept in memory ONLY — never written to disk.
// The refresh_token (long-lived) lives in .env which is protected by .gitignore.
// Purge any legacy token cache file left over from a previous deployment.
let tokenState = { accessToken: null, expiresAt: 0, refreshCount: 0, grantedScope: null, lastRefreshError: null };
if (fs.existsSync(CONFIG.tokenFile)) {
  try {
    fs.unlinkSync(CONFIG.tokenFile);
    console.log('[Token] Removed legacy .token_cache.json — using in-memory token only.');
  } catch(e) {
    console.warn('[Token] Could not delete legacy token cache file:', e.message);
  }
}

// ── Token-refresh circuit breaker (2026-05-27) ──────────────────────────
// Zoho's accounts.zoho.com OAuth endpoint applies workspace-level rate limits.
// When tripped, it returns 400 with body { error: 'Access Denied',
// error_description: 'You have made too many requests continuously...' }.
// Earlier today we accidentally amplified the limit window by repeatedly
// retrying (pm2 restarts + cron + manual triggers each pushed another call).
// The breaker below detects the rate-limit signature and short-circuits
// subsequent refresh attempts during an exponential backoff window —
// 60s → 2min → 4min → ... capped at 60min. Reset on first successful refresh.
const _refreshBreaker = { until: 0, attempts: 0, lastSignature: null };

async function refreshAccessToken() {
  // Short-circuit if breaker is open
  if (Date.now() < _refreshBreaker.until) {
    const waitSec = Math.ceil((_refreshBreaker.until - Date.now()) / 1000);
    const msg = `Rate-limit backoff in effect (${waitSec}s remaining, attempt #${_refreshBreaker.attempts}). Skipping refresh — Zoho previously returned: ${_refreshBreaker.lastSignature || 'rate-limit'}.`;
    console.warn(`[Token] ⏸ ${msg}`);
    throw new Error(msg);
  }

  console.log('[Token] Refreshing…');
  try { await _applyAnalyticsSettings(); } catch (e) { /* keep the current CONFIG */ }
  if (!CONFIG.clientId || !CONFIG.clientSecret || !CONFIG.refreshToken) {
    throw new Error('Zoho Analytics credentials missing — fill Admin ▸ Intégration API ▸ Analytics (or .env ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN)');
  }
  let res;
  try {
    res = await axios.post(CONFIG.zohoAccounts, new URLSearchParams({
      grant_type: 'refresh_token',
      client_id:     CONFIG.clientId,
      client_secret: CONFIG.clientSecret,
      refresh_token: CONFIG.refreshToken,
    }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  } catch (err) {
    // Zoho returns 400 with an `error` field (e.g. invalid_code, invalid_client,
    // access_denied) when the refresh-token exchange itself is rejected. The
    // generic axios message ('Request failed with status code 400') hides
    // this — surface the body so the operator sees WHICH OAuth error it is.
    if (err.response && err.response.data) {
      const body = typeof err.response.data === 'string'
        ? err.response.data
        : JSON.stringify(err.response.data);
      tokenState.lastRefreshError = body;
      console.error(`[Token] ❌ OAuth refresh failed (HTTP ${err.response.status}): ${body}`);
      const oauthError = (err.response.data && err.response.data.error) || '';
      const errDesc    = (err.response.data && err.response.data.error_description) || '';

      // Detect rate-limit signature and arm the breaker. Two signatures observed
      // from accounts.zoho.com: explicit "Access Denied" (this incident),
      // and "too_many_requests" (Zoho docs reference). Catch both + a textual
      // fallback in case Zoho changes wording.
      const isRateLimit =
        oauthError === 'Access Denied' ||
        oauthError === 'too_many_requests' ||
        /too many requests|rate limit|try again after/i.test(errDesc);

      if (isRateLimit) {
        _refreshBreaker.attempts++;
        // Exponential backoff: 60s → 120s → 240s → ... capped at 60min
        const waitMs = Math.min(60 * 60 * 1000, 60_000 * Math.pow(2, _refreshBreaker.attempts - 1));
        _refreshBreaker.until = Date.now() + waitMs;
        _refreshBreaker.lastSignature = (oauthError || '') + ' — ' + (errDesc || '').slice(0, 80);
        console.error(`[Token] 🛑 Rate-limit detected — circuit breaker armed for ${Math.ceil(waitMs/60000)} min (attempt #${_refreshBreaker.attempts}). Subsequent refresh calls will be skipped until ${new Date(_refreshBreaker.until).toLocaleTimeString()}.`);
        console.error('[Token] → Recommendation: pm2 stop endeavour-dashboard for 60+ min to let Zoho rate-limit clear, then pm2 start (single command, no restarts).');
      } else if (oauthError === 'invalid_code') {
        console.error('[Token] → invalid_code = refresh token rejected by Zoho. Renew it: see RENEW_ZOHO_TOKEN.html (Steps 2–6). Most common cause: account password change, app revoked in API console, or scope was wrong when token was issued.');
      } else if (oauthError === 'invalid_client') {
        console.error('[Token] → invalid_client = ZOHO_CLIENT_ID or ZOHO_CLIENT_SECRET in .env does not match the Self Client. Verify both in https://api-console.zoho.com → Self Client → Client Secret tab.');
      } else if (oauthError === 'access_denied') {
        console.error('[Token] → access_denied = refresh token was revoked. Re-mint via RENEW_ZOHO_TOKEN.html.');
      } else if (oauthError === 'invalid_request') {
        console.error('[Token] → invalid_request = malformed payload (extremely rare — check that .env values are not blank or quoted).');
      }
      throw new Error(`OAuth ${err.response.status}: ${body}`);
    }
    throw err;
  }
  // Successful response — but only treat as success if access_token actually present.
  // We reset the breaker AFTER the access_token check below.
  if (!res.data.access_token) {
    tokenState.lastRefreshError = JSON.stringify(res.data);
    throw new Error(`No access_token: ${JSON.stringify(res.data)}`);
  }
  tokenState.accessToken = res.data.access_token;
  tokenState.expiresAt   = Date.now() + (res.data.expires_in || 3600) * 1000 - 60000;
  tokenState.grantedScope = res.data.scope || null;
  tokenState.lastRefreshError = null;
  tokenState.refreshCount++;
  // Reset circuit breaker — Zoho is happy with us again
  if (_refreshBreaker.attempts > 0) {
    console.log(`[Token] ✅ Rate-limit circuit breaker reset (was on attempt #${_refreshBreaker.attempts}).`);
  }
  _refreshBreaker.until = 0;
  _refreshBreaker.attempts = 0;
  _refreshBreaker.lastSignature = null;
  // SECURITY: Token stored in memory only — no disk write.
  // Required scope: MEAplus.fullaccess.all
  // DO NOT use: ZohoAnalytics.* (wrong workspace — INVALID_OAUTHSCOPE 8540),
  //             MEAplus.data.read,MEAplus.metadata.read (triggers SECURITY_NOT_PERMITTED 7301 on
  //             Survey Results / REQUEST_TABLE / MAJOR_INCIDENTS views — confirmed 2026-05-27).
  console.log(`[Token] ✅ Refreshed #${tokenState.refreshCount}, expires ${new Date(tokenState.expiresAt).toLocaleTimeString()} | granted scope: ${res.data.scope || 'not returned'}`);
  if (res.data.scope && !res.data.scope.includes('MEAplus.fullaccess')) {
    console.warn('[Token] ⚠️  Scope is NOT MEAplus.fullaccess.all — Survey Results / REQUEST_TABLE / MAJOR_INCIDENTS views will likely 403 with errorCode 7301. Renew token using RENEW_ZOHO_TOKEN.html.');
  }
  return tokenState.accessToken;
}

// Promise mutex — prevents thundering-herd when multiple concurrent requests
// all find the token expired at the same moment and each try to refresh it.
// Without this, 7 simultaneous dashboard fetches → 7 simultaneous Zoho OAuth calls
// → Zoho may revoke the refresh token as suspicious activity.
let _tokenRefreshInFlight = null;

async function getValidToken() {
  if (tokenState.accessToken && Date.now() < tokenState.expiresAt) {
    return tokenState.accessToken;   // token is valid — serve immediately
  }
  // Token expired (or missing) — serialise all callers behind a single refresh
  if (!_tokenRefreshInFlight) {
    _tokenRefreshInFlight = refreshAccessToken().finally(() => {
      _tokenRefreshInFlight = null;  // clear mutex once done (success or failure)
    });
  }
  return _tokenRefreshInFlight;      // all concurrent callers share the same promise
}

// Token refresh every 50 min — now the 'zoho.token' job of the sync runner (services/sync/jobs.js).

// ── BACKGROUND SYNC JOBS ──────────────────────────────────────────
const sync = require('./zoho-sync');
sync.init(fetchView, VIEWS);

// Assets sync (Foundation) — stash fetchView; view ids are self-contained in ASSET_VIEWS.
require('./assets-sync').init(fetchView, VIEWS);
// All scheduled jobs (assets 04:30, Meridian 05:00, OpManager 05:10, Meraki WAN 05:20 + events
// every 5 min and 05:25, Teams SLA + WAN poller every 5 min) are declared in services/sync/jobs.js
// and run by the sync runner (lock, retries, run log, health, alerts) — see the block below.

// ── SYNC RUNNER (SDP-DASH-2.0, step 1) ────────────────────────────────────
// Every scheduled job runs through ONE runner: overlap lock, retries with backoff on transient
// errors (Retry-After honoured), one sync_runs row per run, failures mirrored to the System Log,
// an alert after 2 consecutive failures and on staleness (armed OFF: sync_alert_enabled /
// sync_alert_teams). Schedules are unchanged: requests :45, change_cab :30, survey :00, ticket
// cache :20, nightly cache reset 03:15, token every 50 min (see services/sync/jobs.js).
// Health: GET /api/sync/health (System Logs ▸ Sync health).
const _syncStore = require('./services/sync/store');
const syncRunner = require('./services/sync/runner').createRunner({
  store: _syncStore,
  logEvent: (ev) => { try { require('./reports-db').logEvent(ev); } catch (_) {} },
  alert: require('./services/sync/alerts').buildAlerter(),
  failureThreshold: Number(process.env.SYNC_ALERT_AFTER_FAILURES) || 2,
});
require('./services/sync/jobs').buildJobs({
  sync, fetchView,
  refreshToken: () => refreshAccessToken(),
  refreshRawCache: () => _backgroundRefreshRawCache(),
  clearRawCache: () => { _rawCache.data = null; _rawCache.ts = 0; },
}).forEach(j => syncRunner.register(j));
require('./services/sync/schedule').start({
  runner: syncRunner, cron, store: _syncStore,
  loadMetadata: () => require('./reports-db').getSyncStatus(),
});

// ── ZOHO VIEW SCHEMA HEALTH CHECK ────────────────────────────────────────────
// Validates that the most critical Zoho Analytics views still return the expected
// columns. Silent schema changes in Zoho AP are detected here before they cause
// confusing empty or NaN KPIs on the dashboard.
// Called on startup (after token refresh) and exposed via /api/health/views.
const VIEW_SCHEMA = {
  REQUEST_TABLE: {
    viewId: VIEWS.REQUEST_TABLE,
    required: ['Request ID','Created Time','Group','Request Pending Status','Request Status',
               'Time to Respond in Hrs','First Response Overdue Status','Reopen Count'],
  },
  CHANGE_TABLE: {
    viewId: VIEWS.CHANGE_TABLE,
    required: ['Change ID','Change Type','Status','Stage','Created Time'],
  },
  AGEING_BY_GROUP: {
    viewId: VIEWS.AGEING_BY_GROUP,
    required: ['Group','Total Requests'],
  },
};

async function checkZohoViewSchema() {
  let token;
  try { token = await getValidToken(); } catch(e) {
    console.warn('[ViewSchemaCheck] Cannot get token:', e.message); return [];
  }
  const results = [];
  for (const [name, spec] of Object.entries(VIEW_SCHEMA)) {
    try {
      const url = `${CONFIG.baseUrl}/views/${spec.viewId}?ZOHO_ACTION=EXPORT&ZOHO_OUTPUT_FORMAT=CSV&ZOHO_ERROR_FORMAT=JSON&ZOHO_API_VERSION=1.0&ZOHO_LIMIT=1`;
      const resp = await axios.get(url, { headers: apiHeaders(token), responseType: 'text', timeout: 10000 });
      const rows = csvToRows(resp.data || '');
      if (!rows.length) {
        console.warn(`[ViewSchemaCheck] ⚠ ${name}: returned 0 rows — view may be empty or renamed`);
        results.push({ view: name, ok: false, reason: 'empty response' });
        continue;
      }
      const cols = Object.keys(rows[0]);
      const missing = spec.required.filter(c => !cols.includes(c));
      if (missing.length) {
        console.warn(`[ViewSchemaCheck] ⚠ ${name}: missing columns: ${missing.join(', ')}`);
        results.push({ view: name, ok: false, missing });
      } else {
        console.log(`[ViewSchemaCheck] ✅ ${name}: all ${spec.required.length} required columns present`);
        results.push({ view: name, ok: true });
      }
    } catch(e) {
      console.warn(`[ViewSchemaCheck] ⚠ ${name}: fetch error — ${e.message}`);
      results.push({ view: name, ok: false, reason: e.message });
    }
  }
  return results;
}

// Expose as an admin-only endpoint for manual health checks
app.get('/api/health/views', async (req, res) => {
  // Require a valid session with admin or super_admin role
  // Step 4: session tokens are never accepted from the URL (they land in proxy/access logs).
  const token = req.headers['x-report-token'] || getCookie(req, 'report_token');
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  const { validateSession } = require('./reports-db');
  const user = await validateSession(token);
  if (!user || !rdb.userHasRole(user, 'admin')) {
    return res.status(403).json({ error: 'Admin role required' });
  }
  try {
    const results = await checkZohoViewSchema();
    const allOk = results.every(r => r.ok);
    res.json({ ok: allOk, checkedAt: new Date().toISOString(), results });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Startup behaviour (2026-05-28) ──────────────────────────────────────
// Previously: on every pm2 restart, this fired all 3 syncs against Zoho
// (change_cab at 30s, requests at 75s, survey at 150s). That meant:
//   - every deploy / config change re-hit Zoho's rate-limit envelope
//   - on a deploy windowing badly with the cron, the workspace could be
//     pushed into a multi-hour throttle (see incident 2026-05-27)
//
// New behaviour: rebuild the in-memory cache from local SQLite ONLY.
// Pages serve instantly from this cache (≤26k rows, instant). Cron jobs
// are the SOLE Zoho-touching code path. The user-facing dashboard never
// triggers a Zoho fetch during a startup or first-load — by design.
//
// To force a sync after a pm2 restart, an admin can hit
// /api/sync/trigger/requests from the browser. The cron will also fire
// at the next clock tick (:00 survey, :30 change_cab, :45 requests).
setTimeout(async () => {
  console.log('[Startup] Rebuilding raw cache from SQLite (DB-only, no Zoho)…');
  await _rebuildCacheFromSQLite().catch(e => console.error('[Startup:rebuild]', e.message));
  // Zoho view schema health check still useful for diagnostics — keep it,
  // but defer to 5min so it doesn't race the first cron token refresh.
  setTimeout(() => {
    checkZohoViewSchema().catch(e => console.error('[Startup:viewSchema]', e.message));
  }, 300000);
}, 30000);

function apiHeaders(token) {
  return {
    'Authorization': `Zoho-oauthtoken ${token}`,
    'ZANALYTICS-ORGID': CONFIG.orgId,
  };
}

// ── CSV → ROWS ─────────────────────────────────────────────────────
function csvToRows(csvString) {
  if (!csvString || typeof csvString !== 'string') return [];
  // Strip BOM if present
  const clean = csvString.charCodeAt(0) === 0xFEFF ? csvString.slice(1) : csvString;

  // Parse CSV character-by-character to correctly handle multi-line quoted fields
  // (e.g. free-text survey answers that contain embedded newlines)
  const records = [];
  let fields = [];
  let cur = '';
  let inQuote = false;
  let i = 0;

  while (i < clean.length) {
    const ch = clean[i];
    if (inQuote) {
      if (ch === '"') {
        // Peek ahead: escaped double-quote ("")
        if (clean[i + 1] === '"') { cur += '"'; i += 2; continue; }
        inQuote = false;
      } else {
        cur += ch; // include newlines inside quoted fields
      }
    } else {
      if (ch === '"') {
        inQuote = true;
      } else if (ch === ',') {
        fields.push(cur);
        cur = '';
      } else if (ch === '\r') {
        // skip bare CR
      } else if (ch === '\n') {
        fields.push(cur);
        cur = '';
        if (fields.some(f => f !== '')) records.push(fields); // skip blank lines
        fields = [];
        i++;
        continue;
      } else {
        cur += ch;
      }
    }
    i++;
  }
  // Flush last field / record
  if (cur !== '' || fields.length > 0) {
    fields.push(cur);
    if (fields.some(f => f !== '')) records.push(fields);
  }

  if (records.length < 2) return [];

  // First record = headers; strip any remaining BOM or quotes
  const headers = records[0].map(h => h.trim().replace(/^\uFEFF/, '').replace(/^"|"$/g, ''));

  return records.slice(1).map(vals => {
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = vals[idx] !== undefined ? vals[idx] : '';
    });
    return row;
  });
}

// ── FETCH VIEW ────────────────────────────────────────────────────
async function fetchView(viewId, maxRows = 2000) {
  const token = await getValidToken();
  // Scale timeout with expected data size — large fetches need more time
  const timeoutMs = maxRows > 10000 ? 120000 : maxRows > 2000 ? 60000 : 30000;
  let r;
  try {
    r = await axios.get(
      `${CONFIG.analyticsApi}/workspaces/${CONFIG.workspaceId}/views/${viewId}/data`,
      { headers: apiHeaders(token), params: { responseFormat: 'csv', maxRows }, timeout: timeoutMs }
    );
  } catch (err) {
    // On 401 — token was rejected by Zoho (can happen if stale token served from disk cache).
    // Force a fresh token refresh and retry ONCE.
    if (err.response && err.response.status === 401) {
      console.warn('[fetchView] 401 received — forcing token refresh and retrying…');
      tokenState.accessToken = null; tokenState.expiresAt = 0; // invalidate so getValidToken refreshes
      const freshToken = await refreshAccessToken();
      r = await axios.get(
        `${CONFIG.analyticsApi}/workspaces/${CONFIG.workspaceId}/views/${viewId}/data`,
        { headers: apiHeaders(freshToken), params: { responseFormat: 'csv', maxRows }, timeout: timeoutMs }
      );
    } else if (_isSyncExportBlocked(err)) {
      // Query Tables (SQL views) REJECT synchronous export (errorCode 8133 — "Synchronous export
      // not allowed for the provided view"). The Analytics API demands the ASYNC bulk-export model
      // for them. Transparently switch to it so any query-table view (e.g. the OpManager
      // OPS_OPM_Device_Availability_Daily) works through the same fetchView entry point.
      console.warn(`[fetchView] view ${viewId} disallows sync export (8133) — switching to async bulk export`);
      return await fetchViewAsync(viewId, maxRows);
    } else {
      // Log full response body for any non-401 error so we can diagnose root cause
      if (err.response) {
        console.error(`[fetchView] ${err.response.status} error body:`, JSON.stringify(err.response.data));
      }
      throw err;
    }
  }
  if (typeof r.data === 'string') {
    const rawRows = csvToRows(r.data);
    const rows    = stripPiiColumns(rawRows);
    return { status: 'success', rows, columns: rows.length > 0 ? Object.keys(rows[0]) : [] };
  }
  return r.data;
}

// Detect the Analytics "synchronous export not allowed" rejection (errorCode 8133). Query Tables
// require the async bulk-export model instead of the sync /data export. Tolerant to object OR
// string error bodies.
function _isSyncExportBlocked(err) {
  const b = err && err.response && err.response.data;
  if (!b) return false;
  if (typeof b === 'string') return b.indexOf('SYNC_EXPORT_NOT_ALLOWED') !== -1 || b.indexOf('8133') !== -1;
  if (typeof b === 'object') {
    if (b.summary === 'SYNC_EXPORT_NOT_ALLOWED') return true;
    if (b.data && (b.data.errorCode === 8133 || b.data.errorCode === '8133')) return true;
  }
  return false;
}

// Async bulk export for views the sync API rejects (Query Tables). Flow (ManageEngine Analytics
// Plus Bulk API): initiate an export job → poll exportjobs/{jobId} until a downloadUrl appears →
// download the CSV → same csvToRows + PII scrub as fetchView. Returns the identical shape, so
// callers (readDailyRows, sync jobs) are unaffected.
async function fetchViewAsync(viewId, maxRows = 2000) {
  const token = await getValidToken();
  const headers = apiHeaders(token);
  const base = `${CONFIG.analyticsApi}/bulk/workspaces/${CONFIG.workspaceId}`;
  // 1. initiate the export job
  const init = await axios.get(`${base}/views/${viewId}/data`, {
    headers, timeout: 60000,
    params: { CONFIG: JSON.stringify({ responseFormat: 'csv' }) },
  });
  const jobId = init && init.data && init.data.data && init.data.data.jobId;
  if (!jobId) throw new Error('[fetchViewAsync] no jobId in initiate response: ' + JSON.stringify(init && init.data));
  // 2. poll until the job produces a downloadUrl (or fails / times out) — ~90s max
  let downloadUrl = null;
  for (let i = 0; i < 45; i++) {
    await new Promise((res) => setTimeout(res, 2000));
    let jr;
    try {
      jr = await axios.get(`${base}/exportjobs/${jobId}`, { headers, timeout: 30000 });
    } catch (e) {
      if (e.response && e.response.status === 401) {   // token aged out mid-poll — refresh + retry
        tokenState.accessToken = null; tokenState.expiresAt = 0;
        const fresh = await refreshAccessToken();
        Object.assign(headers, apiHeaders(fresh));
        continue;
      }
      throw e;
    }
    const d = (jr && jr.data && jr.data.data) || {};
    const st = String(d.jobStatus || d.jobCode || '');
    if (d.downloadUrl) { downloadUrl = d.downloadUrl; break; }
    if (/FAIL|ERROR/i.test(st)) throw new Error('[fetchViewAsync] export job failed: ' + st);
  }
  if (!downloadUrl) throw new Error('[fetchViewAsync] export job did not complete in time');
  // 3. download the CSV (downloadUrl is usually absolute; fall back to the canonical path)
  const dlUrl = /^https?:\/\//i.test(downloadUrl) ? downloadUrl : `${base}/exportjobs/${jobId}/data`;
  const dl = await axios.get(dlUrl, { headers, timeout: 120000, responseType: 'text' });
  const csv = typeof dl.data === 'string' ? dl.data : String(dl.data == null ? '' : dl.data);
  const rawRows = csvToRows(csv);
  const rows = stripPiiColumns(rawRows);
  return { status: 'success', rows, columns: rows.length > 0 ? Object.keys(rows[0]) : [] };
}

// Like fetchView but accepts an optional Zoho criteria filter string.
// criteria example: ("Created Time">='2025-02-01')
// This pushes the filter to Zoho so only matching rows are transmitted —
// much faster than fetching 50k rows and filtering locally.
// Automatically falls back to a plain unfiltered fetch if Zoho rejects the criteria.
async function fetchViewWithCriteria(viewId, maxRows = 2000, criteria = null) {
  let token = await getValidToken();
  const timeoutMs = maxRows > 10000 ? 120000 : maxRows > 2000 ? 60000 : 30000;
  const params = { responseFormat: 'csv', maxRows };
  if (criteria) params.criteria = criteria;
  try {
    let r;
    try {
      r = await axios.get(
        `${CONFIG.analyticsApi}/workspaces/${CONFIG.workspaceId}/views/${viewId}/data`,
        { headers: apiHeaders(token), params, timeout: timeoutMs }
      );
    } catch (innerErr) {
      // 401 — force token refresh and retry once before falling through to criteria-error handler
      if (innerErr.response && innerErr.response.status === 401) {
        console.warn('[fetchViewWithCriteria] 401 received — forcing token refresh and retrying…');
        tokenState.accessToken = null; tokenState.expiresAt = 0;
        token = await refreshAccessToken();
        r = await axios.get(
          `${CONFIG.analyticsApi}/workspaces/${CONFIG.workspaceId}/views/${viewId}/data`,
          { headers: apiHeaders(token), params, timeout: timeoutMs }
        );
      } else {
        if (innerErr.response) {
          console.error(`[fetchViewWithCriteria] ${innerErr.response.status} error body:`, JSON.stringify(innerErr.response.data));
        }
        throw innerErr;
      }
    }
    if (typeof r.data === 'string') {
      const rawRows = csvToRows(r.data);
      const rows    = stripPiiColumns(rawRows);
      return { status: 'success', rows, columns: rows.length > 0 ? Object.keys(rows[0]) : [] };
    }
    // Zoho returned JSON error (e.g. invalid criteria syntax)
    if (r.data && r.data.status === 'error') {
      throw new Error('Zoho JSON error: ' + (r.data.message || JSON.stringify(r.data)));
    }
    return r.data;
  } catch (criteriaErr) {
    // Only fall back to plain fetch for criteria SYNTAX errors (Zoho rejects bad filter).
    // For timeouts or network errors we do NOT retry — that doubles the wait time and is
    // worse UX than failing fast and serving stale cache. Throw so getRawRequestRows can
    // decide whether to serve stale data or surface the error.
    const isSyntaxError = criteriaErr.message && (
      criteriaErr.message.includes('Zoho JSON error') ||
      criteriaErr.message.includes('criteria') ||
      criteriaErr.message.includes('invalid') ||
      (criteriaErr.response && criteriaErr.response.status === 400)
    );
    if (isSyntaxError) {
      console.warn(`[fetchViewWithCriteria] Criteria syntax rejected (${criteriaErr.message}), falling back to full fetch`);
      return fetchView(viewId, maxRows);
    }
    // Timeout / 503 / network error — fail fast, don't add another 120s of wait
    console.warn(`[fetchViewWithCriteria] Fetch failed, not retrying (${criteriaErr.message})`);
    throw criteriaErr;
  }
}

// ── MIDDLEWARE ─────────────────────────────────────────────────────

// Cookie helper — reads a named cookie from the raw Cookie header.
// cookie-parser is not installed; this replaces req.cookies?.name.
function getCookie(req, name) {
  const header = req.headers.cookie || '';
  const match  = header.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

// CORS — allow requests from:
//   - localhost / 127.0.0.1 on the same port (direct-IP access during transition,
//     and for any same-server tooling)
//   - the corporate HTTPS hostname served via IIS reverse proxy
//   - the legacy IP URL `http://10.225.99.173:3456` (still used until Phase B
//     of CH-273 locks Node to 127.0.0.1; after lockdown this entry is harmless
//     because no external client can reach that interface anyway)
//
// Add new origins via the CORS_EXTRA_ORIGINS env var (comma-separated) without
// editing this file — useful for staging URLs or future hostnames.
const corsAllowed = [
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  `https://itops-dashboard.edv-ops.com`,
  `http://10.225.99.173:${PORT}`,
  ...(process.env.CORS_EXTRA_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
];
app.use(cors({ origin: corsAllowed }));

// ── Path-scoped large JSON parsers ────────────────────────────────────
// These MUST run BEFORE the global express.json() below. Express
// middleware runs in registration order, and body-parser is idempotent
// — the FIRST parser to match a request consumes req.body, subsequent
// parsers see req._body=true and skip. If the global parser (which uses
// Express's default 100 KB limit) runs first, it 413s any inspection
// save carrying photos (typically 60-80 MB inline base64) before our
// route-specific parsers can fire.
//
// Discovered 2026-05-25 after a field user at Houndé hit 413 despite
// route-specific inspectionJsonBody being set to 100 MB at server.js:4658.
// The route-specific parser was never reached because the global at
// line 739 consumed (and rejected) the body first.
//
// app.use(path, mw) matches the path prefix — for /api/inspection/save
// it triggers on the exact route. Same pattern for the meetings save +
// audit-trail routes which carry inline content of their own.
app.use('/api/inspection/save',             express.json({ limit: '100mb' }));
app.use('/api/inspection/aggregate/export', express.json({ limit: '50mb'  }));
app.use('/api/meetings/save',               express.json({ limit: '10mb'  }));
app.use('/api/meetings/issues/:id/update',  express.json({ limit: '10mb'  }));
app.use('/api/meetings/issues/:id/actions', express.json({ limit: '1mb'   }));
app.use('/api/meetings/lookups/:table',     express.json({ limit: '10mb'  }));
// Tracker D blob carries N years × ~11 sites × 31 activities × 12 months of
// input cells + per-site targets + activities metadata. Typical realistic
// size is 100-300 KB; would bounce off the default 100 KB global parser
// below. Discovered 2026-05-26 — user `mohamed` (super_admin) reported
// Input-tab data not persisting after the 5f11098 path-scoped-parser fix
// for inspection silently regressed tracker saves to the global parser.
app.use('/api/tracker/save',                express.json({ limit: '5mb'   }));
app.use('/api/dashboard/presets',           express.json({ limit: '1mb'   }));
// Réconciliation : le corps est un CSV BRUT, pas du JSON. Un export AD de
// 5 000 machines pèse ~1 Mo, un export Entra bien plus. Monté AVANT le parseur
// JSON global, sinon celui-ci consomme le corps et le rejette à 100 Ko — le
// même piège que l'import Réunions (§ ci-dessus). `type: '*/*'` parce que le
// navigateur envoie tantôt text/csv, tantôt application/octet-stream selon
// qu'on lit un File ou un ArrayBuffer.
app.use('/api/assets/reconcile/preview',    express.raw({ type: '*/*', limit: '30mb' }));
app.use('/api/assets/reconcile/import',     express.raw({ type: '*/*', limit: '30mb' }));

// Global JSON parser — Express default limit (~100 KB). Covers the
// long tail of small REST calls. Large endpoints are handled by the
// path-scoped parsers registered ABOVE.
app.use(express.json());

// ── HSTS — force browsers to use HTTPS for the dashboard hostname ──
// IIS sets this header too (see iis/web.config) — defence in depth: if
// IIS is bypassed (mis-config, direct localhost test) the Node response
// still carries HSTS so any browser that has already learned the domain
// will refuse to downgrade to plain HTTP.
//
// max-age=31536000 = 1 year. Re-sent on every request — once a browser
// has cached this header, typing http://itops-dashboard.edv-ops.com will
// be auto-rewritten to https:// before the request even leaves the device.
//
// We DO NOT add `preload` because that's only relevant for public domains
// in the Chromium HSTS preload list; this is internal-only.
app.use((req, res, next) => {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// ── GZIP Compression — wraps res.json AND res.send so the explicit-handler
//    HTML routes (executive.html, executive-report.html, reports.html,
//    index.html, analytics.html) get compressed too. The biggest page is
//    executive.html at ~488 KB raw → ~85 KB gzipped, which is the single
//    largest first-paint win. Static-served files (.js, .css, fonts) are
//    handled by browser HTTP caching (Cache-Control set on express.static
//    below) — they only download once per asset version.
const zlib = require('zlib');
app.use((req, res, next) => {
  const ae = req.headers['accept-encoding'] || '';
  if (!ae.includes('gzip')) return next();

  // Wrap res.json — keeps the existing JSON-API behaviour intact.
  const _json = res.json.bind(res);
  res.json = (obj) => {
    const buf = Buffer.from(JSON.stringify(obj), 'utf8');
    zlib.gzip(buf, (err, compressed) => {
      if (err) return _json(obj);
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Length', compressed.length);
      res.end(compressed);
    });
  };

  // Wrap res.send — used by all the explicit HTML page handlers
  // (`/executive.html`, `/index.html`, etc. — see below). Compresses any
  // string payload ≥1 KB. Buffer / non-string payloads pass through
  // untouched so we don't accidentally re-compress already-binary
  // responses (e.g. PPTX exports use res.send(buf)).
  const _send = res.send.bind(res);
  res.send = (body) => {
    if (typeof body !== 'string' || body.length < 1024) return _send(body);
    if (res.getHeader('Content-Encoding')) return _send(body); // already encoded
    const buf = Buffer.from(body, 'utf8');
    zlib.gzip(buf, (err, compressed) => {
      if (err) return _send(body);
      res.setHeader('Content-Encoding', 'gzip');
      // Preserve any Content-Type the route already set; default to HTML.
      if (!res.getHeader('Content-Type')) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
      }
      res.setHeader('Content-Length', compressed.length);
      // `Vary: Accept-Encoding` so caches don't serve a gzipped response
      // to a client that didn't ask for one.
      res.setHeader('Vary', 'Accept-Encoding');
      res.end(compressed);
    });
  };

  next();
});

// ── Unified Session Auth — protects all HTML pages ───────────────
// HTML page auth is handled entirely client-side by auth.js (localStorage token + role checks).
// The server-side HTML redirect was removed because it caused a login loop:
// server redirected to login.html?next=PAGE → login.html init cleared localStorage → loop.
// Auth.js enforces: no token → login redirect | wrong role → index redirect | expired → logout.
// API routes are still protected by requireReportSession / API key guard below.

// Step 4 (SDP-DASH-2.0) — extended audit journal: every API write and every 403 → system_log
// (category 'api'), recorded after the response (services/apiAudit.js). Kept 12 months.
app.use('/api/', require('./services/apiAudit').middleware((ev) => { if (rdb) rdb.logEvent(ev); }));

// ── API Key guard — extra layer on all /api/* routes ─────────────
// Accepts either x-dash-key (injected into HTML) OR a valid x-report-token session.
// This allows index.html (Editor/Viewer) to call APIs using their session token.
app.use('/api/', async (req, res, next) => {
  if (req.path.startsWith('/reports/')) return next(); // protected by requireReportSession
  // Public Executive View summary — aggregates-only, no auth (SharePoint-facing).
  // The editorial WRITE (PUT /api/exec/editorial) is NOT exempted here — it goes
  // through requireReportSession + requireAdmin below the gate.
  if (req.method === 'GET' && req.path === '/exec/summary') return next();
  // Public SSO endpoints — the user isn't authenticated yet during login.
  // /auth/config (is SSO on?) + /auth/sso/login + /auth/sso/callback.
  if (req.path === '/auth/config' || req.path.startsWith('/auth/sso/')) return next();
  // Meridian inbound read API — server-to-server, authed by its OWN X-API-Key
  // (report_config meridian_in_key) inside routes/meridian.js, NOT the dash key.
  if (req.method === 'GET' && req.path === '/actions/open') return next();
  const key   = req.headers['x-dash-key'];
  if (key && require('./services/safeCompare').safeEqual(key, DASH_API_KEY)) return next(); // API key present — allow (constant-time)
  // Fallback: accept valid session token (for Editor/Viewer users on index.html)
  const token = req.headers['x-report-token'] || getCookie(req, 'report_token');
  if (rdb && token) {
    let user; try { user = await rdb.validateSession(token); } catch (e) { user = null; }
    if (user) return next();
  }
  return res.status(401).json({ error: 'Unauthorized' });
});

// ── Executive View — public read + admin editorial write ─────────────────────
// GET /api/exec/summary is PUBLIC (exempted in the /api/ gate above): a
// SharePoint-facing, aggregates-only snapshot with a 60 s server-side cache.
// It returns ONLY what execSummary.loadExecSummary produces (already
// PII-whitelisted). PUT /api/exec/editorial is staff-only (session + admin).
let _execCache = { at: 0, body: null };

// aiCall(body) => Promise<string>: wraps the provider switch and returns the
// model's raw text. Used ONLY off the request path (MI-summary regeneration).
async function _execAiCall(body) {
  if (AI_DISABLED) { const e = new Error('AI analysis is disabled'); e.status = 503; throw e; }
  const withModel = { ...body, model: AI_ALLOWED_MODELS[0] };  // cheapest allowed (haiku); ignored on the local path
  const data = AI_PROVIDER === 'local' ? await _aiCallLocal(withModel) : await _aiCallAnthropic(withModel);
  return (data && data.content && data.content[0] && data.content[0].text) || '';
}

// scheduleMiSummaries: fire-and-forget regeneration of stale MI summaries so the
// PUBLIC endpoint never blocks on the model. A single in-flight guard prevents
// stacking regens when the page is hit repeatedly within a warm-up window.
let _miRegenInFlight = false;
function _scheduleMiSummaries(stale) {
  if (AI_DISABLED) return;   // no live model → exec-view keeps its non-AI MI text
  if (_miRegenInFlight || !stale || !stale.length) return;
  _miRegenInFlight = true;
  const rdb2 = require('./reports-db');
  const miSummary = require('./services/execMiSummary');
  Promise.resolve()
    .then(() => miSummary.regenerate({ stale, aiCall: _execAiCall, rdb: rdb2, model: AI_PROVIDER === 'local' ? LOCAL_LLM_MODEL : AI_ALLOWED_MODELS[0] }))
    .catch(e => console.warn('[exec-mi-summary] regen batch failed:', e.message))
    .finally(() => { _miRegenInFlight = false; _execCache = { at: 0, body: null }; }); // bust cache so the next load serves the warm summaries
}

// loadExecSummary is async (PG-ready readers). In-flight promise guard: two
// concurrent cold requests share ONE regeneration instead of both recomputing.
// Only the RESOLVED body is cached — the .finally clears the in-flight slot so
// a rejected promise is never served from cache.
let _execInFlight = null;
app.get('/api/exec/summary', async (req, res) => {
  try {
    if (Date.now() - _execCache.at < 60_000 && _execCache.body) return res.json(_execCache.body);
    if (!_execInFlight) {
      _execInFlight = (async () => {
        const rdb2 = require('./reports-db');
        const trackerDb = require('./tracker-db');
        const trackerPptx = require('./tracker-pptx');
        const execSummary = require('./services/execSummary');
        const body = await execSummary.loadExecSummary({
          rdb: rdb2, trackerDb, trackerScore: trackerPptx,
          scheduleMiSummaries: _scheduleMiSummaries,
        });
        _execCache = { at: Date.now(), body };
        return body;
      })().finally(() => { _execInFlight = null; });
    }
    res.json(await _execInFlight);
  } catch (e) {
    console.warn('[exec-summary] unavailable:', e.message);
    res.status(200).json({ error: 'unavailable' });
  }
});

// GET /api/exec/editorial?period=YYYY-MM — admin-only editorial reader.
// Sibling of the PUT below; used by the reports.html#admin card to prefill.
// Behind the /api/ gate (NOT exempted) + requireReportSession + requireAdmin.
app.get('/api/exec/editorial', requireReportSession, requireSuperAdmin, async (req, res) => {
  const period = String(req.query.period || '').trim();
  if (!/^\d{4}-\d{2}$/.test(period)) return res.status(400).json({ error: 'period YYYY-MM required' });
  const rdb2 = require('./reports-db');
  res.json(await rdb2.getExecEditorial(period));   // async under REPORTS_BACKEND=postgres
});

// PUT /api/exec/editorial?period=YYYY-MM — admin-only editorial persistence.
// Behind the /api/ gate (NOT exempted) + requireReportSession + requireAdmin.
app.put('/api/exec/editorial', requireReportSession, requireSuperAdmin, express.json(), async (req, res) => {
  const period = String(req.query.period || '').trim();
  if (!/^\d{4}-\d{2}$/.test(period)) return res.status(400).json({ error: 'period YYYY-MM required' });
  const rdb2 = require('./reports-db');
  const saved = await rdb2.setExecEditorial(period,   // async under REPORTS_BACKEND=postgres
    { highlights: req.body.highlights, focus: req.body.focus },
    (req.reportUser && req.reportUser.username) || 'unknown');
  _execCache = { at: 0, body: null }; // bust the summary cache so the edit shows immediately
  res.json(saved);
});

// ── Scheduled backups (admin card) — bridges to Manage-SDP.ps1 / schtasks ───
// super_admin only. The app only CONFIGURES the Task Scheduler jobs; they run
// even when the app is down (the whole point of the Task Scheduler choice).
const backupSchedule = require('./services/backupSchedule');
function _requireSuperAdminInline(req, res) {
  if (!rdb.userHasRole(req.reportUser, 'super_admin')) {
    res.status(403).json({ error: 'super_admin only' });
    return false;
  }
  return true;
}
app.get('/api/admin/backup-schedule', requireReportSession, async (req, res) => {
  if (!_requireSuperAdminInline(req, res)) return;
  try {
    const [status, restorePoints] = await Promise.all([
      backupSchedule.getStatus(),
      backupSchedule.listRestorePoints(),
    ]);
    res.json({ status, restorePoints: restorePoints.slice(0, 20) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/backup-schedule', requireReportSession, express.json(), async (req, res) => {
  if (!_requireSuperAdminInline(req, res)) return;
  try {
    const r = await backupSchedule.setSchedule(req.body || {});
    console.log(`[backup-schedule] updated by ${req.reportUser.username}:`, JSON.stringify(req.body));
    res.json(r);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/admin/backup-now', requireReportSession, express.json(), async (req, res) => {
  if (!_requireSuperAdminInline(req, res)) return;
  try {
    const r = await backupSchedule.backupNow({ dbOnly: !!(req.body && req.body.dbOnly) });
    console.log(`[backup-schedule] manual backup by ${req.reportUser.username} (dbOnly=${!!(req.body && req.body.dbOnly)})`);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── APP_VERSION — global cache-busting token (added 2026-06-05) ──────────────
// Computed once at boot. Injected as `?v=<APP_VERSION>` into every local
// <script src> and <link href> reference inside cached HTMLs. Combined with
// the immutable Cache-Control on the static handler, this gives us the
// canonical web pattern: HTML is no-cache (always fresh), assets are
// cached forever AND auto-invalidate on deploy because the URL changes.
//
// User-visible: zero RTT for cached assets, zero risk of stale code, zero
// requirement to Ctrl+F5 after deploys. Same approach webpack / vite /
// Next.js use in production.
// Installed release (manifest.json of a CI package, ADR-003) — null when running from a checkout / ZIP deploy.
const _INSTALLED = require('./services/releaseManifest').readInstalled(__dirname);
const APP_VERSION = (() => {
  try {
    const v = require('child_process')
      .execSync('git rev-parse --short HEAD', { cwd: __dirname, timeout: 1500 })
      .toString().trim();
    if (v) return v;
  } catch (_) {}
  // A release package (ADR-003) has no .git: its manifest carries the commit.
  if (_INSTALLED && _INSTALLED.commit) return _INSTALLED.commit;
  // Fallback when git isn't reachable (e.g. shallow deploy without .git).
  // Boot-time epoch — different on every restart but stable within a process.
  return 't' + Date.now().toString(36);
})();
console.log('[boot] APP_VERSION =', APP_VERSION);

// Inject ?v=<APP_VERSION> into every local <script src> and <link href> that
// doesn't already carry a query string. Absolute URLs (CDN), data: URIs,
// hash anchors, and already-versioned URLs are left alone. Runs once per
// HTML at boot inside loadHtml — idempotent for safety.
function injectAssetVersion(html) {
  if (!APP_VERSION || !html) return html;
  const v = `?v=${APP_VERSION}`;
  const isLocal = (u) =>
    u
    // eslint-disable-next-line security/detect-unsafe-regex -- reviewed (step 4): anchored, no nested quantifier
    && !/^(https?:)?\/\//i.test(u)
    && !u.startsWith('data:')
    && !u.startsWith('#')
    && !u.startsWith('mailto:')
    && !u.includes('?');
  // <script ... src="..."> — match src anywhere in the tag
  html = html.replace(
    /(<script\b[^>]*?\bsrc=)("|')([^"']+)\2/gi,
    (m, lead, q, src) => (isLocal(src) ? `${lead}${q}${src}${v}${q}` : m)
  );
  // <link ... href="..." ...> — only stylesheet / preload / prefetch / modulepreload
  html = html.replace(/<link\b([^>]+)>/gi, (m, attrs) => {
    if (!/\brel=("|')(stylesheet|preload|prefetch|modulepreload)\1/i.test(attrs)) return m;
    return m.replace(/(\bhref=)("|')([^"']+)\2/i,
      (m2, lead, q, href) => (isLocal(href) ? `${lead}${q}${href}${v}${q}` : m2));
  });
  return html;
}

// ── HTML page cache (read once at startup) ───────────────────────────────────
// Each protected HTML page is served by an explicit handler that injects the
// API key and CSP nonce. Reading from disk on every request was wasted I/O —
// the file content is stable until the next deploy. We cache the buffer at
// boot and only redo the per-request nonce / api-key replacement.
const _htmlCache = {};
function loadHtml(name) {
  try {
    let raw = fs.readFileSync(path.join(__dirname, 'public', name), 'utf8');
    raw = injectAssetVersion(raw);
    _htmlCache[name] = raw;
  } catch(e) {
    console.error('[html-cache] Failed to load', name, '—', e.message);
    _htmlCache[name] = null;
  }
}
// activity-tracker.html + help.html added to the cache on 2026-06-05 so
// injectAssetVersion can rewrite their script/link references. They were
// previously served by express.static (no asset-version injection possible).
[
  'executive.html', 'login.html', 'index.html', 'analytics.html', 'reports.html', 'executive-report.html',
  'inspection.html', 'inspections.html', 'inspection-actions.html',
  'meetings.html', 'meeting.html', 'meetings-issues.html', 'meetings-council.html', 'meetings-compliance.html',
  'meetings-import.html', 'meetings-progress.html', 'meetings-insights.html', 'meetings-setup.html', 'meetings-actions.html',
  'meetings-unsigned.html',
  'activity-tracker.html', 'help.html', 'exec-view.html', 'site-report.html', 'it-review.html', 'site-actions.html', 'system-logs.html', 'kpi-dictionary.html',
  'site-awareness.html',
  'assets.html', 'assets-hygiene.html', 'assets-finance.html', 'wan.html', 'wan-health.html', 'wan-sla.html', 'itsm-roadmap.html',
  'infra-health.html', 'itsm-integrations-plan.html',
].forEach(loadHtml);

// Helper: build the per-request HTML, inject api-key + nonce, send. Pages
// that don't need the api-key call this with `injectApiKey=false`.
function sendHtmlPage(res, name, injectApiKey, fallbackMsg) {
  let html = _htmlCache[name];
  if (!html) {
    // Disk cache miss (page renamed / deleted at runtime?) — try one re-read.
    loadHtml(name);
    html = _htmlCache[name];
    if (!html) return res.status(500).send(fallbackMsg);
  }
  if (injectApiKey) {
    html = html.replace('</head>', `<script nonce="${res.locals.nonce}">window.__ak='${DASH_API_KEY}';</script>\n</head>`);
  }
  html = html.replace(/%%CSP_NONCE%%/g, res.locals.nonce);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Page HTML must NOT be cached by the browser — every visit gets a fresh
  // CSP nonce. Static assets (.js, .css, fonts) are cached aggressively below.
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(html);
}

// ── Serve executive.html with injected API key + CSP nonce ───────────────────
// Must be registered BEFORE express.static so this route takes precedence.
app.get(['/executive.html'], (req, res) => {
  sendHtmlPage(res, 'executive.html', true, 'Dashboard unavailable');
});

// ── Serve exec-view.html — PUBLIC (no auth, no api-key injection) ─────────────
// SharePoint-facing read-only Executive View. It fetches only the public
// /api/exec/summary endpoint, so it never needs window.__ak.
app.get('/exec-view.html', (req, res) => {
  sendHtmlPage(res, 'exec-view.html', false, 'Executive view unavailable');
});

// ── Serve site-report.html — live site scoreboard (no api-key injection) ──────
// It fetches /api/reports/site-data with the browser session cookie
// (requireReportSession), like exec-view — so it never needs window.__ak.
app.get('/site-report.html', (req, res) => {
  sendHtmlPage(res, 'site-report.html', false, 'Site report unavailable');
});

// ── Serve site-awareness.html — read-only per-site business view (session cookie, no api-key) ──
app.get('/site-awareness.html', (req, res) => {
  sendHtmlPage(res, 'site-awareness.html', false, 'Site Awareness unavailable');
});

// ── Serve it-review.html — the live IT Review dashboard (no api-key injection) ─
// It fetches /api/reports/review-data with the browser session cookie
// (requireReportSession), like site-report — so it never needs window.__ak.
app.get('/it-review.html', (req, res) => {
  sendHtmlPage(res, 'it-review.html', false, 'IT Review dashboard unavailable');
});

// ── Serve login.html with CSP nonce injected ─────────────────────────────────
// login.html is NOT served by express.static — it needs the nonce so its inline
// script passes CSP (script-src uses nonce-only, no 'unsafe-inline').
app.get('/login.html', (req, res) => {
  sendHtmlPage(res, 'login.html', false, 'Login page unavailable');
});

// ── Serve index.html with injected API key + CSP nonce — also the default root page ──
app.get(['/', '/index.html'], (req, res) => {
  sendHtmlPage(res, 'index.html', true, 'Operations Center unavailable');
});

// ── Serve analytics.html with injected API key + CSP nonce ───────────────────
app.get('/analytics.html', (req, res) => {
  sendHtmlPage(res, 'analytics.html', true, 'Analytics dashboard unavailable');
});

// ── Serve reports.html with injected API key + CSP nonce ─────────────────────
app.get('/reports.html', (req, res) => {
  sendHtmlPage(res, 'reports.html', true, 'Reports unavailable');
});

// ── Serve executive-report.html with injected API key + CSP nonce ────────────
app.get('/executive-report.html', (req, res) => {
  sendHtmlPage(res, 'executive-report.html', true, 'Executive Report unavailable');
});

// ── Serve inspection.html (IT Inspection form) with CSP nonce ──────────────
// No api-key needed — the inspection module talks to /api/inspection/*
// using the session cookie (same pattern as the tracker).
app.get('/inspection.html', (req, res) => {
  sendHtmlPage(res, 'inspection.html', false, 'Inspection form unavailable');
});

// ── Serve inspection-actions.html (corrective actions register) ───────────
app.get('/inspection-actions.html', (req, res) => {
  sendHtmlPage(res, 'inspection-actions.html', false, 'Actions register unavailable');
});

// ── Serve inspections.html (list / dashboard) with CSP nonce ───────────────
app.get('/assets.html', (req, res) => {
  sendHtmlPage(res, 'assets.html', false, 'Assets unavailable');
});
app.get('/wan.html', (req, res) => {
  sendHtmlPage(res, 'wan.html', false, 'WAN unavailable');
});
app.get('/wan-health.html', (req, res) => {
  sendHtmlPage(res, 'wan-health.html', false, 'WAN Health unavailable');
});
app.get('/infra-health.html', (req, res) => {
  sendHtmlPage(res, 'infra-health.html', false, 'Infrastructure Health unavailable');
});
app.get('/wan-sla.html', (req, res) => {
  sendHtmlPage(res, 'wan-sla.html', false, 'SLA / Chargeback unavailable');
});
// Personal Roadmap Manager — private super_admin tool, standalone page (own chrome,
// NOT on the shared _shell.js nav), reachable by direct URL / bookmark only.
app.get('/itsm-roadmap.html', (req, res) => {
  sendHtmlPage(res, 'itsm-roadmap.html', false, 'Roadmap unavailable');
});

app.get('/assets-hygiene.html', (req, res) => {
  sendHtmlPage(res, 'assets-hygiene.html', false, 'Assets hygiene unavailable');
});
app.get('/assets-finance.html', (req, res) => {
  sendHtmlPage(res, 'assets-finance.html', false, 'Assets finance unavailable');
});

app.get('/inspections.html', (req, res) => {
  sendHtmlPage(res, 'inspections.html', false, 'Inspections dashboard unavailable');
});

// ── Serve activity-tracker.html (React + Babel) with CSP nonce ──────────────
// Moved out of express.static (2026-06-05) so injectAssetVersion can add
// ?v=APP_VERSION to its <script> / <link> references. The path-scoped CSP
// override that grants 'unsafe-eval' + unpkg.com to this page (line ~182)
// still fires — it matches by req.path, not by who serves the response.
app.get('/activity-tracker.html', (req, res) => {
  sendHtmlPage(res, 'activity-tracker.html', false, 'Activity Tracker unavailable');
});

// ── Serve help.html (bilingual user manual) with CSP nonce ──────────────────
// Moved out of express.static for the same reason as activity-tracker.html.
app.get('/help.html', (req, res) => {
  sendHtmlPage(res, 'help.html', false, 'Help page unavailable');
});
// The integrations project plan (linked from itsm-roadmap.html) — served through the
// cache/version-injection path like every other HTML, not express.static (audit 2026-09-05).
app.get('/itsm-integrations-plan.html', (req, res) => {
  sendHtmlPage(res, 'itsm-integrations-plan.html', false, 'Integrations plan unavailable');
});

// ── Meetings & Council Escalations module (v2) — 5 pages ─────────────────
// All pages talk to /api/meetings/* using the session cookie. They share
// the same lookup hydration call so the brand surface stays consistent.
//   meetings.html             — list / dashboard + 3 quick-jump cards
//   meeting.html              — 7-section PV editor + audit thread
//   meetings-issues.html      — flat Issues Log across all PVs
//   meetings-council.html     — escalations grouped by Council theme
//   meetings-compliance.html  — 5 Engagements monitor per month
app.get('/meetings.html',            (req, res) => sendHtmlPage(res, 'meetings.html',            false, 'Meetings dashboard unavailable'));
app.get('/meeting.html',             (req, res) => sendHtmlPage(res, 'meeting.html',             false, 'Meeting editor unavailable'));
app.get('/meetings-issues.html',     (req, res) => sendHtmlPage(res, 'meetings-issues.html',     false, 'Issues Log unavailable'));
app.get('/meetings-actions.html',    (req, res) => sendHtmlPage(res, 'meetings-actions.html',    false, 'Actions Register unavailable'));
// SP1a — per-site Actions Register hub (meetings + inspection + report follow-ups).
app.get('/site-actions.html',        (req, res) => sendHtmlPage(res, 'site-actions.html',        false, 'Site Actions Register unavailable'));
app.get('/system-logs.html',         (req, res) => sendHtmlPage(res, 'system-logs.html',         false, 'System Logs unavailable'));
app.get('/kpi-dictionary.html',      (req, res) => sendHtmlPage(res, 'kpi-dictionary.html',      false, 'KPI Dictionary unavailable'));
app.get('/meetings-unsigned.html',   (req, res) => sendHtmlPage(res, 'meetings-unsigned.html',   false, 'Unsigned PVs unavailable'));
app.get('/meetings-council.html',    (req, res) => sendHtmlPage(res, 'meetings-council.html',    false, 'Council escalations unavailable'));
app.get('/meetings-compliance.html', (req, res) => sendHtmlPage(res, 'meetings-compliance.html', false, '5 Engagements monitor unavailable'));
app.get('/meetings-import.html',     (req, res) => sendHtmlPage(res, 'meetings-import.html',     false, 'Bulk import unavailable'));
app.get('/meetings-progress.html',   (req, res) => sendHtmlPage(res, 'meetings-progress.html',   false, 'Progress view unavailable'));
app.get('/meetings-insights.html',   (req, res) => sendHtmlPage(res, 'meetings-insights.html',   false, 'Meetings dashboard unavailable'));
app.get('/meetings-setup.html',      (req, res) => sendHtmlPage(res, 'meetings-setup.html',      false, 'Meetings setup unavailable'));

// ── Static assets — cached aggressively in the browser ───────────────────────
// Everything in public/ that isn't one of the protected HTML pages above:
// images, fonts, .js bundles, .css, plus the unprotected pages
// (activity-tracker.html, help.html). We set Cache-Control max-age=86400
// (1 day) for everything by default. ETags are kept (default) so any change
// invalidates the cache through revalidation.
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  etag:   true,
  setHeaders: (res, filePath) => {
    // ─────────────────────────────────────────────────────────────────
    // CANONICAL CACHE POLICY — added 2026-06-05
    //
    // 1. HTML pages → no-cache (always fresh; carries up-to-date ?v=
    //    references to assets).
    // 2. Assets with ?v=<APP_VERSION> query → immutable, max-age=1 year
    //    (URL-versioned, served instantly from cache; auto-invalidates
    //    on next deploy because APP_VERSION changes → URL changes →
    //    new cache key → fresh fetch).
    // 3. Assets without ?v= (legacy / direct hits) → fall through to
    //    the tiered safety-net below.
    //
    // This is the standard pattern used by webpack / vite / Next.js
    // and every modern static site. CLAUDE.md §"Coding Principles —
    // Browser-side asset caching" documents the user-facing rule.
    // ─────────────────────────────────────────────────────────────────

    // (1) HTML — Most HTMLs now have dedicated route handlers above
    // that serve from _htmlCache (which runs injectAssetVersion at
    // boot). This branch covers any leftover .html files served via
    // express.static as a defensive fallback.
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      return;
    }

    // (2) URL-versioned asset — dominant path post-2026-06-05.
    //
    // The HTML referenced this URL with `?v=<APP_VERSION>`. The asset
    // is effectively content-addressed by URL: different APP_VERSION
    // → different URL → different cache entry. Serve with the longest
    // possible cache + immutable directive so browsers DON'T even
    // attempt revalidation. ZERO RTT on every subsequent load.
    //
    // On deploy, APP_VERSION changes server-side. Fresh HTML serves
    // with new ?v=. Browser sees a new URL → fetches fresh. Old
    // entries under prior `?v=` sit dormant until LRU eviction.
    if (res.req && res.req.query && res.req.query.v) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return;
    }

    // (3) Fallback for unversioned requests (asset hit directly via
    // URL bar, or a third-party tool fetching). Apply the tiered
    // safety net so misuse can't reproduce the "stale App.jsx → data
    // loss" bug we shipped on 2026-06-04. In normal use, NO browser
    // request hits this branch — they all go through (2).

    // Tier A — no-cache for data-loss-risk modules + .jsx files
    if (
      /[\\\/](activity-tracker|dashboard-preview|design-system)[\\\/]/.test(filePath)
      || filePath.endsWith('.jsx')
    ) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      return;
    }
    // Tier B — 5-min cache for shared display libraries
    if (
      /[\\\/]lib[\\\/]/.test(filePath)
      || /[\\\/]analyze-lite\.js$/.test(filePath)
    ) {
      res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
      return;
    }
    // Tier C — default 1-day cache from express.static maxAge: '1d'.
    // (brand/icons.js, _shell.js, _shell.css, auth.js, _tokens.css,
    // fonts, PNG/JPG, vendored libraries — these change rarely.)
  }
}));

// Survey routes (/api/survey/*) - extracted to routes/survey.js (SDP-DASH-2.0 step 5, lot 5.4).
// /health reads the survey view id + cache age through .helpers.
const _surveyRouter = require('./routes/survey')({
  express, axios, IS_DEV, safeError, CONFIG, VIEWS, getValidToken, fetchView, requireReportSession, requireAdmin,
});
app.use(_surveyRouter);

// ═══════════════════════════════════════════════════════════════════
// ALL EXISTING ENDPOINTS (unchanged from v7)
// ═══════════════════════════════════════════════════════════════════

app.get('/api/ping', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ── SYNC STATUS & MANUAL TRIGGER ─────────────────────────────────

/**
 * GET /api/sync/status
 * Returns last sync time, row count, and any error for each sync job.
 * Used by the dashboard to show a "Data last updated: X minutes ago" indicator.
 */
app.get('/api/sync/status', requireReportSession, async (req, res) => {
  try {
    const { getSyncStatus } = require('./reports-db');
    const jobs = await getSyncStatus();
    // Enrich with human-readable staleness
    const now = Date.now();
    const enriched = jobs.map(j => {
      const ageMs   = j.last_sync_at ? now - new Date(j.last_sync_at).getTime() : null;
      const ageMin  = ageMs !== null ? Math.round(ageMs / 60000) : null;
      let freshness = 'never synced';
      if (ageMin !== null) {
        if (ageMin < 2)      freshness = 'just now';
        else if (ageMin < 60)   freshness = `${ageMin} min ago`;
        else if (ageMin < 1440) freshness = `${Math.round(ageMin / 60)} hr ago`;
        else                 freshness = `${Math.round(ageMin / 1440)} day(s) ago`;
      }
      // Parse schema_snapshot JSON for readability (don't send raw string)
      let schemaSnapshot = null;
      try { schemaSnapshot = j.schema_snapshot ? JSON.parse(j.schema_snapshot) : null; } catch (_) {}
      return {
        ...j,
        schema_snapshot: schemaSnapshot,  // replace raw string with parsed object
        age_minutes: ageMin,
        freshness,
        is_stale: ageMin === null || ageMin > 480,  // stale if >8h or never synced
      };
    });
    res.json({ ok: true, jobs: enriched, server_time: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/sync/trigger/:job
 * Manually trigger a sync job. job = 'change_cab' | 'survey' | 'requests'
 * Add ?force=true to bypass the incremental filter for 'requests' and re-upsert
 * every row from Zoho, refreshing overdue_status and filling historical data gaps.
 */
// Manual assets sync — admin only. Fire-and-forget; respond immediately (mirrors the
// :job trigger below). MUST be registered BEFORE /api/sync/trigger/:job or the param
// route swallows it as job='assets' → 400 (the /:id shadowing pitfall in CLAUDE.md).
// markSyncSuccess upserts the 5 sync_metadata rows on first run.
app.post('/api/sync/trigger/assets', requireReportSession, requireAdmin, (req, res) => {
  if (syncRunner.isRunning('assets.sync')) return res.status(409).json({ ok: false, error: 'Assets sync is already running' });
  res.json({ ok: true, message: 'Assets sync started' });
  syncRunner.run('assets.sync', { trigger: 'manual' });   // never rejects; logged in sync_runs
});

// Step 1 (SDP-DASH-2.0) — health of every scheduled job (admin+). Merges the runner's job
// state with the legacy sync_metadata rows; status ok|running|idle|stale|error|never.
app.get('/api/sync/health', requireReportSession, requireAdmin, async (req, res) => {
  try {
    const rdb = require('./reports-db');
    const metadata = await rdb.getSyncStatus();
    const h = await syncRunner.health({ metadata });
    const since = new Date(Date.now() - 28 * 86400000).toISOString();
    let stats = [];
    try { stats = await _syncStore.successStats(since); } catch (_) { stats = []; }
    const byJob = new Map(stats.map(x => [x.job_key, x]));
    h.jobs.forEach(j => {
      const x = byJob.get(j.key);
      const ok = x ? Number(x.ok) || 0 : 0, failed = x ? Number(x.failed) || 0 : 0;
      j.runs_28d = x ? Number(x.total) || 0 : 0;
      j.success_pct_28d = (ok + failed) ? Math.round(1000 * ok / (ok + failed)) / 10 : null;   // null = nothing measured
    });
    // Step 2: database state — backend per module (zero SQLite in production) + schema migrations.
    const bg = require('./services/backendGuard').check();
    h.database = { backends: bg.backends, sqlite: bg.sqlite, require_postgres: bg.required, message: bg.message, migrations: null,
      config_key: (({ set, required }) => ({ set, required }))(require('./services/backendGuard').checkConfigKey()) };
    if (rdb.REPORTS_BACKEND === 'postgres') {
      try {
        const st = await require('./db/migrate').status(rdb.pgHandle());
        h.database.migrations = st.map(m => ({ module: m.module, scripts: m.plan.length,
          pending: m.plan.filter(p => p.action !== 'skip').map(p => p.filename) }));
      } catch (e) { h.database.migrations_error = e.message; }
    }
    h.alerts = { email: null, teams: null };
    try {
      const cfg = await require('./services/reportConfig').getConfig(rdb.db);
      h.alerts = { email: String(cfg.sync_alert_enabled) === '1', teams: String(cfg.sync_alert_teams) === '1',
        recipients: String(cfg.sync_alert_recipients || '').split(/[,;\s]+/).filter(Boolean).length };
    } catch (_) { /* config unreadable → alerts shown as unknown */ }
    res.json(h);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/sync/runs', requireReportSession, requireAdmin, async (req, res) => {
  try {
    const job = req.query.job ? String(req.query.job).slice(0, 80) : null;
    res.json({ runs: await _syncStore.recentRuns({ jobKey: job, limit: req.query.limit }) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
// Run a registered job now (admin+), e.g. POST /api/sync/run/zoho.survey — same envelope as cron.
app.post('/api/sync/run/:key', requireReportSession, requireAdmin, (req, res) => {
  const key = String(req.params.key || '');
  if (!syncRunner.get(key)) return res.status(404).json({ error: 'Unknown job' });
  if (syncRunner.isRunning(key)) return res.status(409).json({ ok: false, error: 'Job is already running' });
  res.json({ ok: true, message: `Job ${key} started` });
  syncRunner.run(key, { trigger: 'manual' });
});

app.post('/api/sync/trigger/:job', requireReportSession, requireAdmin, async (req, res) => {
  const { job } = req.params;
  const force = req.query.force === 'true' || req.body?.force === true;

  // Through the sync runner (lock + run log + alerts). The requests job clears and rebuilds
  // the ticket cache itself when triggered manually.
  const validJobs = { change_cab: 'zoho.change_cab', survey: 'zoho.survey', requests: 'zoho.requests' };
  if (!validJobs[job]) {
    return res.status(400).json({ error: `Unknown job: ${job}. Valid: ${Object.keys(validJobs).join(', ')}` });
  }
  if (syncRunner.isRunning(validJobs[job])) {
    return res.status(409).json({ ok: false, error: `Sync job '${job}' is already running` });
  }
  // Run async — respond immediately so the HTTP request doesn't timeout on large syncs
  const msg = force && job === 'requests'
    ? `Force full re-sync of requests started — all overdue_status values will be refreshed. Check /api/sync/status for progress.`
    : `Sync job '${job}' started. Check /api/sync/status for progress.`;
  res.json({ ok: true, message: msg, force: force && job === 'requests' });

  syncRunner.run(validJobs[job], { trigger: 'manual', args: { force: force && job === 'requests' } });
});

// Assets routes - extracted to routes/assets.js (SDP-DASH-2.0 step 5, 2026-10-21)
app.use(require('./routes/assets')({
  express, requireReportSession, requireAdmin, requireSuperAdmin, requireRole,
}));

app.get('/health', (req, res) => res.json({
  status: 'ok',
  version: _INSTALLED ? _INSTALLED.version : require('./package.json').version + '-dev',   // what is running (ADR-003)
  build: APP_VERSION,
  tokenValid: Date.now() < tokenState.expiresAt,
  expiresAt: new Date(tokenState.expiresAt).toISOString(),
  refreshCount: tokenState.refreshCount,
  grantedScope: tokenState.grantedScope || 'unknown (not yet refreshed)',
  lastRefreshError: tokenState.lastRefreshError || null,
  orgId: CONFIG.orgId, workspaceId: CONFIG.workspaceId,
  uptime: Math.round(process.uptime()) + 's',
  surveySource:  'Analytics Plus view ' + _surveyRouter.helpers.SURVEY_VIEW_ID,
  surveyCacheAge: _surveyRouter.helpers.surveyCache.ts ? Math.round((Date.now() - _surveyRouter.helpers.surveyCache.ts) / 1000) + 's' : 'empty',
}));

const { filterRecentMonths } = require('./services/recentMonths');   // also used by routes/survey.js

// ── Raw request rows — shared cache with disk persistence ────────────────────
// All endpoints that need per-ticket data share this cache so only one Zoho API
// call happens per cache window, regardless of how many endpoints are hit.
// The cache is written to disk so server restarts don't cause a cold-cache wait.
const _RAW_CACHE_FILE = path.join(__dirname, 'data', 'raw_cache.json');
const _rawCache = { data: null, ts: 0, TTL: 3600000 * 4 }; // 4-hour TTL on disk cache

// Load persisted cache from disk at startup (instant — no Zoho call needed)
(function _loadRawCacheFromDisk() {
  try {
    if (fs.existsSync(_RAW_CACHE_FILE)) {
      const saved = JSON.parse(fs.readFileSync(_RAW_CACHE_FILE, 'utf8'));
      const age = Date.now() - (saved.ts || 0);
      if (saved.rows && saved.rows.length > 0 && age < _rawCache.TTL) {
        _rawCache.data = { rows: saved.rows, columns: saved.columns || [] };
        _rawCache.ts   = saved.ts;
        console.log(`[startup] ✅ Loaded ${saved.rows.length} raw rows from disk cache (age: ${Math.round(age/60000)} min)`);
      } else if (saved.rows && saved.rows.length > 0) {
        // Expired but load anyway as stale — better than nothing while background refresh runs
        _rawCache.data = { rows: saved.rows, columns: saved.columns || [] };
        _rawCache.ts   = saved.ts;
        console.log(`[startup] ⚠️ Disk cache expired (${Math.round(age/60000)} min old) — loaded as stale, background refresh will update`);
      }
    }
  } catch(e) {
    console.warn('[startup] Could not load raw cache from disk:', e.message);
  }
})();

// Persist cache to disk (async write — doesn't block the request)
function _saveRawCacheToDisk() {
  if (!_rawCache.data || !_rawCache.data.rows) return;
  const payload = JSON.stringify({ ts: _rawCache.ts, rows: _rawCache.data.rows, columns: _rawCache.data.columns || [] });
  fs.writeFile(_RAW_CACHE_FILE, payload, err => {
    if (err) console.warn('[cache] ⚠️ Could not save raw cache to disk:', err.message);
    else console.log(`[cache] 💾 Raw cache saved to disk (${_rawCache.data.rows.length} rows)`);
  });
}

/// Convert ISO datetime (stored in SQLite) back to Zoho SDP format "DD Mon YYYY, HH:MM:SS AM/PM"
// Used by the SQLite cache fallback so browser-side date parsers still work.
const _ISO_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function isoToZohoStr(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso; // pass through unchanged if not parseable
  const day  = String(d.getDate()).padStart(2, '0');
  const mon  = _ISO_MONTHS[d.getMonth()];
  const year = d.getFullYear();
  let h      = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h          = h % 12 || 12;
  const hh   = String(h).padStart(2, '0');
  const mm   = String(d.getMinutes()).padStart(2, '0');
  const ss   = String(d.getSeconds()).padStart(2, '0');
  return `${day} ${mon} ${year}, ${hh}:${mm}:${ss} ${ampm}`;
}

// Parse Zoho datetime string "DD Mon YYYY, H:MM:SS AM/PM" → Date object.
// Also handles ISO "YYYY-MM-DD..." format as a fallback.
const _ZMMAP = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
function parseZohoStr(str) {
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return new Date(str);
  const p = String(str).trim().split(/[\s,]+/);
  if (p.length < 3) return null;
  const d = parseInt(p[0]), m = _ZMMAP[p[1]], y = parseInt(p[2]);
  if (isNaN(d) || m === undefined || isNaN(y)) return null;
  const tp = (p[3] || '').split(':').map(Number);
  let h = tp[0] || 0; const mi = tp[1] || 0, sc = tp[2] || 0;
  const suf = (p[4] || '').toUpperCase();
  if (suf === 'PM' && h < 12) h += 12; else if (suf === 'AM' && h === 12) h = 0;
  return new Date(y, m, d, h, mi, sc);
}

// Rebuild raw cache directly from SQLite — instant, no Zoho API call.
// Used at startup and as fallback when Zoho API is unavailable.
async function _rebuildCacheFromSQLite() {
  if (_rawCacheRefreshing) return;
  _rawCacheRefreshing = true;
  try {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 13); cutoff.setDate(1); cutoff.setHours(0,0,0,0);
    // Forked reader (sqlite/pg dispatch) — in pg mode reads from Postgres, not the empty sqlite handle.
    const dbRows = await require('./reports-db').getRequestRecordsSince(cutoff.toISOString());
    if (dbRows.length > 0) {
      const rows = dbRows.map(r => ({
        'Request ID':             r.request_id,
        'Request Display ID':     r.display_id,
        'Subject':                r.subject,
        'Request Status':         r.request_status,
        'Request Pending Status': r.pending_status != null ? String(r.pending_status) : null,
        'Overdue Status':         r.overdue_status != null ? String(r.overdue_status) : null,
        'Service Request':        r.service_request != null ? String(r.service_request) : null,
        'Request Type':           r.request_type,
        'IsEscalated':            r.is_escalated != null ? String(r.is_escalated) : null,
        'Reopen Count':           r.reopen_count != null ? String(r.reopen_count) : null,
        'DueBy Time':             isoToZohoStr(r.due_by_time),
        'Time Elapsed':           r.time_elapsed_ms != null ? String(r.time_elapsed_ms) : null,
        'Created Time':           isoToZohoStr(r.created_time),
        'Resolved Time':          isoToZohoStr(r.resolved_time),
        'Completed Time':         isoToZohoStr(r.completed_time),
        'Responded Time':         isoToZohoStr(r.responded_time),
        'Assigned Time':          isoToZohoStr(r.assigned_time),
        'Last Updated Time':      isoToZohoStr(r.last_updated_time),
        'First Response Overdue Status': r.first_response_overdue,
        'Technician':             r.technician,
        'Requester':              r.requester,
        'Category':               r.category,
        'Sub Category':           r.sub_category,
        'Site':                   r.site,
        'Group':                  r.tech_group,
        'Mode':                   r.mode,
        'Impact':                 r.impact,
      }));
      rows.forEach(r => {
        if (!r['Time to Respond in Hrs'] && r['Responded Time'] && r['Created Time']) {
          const ct = parseZohoStr(r['Created Time']), rt = parseZohoStr(r['Responded Time']);
          if (ct && rt) r['Time to Respond in Hrs'] = +((rt - ct) / 3_600_000).toFixed(2);
        }
        if (!r['Time to Resolve (in Days)'] && r['Time Elapsed']) {
          const te = parseInt(r['Time Elapsed'] || '0', 10);
          if (te > 0) r['Time to Resolve (in Days)'] = +(te / 86_400_000).toFixed(4);
        }
      });
      _rawCache.data = { rows, columns: rows.length > 0 ? Object.keys(rows[0]) : [] };
      _rawCache.ts   = Date.now();
      _saveRawCacheToDisk();
      console.log(`[getRawRequestRows] ✅ SQLite cache built — ${rows.length} rows`);
    }
  } catch(e) {
    console.warn('[getRawRequestRows] ⚠️ SQLite cache build failed:', e.message);
  } finally {
    _rawCacheRefreshing = false;
  }
}

// Background refresh — runs silently when cache is 80%+ expired.
// Means the NEXT cache miss never has to wait — data is already fresh.
let _rawCacheRefreshing = false;
async function _backgroundRefreshRawCache() {
  if (_rawCacheRefreshing) return; // already in progress
  // Skip if cache was refreshed recently (within last 10 minutes) — avoids redundant Zoho calls
  const ageMs = _rawCache.ts ? Date.now() - _rawCache.ts : Infinity;
  if (ageMs < 600000) { console.log(`[getRawRequestRows] ⏭ Background refresh skipped — cache only ${Math.round(ageMs/60000)}min old`); return; }
  _rawCacheRefreshing = true;
  console.log('[getRawRequestRows] 🔄 Background refresh started (incremental — last 3 months)…');
  try {
    // Fetch only the last 3 months (~10k rows) to stay well under Zoho's stream limit.
    // Merge fresh rows with existing cache rows (fresh take priority for duplicates),
    // then trim to 13 months so trend charts retain full history.
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 3); cutoff.setDate(1); cutoff.setHours(0,0,0,0);
    const pad = n => String(n).padStart(2,'0');
    const criteria = `("Created Time">='${cutoff.getFullYear()}-${pad(cutoff.getMonth()+1)}-${pad(cutoff.getDate())}')`;
    const result   = await fetchViewWithCriteria(VIEWS.REQUEST_TABLE, 15000, criteria);
    const freshRows = result.rows || [];
    console.log(`[getRawRequestRows] Fetched ${freshRows.length} fresh rows from Zoho`);

    // Compute derived timing fields for fresh rows
    freshRows.forEach(r => {
      if (!r['Time to Respond in Hrs'] && r['Responded Time'] && r['Created Time']) {
        const ct = parseZohoStr(r['Created Time']), rt = parseZohoStr(r['Responded Time']);
        if (ct && rt) r['Time to Respond in Hrs'] = +((rt - ct) / 3_600_000).toFixed(2);
      }
      if (!r['Time to Resolve (in Days)'] && r['Time Elapsed']) {
        const te = parseInt(r['Time Elapsed'] || '0', 10);
        if (te > 0) r['Time to Resolve (in Days)'] = +(te / 86_400_000).toFixed(4);
      }
    });

    // Merge: fresh rows replace stale cache rows for the same RequestID
    const freshIds = new Set(freshRows.map(r => r['Request ID'] || r['RequestID'] || '').filter(Boolean));
    const existingRows = (_rawCache.data && _rawCache.data.rows) ? _rawCache.data.rows : [];
    const merged = [
      ...freshRows,
      ...existingRows.filter(r => !freshIds.has(r['Request ID'] || r['RequestID'] || ''))
    ];

    // Trim merged set to 13 months so trend charts keep full history
    const rows = filterRecentMonths(merged, 13);
    _rawCache.data = { rows, columns: rows.length > 0 ? Object.keys(rows[0]) : [] };
    _rawCache.ts   = Date.now();
    _saveRawCacheToDisk();
    console.log(`[getRawRequestRows] ✅ Background refresh done — ${freshRows.length} fresh + ${existingRows.length} existing → ${rows.length} merged rows cached`);
  } catch(err) {
    console.warn('[getRawRequestRows] ⚠️ Background refresh (Zoho) failed:', err.message);
    // Rebuild from SQLite so new sync data is never lost when Zoho API is unavailable
    _rawCacheRefreshing = false; // release lock before calling _rebuildCacheFromSQLite
    await _rebuildCacheFromSQLite();
    return;
  } finally {
    _rawCacheRefreshing = false;
  }
}

// Shared fetch — returns raw Zoho rows (Zoho field names, no mapping needed).
// Stale-while-revalidate: always return cached data immediately if any exists,
// only blocking on a live Zoho fetch when there is absolutely no cache on disk.
async function getRawRequestRows() {
  const age = _rawCache.data ? Date.now() - _rawCache.ts : Infinity;
  const hasCache = _rawCache.data && _rawCache.data.rows && _rawCache.data.rows.length > 0;

  if (hasCache) {
    // Always serve from cache immediately — refreshes are ONLY triggered by cron jobs,
    // never by user page loads. This prevents multiple concurrent users from jamming
    // the server with simultaneous 25k-row Zoho fetches.
    const ageMin = Math.round(age / 60000);
    const label  = age >= _rawCache.TTL ? `stale, ${ageMin}min old` : `${ageMin}min old`;
    console.log(`[getRawRequestRows] ✅ Serving ${_rawCache.data.rows.length} rows from cache (${label})`);
    return _rawCache.data.rows;
  }

  // ── DB-only fallback (2026-05-28) ──────────────────────────────────────
  // No in-memory cache (post-restart with no disk cache, or manually cleared).
  // Build from local SQLite — instant, no Zoho call. The cron jobs keep
  // request_records fresh; page loads NEVER hit Zoho directly.
  //
  // Previous behaviour fetched 20k rows from Zoho here, which:
  //   - slowed first page load by 10-30 sec
  //   - risked tripping Zoho's rate-limit on hot reload windows
  //   - caused 502s through IIS ARR on cold-cache cases
  //
  // The user explicitly asked (2026-05-28): "load direct from DB only,
  // rely on cron". So this path now ONLY rebuilds from SQLite, even if
  // the resulting cache is empty.
  console.log('[getRawRequestRows] Cache cold — rebuilding from SQLite (no Zoho call)…');
  await _rebuildCacheFromSQLite();

  if (_rawCache.data && _rawCache.data.rows && _rawCache.data.rows.length > 0) {
    console.log(`[getRawRequestRows] ✅ Served ${_rawCache.data.rows.length} rows from SQLite rebuild`);
    return _rawCache.data.rows;
  }

  // SQLite is also empty (first install with no sync yet, or DB wiped) — return
  // empty array rather than throwing or calling Zoho. The page renders its
  // empty-state UI and the next cron tick will populate.
  console.warn('[getRawRequestRows] ⚠️ SQLite request_records empty — returning [] (waiting for next cron sync)');
  return [];
}

// Zoho / DB data routes (/api/change, /api/cab, /api/metrics/*, /api/data/*, risk register, caches)
// - extracted to routes/zohoData.js (SDP-DASH-2.0 step 5, lot 5.4). Mounted AFTER the raw request
// cache below it used to straddle: the module reads the cache through injected handles.
app.use(require('./routes/zohoData')({
  express, axios, CONFIG, VIEWS, tokenState, getValidToken, apiHeaders, fetchView, getCached, setCache,
  rowCache: _rowCache, rawCache: _rawCache, getRawCacheRefreshing: () => _rawCacheRefreshing, getRawRequestRows,
  requireReportSession, requireAdmin,
}));

// AI provider switch - services/aiProxy.js; routes in routes/ai.js (SDP-DASH-2.0 step 5, lot 5.4).
const { AI_PROVIDER, AI_DISABLED, AI_ALLOWED_MODELS, LOCAL_LLM_MODEL, _aiCallAnthropic, _aiCallLocal } = require('./services/aiProxy')({ axios, CONFIG });
app.use(require('./routes/ai')({
  express, axios, IS_DEV, safeError, CONFIG, VIEWS, getValidToken, apiHeaders, csvToRows, aiLimiter,
  requireReportSession, requireRole, AI_PROVIDER, AI_DISABLED, _aiCallLocal, _aiCallAnthropic,
}));

// ── SITE REPORTS (SQLite) ─────────────────────────────────────────
let rdb;
try {
  rdb = require('./reports-db.js');
  console.log('[Reports] ✅ reports-db loaded');
} catch(e) {
  console.error('[Reports] ❌ reports-db failed to load:', e.message);
}

let rpptx;
try {
  rpptx = require('./reports-weekly-pptx.js');
  console.log('[Reports] ✅ reports-weekly-pptx loaded');
} catch(e) {
  console.error('[Reports] ❌ reports-weekly-pptx failed to load:', e.message);
}

// Monthly PPTX generator — separate file for clean maintainability (v1.9.0)
let rpptxMonthly;
try {
  rpptxMonthly = require('./reports-monthly-pptx.js');
  console.log('[Reports] ✅ reports-monthly-pptx loaded');
} catch(e) {
  console.error('[Reports] ❌ reports-monthly-pptx failed to load:', e.message);
}

// Site Monthly Template PPTX generator (19-slide mine-site template)
let rpptxSiteTemplate;
try {
  rpptxSiteTemplate = require('./generate-site-monthly-pptx.js');
  console.log('[Reports] ✅ generate-site-monthly-pptx loaded');
} catch(e) {
  console.error('[Reports] ❌ generate-site-monthly-pptx failed to load:', e.message);
}

let rExecNewReport;
try {
  rExecNewReport = require('./executive-new-report.js');
  console.log('[Reports] ✅ executive-new-report loaded');
} catch(e) {
  console.error('[Reports] ❌ executive-new-report failed to load:', e.message);
}

// Report session auth middleware (uses separate sessions from Basic Auth).
// async because rdb.validateSession is a Promise under REPORTS_BACKEND=postgres
// (await on the sqlite path resolves synchronously — no behaviour change).
async function requireReportSession(req, res, next) {
  if (!rdb) return res.status(503).json({ error: 'Reports module not available' });
  const token = req.headers['x-report-token'] || getCookie(req, 'report_token');
  let user;
  try { user = await rdb.validateSession(token); }
  catch (e) { console.error('[auth] validateSession failed:', e.message); return res.status(500).json({ error: 'Auth check failed' }); }
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  req.reportUser = user;
  next();
}

// ── Report READ scope (RBAC audit 2026-10-02, lot 4a) ───────────────────────
// Decision: coordinators read their OWN site only; the admin tier reads every site.
// Before, the list and GET /api/reports/:id used an EXACT `role !== 'admin'` (a
// site-less editor saw every site, an executive with a site was wrongly scoped) and
// ~20 per-report / per-site read routes had no site check at all. One central guard
// covers every GET addressed by report id or by site id, so a route added later is
// locked by default. audit-viewer remains a global read-only auditor on /audit.
// Multi-site editors (2026-10-05): "own site" = ANY of the user's sites (primary +
// extras, services/userSites). Never compare user.site_id directly in a new check.
const userSites = require('./services/userSites');
const statusTransfer = require('./public/lib/statusTransfer');   // transfer statuses (also used by routes/meetings.js)
function _siteReadDenied(user, siteId) {
  if (rdb.userHasRole(user, 'admin')) return false;
  return !userSites.hasSite(user, siteId);
}
// The caller's Zoho helpdesk groups (lowercased), or null for the admin tier (all groups).
// A site-less non-admin gets [] — no group at all. A multi-site editor gets the union.
async function _userSiteGroups(user) {
  if (rdb.userHasRole(user, 'admin')) return null;
  const ids = userSites.siteIds(user);
  if (!ids.length) return [];
  const all = (await rdb.listSites()) || [];
  const out = [];
  for (const s of all.filter(x => ids.includes(Number(x.id)))) {
    for (const g of String(s.zoho_group || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean)) if (!out.includes(g)) out.push(g);
  }
  return out;
}
// Same rule for reads addressed by the meetings site CODE (site-data, site-actions):
// the code must resolve to the caller's own site. 'all'/empty is a fleet request.
async function _siteCodeReadDenied(user, code) {
  if (rdb.userHasRole(user, 'admin')) return false;
  if (!code || code === 'all') return true;
  const hit = await rdb.getSiteIdByModuleCode('meetings', code);
  return !hit || _siteReadDenied(user, hit.site_id);
}
// eslint-disable-next-line security/detect-unsafe-regex -- reviewed (step 4): anchored, the [^?]* class cannot overlap the literal /
const _REPORT_ID_READ = /^\/api\/reports\/(\d+)(\/[^?]*)?$/;
const _SITE_ID_READ   = /^\/api\/(?:reports\/(?:monthly|yearly|objectives)|sites)\/(\d+)(?:\/|$)/;
app.get([_REPORT_ID_READ, _SITE_ID_READ], requireReportSession, async (req, res, next) => {
  try {
    if (rdb.userHasRole(req.reportUser, 'admin')) return next();
    const byReport = _REPORT_ID_READ.exec(req.path);
    if (byReport) {
      if (byReport[2] === '/audit' && rdb.userHasRole(req.reportUser, 'audit-viewer')) return next();
      const report = await rdb.getReport(parseInt(byReport[1], 10));
      if (!report) return next();                       // the route answers its own 404
      if (_siteReadDenied(req.reportUser, report.site_id)) return res.status(403).json({ error: 'Access denied: this report belongs to another site' });
      return next();
    }
    const bySite = _SITE_ID_READ.exec(req.path);
    if (bySite && _siteReadDenied(req.reportUser, bySite[1])) return res.status(403).json({ error: 'Access denied: another site' });
    next();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Multi-role middleware ────────────────────────────────────────────
// All checks now route through rdb.userHasRole() so the hierarchy chain
// (super_admin > executive > admin > editor > viewer) AND the orthogonal
// feature roles (tracker-admin, tracker-editor, report-author, audit-viewer)
// resolve from the same source of truth.

function requireAdmin(req, res, next) {
  if (!rdb || !rdb.userHasRole(req.reportUser, 'admin')) {
    return res.status(403).json({ error: 'Admin only' });
  }
  next();
}

// Admin SETTINGS (the reports.html#admin console + its owned routes: config,
// users, sessions, sites/:id, recipients, schedule, sends, meridian, exec-view
// editorial, depreciation-config) are super_admin ONLY. This is the real
// boundary — the nav/page guard in reports.html is defence-in-depth. Operational
// requireAdmin routes (tracker, deck builder, assets sync/reconcile, meetings
// export, sync triggers, cache clears) are deliberately left at admin+.
function requireSuperAdmin(req, res, next) {
  if (!rdb || !rdb.userHasRole(req.reportUser, 'super_admin')) {
    return res.status(403).json({ error: 'super_admin only' });
  }
  next();
}

function requireExecutiveOrSuperAdmin(req, res, next) {
  if (!rdb || !rdb.userHasRole(req.reportUser, 'executive')) {
    return res.status(403).json({ error: 'Executive or super_admin only' });
  }
  next();
}

// Factory: produce a middleware that requires a specific role (hierarchical
// or feature). Used to gate endpoints behind the new tracker-admin /
// tracker-editor / report-author / audit-viewer roles.
//
//   app.post('/api/tracker/save', requireReportSession, requireRole('tracker-admin'), ...)
//
// Pass an array to require ANY of several roles:
//   requireRole(['tracker-admin', 'tracker-editor'])  // either is enough
function requireRole(roleOrRoles) {
  const roles = Array.isArray(roleOrRoles) ? roleOrRoles : [roleOrRoles];
  const mw = function requireRole(req, res, next) {
    if (!rdb) return res.status(503).json({ error: 'RBAC unavailable' });
    if (!roles.some(r => rdb.userHasRole(req.reportUser, r))) {
      return res.status(403).json({
        error: 'Forbidden — required role(s): ' + roles.join(' or '),
      });
    }
    next();
  };
  mw.requiredRoles = roles;          // read by tests/route-authz.smoke.test.js (step 4)
  return mw;
}

const jsonBody = express.json({ limit: '2mb' });

// ── Reporting suite (Foundation) ──────────────────────────────────────
const reportConfig    = require('./services/reportConfig');
const reportDirectory = require('./services/reportDirectory');
const reportSentLog   = require('./services/reportSentLog');
const reportSchedule  = require('./services/reportSchedule');
const { siteReportData } = require('./services/siteReport');
const { buildSiteReportDeps } = require('./services/siteReportDeps');

if ((process.env.REPORTS_BACKEND || 'sqlite').toLowerCase() !== 'postgres' && rdb && rdb.db) {
  reportConfig._initSchema(rdb.db);
  reportDirectory._initSchema(rdb.db);
  reportSentLog._initSchema(rdb.db);
  reportSchedule._initSchema(rdb.db);
}

// Reporting configuration routes - extracted to routes/reportsConfig.js (SDP-DASH-2.0 step 5, lot 5.3)
app.use(require('./routes/reportsConfig')({
  express, rdb, requireReportSession, requireAdmin, requireSuperAdmin,
  reportConfig, reportDirectory, reportSchedule,
  tokenState, refreshAccessToken, applyAnalyticsSettings: _applyAnalyticsSettings,
}));

app.get('/api/reports/site-data', requireReportSession, async (req, res) => {
  try {
    const site = String(req.query.site || '');
    if (await _siteCodeReadDenied(req.reportUser, site)) return res.status(403).json({ error: 'Access denied: another site' });
    if (site === 'all') return res.json({ site_code: 'all', consolidated: true, note: 'pick a site (consolidated view lands in sub-project 2)' });
    const now = new Date();
    const year = +(req.query.year || now.getFullYear());
    const month = +(req.query.month || (now.getMonth() + 1));
    const kind = req.query.kind === 'monthly' ? 'monthly' : 'weekly';
    const data = await siteReportData(site, { year, month, kind }, buildSiteReportDeps());
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// GET /api/reports/site-actions?site=CODE — SP1a per-site Actions Register hub.
// Composes THREE existing dual-backend readers (meetings/inspection listActions
// + the latest report's action_items) through the pure buildSiteActions. No
// schema change, no touch to the report save path. Registered ABOVE
// /api/reports/:id (the :id shadowing trap). Unknown/absent site → empty groups.
app.get('/api/reports/site-actions', requireReportSession, async (req, res) => {
  try {
    const { buildSiteActions } = require('./services/siteActionsRegister');
    const rdb = require('./reports-db');
    const meetingsDb = require('./meetings-db');
    const inspectionDb = require('./inspection-db');
    const code = String(req.query.site || '').trim();
    if (await _siteCodeReadDenied(req.reportUser, code)) return res.status(403).json({ error: 'Access denied: another site' });
    const asOf = new Date().toISOString().slice(0, 10);
    if (!code || code === 'all') {
      return res.json({ site: code || null, week_label: null, ...buildSiteActions({ asOf }) });
    }
    // meetings + inspection share the 'meetings' namespace code (SMI/MGO/HGO…).
    const meetings = await meetingsDb.listActions({ site: code });
    const inspection = await inspectionDb.listActions({ site: code });
    // Report follow-ups = every open, non-merged follow-up across ALL the site's
    // reports, deduped by carry-forward lineage (SP1b-lignée) — so an open item
    // on an old report never carried forward still surfaces, once. Each row
    // carries its own report_id/week_label. resolved.site_id (NOT .id) — the
    // documented falsy-id pitfall.
    let report = null;
    const resolved = await rdb.getSiteIdByModuleCode('meetings', code);
    if (resolved && resolved.site_id) {
      report = { actions: (await rdb.getSiteOpenReportActions(resolved.site_id)).actions };
    }
    // Open issues of the site (resolved/cancelled are dropped by the engine) — the hub
    // shows who has no action yet and lets the user add one from the issue.
    const issues = await meetingsDb.listIssues({ site: code, limit: 1000 });
    const sa = buildSiteActions({ meetings, inspection, report, issues, asOf });
    // "Show closed / cancelled" (2026-10-16): the last 30 days, so a wrong click can be reopened.
    if (req.query.closed === '1') {
      const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const closedReport = (resolved && resolved.site_id) ? await rdb.getSiteClosedReportActions(resolved.site_id, since) : null;
      sa.recent_closed = require('./services/siteActionsRegister').buildRecentlyClosed(
        { meetings, inspection, issues, report: closedReport, since });
      sa.recent_since = since;
    }
    // Best-effort: fold Meridian project links onto matching rows for the "▸ Projet: X"
    // badge (F1). NEVER blocks the hub — a Meridian outage/misconfig leaves every
    // it.project null. getConfig is a Promise on pg → await it.
    let links = {}, baseUrl = '';
    try {
      const cfg = await reportConfig.getConfig(rdb.db);
      baseUrl = cfg.meridian_base_url || '';
      links = await require('./services/meridianLinks').getLinksForSite(code, { config: cfg });
    } catch (_) { links = {}; }
    require('./services/meridianActions').attachProjectLinks(sa, links, baseUrl);
    res.json({ site: code, ...sa });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// ── Report-write authorisation (audit 2026-09-05, F5) ────────────────────────
// A valid session is NOT enough to write a report or one of its follow-ups: the
// caller must (1) hold the editor role, (2) be scoped to the OBJECT's site — a
// site-less profile is NOT global, only admin+ is unscoped — and (3) a submitted
// report is frozen for everyone but super_admin (mirrors the status-revert rule).
// Returns null when allowed, else {status, error} for the route to send.
function _reportWriteDenial(user, report, opts = {}) {
  if (!report) return { status: 404, error: 'Report not found' };
  if (!rdb.userHasRole(user, 'editor')) return { status: 403, error: 'editor role required' };
  if (!rdb.userHasRole(user, 'admin')) {
    if (!userSites.hasSite(user, report.site_id)) return { status: 403, error: 'Access denied: this report belongs to another site' };
  }
  if (!opts.allowSubmitted && report.status === 'submitted' && !rdb.userHasRole(user, 'super_admin')) {
    return { status: 403, error: 'Report is submitted — only a super_admin can edit it' };
  }
  return null;
}
async function _authorizeReportWrite(req, res, reportId, opts) {
  const id = parseInt(reportId, 10);
  const report = Number.isInteger(id) ? await rdb.getReport(id) : null;
  const denial = _reportWriteDenial(req.reportUser, report, opts);
  if (denial) { res.status(denial.status).json({ error: denial.error }); return null; }
  return report;
}
// RBAC audit 2026-10-02 (A12) — writes addressed by SITE in the URL (monthly edits,
// annual objectives) had no check at all. Same F5 rule as a weekly report of that site.
function _authorizeSiteWrite(req, res, siteIdParam) {
  const site_id = parseInt(siteIdParam, 10);
  if (!Number.isInteger(site_id)) { res.status(400).json({ error: 'invalid site_id' }); return false; }
  const denial = _reportWriteDenial(req.reportUser, { site_id, status: 'draft' });
  if (denial) { res.status(denial.status).json({ error: denial.error }); return false; }
  return true;
}
// Same rule for a follow-up addressed by uid: resolve its owning report first.
async function _authorizeActionWrite(req, res, uid) {
  const owner = await rdb.getActionItemOwner(String(uid || ''));
  if (!owner) { res.status(404).json({ error: 'action not found' }); return null; }
  const denial = _reportWriteDenial(req.reportUser, { site_id: owner.site_id, status: owner.report_status });
  if (denial) { res.status(denial.status).json({ error: denial.error }); return null; }
  return owner;
}

// SP1b — merge a report follow-up into its Meetings/Inspection twin (a reference)
// / undo. Editor role + site scope of the owning report (F5).
// Keyed by the stable action uid; registered ABOVE /api/reports/:id.
app.post('/api/reports/action/:uid/merge', requireReportSession, async (req, res) => {
  try {
    const rdb = require('./reports-db');
    if (!(await _authorizeActionWrite(req, res, req.params.uid))) return;
    const uid = String(req.params.uid || '');
    const source = String((req.body && req.body.source) || '');
    const origin_id = parseInt(req.body && req.body.origin_id, 10);
    if (!['meetings', 'inspection'].includes(source)) return res.status(400).json({ error: 'source must be meetings|inspection' });
    if (!Number.isInteger(origin_id) || origin_id <= 0) return res.status(400).json({ error: 'origin_id must be a positive integer' });
    const r = await rdb.setActionMerge(uid, { source, origin_id });
    if (!r.ok) return res.status(404).json({ error: 'action not found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/reports/action/:uid/unmerge', requireReportSession, async (req, res) => {
  try {
    const rdb = require('./reports-db');
    if (!(await _authorizeActionWrite(req, res, req.params.uid))) return;
    const r = await rdb.clearActionMerge(String(req.params.uid || ''));
    if (!r.ok) return res.status(404).json({ error: 'action not found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Inline status change for a report follow-up from the Site Actions hub. Editor
// role; keyed by the stable uid (UPDATE never touches source/origin_id/lineage).
app.post('/api/reports/action/:uid/status', requireReportSession, async (req, res) => {
  try {
    const rdb = require('./reports-db');
    if (!(await _authorizeActionWrite(req, res, req.params.uid))) return;
    const status = String((req.body && req.body.status) || '');
    if (!['open', 'in_progress', 'on_hold', 'closed', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'invalid status' });
    }
    // 2026-10-16: cancelling a report follow-up needs a justification (appended to its comment).
    const note = String((req.body && req.body.note) || '').trim();
    const tErr = statusTransfer.validate(status, note, null);
    if (tErr) return res.status(400).json({ error: tErr });
    const r = await rdb.setActionStatus(String(req.params.uid || ''), status, status === 'cancelled' ? 'Cancelled: ' + note : null);
    if (!r.ok) return res.status(404).json({ error: 'action not found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Merge an already-saved follow-up into another's carry-forward lineage (the
// per-row "Fusionner avec…" button). Editor role; keyed by the stable uid. The
// body carries the TARGET lineage string (the canonical action's lineage||uid).
app.post('/api/reports/action/:uid/relineage', requireReportSession, async (req, res) => {
  try {
    const rdb = require('./reports-db');
    if (!(await _authorizeActionWrite(req, res, req.params.uid))) return;
    const lineage = String((req.body && req.body.lineage) || '').trim();
    if (!lineage) return res.status(400).json({ error: 'lineage required' });
    // Optional: also rename the task to unify a merged group's label onto the winner.
    const rawTask = req.body && req.body.task;
    const task = (typeof rawTask === 'string' && rawTask.trim()) ? rawTask.trim() : undefined;
    // 2026-10-15: the WHOLE group of this follow-up moves (every week it was carried),
    // otherwise its older copies re-appear as open actions after the merge.
    const r = await rdb.relineageGroup(String(req.params.uid || ''), lineage, task);
    if (!r.ok) return res.status(404).json({ error: 'action not found' });
    try {
      await rdb.logAudit({ report_id: r.report_id, site_id: r.site_id, user_id: req.reportUser.id,
        username: req.reportUser.username, action: 'action_merged',
        details: { from_key: r.from_key, to_key: lineage, rows: r.rows, renamed: task != null } });
    } catch (_) { /* audit is best-effort */ }
    res.json({ ok: true, rows: r.rows, from_key: r.from_key });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// SP3 — GET /api/reports/:id/importable-actions — the report site's OPEN Meetings
// + Inspection actions, so the editor can pull them into the report's Actions
// section as references. Registered ABOVE /api/reports/:id (the shadowing trap).
app.get('/api/reports/:id/importable-actions', requireReportSession, async (req, res) => {
  try {
    const rdb = require('./reports-db');
    const meetingsDb = require('./meetings-db');
    const inspectionDb = require('./inspection-db');
    const rep = await rdb.getReport(parseInt(req.params.id, 10));
    if (!rep) return res.status(404).json({ error: 'report not found' });
    const codes = await rdb.listSiteModuleCodes('meetings');
    const match = (codes || []).find((c) => c.site_id === rep.site_id);
    const code = match ? match.code : null;
    if (!code) return res.json({ site: null, meetings: [], inspection: [] });
    const TERM_M = new Set(statusTransfer.DONE);   // + demand / helpdesk_ticket (2026-10-16)
    const TERM_I = new Set(['closed', 'cancelled']);
    const open = (rows, term) => (rows || []).filter((a) => !term.has(String(a.status || '').toLowerCase()));
    const m = open(await meetingsDb.listActions({ site: code }), TERM_M);
    const i = open(await inspectionDb.listActions({ site: code }), TERM_I);
    res.json({
      site: code,
      meetings: m.map((a) => ({ origin_id: a.id, title: a.description || '—', owner: a.owner_it || a.owner_email || null, due_date: a.target_date || null, origin_label: a.meeting_reference || null })),
      inspection: i.map((a) => ({ origin_id: a.id, title: a.description || '—', owner: a.owner || null, due_date: a.due_date || null, origin_label: a.inspection_label || null })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// GET /api/reports/review-data — the live IT Review dashboard's data (3B-2b).
// Feeds public/it-review.html: loadReviewData(asOf) → D, then buildReviewVals
// emits the 61-key flat object the template's bindings read.
// IT Review is a FLEET-WIDE governance rollup → executive/management only
// (mirrors the page gate data-require="executive|scorecard-viewer"). A site
// admin/editor session must not be able to fetch it directly by URL.
app.get('/api/reports/review-data', requireReportSession, requireRole(['executive', 'scorecard-viewer']), async (req, res) => {
  try {
    const { loadReviewData, loadReviewExtras } = require('./services/reviewData');
    const { buildReviewVals, codesOf, extrasWindows } = require('./services/reviewDashboard');
    // WHITELIST every param — they reach the model; never pass raw query through.
    // asOf is inlined, NOT a helper: _todayISO() does not exist in server.js
    // (verified), and adding one would breach the approved 3-change budget.
    const asOf   = String(req.query.asOf || '').match(/^\d{4}-\d{2}-\d{2}$/) ? req.query.asOf : new Date().toISOString().slice(0, 10);
    const view   = ['dashboard', 'scoreboard', 'brief'].includes(req.query.view) ? req.query.view : 'dashboard';
    const period = ['week', 'month', 'quarter', 'semester'].includes(req.query.period) ? req.query.period : 'week';
    const site   = String(req.query.site || 'ALL');
    const D = await loadReviewData(asOf);
    // OUR Helpdesk & Changes panel — additive, and it never enters his score.
    // codesOf/extrasWindows are imported, not re-derived: his `codes` ORDER is
    // load-bearing and the two-window decision lives in ONE place.
    // The try is NOT optional: a reader failure must degrade to extras:undefined
    // (→ exactly his 61 keys, panel hidden by its sc-if) rather than 500 his
    // whole page. His dashboard must not go down because our panel threw.
    let extras;
    try { extras = await loadReviewExtras(codesOf(D), extrasWindows(period)); }
    catch (e) { console.error('[review] extras failed — rendering without the panel:', e.message); }
    // OUR operational Scoreboard panel — additive, gathered in a SEPARATE
    // try/catch so a reader failure drops only this panel (its sc-if hides it),
    // never his 61-key page. The month is derived from asOf. deps wire the glue
    // reader to the REAL module functions.
    try {
      const d = new Date(asOf + 'T00:00:00Z');
      const month = { year: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
      const rdb = require('./reports-db');
      const deps = {
        listSiteModuleCodes: rdb.listSiteModuleCodes,
        getCalendarMonthlyHelpdesk: rdb.getCalendarMonthlyHelpdesk,
        getMeetingsInsights: (a) => require('./meetings-db').insights(a),
        getInspectionAggregate: (a) => require('./inspection-db').aggregate(a),
        getEffortLeaderboard: require('./assets-db').getEffortLeaderboard,
      };
      const sd = await require('./services/scoreboardData').loadScoreboardData({ month, asOf, deps });
      const sb = require('./services/siteScoreboard').buildSiteScoreboard(sd.perSite, { prev: sd.prev });
      extras = Object.assign(extras || {}, { scoreboard: sb });
    } catch (e) { console.error('[review scoreboard]', e && e.message); }
    res.json(buildReviewVals(D, { view, period, site, asOf, extras }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Report send routes - extracted to routes/reportsSend.js (SDP-DASH-2.0 step 5, lot 5.3b)
app.use(require('./routes/reportsSend')({ express, rdb, requireReportSession, requireSuperAdmin, reportConfig }));

// Accounts routes (auth, SSO, sites, users, sessions, departments) - extracted to
// routes/accounts.js (SDP-DASH-2.0 step 5, lot 5.3)
app.use(require('./routes/accounts')({
  express, rdb, requireReportSession, requireSuperAdmin, requireExecutiveOrSuperAdmin,
  loginLimiter, jsonBody, reportConfig, sessionCookieOpts: _sessionCookieOpts, getCookie, IS_DEV,
}));

// Weekly site report routes - extracted to routes/reports.js (SDP-DASH-2.0 step 5, lot 5.3c).
// Its two shared helpers (asset review for the decks, action-item validation) ride on .helpers.
const _reportsRouter = require('./routes/reports')({
  express, rdb, requireReportSession, requireRole, jsonBody, IS_DEV, reportConfig,
  authorizeReportWrite: _authorizeReportWrite, userSiteGroups: _userSiteGroups,
  getRawRequestRows, parseZohoStr,
});
app.use(_reportsRouter);

// Build the per-site monthly meeting summary for the report decks. Maps the
// report's site name to a meetings site_code and returns the calendar-month
// snapshot, or null (degrades gracefully) if the meetings module is absent,
// the site can't be mapped, or anything throws.
// async because getSiteMonthlyMeetingSummary is a Promise under
// MEETINGS_BACKEND=postgres (await is a no-op on the sqlite path). All call
// sites await this — it's an optional enrichment that degrades to null.
async function _meetingsSummaryForSite(siteName, year, month) {
  try {
    if (!meetingsDb || !siteName || !year || !month) return null;
    const code = meetingsDb.siteNameToCode(siteName);
    if (!code) return null;
    return await meetingsDb.getSiteMonthlyMeetingSummary(code, parseInt(year, 10), parseInt(month, 10));
  } catch (e) { console.warn('[Report] meetings summary failed:', e.message); return null; }
}

// Report deck routes (PPTX, monthly/yearly data, objectives, notes) - extracted to
// routes/reportsDecks.js (SDP-DASH-2.0 step 5, lot 5.3b)
app.use(require('./routes/reportsDecks')({
  express, rdb, requireReportSession, requireAdmin, requireRole, CONFIG,
  rpptx, rpptxMonthly, rpptxSiteTemplate, rExecNewReport,
  meetingsSummaryForSite: _meetingsSummaryForSite, assetReviewForPptx: _reportsRouter.helpers.assetReviewForPptx,
  validateActionItems: _reportsRouter.helpers.validateActionItems, authorizeSiteWrite: _authorizeSiteWrite,
}));

// Activity Tracker + Deck Builder routes (/api/tracker/*, /api/dashboard/*, /api/reports/exec-pptx)
// - extracted to routes/tracker.js (SDP-DASH-2.0 step 5, lot 5.4).
app.use(require('./routes/tracker')({ express, rdb, requireReportSession, requireAdmin, requireRole, jsonBody }));

// ══════════════════════════════════════════════════════════════════
// IT INSPECTION MODULE — SQLite persistence API (additive, separate
// inspection.db file, mirrors the tracker module's shape).
// ══════════════════════════════════════════════════════════════════
let inspectionDb;
try {
  inspectionDb = require('./inspection-db.js');
  console.log('[Inspection] ✅ inspection-db loaded');
} catch(e) {
  console.error('[Inspection] ❌ inspection-db failed to load:', e.message);
}

let inspectionPptx;
try {
  inspectionPptx = require('./inspection-pptx.js');
  console.log('[Inspection] ✅ inspection-pptx loaded');
} catch(e) {
  // The PPTX generator is optional at boot — module-not-found here just means
  // it hasn't been deployed yet. The data routes still work.
  if (e && e.code !== 'MODULE_NOT_FOUND') {
    console.error('[Inspection] ❌ inspection-pptx failed to load:', e.message);
  }
}

// ── Inspection routes — extracted to routes/inspection.js (split-server.js pilot, 2026-06-21) ──
// inspectionDb / inspectionPptx are require()d above (also used by the meetings
// routes) and injected here; the warm ticket cache is read live via getRawCache.
app.use(require('./routes/inspection')({
  express, inspectionDb, inspectionPptx, rdb,
  requireReportSession, requireAdmin, requireExecutiveOrSuperAdmin, requireRole,
  getRawCache: () => _rawCache,
}));

// ── 4MyPeople integration (slice 1) — read-only /api/v1 consumption ──────────
// Behind the dashboard's OWN auth (executive/admin). No shared session/SSO yet.
// Disabled until FMP_API_KEY is set in .env (the client degrades to [] without it,
// but we only mount when configured to avoid empty panels).
if (process.env.FMP_API_KEY) {
  const { makeFmpClient } = require('./services/fmpClient');
  app.use(require('./routes/fourmypeople')({
    express, requireReportSession, requireRole,
    fmpClient: makeFmpClient(),   // reads FMP_API_URL + FMP_API_KEY from env
  }));
  console.log('[FMP] 4MyPeople integration routes mounted (/api/integration/fmp/*)');
}

// ── Meridian (PMO) integration — inbound read API (F1, contract C2) ──────────
// GET /api/actions/open?site= re-serves buildSiteActions to Meridian. ALWAYS
// mounted: the handler's X-API-Key check (report_config meridian_in_key) is the
// sole gate, so setting the key from the admin card makes it live with no restart;
// unset ⇒ inert (401). A distinct /api prefix, so /api/reports/:id can't shadow it.
app.use(require('./routes/meridian')({ express }));

// ── OPManager infrastructure availability — read API (V1a, /api/analytics/opmanager/*) ──
// Serves the snapshots the nightly sync composes from the prepared Analytics view. OPS
// never polls devices. availability + coverage are session-guarded (global /api/ gate +
// requireReportSession); sync is admin. A distinct /api/analytics prefix, so /api/reports/:id
// can't shadow it. fetchView is passed for coverage + on-demand sync.
app.use(require('./routes/opmanager')({ express, requireReportSession, requireAdmin, requireSuperAdmin, fetchView }));

// ── Site Awareness — read-only per-site business view (/api/site-awareness/*) ──
// Server-enforced scoping: a site-business user's site comes from the session, never
// the request. PII-safe (exec-view whitelist pattern). Distinct /api/site-awareness prefix.
app.use(require('./routes/siteAwareness')({ express, requireReportSession, rdb: require('./reports-db'),
  meetingsDb: require('./meetings-db'), inspectionDb: require('./inspection-db'),
  trackerDb: require('./tracker-db'), trackerScore: require('./tracker-pptx') }));

// ── Personal Roadmap Manager — private super_admin tool (/api/roadmap/*) ──────
// Per-user objectives + deliverables for the Service & Support Manager. user_id is
// always req.reportUser.id (never trusted from body). Distinct /api/roadmap prefix.
app.use(require('./routes/roadmap')({ express, requireReportSession, requireSuperAdmin }));
// Teams SLA alerts (2026-10-03) — super_admin settings, test card, preview, run-now.
app.use(require('./routes/teamsSla')({ express, requireReportSession, requireSuperAdmin }));
// Step 3 (SDP-DASH-2.0) — KPI dictionary (/api/metrics/*) + site registry (/api/registry/sites, admin).
app.use(require('./routes/metrics')({ express, requireReportSession, requireAdmin, siteCodeReadDenied: _siteCodeReadDenied }));

// ══════════════════════════════════════════════════════════════════
// MEETINGS — Department Meetings & Council Escalations (v2 schema)
// Mirrors the canonical Endeavour Mining operating system 1:1:
//   - one MEETING per Site × Department × Month (signed PV)
//   - each meeting carries nested projects, issues, actions
//   - issues marked escalate=Y feed the Mine IT Council view
//   - 5 Engagements compliance monitor surfaces SLA breaches
// ══════════════════════════════════════════════════════════════════
let meetingsDb;
try {
  meetingsDb = require('./meetings-db.js');
  console.log('[Meetings] ✅ meetings-db loaded');
} catch(e) {
  console.error('[Meetings] ❌ meetings-db failed to load:', e.message);
}

// Bulk-import module: Excel parse / dry-run / commit + template builder.
// Optional — if the xlsx dep is missing on prod, the routes will 503
// but the rest of the meetings module keeps working.
let meetingsImport;
try {
  meetingsImport = require('./meetings-import.js');
  console.log('[Meetings] ✅ meetings-import loaded');
} catch(e) {
  console.error('[Meetings] ⚠️  meetings-import not loaded (run npm install xlsx):', e.message);
}

// Business Incubation import (a sibling of meetings-import; same xlsx dep).
let meetingsImportIncubation;
try {
  meetingsImportIncubation = require('./meetings-import-incubation.js');
  console.log('[Meetings] ✅ meetings-import-incubation loaded');
} catch(e) {
  console.error('[Meetings] ⚠️  meetings-import-incubation not loaded:', e.message);
}

// PPTX generator — server-side PV + progress deck builder. Uses pptxgenjs
// (already a project dep). Loads even if the meetings DB is offline so the
// route handler can return a 503 with a useful message rather than crashing.
let meetingsPptx;
try {
  meetingsPptx = require('./meetings-pptx.js');
  console.log('[Meetings] ✅ meetings-pptx loaded');
} catch(e) {
  console.error('[Meetings] ⚠️  meetings-pptx failed to load:', e.message);
}

// Meetings routes - extracted to routes/meetings.js (SDP-DASH-2.0 step 5, 2026-10-21)
app.use(require('./routes/meetings')({
  express, rdb, inspectionDb, meetingsDb, meetingsImport, meetingsImportIncubation, meetingsPptx,
  requireReportSession, requireRole,
}));

// ── START ─────────────────────────────────────────────────────────
async function start() {

  // Step 2 (SDP-DASH-2.0) — zero SQLite in production: with REQUIRE_POSTGRES=1 the server refuses
  // to start while a module is still on sqlite (services/backendGuard.js); without it, a warning.
  {
    const bg = require('./services/backendGuard').assertBootAllowed();
    if (bg.sqlite.length) console.warn(`[DB] ⚠ ${bg.message}`);
  }

  // PostgreSQL backends (Chunks 1-4) — connect each pool + apply its schema
  // before serving. Every module defaults to sqlite (the *_BACKEND env vars are
  // unset in prod), so each block is a no-op until the operator flips a flag.
  if (require('./tracker-db').TRACKER_BACKEND === 'postgres') {
    await require('./tracker-db').initPgTracker();
    console.log('[Tracker] PostgreSQL backend ready');
  }
  if (require('./reports-db').REPORTS_BACKEND === 'postgres') {
    await require('./reports-db').initPgReports();
    console.log('[Reports] PostgreSQL auth backend ready');
  }
  // System Logs v1 — one-time idempotent backfill of the report audit trail into
  // system_log (non-blocking; runs after the pg schema exists / sqlite is ready).
  require('./reports-db')._backfillSystemLogFromAudit().catch(() => {});
  if (require('./meetings-db').MEETINGS_BACKEND === 'postgres') {
    await require('./meetings-db').initPgMeetings();
    console.log('[Meetings] PostgreSQL backend ready');
  }
  if (require('./inspection-db').INSPECTION_BACKEND === 'postgres') {
    await require('./inspection-db').initPgInspection();
    console.log('[Inspection] PostgreSQL backend ready');
  }
  if (require('./assets-db').ASSETS_BACKEND === 'postgres') {
    await require('./assets-db').initPgAssets();
    console.log('[Assets] PostgreSQL backend ready');
  }

  // Zoho Analytics token — AFTER the databases are open, because the credentials may now
  // live in report_config (Admin ▸ Intégration API ▸ Analytics), with .env as the fallback.
  // A missing/failed token no longer stops the server: it serves from the disk cache and the
  // admin can fix the connection from the UI (the 50-min cron retries).
  try {
    const _as = await _applyAnalyticsSettings();
    if (!_as.ready) console.error('❌ Zoho Analytics credentials missing — fill Admin ▸ Intégration API ▸ Analytics (or .env ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN)');
    else await refreshAccessToken();
  } catch (e) {
    // The richer OAuth diagnostic (HTTP status + Zoho `error` code + remediation
    // hint) is already logged by refreshAccessToken — this line only summarises.
    console.error('⚠️  Token failed on startup (serving from stale cache; ALL Zoho calls will 400 until renewed):', e.message);
    console.error('⚠️  Renew: Admin ▸ Intégration API ▸ Analytics (or RENEW_ZOHO_TOKEN.html)');
  }

  // SECURITY: Bind interface controlled by env var BIND_HOST (see top
  // of file for rationale). On Windows production behind IIS reverse
  // proxy, set BIND_HOST=127.0.0.1 so the Node process is unreachable
  // from the network — only IIS on the same box can talk to it.
  // Inside Docker the Docker host port mapping handles isolation, so
  // 0.0.0.0 inside the container is fine.
  app.listen(PORT, BIND_HOST, () => {
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║  Endeavour Mining IT — ServiceDesk Plus Analytics Proxy   ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  Dashboard     : http://localhost:${PORT}                       ║`);
    console.log(`║  Analytics     : http://localhost:${PORT}/analytics.html        ║`);
    console.log(`║  Health        : http://localhost:${PORT}/health                ║`);
    console.log(`║  Sync Status   : http://localhost:${PORT}/api/sync/status       ║`);
    console.log(`║  Req Metrics   : http://localhost:${PORT}/api/metrics/requests  ║`);
    console.log(`║  Survey Data   : http://localhost:${PORT}/api/survey/summary    ║`);
    console.log('╠══════════════════════════════════════════════════════════════╣');
    if (!CONFIG.surveyId) {
      console.log('║  ⚠ ZOHO_SURVEY_ID not set in .env                           ║');
      console.log('║    → GET /api/survey/list to find your survey ID             ║');
      console.log('║    → Add ZOHO_SURVEY_ID=<id> to .env and restart             ║');
    } else {
      console.log(`║  ✅ Survey ID  : ${CONFIG.surveyId.padEnd(42)}║`);
    }
    console.log('╚══════════════════════════════════════════════════════════════╝');

    // ── Startup pre-warm: load SQLite cache immediately so first user load never
    // blocks. Skip the Zoho API attempt here — startup requests sync (below) will
    // fetch any new tickets and trigger a full cache rebuild once it completes.
    setTimeout(async () => {
      console.log('[startup] 🔄 Pre-warming raw request cache from SQLite…');
      await _rebuildCacheFromSQLite();
    }, 3000);
  });
}

// Boot only when run directly (pm2/prod); skip when required by a test harness so the
// express app can be mounted in-process (http.createServer(app)) without binding a port.
if (require.main === module) start().catch(e => {
  console.error(`❌ Startup refused: ${e.message}`);
  process.exit(1);
});
module.exports = { app };
