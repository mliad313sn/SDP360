/* The small API client of the 2.0 pages (step 8 onwards): JSON calls with the session token, file downloads and
 * HTML documents opened in a new tab (both need the token, so a plain link cannot carry them), status lines.
 * window.__authToken is the raw token string set by auth.js. */
(function (root) {
  'use strict';
  var tok = function () { return root.__authToken || ''; };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function api(method, path, body) {
    return fetch(path, { method: method, headers: { 'Content-Type': 'application/json', 'x-report-token': tok() }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) { var e = new Error((j.error || ('HTTP ' + r.status)) + (j.details ? ' — ' + j.details.join(' ; ') : '')); e.status = r.status; e.body = j; throw e; }
          return j;
        });
      });
  }
  function blob(path) {
    return fetch(path, { headers: { 'x-report-token': tok() } }).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.error || ('HTTP ' + r.status)); });
      return r.blob();
    });
  }
  function download(path, filename) {
    return blob(path).then(function (b) {
      var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = filename;
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    });
  }
  function openDocument(path) {
    var w = window.open('', '_blank');
    return blob(path).then(function (b) {
      var u = URL.createObjectURL(b);
      if (w) w.location.href = u; else location.href = u;
    }).catch(function (e) { if (w) w.close(); throw e; });
  }
  function status(el, msg, isErr) { if (!el) return; el.textContent = msg || ''; el.className = isErr ? 'db-error' : 'db-note'; }
  function label(t) { return t && typeof t === 'object' ? (t.fr || t.en || '') : String(t == null ? '' : t); }
  root.SdpApi = { api: api, download: download, openDocument: openDocument, status: status, esc: esc, label: label };
})(typeof self !== 'undefined' ? self : this);
