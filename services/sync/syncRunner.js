'use strict';
// SDP360 — generic synchronisation runner (Phase 1 "Foundation & Sync").
//
// WHY: the inherited jobs (zoho-sync, assets-sync, Meraki, OpManager, Teams SLA poll) each
// re-implement a fragment of the same lifecycle: "am I already running?", "retry on a
// transient error", "how far did I get last time?", "refuse to wipe a table on an empty
// fetch", "where do I record the outcome?". Only poll-sla.js had an overlap lock, only the
// Zoho fetch retried (once, on 401), only assets-sync guarded the empty fetch, and no sync
// failure ever reached system_log. This module is the single lifecycle every job is wired
// through, so the behaviour is uniform and observable (`sync_runs`, `sync_watermarks`).
//
// Pure in its core: storage is injected (`store`), the clock and sleep are injectable so the
// tests run in milliseconds. No DB driver is required here — see ./syncStore.js for the
// sqlite/pg adapters.

const DEFAULTS = {
  maxAttempts: 4,            // 1 try + 3 retries
  baseDelayMs: 2000,         // 2 s → 4 s → 8 s (exponential)
  maxDelayMs: 60_000,
  jitter: 0.2,               // ±20 % so parallel jobs do not retry in lockstep
  emptyGuard: true,          // refuse to accept 0 rows when the previous run had rows
  lockTtlMs: 2 * 60 * 60_000, // a lock older than this is considered stale (crashed run)
};

// Transient = worth retrying. Anything else fails fast (a 400 from a bad filter will not
// become a 200 by waiting).
function isTransient(err) {
  if (!err) return false;
  if (err.transient === true) return true;
  if (err.transient === false) return false;
  const status = Number(err.status || err.statusCode || (err.response && err.response.status));
  if (status === 408 || status === 425 || status === 429) return true;
  if (status >= 500 && status <= 599) return true;
  const code = String(err.code || '');
  if (['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'ECONNREFUSED'].includes(code)) return true;
  return /timeout|socket hang up|network/i.test(String(err.message || ''));
}

// Honour Retry-After (seconds or HTTP date) when the upstream sends one; otherwise
// exponential backoff with jitter, capped.
function backoffDelay(attempt, err, opts, rand = Math.random) {
  const ra = err && err.response && err.response.headers && err.response.headers['retry-after'];
  if (ra != null) {
    const secs = Number(ra);
    if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, opts.maxDelayMs);
    const at = Date.parse(ra);
    if (Number.isFinite(at)) return Math.max(0, Math.min(at - Date.now(), opts.maxDelayMs));
  }
  const base = Math.min(opts.baseDelayMs * Math.pow(2, attempt - 1), opts.maxDelayMs);
  const spread = base * opts.jitter;
  return Math.round(base - spread + rand() * 2 * spread);
}

// In-memory store — the reference implementation of the store contract and what the
// tests use. Production passes the sqlite/pg adapter from ./syncStore.js.
function memoryStore() {
  const runs = [];
  const watermarks = new Map();
  const locks = new Map();
  return {
    runs, watermarks, locks,
    async acquireLock(job, now, ttlMs) {
      const cur = locks.get(job);
      if (cur && now - cur < ttlMs) return false;
      locks.set(job, now);
      return true;
    },
    async releaseLock(job) { locks.delete(job); },
    async getWatermark(job) { return watermarks.has(job) ? watermarks.get(job) : null; },
    async setWatermark(job, value) { watermarks.set(job, value); },
    async startRun(job, now, meta) {
      const run = { id: runs.length + 1, job, started_at: now, finished_at: null, status: 'running', attempts: 0, rows: null, error: null, meta: meta || null };
      runs.push(run);
      return run.id;
    },
    async finishRun(id, patch) { Object.assign(runs[id - 1], patch); },
    async lastSuccessfulRun(job) {
      for (let i = runs.length - 1; i >= 0; i--) if (runs[i].job === job && runs[i].status === 'ok') return runs[i];
      return null;
    },
  };
}

/**
 * Create a runner.
 * @param {object} options
 * @param {object} options.store    - store contract (see memoryStore)
 * @param {function} [options.now]  - () => epoch ms
 * @param {function} [options.sleep]- (ms) => Promise
 * @param {function} [options.log]  - (level, msg, ctx) sink; defaults to console
 * @param {function} [options.onEvent] - (eventName, payload) hook, e.g. to write system_log
 */
function createSyncRunner(options = {}) {
  const store = options.store || memoryStore();
  const now = options.now || (() => Date.now());
  const sleep = options.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const log = options.log || ((level, msg, ctx) => (console[level === 'error' ? 'error' : 'log'])(`[sync] ${msg}`, ctx || ''));
  const onEvent = options.onEvent || (() => {});
  const rand = options.rand || Math.random;

  /**
   * Run one job through the full lifecycle.
   * @param {object} job
   * @param {string} job.name                  - unique job name (lock + watermark key)
   * @param {function} job.fetch               - async ({watermark, attempt}) => { rows, nextWatermark? , total? }
   * @param {function} [job.apply]             - async ({rows, watermark}) => { upserted, deleted } — the write step
   * @param {function} [job.dedupe]            - (rows) => rows — defaults to dedupeBy(job.key)
   * @param {string|function} [job.key]        - natural key for dedup (field name or row => key)
   * @param {object} [job.opts]                - overrides of DEFAULTS
   * @returns {Promise<object>} run summary {status, rows, attempts, skipped, error}
   */
  async function run(job) {
    if (!job || !job.name || typeof job.fetch !== 'function') throw new TypeError('run(job): name and fetch are required');
    const opts = { ...DEFAULTS, ...(job.opts || {}) };
    const t0 = now();

    const locked = await store.acquireLock(job.name, t0, opts.lockTtlMs);
    if (!locked) {
      log('warn', `${job.name}: skipped — previous run still active`);
      onEvent('sync_skipped_overlap', { job: job.name });
      return { status: 'skipped', reason: 'overlap', job: job.name };
    }

    const watermark = await store.getWatermark(job.name);
    const runId = await store.startRun(job.name, t0, { watermark });
    let attempt = 0;
    let lastErr = null;

    try {
      while (attempt < opts.maxAttempts) {
        attempt++;
        try {
          const fetched = (await job.fetch({ watermark, attempt })) || {};
          let rows = Array.isArray(fetched.rows) ? fetched.rows : [];
          const rawCount = rows.length;

          // Empty-result guard: a feed that produced rows last time and now returns none is far
          // more likely a truncated export than a genuinely empty dataset. Never let it cascade
          // into a full-table DELETE (the Zoho reconcile does exactly that on the live-ID set).
          if (opts.emptyGuard && rawCount === 0) {
            const prev = await store.lastSuccessfulRun(job.name);
            if (prev && prev.rows > 0) {
              const err = new Error(`${job.name}: empty fetch while previous run had ${prev.rows} rows — refusing to apply`);
              err.transient = true; err.emptyGuard = true;
              throw err;
            }
          }

          const dedupe = job.dedupe || (job.key ? (r) => dedupeBy(r, job.key) : (r) => r);
          rows = dedupe(rows);
          const duplicates = rawCount - rows.length;

          let applied = { upserted: rows.length, deleted: 0 };
          if (typeof job.apply === 'function') applied = (await job.apply({ rows, watermark, fetched })) || applied;

          const nextWatermark = fetched.nextWatermark !== undefined ? fetched.nextWatermark : watermark;
          if (nextWatermark !== undefined && nextWatermark !== null) await store.setWatermark(job.name, nextWatermark);

          const t1 = now();
          await store.finishRun(runId, { finished_at: t1, status: 'ok', attempts: attempt, rows: rows.length, duplicates, upserted: applied.upserted, deleted: applied.deleted, error: null });
          log('info', `${job.name}: ok rows=${rows.length} dup=${duplicates} attempts=${attempt} ${t1 - t0}ms`);
          onEvent('sync_ok', { job: job.name, rows: rows.length, duplicates, attempts: attempt, durationMs: t1 - t0, watermark: nextWatermark });
          return { status: 'ok', job: job.name, rows: rows.length, duplicates, attempts: attempt, upserted: applied.upserted, deleted: applied.deleted, watermark: nextWatermark };
        } catch (err) {
          lastErr = err;
          const transient = isTransient(err);
          if (!transient || attempt >= opts.maxAttempts) break;
          const delay = backoffDelay(attempt, err, opts, rand);
          log('warn', `${job.name}: attempt ${attempt} failed (${scrub(err.message)}) — retry in ${delay}ms`);
          onEvent('sync_retry', { job: job.name, attempt, delayMs: delay, error: scrub(err.message) });
          await sleep(delay);
        }
      }
      const t1 = now();
      const msg = scrub(lastErr && lastErr.message);
      await store.finishRun(runId, { finished_at: t1, status: 'error', attempts: attempt, error: msg });
      log('error', `${job.name}: FAILED after ${attempt} attempt(s): ${msg}`);
      onEvent('sync_failed', { job: job.name, attempts: attempt, error: msg, emptyGuard: !!(lastErr && lastErr.emptyGuard) });
      return { status: 'error', job: job.name, attempts: attempt, error: msg };
    } finally {
      await store.releaseLock(job.name);
    }
  }

  return { run, store };
}

// Keep the LAST occurrence of a natural key (feeds are usually ordered oldest → newest,
// so the last row is the freshest). Rows without a key are dropped — an unkeyed row can
// never be upserted idempotently.
function dedupeBy(rows, key) {
  const keyOf = typeof key === 'function' ? key : (r) => r && r[key];
  const map = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    if (k === undefined || k === null || k === '') continue;
    map.set(String(k), r);
  }
  return Array.from(map.values());
}

// Delta helper: from a full extract, keep only rows changed since the watermark and
// compute the new high-water mark. Used while Zoho's CSV export still has no server-side
// date filter — the whole view is downloaded but only the delta is applied.
function deltaSince(rows, watermark, field, parse = (v) => Date.parse(v)) {
  const wm = watermark ? parse(watermark) : -Infinity;
  let max = wm;
  let maxRaw = watermark || null;
  const changed = [];
  for (const r of rows) {
    const t = parse(r[field]);
    if (!Number.isFinite(t)) { changed.push(r); continue; } // unparseable → always apply (safe side)
    if (t > wm) changed.push(r);
    if (t > max) { max = t; maxRaw = r[field]; }
  }
  return { rows: changed, nextWatermark: maxRaw, liveIds: rows };
}

// Never let a token, key or password leak into a log line or a run row.
function scrub(s) {
  return String(s == null ? '' : s)
    .replace(/(Zoho-oauthtoken\s+)[A-Za-z0-9._-]+/gi, '$1***')
    .replace(/(apiKey|api_key|token|secret|password|refresh_token|client_secret)=([^&\s]+)/gi, '$1=***')
    .replace(/(X-Cisco-Meraki-API-Key|X-API-Key|Authorization)[:=]\s*\S+/gi, '$1: ***');
}

module.exports = { createSyncRunner, memoryStore, dedupeBy, deltaSince, isTransient, backoffDelay, scrub, DEFAULTS };
