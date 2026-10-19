// Business Incubation form helpers for meeting.html (2026-10-03) — UMD, pure (no DOM).
// The incubation session follows the Incubation Follow-up Report: §1 roles + session
// end/duration, §2 business description, §3 information flow, §4 services provided
// (status = closed list), §5 challenges = the ordinary issues. The server re-normalises
// everything (services/incubationForm.js); this side only shapes and renders.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IncubationEditor = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SERVICE_STATUSES = [
    { code: 'active',      en: 'Active',      fr: 'Actif' },
    { code: 'in_progress', en: 'In progress', fr: 'En cours' },
    { code: 'planned',     en: 'Planned',     fr: 'Prévu' },
    { code: 'stopped',     en: 'Stopped',     fr: 'Arrêté' },
  ];

  function _fold(v) {
    return String(v == null ? '' : v).trim().toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\s_-]+/g, ' ');
  }
  // Same mapping as services/incubationForm.normalizeServiceStatus (older imports stored text).
  function statusCode(v) {
    var s = _fold(v);
    if (!s) return '';
    if (/^(active|actif|actives?)$/.test(s)) return 'active';
    if (/^(in progress|en cours|ongoing)$/.test(s)) return 'in_progress';
    if (/^(planned|prevu|planifie|a venir|todo)$/.test(s)) return 'planned';
    if (/^(stopped|arrete|inactif|inactive|stoppe|termine)$/.test(s)) return 'stopped';
    return '';
  }

  function isIncubation(h) { return !!h && String(h.intake_source || '') === 'business_incubation'; }

  function _s(v) { return v == null ? '' : String(v); }

  function fromHeader(h) {
    var i = (h && h.incubation && typeof h.incubation === 'object') ? h.incubation : {};
    var r = i.roles || {};
    return {
      roles: { incubator: _s(r.incubator), incubator_title: _s(r.incubator_title),
               incubation_manager: _s(r.incubation_manager), it_manager: _s(r.it_manager) },
      session_end: _s(i.session_end), duration: _s(i.duration),
      business_description: _s(i.business_description),
      flow: (Array.isArray(i.flow) ? i.flow : []).map(function (f) {
        return { incoming: _s(f && f.incoming), activity: _s(f && f.activity), outgoing: _s(f && f.outgoing) };
      }),
      services: (Array.isArray(i.services) ? i.services : []).map(function (x) {
        return { service: _s(x && x.service), beneficiary: _s(x && x.beneficiary), status: statusCode(x && x.status) };
      }),
    };
  }

  // The two managers are typed in the header fields (department_head / site_it_lead) —
  // mirrored into roles so the blob stays complete for every reader of incubation_json.
  function payloadIncubation(header, inc) {
    if (!isIncubation(header) || !inc) return null;
    var roles = Object.assign({}, inc.roles, {
      incubation_manager: _s(header.department_head), it_manager: _s(header.site_it_lead),
    });
    return Object.assign({}, inc, { roles: roles });
  }

  var EMPTY = '<div style="text-align:center;color:#7B7B7B;font-style:italic;padding:14px;font-size:12px">';

  function flowRowsHtml(flow, esc) {
    if (!flow || !flow.length) return EMPTY + 'No information flow recorded yet · Aucun flux saisi</div>';
    return flow.map(function (f, ix) {
      return '<div class="pv-item" data-kind="flow" data-ix="' + ix + '">' +
        '<div class="pv-item__head"><span class="pv-item__ord">F' + (ix + 1) + '</span>' +
        '<button class="pv-item__rm" type="button" data-rm="flow" data-ix="' + ix + '">Remove ✕</button></div>' +
        '<div class="pv-row pv-row--three">' +
        '<div class="pv-field"><label>Incoming information <em>· Infos entrantes</em></label><textarea data-k="incoming">' + esc(f.incoming) + '</textarea></div>' +
        '<div class="pv-field"><label>Activity <em>· Activité</em></label><textarea data-k="activity">' + esc(f.activity) + '</textarea></div>' +
        '<div class="pv-field"><label>Outgoing information <em>· Infos sortantes</em></label><textarea data-k="outgoing">' + esc(f.outgoing) + '</textarea></div>' +
        '</div></div>';
    }).join('');
  }

  function serviceRowsHtml(services, esc) {
    if (!services || !services.length) return EMPTY + 'No service recorded yet · Aucun service saisi</div>';
    return services.map(function (x, ix) {
      var opts = '<option value=""' + (x.status ? '' : ' selected') + '>— pick —</option>' +
        SERVICE_STATUSES.map(function (s) {
          return '<option value="' + s.code + '"' + (x.status === s.code ? ' selected' : '') + '>' + s.en + ' · ' + s.fr + '</option>';
        }).join('');
      return '<div class="pv-item" data-kind="service" data-ix="' + ix + '">' +
        '<div class="pv-item__head"><span class="pv-item__ord">S' + (ix + 1) + '</span>' +
        '<button class="pv-item__rm" type="button" data-rm="service" data-ix="' + ix + '">Remove ✕</button></div>' +
        '<div class="pv-row pv-row--three">' +
        '<div class="pv-field"><label>Service <em>· Service</em><span class="req">*</span></label><input type="text" data-k="service" value="' + esc(x.service) + '" placeholder="e.g. Data Mobile"></div>' +
        '<div class="pv-field"><label>Beneficiary <em>· Bénéficiaire</em></label><input type="text" data-k="beneficiary" value="' + esc(x.beneficiary) + '" placeholder="e.g. All departments"></div>' +
        '<div class="pv-field"><label>Status <em>· Statut</em></label><select data-k="status">' + opts + '</select></div>' +
        '</div></div>';
    }).join('');
  }

  return {
    SERVICE_STATUSES: SERVICE_STATUSES, statusCode: statusCode, isIncubation: isIncubation,
    fromHeader: fromHeader, payloadIncubation: payloadIncubation,
    flowRowsHtml: flowRowsHtml, serviceRowsHtml: serviceRowsHtml,
  };
}));
