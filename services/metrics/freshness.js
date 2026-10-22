'use strict';
// Step 6 (lot 6.2) — how fresh is each domain's data? Every figure on the direction space and in a
// composed dashboard carries this stamp ("données synchronisées il y a 1 h" / "données du 18 oct.").
// Pure: the caller passes the scheduler's job states (services/sync/store.listStates) and `now`.
//
// A domain fed by a scheduled sync is "late" past its maximum age and "down" when it has never
// succeeded. Domains written by people (meetings, inspections) are live: their figures change when
// someone saves, there is no sync to be late.

const DOMAINS = {
  helpdesk:    { job: 'zoho.requests',   max_hours: 3 },
  changes:     { job: 'zoho.change_cab', max_hours: 3 },
  survey:      { job: 'zoho.survey',     max_hours: 3 },
  infra:       { job: 'meraki.wan',      max_hours: 30 },
  assets:      { job: 'assets.sync',     max_hours: 30 },
  meetings:    { live: true },
  inspections: { live: true },
  scores:      { live: true },
};

/** The freshness domain of a dictionary entry (helpdesk.csat_pct reads the survey sync). */
function domainOf(def) {
  if (!def) return null;
  if (def.serve === 'survey_month') return 'survey';
  return DOMAINS[def.domain] ? def.domain : null;
}

function freshness(states, now = new Date()) {
  const byJob = new Map((states || []).map(s => [s.job_key, s]));
  const out = {};
  for (const [domain, d] of Object.entries(DOMAINS)) {
    if (d.live) { out[domain] = { status: 'live', job: null, last_ok_at: null, age_minutes: null }; continue; }
    const s = byJob.get(d.job);
    const last = s && s.last_ok_at ? Date.parse(s.last_ok_at) : NaN;
    if (!Number.isFinite(last)) { out[domain] = { status: 'down', job: d.job, last_ok_at: null, age_minutes: null, max_hours: d.max_hours }; continue; }
    const age = Math.max(0, Math.round((now.getTime() - last) / 60000));
    out[domain] = { status: age > d.max_hours * 60 ? 'late' : 'ok', job: d.job, last_ok_at: new Date(last).toISOString(), age_minutes: age, max_hours: d.max_hours };
  }
  return out;
}

module.exports = { DOMAINS, domainOf, freshness };
