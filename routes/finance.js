'use strict';
const xpGate = require('../services/exportPolicy').gate;   // P9 / B7 — one export policy (allow / mask / deny + export log + watermark)
// A1 + B8 (goal programme 2026-11-12) — Finance certification, dated FX rates, display currency and the Pronto
// actuals FILE import. Every error goes through services/httpError.fail. Two switches, both '0' by default:
//   finance_certification_enabled  /api/finance/status, /api/finance/certifications*            (404 while '0')
//   actuals_import_enabled         /api/finance/fx-rates*, /convert, /prefs, /actuals*          (404 while '0')
// Money rule (invariant 2): every route that returns or computes an amount needs the admin tier or finance-viewer.
//   GET  /api/finance/status?scope&scope_key&period           state + badge of one figure (no amount)        money read
//   GET  /api/finance/certifications[?scope&scope_key&period]  register (current + superseded + revoked)      money read
//   GET  /api/finance/certifications/export.xlsx               register + hash-chained ledger                 money read
//   POST /api/finance/certifications                           certify (finance-verifier held exactly + money read, not the last editor)
//   POST /api/finance/certifications/:id/revoke {reason}       withdraw a current certification                finance-verifier
//   GET  /api/finance/fx-rates · GET /api/finance/convert       dated rates · one reproducible conversion       money read
//   POST /api/finance/fx-rates · POST /api/finance/fx-rates/:id/retire {reason}                                admin tier
//   GET/PUT /api/finance/prefs                                 display currency (presentation only)           any session
//   GET/PUT /api/finance/actuals/templates                     saved column mappings                          admin tier
//   POST /api/finance/actuals/dry-run · /commit                file → validation → reconciliation → write     admin tier
//   GET  /api/finance/actuals/batches[/:id[/export.xlsx]]      committed imports + their reconciliation       admin tier
const { fail, typed } = require('../services/httpError');
const FC = require('../services/financeCertification');
const FX = require('../services/fxRates');
const AI = require('../services/actualsImport');
const FF = require('../services/financeFigures');

module.exports = function financeRoutes(deps) {
  const { express, requireReportSession } = deps;
  const router = express.Router();
  const json = express.json({ limit: '256kb' });
  const fileJson = express.json({ limit: '15mb' });   // a base64 Pronto export (≈ 10 MB file)
  const rdb = () => deps.rdb || require('../reports-db');
  const reportConfig = deps.reportConfig || require('../services/reportConfig');
  const certStore = () => deps.certStore || (deps._cs = deps._cs || require('../services/financeCertStore').makeFinanceCertStore(rdb().pgHandle()));
  const fxStore = () => deps.fxStore || (deps._fx = deps._fx || require('../services/financeCertStore').makeFxStore(rdb().pgHandle()));
  const gov = () => require('../services/governanceStore').makeGovernanceStore(rdb().pgHandle());
  const cfg = async () => { try { return await reportConfig.getConfig(rdb().db); } catch (_) { return {}; } };
  const on = (c, k) => String(c && c[k]) === '1';
  const has = (u, r) => !!u && rdb().userHasRole(u, r);
  const log = (req, action, target, details) => { try { Promise.resolve(rdb().logEvent({ category: 'finance', action, target: String(target), details, ...rdb()._logCtx(req) })).catch(() => {}); } catch (_) {} };
  const notFound = (res) => fail(res, typed('NOT_FOUND', 'not found', 404));
  const today = () => new Date().toISOString().slice(0, 10);

  // Route guards (tagged for the C-17 capability catalogue — services/capabilityRegistry.js)
  function requireMoneyRead(req, res, next) { return has(req.reportUser, 'admin') || has(req.reportUser, 'finance-viewer') ? next() : fail(res, typed('FORBIDDEN', 'admin or finance-viewer role required', 403)); }
  requireMoneyRead.legacyRoles = ['admin', 'finance-viewer'];
  function requireFinanceVerifier(req, res, next) { return has(req.reportUser, FC.VERIFIER_ROLE) ? next() : fail(res, typed('FORBIDDEN', 'the finance-verifier role is required', 403), undefined, { reason: 'VERIFIER_ROLE' }); }
  requireFinanceVerifier.legacyRoles = [FC.VERIFIER_ROLE];
  function requireFinanceAdmin(req, res, next) { return has(req.reportUser, 'admin') ? next() : fail(res, typed('FORBIDDEN', 'admin role required', 403)); }
  requireFinanceAdmin.legacyRoles = ['admin'];
  const gate = (key) => async (req, res, next) => (on(await cfg(), key) ? next() : notFound(res));
  const certOn = gate('finance_certification_enabled');
  const importOn = gate('actuals_import_enabled');

  const target = (q) => ({ scope: String(q.scope || ''), scope_key: String(q.scope_key || 'fleet'), period: String(q.period || today().slice(0, 7)) });
  const targetProblem = (t) => { const v = FC.validate({ ...t, evidence: 'x', source: 'x' }); return v ? typed('VALIDATION', v.error, 400) : null; };

  // ── A1 certification ─────────────────────────────────────────────────────────────────────────────────────
  router.get('/api/finance/status', requireReportSession, requireMoneyRead, certOn, async (req, res) => {
    try {
      const t = target(req.query); const bad = targetProblem(t); if (bad) return fail(res, bad);
      const s = await FF.statusOf(t, { store: certStore(), cfg: await cfg() });
      const c = s.certification;
      res.json({ ok: true, target: t, found: s.found, state: s.state, certified: s.state === 'verified', badge: s.badge,
        certification: c ? { id: c.id, certified_by_name: c.certified_by_name, certified_at: c.certified_at, source: c.source, evidence: c.evidence, evidence_link: c.evidence_link } : null,
        can_certify: FC.mayCertify(req.reportUser, has).ok, coverage_is_separate: true });
    } catch (e) { fail(res, e); }
  });
  router.get('/api/finance/certifications', requireReportSession, requireMoneyRead, certOn, async (req, res) => {
    try {
      const q = req.query;
      const rows = await certStore().list({ scope: q.scope ? String(q.scope) : null, scope_key: q.scope_key ? String(q.scope_key) : null, period: q.period ? String(q.period) : null });
      const c = await cfg();
      const out = [];
      for (const r of rows) {
        let state = r.status;
        if (r.status === 'verified') { try { state = (await FF.statusOf(r, { store: certStore(), cfg: c })).state; } catch (_) { state = 'unknown'; } }
        out.push({ ...r, figures_summary: r.figures_summary ? JSON.parse(r.figures_summary) : null, current_state: state });
      }
      res.json({ ok: true, certifications: out, scopes: FC.SCOPES, can_certify: FC.mayCertify(req.reportUser, has).ok, verifier_role: FC.VERIFIER_ROLE });
    } catch (e) { fail(res, e); }
  });
  router.get('/api/finance/certifications/export.xlsx', requireReportSession, requireMoneyRead, certOn, xpGate('finance.certifications'), async (req, res) => {
    try {
      const rows = await certStore().list({ limit: 5000 });
      const reg = rows.map((r) => ({ Id: r.id, Scope: r.scope, 'Scope key': r.scope_key, Period: r.period, Status: r.status, 'Figures hash': r.figures_hash,
        'Certified by': r.certified_by_name, 'Certified at': r.certified_at, Source: r.source, Evidence: r.evidence, 'Evidence link': r.evidence_link || '',
        'Revoked by': r.revoked_by_name || '', 'Revoked at': r.revoked_at || '', 'Revoke reason': r.revoke_reason || '' }));
      const ev = (await certStore().events()).map((e) => ({ Id: Number(e.id), Certification: Number(e.certification_id), Event: e.event, Scope: e.scope, 'Scope key': e.scope_key, Period: e.period, Actor: e.actor_name, At: e.at, Note: e.note || '' }));
      const buf = require('../services/tableExcel').buildWorkbook([{ name: 'Certifications', rows: reg }, { name: 'Ledger', rows: ev }]);
      log(req, 'finance_certifications_exported', 'register', { rows: reg.length });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="finance-certifications.xlsx"');
      res.send(buf);
    } catch (e) { fail(res, e); }
  });
  router.post('/api/finance/certifications', requireReportSession, requireFinanceVerifier, certOn, json, async (req, res) => {
    try {
      const u = req.reportUser, b = req.body || {};
      const may = FC.mayCertify(u, has);
      if (!may.ok) return fail(res, typed('FORBIDDEN', 'a finance-verifier who may also read the amounts (admin tier or finance-viewer) certifies', 403), undefined, { reason: may.reason });
      const t = { scope: String(b.scope || ''), scope_key: String(b.scope_key || ''), period: String(b.period || ''), evidence: b.evidence, evidence_link: b.evidence_link, source: b.source };
      const v = FC.validate(t); if (v) return fail(res, typed('VALIDATION', v.error, 400), undefined, { reason: v.code });
      const f = await FF.figuresFor(t, { cfg: await cfg() });
      if (!f.found) return notFound(res);
      const sod = FC.sodProblem(u.id, f.lastEditorIds);
      if (sod) return fail(res, typed('FORBIDDEN', 'the person who last entered these figures cannot certify them', 403), undefined, { reason: sod });
      const hash = FC.figuresHash(f.figures);
      if (b.expected_hash && String(b.expected_hash) !== hash) return fail(res, typed('CONFLICT', 'the figures changed while you were reviewing them — reload and check again', 409), undefined, { reason: 'FIGURES_CHANGED' });
      const c = await certStore().certify(t, { hash, summary: f.summary, user: u });
      log(req, 'finance_certified', `${t.scope}:${t.scope_key}:${t.period}`, { certification_id: c.id, figures_hash: hash, source: c.source });
      res.json({ ok: true, certification: c, state: 'verified', badge: FC.badge('verified', c) });
    } catch (e) { fail(res, e); }
  });
  router.post('/api/finance/certifications/:id/revoke', requireReportSession, requireFinanceVerifier, certOn, json, async (req, res) => {
    try {
      const reason = String((req.body && req.body.reason) || '').trim();
      if (reason.length < 3) return fail(res, typed('VALIDATION', 'a reason is required to revoke a certification', 400));
      const c = await certStore().revoke(req.params.id, { reason, user: req.reportUser });
      log(req, 'finance_certification_revoked', `${c.scope}:${c.scope_key}:${c.period}`, { certification_id: c.id, reason });
      res.json({ ok: true, certification: c, state: 'uncertified', badge: FC.badge('uncertified', null) });
    } catch (e) { fail(res, e); }
  });

  // ── B8 dated FX rates, conversion, display currency ──────────────────────────────────────────────────────
  router.get('/api/finance/fx-rates', requireReportSession, requireMoneyRead, importOn, async (req, res) => {
    try { res.json({ ok: true, rates: await fxStore().listRates(), supported: FX.SUPPORTED, convention: 'rate = USD for 1 unit of the currency; USD is the base', can_edit: has(req.reportUser, 'admin') }); } catch (e) { fail(res, e); }
  });
  router.post('/api/finance/fx-rates', requireReportSession, requireFinanceAdmin, importOn, json, async (req, res) => {
    try {
      const b = req.body || {}; const r = { currency: String(b.currency || '').toUpperCase(), effective_from: String(b.effective_from || ''), rate: b.rate, source: b.source };
      const bad = FX.validateRate(r); if (bad) return fail(res, typed('VALIDATION', bad, 400));
      const row = await fxStore().addRate(r, req.reportUser);
      log(req, 'fx_rate_added', `fx:${row.id}`, { currency: row.currency, effective_from: row.effective_from, rate: row.rate, source: row.source });
      res.json({ ok: true, rate: row });
    } catch (e) { fail(res, e); }
  });
  router.post('/api/finance/fx-rates/:id/retire', requireReportSession, requireFinanceAdmin, importOn, json, async (req, res) => {
    try {
      const reason = String((req.body && req.body.reason) || '').trim();
      if (reason.length < 3) return fail(res, typed('VALIDATION', 'a reason is required to retire a rate', 400));
      const row = await fxStore().retireRate(req.params.id, { reason, user: req.reportUser });
      log(req, 'fx_rate_retired', `fx:${row.id}`, { currency: row.currency, effective_from: row.effective_from, reason });
      res.json({ ok: true, rate: row });
    } catch (e) { fail(res, e); }
  });
  router.get('/api/finance/convert', requireReportSession, requireMoneyRead, importOn, async (req, res) => {
    try {
      const q = req.query; const date = /^\d{4}-\d{2}-\d{2}$/.test(String(q.date || '')) ? String(q.date) : today();
      const c = FX.convert(q.amount, q.from, q.to, date, await fxStore().listRates());
      res.json({ ok: true, conversion: c });
    } catch (e) { fail(res, e); }
  });
  async function siteCurrencyOf(u, c) {
    if (!u || u.site_id == null) return null;
    try {
      const s = (await rdb().listSites({ includeInactive: true })).find((x) => Number(x.id) === Number(u.site_id));
      const CUR = require('../services/currency');
      return s ? CUR.resolveSiteCurrency(s.name, CUR.parseCurrencyMap(c.asset_site_currency)) : null;
    } catch (_) { return null; }
  }
  router.get('/api/finance/prefs', requireReportSession, importOn, async (req, res) => {
    try {
      const c = await cfg(); const pref = await fxStore().getPref(req.reportUser.id); const siteCurrency = await siteCurrencyOf(req.reportUser, c);
      res.json({ ok: true, display_currency: pref, site_currency: siteCurrency, effective: FX.displayCurrency({ pref, siteCurrency }), supported: FX.SUPPORTED, presentation_only: true });
    } catch (e) { fail(res, e); }
  });
  router.put('/api/finance/prefs', requireReportSession, importOn, json, async (req, res) => {
    try {
      const v = req.body && req.body.display_currency; const cur = v == null || v === '' ? null : String(v).toUpperCase();
      if (cur && !FX.SUPPORTED.includes(cur)) return fail(res, typed('VALIDATION', 'display_currency must be ' + FX.SUPPORTED.join(' | ') + ' (or empty = site default)', 400));
      const saved = await fxStore().setPref(req.reportUser.id, cur);
      log(req, 'display_currency_set', `user:${req.reportUser.id}`, { display_currency: saved });
      const siteCurrency = await siteCurrencyOf(req.reportUser, await cfg());
      res.json({ ok: true, display_currency: saved, effective: FX.displayCurrency({ pref: saved, siteCurrency }) });
    } catch (e) { fail(res, e); }
  });

  // ── B8 Pronto actuals (FILE only) ────────────────────────────────────────────────────────────────────────
  router.get('/api/finance/actuals/templates', requireReportSession, requireFinanceAdmin, importOn, async (req, res) => {
    try { res.json({ ok: true, templates: await fxStore().listTemplates(), fields: AI.FIELDS, date_formats: AI.DATE_FORMATS }); } catch (e) { fail(res, e); }
  });
  const mappingOf = (m) => ({ columns: Object.fromEntries(AI.FIELDS.map((f) => [f, String((m && m.columns && m.columns[f]) || '').slice(0, 120)])), date_format: m && m.date_format ? String(m.date_format) : 'ISO' });
  router.put('/api/finance/actuals/templates', requireReportSession, requireFinanceAdmin, importOn, json, async (req, res) => {
    try {
      const name = String((req.body && req.body.name) || '').trim().slice(0, 120);
      if (!name) return fail(res, typed('VALIDATION', 'a template name is required', 400));
      const mapping = mappingOf(req.body.mapping);
      if (AI.FIELDS.some((f) => !mapping.columns[f]) || !AI.DATE_FORMATS.includes(mapping.date_format)) return fail(res, typed('VALIDATION', 'map every field (' + AI.FIELDS.join(', ') + ') and a date format ' + AI.DATE_FORMATS.join(' | '), 400));
      const t = await fxStore().saveTemplate(name, mapping, req.reportUser);
      log(req, 'actuals_template_saved', `template:${name}`, { mapping });
      res.json({ ok: true, template: t });
    } catch (e) { fail(res, e); }
  });
  async function prepare(body) {
    const b = body || {};
    if (!b.content_base64) throw typed('VALIDATION', 'content_base64 (the CSV / Excel file) is required', 400);
    const buf = Buffer.from(String(b.content_base64), 'base64');
    if (!buf.length) throw typed('VALIDATION', 'the file is empty', 400);
    let mapping = b.mapping ? mappingOf(b.mapping) : null;
    if (!mapping && b.template) { const t = await fxStore().getTemplate(b.template); if (!t) throw typed('NOT_FOUND', 'no import template named ' + b.template, 404); mapping = t.mapping; }
    let parsed;
    try { parsed = AI.parseFile(buf, String(b.filename || 'upload.csv')); } catch (_) { throw typed('VALIDATION', 'the file could not be read as CSV or Excel', 400); }
    if (!mapping) return { parsed, mapping: null, headers_only: true };
    const mbad = AI.validateMapping(parsed.headers, mapping); if (mbad) throw typed('VALIDATION', mbad, 400);
    const projects = new Map((await rdb().pgHandle().prepare('SELECT id, key FROM portfolio_projects WHERE deleted_at IS NULL').all()).map((p) => [String(p.key).toLowerCase(), { id: Number(p.id), key: p.key }]));
    const d = AI.dryRun(parsed.rows, mapping, projects);
    const ids = [...new Set(d.aggregates.map((a) => a.project_id))];
    const existing = ids.length ? await rdb().pgHandle().prepare(`SELECT project_id, period, currency, kind, amount FROM ppm_budget_periods WHERE project_id IN (${ids.map(() => '?').join(',')}) AND kind IN ('actual', 'baseline')`).all(...ids) : [];
    return { parsed, mapping, dry: d, recon: AI.reconcile(d.aggregates, existing) };
  }
  const prevOf = (p) => ({ filename: p.filename, file_sha256: p.parsed.sha256, headers: p.parsed.headers, truncated: p.parsed.truncated, rows_total: p.dry ? p.dry.rows_total : p.parsed.rows.length });
  router.post('/api/finance/actuals/dry-run', requireReportSession, requireFinanceAdmin, importOn, fileJson, async (req, res) => {
    try {
      const p = await prepare(req.body); p.filename = req.body.filename || null;
      if (p.headers_only) return res.json({ ok: true, file: prevOf(p), sample: p.parsed.rows.slice(0, 5), needs_mapping: true });
      const prior = await fxStore().batchByHash(p.parsed.sha256);
      res.json({ ok: true, file: prevOf(p), mapping: p.mapping, rows_ok: p.dry.rows_ok, errors: p.dry.errors, reconciliation: p.recon,
        already_imported: prior ? { batch_id: prior.id, committed_at: prior.committed_at, committed_by: prior.committed_by_name } : null,
        certification: 'Imported actuals are NOT certified: a finance-verifier who did not import them certifies each project × period (scope project_actuals).' });
    } catch (e) { fail(res, e); }
  });
  router.post('/api/finance/actuals/commit', requireReportSession, requireFinanceAdmin, importOn, fileJson, async (req, res) => {
    try {
      const b = req.body || {};
      const reason = String(b.reason || '').trim();
      if (reason.length < 3) return fail(res, typed('VALIDATION', 'a reason is required (e.g. "Pronto October close")', 400));
      const p = await prepare(b);
      if (p.headers_only) return fail(res, typed('VALIDATION', 'a mapping or a template is required to commit', 400));
      if (p.dry.errors.length && b.skip_errors !== true) return fail(res, typed('VALIDATION', `${p.dry.errors.length} row error(s) — fix the file, or commit the valid rows only with skip_errors`, 400), undefined, { errors: p.dry.errors.slice(0, 200) });
      const prior = await fxStore().batchByHash(p.parsed.sha256);
      if (prior && b.allow_reimport !== true) return fail(res, typed('CONFLICT', `this exact file was already imported (batch #${prior.id}, ${prior.committed_at})`, 409), undefined, { batch_id: prior.id });
      const tag = `Pronto import ${p.parsed.sha256.slice(0, 12)}${b.filename ? ' (' + String(b.filename).slice(0, 120) + ')' : ''}: ${reason.slice(0, 500)}`;
      const write = p.recon.lines.filter((l) => l.status !== 'unchanged');
      const G = gov(); const H = rdb().pgHandle();
      const batch = await H.runTransaction(async () => {
        for (const l of write) await G.saveBudgetPeriod(l.project_id, { period: l.period, currency: l.currency, kind: 'actual', amount: l.imported, reason: tag }, { user: req.reportUser });
        return fxStore().addBatch({ filename: b.filename, file_sha256: p.parsed.sha256, template_name: b.template || null, rows_total: p.dry.rows_total, rows_written: write.length, reason,
          report: { reconciliation: p.recon, errors: p.dry.errors, rows_ok: p.dry.rows_ok, mapping: p.mapping } }, req.reportUser);
      });
      log(req, 'actuals_imported', `batch:${batch.id}`, { file_sha256: p.parsed.sha256, rows_total: p.dry.rows_total, written: write.length, skipped_errors: p.dry.errors.length });
      res.json({ ok: true, batch: { id: batch.id, committed_at: batch.committed_at, rows_written: batch.rows_written }, reconciliation: p.recon, errors: p.dry.errors,
        certification: 'not certified — each project × period waits for a finance-verifier (who did not import it)' });
    } catch (e) { fail(res, e); }
  });
  router.get('/api/finance/actuals/batches', requireReportSession, requireFinanceAdmin, importOn, async (req, res) => {
    try { res.json({ ok: true, batches: await fxStore().listBatches() }); } catch (e) { fail(res, e); }
  });
  router.get('/api/finance/actuals/batches/:id', requireReportSession, requireFinanceAdmin, importOn, async (req, res) => {
    try { const bt = await fxStore().getBatch(req.params.id); if (!bt) return notFound(res); res.json({ ok: true, batch: bt }); } catch (e) { fail(res, e); }
  });
  router.get('/api/finance/actuals/batches/:id/export.xlsx', requireReportSession, requireFinanceAdmin, importOn, xpGate('finance.actuals_batch'), async (req, res) => {
    try {
      const bt = await fxStore().getBatch(req.params.id); if (!bt) return notFound(res);
      const c = await cfg(); const certifying = on(c, 'finance_certification_enabled');
      const lines = [];
      for (const l of bt.report.reconciliation.lines) {
        let cert = { State: 'Non certifié', 'Certified by': '—', 'Certified at': '—' };
        if (certifying) { const s = await FF.statusOf({ scope: 'project_actuals', scope_key: `project:${l.project_id}`, period: l.period }, { store: certStore(), cfg: c }); const r = FC.exportRow(s.target, s.state, s.certification); cert = { State: r.State, 'Certified by': r['Certified by'], 'Certified at': r['Certified at'] }; }
        lines.push({ Project: l.project_key, Period: l.period, Currency: l.currency, 'GL lines': l.lines, Baseline: l.baseline, 'Existing actual': l.existing_actual, Imported: l.imported, Delta: l.delta, Status: l.status, ...cert });
      }
      const sheets = [{ name: 'Reconciliation', rows: lines }, { name: 'Totals per currency', rows: bt.report.reconciliation.totals.map((t) => ({ Currency: t.currency, Imported: t.imported, 'Existing actual': t.existing_actual, Keys: t.keys })) },
        { name: 'Row errors', rows: (bt.report.errors || []).map((e) => ({ Row: e.row, Field: e.field, Error: e.error })) },
        { name: 'Batch', rows: [{ Batch: bt.id, File: bt.filename || '', 'SHA-256': bt.file_sha256, 'Committed by': bt.committed_by_name, 'Committed at': bt.committed_at, Reason: bt.reason || '', Note: 'Amounts per currency, never added across currencies. Not certified unless the Certified columns say so.' }] }];
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="actuals-import-${bt.id}.xlsx"`);
      res.send(require('../services/tableExcel').buildWorkbook(sheets));
    } catch (e) { fail(res, e); }
  });

  return router;
};
