'use strict';
// P03 — test-only preload: forces report_config switches ON for one test run by overriding their DEFAULTS, so every
// throwaway test database reads them as switched on unless the test itself writes another value.
//
//   SDP_FORCE_SWITCHES="ui_home_queue=1,commitments_enabled=1" \
//   NODE_OPTIONS="... --require $PWD/tools/test/force-switches.js ..." node --test --test-force-exit <files>
//
// SAFETY: it refuses to do anything outside a `node --test` run (NODE_TEST_CONTEXT set by the runner in each test
// child) or when a production-looking database URL is in the environment. It never writes to a database: it only
// changes the in-memory defaults of services/reportConfig.js in this process. Unknown keys are refused (a typo
// would otherwise make a lot run silently "green" with the switch still off).
const path = require('path');

function parse(spec) {
  const out = {};
  for (const part of String(spec || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const i = part.indexOf('=');
    const k = (i < 0 ? part : part.slice(0, i)).trim();
    out[k] = i < 0 ? '1' : part.slice(i + 1).trim();
  }
  return out;
}

/** Pure: may forcing happen in this environment? Returns null when yes, else the reason. */
function refusal(env) {
  if (!env.SDP_FORCE_SWITCHES) return 'SDP_FORCE_SWITCHES is empty';
  if (!env.NODE_TEST_CONTEXT) return 'not inside a node --test run';
  if (env.NODE_ENV === 'production') return 'NODE_ENV=production';
  if (env.SDP_TEST_PG_URL) return 'SDP_TEST_PG_URL points at an existing (possibly restored) database';
  return null;
}

/** Apply to a DEFAULTS object; returns the keys applied. Throws on unknown keys. */
function apply(defaults, spec) {
  const want = parse(spec);
  const unknown = Object.keys(want).filter((k) => !(k in defaults));
  if (unknown.length) throw new Error(`force-switches: unknown report_config key(s): ${unknown.join(', ')}`);
  for (const [k, v] of Object.entries(want)) defaults[k] = v;
  return Object.keys(want);
}

module.exports = { parse, refusal, apply };

if (require.main !== module) {
  const why = refusal(process.env);
  if (!why) {
    const { DEFAULTS } = require(path.join(__dirname, '..', '..', 'services', 'reportConfig'));
    apply(DEFAULTS, process.env.SDP_FORCE_SWITCHES);
  }
}
