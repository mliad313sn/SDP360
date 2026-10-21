'use strict';
const { fail } = require('../services/httpError');
// Integration slice 1 — expose 4MyPeople workforce data to the dashboard, behind
// the dashboard's OWN auth (no shared session/SSO — that's a later, migration-gated
// track). Read-only, server-to-server via services/fmpClient (X-API-Key), short-TTL
// cached. DI factory like routes/inspection.js: server.js passes the deps.
module.exports = function fourmypeopleRoutes(deps) {
  const { express, requireReportSession, requireRole, fmpClient } = deps;
  const router = express.Router();

  const CACHE_MS = Number(process.env.FMP_CACHE_MS || 60000);
  const _cache = {};                       // key -> { ts, data }
  async function cached(key, fn) {
    const c = _cache[key];
    if (c && (Date.now() - c.ts) < CACHE_MS) return c.data;
    const data = await fn();
    _cache[key] = { ts: Date.now(), data };
    return data;
  }

  // The 4MyPeople API key acts as a read-only superadmin (fleet-wide rows), so
  // gate to dashboard executive/admin roles. RBAC scoping for lower roles is a
  // later concern (governance decision flagged in the integration assessment).
  const gate = [requireReportSession, requireRole(['super_admin', 'executive', 'admin'])];

  router.get('/api/integration/fmp/employees', ...gate, async (req, res) => {
    try { res.json({ data: await cached('employees', () => fmpClient.listEmployees()) }); }
    catch (e) { fail(res, e, 502, { error: 'upstream_error' }); }
  });

  router.get('/api/integration/fmp/readiness', ...gate, async (req, res) => {
    try { res.json({ data: await cached('readiness', () => fmpClient.listReadiness()) }); }
    catch (e) { fail(res, e, 502, { error: 'upstream_error' }); }
  });

  return router;
};
