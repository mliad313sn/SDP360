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
      if (st.breaches >= need && !quiet) { st.last_fired_at = now.toISOString(); firings.push({ rule, reading: r, key: k, message: describe(rule, r) }); }
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

module.exports = { evaluate, breaches, describe, fanOut, OPERATORS };
