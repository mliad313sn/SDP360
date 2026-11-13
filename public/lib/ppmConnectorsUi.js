/* W4-CONNECTORS — OPTIONAL external PPM tools panel on the project page (Plan tab). Mounted by public/project.html ONLY
 * while at least one connector switch is on (GET /api/governance/ppm/features: xer, mpp_import, jira_sync, azdo_sync).
 * Nothing here is needed by the native plan. Every action goes through routes/ppmConnectors.js; the server decides
 * (plan-write dry run, committee apply, opt-in, read-only pull) and its refusal message is shown as is.
 */
(function (root) {
  'use strict';
  var NAMES = { jira: 'Jira', azdo: 'Azure DevOps' };
  function mount(X) {
    var pane = document.getElementById('pane-plan'); if (!pane || !X || !X.pid) return;
    var F = X.feat || {}, V = X.V || {};
    if (!(F.xer || F.mpp_import || F.jira_sync || F.azdo_sync)) return;
    var old = document.getElementById('ppm-connectors'); if (old) old.remove();
    var box = document.createElement('div'); box.id = 'ppm-connectors'; box.className = 'card';
    var base = '/api/governance/ppm/project/' + encodeURIComponent(X.pid);
    var h = '<h3>External planning tools (optional)</h3><p class="muted">These exchanges are optional; the plan works without them.</p>';
    if (F.xer) h += '<p><a class="btn" href="' + base + '/project.xer">Download as Primavera P6 XER</a></p>';
    if ((F.xer || F.mpp_import) && V.can_edit_plan) {
      h += '<p><label>Import a plan file into this EMPTY project <input type="file" id="ppmc-file" accept=".xer,.mpp"></label></p>' +
        '<p><button type="button" class="btn" id="ppmc-preview">Preview import</button> <button type="button" class="btn" id="ppmc-apply">Import (committee)</button></p>';
    }
    ['jira', 'azdo'].forEach(function (s) {
      if (!F[s + '_sync']) return;
      h += '<div data-sys="' + s + '"><h4>' + NAMES[s] + ' (read-only pull)</h4><p class="ppmc-state muted">Loading…</p>' +
        (V.can_edit_plan ? '<p><label>Scope <input type="text" class="ppmc-scope" maxlength="400"></label> <button type="button" class="btn ppmc-optin">Save scope</button> <button type="button" class="btn ppmc-optout">Stop syncing</button></p>' +
          '<p><button type="button" class="btn ppmc-dry">Preview sync</button> <button type="button" class="btn ppmc-sync">Sync now</button></p>' : '') + '<pre class="ppmc-out muted"></pre></div>';
    });
    box.innerHTML = h; pane.appendChild(box);
    var say = function (t, cls) { if (X.msg) X.msg(t, cls); };
    var upload = function (apply) {
      var f = document.getElementById('ppmc-file'); var file = f && f.files && f.files[0];
      if (!file) return say('Choose a .xer or .mpp file first.', 'err');
      var kind = /\.mpp$/i.test(file.name) ? 'mpp' : 'xer';
      if ((kind === 'mpp' && !F.mpp_import) || (kind === 'xer' && !F.xer)) return say('This file type is not enabled.', 'err');
      fetch(base + '/' + kind + '/import' + (apply ? '?apply=1' : ''), { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; }); })
        .then(function (j) { say(j.dry_run ? 'Preview: ' + j.summary.tasks + ' tasks, ' + j.summary.links + ' links — nothing saved yet.' : 'Imported: ' + j.result.tasks + ' tasks.', 'ok'); if (!j.dry_run && X.reload) X.reload(); })
        .catch(function (e) { say(e.message, 'err'); });
    };
    var p = document.getElementById('ppmc-preview'); if (p) p.addEventListener('click', function () { upload(false); });
    var a = document.getElementById('ppmc-apply'); if (a) a.addEventListener('click', function () { upload(true); });
    Array.prototype.forEach.call(box.querySelectorAll('[data-sys]'), function (el) {
      var s = el.getAttribute('data-sys'), state = el.querySelector('.ppmc-state'), out = el.querySelector('.ppmc-out');
      var refresh = function () {
        X.api(base + '/work-items/' + s).then(function (j) {
          state.textContent = (j.source ? 'Scope: ' + j.source.scope + ' · last sync: ' + (j.source.last_sync_at || '—') : 'This project has not opted in.') + ' · ' + j.links.length + ' linked items' + (j.connection_configured ? '' : ' · connection not configured');
          var sc = el.querySelector('.ppmc-scope'); if (sc && j.source) sc.value = j.source.scope;
        }).catch(function (e) { state.textContent = e.message; });
      };
      var on = function (cls, fn) { var b = el.querySelector(cls); if (b) b.addEventListener('click', fn); };
      on('.ppmc-optin', function () { X.api(base + '/work-items/' + s, { method: 'PUT', body: JSON.stringify({ scope: el.querySelector('.ppmc-scope').value }) }).then(function () { say('Scope saved.', 'ok'); refresh(); }).catch(function (e) { say(e.message, 'err'); }); });
      on('.ppmc-optout', function () { X.api(base + '/work-items/' + s, { method: 'PUT', body: JSON.stringify({ enabled: false }) }).then(function () { say('Syncing stopped.', 'ok'); refresh(); }).catch(function (e) { say(e.message, 'err'); }); });
      var sync = function (apply) { X.api(base + '/work-items/' + s + '/sync' + (apply ? '?apply=1' : ''), { method: 'POST', body: '{}' }).then(function (j) { out.textContent = JSON.stringify(j.summary, null, 1); if (apply) { refresh(); if (X.reload) X.reload(); } }).catch(function (e) { say(e.message, 'err'); }); };
      on('.ppmc-dry', function () { sync(false); }); on('.ppmc-sync', function () { sync(true); });
      refresh();
    });
  }
  root.PpmConnectorsUi = { mount: mount };
})(typeof window !== 'undefined' ? window : globalThis);
