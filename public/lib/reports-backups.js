/* E-A02 (audit A-02, first slice) — the "Backups & recovery" admin cards of public/reports.html, moved out of the
 * page's inline <script> with NO behaviour change: same function names (global — the page's onclick="…" handlers
 * and showAdminPanel() call them), same DOM ids (#bk-*, #trash-*, #rd-*), same routes.
 *   loadBackupSchedule · saveBackupSchedule · backupNowAdmin   — Scheduled Backups card (super_admin)
 *   loadTrash · restoreTrashRow                                 — Deleted records card (admin tier)
 *   loadRestoreDrillCard                                        — Last restore drill card (super_admin)
 * Uses the page's own api() / esc() / toast() at CALL time (they are declared by the inline script, which runs
 * after this file; nothing here runs at load). Classic script on purpose: no top-level const/let (they would be
 * shared with the page's script and collide — CLAUDE.md classic-script pitfall).
 */
/* global api, esc, toast */
// ── Scheduled Backups card (super_admin) ──────────────────
async function loadBackupSchedule() {
  const st = document.getElementById('bk-status'), tb = document.getElementById('bk-points');
  try {
    const d = await api('GET', '/api/admin/backup-schedule');
    const f = (t) => {
      if (!t || !t.exists) return '<span style="color:#b45309">not scheduled</span>';
      const en = t.enabled ? '<span style="color:#15803d">enabled</span>' : '<span style="color:#b91c1c">disabled</span>';
      const lr = t.lastRun ? (' · last run ' + esc(t.lastRun) + ' (result ' + esc(String(t.lastResult == null ? '?' : t.lastResult)) + ')') : ' · never ran';
      return en + lr;
    };
    st.innerHTML = '<b>Daily DB:</b> ' + f(d.status.daily) + ' &nbsp;│&nbsp; <b>Weekly full:</b> ' + f(d.status.weekly);
    if (d.status.daily && d.status.daily.startTime) document.getElementById('bk-daily').value = d.status.daily.startTime;
    if (d.status.weekly && d.status.weekly.startTime) document.getElementById('bk-weekly-time').value = d.status.weekly.startTime;
    if (d.status.daily && d.status.daily.retentionFull) document.getElementById('bk-ret-full').value = d.status.daily.retentionFull;
    if (d.status.daily && d.status.daily.retentionDbOnly) document.getElementById('bk-ret-db').value = d.status.daily.retentionDbOnly;
    tb.innerHTML = (d.restorePoints && d.restorePoints.length)
      ? d.restorePoints.map(p => '<tr><td>' + esc(p.name) + '</td><td>' + (p.sizeBytes/1048576).toFixed(1) + ' MB</td><td>' + esc((p.mtime||'').slice(0,16).replace('T',' ')) + '</td></tr>').join('')
      : '<tr><td colspan="3" style="color:#6b7a99">none yet</td></tr>';
  } catch (e) { st.textContent = 'Error: ' + e.message; }
}
// A-19 — Deleted records card: GET /api/admin/trash, restore through each row's restore_url (admin tier).
async function loadTrash() {
  const tb = document.getElementById('trash-rows'), st = document.getElementById('trash-status'), sel = document.getElementById('trash-module');
  if (!tb) return;
  try {
    const mod = sel && sel.value ? sel.value : '';
    const d = await api('GET', '/api/admin/trash' + (mod ? '?module=' + encodeURIComponent(mod) : ''));
    if (sel && sel.options.length <= 1) (d.modules || []).forEach(m => { const o = document.createElement('option'); o.value = m; o.textContent = m; sel.appendChild(o); });
    st.textContent = (d.enabled ? 'Soft delete ON' : 'Soft delete OFF (deletes are permanent)') + ' · retention ' + d.retention_days + ' days · purge ' + (d.purge_enabled ? 'armed' : 'off');
    const rows = d.rows || [];
    tb.innerHTML = rows.length ? rows.map(r => '<tr><td>' + esc(r.module) + (r.kind && r.kind !== r.module ? ' / ' + esc(r.kind) : '') + '</td><td>' + esc(r.label) + '</td><td>' + esc(r.site || '—') + '</td><td>'
        + esc(String(r.deleted_at || '').slice(0, 16).replace('T', ' ')) + '</td><td>' + esc(r.deleted_by_name || (r.deleted_by == null ? '—' : '#' + r.deleted_by)) + '</td><td>' + esc(r.delete_reason || '—') + '</td><td>'
        + (r.restorable ? '<button type="button" class="btn btn-secondary btn-sm" data-url="' + esc(r.restore_url) + '" onclick="restoreTrashRow(this)">Restore</button>' : '<span style="color:#b91c1c">past retention</span>') + '</td></tr>').join('')
      : '<tr><td colspan="7" style="color:#6b7a99">Nothing deleted.</td></tr>';
  } catch (e) { if (st) st.textContent = 'Error: ' + e.message; }
}
async function restoreTrashRow(btn) {
  if (!confirm('Restore this record?')) return;
  try { await api('POST', btn.dataset.url, {}); toast('Restored', 'success'); loadTrash(); }
  catch (e) { toast('Restore failed: ' + e.message, 'error'); }
}
// E11 — Last restore drill card: date + result of the newest `restore_drill` system_log row.
async function loadRestoreDrillCard() {
  const st = document.getElementById('rd-status'), tb = document.getElementById('rd-counts');
  if (!st || !tb) return;
  try {
    const d = await api('GET', '/api/health/restore-drill');
    if (!d || !d.last) {
      st.innerHTML = '<span style="color:#b45309">No restore drill has run yet</span> · <span lang="fr">aucun exercice de restauration pour l\'instant</span>. Next scheduled run: 1st of the month, 04:00.';
      tb.innerHTML = '<tr><td colspan="4" style="color:#6b7a99">—</td></tr>';
      return;
    }
    const L = d.last, det = L.details || {};
    const when = esc(String(L.ts || '').slice(0, 16).replace('T', ' '));
    st.innerHTML = (L.ok ? '<span style="color:#15803d;font-weight:700">✓ PASS</span>' : '<span style="color:#b91c1c;font-weight:700">✗ FAIL</span>')
      + ' · ' + when + ' UTC'
      + (det.dump ? ' · dump <code>' + esc(det.dump) + '</code>' : '')
      + (det.encrypted === false ? ' · <span style="color:#b45309">plaintext backup — set SDP_BACKUP_KEY</span>' : (det.encrypted ? ' · encrypted' : ''))
      + (det.report ? ' · report <code>docs/ops/restore-drills/' + esc(det.report) + '</code>' : '');
    const counts = det.counts || {};
    const keys = Object.keys(counts);
    tb.innerHTML = keys.length
      ? keys.map(t => { const c = counts[t] || {}; const col = c.status === 'ok' ? '#15803d' : (c.status === 'n/a' ? '#6b7a99' : '#b91c1c');
          return '<tr><td>' + esc(t) + '</td><td>' + (c.live == null ? '—' : esc(String(c.live))) + '</td><td>' + (c.restored == null ? '—' : esc(String(c.restored))) + '</td><td style="color:' + col + ';font-weight:600">' + esc(String(c.status || '')) + '</td></tr>'; }).join('')
      : '<tr><td colspan="4" style="color:#6b7a99">no table detail recorded</td></tr>';
  } catch (e) { st.textContent = 'Error: ' + e.message; }
}
async function saveBackupSchedule(enable) {
  const msg = document.getElementById('bk-save-msg');
  msg.textContent = 'Saving…';
  try {
    await api('POST', '/api/admin/backup-schedule', enable ? {
      enabled: true,
      daily: document.getElementById('bk-daily').value,
      weeklyDay: document.getElementById('bk-weekly-day').value,
      weeklyTime: document.getElementById('bk-weekly-time').value,
      retentionFull: parseInt(document.getElementById('bk-ret-full').value, 10),
      retentionDbOnly: parseInt(document.getElementById('bk-ret-db').value, 10),
    } : { enabled: false });
    msg.textContent = enable ? '✓ Saved + tasks (re)created' : '✓ Schedule disabled';
    loadBackupSchedule();
  } catch (e) { msg.textContent = 'Error: ' + e.message; }
}
async function backupNowAdmin() {
  const btn = document.getElementById('bk-now-btn'), msg = document.getElementById('bk-save-msg');
  btn.disabled = true; msg.textContent = 'Backing up…';
  try {
    await api('POST', '/api/admin/backup-now', { dbOnly: true });
    msg.textContent = '✓ Backup done';
    loadBackupSchedule();
  } catch (e) { msg.textContent = 'Error: ' + e.message; }
  finally { btn.disabled = false; }
}
