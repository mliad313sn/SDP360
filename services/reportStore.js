'use strict';
// Step 9 — report templates (an audience + a dashboard definition + sections) and report runs
// (the generated pack: figures, deterministic analysis, AI commentary, HTML; status draft →
// reviewed → published; one row per generation = the version log). sqlite + PostgreSQL
// (db/postgres/reports/019_reports_engagement.sql). No formula here.


const AUDIENCES = ['site', 'executive', 'council'];
const CADENCES = ['weekly', 'monthly', 'quarterly', 'manual'];
const STATUSES = ['draft', 'reviewed', 'published', 'rejected', 'withdrawn'];
const J = (v) => (v == null ? null : JSON.stringify(v));
const P_ = (s, d) => { if (s == null) return d; if (typeof s !== 'string') return s; try { return JSON.parse(s); } catch (_) { return d; } };

function makeReportStore(db, { isPg = false, now = () => new Date().toISOString() } = {}) {
  if (!db) throw new Error('reportStore needs a db handle');
  const P = (sql) => db.prepare(sql);
  async function init() {  }
  async function insert(table, cols, vals) {
    const r = await P(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})${(' RETURNING id')}`).run(...vals);
    return (Number(r && (r.id != null ? r.id : r.lastID != null ? r.lastID : (r.rows && r.rows[0] && r.rows[0].id))));
  }
  const tplRow = (r) => r && ({ ...r, sections: P_(r.sections, []), recipients: P_(r.recipients, []), ai_enabled: Number(r.ai_enabled) !== 0, enabled: Number(r.enabled) !== 0 });
  const runRow = (r, { full = false } = {}) => r && ({ ...r, id: Number(r.id), site_id: r.site_id == null ? null : Number(r.site_id), deviation: Number(r.deviation) || 0, figures: full ? P_(r.figures, null) : undefined, analysis: full ? P_(r.analysis, null) : undefined, commentary: full ? P_(r.commentary, null) : undefined, html: full ? r.html : undefined, html_bytes: r.html ? String(r.html).length : 0 });

  async function listTemplates({ includeDisabled = false } = {}) { return (await P(`SELECT * FROM report_templates${includeDisabled ? '' : ' WHERE enabled=1'} ORDER BY audience, name`).all()).map(tplRow); }
  async function getTemplate(key) { return tplRow(await P(`SELECT * FROM report_templates WHERE key=?`).get(String(key))); }
  async function saveTemplate(t, { user } = {}) {
    if (!t || !t.key || !/^[a-z0-9][a-z0-9_-]{0,47}$/i.test(t.key)) throw Object.assign(new Error('template key is required (letters, digits, - _)'), { code: 'INVALID' });
    const ex = await P(`SELECT key FROM report_templates WHERE key=?`).get(t.key);
    if (!ex && (!t.name || !t.dashboard_key)) throw Object.assign(new Error('name and dashboard_key are required'), { code: 'INVALID' });
    if (t.audience && !AUDIENCES.includes(t.audience)) throw Object.assign(new Error(`audience must be one of ${AUDIENCES.join(', ')}`), { code: 'INVALID' });
    if (t.cadence && !CADENCES.includes(t.cadence)) throw Object.assign(new Error('bad cadence'), { code: 'INVALID' });
    const vals = { name: String(t.name).slice(0, 200), audience: t.audience || 'site', dashboard_key: String(t.dashboard_key).slice(0, 48), lang: t.lang === 'fr' ? 'fr' : 'en', cadence: t.cadence || 'monthly',
      sections: J(Array.isArray(t.sections) ? t.sections.slice(0, 20) : ['headline', 'figures', 'analysis', 'commentary', 'actions']), recipients: J(Array.isArray(t.recipients) ? t.recipients.slice(0, 50) : []),
      ai_enabled: t.ai_enabled === false ? 0 : 1, enabled: t.enabled === false ? 0 : 1 };
    if (ex) { const keys = Object.keys(vals).filter(k => t[k] !== undefined || k === 'sections' && t.sections); if (keys.length) await P(`UPDATE report_templates SET ${keys.map(k => `${k}=?`).join(', ')}, updated_at=? WHERE key=?`).run(...keys.map(k => vals[k]), now(), t.key); return getTemplate(t.key); }
    await P(`INSERT INTO report_templates (key, ${Object.keys(vals).join(',')}, owner_id, created_at, updated_at) VALUES (?, ${Object.keys(vals).map(() => '?').join(',')}, ?, ?, ?)`).run(t.key, ...Object.values(vals), user ? user.id : null, now(), now());
    return getTemplate(t.key);
  }
  async function removeTemplate(key) { await P(`DELETE FROM report_templates WHERE key=?`).run(String(key)); }
  async function seed(templates) { const added = []; for (const t of templates) { if (await getTemplate(t.key)) continue; await saveTemplate(t, {}); added.push(t.key); } return added; }

  async function createRun({ templateKey, siteId, windowLabel, figures, analysis, commentary, html, provider, deviation, user }) {
    const id = await insert('report_runs', ['template_key', 'site_id', 'window_label', 'status', 'figures', 'analysis', 'commentary', 'html', 'provider', 'deviation', 'created_by', 'created_at'],
      [String(templateKey), siteId == null ? null : Number(siteId), windowLabel || null, 'draft', J(figures), J(analysis), J(commentary), html || null, provider || null, Number(deviation) || 0, user ? user.id : null, now()]);
    return getRun(id);
  }
  async function getRun(id) { return runRow(await P(`SELECT * FROM report_runs WHERE id=?`).get(Number(id)), { full: true }); }
  async function listRuns({ templateKey = null, siteIds = null, status = null, limit = 50 } = {}) {
    const where = [], args = [];
    if (templateKey) { where.push('template_key=?'); args.push(String(templateKey)); }
    if (status) { const st = Array.isArray(status) ? status : [status]; where.push(`status IN (${st.map(() => '?').join(',')})`); args.push(...st); }
    const rows = (await P(`SELECT id, template_key, site_id, window_label, status, provider, deviation, created_by, created_at, reviewed_by, reviewed_at, rating, published_at, html FROM report_runs${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC, id DESC LIMIT ${Math.min(500, Number(limit) || 50)}`).all(...args)).map(r => runRow(r));
    return Array.isArray(siteIds) ? rows.filter(r => r.site_id == null || siteIds.includes(r.site_id)) : rows;
  }
  async function setStatus(id, status, { user, note, rating, override } = {}) {
    if (!STATUSES.includes(status)) throw Object.assign(new Error('bad run status'), { code: 'INVALID' });
    const p = { status }; if (status === 'reviewed' || status === 'rejected') { p.reviewed_by = user ? user.id : null; p.reviewed_at = now(); p.review_note = note == null ? null : String(note).slice(0, 2000); if (rating != null) p.rating = Math.min(5, Math.max(1, Number(rating) || 0)) || null; }
    if (status === 'published') { p.published_at = now(); p.published_by = user ? user.id : null; if (override) p.publish_override = J(override); }
    if (status === 'withdrawn') { p.withdrawn_at = now(); p.withdrawn_by = user ? user.id : null; p.withdraw_reason = note == null ? null : String(note).slice(0, 2000); }
    if (status === 'draft') { p.reviewed_by = null; p.reviewed_at = null; }
    await P(`UPDATE report_runs SET ${Object.keys(p).map(k => `${k}=?`).join(', ')} WHERE id=?`).run(...Object.values(p), Number(id));
    return getRun(id);
  }
  async function updateCommentary(id, commentary) { await P(`UPDATE report_runs SET commentary=? WHERE id=?`).run(J(commentary), Number(id)); return getRun(id); }
  async function updateHtml(id, html) { await P(`UPDATE report_runs SET html=? WHERE id=?`).run(html, Number(id)); }
  /** Reviewer satisfaction: share of reviewed runs rated ≥ 4 (the "≥ 80 % useful" acceptance). */
  async function ratingStats() { const rows = await P(`SELECT rating FROM report_runs WHERE rating IS NOT NULL`).all(); const n = rows.length; const good = rows.filter(r => Number(r.rating) >= 4).length; return { rated: n, useful: good, useful_pct: n ? Math.round(good / n * 100) : null }; }

  return { init, listTemplates, getTemplate, saveTemplate, removeTemplate, seed, createRun, getRun, listRuns, setStatus, updateCommentary, updateHtml, ratingStats, AUDIENCES, CADENCES, STATUSES };
}

module.exports = { makeReportStore, AUDIENCES, CADENCES, STATUSES };
