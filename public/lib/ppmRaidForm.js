/* P11 r9 R9-1 — the RAID log form (project page, W3-GOVERNANCE) as a PURE helper, shared by lib/ppmGovernanceW3.js and
 * the tests. No DOM, no network.
 *   prefill(item, money)   → { field: 'string value' } from a stored entry (GET …/raid item), '' for an unknown value
 *   buildBody(values, orig, money)
 *     new entry (orig null)  → every field, '' sent as null (create: no score = unscored, NULL — never 2 × 2)
 *     edit (orig = prefill)  → only the fields the user CHANGED; a pre-filled field the user emptied is sent as ''
 *                              (the explicit "clear" the server reads as unknown); an untouched field is left out, so
 *                              the server keeps the stored value (it used to receive null and erase the score).
 */
(function (root) {
  'use strict';
  var FIELDS = ['kind', 'title', 'probability', 'impact', 'owner', 'status', 'response', 'review_date', 'probability_pct', 'dependency_ref', 'mitigation'];
  var MONEY = ['impact_amount', 'impact_currency'];
  var str = function (v) { return v == null ? '' : String(v); };
  function fields(money) { return money ? FIELDS.concat(MONEY) : FIELDS.slice(); }
  function prefill(item, money) {
    var out = {}, it = item || {};
    fields(money).forEach(function (k) { out[k] = str(it[k]); });
    return out;
  }
  function buildBody(values, orig, money) {
    var v = values || {}, body = {};
    fields(money).forEach(function (k) {
      var now = str(v[k]);
      if (!orig) { body[k] = now === '' ? null : now; return; }
      if (now === str(orig[k])) return;          // untouched → left out → the stored value is kept
      body[k] = now;                             // changed; '' = the user emptied it = explicit clear
    });
    if (!orig && !body.status) body.status = 'open';
    return body;
  }
  var api = { FIELDS: FIELDS, MONEY: MONEY, prefill: prefill, buildBody: buildBody };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PpmRaidForm = api;
})(typeof window !== 'undefined' ? window : globalThis);
