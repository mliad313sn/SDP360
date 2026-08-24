'use strict';
// WAN SLA / ISP chargeback configuration — the canonical JSON blob stored in
// report_config under `sla_wan_config`, plus a pure resolver.
//
// A tier defines the default SLA envelope (business hours, availability target,
// response times, credit schedule); a circuit binds a physical (site_id,
// sub_site, uplink) to a tier + ISP, optionally overriding hours/credit_schedule.
// An unmapped circuit resolves to null — the caller treats it as out-of-scope
// rather than assuming a default tier (a silent default would credit an ISP we
// never contracted an SLA with).

// SILVER's weekday office hours (single source of truth for the SILVER tier default).
const SILVER_OFFICE = {
  mon: [['08:00', '13:00'], ['14:00', '17:00']],
  tue: [['08:00', '13:00'], ['14:00', '17:00']],
  wed: [['08:00', '13:00'], ['14:00', '17:00']],
  thu: [['08:00', '13:00'], ['14:00', '17:00']],
  fri: [['08:00', '13:00'], ['14:00', '17:00']],
  sat: [],
  sun: [],
};

const DEFAULT_SLA_WAN_CONFIG = {
  // ISP outage alerting — ARMED-OFF (enabled:false). trigger_minutes = the down-duration gate for
  // the DOWN email; recovery_enabled sends a RESTORED email when the link comes back (only if a
  // down email was sent); cc_coordinator adds the site coordinator to cc; servicedesk_email is
  // always cc'd. NEVER emails an ISP for a site/power outage (both uplinks down) — see wanAlert.js.
  notify: { enabled: false, trigger_minutes: 15, from_name: 'SDP NOC', poll_minutes: 5,
    recovery_enabled: true, cc_coordinator: true, servicedesk_email: 'oneitsupport@endeavourmining.com' },
  clock_start: 'notification',
  maintenance: [],
  simultaneous_overlap_minutes: 5,
  // Exact Meraki event-type strings, confirmed via discovery (a user step).
  event_types: ['wan_1_up', 'wan_1_down', 'wan_2_up', 'wan_2_down', 'uplink_change'],
  ingest: { reconcile_tolerance_minutes: 60, stale_open_hours: 24 },
  tiers: {
    SILVER: {
      hours_default: SILVER_OFFICE,
      availability_target_pct: 97,
      response: { info_min: 30, first_feedback_h: 8, resolution_h: { crit1: 12, crit2: 24, crit3: 48 } },
      min_outage_minutes: 15,
      credit_schedule: [
        { min: 97, credit: 0 },
        { min: 95, credit: 10 },
        { min: 90, credit: 25 },
        { min: 0, credit: 50 },
      ],
      credit_cap_pct: 100,
      credit_model: 'tiered',
    },
    GOLD: {},
    PLATINUM: {},
  },
  circuits: [],
};

// Deep-merge plain objects: `src` values win, but a nested object in the
// default is preserved key-by-key when `src` omits it. Arrays and primitives
// are replaced wholesale (a circuits[] or event_types[] override is deliberate).
function _isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}
function _deepMerge(base, src) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  if (!_isPlainObject(src)) return out;
  for (const k of Object.keys(src)) {
    const bv = out[k];
    const sv = src[k];
    if (_isPlainObject(bv) && _isPlainObject(sv)) out[k] = _deepMerge(bv, sv);
    else out[k] = sv;
  }
  return out;
}

// A structured-clone of the default so callers can never mutate the shared const.
function _cloneDefault() {
  return JSON.parse(JSON.stringify(DEFAULT_SLA_WAN_CONFIG));
}

// raw may be a JSON string, an object, undefined, or garbage → always return a
// well-formed config. Never throws.
function parseSlaWanConfig(raw) {
  let parsed = {};
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      if (_isPlainObject(p)) parsed = p;
    } catch (_) { /* garbage string → defaults */ }
  } else if (_isPlainObject(raw)) {
    parsed = raw;
  }
  return _deepMerge(_cloneDefault(), parsed);
}

// Find the circuit matching (site_id, sub_site, uplink); return null if unmapped.
// When found, merge with its resolved tier: hours / credit_schedule fall back to
// the tier default, and the full resolved tier object is attached.
function resolveCircuit(config, { site_id, sub_site = '', uplink } = {}) {
  const cfg = config || {};
  const circuits = Array.isArray(cfg.circuits) ? cfg.circuits : [];
  const circuit = circuits.find(c =>
    c && c.site_id === site_id && (c.sub_site || '') === (sub_site || '') && c.uplink === uplink);
  if (!circuit) return null;
  const tiers = cfg.tiers || {};
  const tier = tiers[circuit.tier] || {};
  const hours = circuit.hours != null ? circuit.hours : tier.hours_default;
  const credit_schedule = circuit.credit_schedule != null ? circuit.credit_schedule : tier.credit_schedule;
  return { ...circuit, hours, credit_schedule, tier };
}

module.exports = { DEFAULT_SLA_WAN_CONFIG, parseSlaWanConfig, resolveCircuit };
