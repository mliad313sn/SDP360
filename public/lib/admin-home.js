/* admin-home.js — fills the four Admin home cards from EXISTING super_admin read APIs. Read-only; a source that
 * answers an error or is switched off shows "—" and says why (never a 0). No inline script (strict CSP page). */
(function () {
  'use strict';
  const H = () => { const h = {}; try { const t = typeof window.__authToken === 'function' ? window.__authToken() : window.__authToken; if (t) h['x-report-token'] = t; } catch (_) { /* cookie session */ } return h; };
  const get = (u) => fetch(u, { credentials: 'same-origin', headers: H() }).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
  function card(id, value, meta, state) {
    const el = document.getElementById(id); if (!el) return;
    const v = el.querySelector('[data-k="value"]'), m = el.querySelector('[data-k="meta"]');
    v.textContent = value == null ? '—' : String(value);
    v.classList.toggle('is-unknown', value == null);
    v.classList.toggle('is-attention', state === 'attention');
    m.textContent = meta;
    el.setAttribute('aria-busy', 'false');
  }
  const unread = (s) => (s === 404 ? 'Not available here (the feature is switched off).' : 'Could not be read' + (s ? ' (HTTP ' + s + ')' : '') + ' — shown as unknown, not as zero.');

  get('/api/policy-center/requests?status=pending').then((j) => {
    const n = (Array.isArray(j.requests) ? j.requests : Array.isArray(j) ? j : []).filter((r) => !r.status || r.status === 'pending').length;
    card('ahFourEyes', n, n ? 'A second super_admin must approve or reject.' : 'Nothing is waiting.', n ? 'attention' : '');
  }).catch((s) => card('ahFourEyes', null, unread(s)));

  get('/api/sync/health').then((j) => {
    const jobs = Array.isArray(j.jobs) ? j.jobs : [];
    const bad = jobs.filter((x) => !x.optional && (x.status === 'error' || x.status === 'stale' || x.status === 'never'));
    card('ahSync', bad.length, bad.length ? 'Failing or stale: ' + bad.slice(0, 4).map((x) => x.job + ' (' + x.status + ')').join(', ') + (bad.length > 4 ? '…' : '') : 'Every mandatory synchronisation is fresh.', bad.length ? 'attention' : '');
  }).catch((s) => card('ahSync', null, unread(s)));

  get('/api/admin/backup-schedule').then((j) => {
    const st = j.status || {}; const pts = Array.isArray(j.restorePoints) ? j.restorePoints : [];
    const last = pts[0] && (String(pts[0].mtime || '').slice(0, 16).replace('T', ' ') || pts[0].name);
    const on = ['daily', 'weekly'].filter((k) => st[k] && st[k].exists && st[k].enabled !== false);
    const sched = on.length ? 'Scheduled: ' + on.join(' + ') : 'No scheduled backup task';
    card('ahBackup', pts.length, sched + ' · ' + (last ? 'latest restore point: ' + last : 'no restore point found'), pts.length && on.length ? '' : 'attention');
  }).catch((s) => card('ahBackup', null, unread(s)));

  get('/api/reports/recipients').then((rows) => {
    const list = (Array.isArray(rows) ? rows : []).filter((r) => r.active !== 0 && r.active !== false);
    const isOn = (v) => v === 1 || v === true || v === '1';
    const missing = list.filter((r) => (r.coordinator_email && !isOn(r.coordinator_email_confirmed)) || (r.fm_email && !isOn(r.fm_email_confirmed)) || (r.asset_manager_email && !isOn(r.asset_manager_email_confirmed)));
    card('ahRecipients', missing.length, missing.length ? 'Sites with an address not yet confirmed: ' + missing.slice(0, 6).map((r) => r.site_code).join(', ') + ' — nothing is ever sent to an unconfirmed address.' : 'Every address on file is confirmed.', missing.length ? 'attention' : '');
  }).catch((s) => card('ahRecipients', null, unread(s)));
})();
