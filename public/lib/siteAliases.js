/* C-30 (PO decision P7) — ONE site-alias table, shared by the server and the browser.
 *
 * The table itself is the one services/scoreboardAliases.js has always used (free-form
 * site labels → canonical meetings-namespace site code); it moved here unchanged so the
 * Helpdesk page can fold the same spelling variants the scoreboard folds. scoreboardAliases
 * re-exports it — there is still exactly one alias table.
 *
 * siteFoldKey(label) — the row key a site ranking groups by:
 *   1. accent/case/whitespace fold ('Houndé ' = 'HOUNDE' = 'hounde');
 *   2. the alias table, on the whole folded label, then without the generic suffix words
 *      the tracker/inspection site normalisers already strip ('IT Agents', 'Office',
 *      'Support', …, plus 'Mine'/'Site'), then on its first word (the rule
 *      executive-report.html's site dropdown already uses) — 'Hounde Mine', 'Dakar Office',
 *      'LAFIGUE - SML', 'Ouaga' all reach their site code;
 *   3. a label that is itself a code ('HGO') keeps that code;
 *   4. anything the table does not know folds to its normalised spelling only, so
 *      'LONDON' and 'London' still meet but are never guessed into another site.
 * Pure, no I/O. UMD: window.SiteAliases in the browser, module.exports in Node.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SiteAliases = api;
}(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  var ALIAS = {
    hounde: 'HGO',
    mana: 'MGO',
    sabodala: 'SGO',
    massawa: 'SGO',
    lafigue: 'SML',
    ity: 'SMI',
    kalana: 'KGO',
    ouagadougou: 'OUA',
    ouaga: 'OUA',
    abidjan: 'ABJ',
    dakar: 'DKR',
  };

  // Accent-fold + lowercase + trim (+ inner whitespace collapsed).
  function fold(s) {
    return String(s == null ? '' : s)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  var CODES = {};
  Object.keys(ALIAS).forEach(function (k) { CODES[ALIAS[k]] = true; });
  var SUFFIX = /\b(it agents?|it support|office|support|mine|site)\b/g;

  function aliasCode(label) {
    var f = fold(label);
    if (!f) return null;
    if (ALIAS[f]) return ALIAS[f];
    var stripped = f.replace(SUFFIX, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
    if (ALIAS[stripped]) return ALIAS[stripped];
    var first = stripped.split(' ')[0];
    if (first && ALIAS[first]) return ALIAS[first];
    var up = (stripped || f).toUpperCase();
    if (CODES[up]) return up;
    return null;
  }

  function siteFoldKey(label) {
    var code = aliasCode(label);
    if (code) return code;
    var f = fold(label);
    return f.replace(/[^a-z0-9]+/g, ' ').trim() || f;
  }

  return { ALIAS: ALIAS, fold: fold, aliasCode: aliasCode, siteFoldKey: siteFoldKey };
}));
