'use strict';
// E-A07 (audit A-07) — every report_config change leaves one system_log row per ACTUALLY changed key
// (category 'config', action 'config_changed', target = key, details {key, from, to[, reason]}).
// A secret-shaped key never carries a value: details {key, change: 'set' | 'cleared'}.
// Writers: PUT /api/reports/config (routes/adminConfig.js) and tools/reports/set-ui-policy.js --apply.
// Reader: GET /api/reports/config/history (super_admin).
const SECRET_RE = /(pass|secret|token|_key$|api_key|webhook_url|teams_url|channels|ca_bundle)/i;
const MAX_REASON = 500;

function isSecretKey(key, secretSet) { return !!(secretSet && secretSet.has && secretSet.has(key)) || SECRET_RE.test(String(key)); }
const _s = (v) => (v == null ? '' : String(v));

/**
 * Pure: the list of changes a patch makes against the current config.
 * `keys` = the keys setConfig accepts (others are dropped by it, so not journalled); a blank secret is
 * "keep the stored value" (blank-keep) → no change.
 */
function diffConfig(current, patch, { keys, secretSet, blankKeep } = {}) {
  const out = [];
  for (const [key, raw] of Object.entries(patch || {})) {
    if (keys && !keys.includes(key)) continue;
    const to = _s(raw), from = _s(current && current[key]);
    if (blankKeep && blankKeep.has && blankKeep.has(key) && to === '') continue;
    if (from === to) continue;
    if (isSecretKey(key, secretSet)) out.push({ key, change: to === '' ? 'cleared' : 'set' });
    else out.push({ key, from, to });
  }
  return out;
}

function cleanReason(r) { const s = _s(r).replace(/[\r\n]+/g, ' ').trim(); return s ? s.slice(0, MAX_REASON) : null; }

/** Writes one row per change (best-effort, never throws). ctx = {actor, actor_id, ip}. */
function journal(emit, changes, ctx = {}, reason) {
  const why = cleanReason(reason);
  for (const c of changes || []) {
    try {
      const details = { ...c, ...(why ? { reason: why } : {}) };
      emit({ category: 'config', action: 'config_changed', target: c.key, details, ...ctx });
    } catch (_) { /* a log never breaks a save */ }
  }
  return (changes || []).length;
}

function _details(d) { if (d && typeof d === 'object') return d; try { return JSON.parse(d || '{}') || {}; } catch (_) { return {}; } }
/** Pure: shape system_log rows for the history route. */
function historyRows(rows) {
  return (rows || []).map((r) => {
    const d = _details(r.details);
    const row = { ts: r.ts, key: d.key || r.target, actor: r.actor || null, reason: d.reason || null };
    if (d.change) row.change = d.change; else { row.from = d.from == null ? null : d.from; row.to = d.to == null ? null : d.to; }
    return row;
  });
}

module.exports = { SECRET_RE, isSecretKey, diffConfig, journal, cleanReason, historyRows, MAX_REASON };
