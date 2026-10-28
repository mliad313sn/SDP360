/* M14 — CSV formula-injection guard (CWE-1236). A text cell starting with = + - @ TAB or CR is
 * run as a formula when the CSV is opened in Excel. neutralize() prefixes such text with an
 * apostrophe; plain numbers (e.g. "-5", "+3.2") are left untouched so numeric columns stay numeric.
 * UMD: require('./public/lib/csvSafe') in Node; window.CsvSafe in the browser.
 * The browser exports inline the same one-line rule (they are page-local functions). */
(function (root) {
  function neutralize(v) {
    var s = v == null ? '' : String(v);
    return /^[=+\-@\t\r]/.test(s) && !/^[+-]?\d+(\.\d+)?$/.test(s) ? "'" + s : s;
  }
  var api = { neutralize: neutralize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CsvSafe = api;
})(typeof self !== 'undefined' ? self : this);
