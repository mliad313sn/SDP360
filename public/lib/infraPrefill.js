/* P4 / B9 — weekly-report infrastructure prefill: ONE rule set for the browser and the server.
 *
 *  planFill(rows, fills, tokens)      PURE. For each row {service, value} decides:
 *                                       'none'    the service has no measured source (Backup, Radio, custom)
 *                                       'keep'    a value is already there — NEVER overwritten (typed or saved)
 *                                       'fill'    empty + a verified snapshot exists → fill it
 *                                       'unknown' empty + measurable + no snapshot → shown "— inconnu", a fix task
 *  verifySources(kpis, fills, tokens) PURE, used by PUT /api/reports/:id/infra. A row that CLAIMS an automatic
 *                                     source keeps it only if its value still equals that snapshot; otherwise it
 *                                     is stored as 'manual'. The client can never launder a typed number into
 *                                     a "Meraki" badge.
 *  provenance(row)                    PURE. Badge model {kind, text, title}: source · data-through, or "manuel".
 *  connectorOf(family)                wan1/wan2 → meraki ; lan/wifi/servers → opmanager.
 *  applyToDom(tbody, data, opts)      BROWSER. Applies planFill to the rendered rows, re-reading every value at
 *                                     apply time (a value typed while the request was in flight survives).
 *
 * UMD like public/lib/wanLineMatch.js (Node require + window.InfraPrefill). Absent measure = "—", never 0.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./wanLineMatch'));
  else root.InfraPrefill = factory(root.WanLineMatch);
}(typeof self !== 'undefined' ? self : this, function (WLM) {
  var AUTO = { meraki: 'Meraki', opmanager: 'OpManager' };

  function parse(service, tokens) {
    if (WLM && WLM.parseServiceLine) return WLM.parseServiceLine(service, tokens || []);
    return { family: null, sub_site: '' };
  }
  function connectorOf(family) {
    if (family === 'wan1' || family === 'wan2') return 'meraki';
    if (family === 'lan' || family === 'wifi' || family === 'servers') return 'opmanager';
    return null;
  }
  function blank(v) { return v == null || String(v).trim() === ''; }
  function normVal(v) { return String(v == null ? '' : v).replace(/\s+/g, '').replace(/%$/, '').replace(',', '.'); }
  function findFill(fills, family, subSite) {
    if (!family) return null;
    var list = fills || [];
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      if (f && f.match === family && String(f.sub_site || '') === String(subSite || '')) return f;
    }
    return null;
  }

  function planFill(rows, fills, tokens) {
    return (rows || []).map(function (r, i) {
      var p = parse(r && r.service, tokens);
      var out = { i: i, family: p.family, sub_site: p.sub_site || '', connector: connectorOf(p.family), fill: null };
      if (!p.family) { out.action = 'none'; return out; }
      if (!blank(r && r.value)) { out.action = 'keep'; return out; }
      var f = findFill(fills, p.family, p.sub_site);
      if (f && !blank(f.value)) { out.action = 'fill'; out.fill = f; return out; }
      out.action = 'unknown';
      return out;
    });
  }

  function verifySources(kpis, fills, tokens) {
    return (kpis || []).map(function (k) {
      var row = Object.assign({}, k);
      var claimed = row.value_source;
      if (blank(row.status_value)) { row.value_source = null; row.value_data_through = null; return row; }
      if (claimed === 'meraki' || claimed === 'opmanager') {
        var p = parse(row.service, tokens);
        var f = findFill(fills, p.family, p.sub_site);
        if (f && f.source === claimed && normVal(f.value) === normVal(row.status_value)) {
          row.value_data_through = f.data_through || null;
          return row;
        }
        row.value_source = 'manual'; row.value_data_through = null; return row;
      }
      if (claimed === 'manual') { row.value_data_through = null; return row; }
      row.value_source = null; row.value_data_through = null;   // not recorded (old client / old row)
      return row;
    });
  }

  function provenance(r) {
    var src = r && r.value_source;
    if (r && blank(r.status_value != null ? r.status_value : r.value)) {
      return r.measurable ? { kind: 'unknown', text: '— inconnu', title: 'Aucune mesure automatique pour cette ligne : valeur inconnue (jamais 0). Cliquer pour créer une tâche de correction.' }
        : { kind: 'none', text: '', title: '' };
    }
    if (AUTO[src]) {
      var thr = r.value_data_through || r.data_through || null;
      return { kind: 'auto', text: AUTO[src] + (thr ? ' · ' + String(thr).slice(0, 10) : ''),
        title: 'Pré-rempli depuis ' + AUTO[src] + (thr ? ', données jusqu’au ' + String(thr).slice(0, 10) : '') + (r.stale ? ' (donnée périmée)' : '') + '. Vérifié par le serveur à l’enregistrement.' };
    }
    if (src === 'manual') return { kind: 'manual', text: 'manuel', title: 'Valeur saisie à la main.' };
    return { kind: 'none', text: '', title: 'Provenance non enregistrée (ligne antérieure).' };
  }

  /* Browser only. rows = the <tr> of #infra-body; each has the service input first and .infra-value-input.
   * opts.onFill(tr, fill, family), opts.onUnknown(tr, plan) are page hooks (colour/trend, badge). */
  function applyToDom(tbody, data, opts) {
    opts = opts || {};
    var trs = Array.prototype.slice.call(tbody ? tbody.querySelectorAll('tr') : []);
    var rows = trs.map(function (tr) {
      var svc = tr.querySelector('input'); var val = tr.querySelector('.infra-value-input');
      return { service: svc ? svc.value : '', value: val ? val.value : '' };
    });
    var plan = planFill(rows, (data && data.fills) || [], (data && data.tokens) || []);
    var filled = 0, unknown = 0;
    plan.forEach(function (p) {
      var tr = trs[p.i]; var val = tr && tr.querySelector('.infra-value-input');
      if (!val) return;
      if (p.action === 'fill') {
        if (!blank(val.value)) return;            // re-checked at write time: a value typed meanwhile wins
        val.value = p.fill.value;
        tr.dataset.valueSource = p.fill.source || '';
        tr.dataset.valueDataThrough = p.fill.data_through || '';
        filled++;
        if (opts.onFill) opts.onFill(tr, p.fill, p.family);
      } else if (p.action === 'unknown') {
        unknown++;
        tr.dataset.measurable = '1';
        if (opts.onUnknown) opts.onUnknown(tr, p);
      } else if (p.action === 'keep' && p.family) {
        tr.dataset.measurable = '1';
      }
    });
    return { filled: filled, unknown: unknown, plan: plan };
  }

  return { planFill: planFill, verifySources: verifySources, provenance: provenance, connectorOf: connectorOf, findFill: findFill, applyToDom: applyToDom };
}));
