'use strict';
// E-A07 (audit A-07, X-A-02, X-A-04) — switch → prerequisites in plain words, from audit §7.1 ("dépendances à
// ne pas inverser") and the G24 release gates. DATA ONLY: these are WARNINGS shown by the config PUT answer,
// the set-ui-policy dry run and FLAG-REGISTER.md. Nothing is blocked, nothing is approved, no owner is named.
//
// `when(value)` says which value of the switch the prerequisite is about (the "switched-on" value); setting
// the switch back to today's default never warns.
const PREREQS = Object.freeze({
  site_code_shared_block: { when: (v) => String(v) === '1', text: 'Decide who owns each shared site code (e.g. TND) and correct the data first; then test the controlled 409 and the editors\' rights.' },
  kpi_policy_enforced: { when: (v) => String(v) === '1', text: 'An ADOPTED kpi_policy (committee decision), a read shadow comparison and a check of every surface (screen, API, PPTX, e-mail); keep history and rollback.' },
  alert_external_enabled: { when: (v) => String(v) === '1', text: 'A reviewed list of senders and recipients, a dry run, habilitations, and the stop switch (notifications_stop) tested.' },
  handoff_notify_enabled: { when: (v) => String(v) === '1', text: 'A reviewed recipient list and one dry run before any notification leaves the server.' },
  authz_capability_mode: { when: (v) => String(v).trim().toLowerCase() === 'enforce', text: 'Enforce is wired only for the capabilities in authz_enforce_caps: resolve every shadow divergence (tools/security/authz-divergence-report.js) and add negative API tests first.' },
  field_outbox_resolve_enabled: { when: (v) => String(v) === '1', text: 'Real-device field sessions (E-F04) must first show how often entries get stuck.' },
  dashkey_scope_mode: { when: (v) => String(v).trim().toLowerCase() === 'restrict', text: 'Every key-only consumer named and listed in dashkey_allowed_routes (tools/security/dashkey-consumers.js), after a shadow period.' },
  ui_inject_dash_key: { when: (v) => String(v) === '0', text: 'One browser pass on the TEST instance of every page that used window.__ak.' },
  ai_commentary_stale_block: { when: (v) => String(v) === '1', text: 'Sync freshness thresholds reviewed, so a "stale" verdict means what the readers expect.' },
  ui_feedback_enabled: { when: (v) => String(v) === '1', text: 'Someone named to answer feedback (B-05 RACI) before the button is shown.' },
  ui_data_quality_page: { when: (v) => String(v) === '1', text: 'A data steward per source to act on the board.' },
});

/** Pure: plain-words prerequisite text for a key (whatever the value), or null. */
function textFor(key) { return PREREQS[key] ? PREREQS[key].text : null; }

/** Pure: warnings for a patch — only keys whose new value is the switched-on value and that actually change. */
function warningsFor(patch, current = {}) {
  const out = [];
  for (const [key, value] of Object.entries(patch || {})) {
    const p = PREREQS[key];
    if (!p || !p.when(value)) continue;
    if (current && String(current[key]) === String(value)) continue;   // already at that value
    out.push({ key, value: String(value), prerequisite: p.text });
  }
  return out;
}

module.exports = { PREREQS, textFor, warningsFor };
