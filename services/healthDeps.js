'use strict';
// E-Q07 (audit Q-07) — dependency health, PURE composition. The route (routes/health.js GET /api/health/deps)
// gathers the raw readings — none of them an outbound call — and this module turns each into
// { status: ok | stale | down | unknown, ...facts }. Rule: a reading we do not have is `unknown`, never green.
//
// Thresholds here are only the ones the code already declares (FRESHNESS_HOURS for sync jobs, the
// restore-drill window of the job registry) — no SLO target is invented (docs/ops/SLO-PROPOSAL.md).
const STATUSES = Object.freeze(['ok', 'stale', 'down', 'unknown']);
const RANK = { ok: 0, unknown: 1, stale: 2, down: 3 };
const H = 3600000;

const _ms = (t) => { if (t == null || t === '') return null; const v = Date.parse(t); return Number.isFinite(v) ? v : null; };
const _ageH = (t, now) => { const v = _ms(t); return v == null ? null : Math.round(((now - v) / H) * 10) / 10; };

function postgres(r) {
  if (!r) return { status: 'unknown' };
  if (r.error) return { status: 'down', error: String(r.error).slice(0, 160) };
  return { status: 'ok', latency_ms: r.latency_ms == null ? null : r.latency_ms };
}

/** tokenState = { accessToken, expiresAt, lastRefreshError } — the token itself never leaves this function. */
function zohoToken(ts, now) {
  if (!ts) return { status: 'unknown', note: 'token state not available' };
  const has = !!ts.accessToken;
  const exp = Number(ts.expiresAt) || 0;
  if (!has && ts.lastRefreshError) return { status: 'down', note: 'last refresh failed' };
  if (!has) return { status: 'unknown', note: 'never refreshed since start' };
  const expires_at = exp ? new Date(exp).toISOString() : null;
  if (!exp || exp <= now) return { status: 'stale', expires_at, note: 'token expired; refreshed on next sync' };
  return { status: 'ok', expires_at };
}

function smtp(cfg) {
  const configured = !!(cfg && String(cfg.smtp_host || '').trim());
  return { status: 'unknown', configured, note: 'never probed by the health check' };
}

/** rows = sync store health() [{job, last_ok, last_error}] ; freshness = {job: hours}. */
function syncJobs(rows, freshness, now) {
  const by = new Map((rows || []).map((r) => [r.job, r]));
  const out = [];
  for (const job of Object.keys(freshness || {}).sort()) {
    const r = by.get(job) || {};
    const lim = Number(freshness[job]);
    const last = r.last_ok || null;
    const age = _ageH(last, now);
    let status;
    if (age == null) status = 'unknown';
    else status = age <= lim ? 'ok' : 'stale';
    const lastErr = _ms(r.last_error);
    if (lastErr != null && (_ms(last) == null || lastErr > _ms(last))) status = status === 'unknown' ? 'down' : status;
    out.push({ job, status, last_ok: last, age_hours: age, freshness_hours: Number.isFinite(lim) ? lim : null });
  }
  return out;
}

function backup(rows, freshness, now) {
  const j = syncJobs(rows, { 'db.backup': (freshness && freshness['db.backup']) || 30 }, now)[0];
  return { status: j.status, last_ok: j.last_ok, age_hours: j.age_hours, freshness_hours: j.freshness_hours };
}

/** last = {ts, ok} | null ; windowHours from the job registry (db.restore_drill). */
function restoreDrill(last, windowHours, now) {
  if (!last || !last.ts) return { status: 'unknown', note: 'no restore drill recorded' };
  const age = _ageH(last.ts, now);
  if (last.ok === false) return { status: 'down', last_at: last.ts, age_hours: age };
  if (age == null) return { status: 'unknown', last_at: last.ts };
  return { status: age <= windowHours ? 'ok' : 'stale', last_at: last.ts, age_hours: age, window_hours: windowHours };
}

/** disk = {free_bytes, total_bytes} | null. 10 % is a PROPOSITION (SLO-PROPOSAL.md), not an approved target. */
function disk(d) {
  if (!d || !(Number(d.total_bytes) > 0) || d.free_bytes == null) return { status: 'unknown' };
  const free_pct = Math.round((Number(d.free_bytes) / Number(d.total_bytes)) * 1000) / 10;
  return { status: free_pct >= 10 ? 'ok' : 'down', free_bytes: Number(d.free_bytes), free_pct, threshold_pct_proposed: 10 };
}

function worst(statuses) {
  let w = 'ok';
  for (const s of statuses) if ((RANK[s] ?? 1) > RANK[w]) w = s;
  return w;
}

/** Compose the whole answer. */
function compose(r = {}, now = Date.now()) {
  const items = {
    postgres: postgres(r.pg),
    zoho_token: zohoToken(r.tokenState, now),
    smtp: smtp(r.config),
    backup: backup(r.syncRows, r.freshness, now),
    restore_drill: restoreDrill(r.restoreDrill, (r.freshness && r.freshness['db.restore_drill']) || 24 * 33, now),
    disk: disk(r.disk),
  };
  const jobs = syncJobs(r.syncRows, r.freshness, now);   // unreadable store → every job unknown
  const overall = worst([...Object.values(items).map((x) => x.status), ...jobs.map((j) => j.status)]);
  return { checked_at: new Date(now).toISOString(), overall, items, sync_jobs: jobs };
}

module.exports = { STATUSES, compose, postgres, zohoToken, smtp, syncJobs, backup, restoreDrill, disk, worst };
