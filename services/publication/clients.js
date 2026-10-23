'use strict';
// Step 9 — consumers of the external API (Power BI, SharePoint, a partner system…). Each one has its own key, shown
// ONCE at creation; only a SHA-256 hash and the first 8 characters are stored. Scopes: 'metrics' (the indicators
// and the OData feed), 'reports' (approved reports). A daily quota; every call is journalled. A key is accepted from
// the X-Api-Key header or HTTP Basic (user = client id, password = key) — never from a URL (step 4 rule).

const crypto = require('crypto');
const sql = require('../sqlStore');
const { safeEqual } = require('../safeCompare');

const handle = () => sql.handle('021_engagement_reports_publication.sql');
const { now, newId, parse } = sql;
const SCOPES = ['metrics', 'reports'];
const hash = (k) => crypto.createHash('sha256').update(String(k)).digest('hex');

function row(r) {
  return r ? { id: r.id, name: r.name, key_prefix: r.key_prefix, scopes: parse(r.scopes_json, []), quota_per_day: Number(r.quota_per_day), created_by: r.created_by, created_at: r.created_at, revoked_at: r.revoked_at || null } : null;
}
async function list() { const { H } = handle(); return (await H.prepare(`SELECT * FROM pb_clients ORDER BY created_at DESC`).all()).map(row); }

/** Create a consumer; returns { client, key } — the key is never retrievable again. */
async function create({ name, scopes, quota_per_day }, by) {
  const { H } = handle();
  const id = newId('API');
  const key = 'sdp_' + crypto.randomBytes(24).toString('base64url');
  const sc = (Array.isArray(scopes) ? scopes : ['metrics']).filter(s => SCOPES.includes(s));
  await H.prepare(`INSERT INTO pb_clients (id, name, key_hash, key_prefix, scopes_json, quota_per_day, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, String(name).slice(0, 80), hash(key), key.slice(0, 8), JSON.stringify(sc.length ? sc : ['metrics']), Math.max(10, Math.min(100000, Number(quota_per_day) || 1000)), by || null, now());
  return { client: row(await H.prepare(`SELECT * FROM pb_clients WHERE id = ?`).get(id)), key };
}
async function revoke(id) { const { H } = handle(); await H.prepare(`UPDATE pb_clients SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`).run(now(), id); }

/** The client of a request (header or Basic), or null. Constant-time comparison of the hash. */
async function authenticate(req) {
  let key = req.headers['x-api-key'], id = null;
  const auth = String(req.headers.authorization || '');
  if (!key && /^Basic /i.test(auth)) {
    const dec = Buffer.from(auth.slice(6), 'base64').toString('utf8');
    const i = dec.indexOf(':');
    if (i > 0) { id = dec.slice(0, i); key = dec.slice(i + 1); }
  }
  if (!key || typeof key !== 'string' || key.length < 12 || key.length > 200) return null;
  const { H } = handle();
  const rows = id ? await H.prepare(`SELECT * FROM pb_clients WHERE id = ? AND revoked_at IS NULL`).all(id)
    : await H.prepare(`SELECT * FROM pb_clients WHERE key_prefix = ? AND revoked_at IS NULL`).all(key.slice(0, 8));
  const h = hash(key);
  const hit = rows.find(r => safeEqual(h, r.key_hash));
  return hit ? row(hit) : null;
}
async function callsToday(clientId, nowDate = new Date()) {
  const { H } = handle();
  const r = await H.prepare(`SELECT COUNT(*) AS n FROM pb_calls WHERE client_id = ? AND at >= ?`).get(clientId, nowDate.toISOString().slice(0, 10));
  return Number(r.n) || 0;
}
async function journal(clientId, path, status) {
  const { H } = handle();
  await H.prepare(`INSERT INTO pb_calls (client_id, at, path, status) VALUES (?, ?, ?, ?)`).run(clientId, now(), String(path).slice(0, 300), status);
}
async function usage(clientId, days = 30) {
  const { H } = handle();
  const since = new Date(Date.now() - days * 86400000).toISOString();
  return H.prepare(`SELECT substr(at, 1, 10) AS day, COUNT(*) AS calls FROM pb_calls WHERE client_id = ? AND at >= ? GROUP BY substr(at, 1, 10) ORDER BY day`).all(clientId, since);
}

/** Express middleware: a client with `scope`, under its quota; journals the call. */
function middleware(scope) {
  return async (req, res, next) => {
    try {
      const c = await authenticate(req);
      if (!c) { res.setHeader('WWW-Authenticate', 'Basic realm="SDP Dashboard API"'); return res.status(401).json({ error: 'API key required (X-Api-Key header or HTTP Basic: client id + key).' }); }
      if (!c.scopes.includes(scope)) { await journal(c.id, req.originalUrl, 403); return res.status(403).json({ error: `This key has no "${scope}" scope.` }); }
      if (await callsToday(c.id) >= c.quota_per_day) { await journal(c.id, req.originalUrl, 429); res.setHeader('Retry-After', '3600'); return res.status(429).json({ error: 'Daily quota reached.' }); }
      req.apiClient = c;
      res.on('finish', () => { journal(c.id, req.originalUrl, res.statusCode).catch(() => {}); });
      next();
    } catch (e) { res.status(500).json({ error: e.message }); }
  };
}

module.exports = { list, create, revoke, authenticate, middleware, usage, callsToday, SCOPES, hash };
