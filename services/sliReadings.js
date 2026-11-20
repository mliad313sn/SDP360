'use strict';
// P05 — 30-day readings of the SLIs proposed in docs/ops/SLO-PROPOSAL.md, served on /api/health/deps as
// `sli_30d`. OBSERVATION ONLY: every target is `UNKNOWN — to be approved by SRE`, and no reading is turned
// into a colour. A reading the server cannot make is `null` with the reason in `basis` — never 0, never green.
//   compose(raw, now)  pure: raw readings → { window_days, from, to, items }
//   gather({ pg, now, counters, freshness })  reads PostgreSQL; each part degrades to null on its own
const WINDOW_DAYS = 30;
const TARGET = 'UNKNOWN — to be approved by SRE';
const DAY = 86400000;

function percentile(values, p) {
  const v = (values || []).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.min(v.length, Math.max(1, Math.ceil((p / 100) * v.length))) - 1];
}
const pct = (num, den) => (den > 0 ? Math.round(num / den * 1000) / 10 : null);
const toMs = (t) => { const n = Date.parse(String(t)); return Number.isFinite(n) ? n : null; };

/** Share (%) of [from, to] during which the last ok run was at most `freshnessHours` old. null when unknowable. */
function freshShare(okTimes, freshnessHours, from, to) {
  const lim = Number(freshnessHours) * 3600000;
  const ts = (okTimes || []).map(toMs).filter((x) => x != null).sort((a, b) => a - b);
  if (!ts.length || !(lim > 0) || !(to > from)) return null;
  let fresh = 0;
  for (let i = 0; i < ts.length; i++) {
    const start = Math.max(ts[i], from);
    const end = Math.min(ts[i] + lim, i + 1 < ts.length ? ts[i + 1] : Infinity, to);
    if (end > start) fresh += end - start;
  }
  return Math.round(fresh / (to - from) * 1000) / 10;
}

function compose(raw = {}, now = new Date()) {
  const to = now.getTime(); const from = to - WINDOW_DAYS * DAY;
  const item = (sli, value, unit, basis, extra) => ({ sli, value, unit, basis, target: TARGET, ...(extra || {}) });
  const c = raw.counters || null; const auth = raw.auth || null;
  const signIn = item('share of sign-in answers without a 5xx', c && c.login.total ? pct(c.login.total - c.login.five_xx, c.login.total) : null, '%',
    c ? 'in-process counter since the server started (a restart empties it)' : 'no counter on this server',
    { window: c ? 'since_server_start' : null, since: c ? c.started_at : null, answers: c ? c.login.total : null,
      login_success_30d: auth ? auth.success : null, login_failed_30d: auth ? auth.failed : null });
  // A job's history starts at its first recorded ok run: a database younger than 30 days is not read as 30 days stale.
  // P11 r3 N-08 — a declared job with NO ok run is never dropped: failing in the window → 0 % (measured: never fresh);
  // no run at all → null 'never_ok' (unknown); an optional job that only self-skips → 'not_configured', outside the
  // worst-job reading. The worst job is the minimum of the measured values, but it is null (unknown) when an unknown
  // job could be worse — unless a measured job is already at 0.
  const jobs = (raw.sync || []).map((j) => {
    const okTimes = (j.ok_times || []).map(toMs).filter((x) => x != null);
    if (!okTimes.length) {
      const failing = Number(j.errors) > 0;
      const status = failing ? 'failing' : (j.optional ? 'not_configured' : 'never_ok');
      return { job: j.job, freshness_hours: j.freshness_hours, measured_from: null, fresh_pct: failing ? 0 : null, status };
    }
    // P11 r4 N-09 — the history starts at the job's FIRST RUN (ok or error), not its first ok: failures before the
    // first success are a span where the job was not fresh. Dead for 29 days then ok once must not read 100 %.
    const firstRun = toMs(j.first_run);
    const first = Math.min(...okTimes, firstRun != null ? firstRun : Infinity);
    const start = Math.max(from, first);
    return { job: j.job, freshness_hours: j.freshness_hours, measured_from: new Date(start).toISOString(), fresh_pct: freshShare(j.ok_times, j.freshness_hours, start, to) };
  });
  const fp = jobs.map((j) => j.fresh_pct).filter((x) => x != null);
  const unknown = jobs.filter((j) => j.status === 'never_ok').map((j) => j.job);
  const worst = fp.length ? Math.min(...fp) : null;
  const syncValue = worst === 0 ? 0 : (unknown.length ? null : worst);
  const syncBasis = !raw.sync ? 'sync_runs unreadable'
    : 'sync_runs ok runs in the window + the last ok run before it' + (unknown.length ? `; never succeeded, so the worst job is unknown: ${unknown.join(', ')}` : '');
  const sync = item('share of time each sync job was inside its freshness window (worst job)', syncValue, '%', syncBasis, { jobs });
  const d = raw.delivery || null;
  const delivery = item('share of send attempts recorded ok/resent', d ? pct(d.ok, d.ok + d.fail) : null, '%',
    d ? 'report_sent_log — attempts, not due sends (the schedule is not replayed)' : 'report_sent_log unreadable', { ok: d ? d.ok : null, fail: d ? d.fail : null });
  const f = raw.field || null;
  const settled = f ? f.total - f.pending : 0;
  const field = item('share of settled field outbox entries applied', f ? pct(f.applied, settled) : null, '%',
    f ? 'field_outbox — received in the window; entries still pending are not counted' : 'field_outbox unreadable',
    { total: f ? f.total : null, applied: f ? f.applied : null, pending: f ? f.pending : null, resolved_by_hand: f ? f.resolved : null });
  const lat = c ? c.db_latency_ms : [];
  const p95 = percentile(lat, 95);
  const db = item('PostgreSQL SELECT 1 latency p95', p95 == null ? null : Math.round(p95 * 10) / 10, 'ms',
    lat.length ? 'readings taken by /ready and /api/health/deps since the server started' : 'no reading yet',
    { samples: lat.length, window: 'since_server_start' });
  const b = raw.backup || null;
  const lastOk = b && b.last_ok ? toMs(b.last_ok) : null;
  const backups = item('age of the last ok db.backup run', lastOk == null ? null : Math.round((to - lastOk) / 3600000 * 10) / 10, 'h',
    b ? 'sync_runs job db.backup + system_log restore_drill' : 'sync_runs unreadable',
    { ok_runs_30d: b ? b.ok : null, failed_runs_30d: b ? b.failed : null, restore_drills_30d: raw.drills ? raw.drills.total : null, restore_drills_failed_30d: raw.drills ? raw.drills.failed : null });
  return {
    window_days: WINDOW_DAYS, from: new Date(from).toISOString(), to: new Date(to).toISOString(),
    items: {
      sign_in: signIn,
      availability: item('share of 1-minute probes where GET /ready answers 200', null, '%', 'needs an external probe — none is connected (docs/agent-execution/P05-performance.md)'),
      sync_freshness: sync, scheduled_delivery: delivery, field_apply: field, database_latency: db, backups,
      disk: item('data-dir free space over time', null, '%', 'no history is kept — the current reading is items.disk'),
    },
  };
}

async function gather({ pg, now = new Date(), counters = null, freshness = {}, optional = null } = {}) {
  const fromIso = new Date(now.getTime() - WINDOW_DAYS * DAY).toISOString();
  const raw = { counters };
  const all = async (sql, ...p) => pg.prepare(sql).all(...p);
  const one = async (sql, ...p) => pg.prepare(sql).get(...p);
  try {
    const r = await one(`SELECT COUNT(*) FILTER (WHERE action='login_success') AS s, COUNT(*) FILTER (WHERE action='login_failed') AS f
      FROM system_log WHERE category='auth' AND ts >= ?`, fromIso);
    raw.auth = { success: Number(r.s) || 0, failed: Number(r.f) || 0 };
  } catch (_) { raw.auth = null; }
  try {
    const rows = await all(`SELECT job, finished_at FROM sync_runs WHERE status='ok' AND finished_at >= ?
      UNION ALL SELECT job, MAX(finished_at) FROM sync_runs WHERE status='ok' AND finished_at < ? GROUP BY job`, fromIso, fromIso);
    const by = {};
    for (const r of rows) (by[r.job] = by[r.job] || []).push(r.finished_at);
    // errors in the window per job (a job that never succeeded but keeps failing is dead, not unknown)
    const errBy = {}; const firstBy = {};
    try {
      // first_run (ok or error, any date) anchors the job's history (N-09); self-skipped runs do not.
      const er = await all(`SELECT job, COUNT(*) FILTER (WHERE status='error' AND started_at >= ?) AS errors,
        MIN(started_at) FILTER (WHERE status IN ('ok','error')) AS first_run FROM sync_runs GROUP BY job`, fromIso);
      for (const r of er || []) if (r && r.job != null) { errBy[r.job] = Number(r.errors) || 0; if (r.first_run) firstBy[r.job] = r.first_run; }
    } catch (_) { /* errors unknown → treated as 0: a never-ok job then reads unknown, never green */ }
    const opt = optional || require('./sync/jobs').OPTIONAL;
    // every DECLARED job (freshness window) is listed — not only those with an ok run (N-08)
    raw.sync = Object.keys(freshness).filter((j) => freshness[j] != null).sort()
      .map((j) => ({ job: j, freshness_hours: freshness[j], ok_times: by[j] || [], errors: errBy[j] || 0, optional: !!(opt && opt.has && opt.has(j)) }));
    for (const row of raw.sync) if (firstBy[row.job]) row.first_run = firstBy[row.job];   // N-09: history anchor
  } catch (_) { raw.sync = null; }
  try {
    const r = await one(`SELECT COUNT(*) FILTER (WHERE status='ok' AND started_at >= ?) AS ok, COUNT(*) FILTER (WHERE status='error' AND started_at >= ?) AS failed,
      MAX(finished_at) FILTER (WHERE status='ok') AS last_ok FROM sync_runs WHERE job='db.backup'`, fromIso, fromIso);
    raw.backup = { ok: Number(r.ok) || 0, failed: Number(r.failed) || 0, last_ok: r.last_ok || null };
  } catch (_) { raw.backup = null; }
  try {
    const r = await one(`SELECT COUNT(*) FILTER (WHERE result IN ('ok','resent')) AS ok, COUNT(*) FILTER (WHERE result='fail') AS fail
      FROM report_sent_log WHERE sent_at >= ?::timestamptz`, fromIso);
    raw.delivery = { ok: Number(r.ok) || 0, fail: Number(r.fail) || 0 };
  } catch (_) { raw.delivery = null; }
  try {
    const r = await one(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status='applied') AS applied,
      COUNT(*) FILTER (WHERE status IN ('received','applying')) AS pending FROM field_outbox WHERE received_at >= ?`, fromIso);
    const z = await one(`SELECT COUNT(*) AS n FROM system_log WHERE category='field' AND action='field_outbox_resolved' AND ts >= ?`, fromIso);
    raw.field = { total: Number(r.total) || 0, applied: Number(r.applied) || 0, pending: Number(r.pending) || 0, resolved: Number(z.n) || 0 };
  } catch (_) { raw.field = null; }
  try {
    const r = await one(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE risk=1) AS failed FROM system_log WHERE category='ops' AND action='restore_drill' AND ts >= ?`, fromIso);
    raw.drills = { total: Number(r.total) || 0, failed: Number(r.failed) || 0 };
  } catch (_) { raw.drills = null; }
  return compose(raw, now);
}

module.exports = { compose, gather, freshShare, percentile, WINDOW_DAYS, TARGET };
