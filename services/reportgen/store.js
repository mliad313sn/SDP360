'use strict';
// Step 9 — report templates (versioned definitions, services/defstore.js) and report RUNS: the frozen figures, the
// deterministic analysis, the AI draft (if any), the reviewed commentary, the rendered HTML, and a journal of every
// event (generated, edited, approved, shared, published). Schema: db/postgres/reports/021_engagement_reports_publication.sql.

const sql = require('../sqlStore');
const templates = require('../defstore').createStore({ table: 'rp_templates', versions: 'rp_template_versions', key: 'template_id' });
const handle = () => sql.handle('021_engagement_reports_publication.sql');
const { now, newId, parse } = sql;

function runRow(r, full) {
  if (!r) return null;
  const o = { id: r.id, template_id: r.template_id, template_version: r.template_version == null ? null : Number(r.template_version), month: r.month, site_code: r.site_code || null,
    status: r.status, created_by: r.created_by, created_at: r.created_at, approved_by: r.approved_by || null, approved_at: r.approved_at || null };
  if (full) Object.assign(o, { data: parse(r.data_json, { widgets: {} }), analysis: parse(r.analysis_json, {}), ai: parse(r.ai_json, null), commentary: parse(r.commentary, {}) });
  return o;
}

async function createRun(x, by) {
  const { H } = handle();
  const id = newId('RUN');
  await H.prepare(`INSERT INTO rp_runs (id, template_id, template_version, month, site_code, status, data_json, analysis_json, ai_json, commentary, html, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, x.template_id, x.template_version || null, x.month, x.site_code || null, JSON.stringify(x.data), JSON.stringify(x.analysis), x.ai ? JSON.stringify(x.ai) : null,
      JSON.stringify(x.commentary || {}), x.html || null, by || null, now());
  await event(id, by, 'generated', x.ai ? (x.ai.accepted ? 'AI draft accepted by the number check' : (x.ai.skipped ? 'AI: ' + x.ai.skipped : 'AI draft rejected: unknown numbers ' + (x.ai.unknown || []).join(', '))) : 'deterministic commentary');
  return getRun(id, true);
}
async function getRun(id, full) { const { H } = handle(); return runRow(await H.prepare(`SELECT * FROM rp_runs WHERE id = ?`).get(id), full); }
async function getRunHtml(id) { const { H } = handle(); const r = await H.prepare(`SELECT html FROM rp_runs WHERE id = ?`).get(id); return r ? r.html : null; }
async function listRuns({ template_id, status, limit = 200 } = {}) {
  const { H } = handle();
  const w = [], p = [];
  if (template_id) { w.push('template_id = ?'); p.push(template_id); }
  if (status) { w.push('status = ?'); p.push(status); }
  return (await H.prepare(`SELECT * FROM rp_runs ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`).all(...p, Math.min(1000, limit))).map(r => runRow(r, false));
}
async function setCommentary(id, commentary, html, by) {
  const { H } = handle();
  await H.prepare(`UPDATE rp_runs SET commentary = ?, html = ? WHERE id = ? AND status = 'draft'`).run(JSON.stringify(commentary), html, id);
  await event(id, by, 'edited');
}
async function approve(id, html, by) {
  const { H } = handle();
  await H.prepare(`UPDATE rp_runs SET status = 'approved', approved_by = ?, approved_at = ?, html = ? WHERE id = ? AND status = 'draft'`).run(by || null, now(), html, id);
  await event(id, by, 'approved');
}
async function event(runId, by, action, note) {
  const { H } = handle();
  await H.prepare(`INSERT INTO rp_run_events (run_id, at, by, action, note) VALUES (?, ?, ?, ?, ?)`).run(runId, now(), by || null, action, note ? String(note).slice(0, 500) : null);
}
async function events(runId) { const { H } = handle(); return H.prepare(`SELECT at, by, action, note FROM rp_run_events WHERE run_id = ? ORDER BY at`).all(runId); }
async function latestApproved(templateId) {
  const { H } = handle();
  return runRow(await H.prepare(`SELECT * FROM rp_runs WHERE template_id = ? AND status = 'approved' ORDER BY month DESC, approved_at DESC LIMIT 1`).get(templateId), false);
}

module.exports = { templates, createRun, getRun, getRunHtml, listRuns, setCommentary, approve, event, events, latestApproved };
