/* moneyCertBand.js — A-16 "Non certifié" band for the Assets money views
 * (Finance + Investment tabs). PURE string builder, UMD (browser + node tests).
 *
 *   MoneyCertBand.html(payload, cert, bySite) → '' | '<div …>…</div>'
 *
 * Renders ONLY when payload.certify_display === '1' AND cert.certified === false
 * (switch OFF by default → the page is unchanged). The verdict is carried by the
 * words "Non certifié", never by colour alone; the per-site table puts every value
 * in a cell; a site with no denominator shows "—", never 0 %. No currency glyph.
 * Wording mirrors services/moneyCoverage.sentence().
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MoneyCertBand = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pct(v) { return v == null || !isFinite(v) ? '—' : String(v) + ' %'; }

  function sentence(cert) {
    var p = cert.pct == null ? '—' : String(cert.pct);
    return 'Non certifié — couvre ' + (cert.sites_covered || 0) + ' site(s) / ' + p +
      ' % du parc (seuil : ≥ ' + cert.min_sites + ' sites et ≥ ' + cert.min_pct + ' %)';
  }

  function html(payload, cert, bySite) {
    if (!payload || String(payload.certify_display) !== '1') return '';
    if (!cert || cert.certified !== false) return '';
    var rows = (bySite || []).map(function (r) {
      return '<tr><td>' + esc(r.site || '(no site)') + '</td><td style="text-align:right">' +
        esc(r.eligible) + ' / ' + esc(r.total) + '</td><td style="text-align:right">' + esc(pct(r.pct)) + '</td></tr>';
    }).join('');
    return '<div class="money-cert-band" role="note" ' +
      'style="border:1px solid #d9b45a;background:#fbf5e6;color:#5c4510;border-radius:6px;padding:10px 14px;margin-bottom:16px;font-size:13px">' +
      '<strong>' + esc(sentence(cert)) + '</strong>' +
      '<div style="margin-top:4px;font-size:12px">Couverture = actifs avec un coût d’achat renseigné. ' +
      'Seuil proposé (non approuvé) — Admin ▸ configuration.</div>' +
      (rows ? '<table class="list" style="margin-top:8px;max-width:420px"><thead><tr><th>Site</th>' +
        '<th style="text-align:right">Avec coût / total</th><th style="text-align:right">Couverture</th></tr></thead><tbody>' +
        rows + '</tbody></table>' : '') +
      '</div>';
  }

  return { html: html, sentence: sentence };
});
