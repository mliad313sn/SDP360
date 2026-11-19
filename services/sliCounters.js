'use strict';
// P05 — in-process SLI counters for the readings the database does not keep (docs/ops/SLO-PROPOSAL.md):
//   · sign-in answers by outcome (a 5xx on POST /api/reports/auth/login never reaches system_log);
//   · PostgreSQL SELECT 1 latency, fed by /ready and /api/health/deps.
// No body, no user, no address is kept — only counts and milliseconds. The window is "since this server
// started" and is stated as such by services/sliReadings.js: a restart empties it (never a fabricated 30 days).
const MAX = 10080; // one week of one-minute probes
const state = { started_at: new Date().toISOString(), login: { total: 0, five_xx: 0 }, lat: [] };

function loginCounter(req, res, next) {
  if (req.method === 'POST' && req.path === '/api/reports/auth/login') {
    res.on('finish', () => { state.login.total++; if (res.statusCode >= 500) state.login.five_xx++; });
  }
  next();
}
function recordDbLatency(ms) {
  const v = Number(ms); if (!Number.isFinite(v) || v < 0) return;
  state.lat.push(v); if (state.lat.length > MAX) state.lat.splice(0, state.lat.length - MAX);
}
function snapshot() { return { started_at: state.started_at, login: { ...state.login }, db_latency_ms: state.lat.slice() }; }
function _reset() { state.started_at = new Date().toISOString(); state.login = { total: 0, five_xx: 0 }; state.lat = []; }

module.exports = { loginCounter, recordDbLatency, snapshot, _reset, MAX };
