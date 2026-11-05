'use strict';
// E-D04 (expert audit 2026-11-05, audit D-06) — sync CONTENT drift detector, observation only.
// The run log already says whether a job ran and how fresh it is; it did not say whether what it wrote looks
// like what it usually writes: a sync that writes 10 % of its usual rows was "ok". From the last N successful
// sync_runs of a job this flags:
//   drop                rows of the last run < drop_pct % of the rolling median of the previous runs
//   spike               rows of the last run > spike_pct % of that median
//   zero_after_history  the last run wrote 0 rows while the history median is > 0
//   duplicates_rate     duplicates / rows of the last run > duplicates_pct %
// Fewer than MIN_RUNS successful runs (or no row count recorded) = 'unknown' — never "ok".
// Detection never blocks, retries or rolls back a sync. Alerts go out through the existing sync alert path only
// when report_config sync_drift_alerts = '1' (default '0'); the three thresholds are config keys whose defaults
// are PROPOSITIONS, not decided values (owner per flow: UNKNOWN).

const MIN_RUNS = 5;
const WINDOW = 10;

function median(xs) { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** Thresholds from report_config (strings), each falling back to the proposed default. */
function thresholds(cfg = {}) {
  const pick = (k, d) => { const v = num(cfg[k]); return v != null && v >= 0 ? v : d; };
  return { drop_pct: pick('sync_drift_drop_pct', 50), spike_pct: pick('sync_drift_spike_pct', 300), duplicates_pct: pick('sync_drift_duplicates_pct', 10) };
}

/**
 * Pure. `runs` = successful runs of ONE job, newest first ({ rows, duplicates }). Returns
 * { status: 'ok'|'drift'|'unknown', flags: [...], runs_considered, last_rows, median_rows, duplicates_pct, reason? }.
 */
function computeDrift(runs, t = thresholds()) {
  const ok = (runs || []).slice(0, WINDOW);
  const base = { runs_considered: ok.length, last_rows: null, median_rows: null, duplicates_pct: null, flags: [] };
  if (ok.length < MIN_RUNS) return { ...base, status: 'unknown', reason: `fewer than ${MIN_RUNS} successful runs` };
  const last = num(ok[0].rows);
  const hist = ok.slice(1).map((r) => num(r.rows)).filter((x) => x != null);
  if (last == null || hist.length < MIN_RUNS - 1) return { ...base, status: 'unknown', reason: 'row counts not recorded' };
  const med = median(hist);
  const flags = [];
  if (last === 0 && med > 0) flags.push('zero_after_history');
  else if (med > 0 && last < med * t.drop_pct / 100) flags.push('drop');
  if (med > 0 && last > med * t.spike_pct / 100) flags.push('spike');
  const dup = num(ok[0].duplicates);
  const dupPct = dup != null && last > 0 ? Math.round((1000 * dup) / last) / 10 : null;
  if (dupPct != null && dupPct > t.duplicates_pct) flags.push('duplicates_rate');
  return { ...base, last_rows: last, median_rows: med, duplicates_pct: dupPct, flags, status: flags.length ? 'drift' : 'ok' };
}

/** Drift per job name from a sync store (needs recentOkRuns). An unreadable job = 'unknown'. */
async function driftForJobs(store, jobs, cfg) {
  const t = thresholds(cfg); const out = {};
  for (const j of jobs) {
    try { out[j] = computeDrift(await store.recentOkRuns(j, WINDOW), t); } catch (_) { out[j] = { status: 'unknown', reason: 'run log unreadable', flags: [], runs_considered: 0 }; }
  }
  return out;
}

const enabled = (cfg) => !!cfg && String(cfg.sync_drift_alerts) === '1';

module.exports = { computeDrift, driftForJobs, thresholds, enabled, MIN_RUNS, WINDOW };
