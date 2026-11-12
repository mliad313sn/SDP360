'use strict';
// E-S02 (audit S-02, X-SEC-01) — what the x-dash-key ALONE may reach, and whether pages still receive it.
//
// The /api/ gate (server.js) hands a server-to-server key call (no cookie, no Origin, key matches) to
// handle(). handle() keeps the EX-02 / D-15 evidence row (system_log action 'dashkey_call', once a day per
// route × source, the key value never stored) and applies report_config `dashkey_scope_mode`:
//   open     (default = today) — every key-only call passes;
//   shadow   — a call to a route NOT in `dashkey_allowed_routes` passes but writes one
//              'dashkey_scope_would_refuse' row a day per route × source;
//   restrict — that call is refused with 401 (row 'dashkey_scope_refused', same once-a-day gate).
// A browser request (cookie or Origin) never reaches handle(): restrict cannot touch a browser.
//
// `ui_inject_dash_key` = '1' (default = today) | '0': inject() writes `window.__ak` into a page served with a
// valid session, or — at '0' — only `window.__akWithheld=true` so the page knows the session cookie carries
// its calls (executive-report's "session not recognised" banner reads it).
//
// `dashkey_allowed_routes`: comma / newline list of "METHOD /api/path" or "/api/path" (any method); a trailing
// `*` matches a prefix. Empty = nothing allowed (only matters in shadow / restrict).
const { makeOncePerDay } = require('./viewLog');

const MODES = Object.freeze(['open', 'shadow', 'restrict']);
const TTL_MS = 30000;
let _cache = { mode: 'open', allowed: [], inject: true, at: 0 };

function normalizeMode(v) { const s = String(v == null ? '' : v).trim().toLowerCase(); return MODES.includes(s) ? s : 'open'; }

/** Pure: parse the allow-list into [{method|null, path, prefix}]. */
function parseAllowed(raw) {
  const out = [];
  for (const item of String(raw == null ? '' : raw).split(/[,\n]/).map((x) => x.trim()).filter(Boolean)) {
    const m = item.match(/^([A-Za-z]+)\s+(\S+)$/);
    const method = m ? m[1].toUpperCase() : null;
    let p = m ? m[2] : item;
    const prefix = p.endsWith('*');
    if (prefix) p = p.slice(0, -1);
    out.push({ method, path: p, prefix });
  }
  return out;
}
/** Pure: is METHOD + full path (`/api/...`, no query string) on the list? */
function isAllowed(list, method, fullPath) {
  const M = String(method || '').toUpperCase();
  return (list || []).some((e) => (!e.method || e.method === M) && (e.prefix ? fullPath.startsWith(e.path) : fullPath === e.path));
}

async function _policy(getConfig) {
  const now = Date.now();
  if (now - _cache.at < TTL_MS) return _cache;
  try {
    const cfg = (await getConfig()) || {};
    _cache = { mode: normalizeMode(cfg.dashkey_scope_mode), allowed: parseAllowed(cfg.dashkey_allowed_routes), inject: String(cfg.ui_inject_dash_key == null ? '1' : cfg.ui_inject_dash_key) !== '0', at: now };
  } catch (_) { _cache = { mode: 'open', allowed: [], inject: true, at: now - TTL_MS + 5000 }; }   // degraded read = today, retried in 5 s
  return _cache;
}
function _invalidate() { _cache = { ..._cache, at: 0 }; }

function create({ getRdb, getConfig } = {}) {
  const readCfg = getConfig || (async () => { const rdb = getRdb && getRdb(); return require('./reportConfig').getConfig(rdb && rdb.db); });
  const gate = makeOncePerDay();
  const log = (action, req, full, extra) => {
    try {
      const rdb = getRdb && getRdb();
      if (!rdb || !rdb.logEvent || gate.size() >= 20000) return;
      const src = (req.ip || '') + ' ' + String(req.headers['user-agent'] || '').slice(0, 80);
      if (!gate(action + ' ' + req.method + ' ' + full + ' ' + src, new Date().toISOString().slice(0, 10))) return;
      rdb.logEvent({ category: 'api', action, actor: 'dash-key', target: req.method + ' ' + full, ip: req.ip, ...(extra || {}), details: { user_agent: String(req.headers['user-agent'] || '').slice(0, 160) } });
    } catch (_) { /* a log never breaks a request */ }
  };
  async function handle(req, res, next) {
    const full = '/api' + req.path;   // req.path is relative to the /api/ mount; the query string is never logged
    log('dashkey_call', req, full);   // EX-02 / D-15 evidence: who still calls with the key alone
    const p = await _policy(readCfg);
    if (p.mode === 'open' || isAllowed(p.allowed, req.method, full)) return next();
    if (p.mode === 'shadow') { log('dashkey_scope_would_refuse', req, full, { risk: 0 }); return next(); }
    log('dashkey_scope_refused', req, full, { risk: 1 });
    return require('./httpError').fail(res, new Error('Unauthorized'), 401, { error: 'Unauthorized' });
  }
  async function inject(html, nonce, key) {
    const p = await _policy(readCfg);
    const js = p.inject ? `window.__ak='${key}';` : 'window.__akWithheld=true;';
    return html.replace('</head>', `<script nonce="${nonce}">${js}</script>\n</head>`);
  }
  return { handle, inject };
}

module.exports = { create, parseAllowed, isAllowed, normalizeMode, MODES, _invalidate };
