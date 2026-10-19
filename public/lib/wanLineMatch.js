/* Shared WAN report-line matcher (V1b-E). Resolves a free-text Infrastructure-KPI
 * service line (e.g. "WAN1 Fetekro Explo") to a (family, sub_site) pair. family is the
 * snapshot key (wan1/wan2/wifi/servers/lan, else null); sub_site is gated ONLY on the
 * configured tokens for the site, so a site with no sub-site config always yields
 * sub_site '' — normal sites stay unchanged. Single source of the family classifier
 * (services/opmReportFill.serviceToFill delegates here). Usable in Node (require) and
 * the browser (window.WanLineMatch), same UMD pattern as public/lib/actionSimilarity.js.
 * See docs/superpowers/specs/2026-08-16-infra-wan-subsite-exploration-design.md §7.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WanLineMatch = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  function normTok(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .trim().toLowerCase().replace(/\s+/g, ' ');
  }
  function family(n) {
    if (/wlan|wifi|wireless/.test(n)) return 'wifi';   // BEFORE wan
    if (/wan\s*1/.test(n)) return 'wan1';
    if (/wan\s*2/.test(n)) return 'wan2';
    if (/\bserver/.test(n)) return 'servers';
    if (/\blan\b/.test(n)) return 'lan';
    return null;                                        // backup / radio / custom
  }
  // tokens: array of configured sub-site tokens for this site (may be empty).
  function parseServiceLine(name, tokens) {
    const nn = normTok(name);
    const fam = family(nn);
    let sub = '';
    const toks = (tokens || []).map(t => ({ raw: t, n: normTok(t) })).filter(t => t.n)
      .sort((a, b) => b.n.length - a.n.length);         // longest first
    for (const t of toks) { if (nn.includes(t.n)) { sub = t.raw; break; } }
    return { family: fam, sub_site: sub };
  }
  return { normTok, parseServiceLine };
}));
