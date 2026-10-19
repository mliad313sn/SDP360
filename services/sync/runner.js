'use strict';
// Step 1 (SDP-DASH-2.0) — the sync runner. Every scheduled job (Zoho syncs, assets, OpManager,
// Meraki, Teams SLA, caches) runs through run(key):
//   · overlap lock — a job never runs twice at once (the second call is logged as 'overlap');
//   · retries with exponential backoff on TRANSIENT errors only, honouring Retry-After;
//   · one sync_runs row per run, the job state (failure streak, last ok) updated;
//   · every failure mirrored to the System Log; an alert after N consecutive failures
//     (latched: one alert per streak) and a recovery notice when it clears;
//   · it NEVER throws and never rejects — a dead store or alert channel only logs.
// Dependencies are injected (store, logEvent, alert, now, sleep) so the core is testable.

const crypto = require('crypto');
const { computeHealth } = require('./health');

const TRANSIENT_CODES = new Set(['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'EAI_AGAIN',
  'ENOTFOUND', 'EPIPE', 'ESOCKETTIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH']);
const TRANSIENT_HTTP = new Set([408, 425, 429, 500, 502, 503, 504]);

function httpStatus(err) {
  if (!err) return null;
  const s = (err.response && err.response.status) || err.status || err.statusCode;
  return Number.isFinite(Number(s)) ? Number(s) : null;
}

/** true when retrying the same call has a reasonable chance to succeed. */
function isTransient(err) {
  if (!err) return false;
  if (err.transient === true) return true;
  if (err.transient === false) return false;
  if (err.code && TRANSIENT_CODES.has(String(err.code))) return true;
  const st = httpStatus(err);
  if (st != null) return TRANSIENT_HTTP.has(st);
  return /timeout|timed out|socket hang up|network error|temporarily unavailable/i.test(String(err.message || err));
}

/** Delay asked by the server (Retry-After seconds or HTTP date), in ms, else null. */
function retryAfterMs(err, nowMs = Date.now()) {
  const h = err && err.response && err.response.headers;
  const raw = h && (h['retry-after'] || h['Retry-After']);
  if (raw == null || raw === '') return null;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const t = Date.parse(String(raw));
  return Number.isFinite(t) ? Math.max(0, t - nowMs) : null;
}

/** Backoff for attempt n (1-based): base · 2^(n-1), capped, or the server's Retry-After. */
function backoffMs(attempt, err, { baseDelayMs = 30000, maxDelayMs = 10 * 60000 } = {}, nowMs) {
  const ra = retryAfterMs(err, nowMs);
  if (ra != null) return Math.min(ra, maxDelayMs);
  return Math.min(baseDelayMs * Math.pow(2, Math.max(0, attempt - 1)), maxDelayMs);
}

/** A job function's resolved value → outcome. Legacy jobs report failure as {error}. */
function interpretResult(v) {
  if (v && typeof v === 'object') {
    if (v.error) return { status: 'error', error: String(v.error) };
    if (v.skipped) return { status: 'skipped', detail: v.skipped === true ? 'not configured' : String(v.skipped) };
  }
  return { status: 'ok' };
}

function _scrub(msg) { return String(msg || '').replace(/https?:\/\/\S+/g, '<url>').slice(0, 1000); }
function _detail(v) {
  if (v == null || typeof v !== 'object') return null;
  try { return JSON.stringify(v, (k, x) => (/url|token|secret|key/i.test(k) ? undefined : x)).slice(0, 4000); }
  catch (e) { return null; }
}

function createRunner(opts = {}) {
  const store = opts.store;
  const logEvent = opts.logEvent || (() => {});
  const alert = opts.alert || (async () => ({ skipped: 'no_alert_channel' }));
  const now = opts.now || (() => Date.now());
  const sleep = opts.sleep || ((ms) => new Promise(r => setTimeout(r, ms)));
  const threshold = Math.max(1, Number(opts.failureThreshold) || 2);
  const jobs = new Map();
  const running = new Map();   // key -> started ISO

  function register(job) {
    if (!job || !job.key || typeof job.fn !== 'function') throw new Error('sync job needs key + fn');
    jobs.set(job.key, { label: job.key, group: 'other', retries: 0, baseDelayMs: 30000,
      freshnessMinutes: 180, ...job });
    return api;
  }

  async function _safe(p, what) {
    try { return await p(); } catch (e) { console.error(`[sync-runner] ${what}:`, e && e.message); return null; }
  }

  async function run(key, { trigger = 'cron', args = {} } = {}) {
    const job = jobs.get(key);
    if (!job) return { status: 'error', error: `unknown job ${key}` };
    const startedIso = new Date(now()).toISOString();
    if (running.has(key)) {
      await _safe(() => store.recordRun({ run_id: crypto.randomUUID(), job_key: key, trigger,
        started_at: startedIso, finished_at: startedIso, status: 'overlap', attempts: 0, duration_ms: 0,
        detail: `still running since ${running.get(key)}` }), 'record overlap');
      return { status: 'overlap' };
    }
    running.set(key, startedIso);
    const t0 = now();
    let attempts = 0, outcome, value, lastErr = null;
    try {
      const maxAttempts = 1 + Math.max(0, Number(job.retries) || 0);
      for (;;) {
        attempts++;
        try {
          value = await job.fn({ trigger, args, attempt: attempts });
          outcome = interpretResult(value);
          lastErr = null;
        } catch (e) {
          lastErr = e;
          outcome = { status: 'error', error: e && e.message ? e.message : String(e) };
        }
        if (outcome.status !== 'error') break;
        const transient = lastErr ? isTransient(lastErr) : isTransient({ message: outcome.error });
        if (!transient || attempts >= maxAttempts) break;
        const wait = backoffMs(attempts, lastErr, job, now());
        console.warn(`[sync-runner] ${key} attempt ${attempts} failed (${_scrub(outcome.error)}) — retry in ${Math.round(wait / 1000)} s`);
        await sleep(wait);
      }
    } finally {
      running.delete(key);
    }
    const finishedIso = new Date(now()).toISOString();
    const run = { run_id: crypto.randomUUID(), job_key: key, trigger, started_at: startedIso, finished_at: finishedIso,
      status: outcome.status, attempts, duration_ms: Math.max(0, now() - t0),
      error: outcome.error ? _scrub(outcome.error) : null,
      detail: outcome.detail || _detail(value) };
    await _safe(() => store.recordRun(run), 'record run');
    await _safe(() => _updateState(job, run, lastErr), 'update state');
    return { status: run.status, attempts, error: run.error, value };
  }

  async function _updateState(job, run, err) {
    const prev = (await store.getState(job.key)) || { job_key: job.key, consecutive_failures: 0 };
    const s = { ...prev, job_key: job.key, last_status: run.status, last_run_at: run.finished_at };
    if (run.status === 'error') {
      s.consecutive_failures = (Number(prev.consecutive_failures) || 0) + 1;
      s.last_error = run.error;
      logEvent({ category: 'sync', action: 'sync_failed', target: job.key, risk: 1,
        details: { label: job.label, attempts: run.attempts, streak: s.consecutive_failures, error: run.error,
          guard: err && err.code === 'TRUNCATION_GUARD' ? 'truncation' : undefined } });
      if (s.consecutive_failures >= threshold && !prev.failure_alerted_at) {
        await _safe(() => alert({ kind: 'failure', job, state: s, error: run.error }), 'failure alert');
        s.failure_alerted_at = run.finished_at;
        logEvent({ category: 'sync', action: 'sync_alert', target: job.key, risk: 1,
          details: { kind: 'failure', streak: s.consecutive_failures } });
      }
    } else {
      if (run.status === 'ok') { s.last_ok_at = run.finished_at; }
      s.last_error = null;
      if (prev.failure_alerted_at) {
        await _safe(() => alert({ kind: 'recovery', job, state: s }), 'recovery alert');
        logEvent({ category: 'sync', action: 'sync_recovered', target: job.key,
          details: { after_failures: prev.consecutive_failures } });
      }
      s.consecutive_failures = 0;
      s.failure_alerted_at = null;
      s.stale_alerted_at = null;
    }
    await store.saveState(s);
  }

  /** Health of every registered job (merges the legacy sync_metadata rows when given). */
  async function health({ metadata = [] } = {}) {
    const states = (await _safe(() => store.listStates(), 'list states')) || [];
    return computeHealth({ jobs: [...jobs.values()], states, metadata, running: [...running.keys()], nowMs: now() });
  }

  /** Hourly sweep: alert once per stale episode (a job that should have run and did not). */
  async function sweep({ metadata = [] } = {}) {
    const h = await health({ metadata });
    const raised = [];
    for (const j of h.jobs) {
      if (j.status !== 'stale') continue;
      const st = (await _safe(() => store.getState(j.key), 'get state')) || { job_key: j.key, consecutive_failures: 0 };
      if (st.stale_alerted_at) continue;
      const job = jobs.get(j.key);
      await _safe(() => alert({ kind: 'stale', job, state: st, ageMinutes: j.age_minutes }), 'stale alert');
      logEvent({ category: 'sync', action: 'sync_stale', target: j.key, risk: 1,
        details: { label: j.label, age_minutes: j.age_minutes, freshness_minutes: j.freshness_minutes } });
      await _safe(() => store.saveState({ ...st, job_key: j.key, stale_alerted_at: new Date(now()).toISOString() }), 'save stale latch');
      raised.push(j.key);
    }
    return { raised };
  }

  const api = { register, run, health, sweep,
    isRunning: (k) => running.has(k), jobs: () => [...jobs.values()], get: (k) => jobs.get(k) };
  return api;
}

module.exports = { createRunner, isTransient, retryAfterMs, backoffMs, interpretResult };
