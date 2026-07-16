'use strict';
// THE ORACLE HARNESS — runs the AUTHORITATIVE dashboard's own renderVals().
//
// This is deliberately NOT a dumped JSON blob. The oracle is derived by
// EXECUTING `docs/reference/it-review-dashboard.source.js` against
// `tests/fixtures/em-data.json` on every test run. Committing the harness (not
// just its output) is what makes the fixture-refresh pitfall recoverable: if the
// snapshot is ever re-exported, re-running this re-derives the oracle instead of
// leaving a stale JSON silently certifying a drifted port.
//
//   *** IF OUR PORT DISAGREES WITH THIS, OUR PORT IS WRONG. ***
//
// The source is `class Component extends DCLogic` with no exports and no
// module system — it was unescaped out of an artifact's <script type="text/x-dc">
// block. So we compile it in place with two stubs:
//   • DCLogic — the artifact's internal base class. renderVals() never touches
//     any of its members; the only inherited thing the source calls is
//     `this.setState`, and that lives exclusively inside the `pick` closures,
//     which we never invoke. An empty base is therefore faithful.
//   • window  — the source reads `window.EM_DATA` (:207) and nothing else.
//     It never touches `document`; renderVals() runs clean outside a browser.
//
// This does NOT violate docs/reference/README.md's "never require() or bundle
// these" rule — that rule is about SHIPPING the source. Nothing here reaches the
// app: it is test-only, and its whole purpose is to diff the port against its
// source rather than trust it from memory.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'docs', 'reference', 'it-review-dashboard.source.js');

/**
 * Compile + run the authoritative dashboard's renderVals() against a dataset.
 *
 * @param {object} EM   the EM_DATA shape (tests/fixtures/em-data.json)
 * @param {object} st   the component state to stub: {view, period, site}
 * @returns {object}    his raw renderVals() output — INCLUDING the 18 `pick`
 *                      functions. Strip them before comparing (see stripFns).
 */
function runOracle(EM, st = {}) {
  const src = fs.readFileSync(SRC, 'utf8');
  const DCLogic = class {}; // the artifact's base; renderVals() needs nothing from it
  const windowStub = { EM_DATA: EM };
  // Same realm as the test → Object/Array prototypes match, so deepStrictEqual
  // compares values rather than tripping on a cross-realm prototype mismatch.
  const Component = new Function('DCLogic', 'window', src + '\n;return Component;')(DCLogic, windowStub);

  const inst = new Component();
  inst.props = {};
  inst.state = Object.assign({ view: 'dashboard', period: 'week', site: 'ALL', dataReady: true }, st);
  return inst.renderVals();
}

/**
 * Collect the dotted path of every function-valued leaf.
 *
 * ⚠️ WHY THIS EXISTS: JSON.stringify SILENTLY DROPS functions rather than
 * throwing, so a naive `JSON.parse(JSON.stringify(oracle))` dump "verifies" all
 * 61 keys by coincidence while quietly discarding the `pick` closures. We strip
 * them EXPLICITLY and assert the count, so the day the source grows a 19th
 * closure this harness says so instead of swallowing it.
 */
function fnPaths(obj, base = '') {
  const out = [];
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => out.push(...fnPaths(v, `${base}[${i}]`)));
  } else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      const p = base ? `${base}.${k}` : k;
      if (typeof v === 'function') out.push(p);
      else out.push(...fnPaths(v, p));
    }
  }
  return out;
}

/**
 * Deep copy with the given property names removed at every depth.
 *
 * Used two ways:
 *   • strip(oracle, ['pick']) — drop his live setState closures.
 *   • strip(ours,   ['key'])  — our approved deviation replaces `pick` with a
 *     declarative `key` on viewOpts/periodOpts/siteOpts. Comparing
 *     pick-stripped vs key-stripped puts both sides on the same footing.
 */
function strip(obj, props) {
  if (Array.isArray(obj)) return obj.map((v) => strip(v, props));
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (props.includes(k) || typeof v === 'function') continue;
      out[k] = strip(v, props);
    }
    return out;
  }
  return obj;
}

module.exports = { runOracle, fnPaths, strip, SRC };
