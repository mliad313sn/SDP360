'use strict';
// Outbound client for 4MyPeople's REST API (/api/v1) — integration slice 1.
// Server-to-server, read-only, behind the dashboard's own auth. Degrades
// gracefully (returns [] + logs) if 4MyPeople is unreachable so it can never
// break dashboard boot or a page render. The HTTP function is injectable for
// testing (default: axios). Auth: X-API-Key header (a 4MyPeople API key acts as
// a read-only superadmin principal — see tools/pg/README / the FMP runbook).
const DEFAULT_BASE = () => process.env.FMP_API_URL || 'http://localhost:3000/api/v1';

async function _axiosGet(url, cfg) { return require('axios').get(url, cfg); }

function makeFmpClient(opts = {}) {
  const base    = (opts.baseUrl || DEFAULT_BASE()).replace(/\/+$/, '');
  const apiKey  = opts.apiKey != null ? opts.apiKey : (process.env.FMP_API_KEY || '');
  const httpGet = opts.httpGet || _axiosGet;
  const timeout = Number(opts.timeoutMs || process.env.FMP_API_TIMEOUT_MS || 8000);

  // Returns the parsed response BODY (axios r.data) or null on any failure.
  async function _getBody(pathname) {
    try {
      const headers = apiKey ? { 'X-API-Key': apiKey } : {};
      const r = await httpGet(base + pathname, { headers, timeout });
      return (r && r.data) || null;
    } catch (e) {
      console.error('[fmp] GET ' + pathname + ' failed: ' + (e && e.message));
      return null;
    }
  }
  // Every /api/v1 list endpoint wraps rows as { data: [...], count }.
  async function _list(pathname) {
    const body = await _getBody(pathname);
    return body && Array.isArray(body.data) ? body.data : [];
  }
  return {
    listEmployees() { return _list('/employees'); },
    listReadiness() { return _list('/readiness'); },
  };
}

module.exports = { makeFmpClient };
