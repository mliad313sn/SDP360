'use strict';
// Step 9 — PURE alert evaluation. A rule = { key, metric, scope:'site'|'fleet', site_id?, window?, op, threshold,
// streak (consecutive breaches needed, default 1), cooldown_min, channels:[], recipients:{users:[],roles:[],emails:[]} }.
// readings = [{ rule_key, site_id|null, site, value, unit, rag, window, as_of }]. state = { `${rule}|${site}`: { breaches, last_fired_at } }.
// Anti-noise: a rule fires only after `streak` consecutive breaches, then stays quiet for cooldown_min; a
// null value is NEVER a breach (not measured ≠ 0) and resets nothing.

const OPS = {
  gt: (v, t) => v > t, gte: (v, t) => v >= t, lt: (v, t) => v < t, lte: (v, t) => v <= t, eq: (v, t) => v === t,
  rag_in: (v, t, r) => String(t).split(',').map(x => x.trim().toUpperCase()).includes(String(r || '').toUpperCase()),
};
const OPERATORS = Object.keys(OPS);
// G16 — severity of a rule: what a reader should do with it. Unknown or missing → 'warning' (never silently 'info').
const SEVERITIES = ['info', 'warning', 'critical'];
const severityOf = (rule) => (SEVERITIES.includes(rule && rule.severity) ? rule.severity : 'warning');

function breaches(rule, reading) {
  if (!reading || reading.value == null && rule.op !== 'rag_in') return false;
  if (rule.op === 'rag_in') return reading.rag != null && reading.rag !== 'NA' && OPS.rag_in(null, rule.threshold, reading.rag);
  const f = OPS[rule.op]; if (!f) return false;
  return f(Number(reading.value), Number(rule.threshold));
}

/**
 * @returns {{ firings:[{rule, reading, key, message}], state }} — state updated (immutable input)
 */
function evaluate(rules, readings, state = {}, { now = new Date() } = {}) {
  const next = { ...state }; const firings = [];
  for (const rule of rules) {
    if (rule.enabled === false || rule.enabled === 0) continue;
    for (const r of readings.filter(x => x.rule_key === rule.key)) {
      const k = `${rule.key}|${r.site_id == null ? 'fleet' : r.site_id}`;
      const st = { breaches: 0, last_fired_at: null, ...(next[k] || {}) };
      if (r.value == null && rule.op !== 'rag_in') { next[k] = st; continue; }
      if (!breaches(rule, r)) { next[k] = { ...st, breaches: 0 }; continue; }
      st.breaches += 1;
      const need = Math.max(1, Number(rule.streak) || 1);
      const cool = Math.max(0, Number(rule.cooldown_min) || 0) * 60000;
      const quiet = st.last_fired_at && (now - new Date(st.last_fired_at)) < cool;
      if (st.breaches >= need && !quiet) { st.last_fired_at = now.toISOString(); firings.push({ rule, reading: r, key: k, severity: severityOf(rule), message: describe(rule, r) }); }
      next[k] = st;
    }
  }
  return { firings, state: next };
}

function describe(rule, r) {
  const v = r.value == null ? '—' : (r.unit === '%' ? `${Math.round(r.value * 10) / 10} %` : String(r.value));
  const where = r.site || 'fleet'; const win = r.window && r.window.label ? ` (${r.window.label})` : '';
  return `${rule.name || rule.key}: ${rule.metric} = ${v}${win} at ${where} — ${rule.op === 'rag_in' ? `RAG ${r.rag}` : `${rule.op} ${rule.threshold}`}`;
}

/** Group firings per channel + recipient so one notification carries several rules (digest-friendly). */
function fanOut(firings) {
  const out = { inapp: new Map(), email: new Map(), teams: [], webhook: [] };
  for (const f of firings) {
    const ch = f.rule.channels || ['inapp']; const rc = f.rule.recipients || {};
    if (ch.includes('inapp')) for (const u of rc.users || []) { if (!out.inapp.has(u)) out.inapp.set(u, []); out.inapp.get(u).push(f); }
    if (ch.includes('email')) for (const e of rc.emails || []) { if (!out.email.has(e)) out.email.set(e, []); out.email.get(e).push(f); }
    if (ch.includes('teams')) out.teams.push(f);
    if (ch.includes('webhook')) out.webhook.push(f);
  }
  return out;
}

// ── E-R07 (audit R-07) — sober alerting. All PURE; the caller (engagementJobs) applies them behind switches.

/** report_config alert_quiet_hours "HH:MM-HH:MM" (UTC; may cross midnight). Empty / invalid = no quiet window. */
function parseQuiet(spec) {
  const m = /^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/.exec(String(spec || ''));
  if (!m) return null;
  const a = Number(m[1]) * 60 + Number(m[2]), b = Number(m[3]) * 60 + Number(m[4]);
  if (a > 1439 || b > 1439 || a === b) return null;
  return { from: a, to: b };
}
function inQuiet(now, spec) {
  const q = typeof spec === 'object' && spec ? spec : parseQuiet(spec); if (!q) return false;
  const d = now instanceof Date ? now : new Date(now); const t = d.getUTCHours() * 60 + d.getUTCMinutes();
  return q.from < q.to ? (t >= q.from && t < q.to) : (t >= q.from || t < q.to);
}
/** Inside the quiet window, non-critical firings are DEFERRED (not notified now); critical ones never are. */
function partitionQuiet(firings, { now = new Date(), quiet = '' } = {}) {
  if (!inQuiet(now, quiet)) return { now: firings || [], deferred: [] };
  const out = { now: [], deferred: [] };
  for (const f of firings || []) (severityOf(f.rule) === 'critical' ? out.now : out.deferred).push(f);
  return out;
}

const _site = (n) => { const m = / at (.+?) — /.exec(String(n && n.body || '')); return m ? m[1] : null; };
/** Digest grouping (alert_group_by_rule = '1'): one rule's alert notifications become ONE line listing the sites. */
function groupDigestItems(items) {
  const out = []; const byRule = new Map();
  for (const n of items || []) {
    if (n.source_kind !== 'alert_rule' || !n.source_ref) { out.push(n); continue; }
    const rule = String(n.source_ref).split('|')[0];
    if (!byRule.has(rule)) { const g = { ...n, _sites: [], _n: 0 }; byRule.set(rule, g); out.push(g); }
    const g = byRule.get(rule); g._n++; const s = _site(n) || String(n.source_ref).split('|')[1] || 'fleet'; if (!g._sites.includes(s)) g._sites.push(s);
  }
  return out.map((n) => (n._sites ? (({ _sites, _n, ...rest }) => (_n > 1 ? { ...rest, body: `${_n} firings · ${_sites.length} site(s): ${_sites.join(', ')}` } : rest))(n) : n));
}

const _median = (xs) => { if (!xs.length) return null; const a = [...xs].sort((x, y) => x - y); const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
/**
 * Noise per rule over a window. firings = alert_firings rows; notifications = notifications rows with
 * source_kind 'alert_rule' (source_ref `${rule}|${site}`). read_rate is a READ rate (read_at), not an
 * acknowledgement; null when no notification was written; median minutes to read null when none was read.
 */
function noiseMetrics({ firings = [], notifications = [] } = {}) {
  const rules = new Map();
  const R = (k) => { if (!rules.has(k)) rules.set(k, { rule: k, fired: 0, sites: new Set(), notified: 0, read: 0, mins: [] }); return rules.get(k); };
  for (const f of firings) { const r = R(f.rule_key); r.fired++; r.sites.add(f.site_id == null ? 'fleet' : String(f.site_id)); }
  for (const n of notifications) {
    if (n.source_kind && n.source_kind !== 'alert_rule') continue;
    const r = R(String(n.source_ref || '').split('|')[0]); r.notified++;
    if (n.read_at) { r.read++; const d = (Date.parse(n.read_at) - Date.parse(n.created_at)) / 60000; if (Number.isFinite(d) && d >= 0) r.mins.push(d); }
  }
  return [...rules.values()].map((r) => ({ rule: r.rule, fired: r.fired, sites: r.sites.size, multi_site: r.sites.size > 1, notified: r.notified, read: r.read,
    read_rate_pct: r.notified ? Math.round((r.read / r.notified) * 1000) / 10 : null, median_minutes_to_read: r.mins.length ? Math.round(_median(r.mins)) : null }))
    .sort((a, b) => b.fired - a.fired || a.rule.localeCompare(b.rule));
}

module.exports = { evaluate, breaches, describe, fanOut, OPERATORS, SEVERITIES, severityOf, parseQuiet, inQuiet, partitionQuiet, groupDigestItems, noiseMetrics };
