'use strict';
// E-B07 (audit B-07) — in-app product feedback. Every route answers 404 while report_config
// ui_feedback_enabled = '0' (default = today: no button, no routes).
//   POST /api/feedback                       { kind: problem|idea|question, page, text ≤ 2 000, anonymous }   session
//   GET  /api/feedback?status=&page=         list (newest first)                                                admin tier
//   POST /api/feedback/:id/triage            { status: new|triaged|planned|declined|done, response }            admin tier
//   GET  /api/feedback/mine                  my named rows with their answer (My Work shows them)               session
// An anonymous row stores NO user id — only the role tier and the site. No notification is sent (no outbound
// call), no AI reads the text. Triage writes one system_log row (category 'feedback', action 'feedback_triaged').
const { fail } = require('../services/httpError');

const KINDS = Object.freeze(['problem', 'idea', 'question']);
const STATUSES = Object.freeze(['new', 'triaged', 'planned', 'declined', 'done']);
const MAX_TEXT = 2000, MAX_RESPONSE = 2000, MAX_PAGE = 120;
const TIERS = ['super_admin', 'executive', 'admin', 'editor', 'viewer'];

const clip = (v, n) => String(v == null ? '' : v).replace(/\u0000/g, '').trim().slice(0, n);

/** Pure: validate a submission → { row } or { error }. */
function validateSubmission(body, user, tierOf) {
  const b = body || {};
  const kind = clip(b.kind, 20).toLowerCase();
  if (!KINDS.includes(kind)) return { error: 'kind must be one of ' + KINDS.join(', ') };
  const text = clip(b.text, MAX_TEXT + 1);
  if (!text) return { error: 'text is required' };
  if (text.length > MAX_TEXT) return { error: `text is limited to ${MAX_TEXT} characters` };
  const anonymous = b.anonymous === true || b.anonymous === 1 || b.anonymous === '1';
  return { row: {
    kind, body: text, page: clip(b.page, MAX_PAGE) || null,
    user_id: anonymous ? null : (user && user.id != null ? Number(user.id) : null),
    role_tier: tierOf(user), site_id: user && user.site_id != null ? Number(user.site_id) : null,
    anonymous: anonymous ? 1 : 0,
  } };
}

module.exports = function feedbackRoutes(deps) {
  const { express, requireReportSession } = deps;
  const router = express.Router();
  const rdb = () => deps.rdb || require('../reports-db');
  const H = () => rdb().pgHandle();
  const tierOf = (u) => { try { return TIERS.find((t) => rdb().userHasRole(u, t)) || null; } catch (_) { return null; } };

  async function enabled() {
    try { const c = await require('../services/reportConfig').getConfig(rdb().db); return String(c.ui_feedback_enabled) === '1'; }
    catch (_) { return false; }
  }
  const gate = async (req, res, next) => ((await enabled()) ? next() : fail(res, new Error('Not found'), 404));
  const admin = (req, res, next) => (rdb().userHasRole(req.reportUser, 'admin') ? next() : fail(res, new Error('Admin role required'), 403));

  router.post('/api/feedback', requireReportSession, gate, async (req, res) => {
    try {
      const v = validateSubmission(req.body, req.reportUser, tierOf);
      if (v.error) return fail(res, new Error(v.error), 400);
      const r = v.row;
      const out = await H().prepare(`INSERT INTO product_feedback (created_at, kind, page, body, user_id, role_tier, site_id, anonymous)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`).get(new Date().toISOString(), r.kind, r.page, r.body, r.user_id, r.role_tier, r.site_id, r.anonymous);
      res.status(201).json({ ok: true, id: out && out.id != null ? Number(out.id) : null });
    } catch (e) { fail(res, e); }
  });

  router.get('/api/feedback/mine', requireReportSession, gate, async (req, res) => {
    try {
      const rows = await H().prepare(`SELECT id, created_at, kind, page, body, status, response, triaged_at FROM product_feedback
        WHERE user_id = ? AND anonymous = 0 ORDER BY id DESC LIMIT 50`).all(Number(req.reportUser.id));
      res.json({ rows });
    } catch (e) { fail(res, e); }
  });

  router.get('/api/feedback', requireReportSession, gate, admin, async (req, res) => {
    try {
      const c = [], p = [];
      const st = clip(req.query.status, 20);
      if (st) { if (!STATUSES.includes(st)) return fail(res, new Error('unknown status'), 400); c.push('status = ?'); p.push(st); }
      const pg = clip(req.query.page, MAX_PAGE);
      if (pg) { c.push('page = ?'); p.push(pg); }
      const rows = await H().prepare(`SELECT id, created_at, kind, page, body, user_id, role_tier, site_id, anonymous, status, response, triaged_by, triaged_at
        FROM product_feedback ${c.length ? 'WHERE ' + c.join(' AND ') : ''} ORDER BY id DESC LIMIT 500`).all(...p);
      res.json({ rows });
    } catch (e) { fail(res, e); }
  });

  router.post('/api/feedback/:id/triage', requireReportSession, gate, admin, async (req, res) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (!(id > 0)) return fail(res, new Error('bad id'), 400);
      const status = clip(req.body && req.body.status, 20);
      if (!STATUSES.includes(status)) return fail(res, new Error('status must be one of ' + STATUSES.join(', ')), 400);
      const response = clip(req.body && req.body.response, MAX_RESPONSE) || null;
      const cur = await H().prepare('SELECT id, status FROM product_feedback WHERE id = ?').get(id);
      if (!cur) return fail(res, new Error('Feedback not found'), 404);
      await H().prepare('UPDATE product_feedback SET status = ?, response = ?, triaged_by = ?, triaged_at = ? WHERE id = ?')
        .run(status, response, Number(req.reportUser.id), new Date().toISOString(), id);
      try { rdb().logEvent({ category: 'feedback', action: 'feedback_triaged', target: String(id), details: { from: cur.status, to: status, responded: !!response }, ...rdb()._logCtx(req) }); } catch (_) { /* best-effort */ }
      res.json({ ok: true, id, status });
    } catch (e) { fail(res, e); }
  });

  return router;
};
module.exports.validateSubmission = validateSubmission;
module.exports.KINDS = KINDS;
module.exports.STATUSES = STATUSES;
module.exports.MAX_TEXT = MAX_TEXT;
