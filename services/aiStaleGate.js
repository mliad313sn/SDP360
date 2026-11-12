'use strict';
// E-B08 (audit B-08, X-B-01) — report_config `ai_commentary_stale_block` ('0' = today). When '1', the AI commentary
// of a report run is NOT generated while any source feeding its figures is stale or never synced — the same
// freshness gate publication uses (services/publishGate.freshness, governance policy limits). The caller then
// keeps the deterministic text with source:'deterministic' and error 'sources stale — AI commentary not generated'.
// Never throws: an unreadable config / store means "do not block" (= today's behaviour).
const gate = require('./publishGate');

const STALE_ERROR = 'sources stale — AI commentary not generated';

/**
 * @returns {Promise<Array|null>} the non-FRESH sources (empty array = all fresh), or null when the switch is off.
 * deps: { getConfig, lastOk(jobs), policy(siteId), now, logEvent }
 */
async function staleSourcesFor({ figures, registry, siteId = null, runRef = null }, deps = {}) {
  try {
    const getConfig = deps.getConfig || (async () => require('./reportConfig').getConfig(require('../reports-db').db));
    const cfg = (await getConfig()) || {};
    if (String(cfg.ai_commentary_stale_block) !== '1') return null;
    const mods = gate.modulesOf({ figures: figures || [] }, registry);
    const lastOk = await (deps.lastOk || gate.lastOkFromSyncStore)(gate.jobsFor(mods));
    let pol = null;
    try { pol = deps.policy ? await deps.policy(siteId) : await require('./governancePolicy').forContext({ siteId }); } catch (_) { pol = null; }
    const fr = gate.freshness(mods, lastOk, deps.now != null ? deps.now : Date.now(), pol);
    const stale = fr.sources.filter((s) => s.state !== 'FRESH');
    if (stale.length) {
      try {
        const log = deps.logEvent || ((ev) => require('../reports-db').logEvent(ev));
        log({ category: 'reports', action: 'ai_commentary_stale_blocked', target: runRef != null ? String(runRef) : null, details: { site_id: siteId, sources: stale.map((s) => ({ job: s.job, state: s.state, age_h: s.age_h })) } });
      } catch (_) { /* best-effort */ }
    }
    return stale;
  } catch (_) { return null; }
}

module.exports = { staleSourcesFor, STALE_ERROR };
