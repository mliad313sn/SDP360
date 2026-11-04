/* C-16 (F20 step, F23, F27) — figure core of the Group IT deck payload builder
 * (public/executive-report.html _buildExecPptxPayload), extracted VERBATIM so a test can
 * prove the deck figures equal the screen figures, and shared with services/reportPayload.js
 * for the exec_deck_other_bucket switch (PO decision P4). PURE, UMD (browser: window.ExecDeckPayload).
 *
 *   headlineKpis(cur, prev, {isClosed, isResOverdue}) — the deck headline KPIs (same formulas as before)
 *   changeTypeCounts(rows)   — today's deck counts (whole-word match, Normal folded into Standard
 *                              when nothing is typed Standard) + `normal` + a one-bucket-per-change
 *                              `partition` whose slices always add up to the total
 *   topNWithOther(list, n)   — top N + "Other (k)" folding the tail; never an "Other" of a single item
 *   otherBucketOn(v)         — report_config exec_deck_other_bucket: only '1' (or 1) switches it on
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ExecDeckPayload = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function headlineKpis(cur, prev, h) {
    const isClosed = h.isClosed, isResOverdue = h.isResOverdue;
    const _curClosed  = cur.filter(isClosed);
    const _prevClosed = prev.filter(isClosed);
    const closed      = _curClosed.length;
    const closedPrev  = _prevClosed.length;
    const resOverdue     = _curClosed.filter(r => isResOverdue(r)).length;
    const resOverduePrev = _prevClosed.filter(r => isResOverdue(r)).length;
    const slaResPct  = closed     ? Math.round((closed - resOverdue) / closed * 1000) / 10 : null;
    const slaResPrev = closedPrev ? (closedPrev - resOverduePrev) / closedPrev * 100 : null;
    // First Response SLA — /total basis (drives the slide-3 FRT tile; unchanged behaviour).
    const _frtV = rows => rows.filter(t => { const f = (t['First Response Overdue Status'] || '').toLowerCase(); return f === 'true' || f === 'yes' || f === '1'; }).length;
    const frtSlaPct  = cur.length  ? Math.round((1 - _frtV(cur) / cur.length) * 1000) / 10 : null;
    const frtSlaPrev = prev.length ? (1 - _frtV(prev) / prev.length) * 100 : null;
    const closureRt     = cur.length  ? Math.round((closed / cur.length) * 1000) / 10 : null;
    const closureRtPrev = prev.length ? (closedPrev / prev.length) * 100 : null;
    // FCR — numerator: closed/resolved, not reopened, not escalated; denominator: closed.
    const fcrClosed = cur.filter(r => {
      const s = (r['Request Status'] || '').toLowerCase();
      if (s !== 'closed' && s !== 'resolved') return false;
      if (parseInt(r['Reopen Count'] || 0) > 0) return false;
      const esc = (r['Is Escalated'] || r['IsEscalated'] || r['Escalated'] || 'no').toString().toLowerCase();
      return !(esc === 'true' || esc === 'yes' || esc === '1');
    }).length;
    const fcrPct = closed ? Math.round(fcrClosed / closed * 1000) / 10 : null;
    const openBacklog = cur.filter(r => !isClosed(r)).length;
    return {
      total_tickets: cur.length, closed_tickets: closed, closure_rate: closureRt, sla_res_pct: slaResPct,
      frt_sla_pct: frtSlaPct, open_backlog: openBacklog, fcr_rate: fcrPct, prev_total_tickets: prev.length,
      closedPrev, slaResPrev, frtSlaPrev, closureRtPrev,
    };
  }

  const _type = c => c['Change Type'] || c['Type'] || c.changeType || c.type || '';
  const _word = t => new RegExp('(^|[^a-z])' + t + '([^a-z]|$)', 'i');
  function changeTypeCounts(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const by = t => { const re = _word(t); return list.filter(c => re.test(_type(c))).length; };
    const emergency = by('emergency'), major = by('major'), normal = by('normal'), stdOnly = by('standard');
    const partition = { Standard: 0, Normal: 0, Major: 0, Emergency: 0, Other: 0 };
    const RE = { Emergency: _word('emergency'), Major: _word('major'), Normal: _word('normal'), Standard: _word('standard') };
    list.forEach(c => {
      const t = _type(c);
      const k = RE.Emergency.test(t) ? 'Emergency' : RE.Major.test(t) ? 'Major' : RE.Normal.test(t) ? 'Normal' : RE.Standard.test(t) ? 'Standard' : 'Other';
      partition[k]++;
    });
    return { total: list.length, emergency, major, normal, standard: stdOnly || (list.length - emergency - major), partition };
  }

  function topNWithOther(list, n, opts) {
    const o = opts || {};
    const valueKey = o.valueKey || 'current', prevKey = o.prevKey || 'previous';
    const items = Array.isArray(list) ? list : [];
    if (items.length <= n + 1) return items.slice();
    const head = items.slice(0, n), tail = items.slice(n);
    const sum = k => tail.reduce((s, x) => s + (Number(x[k]) || 0), 0);
    const other = { name: 'Other (' + tail.length + ')', [valueKey]: sum(valueKey) };
    if (tail.some(x => x[prevKey] !== undefined)) other[prevKey] = sum(prevKey);
    other.other = true; other.keys = tail.map(x => x.name);
    return head.concat([other]);
  }

  function otherBucketOn(v) { return v === 1 || v === '1'; }

  return { headlineKpis, changeTypeCounts, topNWithOther, otherBucketOn };
});
