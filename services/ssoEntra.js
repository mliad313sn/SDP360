'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Microsoft Entra ID (Azure AD) — OpenID Connect authorization-code + PKCE.
//
// Zero external dependencies: token exchange + JWKS fetch go through `axios`
// (already a prod dep, injectable for tests); ID-token RS256 signature
// verification uses Node's built-in `crypto` (createPublicKey({format:'jwk'})
// + createVerify). Nothing here touches native modules, so it can't disturb
// the better-sqlite3 binding.
//
// This module is IDENTITY ONLY — it proves who the user is and returns
// validated claims. It does NOT decide authorization: the caller maps the
// returned {oid, email} onto the dashboard's users/user_roles table and mints
// the normal session token. See docs/SSO_ENTRA_SETUP.md.
//
// Usage:
//   const { url, state, nonce, codeVerifier } = beginLogin(cfg);
//   // stash {state, nonce, codeVerifier} server-side, redirect to `url`
//   // …Entra redirects back with ?code=&state=…
//   const claims = await completeLogin({ code, codeVerifier, expectedNonce: nonce, cfg });
//   // claims = { oid, email, name, tid, raw }
// ─────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');

const AUTHORITY = tenantId => `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}`;

function _b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function _err(code, message) { const e = new Error(message); e.code = code; e.ssoError = true; return e; }

// ── Step 1 — build the authorize URL (with state, nonce, PKCE S256) ──────────
function beginLogin(cfg) {
  _requireCfg(cfg, ['tenantId', 'clientId', 'redirectUri']);
  const state         = _b64url(crypto.randomBytes(24));
  const nonce         = _b64url(crypto.randomBytes(24));
  const codeVerifier  = _b64url(crypto.randomBytes(32));
  const codeChallenge = _b64url(crypto.createHash('sha256').update(codeVerifier).digest());
  const params = new URLSearchParams({
    client_id:             cfg.clientId,
    response_type:         'code',
    redirect_uri:          cfg.redirectUri,
    response_mode:         'query',
    scope:                 cfg.scopes || 'openid profile email User.Read',
    state,
    nonce,
    code_challenge:        codeChallenge,
    code_challenge_method: 'S256',
    prompt:                cfg.prompt || 'select_account',
  });
  const url = `${AUTHORITY(cfg.tenantId)}/oauth2/v2.0/authorize?${params.toString()}`;
  return { url, state, nonce, codeVerifier };
}

// ── Step 2 — exchange the code + validate the ID token ───────────────────────
async function completeLogin({ code, codeVerifier, expectedNonce, cfg, http }) {
  _requireCfg(cfg, ['tenantId', 'clientId', 'clientSecret', 'redirectUri']);
  if (!code)         throw _err('no_code', 'Authorization code missing');
  if (!codeVerifier) throw _err('no_verifier', 'PKCE code_verifier missing (login session lost?)');
  http = http || _defaultHttp();

  const body = new URLSearchParams({
    client_id:     cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type:    'authorization_code',
    code,
    redirect_uri:  cfg.redirectUri,
    code_verifier: codeVerifier,
    scope:         cfg.scopes || 'openid profile email User.Read',
  });

  let tok;
  try {
    tok = await http.postForm(`${AUTHORITY(cfg.tenantId)}/oauth2/v2.0/token`, body.toString());
  } catch (e) {
    const detail = e.response && e.response.data && (e.response.data.error_description || e.response.data.error);
    throw _err('token_exchange_failed', 'Token exchange failed: ' + (detail || e.message));
  }
  if (!tok || !tok.id_token) throw _err('no_id_token', 'Token response did not include an id_token');

  const identity = await verifyIdToken(tok.id_token, cfg, http, expectedNonce);

  // Enrich the profile from Microsoft Graph (jobTitle + officeLocation aren't in
  // the ID token). Non-fatal: if the Graph call fails (no User.Read consent /
  // network), fall back to the ID-token name claims.
  let g = {};
  if (tok.access_token) {
    try { g = await _fetchGraphProfile(tok.access_token, http); }
    catch (e) { console.warn('[SSO] Graph /me enrichment skipped:', e.message); g = {}; }
  }
  return {
    oid:        identity.oid,
    email:      identity.email,
    name:       g.displayName    || identity.name       || '',
    first_name: g.givenName      || identity.first_name || '',
    last_name:  g.surname        || identity.last_name  || '',
    title:      g.jobTitle       || '',
    office:     g.officeLocation || '',
    department: g.department     || '',
    groups:     Array.isArray(identity.groups) ? identity.groups : [],   // Step 4 — 'groups' claim (configure in the app registration)
    tid:        identity.tid,
    raw:        identity.raw,
  };
}

// Microsoft Graph /me — jobTitle + officeLocation + name (needs the access
// token carrying the User.Read scope). Returns {} on any non-2xx (caller
// treats enrichment as best-effort).
async function _fetchGraphProfile(accessToken, http) {
  const url = 'https://graph.microsoft.com/v1.0/me?$select=givenName,surname,displayName,jobTitle,officeLocation,department,mail,userPrincipalName';
  return (await http.getJson(url, { Authorization: 'Bearer ' + accessToken })) || {};
}

// ── ID-token verification: signature (RS256 via JWKS) + standard claims ──────
async function verifyIdToken(idToken, cfg, http, expectedNonce) {
  http = http || _defaultHttp();
  const parts = String(idToken).split('.');
  if (parts.length !== 3) throw _err('malformed', 'id_token is not a well-formed JWT');

  let header, payload;
  try {
    header  = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch (_) { throw _err('malformed', 'id_token header/payload not valid JSON'); }

  if (header.alg !== 'RS256') throw _err('bad_alg', `Unexpected token alg "${header.alg}" (expected RS256)`);

  const jwk = await _getSigningKey(cfg, http, header.kid);
  let pub;
  try { pub = crypto.createPublicKey({ key: jwk, format: 'jwk' }); }
  catch (e) { throw _err('bad_key', 'Could not import JWKS signing key: ' + e.message); }

  const signingInput = parts[0] + '.' + parts[1];
  const sig = Buffer.from(parts[2], 'base64url');
  const ok = crypto.createVerify('RSA-SHA256').update(signingInput).verify(pub, sig);
  if (!ok) throw _err('bad_signature', 'id_token signature verification failed');

  // Standard claim checks (60s clock skew allowance).
  const now  = Math.floor(Date.now() / 1000);
  const skew = 60;
  const expectedIss = `${AUTHORITY(cfg.tenantId)}/v2.0`;
  if (payload.iss !== expectedIss)   throw _err('bad_iss', `Unexpected issuer "${payload.iss}"`);
  if (payload.aud !== cfg.clientId)  throw _err('bad_aud', `Token audience is not this app`);
  if (typeof payload.exp !== 'number' || payload.exp < now - skew) throw _err('expired', 'id_token has expired');
  if (typeof payload.nbf === 'number' && payload.nbf > now + skew)  throw _err('not_yet_valid', 'id_token not yet valid');
  if (expectedNonce && payload.nonce !== expectedNonce)            throw _err('bad_nonce', 'id_token nonce mismatch (possible replay)');
  if (cfg.tenantId && payload.tid && !/^common|organizations|consumers$/.test(cfg.tenantId) && payload.tid !== cfg.tenantId) {
    throw _err('bad_tenant', 'id_token from a different tenant');
  }

  const email = String(payload.email || payload.preferred_username || payload.upn || '').trim().toLowerCase();
  const oid   = payload.oid || payload.sub;
  if (!oid)   throw _err('no_oid',   'id_token has no oid/sub claim');
  if (!email) throw _err('no_email', 'id_token has no email/UPN claim (add "email" to the app\'s optional claims)');

  return {
    oid, email,
    name:       payload.name        || '',
    first_name: payload.given_name  || '',
    groups:     Array.isArray(payload.groups) ? payload.groups.map(String) : [],
    last_name:  payload.family_name || '',
    tid: payload.tid || null, raw: payload,
  };
}

// ── JWKS fetch + cache (1h), with one refresh on unknown kid (key rotation) ──
let _jwks = { at: 0, tenant: null, keys: null };
async function _getSigningKey(cfg, http, kid) {
  const fresh = _jwks.keys && _jwks.tenant === cfg.tenantId && (Date.now() - _jwks.at) < 3600_000;
  if (!fresh) await _refreshJwks(cfg, http);
  let key = (_jwks.keys || []).find(k => k.kid === kid);
  if (!key) { await _refreshJwks(cfg, http); key = (_jwks.keys || []).find(k => k.kid === kid); }
  if (!key) throw _err('no_jwks_key', `No JWKS signing key for kid "${kid}"`);
  return key;
}
async function _refreshJwks(cfg, http) {
  const j = await http.getJson(`${AUTHORITY(cfg.tenantId)}/discovery/v2.0/keys`);
  _jwks = { at: Date.now(), tenant: cfg.tenantId, keys: (j && j.keys) || [] };
}
function _resetJwksCache() { _jwks = { at: 0, tenant: null, keys: null }; } // test hook

function _defaultHttp() {
  const axios = require('axios');
  return {
    postForm: async (url, form) => (await axios.post(url, form, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000,
    })).data,
    getJson: async (url, headers) => (await axios.get(url, { timeout: 15000, headers: headers || {} })).data,
  };
}

function _requireCfg(cfg, keys) {
  if (!cfg) throw _err('no_config', 'SSO config object is required');
  for (const k of keys) if (!cfg[k]) throw _err('missing_config', `SSO config missing "${k}"`);
}

module.exports = { beginLogin, completeLogin, verifyIdToken, _resetJwksCache };
