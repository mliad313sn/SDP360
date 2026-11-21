/* PMO UX (2026-11) — small shared UI pieces for the project / portfolio pages. Display and ergonomics only:
 * nothing here grants a permission, changes a formula or writes data on its own — every save still goes through
 * the page's own call to the server, which stays the authority (RBAC, validation, versions).
 *   drawer      openDrawer(id, opener) / closeDrawer(id)   right-side panel, Escape closes, focus returns
 *   toast       toast(text, bad)                            short message pinned to the bottom of the window
 *   formMsg     formMsg(box, text, bad)                     inline message under a form's Save button
 *   stepper     stepperHtml(stages, current, label, esc)    "n of N" stage stepper with the current stage named
 *   progress    progressHtml(pct, esc)                      bar + number; unknown → "—" and no bar
 *   empty       emptyHtml(text, actionHtml, esc)            .edv-empty-state with one action
 *   chips       chipSelect(select, opts)                    type-to-search chips over a <select multiple>
 *                                                           (the select stays the source of truth — save code unchanged)
 *   checklist   checklistBuilder(box, opts) → { read, write }  gate checklist rows ⇄ the same JSON the server reads
 *   sort        sortable(table)                             click a header to sort, aria-sort kept
 *   format      date(v) / dateTime(v) / number(v)           through lib/format.js (SDPFormat); unknown → "—"
 *   subtabs     segmented(box, onPick)                      role=tablist over [data-sub] buttons
 */
(function (root) {
  'use strict';
  var doc = root.document;
  var escD = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  // ---- drawer --------------------------------------------------------------------------------------------------
  var openers = {};
  function openDrawer(id, opener) {
    var d = doc.getElementById(id); if (!d) return;
    openers[id] = opener || doc.activeElement;
    d.hidden = false; d.classList.add('open');
    var back = doc.getElementById('ppm-drawer-back'); if (back) back.hidden = false;
    var f = d.querySelector('input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea, button:not(.ppm-drawer-x)');
    if (f) try { f.focus(); } catch (_) { /* hidden */ }
  }
  function closeDrawer(id) {
    var d = doc.getElementById(id); if (!d || d.hidden) return;
    d.hidden = true; d.classList.remove('open');
    var anyOpen = doc.querySelector('.ppm-drawer.open');
    var back = doc.getElementById('ppm-drawer-back'); if (back && !anyOpen) back.hidden = true;
    var o = openers[id]; if (o && o.focus && doc.body.contains(o)) try { o.focus(); } catch (_) { /* gone */ }
  }
  if (doc) {
    doc.addEventListener('keydown', function (ev) { if (ev.key !== 'Escape') return; var d = doc.querySelector('.ppm-drawer.open'); if (d) { ev.preventDefault(); closeDrawer(d.id); } });
    doc.addEventListener('click', function (ev) {
      var x = ev.target.closest && ev.target.closest('[data-drawer-close]'); if (x) { closeDrawer(x.getAttribute('data-drawer-close')); return; }
      if (ev.target && ev.target.id === 'ppm-drawer-back') { var d = doc.querySelector('.ppm-drawer.open'); if (d) closeDrawer(d.id); }
    });
  }

  // ---- toast / inline messages ---------------------------------------------------------------------------------
  var toastTimer = null;
  function toast(text, bad) {
    var t = doc.getElementById('ppm-toast');
    if (!t) { t = doc.createElement('div'); t.id = 'ppm-toast'; t.className = 'ppm-toast'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite'); doc.body.appendChild(t); }
    t.textContent = text; t.classList.toggle('bad', !!bad); t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, bad ? 7000 : 3200);
  }
  function formMsg(box, text, bad) {
    if (!box) return;
    box.innerHTML = text ? '<div class="' + (bad ? 'errors' : 'ok') + '">' + escD(text) + '</div>' : '';
  }
  // mark a field invalid (aria-invalid + red border + helper text under it); clear with ok=true
  function invalid(input, text) {
    if (!input) return;
    var help = input.parentNode && input.parentNode.querySelector('.ppm-help-err');
    if (text) { input.setAttribute('aria-invalid', 'true'); if (!help) { help = doc.createElement('span'); help.className = 'ppm-help-err'; input.parentNode.appendChild(help); } help.textContent = text; }
    else { input.removeAttribute('aria-invalid'); if (help) help.remove(); }
  }

  // ---- display helpers ---------------------------------------------------------------------------------------------
  function stepperHtml(stages, current, label, esc) {
    esc = esc || escD; var i = stages.indexOf(current);
    if (!stages.length) return '—';
    var name = current ? label(current) : '—';
    var tip = (i >= 0 ? (i + 1) + ' / ' + stages.length + ' · ' : '') + name;
    return '<span class="ppm-stepper" title="' + esc(tip) + '" aria-label="' + esc(tip) + '">' + stages.map(function (s, k) {
      return '<span class="ppm-step' + (k < i ? ' past' : k === i ? ' cur' : '') + '" title="' + esc(label(s)) + '"></span>';
    }).join('') + '</span> <span class="ppm-step-name">' + esc(name) + '</span>';
  }
  function progressHtml(pct, esc) {
    esc = esc || escD;
    if (pct == null || pct === '' || !isFinite(Number(pct))) return '—';
    var v = Math.max(0, Math.min(100, Number(pct)));
    return '<span class="ppm-progress"><span class="ppm-progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + esc(v) + '"><span style="width:' + esc(v) + '%"></span></span> <span class="ppm-num">' + esc(String(pct)) + ' %</span></span>';
  }
  function emptyHtml(text, actionHtml, esc) {
    esc = esc || escD;
    return '<div class="edv-empty-state ppm-empty"><p>' + esc(text) + '</p>' + (actionHtml || '') + '</div>';
  }

  // ---- chip multi-select over a <select multiple> --------------------------------------------------------------------
  function chipSelect(sel, opts) {
    if (!sel || sel.__chips) return sel && sel.__chips;
    opts = opts || {};
    var box = doc.createElement('div'); box.className = 'ppm-chips';
    var list = doc.createElement('span'); list.className = 'ppm-chip-list';
    var inp = doc.createElement('input'); inp.type = 'text'; inp.className = 'ppm-chip-input';
    inp.setAttribute('aria-label', opts.label || sel.getAttribute('aria-label') || 'Add');
    inp.placeholder = opts.placeholder || '';
    var dl = doc.createElement('datalist'); dl.id = (sel.id || 'sel') + '-chips-dl'; inp.setAttribute('list', dl.id);
    box.appendChild(list); box.appendChild(inp); box.appendChild(dl);
    sel.parentNode.insertBefore(box, sel.nextSibling);
    sel.classList.add('ppm-chips-src');
    function render() {
      var opt = Array.prototype.slice.call(sel.options);
      list.innerHTML = opt.filter(function (o) { return o.selected; }).map(function (o) {
        return '<span class="ppm-chip">' + escD(o.text) + ' <button type="button" aria-label="Remove ' + escD(o.text) + '" data-v="' + escD(o.value) + '">×</button></span>';
      }).join('');
      dl.innerHTML = opt.filter(function (o) { return !o.selected; }).map(function (o) { return '<option value="' + escD(o.text) + '"></option>'; }).join('');
    }
    function changed() { render(); sel.dispatchEvent(new Event('change', { bubbles: true })); }
    list.addEventListener('click', function (ev) {
      var b = ev.target.closest && ev.target.closest('button[data-v]'); if (!b) return;
      Array.prototype.forEach.call(sel.options, function (o) { if (o.value === b.getAttribute('data-v')) o.selected = false; }); changed(); inp.focus();
    });
    function pick() {
      var v = inp.value.trim(); if (!v) return;
      var hit = Array.prototype.filter.call(sel.options, function (o) { return o.text === v || o.value === v; })[0];
      if (hit) { hit.selected = true; inp.value = ''; changed(); }
    }
    inp.addEventListener('change', pick);
    inp.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); pick(); }
      if (ev.key === 'Backspace' && !inp.value) { var last = Array.prototype.filter.call(sel.options, function (o) { return o.selected; }).pop(); if (last) { last.selected = false; changed(); } }
    });
    var api = { render: render, input: inp };
    sel.__chips = api; render();
    return api;
  }

  // ---- gate checklist builder (rows ⇄ JSON the server reads, unchanged) -------------------------------------------
  function checklistBuilder(box, opts) {
    opts = opts || {}; var L = opts.labels || {};
    var t = function (k, d) { return L[k] || d; };
    box.innerHTML = '<div class="ppm-cl-rows"></div><div class="bar"><button type="button" class="btn" data-cl-add>' + escD(t('add', '+ Item')) + '</button></div>' +
      '<fieldset class="ppm-cl-appr"><legend>' + escD(t('approvers', 'Approvers (roles)')) + '</legend><div class="ppm-cl-roles"></div>' +
      '<label class="ppm-inline">' + escD(t('role', 'Other role')) + ' <input type="text" data-cl-role-new placeholder="committee-member"></label></fieldset>' +
      '<fieldset class="ppm-cl-rule"><legend>' + escD(t('rule', 'Rule')) + '</legend>' +
      '<label class="ppm-inline"><input type="radio" name="cl-rule" value="all" checked> ' + escD(t('all', 'All approvers')) + '</label> ' +
      '<label class="ppm-inline"><input type="radio" name="cl-rule" value="quorum"> ' + escD(t('quorum', 'Quorum')) + '</label> ' +
      '<label class="ppm-inline">' + escD(t('quorumN', 'Quorum size')) + ' <input type="number" min="1" data-cl-q style="width:70px"></label></fieldset>';
    var rows = box.querySelector('.ppm-cl-rows'), roles = box.querySelector('.ppm-cl-roles');
    var ROLES = opts.roles || ['committee-member', 'executive', 'admin', 'super_admin'];
    var extraUsers = [];
    var roleLabel = opts.roleLabel || function (r) { return root.PpmLabels ? root.PpmLabels.label('role', r) : r; };   // the value saved stays the role code
    function rowHtml(it) {
      return '<div class="ppm-cl-row"><input type="text" data-cl-label aria-label="' + escD(t('label', 'Item label')) + '" placeholder="' + escD(t('label', 'Item label')) + '" value="' + escD(it.label || '') + '">' +
        '<select data-cl-kind aria-label="' + escD(t('kind', 'Kind')) + '"><option value="artifact"' + (it.kind !== 'check' ? ' selected' : '') + '>' + escD(t('artifact', 'Document')) + '</option><option value="check"' + (it.kind === 'check' ? ' selected' : '') + '>' + escD(t('check', 'Check')) + '</option></select>' +
        '<input type="hidden" data-cl-key value="' + escD(it.key || '') + '"><button type="button" class="btn" data-cl-del aria-label="' + escD(t('remove', 'Remove')) + '">×</button></div>';
    }
    function rolesHtml(sel) {
      var all = ROLES.concat(sel.filter(function (r) { return ROLES.indexOf(r) < 0; }));
      roles.innerHTML = all.map(function (r) { return '<label class="ppm-inline"><input type="checkbox" value="' + escD(r) + '"' + (sel.indexOf(r) >= 0 ? ' checked' : '') + '> ' + escD(roleLabel(r)) + '</label>'; }).join(' ');
    }
    box.addEventListener('click', function (ev) {
      if (ev.target.closest('[data-cl-add]')) rows.insertAdjacentHTML('beforeend', rowHtml({}));
      var d = ev.target.closest('[data-cl-del]'); if (d) d.closest('.ppm-cl-row').remove();
    });
    box.querySelector('[data-cl-role-new]').addEventListener('change', function () { var v = this.value.trim(); if (!v) return; var sel = read().approvers.filter(function (a) { return a.role; }).map(function (a) { return a.role; }); if (sel.indexOf(v) < 0) sel.push(v); rolesHtml(sel); this.value = ''; });
    var slug = function (s, i) { var k = String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40); return k || ('item_' + (i + 1)); };
    function read() {
      var items = [], seen = {};
      Array.prototype.forEach.call(rows.querySelectorAll('.ppm-cl-row'), function (r, i) {
        var label = r.querySelector('[data-cl-label]').value.trim(); if (!label) return;
        var key = r.querySelector('[data-cl-key]').value || slug(label, i); while (seen[key]) key += '_' + (i + 1); seen[key] = 1;
        items.push({ key: key, label: label, kind: r.querySelector('[data-cl-kind]').value });
      });
      var approvers = Array.prototype.filter.call(roles.querySelectorAll('input:checked'), function () { return true; }).map(function (c) { return { role: c.value }; }).concat(extraUsers);
      var rule = (box.querySelector('input[name=cl-rule]:checked') || {}).value || 'all';
      var out = { items: items, approvers: approvers, rule: rule };
      var q = Number(box.querySelector('[data-cl-q]').value); if (rule === 'quorum' && q > 0) out.quorum = q;
      return out;
    }
    function write(def) {
      def = def && typeof def === 'object' ? def : {};
      rows.innerHTML = (def.items && def.items.length ? def.items : [{}]).map(rowHtml).join('');
      var a = def.approvers || [{ role: 'committee-member' }];
      extraUsers = a.filter(function (x) { return x && x.user_id != null; });
      rolesHtml(a.filter(function (x) { return x && x.role; }).map(function (x) { return x.role; }));
      var r = box.querySelector('input[name=cl-rule][value="' + (def.rule === 'quorum' ? 'quorum' : 'all') + '"]'); if (r) r.checked = true;
      box.querySelector('[data-cl-q]').value = def.quorum || '';
    }
    write(opts.value);
    return { read: read, write: write };
  }

  // ---- dates and numbers (lib/format.js — SDPFormat; unknown stays "—", never 0) ---------------------------------
  function date(v) {
    if (v == null || v === '') return '—';
    var F = root.SDPFormat; if (F && F.date) return F.date(String(v).length > 10 && /^\d{4}-\d\d-\d\d/.test(String(v)) ? String(v).slice(0, 10) : v);
    return String(v).slice(0, 10);
  }
  function dateTime(v) { if (v == null || v === '') return '—'; var F = root.SDPFormat; return F && F.dateTime ? F.dateTime(v) : String(v).slice(0, 16).replace('T', ' '); }
  function number(v, digits) {
    if (v == null || v === '' || !isFinite(Number(v))) return '—';
    var F = root.SDPFormat; return F && F.number ? F.number(Number(v), digits == null ? undefined : { digits: digits }) : String(v);
  }

  // ---- sortable table ---------------------------------------------------------------------------------------------
  function cellKey(td) { var v = td ? (td.getAttribute('data-sort') != null ? td.getAttribute('data-sort') : td.textContent.trim()) : ''; var n = Number(String(v).replace(/[%\s,]/g, '')); return v !== '' && v !== '—' && isFinite(n) && /^[-+\d.,%\s]+$/.test(v) ? n : v; }
  function sortable(table) {
    if (!table || table.__sortable) return; table.__sortable = true;
    var ths = table.querySelectorAll('thead th');
    Array.prototype.forEach.call(ths, function (th, idx) {
      if (th.hasAttribute('data-nosort')) return;
      var b = doc.createElement('button'); b.type = 'button'; b.className = 'ppm-sort'; b.innerHTML = th.innerHTML; th.innerHTML = ''; th.appendChild(b);
      b.addEventListener('click', function () {
        var dir = th.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending';
        Array.prototype.forEach.call(ths, function (x) { x.removeAttribute('aria-sort'); }); th.setAttribute('aria-sort', dir);
        var tb = table.tBodies[0], rs = Array.prototype.slice.call(tb.rows);
        rs.sort(function (a, c) {
          var x = cellKey(a.cells[idx]), y = cellKey(c.cells[idx]);
          var ux = x === '' || x === '—', uy = y === '' || y === '—'; if (ux || uy) return ux === uy ? 0 : ux ? 1 : -1;   // unknown always last
          var r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
          return dir === 'ascending' ? r : -r;
        });
        rs.forEach(function (r) { tb.appendChild(r); });
      });
    });
  }

  // ---- segmented sub-tabs ---------------------------------------------------------------------------------------------
  function segmented(box, onPick) {
    if (!box) return;
    var bs = function () { return Array.prototype.slice.call(box.querySelectorAll('[data-sub]')).filter(function (b) { return !b.hidden; }); };
    function pick(b, focus) {
      bs().forEach(function (x) { var on = x === b; x.setAttribute('aria-selected', on ? 'true' : 'false'); x.tabIndex = on ? 0 : -1; });
      if (focus) b.focus();
      onPick(b.getAttribute('data-sub'));
    }
    box.addEventListener('click', function (ev) { var b = ev.target.closest && ev.target.closest('[data-sub]'); if (b) pick(b); });
    box.addEventListener('keydown', function (ev) {
      var list = bs(), cur = list.indexOf(doc.activeElement); if (cur < 0) return;
      var to = ev.key === 'ArrowRight' ? (cur + 1) % list.length : ev.key === 'ArrowLeft' ? (cur + list.length - 1) % list.length : ev.key === 'Home' ? 0 : ev.key === 'End' ? list.length - 1 : -1;
      if (to >= 0) { ev.preventDefault(); pick(list[to], true); }
    });
    return { pick: function (name) { var b = bs().filter(function (x) { return x.getAttribute('data-sub') === name; })[0] || bs()[0]; if (b) pick(b); } };
  }

  var api = { openDrawer: openDrawer, closeDrawer: closeDrawer, toast: toast, formMsg: formMsg, invalid: invalid, stepperHtml: stepperHtml, progressHtml: progressHtml,
    emptyHtml: emptyHtml, chipSelect: chipSelect, checklistBuilder: checklistBuilder, sortable: sortable, segmented: segmented, cellKey: cellKey, date: date, dateTime: dateTime, number: number };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PpmUx = api;
})(typeof window !== 'undefined' ? window : globalThis);
