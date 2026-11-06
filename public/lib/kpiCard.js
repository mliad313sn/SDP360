/* SDP360 — A-22 — KPI card and bullet bar as HTML strings (no Chart.js, no DOM).
 * UMD: browser global `KpiCard`, Node require. Reuses the existing card grammar — it does NOT copy it:
 *   value  -> DashboardRender.formatValue      delta + target -> DashboardRender.kpiContext
 *   stale  -> DashboardRender.staleBadge        RAG band       -> KpiRag (the single RAG policy module)
 *   kpiCard(d)   d = { label, value, unit, target, vs_target:{rag}, rag, previous:{delta,label},
 *                      higher_is_better, freshness, rag_if_fresh, spark:[n|null…] }
 *   bulletBar(d) d = { label, actual, target, min=0, max, unit, type='PERCENT', policy='kpi-target' }
 *   sparkline(values, {width,height}) -> inline SVG; null points are GAPS (separate segments), never 0.
 * A null value renders '— not measured' and carries no RAG colour (null ≠ 0). Styles: brand/components.css.
 * E-V03 — kpiCard(d, {baseLine:true}) (report_config ui_kpi_base_line='1') adds the base population line
 *   ("n = 142 tickets created" / "base not measured"); d.action_href (relative) adds "→ act". Off = unchanged. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./dashboardRender.js'), require('./kpiRag.js'));
  else root.KpiCard = factory(root.DashboardRender, root.KpiRag);
})(typeof self !== 'undefined' ? self : this, function (DR, KpiRag) {
  'use strict';

  // E-V03 — text from the shared state vocabulary (lib/stateBadge.js): symbol + text, byte-identical to before
  var NOT_MEASURED = (function () { var SB = (typeof module === 'object' && module.exports) ? require('./stateBadge.js') : (typeof self !== 'undefined' ? self : this).StateBadge; return SB ? SB.symbol('not-measured') + ' ' + SB.text('not-measured') : '— not measured'; })();
  function esc(s) { return DR.escapeHtml(s); }
  function isNum(v) { return v !== null && v !== undefined && v !== '' && isFinite(Number(v)); }

  function sparkline(values, opts) {
    var o = opts || {}; var W = o.width || 96, H = o.height || 24, P = 2;
    var pts = (values || []).map(function (v) { return isNum(v) ? Number(v) : null; });
    var nums = pts.filter(function (v) { return v !== null; });
    if (!nums.length) return '';
    var lo = Math.min.apply(null, nums), hi = Math.max.apply(null, nums), span = hi - lo || 1;
    var step = pts.length > 1 ? (W - 2 * P) / (pts.length - 1) : 0;
    var segs = [], cur = [];
    pts.forEach(function (v, i) {
      if (v === null) { if (cur.length) segs.push(cur); cur = []; return; }
      var x = P + i * step, y = H - P - ((v - lo) / span) * (H - 2 * P);
      cur.push((Math.round(x * 10) / 10) + ',' + (Math.round(y * 10) / 10));
    });
    if (cur.length) segs.push(cur);
    var body = segs.map(function (sg) {
      return sg.length === 1
        ? '<circle cx="' + sg[0].split(',')[0] + '" cy="' + sg[0].split(',')[1] + '" r="1.5"/>'
        : '<polyline points="' + sg.join(' ') + '"/>';
    }).join('');
    return '<svg class="edv-spark" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true" focusable="false">' + body + '</svg>';
  }

  function kpiCard(d, opts) {
    var k = d || {}; var o = opts || {};
    var extra = (o.baseLine ? DR.baseLine(k) : '') + (k.action_href ? DR.actionLink(k.action_href) : '');
    var label = '<div class="edv-kpi-label">' + esc(k.label || '') + '</div>';
    if (!isNum(k.value)) {
      return '<div class="edv-kpi-card edv-quiet rag-na">' + label + '<div class="edv-kpi-value">' + NOT_MEASURED + '</div>' + DR.staleBadge(k) + extra + '</div>';
    }
    var stale = !!k.freshness && k.freshness !== 'FRESH';
    var rag = stale ? 'rag-na' : DR.ragClass(k.rag || (k.vs_target && k.vs_target.rag));
    var dot = k.rag || (k.vs_target && k.vs_target.rag) || stale ? DR.ragDot(k.rag || (k.vs_target && k.vs_target.rag), stale ? k.freshness : null) : '';
    return '<div class="edv-kpi-card ' + rag + '">' + label +
      '<div class="edv-kpi-value">' + dot + esc(DR.formatValue(Number(k.value), k.unit)) + '</div>' +
      (k.spark ? sparkline(k.spark) : '') + DR.kpiContext(k) + DR.staleBadge(k) + extra + '</div>';
  }

  function bulletBar(d) {
    var b = d || {};
    var label = '<span class="edv-bullet__label">' + esc(b.label || '') + '</span>';
    if (!isNum(b.actual)) return '<div class="edv-bullet rag-na">' + label + '<span class="edv-bullet__value">' + NOT_MEASURED + '</span></div>';
    var min = isNum(b.min) ? Number(b.min) : 0;
    var max = isNum(b.max) ? Number(b.max) : (isNum(b.target) ? Math.max(Number(b.target), Number(b.actual)) : Number(b.actual)) || 1;
    var span = max - min || 1;
    var pct = function (v) { return Math.max(0, Math.min(100, Math.round(((Number(v) - min) / span) * 1000) / 10)); };
    var r = 'NA';
    if (isNum(b.target)) r = KpiRag.rag(KpiRag.attainment(Number(b.actual), Number(b.target), b.type || 'PERCENT'), b.policy || 'kpi-target');
    var cls = DR.ragClass(r);
    var target = isNum(b.target) ? '<i class="edv-bullet__target" style="left:' + pct(b.target) + '%" title="target ' + esc(DR.formatValue(Number(b.target), b.unit)) + '"></i>' : '';
    return '<div class="edv-bullet ' + cls + '">' + label +
      '<span class="edv-bullet__track" role="img" aria-label="' + esc((b.label || '') + ': ' + DR.formatValue(Number(b.actual), b.unit) + (isNum(b.target) ? ' vs target ' + DR.formatValue(Number(b.target), b.unit) : '')) + '">' +
      '<i class="edv-bullet__fill" style="width:' + pct(b.actual) + '%"></i>' + target + '</span>' +
      '<span class="edv-bullet__value">' + DR.ragDot(r) + esc(DR.formatValue(Number(b.actual), b.unit)) + '</span></div>';
  }

  return { kpiCard: kpiCard, bulletBar: bulletBar, sparkline: sparkline, NOT_MEASURED: NOT_MEASURED };
});
