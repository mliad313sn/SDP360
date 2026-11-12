// P4 / A2 — Connector Health page. Data: GET /api/connector-health (admin tier). Every value escaped.
// An unknown value renders as a "—" BUTTON: clicking it opens (or finds) the fix task for that connector/site.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const unk = (conn, site, scope, cause) => `<button type="button" class="ch-unk" data-conn="${esc(conn)}" data-site="${site == null ? '' : esc(site)}" data-scope="${esc(scope || '')}" data-cause="${esc(cause || '')}" title="Unknown — click to open a fix task" aria-label="Unknown — open a fix task">—</button>`;
  const val = (v, c, scope, cause) => (v == null || v === '' ? unk(c.id, null, scope || '', cause || c.cause || `${c.name}: value unknown`) : esc(v));
  const ago = (iso) => { if (!iso) return null; const h = (Date.now() - Date.parse(iso)) / 36e5; return h < 1 ? Math.round(h * 60) + ' min ago' : h < 48 ? Math.round(h) + ' h ago' : Math.round(h / 24) + ' d ago'; };
  async function api(method, path, body) {
    const r = await fetch(path, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    return j;
  }
  function card(c) {
    const cfg = c.config || {};
    const cfgTxt = Object.keys(cfg).length ? Object.entries(cfg).filter(([k]) => k !== 'sources').map(([k, v]) => `${esc(k)}: ${esc(typeof v === 'boolean' ? (v ? 'set' : 'not set') : v)}`).join(' · ') : null;
    const miss = (c.failing_scope || []).length
      ? `<ul class="ch-miss">${c.failing_scope.map((m) => `<li>${esc(m.site)} — ${esc(m.reason)} ${unk(c.id, m.site_id, 'site', `${c.name}: ${m.reason} (${m.site})`)}</li>`).join('')}</ul>` : '';
    return `<section class="ch-conn" aria-labelledby="ch-${esc(c.id)}">
      <h3 id="ch-${esc(c.id)}" style="margin:0 0 4px;font-size:15px">${esc(c.name)} <span class="ch-s ch-${esc(c.state)}">${esc(c.state_label)}</span></h3>
      <div class="ch-muted">Register ${esc(c.register)} · owner: ${esc(c.owner_role)}${c.open_tasks ? ` · ${c.open_tasks} open task(s)` : ''}</div>
      ${c.cause ? `<p style="margin:8px 0 4px">${esc(c.cause)}</p>` : ''}
      ${c.human_step ? `<div class="ch-step"><b>Human step:</b> ${esc(c.human_step)}</div>` : ''}
      <dl>
        <dt>Last success</dt><dd>${c.last_success ? esc(c.last_success.replace('T', ' ').slice(0, 16)) + ' UTC · ' + esc(ago(c.last_success)) : val(null, c, '', `${c.name}: never collected`)}</dd>
        <dt>Last failure</dt><dd>${c.last_failure ? esc(c.last_failure.replace('T', ' ').slice(0, 16)) + ' UTC' + (c.last_failure_text ? `<br><span class="ch-muted">${esc(c.last_failure_text)}</span>` : '') : 'none recorded'}</dd>
        <dt>Last run</dt><dd>${c.last_run_ms != null ? esc((c.last_run_ms / 1000).toFixed(1)) + ' s' : val(null, c, '', `${c.name}: run duration unknown`)}</dd>
        <dt>Freshness</dt><dd>${c.freshness.age_hours != null ? esc(c.freshness.age_hours) + ' h' : val(null, c, '', `${c.name}: freshness unknown`)} (expected ≤ ${esc(c.freshness.expected_hours == null ? '—' : c.freshness.expected_hours + ' h')})</dd>
        <dt>Coverage</dt><dd>${c.coverage.pct != null ? esc(c.coverage.pct) + ' % · ' + esc(c.coverage.label) : val(null, c, '', `${c.name}: coverage unknown`)}${c.coverage.period ? ' · ' + esc(c.coverage.period) : ''}</dd>
        <dt>Configuration</dt><dd>${cfgTxt || val(null, c, '', `${c.name}: configuration unreadable`)}</dd>
      </dl>${miss}
    </section>`;
  }
  async function loadTasks() {
    try {
      const j = await api('GET', '/api/connector-health/fix-tasks?status=open');
      $('chTasks').innerHTML = j.tasks.length ? `<table><thead><tr><th scope="col">#</th><th scope="col">Connector</th><th scope="col">Site</th><th scope="col">Cause</th><th scope="col">Owner</th><th scope="col">Opened</th><th scope="col">Action</th></tr></thead><tbody>${
        j.tasks.map((t) => `<tr><td>${esc(t.id)}</td><td>${esc(t.connector)}</td><td>${esc(t.site_id == null ? 'all' : t.site_id)}</td><td>${esc(t.cause)}</td><td>${esc(t.owner_role)}${t.owner_user_id ? ' (#' + esc(t.owner_user_id) + ')' : ''}</td><td>${esc(String(t.created_at || '').slice(0, 16).replace('T', ' '))}</td><td><button type="button" class="ch-btn" data-done="${esc(t.id)}">Mark done</button></td></tr>`).join('')}</tbody></table>` : '<p class="ch-muted">No open fix task.</p>';
    } catch (e) { $('chTasks').textContent = 'Could not load the tasks: ' + e.message; }
  }
  async function load() {
    try {
      const j = await api('GET', '/api/connector-health');
      $('chMeta').textContent = `Checked ${j.checked_at} · ` + Object.entries(j.summary).map(([k, n]) => `${k} ${n}`).join(' · ');
      $('chList').innerHTML = j.connectors.map(card).join('');
    } catch (e) { $('chMeta').textContent = 'Could not load: ' + e.message; }
    loadTasks();
  }
  document.addEventListener('click', async (ev) => {
    const b = ev.target.closest && ev.target.closest('button.ch-unk');
    if (b) {
      try {
        const site = b.dataset.site ? Number(b.dataset.site) : null;
        const r = await api('POST', '/api/connector-health/fix-tasks', { connector: b.dataset.conn, site_id: site, scope: b.dataset.scope || (site ? 'site' : ''), cause: b.dataset.cause });
        $('chMeta').textContent = (r.created ? 'Fix task #' : 'Already open: task #') + r.task.id + ' — owner ' + r.task.owner_role;
        loadTasks();
      } catch (e) { $('chMeta').textContent = 'Could not open the task: ' + e.message; }
      return;
    }
    const d = ev.target.closest && ev.target.closest('button[data-done]');
    if (d) { try { await api('POST', `/api/connector-health/fix-tasks/${d.dataset.done}/close`, { status: 'done' }); loadTasks(); } catch (e) { $('chMeta').textContent = 'Could not close: ' + e.message; } }
  });
  load();
})();
