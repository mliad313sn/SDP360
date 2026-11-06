#!/usr/bin/env node
'use strict';
// E-Q04 (audit Q-04, preparation) — load / soak harness. Node `http` only, no new dependency.
//
//   LOAD_USER=… LOAD_PASS=… node tools/test/load.js --target=http://127.0.0.1:3456 [--sessions=5] [--duration=60]
//        [--scenarios=reports,helpdesk,field,export] [--pid=<server pid>] [--out=docs/ops/LOAD-TEST-RUN.md]
//
// Each virtual session signs in ONCE (the login limiter allows 10 per 15 min per address, so keep
// --sessions ≤ 10 or reuse tokens with LOAD_TOKENS=t1,t2), then loops its scenarios until --duration
// seconds have passed (a long --duration is the soak):
//   reports  : GET /api/reports → GET /api/reports/:id → PUT /api/reports/:id/infra (the same rows back)
//   helpdesk : GET /api/data/requests-raw (the Helpdesk page data)
//   field    : PUT /api/field/outbox/:uuid (a fresh envelope each time; the account needs the field role;
//              LOAD_FIELD_ACTION_ID=<meetings action id> makes it a comment-only action update)
//   export   : GET /api/risk-register-export?month=YYYY-MM
// Output: p50/p95/p99 latency per step, error rate, 5xx count, and the server RSS when --pid is given
// (read from /proc/<pid>/status; the server exposes no memory figure → UNKNOWN otherwise). JSON + markdown.
//
// TARGET GUARD: only 127.0.0.1 / localhost / ::1 unless --target-confirm=<exact host> repeats the host —
// pointing load at a staging server is a human decision, and this tool never targets production.
// No threshold is written: results are observations.
const http = require('http');
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');

const LOCAL = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** Pure guard. Returns the URL object or throws "refused: …". */
function assertTarget(target, confirmHost) {
  let u;
  try { u = new URL(String(target)); } catch (_) { throw new Error('refused: --target is not a URL'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('refused: --target must be http(s)');
  if (LOCAL.has(u.hostname)) return u;
  if (confirmHost && String(confirmHost) === u.hostname) return u;
  throw new Error(`refused: ${u.hostname} is not localhost — repeat the exact host with --target-confirm=${u.hostname} (a person decides to load a staging server; never production)`);
}

function parseArgs(argv) {
  const get = (k, d) => { const a = argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
  const num = (k, d, min, max) => Math.min(max, Math.max(min, Number(get(k, d)) || d));
  return {
    target: get('target', 'http://127.0.0.1:3456'), confirm: get('target-confirm', null),
    sessions: num('sessions', 5, 1, 50), duration: num('duration', 30, 1, 24 * 3600),
    scenarios: String(get('scenarios', 'reports,helpdesk,field,export')).split(',').map((s) => s.trim()).filter(Boolean),
    pid: get('pid', null), out: get('out', null), json: get('json', null),
  };
}

/** Nearest-rank percentile; null when there is no sample (never 0). */
function percentile(values, p) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.min(v.length, Math.max(1, Math.ceil((p / 100) * v.length))) - 1];
}

/** Pure aggregation: samples [{step, ms, status}] → per-step and overall statistics. */
function aggregate(samples, { durationSec = null, rss = [] } = {}) {
  const by = {};
  for (const s of samples) (by[s.step] = by[s.step] || []).push(s);
  const stat = (list) => {
    const ms = list.map((s) => s.ms);
    const errors = list.filter((s) => !(s.status >= 200 && s.status < 400)).length;
    return { n: list.length, p50: percentile(ms, 50), p95: percentile(ms, 95), p99: percentile(ms, 99),
      errors, error_rate_pct: list.length ? Math.round(errors / list.length * 1000) / 10 : null,
      five_xx: list.filter((s) => s.status >= 500).length, network_errors: list.filter((s) => s.status === 0).length,
      statuses: list.reduce((a, s) => { a[s.status] = (a[s.status] || 0) + 1; return a; }, {}) };
  };
  const steps = {}; for (const k of Object.keys(by).sort()) steps[k] = stat(by[k]);
  const rssKb = rss.filter((x) => Number.isFinite(x));
  return { overall: stat(samples), steps, throughput_rps: durationSec ? Math.round(samples.length / durationSec * 10) / 10 : null,
    rss_kb: rssKb.length ? { first: rssKb[0], last: rssKb[rssKb.length - 1], max: Math.max(...rssKb) } : null };
}

function renderMarkdown(agg, meta) {
  const f = (v) => (v == null ? '—' : String(v));
  const L = ['# Load / soak run — observation (E-Q04)', '',
    '> Throwaway database, synthetic data, one machine. **No threshold** — a person sets SLOs (docs/ops/LOAD-TEST.md).', '',
    `- Target: ${meta.target} · sessions: ${meta.sessions} · duration: ${meta.duration} s · scenarios: ${meta.scenarios.join(', ')}`,
    `- Generated: ${meta.at} · commit: ${meta.commit || 'UNKNOWN'} · server started at: ${meta.started_at || 'UNKNOWN'}`,
    `- Requests: ${agg.overall.n} · throughput: ${f(agg.throughput_rps)} req/s · errors: ${agg.overall.errors} (${f(agg.overall.error_rate_pct)} %) · 5xx: ${agg.overall.five_xx}`,
    `- Server RSS: ${agg.rss_kb ? `${Math.round(agg.rss_kb.first / 1024)} MB at start → ${Math.round(agg.rss_kb.last / 1024)} MB at end (max ${Math.round(agg.rss_kb.max / 1024)} MB)` : 'UNKNOWN (pass --pid=<server pid>; the server exposes no memory figure)'}`, '',
    '| Step | n | p50 (ms) | p95 (ms) | p99 (ms) | errors | 5xx | statuses |', '|---|---|---|---|---|---|---|---|'];
  for (const [k, s] of Object.entries(agg.steps)) L.push(`| ${k} | ${s.n} | ${f(s.p50)} | ${f(s.p95)} | ${f(s.p99)} | ${s.errors} | ${s.five_xx} | ${Object.entries(s.statuses).map(([c, n]) => `${c}×${n}`).join(' ')} |`);
  return L.join('\n') + '\n';
}

// ── network ──────────────────────────────────────────────────────────────────────────────────────
function request(base, method, path, { token, body } = {}) {
  return new Promise((resolve) => {
    const u = new URL(path, base); const lib = u.protocol === 'https:' ? https : http;
    const data = body == null ? null : Buffer.from(JSON.stringify(body));
    const t0 = process.hrtime.bigint();
    const req = lib.request(u, { method, agent: false, headers: Object.assign({ accept: 'application/json' }, token ? { 'x-report-token': token } : {}, data ? { 'content-type': 'application/json', 'content-length': data.length } : {}) }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const ms = Number((process.hrtime.bigint() - t0) / 1000000n); const buf = Buffer.concat(chunks); let json = null; try { json = JSON.parse(buf.toString('utf8')); } catch (_) { /* not JSON */ } resolve({ status: res.statusCode, ms, json, bytes: buf.length }); });
    });
    req.on('error', () => resolve({ status: 0, ms: Number((process.hrtime.bigint() - t0) / 1000000n), json: null, bytes: 0 }));
    req.setTimeout(60000, () => req.destroy(new Error('timeout')));
    if (data) req.write(data); req.end();
  });
}
function readRssKb(pid) { try { const m = /VmRSS:\s+(\d+)\s+kB/.exec(fs.readFileSync(`/proc/${Number(pid)}/status`, 'utf8')); return m ? Number(m[1]) : null; } catch (_) { return null; } }

// LOAD_FIELD_ACTION_ID=<meetings action id> → a comment-only update on that action (the full apply path);
// without it the envelope is rejected by the apply step (400): the outbox ledger is still exercised.
function fieldPayload() {
  const id = Number(process.env.LOAD_FIELD_ACTION_ID);
  return Number.isFinite(id) && id > 0 ? { source: 'meetings', id, body: 'load harness — synthetic comment' } : { note: 'load harness — synthetic' };
}

async function session(base, token, opt, deadline, samples) {
  const rec = (step, r) => samples.push({ step, ms: r.ms, status: r.status });
  const month = new Date().toISOString().slice(0, 7);
  while (Date.now() < deadline) {
    for (const sc of opt.scenarios) {
      if (Date.now() >= deadline) break;
      if (sc === 'reports') {
        const l = await request(base, 'GET', '/api/reports', { token }); rec('reports.list', l);
        const first = Array.isArray(l.json) ? l.json[0] : (l.json && Array.isArray(l.json.reports) ? l.json.reports[0] : null);
        if (first && first.id) {
          const o = await request(base, 'GET', `/api/reports/${first.id}`, { token }); rec('reports.open', o);
          const kpis = (o.json && (o.json.infra_kpis || (o.json.report && o.json.report.infra_kpis))) || [];
          rec('reports.save_section', await request(base, 'PUT', `/api/reports/${first.id}/infra`, { token, body: kpis }));
        }
      } else if (sc === 'helpdesk') rec('helpdesk.data', await request(base, 'GET', '/api/data/requests-raw', { token }));
      else if (sc === 'field') rec('field.envelope', await request(base, 'PUT', `/api/field/outbox/${crypto.randomUUID()}`, { token, body: { kind: 'action', client_ts: new Date().toISOString(), device: 'load-harness', payload: fieldPayload() } }));
      else if (sc === 'export') rec('export.risk_register', await request(base, 'GET', `/api/risk-register-export?month=${month}`, { token }));
    }
  }
}

async function main(argv = process.argv.slice(2)) {
  const opt = parseArgs(argv);
  const u = assertTarget(opt.target, opt.confirm);
  const base = u.origin;
  let tokens = String(process.env.LOAD_TOKENS || '').split(',').filter(Boolean);
  if (!tokens.length) {
    if (!process.env.LOAD_USER || !process.env.LOAD_PASS) throw new Error('LOAD_USER + LOAD_PASS (a throwaway account) or LOAD_TOKENS are required');
    for (let i = 0; i < opt.sessions; i++) {
      const r = await request(base, 'POST', '/api/reports/auth/login', { body: { username: process.env.LOAD_USER, password: process.env.LOAD_PASS } });
      if (!r.json || !r.json.token) throw new Error(`login ${i + 1} failed with HTTP ${r.status} (the login limiter allows 10 per 15 min)`);
      tokens.push(r.json.token);
    }
  }
  const ver = await request(base, 'GET', '/api/health/version', { token: tokens[0] });
  const samples = []; const rss = [];
  if (opt.pid) rss.push(readRssKb(opt.pid));
  const timer = opt.pid ? setInterval(() => rss.push(readRssKb(opt.pid)), 5000) : null;
  const t0 = Date.now(); const deadline = t0 + opt.duration * 1000;
  await Promise.all(Array.from({ length: opt.sessions }, (_, i) => session(base, tokens[i % tokens.length], opt, deadline, samples)));
  if (timer) clearInterval(timer);
  if (opt.pid) rss.push(readRssKb(opt.pid));
  const agg = aggregate(samples, { durationSec: (Date.now() - t0) / 1000, rss });
  let commit = null; try { commit = require('child_process').execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch (_) { /* no git */ }
  const meta = { target: base, sessions: opt.sessions, duration: opt.duration, scenarios: opt.scenarios, at: new Date().toISOString(), commit, started_at: ver.json && ver.json.started_at };
  const md = renderMarkdown(agg, meta);
  if (opt.out) fs.writeFileSync(opt.out, md);
  if (opt.json) fs.writeFileSync(opt.json, JSON.stringify({ meta, ...agg }, null, 1) + '\n');
  process.stdout.write(md);
  return agg;
}

module.exports = { assertTarget, parseArgs, percentile, aggregate, renderMarkdown, LOCAL, __main: main };
if (require.main === module) main().catch((e) => { console.error('[load] ' + e.message); process.exit(2); });
